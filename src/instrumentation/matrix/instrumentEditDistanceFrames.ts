import type { AnyNode, Identifier, IfStatement } from 'acorn';
import {
  isNamed as named,
  isLiteralValue as literal,
  isNamedMember as member,
} from '../matchers';
import {
  beforeNode as before,
  afterNode as at,
  replaceNode as replace,
  frameCall as frame,
  applySourceEdits,
  sourceSpan as span,
  type SourceEdit,
} from '../edits';
import { createIdentifierAllocator } from '../ast';
import type { MatrixMarker } from '../../protocol';
import {
  minusOne,
  index,
  cell,
  binding,
  loop,
  write,
  allocation,
  type Binding,
  type Loop,
  type Write,
} from './matrixMatchers';
import {
  parseMatrixProgram,
  matrixPosition as position,
  matrixMark as mark,
} from './matrixInstrumentationHelpers';
import { TRACE_LIMITS } from '../../protocol/traceSchemas';

type Match = {
  program: import('acorn').Program;
  grid: Binding;
  rowBase: Loop;
  columnBase: Loop;
  baseRowWrite: Write;
  baseColumnWrite: Write;
  branch: IfStatement;
  yes: Write;
  no: Write;
  result: import('acorn').ReturnStatement;
  row: string;
  column: string;
  a: string;
  b: string;
};

function match(program: import('acorn').Program | null): Match | null {
  if (!program || program.body.length !== 4) return null;
  const [firstNode, secondNode, fn, answerNode] = program.body;
  const first = binding(firstNode, 'const');
  const second = binding(secondNode, 'const');
  const answer = binding(answerNode, 'const');
  if (
    !first ||
    !second ||
    !answer ||
    fn?.type !== 'FunctionDeclaration' ||
    !fn.id ||
    fn.async ||
    fn.generator ||
    fn.params.length !== 2 ||
    fn.params.some((param) => param.type !== 'Identifier') ||
    answer.init.type !== 'CallExpression' ||
    answer.init.optional ||
    !named(answer.init.callee, fn.id.name) ||
    answer.init.arguments.length !== fn.params.length ||
    !named(answer.init.arguments[0], first.name) ||
    !named(answer.init.arguments[1], second.name)
  )
    return null;
  const a = (fn.params[0] as Identifier).name;
  const b = (fn.params[1] as Identifier).name;

  if (
    first.init.type !== 'Literal' ||
    typeof first.init.value !== 'string' ||
    second.init.type !== 'Literal' ||
    typeof second.init.value !== 'string' ||
    first.init.value.length + 1 > TRACE_LIMITS.matrixRows ||
    second.init.value.length + 1 > TRACE_LIMITS.matrixColumns ||
    (first.init.value.length + 1) * (second.init.value.length + 1) >
      TRACE_LIMITS.matrixCells
  )
    return null;

  const [gridNode, rowNode, colNode, outerNode, result] = fn.body.body;
  const grid = binding(gridNode, 'const');
  if (
    fn.body.body.length !== 5 ||
    !grid ||
    !allocation(grid.init, a, b, true) ||
    result?.type !== 'ReturnStatement'
  )
    return null;
  const rowBase = loop(rowNode, 0, (node) => member(node, a, 'length'));
  const columnBound = (node: AnyNode) => member(node, b, 'length');
  const columnBase = loop(colNode, 0, columnBound);
  const outer = loop(outerNode, 1, (node) => member(node, a, 'length'));
  if (
    !rowBase ||
    !columnBase ||
    !outer ||
    rowBase.body.length !== 1 ||
    columnBase.body.length !== 1 ||
    outer.body.length !== 1 ||
    rowBase.index !== outer.index
  )
    return null;
  const inner = loop(outer.body[0], 1, columnBound);
  if (
    !inner ||
    inner.body.length !== 1 ||
    inner.index !== columnBase.index ||
    inner.body[0]?.type !== 'IfStatement'
  )
    return null;
  const branch = inner.body[0];
  if (
    branch.test.type !== 'BinaryExpression' ||
    branch.consequent.type !== 'BlockStatement' ||
    branch.alternate?.type !== 'BlockStatement' ||
    branch.consequent.body.length !== 1 ||
    branch.alternate.body.length !== 1
  )
    return null;
  const row = outer.index,
    column = inner.index,
    table = grid.name;
  const baseRowWrite = write(
    rowBase.body[0],
    table,
    (node) => named(node, row),
    (node) => literal(node, 0),
  );
  const baseColumnWrite = write(
    columnBase.body[0],
    table,
    (node) => literal(node, 0),
    (node) => named(node, column),
  );
  const yes = write(
    branch.consequent.body[0],
    table,
    (node) => named(node, row),
    (node) => named(node, column),
  );
  const no = write(
    branch.alternate.body[0],
    table,
    (node) => named(node, row),
    (node) => named(node, column),
  );
  if (
    !baseRowWrite ||
    !baseColumnWrite ||
    !yes ||
    !no ||
    !(
      named(baseRowWrite.assignment.right, row) &&
      named(baseColumnWrite.assignment.right, column)
    )
  )
    return null;
  const top = (node: AnyNode) =>
    cell(
      node,
      table,
      (part) => minusOne(part, row),
      (part) => named(part, column),
    );
  const diagonal = (node: AnyNode) =>
    cell(
      node,
      table,
      (part) => minusOne(part, row),
      (part) => minusOne(part, column),
    );

  const rhs = no.assignment.right;
  if (
    branch.test.operator !== '===' ||
    !index(branch.test.left, a, row) ||
    !index(branch.test.right, b, column) ||
    !diagonal(yes.assignment.right) ||
    rhs.type !== 'BinaryExpression' ||
    rhs.operator !== '+' ||
    !literal(rhs.left, 1) ||
    rhs.right.type !== 'CallExpression' ||
    !member(rhs.right.callee, 'Math', 'min') ||
    rhs.right.arguments.length !== 3 ||
    !top(rhs.right.arguments[0]!) ||
    !cell(
      rhs.right.arguments[1],
      table,
      (part) => named(part, row),
      (part) => minusOne(part, column),
    ) ||
    !diagonal(rhs.right.arguments[2]!)
  )
    return null;

  if (
    !cell(
      result.argument,
      table,
      (node) => member(node, a, 'length'),
      (node) => member(node, b, 'length'),
    )
  )
    return null;
  const names = [
    first.name,
    second.name,
    answer.name,
    fn.id.name,
    a,
    b,
    table,
    row,
    column,
  ];
  if (
    ['Array', 'Math', 'trace'].some((name) => names.includes(name)) ||
    new Set([first.name, second.name, answer.name, fn.id.name]).size !== 4 ||
    new Set([a, b, table, row, column]).size !== 5
  )
    return null;
  return {
    program,
    grid,
    rowBase,
    columnBase,
    baseRowWrite,
    baseColumnWrite,
    branch,
    yes,
    no,
    result,
    row,
    column,
    a,
    b,
  };
}

export function instrumentEditDistanceFrames(
  source: string,
  parsed = parseMatrixProgram(source),
): string | null {
  const found = match(parsed);
  if (!found) return null;
  const { program, grid, row, column, a, b, branch, yes, no, result } = found;
  const next = createIdentifierAllocator(program, '__trace_dp_');
  const old = next();
  const firstDependency = next();
  const secondDependency = next();
  const thirdDependency = next();
  const table = grid.name;
  const read = (
    node: AnyNode,
    label: string,
    value: string,
    role: MatrixMarker,
    r: string,
    c: string,
  ) =>
    frame(
      node,
      `{ type: 'read', operand: { label: '${label}', value: ${value} } }`,
      `${mark('cur', row, column)}, ${mark(role, r, c)}`,
    );
  const assignment = (write: Write, r: string, c: string, extra = '') =>
    frame(
      write.statement,
      `{ type: 'assign', target: ${JSON.stringify(table)} + '[' + ${r} + '][' + ${c} + ']', before: ${old}, value: ${table}[${r}][${c}] }`,
      `{ type: 'matrix.set', position: ${position(r, c)}, value: ${table}[${r}][${c}] }, { type: 'matrix.visit', position: ${position(r, c)} }, ${mark('cur', r, c)}${extra}`,
    );
  const edits: SourceEdit[] = [
    at(
      grid.statement,
      `\ntrace.initialize({ type: 'scene.init', structure: 'matrix' }, { type: 'matrix.create', values: ${table}, rowLabels: ['', ...${a}.split('')], columnLabels: ['', ...${b}.split('')] });`,
    ),
  ];
  for (const [write, r, c] of [
    [found.baseRowWrite, found.rowBase.index, '0'],
    [found.baseColumnWrite, '0', found.columnBase.index],
  ] as const) {
    edits.push(
      before(write.statement, `const ${old} = ${table}[${r}][${c}];\n`),
    );
    edits.push(at(write.statement, `\n${assignment(write, r, c)}`));
  }
  const test = branch.test;
  const left = `${a}[${row} - 1]`;
  const right = `${b}[${column} - 1]`;
  edits.push(
    replace(
      test,
      `trace.compareScalar(${left}, ${right}, '${'eq'}', ${span(test)}, ${JSON.stringify(left)}, ${JSON.stringify(right)}, [${mark('cur', row, column)}])`,
    ),
  );
  const topRow = `${row} - 1`;
  const top = `${table}[${topRow}][${column}]`;
  const writeStart = (write: Write, content: string) =>
    edits.push(
      before(
        write.statement,
        `${content}\nconst ${old} = ${table}[${row}][${column}];\n`,
      ),
    );

  const diagRow = `${row} - 1`,
    diagColumn = `${column} - 1`;
  const diag = `${table}[${diagRow}][${diagColumn}]`;
  writeStart(
    yes,
    `const ${firstDependency} = ${diag};\n${read(yes.assignment.right, 'diagonal dependency', firstDependency, 'diag', diagRow, diagColumn)}`,
  );
  edits.push(replace(yes.assignment.right, firstDependency));
  edits.push(
    at(
      yes.statement,
      `\n${assignment(yes, row, column, `, ${mark('diag', diagRow, diagColumn)}`)}`,
    ),
  );
  const rhs = no.assignment.right;
  if (rhs.type !== 'BinaryExpression' || rhs.right.type !== 'CallExpression')
    return null;
  const [topRead, leftRead, diagRead] = rhs.right.arguments;
  if (!topRead || !leftRead || !diagRead) return null;
  writeStart(
    no,
    `const ${firstDependency} = ${top};\n${read(topRead, 'top dependency', firstDependency, 'top', topRow, column)}\n` +
      `const ${secondDependency} = ${table}[${row}][${diagColumn}];\n${read(leftRead, 'left dependency', secondDependency, 'left', row, diagColumn)}\n` +
      `const ${thirdDependency} = ${diag};\n${read(diagRead, 'diagonal dependency', thirdDependency, 'diag', diagRow, diagColumn)}`,
  );
  edits.push(
    replace(
      rhs,
      `1 + Math.min(${firstDependency}, ${secondDependency}, ${thirdDependency})`,
    ),
  );
  edits.push(
    at(
      no.statement,
      `\n${assignment(no, row, column, `, ${mark('top', topRow, column)}, ${mark('left', row, diagColumn)}, ${mark('diag', diagRow, diagColumn)}`)}`,
    ),
  );

  const lastColumn = `${b}.length`;
  edits.push(
    replace(
      result.argument!,
      `trace.returnValue(${table}[${a}.length][${lastColumn}], ${span(result)})`,
    ),
  );
  return applySourceEdits(source, edits);
}

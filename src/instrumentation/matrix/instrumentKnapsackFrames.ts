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
import { createIdentifierAllocator, isFiniteNumericLiteral } from '../ast';
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
  cap: string;
};

function match(program: import('acorn').Program | null): Match | null {
  if (!program || program.body.length !== 5) return null;
  const [firstNode, secondNode, thirdOrFn, fnOrAnswer, answerNode] =
    program.body;
  const first = binding(firstNode, 'const');
  const second = binding(secondNode, 'const');
  const third = binding(thirdOrFn, 'const');
  const fn = fnOrAnswer;
  const answer = binding(answerNode, 'const');
  if (
    !first ||
    !second ||
    !third ||
    !answer ||
    fn?.type !== 'FunctionDeclaration' ||
    !fn.id ||
    fn.async ||
    fn.generator ||
    fn.params.length !== 3 ||
    fn.params.some((param) => param.type !== 'Identifier') ||
    answer.init.type !== 'CallExpression' ||
    answer.init.optional ||
    !named(answer.init.callee, fn.id.name) ||
    answer.init.arguments.length !== fn.params.length ||
    !named(answer.init.arguments[0], first.name) ||
    !named(answer.init.arguments[1], second.name) ||
    !named(answer.init.arguments[2], third.name)
  )
    return null;
  const a = (fn.params[0] as Identifier).name;
  const b = (fn.params[1] as Identifier).name;
  const cap = (fn.params[2] as Identifier).name;

  if (
    first.init.type !== 'ArrayExpression' ||
    second.init.type !== 'ArrayExpression' ||
    first.init.elements.length !== second.init.elements.length ||
    !first.init.elements.every(
      (entry) =>
        isFiniteNumericLiteral(entry) &&
        entry?.type === 'Literal' &&
        typeof entry.value === 'number' &&
        Number.isSafeInteger(entry.value) &&
        entry.value > 0,
    ) ||
    !second.init.elements.every(
      (entry) =>
        isFiniteNumericLiteral(entry) &&
        entry?.type === 'Literal' &&
        typeof entry.value === 'number' &&
        Number.isSafeInteger(entry.value) &&
        entry.value >= 0,
    ) ||
    third?.init.type !== 'Literal' ||
    typeof third.init.value !== 'number' ||
    !Number.isSafeInteger(third.init.value) ||
    third.init.value < 0 ||
    first.init.elements.length + 1 > TRACE_LIMITS.matrixRows ||
    third.init.value + 1 > TRACE_LIMITS.matrixColumns ||
    (first.init.elements.length + 1) * (third.init.value + 1) >
      TRACE_LIMITS.matrixCells
  )
    return null;

  const [gridNode, rowNode, colNode, outerNode, result] = fn.body.body;
  const grid = binding(gridNode, 'const');
  if (
    fn.body.body.length !== 5 ||
    !grid ||
    !allocation(grid.init, a, cap, false) ||
    result?.type !== 'ReturnStatement'
  )
    return null;
  const rowBase = loop(rowNode, 0, (node) => member(node, a, 'length'));
  const columnBound = (node: AnyNode) => named(node, cap);
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
      literal(baseRowWrite.assignment.right, 0) &&
      literal(baseColumnWrite.assignment.right, 0)
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
  const weight = (node: AnyNode) => index(node, a, row);
  const include = (node: AnyNode) =>
    cell(
      node,
      table,
      (part) => minusOne(part, row),
      (part) =>
        part.type === 'BinaryExpression' &&
        part.operator === '-' &&
        named(part.left, column) &&
        weight(part.right),
    );
  const rhs = yes.assignment.right;
  if (
    branch.test.operator !== '<=' ||
    !weight(branch.test.left) ||
    !named(branch.test.right, column) ||
    rhs.type !== 'CallExpression' ||
    !member(rhs.callee, 'Math', 'max') ||
    rhs.arguments.length !== 2 ||
    !top(rhs.arguments[0]!) ||
    rhs.arguments[1]?.type !== 'BinaryExpression' ||
    rhs.arguments[1].operator !== '+' ||
    !index(rhs.arguments[1].left, b, row) ||
    !include(rhs.arguments[1].right) ||
    !top(no.assignment.right)
  )
    return null;

  if (
    !cell(
      result.argument,
      table,
      (node) => member(node, a, 'length'),
      (node) => named(node, cap),
    )
  )
    return null;
  const names = [
    first.name,
    second.name,
    third.name,
    answer.name,
    fn.id.name,
    a,
    b,
    cap,
    table,
    row,
    column,
  ];
  if (
    ['Array', 'Math', 'trace'].some((name) => names.includes(name)) ||
    new Set([first.name, second.name, third.name, answer.name, fn.id.name])
      .size !== 5 ||
    new Set([a, b, cap, table, row, column]).size !== 6
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
    cap,
  };
}

export function instrumentKnapsackFrames(
  source: string,
  parsed = parseMatrixProgram(source),
): string | null {
  const found = match(parsed);
  if (!found) return null;
  const { program, grid, row, column, a, b, cap, branch, yes, no, result } =
    found;
  const next = createIdentifierAllocator(program, '__trace_dp_');
  const old = next();
  const firstDependency = next();
  const secondDependency = next();
  const candidate = next();
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
      `\ntrace.initialize({ type: 'scene.init', structure: 'matrix' }, { type: 'matrix.create', values: ${table} });`,
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
  const right = column;
  edits.push(
    replace(
      test,
      `trace.compareScalar(${left}, ${right}, '${'lte'}', ${span(test)}, ${JSON.stringify(left)}, ${JSON.stringify(right)}, [${mark('cur', row, column)}])`,
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

  const weight = `${a}[${row} - 1]`;
  const includeColumn = `${column} - ${weight}`;
  const rhs = yes.assignment.right;
  if (
    rhs.type !== 'CallExpression' ||
    rhs.arguments[0] === undefined ||
    rhs.arguments[1]?.type !== 'BinaryExpression'
  )
    return null;
  const includeCell = rhs.arguments[1].right;
  writeStart(
    yes,
    `const ${firstDependency} = ${top};\n${read(rhs.arguments[0], 'exclude dependency', firstDependency, 'top', topRow, column)}\n` +
      `const ${secondDependency} = ${table}[${topRow}][${includeColumn}];\n${read(includeCell, 'include dependency', secondDependency, 'diag', topRow, includeColumn)}\n` +
      `const ${candidate} = ${b}[${row} - 1] + ${secondDependency};\n` +
      `trace.compareScalar(${firstDependency}, ${candidate}, 'gte', ${span(rhs)}, 'exclude', 'include', [${mark('cur', row, column)}, ${mark('top', topRow, column)}, ${mark('diag', topRow, includeColumn)}]);`,
  );
  edits.push(replace(rhs, `Math.max(${firstDependency}, ${candidate})`));
  edits.push(
    at(
      yes.statement,
      `\n${assignment(yes, row, column, `, ${mark('top', topRow, column)}, ${mark('diag', topRow, includeColumn)}`)}`,
    ),
  );
  writeStart(
    no,
    `const ${firstDependency} = ${top};\n${read(no.assignment.right, 'exclude dependency', firstDependency, 'top', topRow, column)}`,
  );
  edits.push(replace(no.assignment.right, firstDependency));
  edits.push(
    at(
      no.statement,
      `\n${assignment(no, row, column, `, ${mark('top', topRow, column)}`)}`,
    ),
  );

  const lastColumn = cap;
  edits.push(
    replace(
      result.argument!,
      `trace.returnValue(${table}[${a}.length][${lastColumn}], ${span(result)})`,
    ),
  );
  return applySourceEdits(source, edits);
}

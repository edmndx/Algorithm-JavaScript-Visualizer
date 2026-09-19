import type {
  AnyNode,
  Expression,
  Identifier,
  Statement,
  VariableDeclarator,
} from 'acorn';
import {
  isNamed as named,
  isLiteralValue as literal,
  isNamedMember as member,
} from '../matchers';
import {
  beforeNode as before,
  afterNode as at,
  replaceNode as replace,
  applySourceEdits,
  sourceSpan as location,
  type SourceEdit,
} from '../edits';
import { createIdentifierAllocator } from '../ast';
import { minusOne, allocation, write as matrixWrite } from './matrixMatchers';
import {
  parseMatrixProgram,
  matrixPosition as position,
  matrixMark as mark,
} from './matrixInstrumentationHelpers';
import { TRACE_LIMITS } from '../../protocol/traceSchemas';

const cell = (
  node: AnyNode | null | undefined,
  grid: string,
  row: string,
  column: string,
  rowBack = false,
  colBack = false,
): boolean =>
  node?.type === 'MemberExpression' &&
  !node.optional &&
  node.computed &&
  node.object.type === 'MemberExpression' &&
  !node.object.optional &&
  node.object.computed &&
  named(node.object.object, grid) &&
  (rowBack
    ? minusOne(node.object.property, row)
    : named(node.object.property, row)) &&
  (colBack ? minusOne(node.property, column) : named(node.property, column));
const finalCell = (
  node: AnyNode | null | undefined,
  grid: string,
  row: string,
  column: string,
): boolean =>
  node?.type === 'MemberExpression' &&
  !node.optional &&
  node.computed &&
  node.object.type === 'MemberExpression' &&
  !node.object.optional &&
  node.object.computed &&
  named(node.object.object, grid) &&
  member(node.object.property, row, 'length') &&
  member(node.property, column, 'length');

function declaration(
  node: AnyNode | undefined,
): (VariableDeclarator & { id: Identifier; init: Expression }) | null {
  if (node?.type !== 'VariableDeclaration' || node.declarations.length !== 1)
    return null;
  const entry = node.declarations[0];
  return entry?.id.type === 'Identifier' && entry.init
    ? (entry as VariableDeclarator & { id: Identifier; init: Expression })
    : null;
}

function loop(node: AnyNode | undefined, start: number, bound: string) {
  if (node?.type !== 'ForStatement') return null;
  const entry = declaration(node.init ?? undefined);
  if (
    !entry ||
    !literal(entry.init, start) ||
    node.test?.type !== 'BinaryExpression' ||
    node.test.operator !== '<=' ||
    !named(node.test.left, entry.id.name) ||
    !member(node.test.right, bound, 'length') ||
    node.update?.type !== 'UpdateExpression' ||
    node.update.operator !== '++' ||
    !named(node.update.argument, entry.id.name) ||
    node.body.type !== 'BlockStatement'
  )
    return null;
  return { name: entry.id.name, body: node.body.body };
}

function write(
  node: Statement | undefined,
  grid: string,
  row: string,
  col: string,
) {
  if (
    node?.type !== 'ExpressionStatement' ||
    node.expression.type !== 'AssignmentExpression' ||
    node.expression.operator !== '=' ||
    !cell(node.expression.left, grid, row, col)
  )
    return null;
  return node.expression;
}

export function instrumentLcsFrames(
  source: string,
  program = parseMatrixProgram(source),
): string | null {
  if (!program || program.body.length !== 4) return null;
  const [firstStatement, secondStatement, fn, answerStatement] = program.body;
  const first = declaration(firstStatement),
    second = declaration(secondStatement),
    answer = declaration(answerStatement);
  if (
    !first ||
    !second ||
    !answer ||
    first.init.type !== 'Literal' ||
    typeof first.init.value !== 'string' ||
    second.init.type !== 'Literal' ||
    typeof second.init.value !== 'string' ||
    fn?.type !== 'FunctionDeclaration' ||
    !fn.id ||
    fn.async ||
    fn.generator ||
    fn.params.length !== 2 ||
    fn.params.some((param) => param.type !== 'Identifier') ||
    answer.init.type !== 'CallExpression' ||
    !named(answer.init.callee, fn.id.name) ||
    answer.init.arguments.length !== 2 ||
    !named(answer.init.arguments[0], first.id.name) ||
    !named(answer.init.arguments[1], second.id.name)
  )
    return null;
  const a = (fn.params[0] as Identifier).name,
    b = (fn.params[1] as Identifier).name;
  if (
    new Set([first.id.name, second.id.name, answer.id.name, fn.id.name, a, b])
      .size !== 6 ||
    first.init.value.length + 1 > TRACE_LIMITS.matrixRows ||
    second.init.value.length + 1 > TRACE_LIMITS.matrixColumns ||
    (first.init.value.length + 1) * (second.init.value.length + 1) >
      TRACE_LIMITS.matrixCells
  )
    return null;
  const [gridStatement, baseRow, baseColumn, outerStatement, result] =
    fn.body.body;
  const gridEntry = declaration(gridStatement);
  if (
    fn.body.body.length !== 5 ||
    !gridEntry ||
    !allocation(gridEntry.init, a, b, true) ||
    baseRow?.type !== 'ForStatement' ||
    baseColumn?.type !== 'ForStatement' ||
    outerStatement?.type !== 'ForStatement' ||
    result?.type !== 'ReturnStatement'
  )
    return null;
  const grid = gridEntry.id.name;
  const rowBase = loop(baseRow, 0, a),
    columnBase = loop(baseColumn, 0, b);
  const outer = loop(outerStatement, 1, a);
  if (
    !rowBase ||
    !columnBase ||
    !outer ||
    outer.body.length !== 1 ||
    new Set([grid, rowBase.name, columnBase.name, a, b]).size !== 5 ||
    outer.name !== rowBase.name
  )
    return null;
  const innerStatement = outer.body[0];
  const inner = loop(innerStatement, 1, b);
  if (
    !inner ||
    inner.body.length !== 1 ||
    inner.name !== columnBase.name ||
    rowBase.body.length !== 1 ||
    columnBase.body.length !== 1
  )
    return null;
  const rowWrite = matrixWrite(
    rowBase.body[0],
    grid,
    (node) => named(node, rowBase.name),
    (node) => literal(node, 0),
  );
  const columnWrite = matrixWrite(
    columnBase.body[0],
    grid,
    (node) => literal(node, 0),
    (node) => named(node, columnBase.name),
  );
  if (
    !rowWrite ||
    !columnWrite ||
    !literal(rowWrite.assignment.right, 0) ||
    !literal(columnWrite.assignment.right, 0)
  )
    return null;
  const branch = inner.body[0];
  if (
    branch?.type !== 'IfStatement' ||
    branch.test.type !== 'BinaryExpression' ||
    branch.test.operator !== '===' ||
    branch.consequent.type !== 'BlockStatement' ||
    branch.alternate?.type !== 'BlockStatement' ||
    branch.consequent.body.length !== 1 ||
    branch.alternate.body.length !== 1
  )
    return null;
  const i = outer.name,
    j = inner.name;
  const char = (node: AnyNode, text: string, offset: string) =>
    node.type === 'MemberExpression' &&
    node.computed &&
    named(node.object, text) &&
    minusOne(node.property, offset);
  if (!char(branch.test.left, a, i) || !char(branch.test.right, b, j))
    return null;
  const matchWrite = write(branch.consequent.body[0], grid, i, j);
  const mismatchWrite = write(branch.alternate.body[0], grid, i, j);
  if (
    !matchWrite ||
    !mismatchWrite ||
    matchWrite.right.type !== 'BinaryExpression' ||
    matchWrite.right.operator !== '+' ||
    !cell(matchWrite.right.left, grid, i, j, true, true) ||
    !literal(matchWrite.right.right, 1) ||
    mismatchWrite.right.type !== 'CallExpression' ||
    !member(mismatchWrite.right.callee, 'Math', 'max') ||
    mismatchWrite.right.arguments.length !== 2 ||
    !cell(mismatchWrite.right.arguments[0], grid, i, j, true, false) ||
    !cell(mismatchWrite.right.arguments[1], grid, i, j, false, true) ||
    !finalCell(result.argument, grid, a, b)
  )
    return null;
  // Reject bindings that shadow the built-ins used by the recurrence.
  if (
    ['Array', 'Math'].some((name) =>
      [
        first.id.name,
        second.id.name,
        answer.id.name,
        fn.id.name,
        a,
        b,
        grid,
        i,
        j,
        rowBase.name,
        columnBase.name,
      ].includes(name),
    )
  )
    return null;
  const assignmentFrame = (
    node: Statement,
    row: string,
    column: string,
    beforeValue: string,
    value: string,
    extra = '',
  ) =>
    `\ntrace.frame({ source: ${location(node)}, operation: { type: 'assign', target: ${JSON.stringify(grid)} + '[' + ${row} + '][' + ${column} + ']', before: ${beforeValue}, value: ${value} }, commands: [{ type: 'matrix.set', position: ${position(row, column)}, value: ${value} }, { type: 'matrix.visit', position: ${position(row, column)} }, ${mark('cur', row, column)}${extra}] });`;
  const allocate = createIdentifierAllocator(program, '__trace_lcs_');
  const old = allocate();
  const diagonal = allocate();
  const edits: SourceEdit[] = [
    at(
      gridStatement!,
      `\ntrace.initialize({ type: 'scene.init', structure: 'matrix' }, { type: 'matrix.create', values: ${grid}, rowLabels: ['', ...${a}.split('')], columnLabels: ['', ...${b}.split('')] });`,
    ),
    before(rowBase.body[0]!, `const ${old} = ${grid}[${rowBase.name}][0];\n`),
    at(
      rowBase.body[0]!,
      assignmentFrame(rowBase.body[0]!, rowBase.name, '0', old, '0'),
    ),
    before(
      columnBase.body[0]!,
      `const ${old} = ${grid}[0][${columnBase.name}];\n`,
    ),
    at(
      columnBase.body[0]!,
      assignmentFrame(columnBase.body[0]!, '0', columnBase.name, old, '0'),
    ),
    replace(
      branch.test,
      `trace.compareScalar(${a}[${i} - 1], ${b}[${j} - 1], 'eq', ${location(branch.test)}, ${JSON.stringify(a + '[i-1]')}, ${JSON.stringify(b + '[j-1]')}, [${mark('cur', i, j)}])`,
    ),
    before(
      branch.consequent.body[0]!,
      `const ${diagonal} = ${grid}[${i} - 1][${j} - 1];\ntrace.frame({ source: ${location(matchWrite.right.left)}, operation: { type: 'read', operand: { label: 'diagonal dependency', value: ${diagonal} } }, commands: [${mark('cur', i, j)}, ${mark('diag', `${i} - 1`, `${j} - 1`)}] });\nconst ${old} = ${grid}[${i}][${j}];\n`,
    ),
    replace(matchWrite.right, `${diagonal} + 1`),
    at(
      branch.consequent.body[0]!,
      assignmentFrame(
        branch.consequent.body[0]!,
        i,
        j,
        old,
        `${grid}[${i}][${j}]`,
        `, ${mark('diag', `${i} - 1`, `${j} - 1`)}`,
      ),
    ),
    before(
      branch.alternate.body[0]!,
      `trace.compareScalar(${grid}[${i} - 1][${j}], ${grid}[${i}][${j} - 1], 'gte', ${location(mismatchWrite.right)}, 'top', 'left', [${mark('cur', i, j)}, ${mark('top', `${i} - 1`, j)}, ${mark('left', i, `${j} - 1`)}]);\nconst ${old} = ${grid}[${i}][${j}];\n`,
    ),
    at(
      branch.alternate.body[0]!,
      assignmentFrame(
        branch.alternate.body[0]!,
        i,
        j,
        old,
        `${grid}[${i}][${j}]`,
        `, ${mark('top', `${i} - 1`, j)}, ${mark('left', i, `${j} - 1`)}`,
      ),
    ),
    replace(
      result.argument!,
      `trace.returnValue(${grid}[${a}.length][${b}.length], ${location(result)})`,
    ),
  ];
  return applySourceEdits(source, edits);
}

import type { AnyNode } from 'acorn';
import { createIdentifierAllocator, parseJavaScript } from '../ast';
import { parseMatrixProgram } from './matrixInstrumentationHelpers';
import { sameStructure } from './matrixMatchers';
import {
  applySourceEdits,
  sourceSpan as span,
  type SourceEdit,
  replaceNode as edit,
} from '../edits';

export const N_QUEENS_STARTER_SOURCE = `const board = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
function canPlace(row, col) {
  for (let prior = 0; prior < col; prior++) {
    for (let other = 0; other < board.length; other++) {
      if (board[other][prior] === 1 && (other === row || Math.abs(other - row) === col - prior)) return false;
    }
  }
  return true;
}
function solve(col) {
  if (col === board.length) return true;
  for (let row = 0; row < board.length; row++) {
    if (!canPlace(row, col)) continue;
    board[row][col] = 1;
    if (solve(col + 1)) return true;
    board[row][col] = 0;
  }
  return false;
}
const answer = solve(0);`;

const grammar = parseJavaScript(N_QUEENS_STARTER_SOURCE);

export function instrumentNQueensFrames(
  source: string,
  program = parseMatrixProgram(source),
): string | null {
  if (program === null || grammar === null || program.body.length !== 4)
    return null;
  const first = program.body[0];
  if (
    first?.type !== 'VariableDeclaration' ||
    first.kind !== 'const' ||
    first.declarations.length !== 1 ||
    first.declarations[0]?.id.type !== 'Identifier' ||
    !zeroBoard(first.declarations[0].init)
  )
    return null;
  const board = first.declarations[0].id.name;
  const names = new Map<string, string>([['board', board]]);
  const used = new Set([board]);
  for (let index = 1; index < 4; index++) {
    if (!sameStructure(program.body[index], grammar.body[index], names, used))
      return null;
  }
  if (
    [...used].some((name) => ['Math', 'abs', 'length', 'trace'].includes(name))
  )
    return null;

  const helper = program.body[1];
  const solver = program.body[2];
  if (
    helper?.type !== 'FunctionDeclaration' ||
    solver?.type !== 'FunctionDeclaration'
  )
    return null;
  const checkLoop = helper.body.body[0];
  const witnessLoop =
    checkLoop?.type === 'ForStatement' &&
    checkLoop.body.type === 'BlockStatement'
      ? checkLoop.body.body[0]
      : null;
  const conflict =
    witnessLoop?.type === 'ForStatement' &&
    witnessLoop.body.type === 'BlockStatement'
      ? witnessLoop.body.body[0]
      : null;
  const candidateLoop = solver.body.body[1];
  if (
    conflict?.type !== 'IfStatement' ||
    conflict.test.type !== 'LogicalExpression' ||
    conflict.consequent.type !== 'ReturnStatement' ||
    candidateLoop?.type !== 'ForStatement' ||
    candidateLoop.body.type !== 'BlockStatement'
  )
    return null;
  const [candidate, place, recurse, undo] = candidateLoop.body.body;
  const base = solver.body.body[0];
  const failure = solver.body.body[2];
  const helperSuccess = helper.body.body[1];
  if (
    candidate?.type !== 'IfStatement' ||
    candidate.consequent.type !== 'ContinueStatement' ||
    candidate.test.type !== 'UnaryExpression' ||
    candidate.test.argument.type !== 'CallExpression' ||
    place?.type !== 'ExpressionStatement' ||
    recurse?.type !== 'IfStatement' ||
    recurse.consequent.type !== 'ReturnStatement' ||
    undo?.type !== 'ExpressionStatement' ||
    base?.type !== 'IfStatement' ||
    base.consequent.type !== 'ReturnStatement' ||
    failure?.type !== 'ReturnStatement' ||
    helperSuccess?.type !== 'ReturnStatement'
  )
    return null;

  const row = names.get('row')!;
  const col = names.get('col')!;
  const prior = names.get('prior')!;
  const other = names.get('other')!;
  const canPlace = names.get('canPlace')!;
  const solve = names.get('solve')!;
  const allocate = createIdentifierAllocator(program, '__nq');
  const safe = allocate();
  const beforePlace = allocate();
  const beforeUndo = allocate();
  const position = `{ row: ${row}, column: ${col} }`;

  const insert = (offset: number, text: string): SourceEdit => ({
    start: offset,
    end: offset,
    text,
  });
  const returnFact = (node: AnyNode, value: boolean) =>
    `trace.returnValue(${value}, ${span(node)}, 'branch result')`;
  const assignment = (node: AnyNode, old: string) =>
    `trace.frame({ source: ${span(node)}, operation: { type: 'assign', target: ${JSON.stringify(board)} + '[' + ${row} + '][' + ${col} + ']', before: ${old}, value: ${board}[${row}][${col}] }, commands: [{ type: 'matrix.set', position: ${position}, value: ${board}[${row}][${col}] }, { type: 'matrix.mark', marker: 'cur', positions: [${position}] }] });`;
  const edits: SourceEdit[] = [
    insert(
      first.end,
      `\ntrace.initialize({ type: 'scene.init', structure: 'matrix' }, { type: 'matrix.create', values: ${board} });`,
    ),
    edit(
      conflict.consequent,
      `{ trace.compareScalar(${board}[${other}][${prior}], 1, 'eq', ${span(conflict.test.left)}, ${JSON.stringify(board + '[other][prior]')}, '1', [{ type: 'matrix.compare', positions: [${position}, { row: ${other}, column: ${prior} }] }, { type: 'matrix.mark', marker: 'try', positions: [${position}] }]); return ${returnFact(conflict.consequent, false)}; }`,
    ),
    edit(helperSuccess.argument!, returnFact(helperSuccess, true)),
    edit(
      candidate,
      `trace.frame({ source: ${span(candidate.test.argument)}, operation: { type: 'call', callee: ${JSON.stringify(canPlace)}, from: String(${col}), target: '(' + ${row} + ',' + ${col} + ')' }, commands: [{ type: 'matrix.mark', marker: 'try', positions: [${position}] }] }); const ${safe} = ${canPlace}(${row}, ${col}); if (!trace.compareScalar(${safe}, true, 'eq', ${span(candidate.test)}, 'candidate safe', 'true', ${safe} ? [{ type: 'matrix.mark', marker: 'try', positions: [${position}] }] : [])) { trace.frame({ source: ${span(candidate.consequent)}, operation: { type: 'control', action: 'continue', target: ${span(candidateLoop)} }, commands: [] }); continue; }`,
    ),
    insert(place.start, `const ${beforePlace} = ${board}[${row}][${col}];\n`),
    insert(place.end, `\n${assignment(place, beforePlace)}`),
    edit(
      recurse.test,
      `(trace.frame({ source: ${span(recurse.test)}, operation: { type: 'call', callee: ${JSON.stringify(solve)}, from: String(${col}), target: String(${col} + 1) }, commands: [] }), ${solve}(${col} + 1))`,
    ),
    edit(recurse.consequent.argument!, returnFact(recurse.consequent, true)),
    insert(undo.start, `const ${beforeUndo} = ${board}[${row}][${col}];\n`),
    insert(undo.end, `\n${assignment(undo, beforeUndo)}`),
    edit(base.consequent.argument!, returnFact(base.consequent, true)),
    edit(failure.argument!, returnFact(failure, false)),
  ];
  return applySourceEdits(source, edits);
}

function zeroBoard(node: AnyNode | null | undefined): boolean {
  if (
    node?.type !== 'ArrayExpression' ||
    node.elements.length < 1 ||
    node.elements.length > 8
  )
    return false;
  const size = node.elements.length;
  return node.elements.every(
    (row) =>
      row?.type === 'ArrayExpression' &&
      row.elements.length === size &&
      row.elements.every(
        (value) => value?.type === 'Literal' && value.value === 0,
      ),
  );
}

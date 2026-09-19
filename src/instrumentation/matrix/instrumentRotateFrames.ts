import {
  afterNode,
  beforeNode,
  replaceNode,
  frameCall as matrixFrame,
  applySourceEdits,
  sourceSpan,
  type SourceEdit,
} from '../edits';
import { createIdentifierAllocator, parseJavaScript, walkAst } from '../ast';
import { matrixCellSyntax } from './matrixMatchers';
import { matchStaticMatrix } from './staticMatrix';
import {
  matrixMark,
  matrixPosition,
  parseMatrixProgram,
} from './matrixInstrumentationHelpers';

export const ROTATE_STARTER_SOURCE = `const grid = [[1,2,3],[4,5,6],[7,8,9]];
function rotate(matrix) {
  for (let row = 0; row < matrix.length; row++) {
    for (let column = row + 1; column < matrix.length; column++) {
      const saved = matrix[row][column];
      matrix[row][column] = matrix[column][row];
      matrix[column][row] = saved;
    }
  }
  for (let row = 0; row < matrix.length; row++) {
    for (let left = 0, right = matrix.length - 1; left < right; left++, right--) {
      const saved = matrix[row][left];
      matrix[row][left] = matrix[row][right];
      matrix[row][right] = saved;
    }
  }
  return matrix;
}
const answer = rotate(grid);`;

const grammar = parseJavaScript(ROTATE_STARTER_SOURCE);

export function instrumentRotateFrames(
  source: string,
  program = parseMatrixProgram(source),
): string | null {
  const found = matchStaticMatrix(program, grammar);
  if (!found || !program || found.matrix.init.type !== 'ArrayExpression')
    return null;
  const size = found.matrix.init.elements.length;
  if (
    !found.matrix.init.elements.every(
      (row) => row?.type === 'ArrayExpression' && row.elements.length === size,
    )
  )
    return null;
  const allocate = createIdentifierAllocator(program, '__trace_rotate_');
  const edits: SourceEdit[] = [
    afterNode(
      found.matrix.statement,
      `\ntrace.initialize({ type: 'scene.init', structure: 'matrix' }, { type: 'matrix.create', values: ${found.matrix.name} });`,
    ),
  ];
  walkAst(program, (node) => {
    if (node.type === 'VariableDeclaration') {
      const entry = node.declarations[0];
      const cell = matrixCellSyntax(entry?.init);
      if (cell && entry?.id.type === 'Identifier') {
        const row = source.slice(cell.cell.row.start, cell.cell.row.end);
        const column = source.slice(
          cell.cell.column.start,
          cell.cell.column.end,
        );
        edits.push(
          afterNode(
            node,
            `\n${matrixFrame(cell.read, `{ type: 'read', operand: { label: 'saved cell', value: ${entry.id.name} } }`, matrixMark('cur', row, column))}`,
          ),
        );
      }
    }
    if (
      node.type === 'ExpressionStatement' &&
      node.expression.type === 'AssignmentExpression'
    ) {
      const cell = matrixCellSyntax(node.expression.left);
      if (!cell) return;
      const old = allocate();
      const target = source.slice(cell.read.start, cell.read.end);
      const row = source.slice(cell.cell.row.start, cell.cell.row.end);
      const column = source.slice(cell.cell.column.start, cell.cell.column.end);
      edits.push(beforeNode(node, `const ${old} = ${target};\n`));
      edits.push(
        afterNode(
          node,
          `\n${matrixFrame(
            node,
            `{ type: 'assign', target: ${JSON.stringify(cell.root.name)} + '[' + ${row} + '][' + ${column} + ']', before: ${old}, value: ${target} }`,
            `{ type: 'matrix.set', position: ${matrixPosition(row, column)}, value: ${target} }, { type: 'matrix.visit', position: ${matrixPosition(row, column)} }, ${matrixMark('cur', row, column)}`,
          )}`,
        ),
      );
    }
    if (node.type === 'ReturnStatement' && node.argument) {
      edits.push(
        replaceNode(
          node.argument,
          `trace.returnValue(${source.slice(node.argument.start, node.argument.end)}, ${sourceSpan(node)})`,
        ),
      );
    }
  });
  return applySourceEdits(source, edits);
}

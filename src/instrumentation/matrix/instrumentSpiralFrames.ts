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

export const SPIRAL_STARTER_SOURCE = `const grid = [[1,2,3,4],[5,6,7,8],[9,10,11,12]];
function spiral(matrix) {
  const result = [];
  let top = 0;
  let bottom = matrix.length - 1;
  let left = 0;
  let right = matrix[0].length - 1;
  while (top <= bottom && left <= right) {
    for (let column = left; column <= right; column++) {
      result.push(matrix[top][column]);
    }
    top++;
    for (let row = top; row <= bottom; row++) {
      result.push(matrix[row][right]);
    }
    right--;
    if (top <= bottom) {
      for (let column = right; column >= left; column--) {
        result.push(matrix[bottom][column]);
      }
      bottom--;
    }
    if (left <= right) {
      for (let row = bottom; row >= top; row--) {
        result.push(matrix[row][left]);
      }
      left++;
    }
  }
  return result;
}
const answer = spiral(grid);`;

const grammar = parseJavaScript(SPIRAL_STARTER_SOURCE);

export function instrumentSpiralFrames(
  source: string,
  program = parseMatrixProgram(source),
): string | null {
  const found = matchStaticMatrix(program, grammar);
  if (!found || !program) return null;
  const allocate = createIdentifierAllocator(program, '__trace_spiral_');
  const value = allocate();
  const edits: SourceEdit[] = [
    afterNode(
      found.matrix.statement,
      `\ntrace.initialize({ type: 'scene.init', structure: 'matrix' }, { type: 'matrix.create', values: ${found.matrix.name} });`,
    ),
  ];
  walkAst(program, (node) => {
    if (
      node.type === 'ExpressionStatement' &&
      node.expression.type === 'CallExpression'
    ) {
      const argument = node.expression.arguments[0];
      const cell = matrixCellSyntax(argument);
      if (!cell) return;
      const row = source.slice(cell.cell.row.start, cell.cell.row.end);
      const column = source.slice(cell.cell.column.start, cell.cell.column.end);
      edits.push(
        beforeNode(
          node,
          `const ${value} = ${source.slice(cell.read.start, cell.read.end)};\n${matrixFrame(
            cell.read,
            `{ type: 'read', operand: { label: 'matrix cell', value: ${value} } }`,
            matrixMark('cur', row, column),
          )}\n`,
        ),
      );
      edits.push(replaceNode(cell.read, value));
      edits.push(
        afterNode(
          node,
          `\n${matrixFrame(
            node,
            `{ type: 'collection', action: 'append', role: 'traversal', item: ${value} }`,
            `{ type: 'matrix.visit', position: ${matrixPosition(row, column)} }, ${matrixMark('cur', row, column)}`,
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

import type { Program } from 'acorn';
import type { MatrixMarker } from '../../protocol';
import { hasUnsafeInstrumentationSyntax, parseJavaScript } from '../ast';

export function parseMatrixProgram(source: string): Program | null {
  const program = parseJavaScript(source);
  return program && !hasUnsafeInstrumentationSyntax(program) ? program : null;
}

export const matrixPosition = (row: string, column: string): string =>
  `{ row: ${row}, column: ${column} }`;

export const matrixMark = (
  role: MatrixMarker,
  row: string,
  column: string,
): string =>
  `{ type: 'matrix.mark', marker: '${role}', positions: [${matrixPosition(row, column)}] }`;

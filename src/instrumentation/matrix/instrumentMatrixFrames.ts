import { instrumentFloodFillFrames } from './instrumentFloodFillFrames';
import { instrumentLcsFrames } from './instrumentLcsFrames';
import { instrumentKnapsackFrames } from './instrumentKnapsackFrames';
import { instrumentEditDistanceFrames } from './instrumentEditDistanceFrames';
import { instrumentNQueensFrames } from './instrumentNQueensFrames';
import { instrumentSpiralFrames } from './instrumentSpiralFrames';
import { instrumentRotateFrames } from './instrumentRotateFrames';
import { hasUnsafeInstrumentationSyntax, parseJavaScript } from '../ast';

const matrixInstrumenters = [
  instrumentFloodFillFrames,
  instrumentLcsFrames,
  instrumentKnapsackFrames,
  instrumentEditDistanceFrames,
  instrumentNQueensFrames,
  instrumentSpiralFrames,
  instrumentRotateFrames,
];

export function instrumentMatrixFrames(
  source: string,
  program = parseJavaScript(source),
): string | null {
  if (program === null || hasUnsafeInstrumentationSyntax(program)) return null;
  for (const instrument of matrixInstrumenters) {
    const result = instrument(source, program);
    if (result !== null) return result;
  }
  return null;
}

import { instrumentArrayFrames } from './instrumentArrayFrames';
import type { TraceStructure } from '../protocol/traceTypes';
import { parseJavaScript } from './ast';

export function instrumentSource(
  source: string,
  structure: TraceStructure,
): string | null {
  const program = parseJavaScript(source);
  if (program === null || structure !== 'array') return null;
  return instrumentArrayFrames(source, program);
}

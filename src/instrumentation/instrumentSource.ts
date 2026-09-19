import { instrumentArrayFrames } from './instrumentArrayFrames';
import { instrumentKadaneFrames } from './instrumentKadaneFrames';
import { instrumentBreadthFirstFrames } from './graph/instrumentBreadthFirstFrames';
import { instrumentDepthFirstFrames } from './graph/instrumentDepthFirstFrames';
import { instrumentTopologicalFrames } from './graph/instrumentTopologicalFrames';
import { instrumentDijkstraFrames } from './graph/instrumentDijkstraFrames';
import { instrumentSlidingWindowFrames } from './instrumentSlidingWindowFrames';
import { instrumentMajorityFrames } from './instrumentMajorityFrames';
import { instrumentMergeSortFrames } from './instrumentMergeSortFrames';
import { instrumentLisFrames } from './instrumentLisFrames';
import { instrumentSubsetFrames } from './instrumentSubsetFrames';
import { instrumentQuickSortFrames } from './instrumentQuickSortFrames';
import { instrumentMatrixFrames } from './matrix/instrumentMatrixFrames';
import { instrumentInorderFrames } from './tree/instrumentInorderFrames';
import { instrumentLcaFrames } from './tree/instrumentLcaFrames';
import { instrumentCycleFrames } from './linkedList/instrumentCycleFrames';
import type { Program } from 'acorn';
import type { TraceStructure } from '../protocol/traceTypes';
import { parseJavaScript } from './ast';

const instrumenters = {
  array: [
    instrumentArrayFrames,
    instrumentSlidingWindowFrames,
    instrumentKadaneFrames,
    instrumentMajorityFrames,
    instrumentMergeSortFrames,
    instrumentLisFrames,
    instrumentSubsetFrames,
    instrumentQuickSortFrames,
  ],
  matrix: [instrumentMatrixFrames],
  tree: [instrumentInorderFrames, instrumentLcaFrames],
  'linked-list': [instrumentCycleFrames],
  graph: [
    instrumentBreadthFirstFrames,
    instrumentDepthFirstFrames,
    instrumentTopologicalFrames,
    instrumentDijkstraFrames,
  ],
} satisfies Record<
  TraceStructure,
  readonly ((source: string, program: Program) => string | null)[]
>;

export function instrumentSource(
  source: string,
  structure: TraceStructure,
): string | null {
  const program = parseJavaScript(source);
  if (program === null) return null;
  for (const instrument of instrumenters[structure]) {
    const instrumented = instrument(source, program);
    if (instrumented !== null) return instrumented;
  }
  return null;
}

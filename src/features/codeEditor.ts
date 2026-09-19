import type { TraceStructure } from '../protocol/traceTypes';

export type RunnableSource = {
  readonly code: string;
  readonly revision: number;
  readonly structure: TraceStructure | null;
};

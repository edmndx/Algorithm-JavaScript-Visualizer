import type { InstrumentableStructure } from '../instrumentation/instrumentationTypes';

export type RunnableSource = {
  readonly code: string;
  readonly revision: number;
  readonly structure: InstrumentableStructure | null;
};

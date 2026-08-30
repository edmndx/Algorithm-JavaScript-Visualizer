import { z } from 'zod';

export const instrumentableStructureSchema = z.enum([
  'array',
  'matrix',
  'stack',
  'queue',
  'graph',
  'tree',
  'linked-list',
  'hash-table',
]);

export type InstrumentableStructure = z.infer<
  typeof instrumentableStructureSchema
>;

export type InstrumentationStatus = 'instrumented' | 'unsupported';

export type InstrumentationResult = {
  readonly status: InstrumentationStatus;
  readonly source: string;
};

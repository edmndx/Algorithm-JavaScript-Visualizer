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

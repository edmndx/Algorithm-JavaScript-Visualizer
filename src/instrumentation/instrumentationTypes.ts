import { z } from 'zod';

import type { SourceContractDiagnostic } from './sourceContract';

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

export type InstrumentationStatus =
  'instrumented' | 'unsupported' | 'source-contract-error';

export type InstrumentationResult =
  | {
      readonly status: Exclude<InstrumentationStatus, 'source-contract-error'>;
      readonly source: string;
    }
  | {
      readonly status: 'source-contract-error';
      readonly source: string;
      readonly diagnostic: SourceContractDiagnostic;
    };

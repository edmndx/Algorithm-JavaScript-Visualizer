import type { InstrumentableStructure } from '../instrumentation/instrumentationTypes';
import type { SourceContractDiagnostic } from '../instrumentation/sourceContract';
import type { RunnerResult } from '../runner/runner';

export type SandboxExecutionStatus =
  'instrumented' | 'unsupported' | 'untraced';

export type SandboxRunResult =
  | {
      readonly status: SandboxExecutionStatus;
      readonly result: Extract<RunnerResult, { readonly ok: true }>;
    }
  | {
      readonly status: 'execution-failure';
      readonly result: Extract<RunnerResult, { readonly ok: false }>;
    }
  | {
      readonly status: 'source-contract-error';
      readonly diagnostic: SourceContractDiagnostic;
    };

export type SandboxWorkerApi = {
  run(
    source: string,
    structure: InstrumentableStructure | null,
  ): Promise<SandboxRunResult>;
};

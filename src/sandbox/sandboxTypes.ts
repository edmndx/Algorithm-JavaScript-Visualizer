import type { TraceStructure } from '../protocol/traceTypes';
import type { FrameRunnerResult, RunnerResult } from '../runner/runner';

export type SandboxExecutionStatus = 'unsupported' | 'untraced';

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
      readonly status: 'frame-instrumented';
      readonly result: Extract<FrameRunnerResult, { readonly ok: true }>;
    }
  | {
      readonly status: 'frame-execution-failure';
      readonly result: Extract<FrameRunnerResult, { readonly ok: false }>;
    };

export type SandboxWorkerApi = {
  run(
    source: string,
    structure: TraceStructure | null,
  ): Promise<SandboxRunResult>;
};

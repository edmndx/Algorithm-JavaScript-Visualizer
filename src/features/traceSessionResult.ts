import type { PlaybackController } from '../playback';
import type { SourceContractDiagnostic } from '../instrumentation/sourceContract';
import type { RunnerError } from '../runner/runner';
import type { SandboxErrorKind, SandboxRunResult } from '../sandbox';
import type { TraceStructure } from '../protocol';

const UNSUPPORTED_TRACE_MESSAGE =
  'Semantic trace unavailable: this code pattern is not supported by automatic instrumentation.';
const UNTRACED_SOURCE_MESSAGE =
  'Semantic trace unavailable: this source has no instrumentable structure.';

export type TraceSessionDiagnostic =
  | {
      readonly kind: 'sandbox';
      readonly code: SandboxErrorKind;
      readonly message: string;
    }
  | {
      readonly kind: 'source-contract';
      readonly code: SourceContractDiagnostic['code'];
      readonly message: string;
    }
  | {
      readonly kind: 'execution';
      readonly code: RunnerError['code'];
      readonly message: string;
    }
  | {
      readonly kind:
        'unsupported' | 'untraced' | 'trace-validation' | 'cancelled';
      readonly message: string;
    }
  | {
      readonly kind: 'trace-file';
      readonly code: 'READ_FAILED' | 'INVALID_JSON' | 'INVALID_TRACE';
      readonly message: string;
    };

type SandboxCommitResult =
  | { readonly ok: true; readonly structure: TraceStructure }
  | { readonly ok: false; readonly diagnostic: TraceSessionDiagnostic };

export function commitSandboxResult(
  result: SandboxRunResult,
  loadPlayback: PlaybackController['load'],
): SandboxCommitResult {
  switch (result.status) {
    case 'source-contract-error':
      return {
        ok: false,
        diagnostic: {
          kind: 'source-contract',
          code: result.diagnostic.code,
          message: result.diagnostic.message,
        },
      };
    case 'execution-failure':
      return {
        ok: false,
        diagnostic: {
          kind: 'execution',
          code: result.result.error.code,
          message: result.result.error.message,
        },
      };
    case 'unsupported':
      return {
        ok: false,
        diagnostic: {
          kind: 'unsupported',
          message: UNSUPPORTED_TRACE_MESSAGE,
        },
      };
    case 'untraced':
      return {
        ok: false,
        diagnostic: { kind: 'untraced', message: UNTRACED_SOURCE_MESSAGE },
      };
    case 'instrumented': {
      const timeline = loadPlayback(result.result.commands);
      return timeline.ok
        ? { ok: true, structure: timeline.timeline.structure }
        : {
            ok: false,
            diagnostic: {
              kind: 'trace-validation',
              message: `Semantic trace validation failed: ${timeline.error.message}`,
            },
          };
    }
  }
}

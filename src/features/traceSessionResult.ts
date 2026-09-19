import type { SandboxRunResult } from '../sandbox';
import type { TraceStructure } from '../protocol';
import type { RunnableSource } from './codeEditor';
import type { FrameTimeline } from '../playback/frameTimeline';
import { buildFrameTimeline } from '../playback/frameTimeline';

const UNSUPPORTED_TRACE_MESSAGE =
  'Semantic trace unavailable: this code pattern is not supported by automatic instrumentation.';
const UNTRACED_SOURCE_MESSAGE =
  'Semantic trace unavailable: this source has no instrumentable structure.';

type SandboxTimelineResult =
  | { readonly ok: true; readonly timeline: FrameTimeline }
  | { readonly ok: false; readonly message: string };

export function buildSandboxTimeline(
  result: SandboxRunResult,
): SandboxTimelineResult {
  switch (result.status) {
    case 'execution-failure':
    case 'frame-execution-failure':
      return {
        ok: false,
        message: result.result.error.message,
      };
    case 'unsupported':
      return {
        ok: false,
        message: UNSUPPORTED_TRACE_MESSAGE,
      };
    case 'untraced':
      return {
        ok: false,
        message: UNTRACED_SOURCE_MESSAGE,
      };
    case 'frame-instrumented': {
      const built = buildFrameTimeline(result.result.trace);
      if (!built.ok)
        return {
          ok: false,
          message: `Semantic trace validation failed: ${built.message}`,
        };
      return built;
    }
  }
}

export type AcceptedTrace =
  | {
      readonly kind: 'catalog';
      readonly sourceCode: string;
      readonly sourceRevision: number;
      readonly structure: TraceStructure;
    }
  | {
      readonly kind: 'generated';
      readonly sourceRevision: number;
      readonly structure: TraceStructure;
    }
  | {
      readonly kind: 'imported';
      readonly structure: TraceStructure;
      readonly sourceCode: string;
      readonly sourceRevision: number;
    };

type ActiveTrace =
  | { readonly kind: 'none' | 'stale' }
  | {
      readonly kind: AcceptedTrace['kind'];
      readonly structure: TraceStructure;
    };

export function getActiveTrace(
  acceptedTrace: AcceptedTrace | null,
  activeSource: RunnableSource,
): ActiveTrace {
  if (acceptedTrace === null) return { kind: 'none' };
  const isCurrent =
    acceptedTrace.kind === 'catalog'
      ? activeSource.revision === acceptedTrace.sourceRevision ||
        (activeSource.structure === acceptedTrace.structure &&
          activeSource.code === acceptedTrace.sourceCode)
      : activeSource.revision === acceptedTrace.sourceRevision &&
        (acceptedTrace.kind !== 'imported' ||
          (activeSource.code === acceptedTrace.sourceCode &&
            activeSource.structure === acceptedTrace.structure));

  return isCurrent
    ? { kind: acceptedTrace.kind, structure: acceptedTrace.structure }
    : { kind: 'stale' };
}

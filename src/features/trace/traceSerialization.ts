import {
  buildFrameTimeline,
  type FrameTimeline,
} from '../../playback/frameTimeline';
import { FRAME_TRACE_BYTE_LIMIT } from '../../protocol/frameTrace';

type TraceFileError = {
  readonly code: 'INVALID_JSON' | 'INVALID_TRACE';
  readonly message: string;
};

type TraceFileParseResult =
  | {
      readonly ok: true;
      readonly timeline: FrameTimeline;
    }
  | {
      readonly ok: false;
      readonly error: TraceFileError;
    };

export function parseTraceFile(contents: string): TraceFileParseResult {
  if (new TextEncoder().encode(contents).length > FRAME_TRACE_BYTE_LIMIT)
    return {
      ok: false,
      error: {
        code: 'INVALID_TRACE',
        message: 'Trace file exceeds the byte limit.',
      },
    };

  let input: unknown;

  try {
    input = JSON.parse(contents);
  } catch {
    return {
      ok: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Trace file is not valid JSON.',
      },
    };
  }

  if (
    typeof input !== 'object' ||
    input === null ||
    !('version' in input) ||
    input.version !== '2'
  )
    return {
      ok: false,
      error: {
        code: 'INVALID_TRACE',
        message: 'Only version 2 source-bearing trace files can be imported.',
      },
    };

  const built = buildFrameTimeline(input);
  return built.ok
    ? { ok: true, timeline: built.timeline }
    : {
        ok: false,
        error: { code: 'INVALID_TRACE', message: built.message },
      };
}

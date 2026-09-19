import type { FrameTrace } from '../protocol/frameTrace';
import { createFrameTracer, FrameTracerError } from '../tracer/frameTracer';

const MAX_SOURCE_BYTES = 256_000;

type JavaScriptRunnerError = {
  readonly code: 'SYNTAX_ERROR' | 'RUNTIME_ERROR';
  readonly message: string;
  readonly name?: string;
};

export type RunnerError =
  | {
      readonly code: 'INVALID_ARGUMENT';
      readonly message: string;
    }
  | JavaScriptRunnerError
  | {
      readonly code: 'TRACER_ERROR';
      readonly tracerCode: FrameTracerError['code'];
      readonly message: string;
    }
  | {
      readonly code: 'SOURCE_LIMIT';
      readonly limit: typeof MAX_SOURCE_BYTES;
      readonly message: string;
    }
  | {
      readonly code: 'INTERNAL_ERROR';
      readonly message: string;
    };

export type RunnerResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: RunnerError;
    };

type RunnerSourceValidation =
  | {
      readonly ok: true;
      readonly source: string;
    }
  | {
      readonly ok: false;
      readonly result: Extract<RunnerResult, { readonly ok: false }>;
    };

type RunnerConsole = Readonly<Record<'log' | 'warn' | 'error', () => void>>;

const SILENT_CONSOLE: RunnerConsole = Object.freeze({
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});
const textEncoder = new TextEncoder();

export type FrameRunnerResult =
  | { readonly ok: true; readonly trace: FrameTrace }
  | { readonly ok: false; readonly error: RunnerError };

export async function runValidatedFrameCode(
  instrumented: string,
  original: string,
  structure: FrameTrace['source']['structure'],
): Promise<FrameRunnerResult> {
  const originalValidation = validateRunnerSource(original);
  if (!originalValidation.ok)
    return { ok: false, error: originalValidation.result.error };
  const instrumentedValidation = validateRunnerSource(instrumented);
  if (!instrumentedValidation.ok)
    return { ok: false, error: instrumentedValidation.result.error };

  let execute: ReturnType<typeof createExecutionFunction>;
  try {
    execute = createExecutionFunction(instrumented, true);
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof SyntaxError
          ? toJavaScriptError('SYNTAX_ERROR', error)
          : toInternalError(error),
    };
  }

  const tracer = createFrameTracer(original, structure);
  try {
    await execute(tracer);
    return { ok: true, trace: tracer.getTrace() };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof FrameTracerError
          ? {
              code: 'TRACER_ERROR',
              tracerCode: error.code,
              message: error.message,
            }
          : toJavaScriptError('RUNTIME_ERROR', error),
    };
  }
}

export function validateRunnerSource(source: unknown): RunnerSourceValidation {
  if (typeof source !== 'string') {
    return {
      ok: false,
      result: failure({
        code: 'INVALID_ARGUMENT',
        message: 'Runner source code must be a string.',
      }),
    };
  }

  if (textEncoder.encode(source).byteLength > MAX_SOURCE_BYTES) {
    return {
      ok: false,
      result: failure({
        code: 'SOURCE_LIMIT',
        limit: MAX_SOURCE_BYTES,
        message: `Runner source code exceeds the ${MAX_SOURCE_BYTES}-byte limit.`,
      }),
    };
  }

  return { ok: true, source };
}

export async function runValidatedCode(source: string): Promise<RunnerResult> {
  let execute: ReturnType<typeof createExecutionFunction>;
  try {
    execute = createExecutionFunction(source, false);
  } catch (error) {
    return failure(
      error instanceof SyntaxError
        ? toJavaScriptError('SYNTAX_ERROR', error)
        : toInternalError(error),
    );
  }
  try {
    await execute(null);
    return { ok: true };
  } catch (error) {
    return failure(toJavaScriptError('RUNTIME_ERROR', error));
  }
}

function createExecutionFunction(
  source: string,
  tracing: boolean,
): (trace: ReturnType<typeof createFrameTracer> | null) => Promise<unknown> {
  // Keep dynamic execution's untyped boundary isolated here.
  const dynamicFunction = tracing
    ? new Function(
        'trace',
        'console',
        `"use strict"; return (async function () {\n${source}\n})();`,
      )
    : new Function(
        'console',
        `"use strict"; return (async function () {\n${source}\n})();`,
      );

  return (trace) => {
    const result: unknown = tracing
      ? dynamicFunction(trace, SILENT_CONSOLE)
      : dynamicFunction(SILENT_CONSOLE);
    return Promise.resolve(result);
  };
}

function toJavaScriptError(
  code: 'SYNTAX_ERROR' | 'RUNTIME_ERROR',
  error: unknown,
): JavaScriptRunnerError {
  if (error instanceof Error) {
    return {
      code,
      name: error.name,
      message: error.message,
    };
  }

  return {
    code,
    message: safelyStringify(error),
  };
}

function toInternalError(
  error: unknown,
): Extract<RunnerError, { readonly code: 'INTERNAL_ERROR' }> {
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : safelyStringify(error),
  };
}

function safelyStringify(value: unknown): string {
  try {
    return String(value);
  } catch {
    return 'Unknown error.';
  }
}

function failure(
  error: RunnerError,
): Extract<RunnerResult, { readonly ok: false }> {
  return { ok: false, error };
}

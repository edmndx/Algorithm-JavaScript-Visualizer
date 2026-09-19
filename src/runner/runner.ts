import type { TraceCommand } from '../protocol/traceTypes';
import { createTracer, TracerError } from '../tracer/tracer';

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
      readonly tracerCode: TracerError['code'];
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
  | {
      readonly ok: true;
      readonly commands: readonly TraceCommand[];
    }
  | {
      readonly ok: false;
      readonly commands: readonly TraceCommand[];
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

type TraceApi = Omit<ReturnType<typeof createTracer>, 'getCommands'>;

type RunnerConsole = Readonly<Record<'log' | 'warn' | 'error', () => void>>;

type RunnerOptions = {
  readonly tracing: boolean;
};

const SILENT_CONSOLE: RunnerConsole = Object.freeze({
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});
const textEncoder = new TextEncoder();

export function validateRunnerSource(source: unknown): RunnerSourceValidation {
  if (typeof source !== 'string') {
    return {
      ok: false,
      result: failure([], {
        code: 'INVALID_ARGUMENT',
        message: 'Runner source code must be a string.',
      }),
    };
  }

  if (textEncoder.encode(source).byteLength > MAX_SOURCE_BYTES) {
    return {
      ok: false,
      result: failure([], {
        code: 'SOURCE_LIMIT',
        limit: MAX_SOURCE_BYTES,
        message: `Runner source code exceeds the ${MAX_SOURCE_BYTES}-byte limit.`,
      }),
    };
  }

  return { ok: true, source };
}

export async function runValidatedCode(
  source: string,
  options: RunnerOptions,
): Promise<RunnerResult> {
  try {
    return await executeSource(source, options);
  } catch (error) {
    return failure([], toInternalError(error));
  }
}

async function executeSource(
  source: string,
  options: RunnerOptions,
): Promise<RunnerResult> {
  let execute: (trace: TraceApi | null) => Promise<unknown>;

  try {
    execute = createExecutionFunction(source, options.tracing);
  } catch (error) {
    return failure(
      [],
      error instanceof SyntaxError
        ? toJavaScriptError('SYNTAX_ERROR', error)
        : toInternalError(error),
    );
  }

  const tracer = options.tracing ? createTracer() : null;
  const trace = tracer === null ? null : withoutGetCommands(tracer);
  let executionError: RunnerError | null = null;

  try {
    await execute(trace);
  } catch (error) {
    executionError =
      error instanceof TracerError
        ? {
            code: 'TRACER_ERROR',
            tracerCode: error.code,
            message: error.message,
          }
        : toJavaScriptError('RUNTIME_ERROR', error);
  }

  if (executionError !== null) {
    return failure(
      tracer === null ? [] : readPartialCommands(tracer.getCommands),
      executionError,
    );
  }

  if (tracer === null) {
    return {
      ok: true,
      commands: [],
    };
  }

  try {
    return {
      ok: true,
      commands: tracer.getCommands(),
    };
  } catch (error) {
    return failure(
      [],
      error instanceof TracerError
        ? {
            code: 'TRACER_ERROR',
            tracerCode: error.code,
            message: error.message,
          }
        : toInternalError(error),
    );
  }
}

function createExecutionFunction(
  source: string,
  tracing: boolean,
): (trace: TraceApi | null) => Promise<unknown> {
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

function withoutGetCommands(tracer: ReturnType<typeof createTracer>): TraceApi {
  const { getCommands: _getCommands, ...trace } = tracer;
  return trace;
}

function readPartialCommands(
  getCommands: () => readonly TraceCommand[],
): readonly TraceCommand[] {
  try {
    return getCommands();
  } catch (error) {
    if (!(error instanceof TracerError)) throw error;
    return [];
  }
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
  commands: readonly TraceCommand[],
  error: RunnerError,
): Extract<RunnerResult, { readonly ok: false }> {
  return {
    ok: false,
    commands,
    error,
  };
}

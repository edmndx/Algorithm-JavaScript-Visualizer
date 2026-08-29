import type { TraceCommand } from '../protocol/traceTypes';
import { createTracer, TracerError } from '../tracer/tracer';

export const RUNNER_LIMITS = {
  sourceBytes: 256_000,
  stdoutEntries: 1_000,
  stdoutBytes: 256_000,
} as const;

export type ConsoleEntry = {
  readonly sequence: number;
  readonly level: 'log' | 'warn' | 'error';
  readonly text: string;
};

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
      readonly limit: typeof RUNNER_LIMITS.sourceBytes;
      readonly message: string;
    }
  | {
      readonly code: 'OUTPUT_LIMIT';
      readonly limit: 'entries' | 'bytes';
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
      readonly stdout: readonly ConsoleEntry[];
    }
  | {
      readonly ok: false;
      readonly commands: readonly TraceCommand[];
      readonly stdout: readonly ConsoleEntry[];
      readonly error: RunnerError;
    };

export type RunnerSourceValidation =
  | {
      readonly ok: true;
      readonly source: string;
    }
  | {
      readonly ok: false;
      readonly result: Extract<RunnerResult, { readonly ok: false }>;
    };

type TraceApi = Omit<ReturnType<typeof createTracer>, 'getCommands'>;

type RunnerConsole = Readonly<
  Record<ConsoleEntry['level'], (...values: readonly unknown[]) => void>
>;

type ConsoleCapture = {
  readonly console: RunnerConsole;
  snapshot(): readonly ConsoleEntry[];
  getError(): Extract<RunnerError, { readonly code: 'OUTPUT_LIMIT' }> | null;
};

export type RunnerOptions = {
  readonly tracing: boolean;
};

const textEncoder = new TextEncoder();

export async function runCode(
  source: unknown,
  options: RunnerOptions,
): Promise<RunnerResult> {
  const validation = validateRunnerSource(source);
  if (!validation.ok) return validation.result;

  return runValidatedCode(validation.source, options);
}

export function validateRunnerSource(source: unknown): RunnerSourceValidation {
  if (typeof source !== 'string') {
    return {
      ok: false,
      result: failure([], [], {
        code: 'INVALID_ARGUMENT',
        message: 'Runner source code must be a string.',
      }),
    };
  }

  if (textEncoder.encode(source).byteLength > RUNNER_LIMITS.sourceBytes) {
    return {
      ok: false,
      result: failure([], [], {
        code: 'SOURCE_LIMIT',
        limit: RUNNER_LIMITS.sourceBytes,
        message: `Runner source code exceeds the ${RUNNER_LIMITS.sourceBytes}-byte limit.`,
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
    return failure([], [], toInternalError(error));
  }
}

async function executeSource(
  source: string,
  options: RunnerOptions,
): Promise<RunnerResult> {
  let execute: (
    trace: TraceApi | null,
    console: RunnerConsole,
  ) => Promise<unknown>;

  try {
    execute = createExecutionFunction(source, options.tracing);
  } catch (error) {
    return failure(
      [],
      [],
      error instanceof SyntaxError
        ? toJavaScriptError('SYNTAX_ERROR', error)
        : toInternalError(error),
    );
  }

  const tracer = options.tracing ? createTracer() : null;
  const trace = tracer === null ? null : withoutGetCommands(tracer);
  const capture = createConsoleCapture();
  let executionError: RunnerError | null = null;

  try {
    await execute(trace, capture.console);
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

  const runError = executionError ?? capture.getError();

  if (runError !== null) {
    return failure(
      tracer === null ? [] : readPartialCommands(tracer.getCommands),
      capture.snapshot(),
      runError,
    );
  }

  if (tracer === null) {
    return {
      ok: true,
      commands: [],
      stdout: capture.snapshot(),
    };
  }

  try {
    return {
      ok: true,
      commands: tracer.getCommands(),
      stdout: capture.snapshot(),
    };
  } catch (error) {
    return failure(
      [],
      capture.snapshot(),
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
): (trace: TraceApi | null, console: RunnerConsole) => Promise<unknown> {
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

  return (trace, console) => {
    const result: unknown = tracing
      ? dynamicFunction(trace, console)
      : dynamicFunction(console);
    return Promise.resolve(result);
  };
}

function withoutGetCommands(tracer: ReturnType<typeof createTracer>): TraceApi {
  const { getCommands: _getCommands, ...trace } = tracer;
  return trace;
}

function createConsoleCapture(): ConsoleCapture {
  const entries: ConsoleEntry[] = [];
  let byteLength = 0;
  let error: Extract<RunnerError, { readonly code: 'OUTPUT_LIMIT' }> | null =
    null;

  function write(level: ConsoleEntry['level'], values: readonly unknown[]) {
    if (error !== null) return;

    if (entries.length >= RUNNER_LIMITS.stdoutEntries) {
      error = {
        code: 'OUTPUT_LIMIT',
        limit: 'entries',
        message: `Console output exceeds the ${RUNNER_LIMITS.stdoutEntries}-entry limit.`,
      };
      return;
    }

    const text = values.map(formatConsoleValue).join(' ');
    const nextByteLength = byteLength + textEncoder.encode(text).byteLength;

    if (nextByteLength > RUNNER_LIMITS.stdoutBytes) {
      error = {
        code: 'OUTPUT_LIMIT',
        limit: 'bytes',
        message: `Console output exceeds the ${RUNNER_LIMITS.stdoutBytes}-byte limit.`,
      };
      return;
    }

    entries.push({ sequence: entries.length, level, text });
    byteLength = nextByteLength;
  }

  return {
    console: {
      log: (...values) => write('log', values),
      warn: (...values) => write('warn', values),
      error: (...values) => write('error', values),
    },
    snapshot: () => [...entries],
    getError: () => error,
  };
}

function formatConsoleValue(value: unknown): string {
  try {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return `${value.name}: ${value.message}`;

    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value) ?? String(value);
    }

    return String(value);
  } catch {
    return '[Unserializable value]';
  }
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
  stdout: readonly ConsoleEntry[],
  error: RunnerError,
): Extract<RunnerResult, { readonly ok: false }> {
  return {
    ok: false,
    commands,
    stdout,
    error,
  };
}

import {
  TRACE_PROTOCOL_VERSION,
  validateTrace,
  type TraceCommand,
} from '../protocol';

type TraceFileError = {
  readonly code: 'INVALID_JSON' | 'INVALID_TRACE';
  readonly message: string;
};

export type TraceFileParseResult =
  | {
      readonly ok: true;
      readonly commands: readonly TraceCommand[];
    }
  | {
      readonly ok: false;
      readonly error: TraceFileError;
    };

export type TraceOwnership = {
  readonly claimExecution: () => void;
  readonly claimImport: () => void;
  readonly isExecutionOwner: () => boolean;
};

export function serializeTraceFile(commands: readonly TraceCommand[]): string {
  return JSON.stringify({ version: TRACE_PROTOCOL_VERSION, commands }, null, 2);
}

export function parseTraceFile(contents: string): TraceFileParseResult {
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

  const validation = validateTrace(input);

  if (!validation.ok) {
    return {
      ok: false,
      error: {
        code: 'INVALID_TRACE',
        message: `Trace file validation failed: ${validation.issues[0]?.message ?? 'Invalid trace envelope.'}`,
      },
    };
  }

  return { ok: true, commands: validation.commands };
}

export function createTraceFileName(algorithmName: string): string {
  return `${algorithmName}-trace.json`;
}

export function createTraceOwnership(): TraceOwnership {
  let owner: 'execution' | 'import' = 'execution';

  return {
    claimExecution: () => {
      owner = 'execution';
    },
    claimImport: () => {
      owner = 'import';
    },
    isExecutionOwner: () => owner === 'execution',
  };
}

export function downloadTraceFile(
  algorithmName: string,
  commands: readonly TraceCommand[],
): void {
  const url = URL.createObjectURL(
    new Blob([serializeTraceFile(commands)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = createTraceFileName(algorithmName);
  document.body.append(link);

  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

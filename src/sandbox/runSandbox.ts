import { instrumentSource } from '../instrumentation/instrumentSource';
import type { TraceStructure } from '../protocol/traceTypes';
import {
  runValidatedCode,
  runValidatedFrameCode,
  validateRunnerSource,
  type RunnerResult,
} from '../runner/runner';
import type { SandboxExecutionStatus, SandboxRunResult } from './sandboxTypes';

export async function runSandbox(
  source: unknown,
  structure: TraceStructure | null,
): Promise<SandboxRunResult> {
  const validation = validateRunnerSource(source);
  if (!validation.ok) {
    return { status: 'execution-failure', result: validation.result };
  }

  if (structure === null) {
    return toSandboxResult(
      'untraced',
      await runValidatedCode(validation.source),
    );
  }

  const instrumented = instrumentSource(validation.source, structure);
  if (instrumented !== null) {
    const result = await runValidatedFrameCode(
      instrumented,
      validation.source,
      structure,
    );
    return result.ok
      ? { status: 'frame-instrumented', result }
      : { status: 'frame-execution-failure', result };
  }

  return toSandboxResult(
    'unsupported',
    await runValidatedCode(validation.source),
  );
}

function toSandboxResult(
  status: SandboxExecutionStatus,
  result: RunnerResult,
): SandboxRunResult {
  return result.ok
    ? { status, result }
    : { status: 'execution-failure', result };
}

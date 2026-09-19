import { instrumentJavaScript } from '../instrumentation/instrumentJavaScript';
import type { InstrumentableStructure } from '../instrumentation/instrumentationTypes';
import {
  runValidatedCode,
  validateRunnerSource,
  type RunnerResult,
} from '../runner/runner';
import type { SandboxExecutionStatus, SandboxRunResult } from './sandboxTypes';

export async function runSandbox(
  source: unknown,
  structure: InstrumentableStructure | null,
): Promise<SandboxRunResult> {
  const validation = validateRunnerSource(source);
  if (!validation.ok) {
    return { status: 'execution-failure', result: validation.result };
  }

  if (structure === null) {
    return toSandboxResult(
      'untraced',
      await runValidatedCode(validation.source, { tracing: false }),
    );
  }

  const instrumentation = instrumentJavaScript(validation.source, structure);

  return toSandboxResult(
    instrumentation.status,
    await runValidatedCode(instrumentation.source, {
      tracing: instrumentation.status === 'instrumented',
    }),
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

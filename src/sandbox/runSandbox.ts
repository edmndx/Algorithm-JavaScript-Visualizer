import { instrumentJavaScript } from '../instrumentation/instrumentJavaScript';
import {
  runValidatedCode,
  validateRunnerSource,
  type RunnerResult,
} from '../runner/runner';

export async function runSandbox(source: unknown): Promise<RunnerResult> {
  const validation = validateRunnerSource(source);
  if (!validation.ok) return validation.result;

  const instrumented = instrumentJavaScript(validation.source);

  return runValidatedCode(instrumented, {
    tracing: instrumented !== validation.source,
  });
}

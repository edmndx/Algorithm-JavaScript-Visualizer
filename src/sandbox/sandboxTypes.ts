import type { RunnerResult } from '../runner/runner';

export type SandboxHealth = {
  readonly status: 'ok';
  readonly instanceId: string;
};

export type SandboxWorkerApi = {
  ping(): SandboxHealth;
  run(source: string): Promise<RunnerResult>;
};

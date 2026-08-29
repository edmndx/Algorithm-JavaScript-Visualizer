import { expose } from 'comlink';

import { runSandbox } from './runSandbox';
import type { SandboxHealth, SandboxWorkerApi } from './sandboxTypes';

const health: SandboxHealth = {
  status: 'ok',
  instanceId: crypto.randomUUID(),
};

const api: SandboxWorkerApi = {
  ping: () => health,
  run: runSandbox,
};

expose(api);

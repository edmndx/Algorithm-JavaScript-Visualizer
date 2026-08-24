import { expose } from 'comlink';

import { runCode } from '../runner/runner';
import type { SandboxHealth, SandboxWorkerApi } from './sandboxTypes';

const health: SandboxHealth = {
  status: 'ok',
  instanceId: crypto.randomUUID(),
};

const api: SandboxWorkerApi = {
  ping: () => health,
  run: runCode,
};

expose(api);

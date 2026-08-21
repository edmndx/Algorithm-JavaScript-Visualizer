import { expose } from 'comlink';

import type { SandboxHealth, SandboxWorkerApi } from './sandboxTypes';

const health: SandboxHealth = {
  status: 'ok',
  instanceId: crypto.randomUUID(),
};

const api: SandboxWorkerApi = {
  ping: () => health,
};

expose(api);

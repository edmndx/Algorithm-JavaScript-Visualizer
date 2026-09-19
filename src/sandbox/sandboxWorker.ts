import { expose } from 'comlink';

import { runSandbox } from './runSandbox';
import type { SandboxWorkerApi } from './sandboxTypes';

const api: SandboxWorkerApi = {
  run: runSandbox,
};

expose(api);

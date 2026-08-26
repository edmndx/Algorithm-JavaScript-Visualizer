import { expose } from 'comlink';

import { instrumentJavaScript } from '../instrumentation/instrumentJavaScript';
import { RUNNER_LIMITS, runCode } from '../runner/runner';
import type { SandboxHealth, SandboxWorkerApi } from './sandboxTypes';

const health: SandboxHealth = {
  status: 'ok',
  instanceId: crypto.randomUUID(),
};

const textEncoder = new TextEncoder();

const api: SandboxWorkerApi = {
  ping: () => health,
  run: (source) =>
    runCode(
      textEncoder.encode(source).byteLength > RUNNER_LIMITS.sourceBytes
        ? source
        : instrumentJavaScript(source),
    ),
};

expose(api);

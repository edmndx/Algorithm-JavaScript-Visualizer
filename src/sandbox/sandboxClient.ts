import { releaseProxy, wrap, type Remote } from 'comlink';

import type { InstrumentableStructure } from '../instrumentation/instrumentationTypes';
import { SandboxError } from './sandboxErrors';
import type {
  SandboxHealth,
  SandboxRunResult,
  SandboxWorkerApi,
} from './sandboxTypes';

type ActiveState = {
  readonly lifecycle: 'active';
  readonly worker: Worker;
  readonly proxy: Remote<SandboxWorkerApi>;
};

type SandboxState =
  | ActiveState
  | {
      readonly lifecycle: 'terminated';
      readonly failure?: SandboxError;
    }
  | { readonly lifecycle: 'disposed' };

export class SandboxClient {
  private state: SandboxState;

  constructor() {
    this.state = this.createWorker();
  }

  async ping(): Promise<SandboxHealth> {
    return this.callWorker((worker) => worker.ping());
  }

  async run(
    source: string,
    structure: InstrumentableStructure | null,
  ): Promise<SandboxRunResult> {
    return this.callWorker<SandboxRunResult>((worker) =>
      worker.run(source, structure),
    );
  }

  restart(): void {
    this.assertNotDisposed();
    const state = this.state;
    this.state = { lifecycle: 'terminated' };

    if (state.lifecycle === 'active') this.release(state);

    this.state = this.createWorker();
  }

  terminate(): void {
    this.assertNotDisposed();
    const state = this.state;
    if (state.lifecycle !== 'active') return;

    this.state = { lifecycle: 'terminated' };
    this.release(state);
  }

  dispose(): void {
    if (this.state.lifecycle === 'disposed') return;

    const state = this.state;
    this.state = { lifecycle: 'disposed' };
    if (state.lifecycle === 'active') this.release(state);
  }

  private async callWorker<Result>(
    call: (worker: Remote<SandboxWorkerApi>) => Promise<Result>,
  ): Promise<Result> {
    const state = this.requireActive();

    try {
      return await call(state.proxy);
    } catch (cause) {
      const failure = new SandboxError(
        'communication',
        'Sandbox Worker communication failed.',
        cause,
      );

      if (this.state === state) this.fail(state, failure);
      throw failure;
    }
  }

  private createWorker(): ActiveState {
    let worker: Worker | undefined;

    try {
      worker = new Worker(new URL('./sandboxWorker.ts', import.meta.url), {
        type: 'module',
      });
      worker.addEventListener('error', this.handleError);
      worker.addEventListener('messageerror', this.handleMessageError);

      return {
        lifecycle: 'active',
        worker,
        proxy: wrap<SandboxWorkerApi>(worker),
      };
    } catch (cause) {
      worker?.terminate();
      throw new SandboxError(
        'worker-creation',
        'Sandbox Worker creation failed.',
        cause,
      );
    }
  }

  private requireActive(): ActiveState {
    if (this.state.lifecycle === 'active') return this.state;
    if (this.state.lifecycle === 'disposed') {
      throw new SandboxError('disposed', 'Sandbox has been disposed.');
    }

    throw (
      this.state.failure ??
      new SandboxError('worker-unavailable', 'Sandbox Worker is not active.')
    );
  }

  private assertNotDisposed(): void {
    if (this.state.lifecycle === 'disposed') {
      throw new SandboxError('disposed', 'Sandbox has been disposed.');
    }
  }

  private release(state: ActiveState): void {
    try {
      state.proxy[releaseProxy]();
    } catch (cause) {
      throw new SandboxError(
        'communication',
        'Sandbox Worker cleanup failed.',
        cause,
      );
    } finally {
      this.terminateWorker(state);
    }
  }

  private fail(state: ActiveState, failure: SandboxError): void {
    if (this.state !== state) return;

    this.state = { lifecycle: 'terminated', failure };
    this.terminateWorker(state);
  }

  private terminateWorker(state: ActiveState): void {
    state.worker.removeEventListener('error', this.handleError);
    state.worker.removeEventListener('messageerror', this.handleMessageError);
    state.worker.terminate();
  }

  private activeStateFor(target: EventTarget | null): ActiveState | undefined {
    const state = this.state;
    return state.lifecycle === 'active' && target === state.worker
      ? state
      : undefined;
  }

  private readonly handleError = (event: ErrorEvent): void => {
    const state = this.activeStateFor(event.currentTarget);
    if (state === undefined) return;

    const failure = new SandboxError(
      'worker-crashed',
      event.message || 'Sandbox Worker crashed.',
      event.error,
    );
    this.fail(state, failure);
  };

  private readonly handleMessageError = (
    event: MessageEvent<unknown>,
  ): void => {
    const state = this.activeStateFor(event.currentTarget);
    if (state === undefined) return;

    this.fail(
      state,
      new SandboxError(
        'communication',
        'Sandbox Worker received an unreadable message.',
        event.data,
      ),
    );
  };
}

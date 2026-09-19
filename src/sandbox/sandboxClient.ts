import { wrap, type Remote } from 'comlink';

import type { InstrumentableStructure } from '../instrumentation/instrumentationTypes';
import { SandboxError } from './sandboxErrors';
import type { SandboxRunResult, SandboxWorkerApi } from './sandboxTypes';

const EXECUTION_TIMEOUT_MS = 5_000;

type ActiveState = {
  readonly lifecycle: 'active';
  readonly worker: Worker;
  readonly proxy: Remote<SandboxWorkerApi>;
  readonly rejectPending: Set<(failure: SandboxError) => void>;
};

type SandboxState =
  | ActiveState
  | {
      readonly lifecycle: 'terminated';
      readonly failure: SandboxError;
    }
  | { readonly lifecycle: 'disposed' };

export class SandboxClient {
  private state: SandboxState;

  constructor() {
    this.state = this.createWorker();
  }

  async run(
    source: string,
    structure: InstrumentableStructure | null,
  ): Promise<SandboxRunResult> {
    const state = this.requireActive();
    let rejectWorkerFailure: (failure: SandboxError) => void = () => undefined;
    const workerFailure = new Promise<never>((_resolve, reject) => {
      rejectWorkerFailure = reject;
      state.rejectPending.add(reject);
    });
    const timeout = setTimeout(() => {
      if (this.state !== state) return;

      this.fail(
        state,
        new SandboxError(
          'timeout',
          `Execution timed out after ${EXECUTION_TIMEOUT_MS} ms.`,
        ),
      );
    }, EXECUTION_TIMEOUT_MS);

    try {
      return await Promise.race([
        state.proxy.run(source, structure),
        workerFailure,
      ]);
    } catch (cause) {
      const failure =
        cause instanceof SandboxError
          ? cause
          : new SandboxError(
              'communication',
              'Sandbox Worker communication failed.',
              cause,
            );

      if (this.state === state) this.fail(state, failure);
      throw failure;
    } finally {
      clearTimeout(timeout);
      state.rejectPending.delete(rejectWorkerFailure);
    }
  }

  dispose(): void {
    if (this.state.lifecycle === 'disposed') return;

    const state = this.state;
    this.state = { lifecycle: 'disposed' };
    if (state.lifecycle === 'active') {
      this.rejectPending(
        state,
        new SandboxError('disposed', 'Sandbox has been disposed.'),
      );
      this.terminateWorker(state);
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
        rejectPending: new Set(),
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

    throw this.state.failure;
  }

  private fail(state: ActiveState, failure: SandboxError): void {
    if (this.state !== state) return;

    this.state = { lifecycle: 'terminated', failure };
    this.rejectPending(state, failure);
    this.terminateWorker(state);
  }

  private rejectPending(state: ActiveState, failure: SandboxError): void {
    for (const reject of state.rejectPending) reject(failure);
    state.rejectPending.clear();
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

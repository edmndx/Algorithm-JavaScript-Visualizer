import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import type { PlaybackController } from '../playback';
import type { TraceStructure } from '../protocol';
import { SandboxClient, SandboxError } from '../sandbox';
import type { RunnableSource } from './codeEditor';
import type { ConsoleEntry } from './traceConsole';
import { parseTraceFile } from './trace/traceSerialization';
import {
  commitSandboxResult,
  type TraceSessionDiagnostic,
} from './traceSessionResult';

type AcceptedTrace =
  | {
      readonly kind: 'catalog';
      readonly sourceCode: string;
      readonly sourceRevision: number;
      readonly structure: TraceStructure;
    }
  | {
      readonly kind: 'generated';
      readonly sourceRevision: number;
      readonly structure: TraceStructure;
    }
  | {
      readonly kind: 'imported';
      readonly structure: TraceStructure;
    };

type ActiveTrace =
  | { readonly kind: 'none' | 'stale' }
  | {
      readonly kind: AcceptedTrace['kind'];
      readonly structure: TraceStructure;
    };

type ExecutionTask =
  | { readonly kind: 'idle' }
  | { readonly kind: 'initialization' }
  | { readonly kind: 'run' }
  | { readonly kind: 'import' };

type TraceSessionOptions = {
  readonly activeSource: RunnableSource;
  readonly loadPlayback: PlaybackController['load'];
  readonly playPlayback: PlaybackController['play'];
};

type TraceSessionController = {
  readonly consoleEntries: readonly ConsoleEntry[];
  readonly diagnostic: TraceSessionDiagnostic | null;
  readonly isRunning: boolean;
  readonly trace: ActiveTrace;
  readonly initialize: (source: RunnableSource) => Promise<void>;
  readonly importTrace: (file: File) => Promise<void>;
  readonly run: (source: RunnableSource) => Promise<void>;
  readonly stop: () => void;
};

export function useTraceSession({
  activeSource,
  loadPlayback,
  playPlayback,
}: TraceSessionOptions): TraceSessionController {
  const sandboxClient = useRef<SandboxClient | null>(null);
  const activeTask = useRef<ExecutionTask>({ kind: 'idle' });
  const activeSourceRef = useRef(activeSource);
  const [isRunning, setIsRunning] = useState(false);
  const [acceptedTrace, setAcceptedTrace] = useState<AcceptedTrace | null>(
    null,
  );
  const [diagnostic, setDiagnostic] = useState<TraceSessionDiagnostic | null>(
    null,
  );
  const consoleEntries: readonly ConsoleEntry[] =
    diagnostic === null
      ? []
      : [{ sequence: 0, level: 'error', text: diagnostic.message }];
  const trace = getActiveTrace(acceptedTrace, activeSource);

  useLayoutEffect(() => {
    activeSourceRef.current = activeSource;
  }, [activeSource]);

  const disposeClient = useCallback(() => {
    const client = sandboxClient.current;
    sandboxClient.current = null;
    client?.dispose();
  }, []);

  const cancelActiveTask = useCallback(() => {
    activeTask.current = { kind: 'idle' };
    setIsRunning(false);
    disposeClient();
  }, [disposeClient]);

  useEffect(() => cancelActiveTask, [cancelActiveTask]);

  const initialize = useCallback(
    async (source: RunnableSource) => {
      cancelActiveTask();
      setAcceptedTrace(null);
      setDiagnostic(null);

      let client: SandboxClient;
      try {
        client = new SandboxClient();
        sandboxClient.current = client;
      } catch (error) {
        setDiagnostic(sandboxDiagnostic(error, 'worker-creation'));
        return;
      }

      const task: ExecutionTask = { kind: 'initialization' };
      activeTask.current = task;

      try {
        const result = await client.run(source.code, source.structure);
        if (activeTask.current !== task) return;

        const committed = commitSandboxResult(result, loadPlayback);
        if (committed.ok) {
          setAcceptedTrace({
            kind: 'catalog',
            sourceCode: source.code,
            sourceRevision: source.revision,
            structure: committed.structure,
          });
          setDiagnostic(null);
        } else {
          setDiagnostic(committed.diagnostic);
        }
      } catch (error) {
        if (activeTask.current === task) {
          disposeClient();
          setDiagnostic(sandboxDiagnostic(error, 'communication'));
        }
      } finally {
        if (activeTask.current === task) activeTask.current = { kind: 'idle' };
      }
    },
    [cancelActiveTask, disposeClient, loadPlayback],
  );

  const importTrace = useCallback(
    async (file: File) => {
      cancelActiveTask();
      const task: ExecutionTask = { kind: 'import' };
      activeTask.current = task;

      let contents: string;
      try {
        contents = await file.text();
      } catch {
        if (activeTask.current === task) {
          setDiagnostic({
            kind: 'trace-file',
            code: 'READ_FAILED',
            message: 'Trace file could not be read.',
          });
          activeTask.current = { kind: 'idle' };
        }
        return;
      }

      if (activeTask.current !== task) return;
      const result = parseTraceFile(contents);
      if (!result.ok) {
        setDiagnostic({
          kind: 'trace-file',
          code: result.error.code,
          message: result.error.message,
        });
        activeTask.current = { kind: 'idle' };
        return;
      }

      const timelineResult = loadPlayback(result.commands);
      if (!timelineResult.ok) {
        setDiagnostic({
          kind: 'trace-validation',
          message: `Trace file validation failed: ${timelineResult.error.message}`,
        });
        activeTask.current = { kind: 'idle' };
        return;
      }

      setAcceptedTrace({
        kind: 'imported',
        structure: timelineResult.timeline.structure,
      });
      setDiagnostic(null);
      activeTask.current = { kind: 'idle' };
    },
    [cancelActiveTask, loadPlayback],
  );

  const run = useCallback(
    async (source: RunnableSource) => {
      if (activeTask.current.kind === 'run') return;
      if (activeTask.current.kind !== 'idle') cancelActiveTask();

      const task: ExecutionTask = { kind: 'run' };
      activeTask.current = task;
      setDiagnostic(null);

      let client = sandboxClient.current;
      if (client === null) {
        try {
          client = new SandboxClient();
          sandboxClient.current = client;
        } catch (error) {
          activeTask.current = { kind: 'idle' };
          setDiagnostic(sandboxDiagnostic(error, 'worker-creation'));
          return;
        }
      }

      const isLatestRun = () =>
        activeTask.current === task &&
        source.revision === activeSourceRef.current.revision;
      setIsRunning(true);

      try {
        const result = await client.run(source.code, source.structure);
        if (!isLatestRun()) return;

        const committed = commitSandboxResult(result, loadPlayback);
        if (committed.ok) {
          setAcceptedTrace({
            kind: 'generated',
            sourceRevision: source.revision,
            structure: committed.structure,
          });
          setDiagnostic(null);
          playPlayback();
        } else {
          setDiagnostic(committed.diagnostic);
        }
      } catch (error) {
        if (sandboxClient.current === client) disposeClient();
        if (!isLatestRun()) return;
        setDiagnostic(sandboxDiagnostic(error, 'communication'));
      } finally {
        if (activeTask.current === task) {
          activeTask.current = { kind: 'idle' };
          setIsRunning(false);
        }
      }
    },
    [cancelActiveTask, disposeClient, loadPlayback, playPlayback],
  );

  const stop = useCallback(() => {
    if (activeTask.current.kind !== 'run') return;

    cancelActiveTask();
    setDiagnostic({ kind: 'cancelled', message: 'Execution stopped.' });
  }, [cancelActiveTask]);

  return {
    consoleEntries,
    diagnostic,
    initialize,
    importTrace,
    isRunning,
    run,
    stop,
    trace,
  };
}

export function getActiveTrace(
  acceptedTrace: AcceptedTrace | null,
  activeSource: RunnableSource,
): ActiveTrace {
  if (acceptedTrace === null) return { kind: 'none' };
  if (acceptedTrace.kind === 'imported') return acceptedTrace;

  const isCurrent =
    acceptedTrace.kind === 'catalog'
      ? activeSource.revision === acceptedTrace.sourceRevision ||
        (activeSource.structure === acceptedTrace.structure &&
          activeSource.code === acceptedTrace.sourceCode)
      : activeSource.revision === acceptedTrace.sourceRevision;

  return isCurrent
    ? { kind: acceptedTrace.kind, structure: acceptedTrace.structure }
    : { kind: 'stale' };
}

function sandboxDiagnostic(
  error: unknown,
  fallbackCode: 'worker-creation' | 'communication',
): TraceSessionDiagnostic {
  return {
    kind: 'sandbox',
    code: error instanceof SandboxError ? error.kind : fallbackCode,
    message:
      error instanceof Error ? error.message : 'Sandbox execution failed.',
  };
}

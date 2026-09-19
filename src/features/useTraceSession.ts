import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import type { PlaybackController } from '../playback';
import type { TraceStructure } from '../protocol';
import { SandboxClient } from '../sandbox';
import type { RunnableSource } from './codeEditor';
import { createFrameNarrationEntries } from './frameNarration';
import type { FrameTrace } from '../protocol/frameTrace';
import type { ConsoleEntry } from './traceConsole';
import { parseTraceFile } from './trace/traceSerialization';
import {
  buildSandboxTimeline,
  getActiveTrace,
  type AcceptedTrace,
} from './traceSessionResult';
import type { FrameTimeline } from '../playback/frameTimeline';

type ExecutionTask =
  | { readonly kind: 'idle' }
  | { readonly kind: 'initialization' }
  | { readonly kind: 'run' }
  | { readonly kind: 'import' };

type TraceSessionOptions = {
  readonly activeSource: RunnableSource;
  readonly playback: PlaybackController;
  readonly bindImportedSource: (
    code: string,
    structure: FrameTrace['source']['structure'],
  ) => RunnableSource | null;
};

type TraceSessionController = {
  readonly activeSourceLocation: PlaybackController['activeSourceLocation'];
  readonly canExportTrace: boolean;
  readonly consoleEntries: readonly ConsoleEntry[];
  readonly importedStructure: TraceStructure | null;
  readonly isRunning: boolean;
  readonly seekNarration: PlaybackController['seek'] | undefined;
  readonly initialize: (source: RunnableSource) => Promise<void>;
  readonly importTrace: (file: File) => Promise<void>;
  readonly run: (source: RunnableSource) => Promise<void>;
  readonly stop: () => void;
};

export function useTraceSession({
  activeSource,
  playback,
  bindImportedSource,
}: TraceSessionOptions): TraceSessionController {
  const { load: loadPlayback, play: playPlayback } = playback;
  const sandboxClient = useRef<SandboxClient | null>(null);
  const activeTask = useRef<ExecutionTask>({ kind: 'idle' });
  const activeSourceRef = useRef(activeSource);
  const bindImportedSourceRef = useRef(bindImportedSource);
  const [isRunning, setIsRunning] = useState(false);
  const [acceptedTrace, setAcceptedTrace] = useState<AcceptedTrace | null>(
    null,
  );
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const trace = getActiveTrace(acceptedTrace, activeSource);
  const hasAcceptedTrace = trace.kind !== 'none' && trace.kind !== 'stale';
  const consoleEntries: readonly ConsoleEntry[] =
    diagnostic !== null
      ? [{ sequence: 0, level: 'error', text: diagnostic }]
      : hasAcceptedTrace && playback.frameTrace !== null
        ? createFrameNarrationEntries(playback.frameTrace, playback.currentStep)
        : [];

  useLayoutEffect(() => {
    activeSourceRef.current = activeSource;
    bindImportedSourceRef.current = bindImportedSource;
  }, [activeSource, bindImportedSource]);

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

  const acceptTrace = useCallback(
    (
      timeline: FrameTimeline,
      source: RunnableSource,
      kind: AcceptedTrace['kind'],
    ) => {
      loadPlayback(timeline);
      setAcceptedTrace({
        kind,
        sourceCode: source.code,
        sourceRevision: source.revision,
        structure: timeline.structure,
      });
      setDiagnostic(null);
    },
    [loadPlayback],
  );

  const execute = useCallback(
    async (source: RunnableSource, kind: 'initialization' | 'run') => {
      if (kind === 'initialization') {
        cancelActiveTask();
        setAcceptedTrace(null);
      } else {
        if (activeTask.current.kind === 'run') return;
        if (activeTask.current.kind !== 'idle') cancelActiveTask();
      }
      const task: ExecutionTask = { kind };
      activeTask.current = task;
      setDiagnostic(null);

      let client = sandboxClient.current;
      if (client === null) {
        try {
          client = new SandboxClient();
          sandboxClient.current = client;
        } catch (error) {
          activeTask.current = { kind: 'idle' };
          setDiagnostic(sandboxMessage(error));
          return;
        }
      }
      const isCurrentTask = () =>
        activeTask.current === task &&
        (kind === 'initialization' ||
          source.revision === activeSourceRef.current.revision);
      setIsRunning(kind === 'run');

      try {
        const result = await client.run(source.code, source.structure);
        if (!isCurrentTask()) return;
        const built = buildSandboxTimeline(result);
        if (built.ok) {
          acceptTrace(
            built.timeline,
            source,
            kind === 'initialization' ? 'catalog' : 'generated',
          );
          if (kind === 'run') playPlayback();
        } else {
          setDiagnostic(built.message);
        }
      } catch (error) {
        if (sandboxClient.current === client) disposeClient();
        if (isCurrentTask()) setDiagnostic(sandboxMessage(error));
      } finally {
        if (activeTask.current === task) {
          activeTask.current = { kind: 'idle' };
          setIsRunning(false);
        }
      }
    },
    [cancelActiveTask, disposeClient, acceptTrace, playPlayback],
  );

  const initialize = useCallback(
    (source: RunnableSource) => execute(source, 'initialization'),
    [execute],
  );
  const run = useCallback(
    (source: RunnableSource) => execute(source, 'run'),
    [execute],
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
          setDiagnostic('Trace file could not be read.');
          activeTask.current = { kind: 'idle' };
        }
        return;
      }

      if (activeTask.current !== task) return;
      const result = parseTraceFile(contents);
      if (!result.ok) {
        setDiagnostic(result.error.message);
        activeTask.current = { kind: 'idle' };
        return;
      }

      const source = bindImportedSourceRef.current(
        result.timeline.trace.source.text,
        result.timeline.structure,
      );
      if (source === null) {
        setDiagnostic('Close an editor tab before importing this trace.');
        activeTask.current = { kind: 'idle' };
        return;
      }
      acceptTrace(result.timeline, source, 'imported');
      activeTask.current = { kind: 'idle' };
    },
    [cancelActiveTask, acceptTrace],
  );

  const stop = useCallback(() => {
    if (activeTask.current.kind !== 'run') return;

    cancelActiveTask();
    setDiagnostic('Execution stopped.');
  }, [cancelActiveTask]);

  return {
    activeSourceLocation: hasAcceptedTrace
      ? playback.activeSourceLocation
      : null,
    canExportTrace:
      (trace.kind === 'generated' || trace.kind === 'imported') &&
      playback.frameTrace !== null,
    consoleEntries,
    importedStructure: trace.kind === 'imported' ? trace.structure : null,
    initialize,
    importTrace,
    isRunning,
    seekNarration:
      diagnostic === null && hasAcceptedTrace && playback.frameTrace !== null
        ? playback.seek
        : undefined,
    run,
    stop,
  };
}

function sandboxMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Sandbox execution failed.';
}

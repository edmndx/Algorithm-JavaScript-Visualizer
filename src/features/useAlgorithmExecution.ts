import { useEffect, useRef, useState } from 'react';

import type { RunnableSource } from './codeEditor';
import type { PlaybackController } from '../playback';
import { TRACE_PROTOCOL_VERSION, type TraceCommand } from '../protocol';
import type { ConsoleEntry } from '../runner/runner';
import { SandboxClient } from '../sandbox';

const UNSUPPORTED_TRACE_MESSAGE =
  'Semantic trace unavailable: this code pattern is not supported by automatic instrumentation.';
const UNTRACED_SOURCE_MESSAGE =
  'Semantic trace unavailable: this source has no instrumentable structure.';

interface AlgorithmExecution {
  readonly consoleEntries: readonly ConsoleEntry[];
  readonly isRunning: boolean;
  readonly successfulSourceRevision: number | null;
  readonly run: (source: RunnableSource) => Promise<void>;
}

export function useAlgorithmExecution(
  isCurrentSource: (source: RunnableSource) => boolean,
  loadPlayback: PlaybackController['load'],
  playPlayback: PlaybackController['play'],
): AlgorithmExecution {
  const sandboxClient = useRef<SandboxClient | null>(null);
  const isRunActive = useRef(false);
  const runSequence = useRef(0);
  const [isRunning, setIsRunning] = useState(false);
  const [successfulSourceRevision, setSuccessfulSourceRevision] = useState<
    number | null
  >(null);
  const [consoleEntries, setConsoleEntries] = useState<readonly ConsoleEntry[]>(
    [],
  );

  useEffect(() => {
    return () => {
      runSequence.current += 1;
      const client = sandboxClient.current;
      sandboxClient.current = null;
      client?.dispose();
    };
  }, []);

  async function run(runSource: RunnableSource) {
    if (isRunActive.current) return;
    isRunActive.current = true;
    setSuccessfulSourceRevision(null);

    let client = sandboxClient.current;

    if (client === null) {
      try {
        client = new SandboxClient();
        sandboxClient.current = client;
      } catch (error) {
        isRunActive.current = false;
        setConsoleEntries([
          createConsoleEntry('error', sandboxFailureMessage(error)),
        ]);
        return;
      }
    }

    const runId = ++runSequence.current;

    function isLatestRun() {
      return runId === runSequence.current && isCurrentSource(runSource);
    }

    setIsRunning(true);

    try {
      const sandboxResult = await client.run(
        runSource.code,
        runSource.structure,
      );
      if (!isLatestRun()) return;

      const entries: ConsoleEntry[] = [...sandboxResult.result.stdout];

      switch (sandboxResult.status) {
        case 'execution-failure':
          appendConsoleEntry(
            entries,
            'error',
            sandboxResult.result.error.message,
          );
          break;
        case 'unsupported':
          appendConsoleEntry(entries, 'error', UNSUPPORTED_TRACE_MESSAGE);
          break;
        case 'instrumented': {
          const timelineResult = loadPlayback(sandboxResult.result.commands);
          if (!timelineResult.ok) {
            appendConsoleEntry(
              entries,
              'error',
              `Semantic trace validation failed: ${timelineResult.error.message}`,
            );
          } else {
            appendConsoleEntry(
              entries,
              'log',
              formatSemanticTrace(sandboxResult.result.commands),
            );
            setSuccessfulSourceRevision(runSource.revision);
            playPlayback();
          }
          break;
        }
        case 'untraced':
          appendConsoleEntry(entries, 'error', UNTRACED_SOURCE_MESSAGE);
          break;
        default: {
          const unexpectedResult: never = sandboxResult;
          return unexpectedResult;
        }
      }

      setConsoleEntries(entries);
    } catch (error) {
      if (sandboxClient.current === client) {
        sandboxClient.current = null;
        client.dispose();
      }

      if (!isLatestRun()) return;

      setConsoleEntries([
        createConsoleEntry('error', sandboxFailureMessage(error)),
      ]);
    } finally {
      if (runId === runSequence.current) {
        isRunActive.current = false;
        setIsRunning(false);
      }
    }
  }

  return {
    consoleEntries,
    isRunning,
    successfulSourceRevision,
    run,
  };
}

function formatSemanticTrace(commands: readonly TraceCommand[]): string {
  return JSON.stringify({ version: TRACE_PROTOCOL_VERSION, commands }, null, 2);
}

function createConsoleEntry(
  level: ConsoleEntry['level'],
  text: string,
): ConsoleEntry {
  return { sequence: 0, level, text };
}

function sandboxFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Sandbox execution failed.';
}

function appendConsoleEntry(
  entries: ConsoleEntry[],
  level: ConsoleEntry['level'],
  text: string,
) {
  entries.push({ sequence: entries.length, level, text });
}

import { useEffect, useRef, useState } from 'react';

import type { RunnableSource } from './codeEditor';
import type { PlaybackController } from '../playback';
import type { ConsoleEntry } from '../runner/runner';
import { SandboxClient } from '../sandbox';

interface AlgorithmExecution {
  readonly consoleEntries: readonly ConsoleEntry[];
  readonly isRunning: boolean;
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
      const sandboxResult = await client.run(runSource.code);
      if (!isLatestRun()) return;

      const entries: ConsoleEntry[] = [...sandboxResult.stdout];

      if (!sandboxResult.ok) {
        appendConsoleEntry(entries, 'error', sandboxResult.error.message);
      } else if (sandboxResult.commands.length > 0) {
        const timelineResult = loadPlayback(sandboxResult.commands);
        if (!timelineResult.ok) {
          appendConsoleEntry(entries, 'error', timelineResult.error.message);
        } else {
          playPlayback();
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
    run,
  };
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

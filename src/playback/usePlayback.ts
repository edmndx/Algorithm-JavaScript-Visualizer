import { useMachine } from '@xstate/react';
import { useCallback, useMemo } from 'react';

import type { TraceCommand } from '../protocol/traceTypes';
import { createInitialScene, type SceneState } from '../scene';
import { playbackMachine } from './playbackMachine';
import { buildTimeline, getFrame, type TimelineBuildResult } from './timeline';

const EMPTY_SCENE = createInitialScene();
const EMPTY_COMMANDS: readonly TraceCommand[] = [];

export type PlaybackController = {
  readonly scene: SceneState;
  readonly commands: readonly TraceCommand[];
  readonly currentStep: number;
  readonly totalSteps: number;
  readonly isPlaying: boolean;
  readonly canPlay: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  load(commands: readonly TraceCommand[]): TimelineBuildResult;
  play(): void;
  pause(): void;
  next(): void;
  previous(): void;
  reset(): void;
};

export function usePlayback(): PlaybackController {
  const [snapshot, send] = useMachine(playbackMachine);
  const { timeline, currentStep } = snapshot.context;

  const scene = useMemo(
    () =>
      timeline === null
        ? EMPTY_SCENE
        : getFrame(timeline, currentStep - 1).scene,
    [currentStep, timeline],
  );

  const load = useCallback(
    (commands: readonly TraceCommand[]) => {
      const result = buildTimeline(commands);

      if (result.ok) {
        send({ type: 'LOAD', timeline: result.timeline });
      }

      return result;
    },
    [send],
  );

  const totalSteps = timeline?.commands.length ?? 0;

  return {
    scene,
    commands: timeline?.commands ?? EMPTY_COMMANDS,
    currentStep,
    totalSteps,
    isPlaying: snapshot.matches('playing'),
    canPlay: timeline !== null,
    canGoBack: currentStep > 0,
    canGoForward: timeline !== null && currentStep < totalSteps,
    load,
    play: () => send({ type: 'PLAY' }),
    pause: () => send({ type: 'PAUSE' }),
    next: () => send({ type: 'NEXT' }),
    previous: () => send({ type: 'PREVIOUS' }),
    reset: () => send({ type: 'RESET' }),
  };
}

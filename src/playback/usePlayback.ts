import { useMachine } from '@xstate/react';
import { useCallback, useMemo } from 'react';

import type { TraceCommand, TraceStructure } from '../protocol/traceTypes';
import { createPlaceholderScene, type SceneState } from '../scene';
import { playbackMachine } from './playbackMachine';
import {
  buildTimeline,
  getPlaybackFrame,
  type TimelineBuildResult,
} from './timeline';

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
  initialize(structure: TraceStructure): void;
  load(commands: readonly TraceCommand[]): TimelineBuildResult;
  play(): void;
  pause(): void;
  next(): void;
  previous(): void;
  reset(): void;
};

export function usePlayback(
  initialStructure: TraceStructure,
): PlaybackController {
  const [snapshot, send] = useMachine(playbackMachine, {
    input: { initialStructure },
  });
  const { timeline, currentStep, structure } = snapshot.context;

  const scene = useMemo(
    () =>
      timeline === null
        ? createPlaceholderScene(structure)
        : getPlaybackFrame(timeline, currentStep).scene,
    [currentStep, structure, timeline],
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

  const totalSteps = timeline?.operationCount ?? 0;

  return {
    scene,
    commands: timeline?.commands ?? EMPTY_COMMANDS,
    currentStep,
    totalSteps,
    isPlaying: snapshot.matches('playing'),
    canPlay: totalSteps > 0,
    canGoBack: currentStep > 0,
    canGoForward: timeline !== null && currentStep < totalSteps,
    initialize: (nextStructure) =>
      send({ type: 'INITIALIZE', structure: nextStructure }),
    load,
    play: () => send({ type: 'PLAY' }),
    pause: () => send({ type: 'PAUSE' }),
    next: () => send({ type: 'NEXT' }),
    previous: () => send({ type: 'PREVIOUS' }),
    reset: () => send({ type: 'RESET' }),
  };
}

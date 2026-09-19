import { useCallback, useEffect, useMemo, useReducer } from 'react';

import type {
  TraceCommand,
  TraceSourceLocation,
  TraceStructure,
} from '../protocol/traceTypes';
import { createPlaceholderScene, type SceneState } from '../scene';
import { createPlaybackState, playbackReducer } from './playbackReducer';
import {
  buildTimeline,
  getPlaybackFrame,
  getPlaybackSourceLocation,
  type TimelineBuildResult,
} from './timeline';

const EMPTY_COMMANDS: readonly TraceCommand[] = [];
const PLAYBACK_STEP_DELAY_MS = 750;

export type PlaybackController = {
  readonly scene: SceneState;
  readonly commands: readonly TraceCommand[];
  readonly currentStep: number;
  readonly activeSourceLocation: TraceSourceLocation | null;
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
  const [state, dispatch] = useReducer(
    playbackReducer,
    initialStructure,
    createPlaybackState,
  );
  const { timeline, currentStep, structure, status } = state;

  useEffect(() => {
    if (status !== 'playing') return;

    const timeout = window.setTimeout(
      () => dispatch({ type: 'tick' }),
      PLAYBACK_STEP_DELAY_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [currentStep, status, timeline]);

  const scene = useMemo(
    () =>
      timeline === null
        ? createPlaceholderScene(structure)
        : getPlaybackFrame(timeline, currentStep).scene,
    [currentStep, structure, timeline],
  );

  const load = useCallback((commands: readonly TraceCommand[]) => {
    const result = buildTimeline(commands);

    if (result.ok) {
      dispatch({ type: 'load', timeline: result.timeline });
    }

    return result;
  }, []);

  const totalSteps = timeline?.operationCount ?? 0;

  return {
    scene,
    commands: timeline?.commands ?? EMPTY_COMMANDS,
    currentStep,
    activeSourceLocation:
      timeline === null
        ? null
        : getPlaybackSourceLocation(timeline, currentStep),
    totalSteps,
    isPlaying: status === 'playing',
    canPlay: totalSteps > 0,
    canGoBack: currentStep > 0,
    canGoForward: timeline !== null && currentStep < totalSteps,
    initialize: (nextStructure) =>
      dispatch({ type: 'initialize', structure: nextStructure }),
    load,
    play: () => dispatch({ type: 'play' }),
    pause: () => dispatch({ type: 'pause' }),
    next: () => dispatch({ type: 'next' }),
    previous: () => dispatch({ type: 'previous' }),
    reset: () => dispatch({ type: 'reset' }),
  };
}

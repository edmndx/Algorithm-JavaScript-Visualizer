import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import type {
  TraceSourceLocation,
  TraceStructure,
} from '../protocol/traceTypes';
import type { FrameTrace } from '../protocol/frameTrace';
import { createPlaceholderScene, type SceneState } from '../scene';
import { createPlaybackState, playbackReducer } from './playbackReducer';
import {
  getFrameScene,
  getFrameSource,
  type FrameTimeline,
} from './frameTimeline';
const PLAYBACK_STEP_DELAY_MS = 750;

export type PlaybackController = {
  readonly scene: SceneState;
  readonly frameTrace: FrameTrace | null;
  readonly currentStep: number;
  readonly activeSourceLocation: TraceSourceLocation | null;
  readonly totalSteps: number;
  readonly isPlaying: boolean;
  readonly canPlay: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly speed: 0.5 | 1 | 2;
  readonly animateForward: boolean;
  initialize(structure: TraceStructure): void;
  load(timeline: FrameTimeline): void;
  play(): void;
  pause(): void;
  next(): void;
  previous(): void;
  seek(step: number): void;
  cycleSpeed(): void;
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
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const { timeline, currentStep, structure, status, animateForward } = state;

  useEffect(() => {
    if (status !== 'playing') return;

    const timeout = window.setTimeout(
      () => dispatch({ type: 'tick' }),
      PLAYBACK_STEP_DELAY_MS / speed,
    );
    return () => window.clearTimeout(timeout);
  }, [currentStep, speed, status, timeline]);

  const scene = useMemo(
    () =>
      timeline === null
        ? createPlaceholderScene(structure)
        : getFrameScene(timeline, currentStep),
    [currentStep, structure, timeline],
  );

  const load = useCallback((nextTimeline: FrameTimeline): void => {
    dispatch({ type: 'load', timeline: nextTimeline });
  }, []);
  const play = useCallback(() => dispatch({ type: 'play' }), []);

  const totalSteps = timeline?.operationCount ?? 0;

  return {
    scene,
    frameTrace: timeline?.trace ?? null,
    currentStep,
    activeSourceLocation:
      timeline === null ? null : getFrameSource(timeline, currentStep),
    totalSteps,
    isPlaying: status === 'playing',
    canPlay: totalSteps > 0,
    canGoBack: currentStep > 0,
    canGoForward: timeline !== null && currentStep < totalSteps,
    speed,
    animateForward,
    initialize: (nextStructure) =>
      dispatch({ type: 'initialize', structure: nextStructure }),
    load,
    play,
    pause: () => dispatch({ type: 'pause' }),
    next: () => dispatch({ type: 'next' }),
    previous: () => dispatch({ type: 'previous' }),
    seek: (step) => dispatch({ type: 'seek', step }),
    cycleSpeed: () =>
      setSpeed((current) => (current === 1 ? 2 : current === 2 ? 0.5 : 1)),
    reset: () => dispatch({ type: 'reset' }),
  };
}

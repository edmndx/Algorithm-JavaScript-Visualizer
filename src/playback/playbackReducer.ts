import type { TraceStructure } from '../protocol';
import type { FrameTimeline } from './frameTimeline';

type PlaybackState = {
  readonly timeline: FrameTimeline | null;
  readonly currentStep: number;
  readonly structure: TraceStructure;
  readonly status: 'paused' | 'playing';
  readonly animateForward: boolean;
};

type PlaybackAction =
  | { readonly type: 'initialize'; readonly structure: TraceStructure }
  | { readonly type: 'load'; readonly timeline: FrameTimeline | null }
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'next' }
  | { readonly type: 'previous' }
  | { readonly type: 'seek'; readonly step: number }
  | { readonly type: 'reset' }
  | { readonly type: 'tick' };

export function createPlaybackState(structure: TraceStructure): PlaybackState {
  return {
    timeline: null,
    currentStep: 0,
    structure,
    status: 'paused',
    animateForward: false,
  };
}

export function playbackReducer(
  state: PlaybackState,
  action: PlaybackAction,
): PlaybackState {
  switch (action.type) {
    case 'initialize':
      return createPlaybackState(action.structure);
    case 'load':
      return {
        timeline: action.timeline,
        currentStep: 0,
        structure: action.timeline?.structure ?? state.structure,
        status: 'paused',
        animateForward: false,
      };
    case 'play': {
      const operationCount = state.timeline?.operationCount ?? 0;
      if (operationCount === 0) return state;

      return {
        ...state,
        currentStep: state.currentStep < operationCount ? state.currentStep : 0,
        status: 'playing',
        animateForward: false,
      };
    }
    case 'pause':
      return { ...state, status: 'paused', animateForward: false };
    case 'next':
      return {
        ...state,
        currentStep: Math.min(
          state.currentStep + 1,
          state.timeline?.operationCount ?? 0,
        ),
        status: 'paused',
        animateForward:
          state.currentStep < (state.timeline?.operationCount ?? 0),
      };
    case 'previous':
      return {
        ...state,
        currentStep: Math.max(state.currentStep - 1, 0),
        status: 'paused',
        animateForward: false,
      };
    case 'seek':
      return {
        ...state,
        currentStep: Math.max(
          0,
          Math.min(action.step, state.timeline?.operationCount ?? 0),
        ),
        status: 'paused',
        animateForward: false,
      };
    case 'reset':
      return {
        ...state,
        currentStep: 0,
        status: 'paused',
        animateForward: false,
      };
    case 'tick': {
      if (state.status !== 'playing') return state;

      const operationCount = state.timeline?.operationCount ?? 0;
      const currentStep = Math.min(state.currentStep + 1, operationCount);
      return {
        ...state,
        currentStep,
        status: currentStep >= operationCount ? 'paused' : 'playing',
        animateForward: currentStep > state.currentStep,
      };
    }
  }
}

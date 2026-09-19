import type { TraceStructure } from '../protocol';
import type { TraceTimeline } from './timeline';

type PlaybackState = {
  readonly timeline: TraceTimeline | null;
  readonly currentStep: number;
  readonly structure: TraceStructure;
  readonly status: 'paused' | 'playing';
};

type PlaybackAction =
  | { readonly type: 'initialize'; readonly structure: TraceStructure }
  | { readonly type: 'load'; readonly timeline: TraceTimeline | null }
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'next' }
  | { readonly type: 'previous' }
  | { readonly type: 'reset' }
  | { readonly type: 'tick' };

export function createPlaybackState(structure: TraceStructure): PlaybackState {
  return { timeline: null, currentStep: 0, structure, status: 'paused' };
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
      };
    case 'play': {
      const operationCount = state.timeline?.operationCount ?? 0;
      if (operationCount === 0) return state;

      return {
        ...state,
        currentStep: state.currentStep < operationCount ? state.currentStep : 0,
        status: 'playing',
      };
    }
    case 'pause':
      return { ...state, status: 'paused' };
    case 'next':
      return {
        ...state,
        currentStep: Math.min(
          state.currentStep + 1,
          state.timeline?.operationCount ?? 0,
        ),
        status: 'paused',
      };
    case 'previous':
      return {
        ...state,
        currentStep: Math.max(state.currentStep - 1, 0),
        status: 'paused',
      };
    case 'reset':
      return { ...state, currentStep: 0, status: 'paused' };
    case 'tick': {
      if (state.status !== 'playing') return state;

      const operationCount = state.timeline?.operationCount ?? 0;
      const currentStep = Math.min(state.currentStep + 1, operationCount);
      return {
        ...state,
        currentStep,
        status: currentStep >= operationCount ? 'paused' : 'playing',
      };
    }
  }
}

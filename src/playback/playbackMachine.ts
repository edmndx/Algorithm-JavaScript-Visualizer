import { assign, setup } from 'xstate';

import type { TraceStructure } from '../protocol';
import type { TraceTimeline } from './timeline';

export const PLAYBACK_STEP_DELAY_MS = 750;

type PlaybackContext = {
  readonly timeline: TraceTimeline | null;
  readonly currentStep: number;
  readonly structure: TraceStructure;
};

type PlaybackInput = {
  readonly initialStructure: TraceStructure;
};

type PlaybackEvent =
  | { readonly type: 'LOAD'; readonly timeline: TraceTimeline | null }
  | { readonly type: 'INITIALIZE'; readonly structure: TraceStructure }
  | { readonly type: 'PLAY' }
  | { readonly type: 'PAUSE' }
  | { readonly type: 'NEXT' }
  | { readonly type: 'PREVIOUS' }
  | { readonly type: 'RESET' };

export const playbackMachine = setup({
  types: {
    context: {} as PlaybackContext,
    events: {} as PlaybackEvent,
    input: {} as PlaybackInput,
  },
  delays: {
    playbackStep: PLAYBACK_STEP_DELAY_MS,
  },
  guards: {
    hasLoadedTimeline: ({ event }) =>
      event.type === 'LOAD' && event.timeline !== null,
    hasOperations: ({ context }) =>
      context.timeline !== null && context.timeline.operationCount > 0,
    hasNextStep: ({ context }) =>
      context.timeline !== null &&
      context.currentStep < context.timeline.operationCount,
    hasPreviousStep: ({ context }) => context.currentStep > 0,
    nextStepIsFinal: ({ context }) =>
      context.timeline !== null &&
      context.currentStep + 1 >= context.timeline.operationCount,
  },
  actions: {
    loadTimeline: assign(({ event, context }) => ({
      timeline: event.type === 'LOAD' ? event.timeline : null,
      currentStep: 0,
      structure:
        event.type === 'LOAD' && event.timeline !== null
          ? event.timeline.structure
          : context.structure,
    })),
    initializeStructure: assign(({ event, context }) => ({
      timeline: null,
      currentStep: 0,
      structure:
        event.type === 'INITIALIZE' ? event.structure : context.structure,
    })),
    reset: assign({ currentStep: 0 }),
    advance: assign({
      currentStep: ({ context }) =>
        Math.min(
          context.currentStep + 1,
          context.timeline?.commands.length ?? 0,
        ),
    }),
    rewind: assign({
      currentStep: ({ context }) => Math.max(context.currentStep - 1, 0),
    }),
  },
}).createMachine({
  id: 'playback',
  initial: 'paused',
  context: ({ input }) => ({
    timeline: null,
    currentStep: 0,
    structure: input.initialStructure,
  }),
  on: {
    INITIALIZE: {
      target: '.paused',
      actions: 'initializeStructure',
    },
    LOAD: [
      {
        guard: 'hasLoadedTimeline',
        target: '.paused',
        actions: 'loadTimeline',
      },
      {
        target: '.empty',
        actions: 'loadTimeline',
      },
    ],
  },
  states: {
    empty: {},
    paused: {
      on: {
        PLAY: [
          { guard: 'hasNextStep', target: 'playing' },
          {
            guard: 'hasOperations',
            target: 'playing',
            actions: 'reset',
          },
        ],
        NEXT: { guard: 'hasNextStep', actions: 'advance' },
        PREVIOUS: { guard: 'hasPreviousStep', actions: 'rewind' },
        RESET: { actions: 'reset' },
      },
    },
    playing: {
      after: {
        playbackStep: [
          {
            guard: 'nextStepIsFinal',
            target: 'paused',
            actions: 'advance',
          },
          {
            guard: 'hasNextStep',
            target: 'playing',
            reenter: true,
            actions: 'advance',
          },
          { target: 'paused' },
        ],
      },
      on: {
        PAUSE: 'paused',
        NEXT: {
          target: 'paused',
          guard: 'hasNextStep',
          actions: 'advance',
        },
        PREVIOUS: {
          target: 'paused',
          guard: 'hasPreviousStep',
          actions: 'rewind',
        },
        RESET: { target: 'paused', actions: 'reset' },
      },
    },
  },
});

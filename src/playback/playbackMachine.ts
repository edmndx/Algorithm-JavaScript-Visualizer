import { assign, setup } from 'xstate';

import type { TraceTimeline } from './timeline';

export const PLAYBACK_STEP_DELAY_MS = 750;

type PlaybackContext = {
  readonly timeline: TraceTimeline | null;
  readonly currentStep: number;
};

type PlaybackEvent =
  | { readonly type: 'LOAD'; readonly timeline: TraceTimeline | null }
  | { readonly type: 'PLAY' }
  | { readonly type: 'PAUSE' }
  | { readonly type: 'NEXT' }
  | { readonly type: 'PREVIOUS' }
  | { readonly type: 'RESET' };

export const playbackMachine = setup({
  types: {
    context: {} as PlaybackContext,
    events: {} as PlaybackEvent,
  },
  delays: {
    playbackStep: PLAYBACK_STEP_DELAY_MS,
  },
  guards: {
    hasLoadedTimeline: ({ event }) =>
      event.type === 'LOAD' && event.timeline !== null,
    hasTimeline: ({ context }) => context.timeline !== null,
    hasNextStep: ({ context }) =>
      context.timeline !== null &&
      context.currentStep < context.timeline.commands.length,
    hasPreviousStep: ({ context }) => context.currentStep > 0,
    nextStepIsFinal: ({ context }) =>
      context.timeline !== null &&
      context.currentStep + 1 >= context.timeline.commands.length,
  },
  actions: {
    loadTimeline: assign(({ event }) => ({
      timeline: event.type === 'LOAD' ? event.timeline : null,
      currentStep: 0,
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
  initial: 'empty',
  context: {
    timeline: null,
    currentStep: 0,
  },
  on: {
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
            guard: 'hasTimeline',
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

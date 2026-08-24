import { assign, setup } from 'xstate';

import type { TraceTimeline } from './timeline';

export const PLAYBACK_STEP_DELAY_MS = 750;

type PlaybackContext = {
  readonly timeline: TraceTimeline | null;
  readonly currentFrameIndex: number;
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
    hasNextFrame: ({ context }) =>
      context.timeline !== null &&
      context.currentFrameIndex < context.timeline.commands.length,
    hasPreviousFrame: ({ context }) => context.currentFrameIndex > 0,
    nextFrameIsFinal: ({ context }) =>
      context.timeline !== null &&
      context.currentFrameIndex + 1 >= context.timeline.commands.length,
  },
  actions: {
    loadTimeline: assign(({ event }) => ({
      timeline: event.type === 'LOAD' ? event.timeline : null,
      currentFrameIndex: 0,
    })),
    reset: assign({ currentFrameIndex: 0 }),
    advance: assign({
      currentFrameIndex: ({ context }) =>
        Math.min(
          context.currentFrameIndex + 1,
          context.timeline?.commands.length ?? 0,
        ),
    }),
    rewind: assign({
      currentFrameIndex: ({ context }) =>
        Math.max(context.currentFrameIndex - 1, 0),
    }),
  },
}).createMachine({
  id: 'playback',
  initial: 'empty',
  context: {
    timeline: null,
    currentFrameIndex: 0,
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
          { guard: 'hasNextFrame', target: 'playing' },
          {
            guard: 'hasTimeline',
            target: 'playing',
            actions: 'reset',
          },
        ],
        NEXT: { guard: 'hasNextFrame', actions: 'advance' },
        PREVIOUS: { guard: 'hasPreviousFrame', actions: 'rewind' },
        RESET: { actions: 'reset' },
      },
    },
    playing: {
      after: {
        playbackStep: [
          {
            guard: 'nextFrameIsFinal',
            target: 'paused',
            actions: 'advance',
          },
          {
            guard: 'hasNextFrame',
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
          guard: 'hasNextFrame',
          actions: 'advance',
        },
        PREVIOUS: {
          target: 'paused',
          guard: 'hasPreviousFrame',
          actions: 'rewind',
        },
        RESET: { target: 'paused', actions: 'reset' },
      },
    },
  },
});

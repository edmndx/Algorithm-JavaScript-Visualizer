import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createActor } from 'xstate';

import { playbackMachine } from '../src/playback/playbackMachine';
import { buildTimeline, getPlaybackFrame } from '../src/playback/timeline';
import type { TraceCommand } from '../src/protocol';
import type { ArraySceneState, EmptySceneState } from '../src/scene';

const emptyScene: EmptySceneState = {
  structure: null,
  title: null,
  message: null,
};

function createArrayScene(itemCount: number): ArraySceneState {
  return {
    structure: 'array',
    title: 'Bubble Sort',
    message: null,
    values: Array.from({ length: itemCount }, (_, index) => index),
    itemIds: Array.from({ length: itemCount }, (_, index) =>
      `array-item-${index}`,
    ),
    labels: [],
    comparedIndices: null,
    markers: {},
  };
}

const arrayInitializationCommands: readonly TraceCommand[] = [
  { type: 'scene.init', structure: 'array' },
  { type: 'array.create', values: [8, 3, 5, 1, 4] },
];

test('accepts an array at the visualization capacity and rejects the next item', async () => {
  const { getVisualizationCapacityMessage } =
    await import('../src/visualization/visualizationLimits');

  assert.equal(getVisualizationCapacityMessage(createArrayScene(256)), null);
  assert.match(
    getVisualizationCapacityMessage(createArrayScene(257)) ?? '',
    /256 items/,
  );
});

test('renders an explicit empty state without creating an SVG', async () => {
  const { default: SceneRenderer } =
    await import('../src/visualization/SceneRenderer');
  const markup = renderToStaticMarkup(
    createElement(SceneRenderer, { scene: emptyScene }),
  );

  assert.match(markup, /Nothing to visualize yet/);
  assert.doesNotMatch(markup, /<svg/);
});

test('rejects oversized scenes before creating an SVG', async () => {
  const { default: SceneRenderer } =
    await import('../src/visualization/SceneRenderer');
  const markup = renderToStaticMarkup(
    createElement(SceneRenderer, { scene: createArrayScene(257) }),
  );

  assert.match(markup, /Visualization unavailable/);
  assert.doesNotMatch(markup, /<svg/);
});

test('dispatches a supported array scene to the shared SVG shell', async () => {
  const { default: SceneRenderer } =
    await import('../src/visualization/SceneRenderer');
  const markup = renderToStaticMarkup(
    createElement(SceneRenderer, { scene: createArrayScene(3) }),
  );

  assert.match(markup, /<svg/);
  assert.match(markup, /visualization-svg/);
});

test('treats structure initialization as a non-playable baseline', () => {
  const result = buildTimeline(arrayInitializationCommands);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const actor = createActor(playbackMachine, {
    input: { initialStructure: 'array' },
  }).start();
  actor.send({ type: 'LOAD', timeline: result.timeline });
  actor.send({ type: 'PLAY' });

  assert.equal(actor.getSnapshot().matches('paused'), true);
  assert.equal(actor.getSnapshot().context.currentStep, 0);
  actor.stop();
});

test('array identities follow swapped values and survive position updates', () => {
  const result = buildTimeline([
    { type: 'scene.init', structure: 'array' },
    { type: 'array.create', values: [2, 2, 1] },
    { type: 'array.swap', indices: [0, 2] },
    { type: 'array.set', index: 1, value: 7 },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const initial = getPlaybackFrame(result.timeline, 0).scene;
  const swapped = getPlaybackFrame(result.timeline, 1).scene;
  const updated = getPlaybackFrame(result.timeline, 2).scene;

  assert.equal(initial.structure, 'array');
  assert.equal(swapped.structure, 'array');
  assert.equal(updated.structure, 'array');
  if (
    initial.structure !== 'array' ||
    swapped.structure !== 'array' ||
    updated.structure !== 'array'
  ) {
    return;
  }

  assert.deepEqual(
    'itemIds' in initial ? initial.itemIds : undefined,
    ['array-item-0', 'array-item-1', 'array-item-2'],
  );
  assert.deepEqual(swapped.values, [1, 2, 2]);
  assert.deepEqual(
    'itemIds' in swapped ? swapped.itemIds : undefined,
    ['array-item-2', 'array-item-1', 'array-item-0'],
  );
  assert.deepEqual(updated.values, [1, 7, 2]);
  assert.deepEqual(
    'itemIds' in updated ? updated.itemIds : undefined,
    ['array-item-2', 'array-item-1', 'array-item-0'],
  );
});

test('initializing a selected structure interrupts active playback', () => {
  const result = buildTimeline([
    ...arrayInitializationCommands,
    { type: 'array.compare', indices: [0, 1] },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const actor = createActor(playbackMachine, {
    input: { initialStructure: 'array' },
  }).start();
  actor.send({ type: 'LOAD', timeline: result.timeline });
  actor.send({ type: 'PLAY' });
  assert.equal(actor.getSnapshot().matches('playing'), true);

  actor.send({ type: 'INITIALIZE', structure: 'matrix' });

  const snapshot = actor.getSnapshot();
  assert.equal(snapshot.matches('paused'), true);
  assert.equal(snapshot.context.timeline, null);
  assert.equal(snapshot.context.structure, 'matrix');
  actor.stop();
});

test('a late starter initialization cannot replace an imported trace', async () => {
  const { commitAlgorithmInitialization } =
    await import('../src/features/useAlgorithmExecution');
  const { createTraceOwnership } = await import('../src/features/traceFile');
  const ownership = createTraceOwnership();
  let loadedCommands: readonly TraceCommand[] | null = null;

  ownership.claimExecution();
  const lateInitialization = Promise.resolve({
    status: 'instrumented' as const,
    result: { ok: true as const, commands: arrayInitializationCommands },
  }).then((result) => {
    commitAlgorithmInitialization(
      result,
      ownership.isExecutionOwner,
      (commands) => {
        loadedCommands = commands;
        return buildTimeline(commands);
      },
    );
  });

  ownership.claimImport();
  await lateInitialization;

  assert.equal(loadedCommands, null);
});

test('keeps initialized algorithm operations available for playback', async () => {
  const { commitAlgorithmInitialization } =
    await import('../src/features/useAlgorithmExecution');
  const commands = [
    ...arrayInitializationCommands,
    { type: 'array.compare', indices: [0, 1] },
  ] satisfies readonly TraceCommand[];
  let timelineResult: ReturnType<typeof buildTimeline> | null = null;

  commitAlgorithmInitialization(
    {
      status: 'instrumented',
      result: { ok: true, commands },
    },
    () => true,
    (loadedCommands) => {
      timelineResult = buildTimeline(loadedCommands);
      return timelineResult;
    },
  );

  assert.ok(timelineResult?.ok);
  assert.equal(timelineResult.timeline.operationCount, 1);

  const actor = createActor(playbackMachine, {
    input: { initialStructure: 'array' },
  }).start();
  actor.send({ type: 'LOAD', timeline: timelineResult.timeline });
  actor.send({ type: 'PLAY' });

  assert.equal(actor.getSnapshot().matches('playing'), true);
  actor.stop();
});

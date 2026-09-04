import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createActor } from 'xstate';

import { playbackMachine } from '../src/playback/playbackMachine';
import { buildTimeline, getPlaybackFrame } from '../src/playback/timeline';
import {
  traceCommandSchema,
  validateTraceSemantics,
  type TraceCommand,
} from '../src/protocol';
import {
  reduceTraceCommand,
  SceneReducerError,
  type ArraySceneState,
  type EmptySceneState,
  type GraphSceneState,
  type HashTableSceneState,
  type LinkedListSceneState,
  type MatrixSceneState,
  type QueueSceneState,
  type SceneState,
  type StackSceneState,
  type TreeSceneState,
} from '../src/scene';

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
    itemIds: Array.from(
      { length: itemCount },
      (_, index) => `array-item-${index}`,
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

test('keeps count limits and rejects arrays with excessive horizontal geometry', async () => {
  const { getVisualizationCapacityMessage } =
    await import('../src/visualization/visualizationLimits');

  assert.equal(getVisualizationCapacityMessage(createArrayScene(63)), null);
  assert.match(
    getVisualizationCapacityMessage(createArrayScene(64)) ?? '',
    /readability limit of 63 items/,
  );
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

  assert.deepEqual('itemIds' in initial ? initial.itemIds : undefined, [
    'array-item-0',
    'array-item-1',
    'array-item-2',
  ]);
  assert.deepEqual(swapped.values, [1, 2, 2]);
  assert.deepEqual('itemIds' in swapped ? swapped.itemIds : undefined, [
    'array-item-2',
    'array-item-1',
    'array-item-0',
  ]);
  assert.deepEqual(updated.values, [1, 7, 2]);
  assert.deepEqual('itemIds' in updated ? updated.itemIds : undefined, [
    'array-item-2',
    'array-item-1',
    'array-item-0',
  ]);
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

const matrixScene: MatrixSceneState = {
  structure: 'matrix',
  title: 'Matrix',
  message: null,
  values: [
    [1, 2],
    [3, 4],
  ],
  itemIds: [
    ['matrix-item-0', 'matrix-item-1'],
    ['matrix-item-2', 'matrix-item-3'],
  ],
  comparedPositions: null,
  markers: {},
};

const stackScene: StackSceneState = {
  structure: 'stack',
  title: 'Stack',
  message: null,
  values: ['A', 'B'],
  itemIds: ['stack-item-0', 'stack-item-1'],
  nextItemId: 2,
  peekedIndex: 1,
  markers: {},
};

const queueScene: QueueSceneState = {
  structure: 'queue',
  title: 'Queue',
  message: null,
  values: ['A', 'B'],
  itemIds: ['queue-item-0', 'queue-item-1'],
  nextItemId: 2,
  peekedIndex: 0,
  markers: {},
};

for (const scene of [
  matrixScene,
  stackScene,
  queueScene,
] satisfies readonly SceneState[]) {
  test(`dispatches a ${scene.structure} scene to the shared SVG shell`, async () => {
    const { default: SceneRenderer } =
      await import('../src/visualization/SceneRenderer');
    const markup = renderToStaticMarkup(
      createElement(SceneRenderer, { scene }),
    );

    assert.match(markup, /<svg/);
    assert.doesNotMatch(markup, /not available yet/);
  });
}

test('matrix swaps identities and set preserves the destination identity', () => {
  const result = buildTimeline([
    { type: 'scene.init', structure: 'matrix' },
    {
      type: 'matrix.create',
      values: [
        [1, 2],
        [3, 4],
      ],
    },
    {
      type: 'matrix.swap',
      positions: [
        { row: 0, column: 0 },
        { row: 1, column: 1 },
      ],
    },
    { type: 'matrix.set', position: { row: 0, column: 1 }, value: 9 },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const initial = getPlaybackFrame(result.timeline, 0).scene;
  const swapped = getPlaybackFrame(result.timeline, 1).scene;
  const updated = getPlaybackFrame(result.timeline, 2).scene;

  assert.equal(initial.structure, 'matrix');
  assert.equal(swapped.structure, 'matrix');
  assert.equal(updated.structure, 'matrix');
  if (
    initial.structure !== 'matrix' ||
    swapped.structure !== 'matrix' ||
    updated.structure !== 'matrix'
  ) {
    return;
  }

  assert.deepEqual('itemIds' in initial ? initial.itemIds : undefined, [
    ['matrix-item-0', 'matrix-item-1'],
    ['matrix-item-2', 'matrix-item-3'],
  ]);
  assert.deepEqual(swapped.values, [
    [4, 2],
    [3, 1],
  ]);
  assert.deepEqual('itemIds' in swapped ? swapped.itemIds : undefined, [
    ['matrix-item-3', 'matrix-item-1'],
    ['matrix-item-2', 'matrix-item-0'],
  ]);
  assert.deepEqual(updated.values, [
    [4, 9],
    [3, 1],
  ]);
  assert.deepEqual('itemIds' in updated ? updated.itemIds : undefined, [
    ['matrix-item-3', 'matrix-item-1'],
    ['matrix-item-2', 'matrix-item-0'],
  ]);
});

test('stack push and pop retain existing identities without reusing IDs', () => {
  const result = buildTimeline([
    { type: 'scene.init', structure: 'stack' },
    { type: 'stack.create', values: ['A', 'B'] },
    { type: 'stack.push', value: 'C' },
    { type: 'stack.pop' },
    { type: 'stack.push', value: 'D' },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const pushed = getPlaybackFrame(result.timeline, 1).scene;
  const popped = getPlaybackFrame(result.timeline, 2).scene;
  const pushedAgain = getPlaybackFrame(result.timeline, 3).scene;
  assert.equal(pushed.structure, 'stack');
  assert.equal(popped.structure, 'stack');
  assert.equal(pushedAgain.structure, 'stack');
  if (
    pushed.structure !== 'stack' ||
    popped.structure !== 'stack' ||
    pushedAgain.structure !== 'stack'
  ) {
    return;
  }

  assert.deepEqual('itemIds' in pushed ? pushed.itemIds : undefined, [
    'stack-item-0',
    'stack-item-1',
    'stack-item-2',
  ]);
  assert.deepEqual(popped.values, ['A', 'B']);
  assert.deepEqual('itemIds' in popped ? popped.itemIds : undefined, [
    'stack-item-0',
    'stack-item-1',
  ]);
  assert.deepEqual('itemIds' in pushedAgain ? pushedAgain.itemIds : undefined, [
    'stack-item-0',
    'stack-item-1',
    'stack-item-3',
  ]);
});

test('queue dequeue removes the front identity and moves the survivors', () => {
  const result = buildTimeline([
    { type: 'scene.init', structure: 'queue' },
    { type: 'queue.create', values: ['A', 'B', 'C'] },
    { type: 'queue.dequeue' },
    { type: 'queue.enqueue', value: 'D' },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const initial = getPlaybackFrame(result.timeline, 0).scene;
  const dequeued = getPlaybackFrame(result.timeline, 1).scene;
  const enqueued = getPlaybackFrame(result.timeline, 2).scene;
  assert.equal(initial.structure, 'queue');
  assert.equal(dequeued.structure, 'queue');
  assert.equal(enqueued.structure, 'queue');
  if (
    initial.structure !== 'queue' ||
    dequeued.structure !== 'queue' ||
    enqueued.structure !== 'queue'
  ) {
    return;
  }

  assert.deepEqual('itemIds' in initial ? initial.itemIds : undefined, [
    'queue-item-0',
    'queue-item-1',
    'queue-item-2',
  ]);
  assert.deepEqual(dequeued.values, ['B', 'C']);
  assert.deepEqual('itemIds' in dequeued ? dequeued.itemIds : undefined, [
    'queue-item-1',
    'queue-item-2',
  ]);
  assert.deepEqual('itemIds' in enqueued ? enqueued.itemIds : undefined, [
    'queue-item-1',
    'queue-item-2',
    'queue-item-3',
  ]);
});

test('queue dequeueBack removes the final identity and clears transient state', () => {
  const result = buildTimeline([
    { type: 'scene.init', structure: 'queue' },
    { type: 'queue.create', values: [0, 1, 2] },
    { type: 'queue.mark', indices: [0, 2], marker: 'candidate' },
    { type: 'queue.peek' },
    { type: 'queue.dequeueBack' },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const dequeued = getPlaybackFrame(result.timeline, 3).scene;
  assert.equal(dequeued.structure, 'queue');
  if (dequeued.structure !== 'queue') return;

  assert.deepEqual(dequeued.values, [0, 1]);
  assert.deepEqual(dequeued.itemIds, ['queue-item-0', 'queue-item-1']);
  assert.equal(dequeued.peekedIndex, null);
  assert.deepEqual(dequeued.markers.candidate, [0]);
});

test('queue dequeueBack uses strict protocol validation', () => {
  assert.equal(
    traceCommandSchema.safeParse({ type: 'queue.dequeueBack' }).success,
    true,
  );
  assert.equal(
    traceCommandSchema.safeParse({
      type: 'queue.dequeueBack',
      value: 2,
    }).success,
    false,
  );
});

test('queue dequeueBack reports semantic and reducer underflow', () => {
  const commands = [
    { type: 'scene.init', structure: 'queue' },
    { type: 'queue.create', values: [] },
    { type: 'queue.dequeueBack' },
  ] as const satisfies readonly TraceCommand[];
  const validation = validateTraceSemantics(commands);

  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(validation.issues[0]?.code, 'QUEUE_UNDERFLOW');

  const emptyQueue: QueueSceneState = {
    structure: 'queue',
    title: 'Queue',
    message: null,
    values: [],
    itemIds: [],
    nextItemId: 0,
    peekedIndex: null,
    markers: {},
  };
  assert.throws(
    () =>
      reduceTraceCommand(emptyQueue, {
        type: 'queue.dequeueBack',
      }),
    (error: unknown) =>
      error instanceof SceneReducerError && error.code === 'QUEUE_UNDERFLOW',
  );
});

test('applies independent matrix, stack, and queue capacity limits', async () => {
  const { getVisualizationCapacityMessage } =
    await import('../src/visualization/visualizationLimits');

  assert.equal(
    getVisualizationCapacityMessage({
      ...matrixScene,
      values: Array.from({ length: 40 }, () => Array(40).fill(0) as number[]),
    }),
    null,
  );
  assert.match(
    getVisualizationCapacityMessage({
      ...matrixScene,
      values: [Array(1_601).fill(0) as number[]],
    }) ?? '',
    /1,600 cells/,
  );
  assert.match(
    getVisualizationCapacityMessage({
      ...matrixScene,
      values: [Array(54).fill(0) as number[]],
    }) ?? '',
    /53 columns/,
  );
  assert.match(
    getVisualizationCapacityMessage({
      ...matrixScene,
      values: Array.from({ length: 54 }, () => [0]),
    }) ?? '',
    /53 rows/,
  );
  assert.equal(
    getVisualizationCapacityMessage({
      ...stackScene,
      values: Array(79).fill(0) as number[],
    }),
    null,
  );
  assert.match(
    getVisualizationCapacityMessage({
      ...stackScene,
      values: Array(80).fill(0) as number[],
    }) ?? '',
    /readability limit of 79 items/,
  );
  assert.equal(
    getVisualizationCapacityMessage({
      ...queueScene,
      values: Array(63).fill(0) as number[],
    }),
    null,
  );
  assert.match(
    getVisualizationCapacityMessage({
      ...queueScene,
      values: Array(64).fill(0) as number[],
    }) ?? '',
    /readability limit of 63 items/,
  );
  assert.match(
    getVisualizationCapacityMessage({
      ...stackScene,
      values: Array(257).fill(0) as number[],
    }) ?? '',
    /256 items/,
  );
  assert.match(
    getVisualizationCapacityMessage({
      ...queueScene,
      values: Array(257).fill(0) as number[],
    }) ?? '',
    /256 items/,
  );
});

const linkedListScene: LinkedListSceneState = {
  structure: 'linked-list',
  title: 'Linked list',
  message: null,
  kind: 'doubly',
  headId: 'a',
  tailId: 'b',
  nodes: [
    { id: 'a', value: 1, nextId: 'b', previousId: null },
    { id: 'b', value: 2, nextId: null, previousId: 'a' },
  ],
  visitedNodeIds: [],
  markers: {},
};

test('accepts exactly two disjoint singly linked inputs when the final list is connected', () => {
  const result = buildTimeline([
    { type: 'scene.init', structure: 'linked-list' },
    {
      type: 'linked-list.create',
      kind: 'singly',
      headId: 'a',
      tailId: 'b',
      nodes: [
        { id: 'a', value: 1, nextId: 'b' },
        { id: 'b', value: 3, nextId: null },
        { id: 'c', value: 2, nextId: 'd' },
        { id: 'd', value: 4, nextId: null },
      ],
    },
    { type: 'linked-list.setNext', nodeId: 'a', nextId: 'c' },
    { type: 'linked-list.setNext', nodeId: 'c', nextId: 'b' },
    { type: 'linked-list.setNext', nodeId: 'b', nextId: 'd' },
    { type: 'linked-list.setTail', nodeId: 'd' },
  ]);

  assert.equal(result.ok, true);
});

test('rejects three disjoint linked-list components at initialization', () => {
  const validation = validateTraceSemantics([
    { type: 'scene.init', structure: 'linked-list' },
    {
      type: 'linked-list.create',
      kind: 'singly',
      headId: 'a',
      tailId: 'a',
      nodes: [
        { id: 'a', value: 1, nextId: null },
        { id: 'b', value: 2, nextId: null },
        { id: 'c', value: 3, nextId: null },
      ],
    },
    { type: 'linked-list.setNext', nodeId: 'a', nextId: 'b' },
    { type: 'linked-list.setNext', nodeId: 'b', nextId: 'c' },
    { type: 'linked-list.setTail', nodeId: 'c' },
  ]);

  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(validation.issues[0]?.code, 'LINKED_LIST_INVALID_TOPOLOGY');
  assert.equal(validation.issues[0]?.commandIndex, 1);
});

test('rejects a cyclic auxiliary linked-list component at initialization', () => {
  const validation = validateTraceSemantics([
    { type: 'scene.init', structure: 'linked-list' },
    {
      type: 'linked-list.create',
      kind: 'singly',
      headId: 'a',
      tailId: 'a',
      nodes: [
        { id: 'a', value: 1, nextId: null },
        { id: 'b', value: 2, nextId: 'c' },
        { id: 'c', value: 3, nextId: 'b' },
      ],
    },
    { type: 'linked-list.setNext', nodeId: 'c', nextId: null },
    { type: 'linked-list.setNext', nodeId: 'a', nextId: 'b' },
    { type: 'linked-list.setTail', nodeId: 'c' },
  ]);

  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(validation.issues[0]?.code, 'LINKED_LIST_INVALID_TOPOLOGY');
  assert.equal(validation.issues[0]?.commandIndex, 1);
});

test('rejects an auxiliary linked-list component that joins the primary tail', () => {
  const validation = validateTraceSemantics([
    { type: 'scene.init', structure: 'linked-list' },
    {
      type: 'linked-list.create',
      kind: 'singly',
      headId: 'a',
      tailId: 'b',
      nodes: [
        { id: 'a', value: 1, nextId: 'b' },
        { id: 'b', value: 3, nextId: null },
        { id: 'c', value: 2, nextId: 'b' },
      ],
    },
    { type: 'linked-list.setNext', nodeId: 'a', nextId: 'c' },
  ]);

  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(validation.issues[0]?.code, 'LINKED_LIST_INVALID_TOPOLOGY');
  assert.equal(validation.issues[0]?.commandIndex, 1);
});

test('rejects linked-list components that remain disconnected at the final command', () => {
  const validation = validateTraceSemantics([
    { type: 'scene.init', structure: 'linked-list' },
    {
      type: 'linked-list.create',
      kind: 'singly',
      headId: 'a',
      tailId: 'b',
      nodes: [
        { id: 'a', value: 1, nextId: 'b' },
        { id: 'b', value: 3, nextId: null },
        { id: 'c', value: 2, nextId: 'd' },
        { id: 'd', value: 4, nextId: null },
      ],
    },
  ]);

  assert.equal(validation.ok, false);
  if (validation.ok) return;
  assert.equal(validation.issues[0]?.code, 'LINKED_LIST_INVALID_TOPOLOGY');
  assert.equal(validation.issues[0]?.commandIndex, 1);
});

const hashTableScene: HashTableSceneState = {
  structure: 'hash-table',
  title: 'Hash table',
  message: null,
  bucketCount: 3,
  strategy: 'chaining',
  entries: [
    { id: 'entry-a', key: 'a', value: 1, bucketIndex: 0 },
    { id: 'entry-b', key: 'b', value: 2, bucketIndex: 0 },
  ],
  visitedBucketIndices: [],
  visitedEntryIds: [],
  markers: {},
};

for (const scene of [
  linkedListScene,
  hashTableScene,
] satisfies readonly SceneState[]) {
  test(`dispatches a ${scene.structure} scene to the shared SVG shell`, async () => {
    const { default: SceneRenderer } =
      await import('../src/visualization/SceneRenderer');
    const markup = renderToStaticMarkup(
      createElement(SceneRenderer, { scene }),
    );

    assert.match(markup, /<svg/);
    assert.doesNotMatch(markup, /not available yet/);
  });
}

test('applies linked-list and hash-table capacity limits without truncating', async () => {
  const { getVisualizationCapacityMessage } =
    await import('../src/visualization/visualizationLimits');

  assert.match(
    getVisualizationCapacityMessage({
      ...linkedListScene,
      nodes: Array.from({ length: 257 }, (_, index) => ({
        id: String(index),
        value: index,
        nextId: null,
      })),
    }) ?? '',
    /256 nodes/,
  );
  assert.match(
    getVisualizationCapacityMessage({
      ...hashTableScene,
      bucketCount: 257,
    }) ?? '',
    /256 buckets/,
  );
  assert.match(
    getVisualizationCapacityMessage({
      ...hashTableScene,
      entries: Array.from({ length: 513 }, (_, index) => ({
        id: String(index),
        key: index,
        value: index,
        bucketIndex: 0,
      })),
    }) ?? '',
    /512 entries/,
  );
  assert.match(
    getVisualizationCapacityMessage({
      ...linkedListScene,
      nodes: Array.from({ length: 21 }, (_, index) => ({
        id: String(index),
        value: index,
        nextId: index === 20 ? null : String(index + 1),
      })),
    }) ?? '',
    /readability limit of 20 nodes/,
  );
  assert.match(
    getVisualizationCapacityMessage({
      ...hashTableScene,
      bucketCount: 56,
    }) ?? '',
    /readability limit of 55 buckets/,
  );
  assert.match(
    getVisualizationCapacityMessage({
      ...hashTableScene,
      entries: Array.from({ length: 22 }, (_, index) => ({
        id: String(index),
        key: index,
        value: index,
        bucketIndex: 0,
      })),
    }) ?? '',
    /readability limit of 21 entries per bucket/,
  );
});

test('orders linked-list topology from the head', async () => {
  const { getLinkedListDisplayOrder } =
    await import('../src/visualization/renderLinkedList');
  const order = getLinkedListDisplayOrder({
    ...linkedListScene,
    headId: 'b',
    tailId: 'c',
    nodes: [
      { id: 'c', value: 3, nextId: null, previousId: 'a' },
      { id: 'b', value: 2, nextId: 'a', previousId: null },
      { id: 'a', value: 1, nextId: 'c', previousId: 'b' },
    ],
  });

  assert.deepEqual(
    order.map((node) => node.id),
    ['b', 'a', 'c'],
  );
});

test('fails closed for missing nodes and orders transient list segments', async () => {
  const { getLinkedListDisplayOrder } =
    await import('../src/visualization/renderLinkedList');

  assert.throws(
    () =>
      getLinkedListDisplayOrder({
        ...linkedListScene,
        nodes: [{ id: 'a', value: 1, nextId: 'missing', previousId: null }],
        headId: 'a',
        tailId: 'a',
      }),
    /missing/i,
  );
  assert.deepEqual(
    getLinkedListDisplayOrder({
      ...linkedListScene,
      nodes: [
        { id: 'a', value: 1, nextId: null, previousId: null },
        { id: 'detached', value: 2, nextId: null, previousId: null },
      ],
      headId: 'a',
      tailId: 'a',
    }).map((node) => node.id),
    ['a', 'detached'],
  );
});

test('creates collision-safe linked-list connection IDs', async () => {
  const renderer = await import('../src/visualization/renderLinkedList');
  assert.equal('createLinkedListConnectionId' in renderer, true);
  if (!('createLinkedListConnectionId' in renderer)) return;

  assert.notEqual(
    renderer.createLinkedListConnectionId('next', 'a', 'b:c'),
    renderer.createLinkedListConnectionId('next', 'a:b', 'c'),
  );
});

test('fails closed when a hash-table entry references an invalid bucket', async () => {
  const renderer = await import('../src/visualization/renderHashTable');
  assert.equal('groupHashTableEntries' in renderer, true);
  if (!('groupHashTableEntries' in renderer)) return;

  assert.throws(
    () =>
      renderer.groupHashTableEntries({
        ...hashTableScene,
        bucketCount: 1,
        entries: [
          {
            id: 'outside',
            key: 'outside',
            value: 1,
            bucketIndex: 1,
          },
        ],
      }),
    /outside.*bucket 1.*bucketCount/i,
  );
});

const treeScene: TreeSceneState = {
  structure: 'tree',
  title: 'Binary search tree',
  message: null,
  rootId: 'root',
  nodes: [
    { id: 'root', value: 50, children: ['left', 'right'] },
    { id: 'left', value: 30, children: [] },
    { id: 'right', value: 70, children: [] },
  ],
  comparedNodeIds: ['root', 'left'],
  visitedNodeIds: ['root'],
  markers: {},
};

test('dispatches a tree scene to the shared SVG shell', async () => {
  const { default: SceneRenderer } =
    await import('../src/visualization/SceneRenderer');
  const markup = renderToStaticMarkup(
    createElement(SceneRenderer, { scene: treeScene }),
  );

  assert.match(markup, /<svg/);
  assert.doesNotMatch(markup, /not available yet/);
});

test('lays out the same tree deterministically with one link per child', async () => {
  const { createTreeLayout } = await import('../src/visualization/treeLayout');
  const first = createTreeLayout(treeScene);
  const second = createTreeLayout(treeScene);

  assert.deepEqual(second, first);
  assert.deepEqual(
    first.nodes.map(({ id }) => id),
    ['root', 'left', 'right'],
  );
  assert.deepEqual(
    first.links.map(({ target }) => target.id),
    ['left', 'right'],
  );
});

test('creates collision-safe tree links and rejects repeated children', async () => {
  const { createTreeLayout } = await import('../src/visualization/treeLayout');
  const layout = createTreeLayout({
    ...treeScene,
    nodes: [
      { id: 'root', value: 0, children: ['a', 'a:b'] },
      { id: 'a', value: 1, children: ['b:c'] },
      { id: 'a:b', value: 2, children: ['c'] },
      { id: 'b:c', value: 3, children: [] },
      { id: 'c', value: 4, children: [] },
    ],
  });

  assert.equal(new Set(layout.links.map(({ id }) => id)).size, 4);
  assert.throws(
    () =>
      createTreeLayout({
        ...treeScene,
        nodes: [
          { id: 'root', value: 0, children: ['left', 'left'] },
          { id: 'left', value: 1, children: [] },
        ],
      }),
    /repeated/i,
  );
});

test('lays out an unbalanced single-child tree within deterministic bounds', async () => {
  const { createTreeLayout } = await import('../src/visualization/treeLayout');
  const scene: TreeSceneState = {
    ...treeScene,
    nodes: [
      { id: 'root', value: 1, children: ['child'] },
      { id: 'child', value: 2, children: ['leaf'] },
      { id: 'leaf', value: 3, children: [] },
    ],
  };
  const layout = createTreeLayout(scene);

  assert.deepEqual(
    layout.nodes.map(({ id }) => id),
    ['root', 'child', 'leaf'],
  );
  assert.ok(layout.nodes.every(({ x }) => x > 0 && x < layout.width));
  assert.ok(layout.nodes.every(({ y }) => y > 0 && y < layout.height));
});

test('lays out transient disconnected tree components deterministically', async () => {
  const { createTreeLayout } = await import('../src/visualization/treeLayout');
  const scene: TreeSceneState = {
    ...treeScene,
    nodes: [
      { id: 'root', value: 1, children: ['child'] },
      { id: 'child', value: 2, children: [] },
      { id: 'detached', value: 3, children: [] },
    ],
  };
  const first = createTreeLayout(scene);
  const second = createTreeLayout(scene);

  assert.deepEqual(second, first);
  assert.deepEqual(
    first.nodes.map(({ id }) => id),
    ['root', 'child', 'detached'],
  );
  assert.deepEqual(
    first.links.map(({ target }) => target.id),
    ['child'],
  );
  assert.ok(first.nodes.every(({ x }) => x > 0 && x < first.width));
});

test('lays out a rootless forest and rejects an oversized tree', async () => {
  const { createTreeLayout } = await import('../src/visualization/treeLayout');
  const { getVisualizationCapacityMessage } =
    await import('../src/visualization/visualizationLimits');

  const rootless = createTreeLayout({ ...treeScene, rootId: null });
  assert.deepEqual(
    rootless.nodes.map(({ id }) => id),
    ['root', 'left', 'right'],
  );
  assert.equal(rootless.links.length, 2);
  const maximumForest = createTreeLayout({
    ...treeScene,
    rootId: null,
    nodes: Array.from({ length: 39 }, (_, index) => ({
      id: String(index),
      value: index,
      children: [],
    })),
  });
  assert.equal(maximumForest.nodes.length, 39);
  assert.ok(maximumForest.width <= 4_096);
  assert.ok(maximumForest.height <= 4_096);
  assert.match(
    getVisualizationCapacityMessage({
      ...treeScene,
      nodes: Array.from({ length: 257 }, (_, index) => ({
        id: String(index),
        value: index,
        children: [],
      })),
    }) ?? '',
    /256 nodes/,
  );
  assert.match(
    getVisualizationCapacityMessage({
      ...treeScene,
      rootId: '0',
      nodes: Array.from({ length: 40 }, (_, index) => ({
        id: String(index),
        value: index,
        children: index === 39 ? [] : [String(index + 1)],
      })),
    }) ?? '',
    /readability limit of 39 nodes/,
  );
});

const circularGraphScene: GraphSceneState = {
  structure: 'graph',
  title: 'Shortest paths',
  message: null,
  nodes: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' },
  ],
  edges: [
    { id: 'a-b', from: 'a', to: 'b', weight: 4 },
    { id: 'b-c', from: 'b', to: 'c', directed: true },
  ],
  layout: 'circular',
  positions: null,
  visitedNodeIds: ['a'],
  visitedEdgeIds: ['a-b'],
  nodeMarkers: {},
  edgeMarkers: {},
  distances: { a: 0, b: 4, c: null },
};

test('dispatches a graph scene to the shared SVG shell', async () => {
  const { default: SceneRenderer } =
    await import('../src/visualization/SceneRenderer');
  const markup = renderToStaticMarkup(
    createElement(SceneRenderer, { scene: circularGraphScene }),
  );

  assert.match(markup, /<svg/);
  assert.doesNotMatch(markup, /not available yet/);
});

test('derives deterministic circular graph coordinates from node order', async () => {
  const { createGraphLayout } =
    await import('../src/visualization/graphLayout');
  const first = createGraphLayout(circularGraphScene);
  const second = createGraphLayout(circularGraphScene);

  assert.deepEqual(second, first);
  assert.deepEqual(
    first.nodes.map(({ id }) => id),
    ['a', 'b', 'c'],
  );
  assert.equal(first.nodes[0]?.x, first.width / 2);
  assert.ok((first.nodes[0]?.y ?? Infinity) < first.height / 2);
});

test('fits fixed graph coordinates without mutating supplied positions', async () => {
  const { createGraphLayout } =
    await import('../src/visualization/graphLayout');
  const positions = {
    a: { x: -10, y: 100 },
    b: { x: 30, y: 300 },
  } as const;
  const scene: GraphSceneState = {
    ...circularGraphScene,
    nodes: circularGraphScene.nodes.slice(0, 2),
    edges: circularGraphScene.edges.slice(0, 1),
    layout: 'fixed',
    positions,
  };
  const layout = createGraphLayout(scene);

  assert.deepEqual(positions, {
    a: { x: -10, y: 100 },
    b: { x: 30, y: 300 },
  });
  assert.ok(
    (layout.nodes[0]?.x ?? Infinity) < (layout.nodes[1]?.x ?? -Infinity),
  );
  assert.ok(
    (layout.nodes[0]?.y ?? Infinity) < (layout.nodes[1]?.y ?? -Infinity),
  );
});

test('preserves fixed graph aspect ratio for non-square coordinates', async () => {
  const { createGraphLayout } =
    await import('../src/visualization/graphLayout');
  const layout = createGraphLayout({
    ...circularGraphScene,
    layout: 'fixed',
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    edges: [],
    positions: {
      a: { x: -20, y: -5 },
      b: { x: 80, y: -5 },
      c: { x: -20, y: 5 },
    },
  });
  const [a, b, c] = layout.nodes;
  assert.ok(a !== undefined && b !== undefined && c !== undefined);
  if (a === undefined || b === undefined || c === undefined) return;

  const renderedRatio = (b.x - a.x) / (c.y - a.y);
  assert.ok(Math.abs(renderedRatio - 10) < 1e-9);
});

test('creates distinct deterministic geometry for graph multiedges', async () => {
  const { createGraphLayout } =
    await import('../src/visualization/graphLayout');
  const renderer = await import('../src/visualization/renderGraph');
  assert.equal('createGraphEdgeGeometries' in renderer, true);
  if (!('createGraphEdgeGeometries' in renderer)) return;

  const createLayout = (edges: GraphSceneState['edges']) =>
    createGraphLayout({
      ...circularGraphScene,
      layout: 'fixed',
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges,
      positions: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
    });

  const parallel = renderer.createGraphEdgeGeometries(
    createLayout([
      { id: 'p1', from: 'a', to: 'b', directed: true },
      { id: 'p2', from: 'a', to: 'b', directed: true },
      { id: 'p3', from: 'a', to: 'b', directed: true },
    ]).edges,
  );
  assert.equal(new Set(parallel.map(({ path }) => path)).size, 3);
  assert.equal(
    new Set(parallel.map(({ labelX, labelY }) => `${labelX}:${labelY}`)).size,
    3,
  );

  const opposite = renderer.createGraphEdgeGeometries(
    createLayout([
      { id: 'forward', from: 'a', to: 'b', directed: true },
      { id: 'reverse', from: 'b', to: 'a', directed: true },
    ]).edges,
  );
  assert.equal(new Set(opposite.map(({ path }) => path)).size, 2);

  const loops = renderer.createGraphEdgeGeometries(
    createLayout([
      { id: 'loop-1', from: 'a', to: 'a', directed: true },
      { id: 'loop-2', from: 'a', to: 'a', directed: true },
    ]).edges,
  );
  assert.equal(new Set(loops.map(({ path }) => path)).size, 2);
  assert.equal(
    new Set(loops.map(({ labelX, labelY }) => `${labelX}:${labelY}`)).size,
    2,
  );
});

test('keeps coincident graph endpoints and maximum edge families distinct and bounded', async () => {
  const { createGraphLayout } =
    await import('../src/visualization/graphLayout');
  const { createGraphEdgeGeometries, createGraphViewBox } =
    await import('../src/visualization/renderGraph');
  const scene: GraphSceneState = {
    ...circularGraphScene,
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    edges: [
      ...Array.from({ length: 11 }, (_, index) => ({
        id: `parallel-${index}`,
        from: 'a',
        to: 'b',
        directed: true,
      })),
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `loop-${index}`,
        from: 'b',
        to: 'b',
        directed: true,
      })),
      { id: 'reverse', from: 'b', to: 'a', directed: true },
    ],
    layout: 'fixed',
    positions: {
      a: { x: 7, y: 9 },
      b: { x: 7, y: 9 },
      c: { x: -100, y: 1_000 },
    },
  };
  const layout = createGraphLayout(scene);
  const geometries = createGraphEdgeGeometries(layout.edges);
  const paths = geometries.map(({ path }) => path);

  assert.equal(new Set(paths).size, paths.length);
  assert.ok(
    geometries
      .filter(({ id }) => id.startsWith('parallel') || id === 'reverse')
      .every(({ path }) => path.includes(' Q ')),
  );

  const viewBox = createGraphViewBox(
    layout.width,
    layout.height,
    layout.nodes,
    geometries,
  );
  const [minimumX, minimumY, width, height] = viewBox.split(' ').map(Number);
  assert.ok(minimumX !== undefined && minimumY !== undefined);
  assert.ok(width !== undefined && height !== undefined);
  assert.ok(minimumY < 0 || minimumX < 0);
  assert.ok(width <= 4_096);
  assert.ok(height <= 4_096);
  for (const geometry of geometries) {
    assert.ok(geometry.bounds.minimumX >= minimumX);
    assert.ok(geometry.bounds.maximumX <= minimumX + width);
    assert.ok(geometry.bounds.minimumY >= minimumY);
    assert.ok(geometry.bounds.maximumY <= minimumY + height);
  }

  const delimiterCollisionLayout = createGraphLayout({
    ...scene,
    nodes: [{ id: 'a' }, { id: 'b\0c' }, { id: 'a\0b' }, { id: 'c' }],
    edges: [
      { id: 'first', from: 'a', to: 'b\0c' },
      { id: 'second', from: 'a\0b', to: 'c' },
    ],
    positions: {
      a: { x: 0, y: 0 },
      'b\0c': { x: 0, y: 0 },
      'a\0b': { x: 0, y: 0 },
      c: { x: 0, y: 0 },
    },
  });
  assert.equal(
    new Set(
      createGraphEdgeGeometries(delimiterCollisionLayout.edges).map(
        ({ path }) => path,
      ),
    ).size,
    2,
  );
});

test('applies independent graph node and edge capacity limits', async () => {
  const { getVisualizationCapacityMessage } =
    await import('../src/visualization/visualizationLimits');

  assert.match(
    getVisualizationCapacityMessage({
      ...circularGraphScene,
      nodes: Array.from({ length: 201 }, (_, index) => ({ id: String(index) })),
      edges: [],
    }) ?? '',
    /200 nodes/,
  );
  assert.match(
    getVisualizationCapacityMessage({
      ...circularGraphScene,
      edges: Array.from({ length: 601 }, (_, index) => ({
        id: String(index),
        from: 'a',
        to: 'b',
      })),
    }) ?? '',
    /600 edges/,
  );
  assert.match(
    getVisualizationCapacityMessage({
      ...circularGraphScene,
      nodes: Array.from({ length: 81 }, (_, index) => ({ id: String(index) })),
      edges: [],
    }) ?? '',
    /readability limit of 80 nodes/,
  );
  assert.match(
    getVisualizationCapacityMessage({
      ...circularGraphScene,
      edges: Array.from({ length: 12 }, (_, index) => ({
        id: `parallel-${index}`,
        from: 'a',
        to: 'b',
      })),
    }) ?? '',
    /readability limit of 11 parallel edges/,
  );
  assert.match(
    getVisualizationCapacityMessage({
      ...circularGraphScene,
      edges: Array.from({ length: 9 }, (_, index) => ({
        id: `loop-${index}`,
        from: 'a',
        to: 'a',
      })),
    }) ?? '',
    /readability limit of 8 self-loops/,
  );
});

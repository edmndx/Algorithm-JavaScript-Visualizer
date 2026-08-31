import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTimeline, getPlaybackFrame } from '../src/playback/timeline';
import type {
  ArraySceneState,
  GraphSceneState,
  HashTableSceneState,
  LinkedListSceneState,
  MatrixSceneState,
  QueueSceneState,
  StackSceneState,
  TreeSceneState,
  SceneState,
} from '../src/scene';
import { createInitializedScene, createPlaceholderScene } from '../src/scene';
import { renderArray } from '../src/visualization/renderArray';
import { renderGraph } from '../src/visualization/renderGraph';
import { renderHashTable } from '../src/visualization/renderHashTable';
import { renderLinkedList } from '../src/visualization/renderLinkedList';
import { renderMatrix } from '../src/visualization/renderMatrix';
import { renderQueue } from '../src/visualization/renderQueue';
import { renderStack } from '../src/visualization/renderStack';
import { renderTree } from '../src/visualization/renderTree';
import {
  MAX_VISUALIZATION_VIEWBOX_DIMENSION,
  VISUALIZATION_READABILITY_LIMITS,
} from '../src/visualization/visualizationLimits';
import { createSvg, settleD3 } from './domTestEnvironment';

function createArrayScene(
  values: readonly (number | string)[],
): ArraySceneState {
  const result = buildTimeline([
    { type: 'scene.init', structure: 'array' },
    { type: 'array.create', values },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) throw result.error;

  const scene = getPlaybackFrame(result.timeline, 0).scene;
  assert.equal(scene.structure, 'array');
  if (scene.structure !== 'array') throw new Error('Expected array scene.');
  return scene;
}

function requiredElement<ElementType extends Element>(
  root: ParentNode,
  selector: string,
): ElementType {
  const element = root.querySelector<ElementType>(selector);
  assert.ok(element !== null, `Expected ${selector}.`);
  return element;
}

function numericAttribute(element: Element, name: string): number {
  const value = element.getAttribute(name);
  assert.ok(value !== null, `Expected ${name} on ${element.tagName}.`);
  const parsed = Number(value);
  assert.equal(Number.isFinite(parsed), true);
  return parsed;
}

function requireMatrixScene(scene: SceneState | undefined): MatrixSceneState {
  if (scene?.structure !== 'matrix') throw new Error('Expected matrix scene.');
  return scene;
}

test('places every initial matrix cell at its final coordinate immediately', () => {
  const scene: MatrixSceneState = {
    structure: 'matrix',
    title: null,
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
  const svg = createSvg();

  renderMatrix(svg, scene);

  assert.equal(
    requiredElement(svg, '[data-item-id="matrix-item-0"]').getAttribute(
      'transform',
    ),
    'translate(0, 0)',
  );
  assert.equal(
    requiredElement(svg, '[data-item-id="matrix-item-3"]').getAttribute(
      'transform',
    ),
    'translate(74, 74)',
  );
});

test('places the complete initial stack at stable bottom-anchored coordinates', () => {
  const scene: StackSceneState = {
    structure: 'stack',
    title: null,
    message: null,
    values: ['A', 'B'],
    itemIds: ['stack-item-0', 'stack-item-1'],
    nextItemId: 2,
    peekedIndex: null,
    markers: {},
  };
  const svg = createSvg();

  renderStack(svg, scene);

  assert.equal(
    requiredElement(svg, '[data-item-id="stack-item-0"]').getAttribute(
      'transform',
    ),
    'translate(0, 0)',
  );
  assert.equal(
    requiredElement(svg, '[data-item-id="stack-item-1"]').getAttribute(
      'transform',
    ),
    'translate(0, -50)',
  );
});

test('keeps the maximum readable stack inside the viewBox dimension limit', () => {
  const itemCount = VISUALIZATION_READABILITY_LIMITS.stackItems;
  const svg = createSvg();

  renderStack(svg, {
    structure: 'stack',
    title: null,
    message: null,
    values: Array.from({ length: itemCount }, (_, index) => index),
    itemIds: Array.from(
      { length: itemCount },
      (_, index) => `stack-item-${index}`,
    ),
    nextItemId: itemCount,
    peekedIndex: null,
    markers: {},
  });

  const [, , width, height] =
    svg.getAttribute('viewBox')?.split(' ').map(Number) ?? [];
  assert.ok(width !== undefined && height !== undefined);
  assert.ok(width <= MAX_VISUALIZATION_VIEWBOX_DIMENSION);
  assert.ok(height <= MAX_VISUALIZATION_VIEWBOX_DIMENSION);
});

test('places the complete initial queue from a stable front coordinate', () => {
  const scene: QueueSceneState = {
    structure: 'queue',
    title: null,
    message: null,
    values: ['A', 'B', 'C'],
    itemIds: ['queue-item-0', 'queue-item-1', 'queue-item-2'],
    nextItemId: 3,
    peekedIndex: null,
    markers: {},
  };
  const svg = createSvg();

  renderQueue(svg, scene);

  assert.equal(
    requiredElement(svg, '[data-item-id="queue-item-0"]').getAttribute(
      'transform',
    ),
    'translate(0, 0)',
  );
  assert.equal(
    requiredElement(svg, '[data-item-id="queue-item-2"]').getAttribute(
      'transform',
    ),
    'translate(124, 0)',
  );
});

test('keeps only structural labels inside sequential and keyed scenes', async () => {
  const stackSvg = createSvg();
  renderStack(stackSvg, {
    structure: 'stack',
    title: null,
    message: null,
    values: ['A'],
    itemIds: ['stack-item-0'],
    nextItemId: 1,
    peekedIndex: null,
    markers: {},
  });
  await settleD3();
  assert.equal(
    stackSvg.querySelector('.visualization-stack-size') === null,
    true,
  );
  assert.equal(
    requiredElement(stackSvg, '.visualization-stack-top').textContent,
    'TOP',
  );

  const listSvg = createSvg();
  renderLinkedList(listSvg, {
    structure: 'linked-list',
    title: null,
    message: null,
    kind: 'singly',
    headId: 'node-a',
    tailId: 'node-a',
    nodes: [{ id: 'node-a', value: 'A', nextId: null }],
    visitedNodeIds: [],
    markers: {},
  });
  await settleD3();
  assert.equal(
    listSvg.querySelector('.visualization-structure-label') === null,
    true,
  );
  assert.equal(listSvg.querySelector('.visualization-node-id') === null, true);
  assert.match(
    requiredElement(listSvg, '.visualization-node-role').textContent ?? '',
    /HEAD/,
  );

  const hashSvg = createSvg();
  renderHashTable(hashSvg, {
    structure: 'hash-table',
    title: null,
    message: null,
    bucketCount: 2,
    strategy: 'chaining',
    entries: [],
    visitedBucketIndices: [],
    visitedEntryIds: [],
    markers: {},
  });
  await settleD3();
  assert.equal(
    hashSvg.querySelector('.visualization-hash-strategy') === null,
    true,
  );
  assert.equal(
    hashSvg.querySelectorAll('.visualization-hash-bucket').length,
    2,
  );
});

test('renders signed array bars around a visible zero baseline', async () => {
  const svg = createSvg();
  renderArray(svg, createArrayScene([5, -5]));

  const baseline = requiredElement<SVGLineElement>(
    svg,
    '.visualization-array-baseline',
  );
  const baselineY = numericAttribute(baseline, 'y1');
  assert.equal(baseline.getAttribute('data-visible'), 'true');

  const positive = requiredElement<SVGGraphicsElement>(
    svg,
    '[data-item-id="array-item-0"] .visualization-bar',
  );
  const negative = requiredElement<SVGGraphicsElement>(
    svg,
    '[data-item-id="array-item-1"] .visualization-bar',
  );
  assert.ok(numericAttribute(positive, 'y') < baselineY);
  assert.equal(
    numericAttribute(positive, 'y') + numericAttribute(positive, 'height'),
    baselineY,
  );
  assert.equal(numericAttribute(negative, 'y'), baselineY);
  assert.ok(
    numericAttribute(negative, 'y') + numericAttribute(negative, 'height') >
      baselineY,
  );
  await settleD3();
});

test('defines the Lovable blue and red gradients used by array bars', () => {
  const svg = createSvg();
  renderArray(svg, createArrayScene([5, 3]));

  const blue = requiredElement<SVGLinearGradientElement>(
    svg,
    '#visualization-array-blue-gradient',
  );
  const red = requiredElement<SVGLinearGradientElement>(
    svg,
    '#visualization-array-red-gradient',
  );

  assert.equal(blue.getAttribute('x1'), '0%');
  assert.equal(blue.getAttribute('y1'), '100%');
  assert.equal(blue.getAttribute('x2'), '0%');
  assert.equal(blue.getAttribute('y2'), '0%');
  assert.deepEqual(
    [...blue.querySelectorAll('stop')].map((stop) =>
      stop.getAttribute('offset'),
    ),
    ['0%', '100%'],
  );
  assert.deepEqual(
    [...red.querySelectorAll('stop')].map((stop) =>
      stop.getAttribute('offset'),
    ),
    ['0%', '100%'],
  );
});

test('animates signed geometry updates on the existing array identity', async () => {
  const initial = createArrayScene([5, -5]);
  const updated: ArraySceneState = {
    ...initial,
    values: [-2, -5],
  };
  const svg = createSvg();

  renderArray(svg, initial);
  await settleD3();
  const item = requiredElement(svg, '[data-item-id="array-item-0"]');
  const bar = requiredElement<SVGRectElement>(item, '.visualization-bar');
  const valueLabel = requiredElement<SVGTextElement>(
    item,
    '.visualization-value',
  );
  const initialY = bar.getAttribute('y');
  const initialHeight = bar.getAttribute('height');
  const initialLabelY = valueLabel.getAttribute('y');

  renderArray(svg, updated);
  assert.equal(requiredElement(svg, '[data-item-id="array-item-0"]'), item);
  assert.equal(bar.getAttribute('y'), initialY);
  assert.equal(bar.getAttribute('height'), initialHeight);
  assert.equal(valueLabel.getAttribute('y'), initialLabelY);

  await settleD3();
  assert.notEqual(bar.getAttribute('height'), initialHeight);
  assert.notEqual(valueLabel.getAttribute('y'), initialLabelY);
  assert.equal(
    numericAttribute(bar, 'y'),
    numericAttribute(
      requiredElement(svg, '.visualization-array-baseline'),
      'y1',
    ),
  );
});

test('renders zero and nonnumeric array values without numeric coercion', async () => {
  const svg = createSvg();
  renderArray(svg, createArrayScene([0, 'A']));

  const baseline = requiredElement<SVGLineElement>(
    svg,
    '.visualization-array-baseline',
  );
  const zero = requiredElement<SVGGraphicsElement>(
    svg,
    '[data-item-id="array-item-0"] .visualization-bar',
  );
  const text = requiredElement<SVGGraphicsElement>(
    svg,
    '[data-item-id="array-item-1"] .visualization-bar',
  );
  assert.equal(numericAttribute(zero, 'y'), numericAttribute(baseline, 'y1'));
  assert.equal(numericAttribute(zero, 'height'), 0);
  assert.equal(text.getAttribute('data-value-kind'), 'nonnumeric');
  assert.ok(numericAttribute(text, 'height') > 0);
  await settleD3();
});

test('moves stable duplicate array identities and removes stale elements', async () => {
  const result = buildTimeline([
    { type: 'scene.init', structure: 'array' },
    { type: 'array.create', values: [2, 2, 1] },
    { type: 'array.swap', indices: [0, 2] },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const initial = getPlaybackFrame(result.timeline, 0).scene;
  const swapped = getPlaybackFrame(result.timeline, 1).scene;
  assert.equal(initial.structure, 'array');
  assert.equal(swapped.structure, 'array');
  if (initial.structure !== 'array' || swapped.structure !== 'array') return;

  const svg = createSvg();
  renderArray(svg, initial);
  const firstIdentity = requiredElement<SVGGElement>(
    svg,
    '[data-item-id="array-item-0"]',
  );
  const initialTransform = firstIdentity.getAttribute('transform');

  renderArray(svg, swapped);
  await settleD3();
  const movedIdentity = requiredElement<SVGGElement>(
    svg,
    '[data-item-id="array-item-0"]',
  );
  assert.equal(movedIdentity, firstIdentity);
  assert.notEqual(movedIdentity.getAttribute('transform'), initialTransform);
  assert.equal(movedIdentity.textContent?.includes('2'), true);

  renderArray(svg, {
    ...swapped,
    values: swapped.values.slice(0, 2),
    itemIds: swapped.itemIds.slice(0, 2),
  });
  assert.equal(svg.querySelectorAll('.visualization-array-item').length, 3);
  assert.ok(svg.querySelector('[data-item-id="array-item-0"]') !== null);
  await settleD3();
  assert.equal(svg.querySelectorAll('.visualization-array-item').length, 2);
  assert.equal(svg.querySelector('[data-item-id="array-item-0"]'), null);

  renderArray(svg, {
    ...swapped,
    values: [...swapped.values, 9],
    itemIds: [...swapped.itemIds, 'array-item-entered'],
  });
  assert.ok(svg.querySelector('[data-item-id="array-item-entered"]') !== null);
});

test('renders matrix coordinates, highlights, swaps, sets, and stale exits', async () => {
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
      type: 'matrix.compare',
      positions: [
        { row: 0, column: 0 },
        { row: 1, column: 1 },
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
  const scenes = [0, 1, 2, 3].map(
    (step) => getPlaybackFrame(result.timeline, step).scene,
  );
  const initial = requireMatrixScene(scenes[0]);
  const compared = requireMatrixScene(scenes[1]);
  const swapped = requireMatrixScene(scenes[2]);
  const updated = requireMatrixScene(scenes[3]);

  const svg = createSvg();
  renderMatrix(svg, initial);
  await settleD3();
  assert.equal(svg.querySelectorAll('.visualization-matrix-row').length, 2);
  assert.equal(svg.querySelectorAll('.visualization-matrix-column').length, 2);
  const first = requiredElement<SVGGElement>(
    svg,
    '[data-item-id="matrix-item-0"]',
  );
  const firstPosition = first.getAttribute('transform');

  renderMatrix(svg, compared);
  await settleD3();
  assert.equal(first.classList.contains('visualization-compared'), true);

  renderMatrix(svg, swapped);
  await settleD3();
  assert.equal(requiredElement(svg, '[data-item-id="matrix-item-0"]'), first);
  assert.notEqual(first.getAttribute('transform'), firstPosition);

  renderMatrix(svg, updated);
  await settleD3();
  assert.equal(
    requiredElement(svg, '[data-item-id="matrix-item-1"] .visualization-value')
      .textContent,
    '9',
  );
  const expandedViewBox = svg.getAttribute('viewBox');
  renderMatrix(svg, {
    ...updated,
    values: [updated.values[0] ?? []],
    itemIds: [updated.itemIds[0] ?? []],
  });
  assert.equal(svg.getAttribute('viewBox'), expandedViewBox);
  assert.equal(svg.querySelectorAll('.visualization-matrix-cell').length, 4);
  await settleD3();
  assert.notEqual(svg.getAttribute('viewBox'), expandedViewBox);
  assert.equal(svg.querySelectorAll('.visualization-matrix-cell').length, 2);
});

test('renders stack push and pop with the pushed identity entering and exiting', async () => {
  const result = buildTimeline([
    { type: 'scene.init', structure: 'stack' },
    { type: 'stack.create', values: ['A', 'B'] },
    { type: 'stack.push', value: 'C' },
    { type: 'stack.pop' },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const initial = getPlaybackFrame(result.timeline, 0).scene;
  const pushed = getPlaybackFrame(result.timeline, 1).scene;
  const popped = getPlaybackFrame(result.timeline, 2).scene;
  assert.equal(initial.structure, 'stack');
  assert.equal(pushed.structure, 'stack');
  assert.equal(popped.structure, 'stack');
  if (
    initial.structure !== 'stack' ||
    pushed.structure !== 'stack' ||
    popped.structure !== 'stack'
  ) {
    return;
  }

  const svg = createSvg();
  renderStack(svg, initial);
  await settleD3();
  const first = requiredElement(svg, '[data-item-id="stack-item-0"]');
  renderStack(svg, pushed);
  assert.equal(
    requiredElement(svg, '[data-item-id="stack-item-2"]').getAttribute(
      'transform',
    ),
    'translate(0, -150)',
  );
  assert.equal(first.getAttribute('transform'), 'translate(0, 0)');
  await settleD3();
  assert.equal(requiredElement(svg, '[data-item-id="stack-item-0"]'), first);
  assert.equal(
    requiredElement(svg, '[data-item-id="stack-item-2"]').getAttribute(
      'transform',
    ),
    'translate(0, -100)',
  );
  renderStack(svg, popped);
  assert.ok(svg.querySelector('[data-item-id="stack-item-2"]') !== null);
  assert.equal(first.getAttribute('transform'), 'translate(0, 0)');
  await settleD3();
  assert.equal(svg.querySelector('[data-item-id="stack-item-2"]'), null);
  assert.equal(requiredElement(svg, '[data-item-id="stack-item-0"]'), first);
});

test('renders queue dequeue by removing the front identity and moving survivors', async () => {
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

  const svg = createSvg();
  renderQueue(svg, initial);
  await settleD3();
  const second = requiredElement<SVGGElement>(
    svg,
    '[data-item-id="queue-item-1"]',
  );
  const initialPosition = second.getAttribute('transform');
  renderQueue(svg, dequeued);
  assert.ok(svg.querySelector('[data-item-id="queue-item-0"]') !== null);
  assert.equal(second.getAttribute('transform'), initialPosition);
  await settleD3();
  assert.equal(svg.querySelector('[data-item-id="queue-item-0"]'), null);
  assert.equal(requiredElement(svg, '[data-item-id="queue-item-1"]'), second);
  assert.notEqual(second.getAttribute('transform'), initialPosition);
  renderQueue(svg, enqueued);
  assert.equal(
    requiredElement(svg, '[data-item-id="queue-item-3"]').getAttribute(
      'transform',
    ),
    'translate(186, 0)',
  );
  assert.equal(second.getAttribute('transform'), 'translate(0, 0)');
  await settleD3();
  assert.equal(
    requiredElement(svg, '[data-item-id="queue-item-3"]').getAttribute(
      'transform',
    ),
    'translate(124, 0)',
  );
});

test('updates linked-list nodes and edges without retaining removed topology', async () => {
  const initial: LinkedListSceneState = {
    structure: 'linked-list',
    title: null,
    message: null,
    kind: 'doubly',
    headId: 'a',
    tailId: 'b',
    nodes: [
      { id: 'a', value: 'A', nextId: 'b', previousId: null },
      { id: 'b', value: 'B', nextId: null, previousId: 'a' },
    ],
    visitedNodeIds: ['a'],
    markers: {},
  };
  const inserted: LinkedListSceneState = {
    ...initial,
    nodes: [
      { id: 'a', value: 'A', nextId: 'c', previousId: null },
      { id: 'c', value: 'C', nextId: 'b', previousId: 'a' },
      { id: 'b', value: 'B', nextId: null, previousId: 'c' },
    ],
  };
  const removed: LinkedListSceneState = {
    ...inserted,
    headId: 'c',
    nodes: [
      { id: 'c', value: 'C', nextId: 'b', previousId: null },
      { id: 'b', value: 'B', nextId: null, previousId: 'c' },
    ],
  };

  const svg = createSvg();
  renderLinkedList(svg, initial);
  const b = requiredElement(svg, '[data-node-id="b"]');
  assert.equal(
    svg.querySelectorAll('.visualization-list-connection').length,
    2,
  );
  renderLinkedList(svg, inserted);
  assert.equal(requiredElement(svg, '[data-node-id="b"]'), b);
  assert.equal(
    requiredElement(svg, '[data-node-id="c"]').getAttribute('transform'),
    'translate(264, 28)',
  );
  assert.equal(svg.querySelectorAll('.visualization-list-node').length, 3);
  assert.equal(
    svg.querySelectorAll('.visualization-list-connection').length,
    6,
  );
  await settleD3();
  assert.equal(
    requiredElement(svg, '[data-node-id="c"]').getAttribute('transform'),
    'translate(264, 92)',
  );
  assert.equal(
    svg.querySelectorAll('.visualization-list-connection').length,
    4,
  );
  renderLinkedList(svg, removed);
  assert.ok(svg.querySelector('[data-node-id="a"]') !== null);
  assert.equal(svg.querySelectorAll('.visualization-list-node').length, 3);
  assert.equal(
    svg.querySelectorAll('.visualization-list-connection').length,
    4,
  );
  await settleD3();
  assert.equal(svg.querySelector('[data-node-id="a"]'), null);
  assert.equal(svg.querySelectorAll('.visualization-list-node').length, 2);
  assert.equal(
    svg.querySelectorAll('.visualization-list-connection').length,
    2,
  );
});

test('renders hash collisions, updates, deletion, and invalid buckets', async () => {
  const initial: HashTableSceneState = {
    structure: 'hash-table',
    title: null,
    message: null,
    bucketCount: 3,
    strategy: 'chaining',
    entries: [
      { id: 'one', key: 'one', value: 1, bucketIndex: 0 },
      { id: 'two', key: 'two', value: 2, bucketIndex: 0 },
    ],
    visitedBucketIndices: [0],
    visitedEntryIds: ['one'],
    markers: {},
  };
  const updated: HashTableSceneState = {
    ...initial,
    entries: [
      { id: 'one', key: 'one', value: 11, bucketIndex: 0 },
      { id: 'two', key: 'two', value: 2, bucketIndex: 1 },
    ],
  };
  const removed: HashTableSceneState = {
    ...updated,
    entries: updated.entries.slice(0, 1),
  };
  const inserted: HashTableSceneState = {
    ...initial,
    entries: [
      ...initial.entries,
      { id: 'three', key: 'three', value: 3, bucketIndex: 0 },
    ],
  };

  const svg = createSvg();
  renderHashTable(svg, initial);
  const one = requiredElement(
    svg,
    '[data-entry-id="one"].visualization-hash-entry',
  );
  assert.equal(svg.querySelectorAll('.visualization-hash-bucket').length, 3);
  assert.equal(svg.querySelectorAll('.visualization-hash-entry').length, 2);
  renderHashTable(svg, inserted);
  assert.equal(
    requiredElement(
      svg,
      '[data-entry-id="three"].visualization-hash-entry',
    ).getAttribute('transform'),
    'translate(72, 0)',
  );
  await settleD3();
  assert.equal(
    requiredElement(
      svg,
      '[data-entry-id="three"].visualization-hash-entry',
    ).getAttribute('transform'),
    'translate(470, 0)',
  );
  renderHashTable(svg, updated);
  assert.equal(
    requiredElement(svg, '[data-entry-id="one"].visualization-hash-entry'),
    one,
  );
  assert.equal(one.textContent?.includes('11'), true);
  await settleD3(100);
  const movedEntry = requiredElement<SVGGElement>(
    svg,
    '[data-entry-id="two"].visualization-hash-entry',
  );
  const movedConnector = requiredElement<SVGLineElement>(
    svg,
    '[data-entry-id="two"].visualization-hash-connector',
  );
  const translate = movedEntry
    .getAttribute('transform')
    ?.match(/^translate\([^,]+,\s*([^)]+)\)$/);
  assert.ok(translate?.[1] !== undefined);
  assert.ok(
    Math.abs(
      numericAttribute(movedConnector, 'y2') - (Number(translate[1]) + 27),
    ) < 1,
  );
  renderHashTable(svg, removed);
  assert.ok(
    svg.querySelector('[data-entry-id="two"].visualization-hash-entry') !==
      null,
  );
  await settleD3();
  assert.equal(
    svg.querySelector('[data-entry-id="two"].visualization-hash-entry'),
    null,
  );
  assert.throws(
    () =>
      renderHashTable(svg, {
        ...initial,
        bucketCount: 1,
        entries: [{ id: 'bad', key: 'bad', value: 0, bucketIndex: 1 }],
      }),
    /outside/i,
  );
});

test('renders and updates D3 tree hierarchy nodes and links', async () => {
  const initial: TreeSceneState = {
    structure: 'tree',
    title: null,
    message: null,
    rootId: 'root',
    nodes: [
      { id: 'root', value: 2, children: ['left', 'right'] },
      { id: 'left', value: 1, children: [] },
      { id: 'right', value: 3, children: [] },
    ],
    comparedNodeIds: ['root', 'left'],
    visitedNodeIds: ['root'],
    markers: { active: ['left'] },
  };
  const updated: TreeSceneState = {
    ...initial,
    nodes: [
      { id: 'root', value: 2, children: ['left'] },
      { id: 'left', value: 10, children: [] },
    ],
    comparedNodeIds: null,
  };

  const svg = createSvg();
  renderTree(svg, initial);
  const root = requiredElement(svg, '[data-node-id="root"]');
  assert.equal(svg.querySelectorAll('.visualization-tree-node').length, 3);
  assert.equal(svg.querySelectorAll('.visualization-tree-link').length, 2);
  const left = requiredElement(svg, '[data-node-id="left"]');
  const leftTransform = left.getAttribute('transform');
  renderTree(svg, {
    ...initial,
    comparedNodeIds: null,
    visitedNodeIds: ['root', 'left'],
    markers: {},
  });
  assert.equal(requiredElement(svg, '[data-node-id="root"]'), root);
  assert.equal(requiredElement(svg, '[data-node-id="left"]'), left);
  assert.equal(left.getAttribute('transform'), leftTransform);
  assert.equal(svg.querySelectorAll('.visualization-tree-node').length, 3);
  assert.equal(svg.querySelectorAll('.visualization-tree-link').length, 2);
  renderTree(svg, updated);
  assert.equal(requiredElement(svg, '[data-node-id="root"]'), root);
  assert.ok(svg.querySelector('[data-node-id="right"]') !== null);
  assert.equal(svg.querySelectorAll('.visualization-tree-link').length, 2);
  await settleD3(100);
  const exitingRight = requiredElement<SVGGElement>(
    svg,
    '[data-node-id="right"]',
  );
  const coordinates = exitingRight
    .getAttribute('transform')
    ?.match(/^translate\(([^,]+),\s*([^)]+)\)$/);
  const [minimumX, minimumY, width, height] =
    svg.getAttribute('viewBox')?.split(' ').map(Number) ?? [];
  assert.ok(coordinates?.[1] !== undefined && coordinates[2] !== undefined);
  assert.ok(
    minimumX !== undefined &&
      minimumY !== undefined &&
      width !== undefined &&
      height !== undefined,
  );
  const exitX = Number(coordinates[1]);
  const exitY = Number(coordinates[2]);
  assert.ok(exitX - 25 >= minimumX);
  assert.ok(exitX + 25 <= minimumX + width);
  assert.ok(exitY - 25 >= minimumY);
  assert.ok(exitY + 25 <= minimumY + height);
  await settleD3(140);
  assert.equal(svg.querySelector('[data-node-id="right"]'), null);
  assert.equal(svg.querySelectorAll('.visualization-tree-link').length, 1);
  assert.equal(
    requiredElement(svg, '[data-node-id="left"] .visualization-value')
      .textContent,
    '10',
  );
});

test('renders every valid incremental tree playback frame', async () => {
  const result = buildTimeline([
    { type: 'scene.init', structure: 'tree' },
    {
      type: 'tree.create',
      rootId: 'root',
      nodes: [{ id: 'root', value: 1, children: [] }],
    },
    {
      type: 'tree.addNode',
      node: { id: 'leaf', value: 2, children: [] },
    },
    { type: 'tree.setChildren', nodeId: 'root', children: ['leaf'] },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) throw result.error;

  const initial = getPlaybackFrame(result.timeline, 0).scene;
  const added = getPlaybackFrame(result.timeline, 1).scene;
  const connected = getPlaybackFrame(result.timeline, 2).scene;
  assert.equal(initial.structure, 'tree');
  assert.equal(added.structure, 'tree');
  assert.equal(connected.structure, 'tree');
  if (
    initial.structure !== 'tree' ||
    added.structure !== 'tree' ||
    connected.structure !== 'tree'
  ) {
    throw new Error('Expected tree scenes.');
  }

  const svg = createSvg();
  renderTree(svg, initial);
  await settleD3();
  renderTree(svg, added);
  assert.equal(
    requiredElement(svg, '[data-node-id="leaf"]').getAttribute('transform'),
    'translate(304, -6)',
  );
  await settleD3();
  assert.equal(
    requiredElement(svg, '[data-node-id="leaf"]').getAttribute('transform'),
    'translate(304, 44)',
  );
  renderTree(svg, connected);
  await settleD3();
  assert.equal(svg.querySelectorAll('.visualization-tree-node').length, 2);
  assert.equal(svg.querySelectorAll('.visualization-tree-link').length, 1);
});

test('renders distinct graph paths and removes stale nodes and edges', async () => {
  const initial: GraphSceneState = {
    structure: 'graph',
    title: null,
    message: null,
    nodes: [{ id: 'a' }, { id: 'b' }],
    edges: [
      { id: 'p1', from: 'a', to: 'b', directed: true },
      { id: 'p2', from: 'a', to: 'b', directed: true },
      { id: 'reverse', from: 'b', to: 'a', directed: true },
      { id: 'loop-1', from: 'a', to: 'a', directed: true },
      { id: 'loop-2', from: 'a', to: 'a', directed: true },
    ],
    layout: 'fixed',
    positions: { a: { x: 0, y: 0 }, b: { x: 100, y: 20 } },
    visitedNodeIds: ['a'],
    visitedEdgeIds: ['p1'],
    nodeMarkers: {},
    edgeMarkers: {},
    distances: {},
  };
  const updated: GraphSceneState = {
    ...initial,
    nodes: [{ id: 'a' }],
    edges: initial.edges.filter((edge) => edge.from === 'a' && edge.to === 'a'),
    positions: { a: { x: 0, y: 0 } },
  };
  const added: GraphSceneState = {
    ...initial,
    nodes: [...initial.nodes, { id: 'c' }],
    positions: {
      ...initial.positions,
      c: { x: 50, y: 100 },
    },
  };

  const svg = createSvg();
  renderGraph(svg, initial);
  const paths = [
    ...svg.querySelectorAll<SVGPathElement>('.visualization-graph-edge'),
  ].map((path) => path.getAttribute('d'));
  assert.equal(paths.length, 5);
  assert.equal(new Set(paths).size, 5);
  const a = requiredElement(svg, '[data-node-id="a"]');
  const b = requiredElement(svg, '[data-node-id="b"]');
  const bTransform = b.getAttribute('transform');
  renderGraph(svg, {
    ...initial,
    visitedNodeIds: ['a', 'b'],
    visitedEdgeIds: ['p1', 'p2'],
  });
  assert.equal(requiredElement(svg, '[data-node-id="a"]'), a);
  assert.equal(requiredElement(svg, '[data-node-id="b"]'), b);
  assert.equal(b.getAttribute('transform'), bTransform);
  assert.equal(svg.querySelectorAll('.visualization-graph-edge').length, 5);
  renderGraph(svg, added);
  assert.equal(
    requiredElement(svg, '[data-node-id="c"]').getAttribute('transform'),
    'translate(320, 210)',
  );
  await settleD3();
  assert.equal(
    requiredElement(svg, '[data-node-id="c"]').getAttribute('transform'),
    'translate(320, 356)',
  );
  renderGraph(svg, updated);
  assert.equal(requiredElement(svg, '[data-node-id="a"]'), a);
  assert.ok(svg.querySelector('[data-node-id="b"]') !== null);
  assert.equal(svg.querySelectorAll('.visualization-graph-edge').length, 5);
  await settleD3();
  assert.equal(svg.querySelector('[data-node-id="b"]'), null);
  assert.equal(svg.querySelectorAll('.visualization-graph-edge').length, 2);
});

test('renders bounded graph edge families and preserves path arity on update', async () => {
  const edges = [
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
  ];
  const initial: GraphSceneState = {
    structure: 'graph',
    title: null,
    message: null,
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    edges,
    layout: 'fixed',
    positions: {
      a: { x: 1_000, y: 9 },
      b: { x: 1_000, y: 9 },
      c: { x: 0, y: 9 },
    },
    visitedNodeIds: [],
    visitedEdgeIds: [],
    nodeMarkers: {},
    edgeMarkers: {},
    distances: {},
  };
  const svg = createSvg();
  renderGraph(svg, initial);

  const [minimumX, minimumY, width, height] =
    svg.getAttribute('viewBox')?.split(' ').map(Number) ?? [];
  assert.ok(minimumX !== undefined && minimumY !== undefined);
  assert.ok(width !== undefined && height !== undefined);
  assert.ok(minimumX + width > 640 || minimumY + height > 420);
  assert.ok(width <= 4_096 && height <= 4_096);
  assert.equal(svg.querySelectorAll('.visualization-graph-edge').length, 19);
  const stableViewBox = svg.getAttribute('viewBox');

  renderGraph(svg, { ...initial, edges: [edges[0]!] });
  assert.equal(svg.getAttribute('viewBox'), stableViewBox);
  await settleD3(100);
  assert.equal(svg.getAttribute('viewBox'), stableViewBox);
  await settleD3(140);
  assert.match(
    requiredElement<SVGPathElement>(
      svg,
      '[data-edge-id="parallel-0"]',
    ).getAttribute('d') ?? '',
    / Q /,
  );
});

test('preserves cubic path arity while self-loops enter and exit', async () => {
  const initial: GraphSceneState = {
    structure: 'graph',
    title: null,
    message: null,
    nodes: [{ id: 'a' }],
    edges: [],
    layout: 'fixed',
    positions: { a: { x: 0, y: 0 } },
    visitedNodeIds: [],
    visitedEdgeIds: [],
    nodeMarkers: {},
    edgeMarkers: {},
    distances: {},
  };
  const withLoops: GraphSceneState = {
    ...initial,
    edges: [
      { id: 'loop-1', from: 'a', to: 'a', directed: true },
      { id: 'loop-2', from: 'a', to: 'a', directed: true },
    ],
  };
  const svg = createSvg();

  renderGraph(svg, initial);
  renderGraph(svg, withLoops);
  for (const path of svg.querySelectorAll<SVGPathElement>(
    '.visualization-graph-edge',
  )) {
    assert.match(path.getAttribute('d') ?? '', / C /);
  }
  await settleD3(100);
  for (const path of svg.querySelectorAll<SVGPathElement>(
    '.visualization-graph-edge',
  )) {
    assert.match(path.getAttribute('d') ?? '', / C /);
  }
  await settleD3(140);

  renderGraph(svg, initial);
  for (const path of svg.querySelectorAll<SVGPathElement>(
    '.visualization-graph-edge',
  )) {
    assert.match(path.getAttribute('d') ?? '', / C /);
  }
  await settleD3();
  assert.equal(svg.querySelectorAll('.visualization-graph-edge').length, 0);
});

test('renders loaded frame zero immediately after the pre-trace placeholder', async () => {
  const [{ createElement, act }, { createRoot }, { default: SceneRenderer }] =
    await Promise.all([
      import('react'),
      import('react-dom/client'),
      import('../src/visualization/SceneRenderer'),
    ]);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const placeholder = createPlaceholderScene('array');
  const frameZero = createArrayScene([8, 3, 5]);

  await act(async () => {
    root.render(createElement(SceneRenderer, { scene: placeholder }));
  });
  await act(async () => {
    root.render(createElement(SceneRenderer, { scene: frameZero }));
  });

  assert.equal(
    container.querySelectorAll('.visualization-array-item').length,
    3,
  );
  for (const item of container.querySelectorAll<SVGGElement>(
    '.visualization-array-item',
  )) {
    assert.notEqual(item.style.opacity, '0');
  }

  await act(async () => root.unmount());
  container.remove();
});

test('stages the first real stack push after an empty frame zero', async () => {
  const [{ createElement, act }, { createRoot }, { default: SceneRenderer }] =
    await Promise.all([
      import('react'),
      import('react-dom/client'),
      import('../src/visualization/SceneRenderer'),
    ]);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const placeholder = createPlaceholderScene('stack');
  const frameZero = createInitializedScene('stack');
  const pushed: StackSceneState = {
    ...frameZero,
    values: ['A'],
    itemIds: ['stack-item-0'],
    nextItemId: 1,
  };

  await act(async () => {
    root.render(createElement(SceneRenderer, { scene: placeholder }));
  });
  await act(async () => {
    root.render(createElement(SceneRenderer, { scene: frameZero }));
  });
  await act(async () => {
    root.render(createElement(SceneRenderer, { scene: pushed }));
  });

  const item = requiredElement<SVGGElement>(
    container,
    '[data-item-id="stack-item-0"]',
  );
  const stagedCoordinates = item
    .getAttribute('transform')
    ?.match(/^translate\(([^,]+),\s*([^)]+)\)$/);
  assert.ok(stagedCoordinates?.[2] !== undefined);
  assert.ok(Number(stagedCoordinates[2]) <= -49);
  assert.ok(Number(item.style.opacity) <= 0.05);

  await act(async () => root.unmount());
  container.remove();
});

test('cancels a pending viewBox release when the SVG unmounts', async () => {
  const [{ createElement, act }, { createRoot }, { default: SceneRenderer }] =
    await Promise.all([
      import('react'),
      import('react-dom/client'),
      import('../src/visualization/SceneRenderer'),
    ]);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const largeStack: StackSceneState = {
    structure: 'stack',
    title: null,
    message: null,
    values: Array.from({ length: 10 }, (_, index) => index),
    itemIds: Array.from({ length: 10 }, (_, index) => `stack-item-${index}`),
    nextItemId: 10,
    peekedIndex: null,
    markers: {},
  };
  const tree: TreeSceneState = {
    structure: 'tree',
    title: null,
    message: null,
    rootId: 'root',
    nodes: [{ id: 'root', value: 1, children: [] }],
    comparedNodeIds: null,
    visitedNodeIds: [],
    markers: {},
  };

  await act(async () => {
    root.render(createElement(SceneRenderer, { scene: largeStack }));
  });
  await settleD3();
  const svg = requiredElement<SVGSVGElement>(container, 'svg');
  await act(async () => {
    root.render(
      createElement(SceneRenderer, {
        scene: {
          ...largeStack,
          values: largeStack.values.slice(0, 1),
          itemIds: largeStack.itemIds.slice(0, 1),
        },
      }),
    );
  });
  const retainedViewBox = svg.getAttribute('viewBox');
  await act(async () => {
    root.render(createElement(SceneRenderer, { scene: tree }));
  });
  await settleD3();

  assert.equal(svg.getAttribute('viewBox'), retainedViewBox);

  await act(async () => root.unmount());
  container.remove();
});

test('SceneRenderer runs D3 effects and cleans interrupted structure changes', async () => {
  const [{ createElement, act }, { createRoot }, { default: SceneRenderer }] =
    await Promise.all([
      import('react'),
      import('react-dom/client'),
      import('../src/visualization/SceneRenderer'),
    ]);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const array = createArrayScene([5, -5]);
  const queue: QueueSceneState = {
    structure: 'queue',
    title: null,
    message: null,
    values: ['A', 'B'],
    itemIds: ['queue-item-0', 'queue-item-1'],
    nextItemId: 2,
    peekedIndex: null,
    markers: {},
  };
  const tree: TreeSceneState = {
    structure: 'tree',
    title: null,
    message: null,
    rootId: 'root',
    nodes: [{ id: 'root', value: 1, children: [] }],
    comparedNodeIds: null,
    visitedNodeIds: [],
    markers: {},
  };
  const stack: StackSceneState = {
    structure: 'stack',
    title: null,
    message: null,
    values: ['A', 'B', 'C'],
    itemIds: ['stack-item-0', 'stack-item-1', 'stack-item-2'],
    nextItemId: 3,
    peekedIndex: null,
    markers: {},
  };

  await act(async () => {
    root.render(createElement(SceneRenderer, { scene: array }));
  });
  assert.ok(container.querySelector('.visualization-array-item') !== null);
  await act(async () => {
    root.render(createElement(SceneRenderer, { scene: queue }));
  });
  await act(async () => {
    root.render(createElement(SceneRenderer, { scene: stack }));
  });
  const exitingTop = requiredElement(
    container,
    '[data-item-id="stack-item-2"]',
  );
  await act(async () => {
    root.render(
      createElement(SceneRenderer, {
        scene: {
          ...stack,
          values: stack.values.slice(0, 2),
          itemIds: stack.itemIds.slice(0, 2),
        },
      }),
    );
  });
  assert.equal(
    requiredElement(container, '[data-item-id="stack-item-2"]'),
    exitingTop,
  );
  await act(async () => {
    root.render(createElement(SceneRenderer, { scene: stack }));
  });
  await settleD3();
  assert.equal(
    requiredElement(container, '[data-item-id="stack-item-2"]'),
    exitingTop,
  );
  assert.equal(
    container.querySelectorAll('.visualization-stack-item').length,
    3,
  );
  await act(async () => {
    root.render(createElement(SceneRenderer, { scene: tree }));
  });
  await settleD3();
  assert.equal(container.querySelector('.visualization-array'), null);
  assert.equal(container.querySelector('.visualization-queue'), null);
  assert.equal(container.querySelector('.visualization-stack'), null);
  assert.ok(container.querySelector('.visualization-tree-node') !== null);

  await act(async () => root.unmount());
  container.remove();
});

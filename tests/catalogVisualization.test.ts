import assert from 'node:assert/strict';
import test from 'node:test';

import { createElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { algorithmCatalog, type AlgorithmId } from '../src/data/catalog';
import { parseJavaScript } from '../src/instrumentation/ast';
import { instrumentJavaScript } from '../src/instrumentation/instrumentJavaScript';
import { buildTimeline, getPlaybackFrame } from '../src/playback/timeline';
import { TRACE_PROTOCOL_VERSION, validateTrace } from '../src/protocol';
import { runCode } from '../src/runner/runner';
import type { SceneState } from '../src/scene';
import SceneRenderer from '../src/visualization/SceneRenderer';
import { createGraphLayout } from '../src/visualization/graphLayout';
import { getVisualizationCapacityMessage } from '../src/visualization/visualizationLimits';
import { groupHashTableEntries } from '../src/visualization/renderHashTable';
import { getLinkedListDisplayOrder } from '../src/visualization/renderLinkedList';
import { createTreeLayout } from '../src/visualization/treeLayout';
import { settleD3 } from './domTestEnvironment';

function executeCatalogSource(code: string): readonly unknown[][] {
  const output: unknown[][] = [];
  const console = { log: (...values: unknown[]) => output.push(values) };
  Function('console', `"use strict";\n${code}`)(console);
  return output;
}

const expectedLastConsoleValue = {
  'maximum-subarray': 6,
  'spiral-matrix-traversal': [1, 2, 3, 6, 9, 8, 7, 4, 5],
  'rotate-matrix': [
    [7, 4, 1],
    [8, 5, 2],
    [9, 6, 3],
  ],
  'matrix-transpose': [
    [1, 0, 1],
    [0, 0, 0],
    [1, 0, 1],
  ],
  'in-order-traversal': 3,
  'pre-order-traversal': true,
  'post-order-traversal': [[3], [9, 20], [15, 7]],
  'balanced-parentheses': true,
  'postfix-evaluation': [1, 1, 4, 2, 1, 1, 0, 0],
  'next-greater-element': 10,
  'breadth-first-search': true,
  'generate-binary-numbers': [3, 3, 5, 5, 6, 7],
  'reverse-queue': 4,
  'linked-list-cycle': true,
  'group-anagrams': [['eat', 'tea', 'ate'], ['tan', 'nat'], ['bat']],
  'frequency-counter': 4,
} as const;

function catalogAlgorithm(id: AlgorithmId) {
  const algorithm = algorithmCatalog.find((entry) => entry.id === id);
  assert.ok(algorithm !== undefined, `Missing catalog algorithm: ${id}`);
  return algorithm;
}

function linkedListValueChain(value: unknown): readonly unknown[] {
  const values: unknown[] = [];
  let current = value;

  while (typeof current === 'object' && current !== null) {
    assert.ok('value' in current, 'Expected a linked-list value.');
    assert.ok('next' in current, 'Expected a linked-list next pointer.');
    values.push(current.value);
    current = current.next;
  }

  assert.equal(current, null, 'Expected the linked list to terminate.');
  return values;
}

function commandTypes(
  commands: readonly { readonly type: string }[],
): readonly string[] {
  return commands.map(({ type }) => type);
}

function assertFrameSemantics(scene: SceneState): void {
  assert.equal(getVisualizationCapacityMessage(scene), null);

  switch (scene.structure) {
    case null:
      throw new Error('Catalog playback produced an empty scene.');
    case 'array':
      assert.equal(scene.itemIds.length, scene.values.length);
      assert.equal(new Set(scene.itemIds).size, scene.itemIds.length);
      break;
    case 'matrix':
      assert.equal(scene.itemIds.length, scene.values.length);
      for (const [row, values] of scene.values.entries()) {
        assert.equal(scene.itemIds[row]?.length, values.length);
      }
      assert.equal(
        new Set(scene.itemIds.flat()).size,
        scene.itemIds.flat().length,
      );
      break;
    case 'stack':
    case 'queue':
      assert.equal(scene.itemIds.length, scene.values.length);
      assert.equal(new Set(scene.itemIds).size, scene.itemIds.length);
      break;
    case 'linked-list':
      assert.equal(getLinkedListDisplayOrder(scene).length, scene.nodes.length);
      break;
    case 'hash-table':
      assert.equal(
        groupHashTableEntries(scene).flat().length,
        scene.entries.length,
      );
      break;
    case 'tree':
      assert.equal(createTreeLayout(scene).nodes.length, scene.nodes.length);
      break;
    case 'graph':
      assert.equal(createGraphLayout(scene).nodes.length, scene.nodes.length);
      break;
  }
}

function visitedTreeValues(scene: Extract<SceneState, { structure: 'tree' }>) {
  const valuesById = new Map(scene.nodes.map((node) => [node.id, node.value]));
  return scene.visitedNodeIds.map((id) => valuesById.get(id));
}

function hashEntries(scene: Extract<SceneState, { structure: 'hash-table' }>) {
  return scene.entries.map(({ bucketIndex, key, value }) => ({
    bucketIndex,
    key,
    value,
  }));
}

function assertRenderedEntities(svg: SVGSVGElement, scene: SceneState): void {
  switch (scene.structure) {
    case null:
      throw new Error('Cannot assert SVG entities for an empty scene.');
    case 'array':
      assert.equal(
        svg.querySelectorAll('.visualization-array-item').length,
        scene.values.length,
      );
      return;
    case 'matrix':
      assert.equal(
        svg.querySelectorAll('.visualization-matrix-cell').length,
        scene.values.flat().length,
      );
      return;
    case 'stack':
      assert.equal(
        svg.querySelectorAll('.visualization-stack-item').length,
        scene.values.length,
      );
      return;
    case 'queue':
      assert.equal(
        svg.querySelectorAll('.visualization-queue-item').length,
        scene.values.length,
      );
      return;
    case 'linked-list':
      assert.equal(
        svg.querySelectorAll('.visualization-list-node').length,
        scene.nodes.length,
      );
      return;
    case 'hash-table':
      assert.equal(
        svg.querySelectorAll('.visualization-hash-bucket').length,
        scene.bucketCount,
      );
      assert.equal(
        svg.querySelectorAll('.visualization-hash-entry').length,
        scene.entries.length,
      );
      return;
    case 'tree':
      assert.equal(
        svg.querySelectorAll('.visualization-tree-node').length,
        scene.nodes.length,
      );
      assert.equal(
        svg.querySelectorAll('.visualization-tree-link').length,
        Math.max(0, scene.nodes.length - 1),
      );
      return;
    case 'graph':
      assert.equal(
        svg.querySelectorAll('.visualization-graph-node').length,
        scene.nodes.length,
      );
      assert.equal(
        svg.querySelectorAll('.visualization-graph-edge').length,
        scene.edges.length,
      );
      return;
  }
}

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort();
}

function assertPersistentInitialStructure(scenes: readonly SceneState[]): void {
  const initial = scenes[0];
  if (initial === undefined) throw new Error('Expected an initial scene.');

  for (const scene of scenes) {
    assert.equal(scene.structure, initial.structure);
    switch (initial.structure) {
      case null:
        throw new Error('Catalog playback produced an empty initial scene.');
      case 'array':
        if (scene.structure === 'array') {
          assert.deepEqual(sorted(scene.itemIds), sorted(initial.itemIds));
        }
        break;
      case 'matrix':
        if (scene.structure === 'matrix') {
          assert.deepEqual(
            sorted(scene.itemIds.flat()),
            sorted(initial.itemIds.flat()),
          );
        }
        break;
      case 'linked-list':
        if (scene.structure === 'linked-list') {
          assert.deepEqual(
            sorted(scene.nodes.map(({ id }) => id)),
            sorted(initial.nodes.map(({ id }) => id)),
          );
        }
        break;
      case 'tree':
        if (scene.structure === 'tree') {
          assert.deepEqual(scene.nodes, initial.nodes);
        }
        break;
      case 'graph':
        if (scene.structure === 'graph') {
          assert.deepEqual(scene.nodes, initial.nodes);
          assert.deepEqual(scene.edges, initial.edges);
        }
        break;
      case 'stack':
      case 'queue':
      case 'hash-table':
        break;
    }
  }
}

function assertUsefulInitialStructure(scene: SceneState): void {
  switch (scene.structure) {
    case null:
      throw new Error('Catalog playback produced an empty initial scene.');
    case 'array':
    case 'stack':
    case 'queue':
      assert.ok(scene.values.length > 0);
      return;
    case 'matrix':
      assert.ok(scene.values.length > 0);
      assert.ok(scene.values.every((row) => row.length > 0));
      return;
    case 'linked-list':
    case 'tree':
      assert.ok(scene.nodes.length > 0);
      return;
    case 'graph':
      assert.ok(scene.nodes.length > 0);
      assert.ok(scene.edges.length > 0);
      return;
    case 'hash-table':
      assert.ok(scene.bucketCount > 0);
      return;
  }
}

function renderedEntityMap(
  svg: SVGSVGElement,
  scene: SceneState,
): ReadonlyMap<string, Element> {
  const entities = new Map<string, Element>();
  const collect = (selector: string, attribute: string, prefix: string) => {
    for (const element of svg.querySelectorAll(selector)) {
      const id = element.getAttribute(attribute);
      assert.ok(id !== null, `Expected ${attribute} on ${selector}.`);
      entities.set(`${prefix}:${id}`, element);
    }
  };

  switch (scene.structure) {
    case null:
      throw new Error('Cannot collect SVG entities for an empty scene.');
    case 'array':
      collect('.visualization-array-item', 'data-item-id', 'item');
      break;
    case 'matrix':
      collect('.visualization-matrix-cell', 'data-item-id', 'item');
      break;
    case 'stack':
      collect('.visualization-stack-item', 'data-item-id', 'item');
      break;
    case 'queue':
      collect('.visualization-queue-item', 'data-item-id', 'item');
      break;
    case 'linked-list':
      collect('.visualization-list-node', 'data-node-id', 'node');
      collect('.visualization-list-connection', 'data-edge-id', 'edge');
      break;
    case 'hash-table':
      collect('.visualization-hash-bucket', 'data-bucket-index', 'bucket');
      collect('.visualization-hash-entry', 'data-entry-id', 'entry');
      break;
    case 'tree':
      collect('.visualization-tree-node', 'data-node-id', 'node');
      collect('.visualization-tree-link', 'data-edge-id', 'edge');
      break;
    case 'graph':
      collect('.visualization-graph-node', 'data-node-id', 'node');
      collect('.visualization-graph-edge', 'data-edge-id', 'edge');
      break;
  }

  return entities;
}

function assertExpectedFinalScene(id: AlgorithmId, scene: SceneState): void {
  switch (id) {
    case 'bubble-sort':
      assert.equal(scene.structure, 'array');
      if (scene.structure === 'array')
        assert.deepEqual(scene.values, [1, 8, 6, 2, 5, 4, 8, 3, 7]);
      return;
    case 'binary-search':
      assert.equal(scene.structure, 'array');
      if (scene.structure === 'array') {
        assert.deepEqual(scene.values, [1, 3, 5, 8, 13]);
        assert.deepEqual(scene.markers.probe, [3]);
      }
      return;
    case 'maximum-subarray':
      assert.equal(scene.structure, 'array');
      if (scene.structure === 'array') {
        assert.deepEqual(scene.values, [-2, 1, -2, 4, 3, 5, 6, 1, 5]);
        assert.ok(
          scene.values.some((value) => typeof value === 'number' && value < 0),
        );
      }
      return;
    case 'matrix-transpose':
      assert.equal(scene.structure, 'matrix');
      if (scene.structure === 'matrix')
        assert.deepEqual(scene.values, [
          [1, 0, 1],
          [0, 0, 0],
          [1, 0, 1],
        ]);
      return;
    case 'spiral-matrix-traversal':
      assert.equal(scene.structure, 'matrix');
      if (scene.structure === 'matrix')
        assert.deepEqual(scene.values, [
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9],
        ]);
      return;
    case 'rotate-matrix':
      assert.equal(scene.structure, 'matrix');
      if (scene.structure === 'matrix')
        assert.deepEqual(scene.values, [
          [7, 4, 1],
          [8, 5, 2],
          [9, 6, 3],
        ]);
      return;
    case 'in-order-traversal':
      assert.equal(scene.structure, 'tree');
      if (scene.structure === 'tree')
        assert.deepEqual(visitedTreeValues(scene), [3, 9, 20, 15, 7]);
      return;
    case 'pre-order-traversal':
      assert.equal(scene.structure, 'tree');
      if (scene.structure === 'tree')
        assert.deepEqual(visitedTreeValues(scene), [5, 3, 2, 4, 8, 7, 9]);
      return;
    case 'post-order-traversal':
      assert.equal(scene.structure, 'tree');
      if (scene.structure === 'tree')
        assert.deepEqual(visitedTreeValues(scene), [3, 9, 20, 15, 7]);
      return;
    case 'balanced-parentheses':
      assert.equal(scene.structure, 'stack');
      if (scene.structure === 'stack') assert.deepEqual(scene.values, []);
      return;
    case 'postfix-evaluation':
      assert.equal(scene.structure, 'stack');
      if (scene.structure === 'stack') assert.deepEqual(scene.values, []);
      return;
    case 'next-greater-element':
      assert.equal(scene.structure, 'stack');
      if (scene.structure === 'stack') assert.deepEqual(scene.values, []);
      return;
    case 'breadth-first-search':
      assert.equal(scene.structure, 'graph');
      if (scene.structure === 'graph') {
        assert.deepEqual(scene.visitedNodeIds, ['0', '1', '2', '3']);
        assert.deepEqual(scene.visitedEdgeIds, [
          '0->1',
          '0->2',
          '1->3',
          '2->3',
        ]);
      }
      return;
    case 'generate-binary-numbers':
      assert.equal(scene.structure, 'queue');
      if (scene.structure === 'queue') assert.deepEqual(scene.values, []);
      return;
    case 'reverse-queue':
      assert.equal(scene.structure, 'queue');
      if (scene.structure === 'queue') assert.deepEqual(scene.values, []);
      return;
    case 'reverse-linked-list':
      assert.equal(scene.structure, 'linked-list');
      if (scene.structure === 'linked-list') {
        assert.deepEqual(
          getLinkedListDisplayOrder(scene).map((node) => node.value),
          [3, 2, 1],
        );
      }
      return;
    case 'linked-list-cycle':
      assert.equal(scene.structure, 'linked-list');
      if (scene.structure === 'linked-list') {
        assert.deepEqual(
          getLinkedListDisplayOrder(scene).map((node) => node.value),
          [1, 2, 3],
        );
        assert.deepEqual(scene.visitedNodeIds, ['node-1', 'node-2']);
      }
      return;
    case 'linked-list-middle':
      assert.equal(scene.structure, 'linked-list');
      if (scene.structure === 'linked-list') {
        assert.deepEqual(
          getLinkedListDisplayOrder(scene).map((node) => node.value),
          [1, 1, 2, 3, 4, 4],
        );
      }
      return;
    case 'two-sum':
      assert.equal(scene.structure, 'hash-table');
      if (scene.structure === 'hash-table') {
        assert.deepEqual(hashEntries(scene), [
          { bucketIndex: 2, key: 2, value: 0 },
        ]);
      }
      return;
    case 'frequency-counter':
      assert.equal(scene.structure, 'hash-table');
      if (scene.structure === 'hash-table') {
        assert.deepEqual(hashEntries(scene), [
          { bucketIndex: 3, key: 100, value: 1 },
          { bucketIndex: 11, key: 4, value: 1 },
          { bucketIndex: 5, key: 200, value: 1 },
          { bucketIndex: 7, key: 1, value: 1 },
          { bucketIndex: 14, key: 3, value: 1 },
          { bucketIndex: 2, key: 2, value: 1 },
        ]);
      }
      return;
    case 'group-anagrams':
      assert.equal(scene.structure, 'hash-table');
      if (scene.structure === 'hash-table') {
        assert.deepEqual(hashEntries(scene), [
          { bucketIndex: 13, key: 'aet', value: 0 },
          { bucketIndex: 13, key: 'ant', value: 1 },
          { bucketIndex: 0, key: 'abt', value: 2 },
        ]);
      }
      return;
  }
}

test('catalog sources return their hand-derived results', () => {
  for (const [id, expected] of Object.entries(expectedLastConsoleValue)) {
    const algorithm = catalogAlgorithm(id as AlgorithmId);
    const output = executeCatalogSource(algorithm.code);

    assert.deepEqual(
      output.at(-1)?.at(-1),
      expected,
      `${algorithm.name} returned an unexpected final console value.`,
    );
  }
});

test('Longest Consecutive Sequence checks duplicate-heavy input in linear time', () => {
  const algorithm = catalogAlgorithm('frequency-counter');
  const duplicateHeavySource = algorithm.code.replace(
    'const numbers = [100, 4, 200, 1, 3, 2];',
    'const numbers = [...Array(200).fill(1), ...Array.from({ length: 199 }, (_, index) => index + 2)];',
  );
  let hasOperations = 0;

  class CountingMap<Key, Value> extends Map<Key, Value> {
    override has(key: Key): boolean {
      hasOperations++;
      return super.has(key);
    }
  }

  const output: unknown[][] = [];
  const console = { log: (...values: unknown[]) => output.push(values) };
  Function(
    'Map',
    'console',
    `"use strict";\n${duplicateHeavySource}`,
  )(CountingMap, console);

  assert.equal(output.at(-1)?.at(-1), 200);
  assert.ok(
    hasOperations <= 800,
    `Expected at most 800 Map.has operations, received ${hasOperations}.`,
  );
});

test('Merge Two Sorted Lists traces disjoint inputs into its returned value chain', async () => {
  const algorithm = catalogAlgorithm('linked-list-middle');
  const output = executeCatalogSource(algorithm.code);

  assert.deepEqual(
    linkedListValueChain(output.at(-1)?.at(-1)),
    [1, 1, 2, 3, 4, 4],
  );

  const instrumentation = instrumentJavaScript(
    algorithm.code,
    algorithm.structure,
  );
  assert.equal(instrumentation.status, 'instrumented');
  if (instrumentation.status !== 'instrumented') return;

  const execution = await runCode(instrumentation.source, { tracing: true });
  assert.equal(execution.ok, true);
  if (!execution.ok) return;

  const create = execution.commands.find(
    (command) => command.type === 'linked-list.create',
  );
  assert.ok(create !== undefined);
  if (create === undefined || create.type !== 'linked-list.create') return;
  assert.deepEqual(create.nodes, [
    { id: 'node-0', value: 1, nextId: 'node-1' },
    { id: 'node-1', value: 2, nextId: 'node-2' },
    { id: 'node-2', value: 4, nextId: null },
    { id: 'node-3', value: 1, nextId: 'node-4' },
    { id: 'node-4', value: 3, nextId: 'node-5' },
    { id: 'node-5', value: 4, nextId: null },
  ]);

  const timelineResult = buildTimeline(execution.commands);
  assert.equal(timelineResult.ok, true);
  if (!timelineResult.ok) return;
  const initialScene = getPlaybackFrame(timelineResult.timeline, 0).scene;
  assert.equal(initialScene.structure, 'linked-list');
  if (initialScene.structure !== 'linked-list') return;
  assert.deepEqual(
    getLinkedListDisplayOrder(initialScene).map(({ value }) => value),
    [1, 2, 4, 1, 3, 4],
  );

  const finalScene = getPlaybackFrame(
    timelineResult.timeline,
    timelineResult.timeline.operationCount,
  ).scene;
  assert.equal(finalScene.structure, 'linked-list');
  if (finalScene.structure !== 'linked-list') return;
  assert.deepEqual(
    getLinkedListDisplayOrder(finalScene).map(({ value }) => value),
    [1, 1, 2, 3, 4, 4],
  );
});

test('Spiral Matrix traces the matrix it traverses', async () => {
  const algorithm = catalogAlgorithm('spiral-matrix-traversal');
  const instrumentation = instrumentJavaScript(
    algorithm.code,
    algorithm.structure,
  );
  assert.equal(instrumentation.status, 'instrumented');
  if (instrumentation.status !== 'instrumented') return;

  const execution = await runCode(instrumentation.source, { tracing: true });
  assert.equal(execution.ok, true);
  if (!execution.ok) return;

  const create = execution.commands.find(
    (command) => command.type === 'matrix.create',
  );
  assert.ok(create !== undefined, 'Spiral Matrix must create a trace matrix.');
  if (create === undefined) return;
  assert.deepEqual(create.values, [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ]);
});

const tracedCatalogFunctions = [
  ['spiral-matrix-traversal', 'spiralOrder'],
  ['in-order-traversal', 'maxDepth'],
  ['pre-order-traversal', 'isValidBst'],
  ['post-order-traversal', 'levelOrder'],
  ['breadth-first-search', 'canFinish'],
  ['generate-binary-numbers', 'maxSlidingWindow'],
  ['linked-list-middle', 'mergeTwoLists'],
] as const satisfies readonly (readonly [AlgorithmId, string])[];

for (const [id, functionName] of tracedCatalogFunctions) {
  test(`${catalogAlgorithm(id).name} traces structural commands from ${functionName}`, async () => {
    const algorithm = catalogAlgorithm(id);
    const program = parseJavaScript(algorithm.code);
    assert.ok(program !== null, `${algorithm.name} must parse.`);
    if (program === null) return;

    const declaration = program.body.find(
      (statement) =>
        statement.type === 'FunctionDeclaration' &&
        statement.id?.name === functionName,
    );
    assert.ok(
      declaration !== undefined,
      `${algorithm.name} must declare ${functionName}.`,
    );
    if (declaration === undefined || declaration.loc === undefined) return;

    const instrumentation = instrumentJavaScript(
      algorithm.code,
      algorithm.structure,
    );
    assert.equal(instrumentation.status, 'instrumented');
    if (instrumentation.status !== 'instrumented') return;

    const execution = await runCode(instrumentation.source, { tracing: true });
    assert.equal(execution.ok, true);
    if (!execution.ok) return;

    const structuralCommands = execution.commands.filter(
      (command) =>
        command.type !== 'scene.init' && !command.type.endsWith('.create'),
    );
    assert.ok(
      structuralCommands.length > 0,
      `${algorithm.name} must emit structural trace commands.`,
    );

    for (const command of structuralCommands) {
      const line = command.source?.line;
      assert.ok(
        line !== undefined,
        `${algorithm.name} emitted ${command.type} without a source line.`,
      );
      if (line === undefined) return;
      assert.ok(
        line >= declaration.loc.start.line && line <= declaration.loc.end.line,
        `${algorithm.name} emitted ${command.type} from line ${line}, outside ${functionName}.`,
      );
    }
  });
}

test('Sliding Window Maximum emits dequeue-back trace commands', async () => {
  const algorithm = catalogAlgorithm('generate-binary-numbers');
  const instrumentation = instrumentJavaScript(
    algorithm.code,
    algorithm.structure,
  );
  assert.equal(instrumentation.status, 'instrumented');
  if (instrumentation.status !== 'instrumented') return;

  const execution = await runCode(instrumentation.source, { tracing: true });
  assert.equal(execution.ok, true);
  if (!execution.ok) return;

  assert.ok(commandTypes(execution.commands).includes('queue.dequeueBack'));
});

for (const algorithm of algorithmCatalog) {
  test(`${algorithm.name} traverses the real catalog visualization pipeline`, async () => {
    const instrumentation = instrumentJavaScript(
      algorithm.code,
      algorithm.structure,
    );
    assert.equal(instrumentation.status, 'instrumented');
    if (instrumentation.status !== 'instrumented') return;

    const execution = await runCode(instrumentation.source, { tracing: true });
    assert.equal(execution.ok, true);
    if (!execution.ok) return;

    const validation = validateTrace({
      version: TRACE_PROTOCOL_VERSION,
      commands: execution.commands,
    });
    assert.equal(validation.ok, true);
    if (!validation.ok) return;
    assert.equal(validation.commands[0]?.type, 'scene.init');
    assert.equal(
      validation.commands[0]?.type === 'scene.init'
        ? validation.commands[0].structure
        : null,
      algorithm.structure,
    );
    assert.match(validation.commands[1]?.type ?? '', /\.create$/);

    const timelineResult = buildTimeline(validation.commands);
    assert.equal(timelineResult.ok, true);
    if (!timelineResult.ok) return;
    const { timeline } = timelineResult;
    assert.ok(timeline.operationCount > 0);

    assertUsefulInitialStructure(getPlaybackFrame(timeline, 0).scene);

    const frames = Array.from(
      { length: timeline.operationCount + 1 },
      (_, step) => getPlaybackFrame(timeline, step),
    );
    for (const frame of frames) {
      assert.equal(frame.scene.structure, algorithm.structure);
      assertFrameSemantics(frame.scene);
    }
    assertPersistentInitialStructure(frames.map(({ scene }) => scene));

    const finalScene = frames.at(-1)?.scene;
    assert.ok(finalScene !== undefined);
    if (finalScene === undefined) return;
    assertExpectedFinalScene(algorithm.id, finalScene);

    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const representativeSteps = new Set([
      0,
      Math.min(1, timeline.operationCount),
      Math.floor(timeline.operationCount / 2),
      timeline.operationCount,
    ]);
    let previousEntities: ReadonlyMap<string, Element> = new Map();

    try {
      for (const step of representativeSteps) {
        const scene = frames[step]?.scene;
        assert.ok(scene !== undefined);
        if (scene === undefined || scene.structure === null) continue;
        await act(async () => {
          root.render(createElement(SceneRenderer, { scene }));
        });
        const svg = host.querySelector<SVGSVGElement>('svg.visualization-svg');
        assert.ok(svg !== null);
        assert.ok(
          svg.querySelector(`g.visualization-${scene.structure}`) !== null,
        );
        await settleD3();
        assertRenderedEntities(svg, scene);
        const currentEntities = renderedEntityMap(svg, scene);
        for (const [id, element] of currentEntities) {
          const previous = previousEntities.get(id);
          if (previous !== undefined) assert.equal(element, previous);
        }
        previousEntities = currentEntities;
      }

      if (algorithm.id === 'maximum-subarray') {
        assert.ok(
          host.querySelector(
            '[data-item-id="array-item-0"] [data-value-kind="numeric"]',
          ) !== null,
        );
      }
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
}

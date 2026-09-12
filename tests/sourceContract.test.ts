import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPrimaryStructureIdentifier,
  getVisualizationSourceHint,
  validateVisualizationSource,
} from '../src/instrumentation/sourceContract';
import { instrumentJavaScript } from '../src/instrumentation/instrumentJavaScript';
import type { InstrumentableStructure } from '../src/instrumentation/instrumentationTypes';
import { buildTimeline, getPlaybackFrame } from '../src/playback/timeline';
import { TRACE_LIMITS } from '../src/protocol';
import { runSandbox } from '../src/sandbox/runSandbox';
import { createTracer } from '../src/tracer/tracer';
import { getLinkedListDisplayOrder } from '../src/visualization/renderLinkedList';

const canonicalSources = {
  array: 'const array = [3, 2, 1];',
  matrix: 'const matrix = [[1, 2], [3, 4]];',
  tree: 'const tree = { value: 4, left: null, right: null };',
  stack: 'const stack = [];',
  queue: 'const queue = [];',
  graph: "const graph = { A: ['B'], B: [] };",
  'linked-list': 'const linkedList = { value: 1, next: null };',
  'hash-table': 'const hashTable = new Map();',
} satisfies Readonly<Record<InstrumentableStructure, string>>;

test('maps every structure to its canonical primary identifier', () => {
  const identifiers = Object.fromEntries(
    (Object.keys(canonicalSources) as InstrumentableStructure[]).map(
      (structure) => [structure, getPrimaryStructureIdentifier(structure)],
    ),
  );

  assert.deepEqual(identifiers, {
    array: 'array',
    matrix: 'matrix',
    tree: 'tree',
    stack: 'stack',
    queue: 'queue',
    graph: 'graph',
    'linked-list': 'linkedList',
    'hash-table': 'hashTable',
  });
});

test('accepts each canonical root with its natural representation', () => {
  for (const [structure, source] of Object.entries(canonicalSources) as Array<
    [InstrumentableStructure, string]
  >) {
    assert.equal(
      validateVisualizationSource(source, structure).status,
      'valid',
    );
  }
});

test('rejects a missing canonical root with an actionable diagnostic', () => {
  const result = validateVisualizationSource(
    'const values = [3, 2, 1];',
    'array',
  );

  assert.equal(result.status, 'invalid');
  if (result.status !== 'invalid') return;

  assert.equal(result.diagnostic.code, 'MISSING_PRIMARY_STRUCTURE');
  assert.match(
    result.diagnostic.message,
    /Array visualization requires the primary structure to be named `array`/,
  );
  assert.match(result.diagnostic.message, /const array = \[\.\.\.\]/);
});

test('requires the canonical root to be the first meaningful declaration', () => {
  const result = validateVisualizationSource(
    'const target = 3;\nconst array = [3, 2, 1];',
    'array',
  );

  assert.equal(result.status, 'invalid');
  if (result.status !== 'invalid') return;
  assert.equal(result.diagnostic.code, 'PRIMARY_STRUCTURE_NOT_FIRST');
});

test('allows auxiliary structures and helper values after the primary root', () => {
  const sources = [
    'const array = [1, 3, 5];\nconst array2 = [2, 4, 6];',
    'const array = [1, 3, 5];\nconst arrayMerged = [];',
    'const array = [5, 3, 1];\nconst target = 3;\nconst result = [];',
  ];

  for (const source of sources) {
    assert.equal(validateVisualizationSource(source, 'array').status, 'valid');
  }
});

test('does not depend on function names or helper functions', () => {
  const sources = ['whatever', 'bubbleSort', 'x'].map(
    (name) =>
      `const array = [3, 2, 1];\nfunction helper(value) { return value; }\nfunction ${name}(values) { return helper(values); }\n${name}(array);`,
  );

  for (const source of sources) {
    assert.equal(validateVisualizationSource(source, 'array').status, 'valid');
  }
});

test('keeps syntax errors distinct from source-contract failures', () => {
  assert.equal(
    validateVisualizationSource('const array = [;', 'array').status,
    'syntax-error',
  );
});

test('returns source-contract failures before instrumentation or execution', async () => {
  const source = 'const values = [3, 2, 1];';
  const instrumentation = instrumentJavaScript(source, 'array');

  assert.equal(instrumentation.status, 'source-contract-error');
  if (instrumentation.status !== 'source-contract-error') return;
  assert.equal(instrumentation.diagnostic.code, 'MISSING_PRIMARY_STRUCTURE');

  const sandboxResult = await runSandbox(source, 'array');
  assert.equal(sandboxResult.status, 'source-contract-error');
  if (sandboxResult.status !== 'source-contract-error') return;
  assert.equal(
    sandboxResult.diagnostic.message,
    instrumentation.diagnostic.message,
  );
});

test('rejects a root whose representation belongs to another structure', () => {
  const result = validateVisualizationSource('const tree = [1, 2, 3];', 'tree');

  assert.equal(result.status, 'invalid');
  if (result.status !== 'invalid') return;
  assert.equal(result.diagnostic.code, 'INVALID_PRIMARY_STRUCTURE');
});

test('provides a compact editor hint from the same source contract', () => {
  assert.equal(
    getVisualizationSourceHint('array'),
    'Primary structure: const array = [...]',
  );
  assert.equal(
    getVisualizationSourceHint('tree'),
    'Primary structure: const tree = { value, left, right }',
  );
});

test('instruments the canonical array instead of an auxiliary array', () => {
  const result = instrumentJavaScript(
    arrayAlgorithmSource('whatever'),
    'array',
  );

  assert.equal(result.status, 'instrumented');
});

test('produces equivalent traces for arbitrary and familiar function names', async () => {
  const traces = await Promise.all(
    ['whatever', 'bubbleSort', 'x'].map(async (name) => {
      const result = await runSandbox(arrayAlgorithmSource(name), 'array');
      assert.equal(result.status, 'instrumented');
      if (result.status !== 'instrumented') return [];
      assert.equal(result.result.ok, true);
      return result.result.commands;
    }),
  );

  assert.deepEqual(traces[0], traces[1]);
  assert.deepEqual(traces[1], traces[2]);
});

test('executes queue cursor operations through a canonical-root parameter', async () => {
  const result = await runSandbox(
    `const queue = ['A', 'B'];

function consume(values) {
  let head = 0;
  while (head < values.length) {
    console.log(values[head++]);
  }
}

consume(queue);`,
    'queue',
  );

  assert.equal(result.status, 'instrumented');
  if (result.status !== 'instrumented') return;
  assert.equal(result.result.ok, true);
});

test('rejects mixing queue cursor dequeues with a back dequeue', () => {
  const result = instrumentJavaScript(
    `const queue = [1, 2];
function consume(values) {
  let index = 0;
  while (index < values.length) console.log(values[index++]);
  return values.pop();
}
console.log(consume(queue));`,
    'queue',
  );

  assert.equal(result.status, 'unsupported');
});

test('instruments a queue back dequeue once and preserves the returned value', async () => {
  const source = `const queue = [0, 1, 2];
function trimBack(values) {
  return values.pop();
}
console.log(trimBack(queue));`;
  const instrumentation = instrumentJavaScript(source, 'queue');

  assert.equal(instrumentation.status, 'instrumented');
  if (instrumentation.status !== 'instrumented') return;

  const trace = createTracer();
  const output: unknown[][] = [];
  const execute = new Function(
    'trace',
    'console',
    `"use strict"; return (async function () {\n${instrumentation.source}\n})();`,
  ) as (
    trace: ReturnType<typeof createTracer>,
    console: { readonly log: (...values: unknown[]) => void },
  ) => Promise<void>;

  await execute(trace, {
    log: (...values: unknown[]) => output.push(values),
  });

  assert.deepEqual(output, [[2]]);
  assert.equal(
    trace.getCommands().filter(({ type }) => type === 'queue.dequeueBack')
      .length,
    1,
  );
});

test('rejects a queue pop call with arguments', () => {
  const result = instrumentJavaScript(
    `const queue = [0, 1, 2];
function trimBack(values) {
  return values.pop(1);
}
console.log(trimBack(queue));`,
    'queue',
  );

  assert.equal(result.status, 'unsupported');
});

test('marks direct canonical matrix reads in spiral order', async () => {
  const result = await runSandbox(
    `const matrix = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9]
];

function spiral(values) {
  const result = [];
  let top = 0;
  let bottom = values.length - 1;
  let left = 0;
  let right = values[0].length - 1;

  while (top <= bottom && left <= right) {
    for (let column = left; column <= right; column++) {
      result.push(values[top][column]);
    }
    top++;

    for (let row = top; row <= bottom; row++) {
      result.push(values[row][right]);
    }
    right--;

    if (top <= bottom) {
      for (let column = right; column >= left; column--) {
        result.push(values[bottom][column]);
      }
      bottom--;
    }

    if (left <= right) {
      for (let row = bottom; row >= top; row--) {
        result.push(values[row][left]);
      }
      left++;
    }
  }

  return result;
}

console.log(spiral(matrix));`,
    'matrix',
  );

  assert.equal(result.status, 'instrumented');
  if (result.status !== 'instrumented') return;
  assert.equal(result.result.ok, true);
  if (!result.result.ok) return;

  const marks = result.result.commands.filter(
    (command) => command.type === 'matrix.mark',
  );
  assert.deepEqual(
    marks.map((command) => command.positions),
    [
      [{ row: 0, column: 0 }],
      [{ row: 0, column: 1 }],
      [{ row: 0, column: 2 }],
      [{ row: 1, column: 2 }],
      [{ row: 2, column: 2 }],
      [{ row: 2, column: 1 }],
      [{ row: 2, column: 0 }],
      [{ row: 1, column: 0 }],
      [{ row: 1, column: 1 }],
    ],
  );
  assert.ok(marks.every((command) => command.marker === 'probe'));
});

test('allows matched matrix operations alongside marked reads', async () => {
  const result = await runSandbox(
    `const matrix = [[1, 2], [3, 4]];

function mutateAndRead(values) {
  const result = [];
  values[0][0] = values[1][0] + 6;
  if (values[0][0] === values[0][1]) {
    values[1][0] = 8;
  }
  [values[0][0], values[0][1]] = [values[0][1], values[0][0]];
  result.push(values[1][1]);
  return result;
}

console.log(mutateAndRead(matrix));`,
    'matrix',
  );

  assert.equal(result.status, 'instrumented');
  if (result.status !== 'instrumented') return;
  assert.equal(result.result.ok, true);
  if (!result.result.ok) return;

  assert.deepEqual(
    result.result.commands
      .map(({ type }) => type)
      .filter((type) =>
        ['matrix.set', 'matrix.compare', 'matrix.swap', 'matrix.mark'].includes(
          type,
        ),
      ),
    ['matrix.set', 'matrix.compare', 'matrix.swap', 'matrix.mark'],
  );
});

test('rejects an unmatched canonical matrix read in a mark traversal', () => {
  const result = instrumentJavaScript(
    `const matrix = [[1, 2], [3, 4]];

function read(values) {
  const result = [];
  result.push(values[0][0]);
  const leaked = values[1][1];
  return result;
}

console.log(read(matrix));`,
    'matrix',
  );

  assert.equal(result.status, 'unsupported');
});

test('rejects a matrix mark receiver that is not a local static array', () => {
  const result = instrumentJavaScript(
    `const matrix = [[1, 2], [3, 4]];

function read(values) {
  const result = null;
  result.push(values[0][0]);
  return result;
}

console.log(read(matrix));`,
    'matrix',
  );

  assert.equal(result.status, 'unsupported');
});

test('rejects a matrix read through an aliased row', () => {
  const result = instrumentJavaScript(
    `const matrix = [[1, 2], [3, 4]];

function read(values) {
  const result = [];
  const row = values[0];
  result.push(row[1]);
  return result;
}

console.log(read(matrix));`,
    'matrix',
  );

  assert.equal(result.status, 'unsupported');
});

test('executes stack peeks through a canonical-root parameter', async () => {
  const result = await runSandbox(
    `const stack = [];

function inspect(values) {
  values.push('A');
  console.log(values[values.length - 1]);
  values.pop();
}

inspect(stack);`,
    'stack',
  );

  assert.equal(result.status, 'instrumented');
  if (result.status !== 'instrumented') return;
  assert.equal(result.result.ok, true);
});

test('rejects a static stack initializer above the collection limit', () => {
  const initializer = Array.from(
    { length: TRACE_LIMITS.collectionItems + 1 },
    () => '0',
  ).join(', ');
  const result = instrumentJavaScript(
    `const stack = [${initializer}];\nstack.pop();`,
    'stack',
  );

  assert.equal(result.status, 'unsupported');
});

test('instruments supported static stack initializer boundaries', () => {
  const maximumInitializer = `[${Array.from(
    { length: TRACE_LIMITS.collectionItems },
    () => '0',
  ).join(', ')}]`;
  const initializers = [
    ['empty', '[]'],
    ['zero', '[0]'],
    ['negative number and sentinel string', "[-1, 'sentinel']"],
    ['maximum collection length', maximumInitializer],
  ] as const;

  for (const [label, initializer] of initializers) {
    assert.equal(
      instrumentJavaScript(stackInitializerSource(initializer), 'stack').status,
      'instrumented',
      label,
    );
  }
});

test('rejects unsupported static stack initializer values', () => {
  const initializers = [
    ['hole', '[0, , 1]'],
    ['spread', '[...[1]]'],
    ['identifier', '[value]'],
    ['boolean', '[true]'],
    [
      'overlong string',
      `[${JSON.stringify('x'.repeat(TRACE_LIMITS.stringLength + 1))}]`,
    ],
  ] as const;

  for (const [label, initializer] of initializers) {
    assert.equal(
      instrumentJavaScript(stackInitializerSource(initializer), 'stack').status,
      'unsupported',
      label,
    );
  }
});

test('traces a real two-list merge without changing its returned head', async () => {
  const source = mergeTwoListsSource();
  const instrumentation = instrumentJavaScript(source, 'linked-list');

  assert.equal(instrumentation.status, 'instrumented');
  if (instrumentation.status !== 'instrumented') return;

  const trace = createTracer();
  const output: unknown[][] = [];
  const execute = new Function(
    'trace',
    'console',
    `"use strict"; return (async function () {\n${instrumentation.source}\n})();`,
  ) as (
    trace: ReturnType<typeof createTracer>,
    console: { readonly log: (...values: unknown[]) => void },
  ) => Promise<void>;

  await execute(trace, {
    log: (...values: unknown[]) => output.push(values),
  });

  const commands = trace.getCommands();
  const create = commands.find(
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
  assert.equal(create.headId, 'node-0');
  assert.equal(create.tailId, 'node-2');

  const timelineResult = buildTimeline(commands);
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
  assert.equal(finalScene.headId, 'node-0');
  assert.equal(finalScene.tailId, 'node-5');
  assert.strictEqual(output.at(-1)?.at(0), output.at(-1)?.at(1));
  assert.deepEqual(
    linkedListValueChain(output.at(-1)?.at(-1)),
    [1, 1, 2, 3, 4, 4],
  );

  const functionStartLine = source
    .slice(0, source.indexOf('function mergeTwoLists'))
    .split('\n').length;
  const functionEndLine = source
    .slice(0, source.indexOf('\n}\n\nconsole.log'))
    .split('\n').length;
  const returnLine = source
    .slice(0, source.indexOf('return dummy.next'))
    .split('\n').length;
  const mutations = commands.filter((command) =>
    [
      'linked-list.setNext',
      'linked-list.setHead',
      'linked-list.setTail',
    ].includes(command.type),
  );
  assert.deepEqual(
    mutations.map(({ type }) => type),
    [
      'linked-list.setNext',
      'linked-list.setNext',
      'linked-list.setNext',
      'linked-list.setNext',
      'linked-list.setNext',
      'linked-list.setHead',
      'linked-list.setTail',
    ],
  );
  assert.ok(
    mutations.every(
      (command) =>
        command.source !== undefined &&
        command.source.line >= functionStartLine &&
        command.source.line <= functionEndLine,
    ),
  );
  assert.ok(
    mutations
      .filter(
        ({ type }) =>
          type === 'linked-list.setHead' || type === 'linked-list.setTail',
      )
      .every((command) => command.source?.line === returnLine),
  );
});

test('rejects a third static list in a two-list merge source', () => {
  const source = mergeTwoListsSource().replace(
    '\n\nfunction mergeTwoLists',
    `\nconst linkedList3 = { value: 9, next: null };\n\nfunction mergeTwoLists`,
  );

  assert.equal(
    instrumentJavaScript(source, 'linked-list').status,
    'unsupported',
  );
});

test('rejects computed next access in a two-list merge', () => {
  const source = mergeTwoListsSource().replace(
    'tail.next = left;',
    "tail['next'] = left;",
  );

  assert.equal(
    instrumentJavaScript(source, 'linked-list').status,
    'unsupported',
  );
});

test('rejects ambiguous repeated calls to a two-list merge', () => {
  const source = mergeTwoListsSource().replace(
    'console.log(linkedList, mergeTwoLists(linkedList, linkedList2));',
    `console.log(linkedList, mergeTwoLists(linkedList, linkedList2));\nconsole.log(mergeTwoLists(linkedList, linkedList2));`,
  );

  assert.equal(
    instrumentJavaScript(source, 'linked-list').status,
    'unsupported',
  );
});

test('instruments canonical Kahn traversal and preserves its result', async () => {
  const source = kahnCourseScheduleSource();
  const originalOutput = executeSource(source);
  const instrumented = await executeInstrumentedGraphSource(source);

  assert.deepEqual(originalOutput, [[true]]);
  assert.deepEqual(instrumented.output, originalOutput);
  assert.deepEqual(instrumented.visitedNodeIds, ['0', '1', '2', '3']);
  assert.deepEqual(instrumented.visitedEdgeIds, [
    '0->1',
    '0->2',
    '1->3',
    '2->3',
  ]);
});

test('rejects Kahn traversal with outgoing updates in the wrong order', () => {
  const result = instrumentJavaScript(
    kahnCourseScheduleSource().replace(
      `      indegree[course]--;
      if (indegree[course] === 0) queue.push(course);`,
      `      if (indegree[course] === 0) queue.push(course);
      indegree[course]--;`,
    ),
    'graph',
  );

  assert.equal(result.status, 'unsupported');
});

test('rejects Kahn traversal in a generator function', () => {
  const result = instrumentJavaScript(
    kahnCourseScheduleSource().replace(
      'function canFinish(adjacency) {',
      'function* canFinish(adjacency) {',
    ),
    'graph',
  );

  assert.equal(result.status, 'unsupported');
});

test('rejects Kahn traversal in an async function', () => {
  const result = instrumentJavaScript(
    kahnCourseScheduleSource().replace(
      'function canFinish(adjacency) {',
      'async function canFinish(adjacency) {',
    ),
    'graph',
  );

  assert.equal(result.status, 'unsupported');
});

test('instruments the canonical maximum-depth traversal and preserves its result', async () => {
  const source = maximumDepthTreeSource();
  const originalOutput = executeSource(source);
  const instrumented = await executeInstrumentedTreeSource(source);

  assert.deepEqual(originalOutput, [[3]]);
  assert.deepEqual(instrumented.output, originalOutput);
  assert.deepEqual(instrumented.visitedValues, [3, 9, 20, 15, 7]);
});

test('rejects a maximum-depth traversal with an extra recursive call', () => {
  const result = instrumentJavaScript(
    maximumDepthTreeSource().replace(
      'return 1 + Math.max(maxDepth(node.left), maxDepth(node.right));',
      'maxDepth(node.left);\n  return 1 + Math.max(maxDepth(node.left), maxDepth(node.right));',
    ),
    'tree',
  );

  assert.equal(result.status, 'unsupported');
});

test('instruments the canonical BST validation traversal and preserves its result', async () => {
  const source = bstValidationTreeSource();
  const originalOutput = executeSource(source);
  const instrumented = await executeInstrumentedTreeSource(source);

  assert.deepEqual(originalOutput, [[true]]);
  assert.deepEqual(instrumented.output, originalOutput);
  assert.deepEqual(instrumented.visitedValues, [5, 3, 2, 4, 8, 7, 9]);
});

test('rejects a BST validation traversal with a non-canonical initial argument', () => {
  const result = instrumentJavaScript(
    bstValidationTreeSource().replace(
      'isValidBst(tree, -Infinity, Infinity)',
      'isValidBst(tree.left, -Infinity, Infinity)',
    ),
    'tree',
  );

  assert.equal(result.status, 'unsupported');
});

test('instruments the canonical level-order traversal and preserves its result', async () => {
  const source = levelOrderTreeSource();
  const originalOutput = executeSource(source);
  const instrumented = await executeInstrumentedTreeSource(source);

  assert.deepEqual(originalOutput, [[[[3], [9, 20], [15, 7]]]]);
  assert.deepEqual(instrumented.output, originalOutput);
  assert.deepEqual(instrumented.visitedValues, [3, 9, 20, 15, 7]);
});

test('rejects a level-order traversal with an aliased dequeue', () => {
  const result = instrumentJavaScript(
    levelOrderTreeSource().replace(
      'const node = queue.shift();',
      'const dequeue = queue.shift.bind(queue);\n      const node = dequeue();',
    ),
    'tree',
  );

  assert.equal(result.status, 'unsupported');
});

function executeSource(source: string): readonly unknown[][] {
  const output: unknown[][] = [];
  const console = { log: (...values: unknown[]) => output.push(values) };
  Function('console', `"use strict";\n${source}`)(console);
  return output;
}

async function executeInstrumentedGraphSource(source: string): Promise<{
  readonly output: readonly unknown[][];
  readonly visitedNodeIds: readonly string[];
  readonly visitedEdgeIds: readonly string[];
}> {
  const instrumentation = instrumentJavaScript(source, 'graph');
  assert.equal(instrumentation.status, 'instrumented');
  if (instrumentation.status !== 'instrumented') {
    return { output: [], visitedNodeIds: [], visitedEdgeIds: [] };
  }

  const trace = createTracer();
  const output: unknown[][] = [];
  const execute = new Function(
    'trace',
    'console',
    `"use strict"; return (async function () {\n${instrumentation.source}\n})();`,
  ) as (
    trace: ReturnType<typeof createTracer>,
    console: { readonly log: (...values: unknown[]) => void },
  ) => Promise<void>;

  await execute(trace, {
    log: (...values: unknown[]) => output.push(values),
  });

  const commands = trace.getCommands();
  return {
    output,
    visitedNodeIds: commands.flatMap((command) =>
      command.type === 'graph.visitNode' ? [command.nodeId] : [],
    ),
    visitedEdgeIds: commands.flatMap((command) =>
      command.type === 'graph.visitEdge' ? [command.edgeId] : [],
    ),
  };
}

async function executeInstrumentedTreeSource(source: string): Promise<{
  readonly output: readonly unknown[][];
  readonly visitedValues: readonly unknown[];
}> {
  const instrumentation = instrumentJavaScript(source, 'tree');
  assert.equal(instrumentation.status, 'instrumented');
  if (instrumentation.status !== 'instrumented') {
    return { output: [], visitedValues: [] };
  }

  const trace = createTracer();
  const output: unknown[][] = [];
  const execute = new Function(
    'trace',
    'console',
    `"use strict"; return (async function () {\n${instrumentation.source}\n})();`,
  ) as (
    trace: ReturnType<typeof createTracer>,
    console: { readonly log: (...values: unknown[]) => void },
  ) => Promise<void>;

  await execute(trace, {
    log: (...values: unknown[]) => output.push(values),
  });

  const commands = trace.getCommands();
  const create = commands.find((command) => command.type === 'tree.create');
  assert.ok(create !== undefined);
  if (create === undefined || create.type !== 'tree.create') {
    return { output, visitedValues: [] };
  }

  const valuesById = new Map(create.nodes.map((node) => [node.id, node.value]));
  return {
    output,
    visitedValues: commands
      .filter((command) => command.type === 'tree.visit')
      .map((command) => valuesById.get(command.nodeId)),
  };
}

function maximumDepthTreeSource(): string {
  return `const tree = {
  value: 3,
  left: { value: 9, left: null, right: null },
  right: {
    value: 20,
    left: { value: 15, left: null, right: null },
    right: { value: 7, left: null, right: null }
  }
};

function maxDepth(node) {
  if (node === null) return 0;
  return 1 + Math.max(maxDepth(node.left), maxDepth(node.right));
}

console.log(maxDepth(tree));`;
}

function bstValidationTreeSource(): string {
  return `const tree = {
  value: 5,
  left: {
    value: 3,
    left: { value: 2, left: null, right: null },
    right: { value: 4, left: null, right: null }
  },
  right: {
    value: 8,
    left: { value: 7, left: null, right: null },
    right: { value: 9, left: null, right: null }
  }
};

function isValidBst(node, lower, upper) {
  if (node === null) return true;
  if (node.value <= lower || node.value >= upper) return false;

  return (
    isValidBst(node.left, lower, node.value) &&
    isValidBst(node.right, node.value, upper)
  );
}

console.log(isValidBst(tree, -Infinity, Infinity));`;
}

function levelOrderTreeSource(): string {
  return `const tree = {
  value: 3,
  left: { value: 9, left: null, right: null },
  right: {
    value: 20,
    left: { value: 15, left: null, right: null },
    right: { value: 7, left: null, right: null }
  }
};

function levelOrder(root) {
  if (root === null) return [];

  const result = [];
  const queue = [root];

  while (queue.length > 0) {
    const level = [];
    const levelSize = queue.length;

    for (let index = 0; index < levelSize; index++) {
      const node = queue.shift();
      level.push(node.value);

      if (node.left !== null) queue.push(node.left);
      if (node.right !== null) queue.push(node.right);
    }

    result.push(level);
  }

  return result;
}

console.log(levelOrder(tree));`;
}

function kahnCourseScheduleSource(): string {
  return `const graph = {
  '0': ['1', '2'],
  '1': ['3'],
  '2': ['3'],
  '3': []
};

function canFinish(adjacency) {
  const indegree = {};
  for (const course of Object.keys(adjacency)) {
    indegree[course] = 0;
  }

  for (const prerequisite of Object.keys(adjacency)) {
    for (const course of adjacency[prerequisite]) {
      indegree[course]++;
    }
  }

  const queue = [];
  for (const course of Object.keys(adjacency)) {
    if (indegree[course] === 0) queue.push(course);
  }

  let completed = 0;
  while (queue.length > 0) {
    const prerequisite = queue.shift();
    completed++;

    for (const course of adjacency[prerequisite]) {
      indegree[course]--;
      if (indegree[course] === 0) queue.push(course);
    }
  }

  return completed === Object.keys(adjacency).length;
}

console.log(canFinish(graph));`;
}

function mergeTwoListsSource(): string {
  return `const linkedList = {
  value: 1,
  next: { value: 2, next: { value: 4, next: null } }
};
const linkedList2 = {
  value: 1,
  next: { value: 3, next: { value: 4, next: null } }
};

function mergeTwoLists(first, second) {
  const dummy = { value: 0, next: null };
  let tail = dummy;
  let left = first;
  let right = second;

  while (left !== null && right !== null) {
    if (left.value <= right.value) {
      tail.next = left;
      left = left.next;
    } else {
      tail.next = right;
      right = right.next;
    }
    tail = tail.next;
  }

  tail.next = left === null ? right : left;
  return dummy.next;
}

console.log(linkedList, mergeTwoLists(linkedList, linkedList2));`;
}

function linkedListValueChain(value: unknown): readonly unknown[] {
  const values: unknown[] = [];
  let current = value;
  while (typeof current === 'object' && current !== null) {
    assert.ok('value' in current);
    assert.ok('next' in current);
    values.push(current.value);
    current = current.next;
  }
  assert.equal(current, null);
  return values;
}

function stackInitializerSource(initializer: string): string {
  return `const stack = ${initializer};\nstack.pop();`;
}

function arrayAlgorithmSource(functionName: string): string {
  return `const array = [3, 2, 1];
const arrayBuffer = [0, 0, 0];

function ${functionName}(values) {
  for (let end = values.length - 1; end > 0; end--) {
    for (let index = 0; index < end; index++) {
      if (values[index] > values[index + 1]) {
        [values[index], values[index + 1]] = [
          values[index + 1],
          values[index]
        ];
      }
    }
  }
}

${functionName}(array);`;
}

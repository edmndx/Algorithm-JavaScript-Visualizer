import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  configFile: false,
  server: { middlewareMode: true },
});
after(() => vite.close());

const [
  { algorithmCatalog },
  { instrumentJavaScript },
  { validateTraceSemantics },
  { traceCommandSchema },
  { runValidatedCode },
  scene,
] = await Promise.all([
  vite.ssrLoadModule('/src/data/catalog/index.ts'),
  vite.ssrLoadModule('/src/instrumentation/instrumentJavaScript.ts'),
  vite.ssrLoadModule('/src/protocol/semanticValidation.ts'),
  vite.ssrLoadModule('/src/protocol/traceSchemas.ts'),
  vite.ssrLoadModule('/src/runner/runner.ts'),
  vite.ssrLoadModule('/src/scene/index.ts'),
]);

async function runTreeSource(source) {
  const instrumentation = instrumentJavaScript(source, 'tree');
  assert.equal(instrumentation.status, 'instrumented');
  const result = await runValidatedCode(instrumentation.source, {
    tracing: true,
  });
  assert.equal(result.ok, true);
  assert.equal(validateTraceSemantics(result.commands).ok, true);
  return result.commands;
}

async function runTreeStarter(id) {
  const entry = algorithmCatalog.find((algorithm) => algorithm.id === id);
  assert.ok(entry);
  return runTreeSource(entry.code);
}

function nodeValueById(commands) {
  const create = commands.find(({ type }) => type === 'tree.create');
  assert.ok(create);
  return new Map(create.nodes.map((node) => [node.id, node.value]));
}

test('Maximum Depth emits bottom-up subtree depths', async () => {
  const commands = await runTreeStarter('maximum-depth-binary-tree');
  const values = nodeValueById(commands);
  const depths = commands
    .filter(({ type }) => type === 'tree.setDepth')
    .map(({ nodeId, depth }) => [values.get(nodeId), depth]);

  assert.deepEqual(depths, [
    [9, 1],
    [15, 1],
    [7, 1],
    [20, 2],
    [3, 3],
  ]);
  assert.equal(
    commands.some(({ type }) => type === 'tree.visit'),
    false,
  );
});

test('BST Validation emits tightened bounds for each checked node', async () => {
  const commands = await runTreeStarter('binary-search-tree-validation');
  const values = nodeValueById(commands);
  const checks = commands
    .filter(({ type }) => type === 'tree.checkBounds')
    .map(({ nodeId, lower, upper, matches }) => ({
      value: values.get(nodeId),
      lower,
      upper,
      matches,
    }));

  assert.deepEqual(checks, [
    { value: 5, lower: null, upper: null, matches: true },
    { value: 3, lower: null, upper: 5, matches: true },
    { value: 2, lower: null, upper: 3, matches: true },
    { value: 4, lower: 3, upper: 5, matches: true },
    { value: 8, lower: 5, upper: null, matches: true },
    { value: 7, lower: 5, upper: 8, matches: true },
    { value: 9, lower: 8, upper: null, matches: true },
  ]);
  assert.equal(
    commands.some(({ type }) => type === 'tree.visit'),
    false,
  );
});

test('Level-Order Traversal remains a breadth-first visit sequence', async () => {
  const commands = await runTreeStarter('level-order-traversal');
  const values = nodeValueById(commands);
  const visitedValues = commands
    .filter(({ type }) => type === 'tree.visit')
    .map(({ nodeId }) => values.get(nodeId));

  assert.deepEqual(visitedValues, [3, 9, 20, 15, 7]);
  assert.equal(
    commands.some(({ type }) => type === 'tree.checkBounds'),
    false,
  );
  assert.equal(
    commands.some(({ type }) => type === 'tree.setDepth'),
    false,
  );
});

test('Tree semantic commands reject invalid bounds and depths', () => {
  assert.equal(
    traceCommandSchema.safeParse({
      type: 'tree.checkBounds',
      nodeId: 'node-0',
      lower: Number.NEGATIVE_INFINITY,
      upper: null,
      matches: true,
    }).success,
    false,
  );
  assert.equal(
    traceCommandSchema.safeParse({
      type: 'tree.setDepth',
      nodeId: 'node-0',
      depth: 0,
    }).success,
    false,
  );

  const invalidBounds = validateTraceSemantics([
    { type: 'scene.init', structure: 'tree' },
    {
      type: 'tree.create',
      rootId: 'node-0',
      nodes: [{ id: 'node-0', value: 5, children: [] }],
    },
    {
      type: 'tree.checkBounds',
      nodeId: 'node-0',
      lower: 5,
      upper: 3,
      matches: false,
    },
  ]);
  assert.equal(invalidBounds.ok, false);
  assert.equal(invalidBounds.issues[0]?.code, 'TREE_INVALID_BOUNDS');
});

test('Tree reducer stores only current semantic emphasis and computed depths', () => {
  const commands = [
    { type: 'scene.init', structure: 'tree' },
    {
      type: 'tree.create',
      rootId: 'node-0',
      nodes: [{ id: 'node-0', value: 5, children: [] }],
    },
    {
      type: 'tree.checkBounds',
      nodeId: 'node-0',
      lower: null,
      upper: null,
      matches: true,
    },
  ];
  const checked = commands.reduce(
    scene.reduceTraceCommand,
    scene.createInitialScene(),
  );
  assert.equal(checked.structure, 'tree');
  assert.deepEqual(checked.boundsCheck, {
    nodeId: 'node-0',
    lower: null,
    upper: null,
    matches: true,
  });

  const depth = scene.reduceTraceCommand(checked, {
    type: 'tree.setDepth',
    nodeId: 'node-0',
    depth: 1,
  });
  assert.equal(depth.structure, 'tree');
  assert.deepEqual(depth.depthByNodeId, { 'node-0': 1 });
  assert.equal(depth.activeDepthNodeId, 'node-0');
  assert.equal(depth.boundsCheck, null);

  const visited = scene.reduceTraceCommand(depth, {
    type: 'tree.visit',
    nodeId: 'node-0',
  });
  assert.equal(visited.structure, 'tree');
  assert.equal(visited.activeDepthNodeId, null);
  assert.deepEqual(visited.depthByNodeId, { 'node-0': 1 });
});

test('Tree instrumentation preserves recognized function results', async () => {
  const maximumDepth = algorithmCatalog.find(
    ({ id }) => id === 'maximum-depth-binary-tree',
  );
  const bstValidation = algorithmCatalog.find(
    ({ id }) => id === 'binary-search-tree-validation',
  );
  assert.ok(maximumDepth);
  assert.ok(bstValidation);

  await runTreeSource(
    maximumDepth.code.replace(
      'console.log(maxDepth(tree));',
      "if (maxDepth(tree) !== 3) throw new Error('wrong depth');",
    ),
  );
  await runTreeSource(
    bstValidation.code.replace(
      'console.log(isValidBst(tree, -Infinity, Infinity));',
      "if (!isValidBst(tree, -Infinity, Infinity)) throw new Error('wrong result');",
    ),
  );
});

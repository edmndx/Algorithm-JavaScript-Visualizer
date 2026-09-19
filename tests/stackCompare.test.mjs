import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { URL } from 'node:url';

import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  configFile: false,
  server: { middlewareMode: true },
});
after(() => vite.close());

const [
  { createTraceOperationEntries },
  { instrumentJavaScript },
  { validateTraceSemantics },
  { traceCommandSchema },
  { runValidatedCode },
  scene,
] = await Promise.all([
  vite.ssrLoadModule('/src/features/traceConsole.ts'),
  vite.ssrLoadModule('/src/instrumentation/instrumentJavaScript.ts'),
  vite.ssrLoadModule('/src/protocol/semanticValidation.ts'),
  vite.ssrLoadModule('/src/protocol/traceSchemas.ts'),
  vite.ssrLoadModule('/src/runner/runner.ts'),
  vite.ssrLoadModule('/src/scene/index.ts'),
]);

const STACK_INIT = [
  { type: 'scene.init', structure: 'stack' },
  { type: 'stack.create', values: [3] },
];

function reduceStack(commands) {
  const result = commands.reduce(
    scene.reduceTraceCommand,
    scene.createInitialScene(),
  );
  assert.equal(result.structure, 'stack');
  return result;
}

async function runStackSource(source) {
  const instrumentation = instrumentJavaScript(source, 'stack');
  assert.equal(instrumentation.status, 'instrumented');
  const result = await runValidatedCode(instrumentation.source, {
    tracing: true,
  });
  assert.equal(result.ok, true);
  return result.commands;
}

test('stack.compare derives every comparison result from the current top', () => {
  const cases = [
    ['eq', 3, true],
    ['eq', 4, false],
    ['neq', 4, true],
    ['lt', 4, true],
    ['lte', 3, true],
    ['gt', 2, true],
    ['gte', 3, true],
  ];

  for (const [operator, value, matches] of cases) {
    const result = reduceStack([
      ...STACK_INIT,
      { type: 'stack.compare', operator, value },
    ]);
    assert.deepEqual(result.comparison, {
      stackIndex: 0,
      value,
      operator,
      matches,
    });
    assert.equal(result.peekedIndex, null);
  }
});

test('stack comparison state clears on push, pop, peek, and mark', () => {
  const compared = [
    ...STACK_INIT,
    { type: 'stack.compare', operator: 'eq', value: 3 },
  ];

  assert.equal(
    reduceStack([...compared, { type: 'stack.push', value: 4 }]).comparison,
    null,
  );
  assert.equal(
    reduceStack([...compared, { type: 'stack.pop' }]).comparison,
    null,
  );
  assert.equal(
    reduceStack([...compared, { type: 'stack.peek' }]).comparison,
    null,
  );
  assert.equal(
    reduceStack([
      ...compared,
      { type: 'stack.mark', indices: [0], marker: 'active' },
    ]).comparison,
    null,
  );
});

test('stack.compare is rejected for an empty stack', () => {
  const validation = validateTraceSemantics([
    { type: 'scene.init', structure: 'stack' },
    { type: 'stack.create', values: [] },
    { type: 'stack.compare', operator: 'eq', value: 1 },
  ]);
  assert.equal(validation.ok, false);
  assert.equal(validation.issues[0]?.code, 'STACK_UNDERFLOW');
});

test('stack.compare accepts only the bounded protocol operators', () => {
  assert.equal(
    traceCommandSchema.safeParse({
      type: 'stack.compare',
      value: 1,
      operator: 'neq',
    }).success,
    true,
  );
  assert.equal(
    traceCommandSchema.safeParse({
      type: 'stack.compare',
      value: 1,
      operator: 'contains',
    }).success,
    false,
  );
});

test('stack.compare preserves the existing Peek console entry', () => {
  assert.deepEqual(
    createTraceOperationEntries([
      { type: 'stack.compare', value: '[', operator: 'neq' },
    ]),
    [{ sequence: 0, level: 'log', text: 'Peek' }],
  );
});

test('Stack top comparisons emit stack.compare and preserve expression results', async () => {
  const atCommands = await runStackSource(
    `const stack = ['['];\nlet calls = 0;\nconst expected = () => { calls += 1; return '['; };\nif (stack.at(-1) !== expected()) stack.push('wrong'); else stack.push('right');\nstack.push(calls);\nstack.pop();`,
  );
  assert.deepEqual(
    atCommands.filter(
      ({ type }) => type === 'stack.compare' || type === 'stack.push',
    ),
    [
      {
        type: 'stack.compare',
        value: '[',
        operator: 'neq',
        source: { line: 4 },
      },
      { type: 'stack.push', value: 'right', source: { line: 4 } },
      { type: 'stack.push', value: 1, source: { line: 5 } },
    ],
  );

  const bracketCommands = await runStackSource(
    `const stack = [2];\nconst expected = 3;\nif (expected > stack[stack.length - 1]) stack.push('right'); else stack.push('wrong');\nstack.pop();`,
  );
  assert.deepEqual(
    bracketCommands.filter(
      ({ type }) => type === 'stack.compare' || type === 'stack.push',
    ),
    [
      { type: 'stack.compare', value: 3, operator: 'lt', source: { line: 3 } },
      { type: 'stack.push', value: 'right', source: { line: 3 } },
    ],
  );
});

test('Stack catalog starters remain executable and semantically valid', async () => {
  const catalog = JSON.parse(
    await readFile(
      new URL('../src/data/catalog/algorithms.json', import.meta.url),
      'utf8',
    ),
  );

  for (const name of [
    'Valid Parentheses',
    'Monotonic Stack',
    'Largest Rectangle in Histogram',
  ]) {
    const entry = catalog.find((algorithm) => algorithm.name === name);
    assert.ok(entry, `${name} starter is missing.`);
    const commands = await runStackSource(entry.code);
    assert.equal(validateTraceSemantics(commands).ok, true, name);
  }
});

test('plain Stack top reads remain stack.peek operations', async () => {
  const commands = await runStackSource(
    `const stack = [1];\nconst top = stack.at(-1);\nstack.push(top);\nstack.pop();`,
  );
  assert.equal(
    commands.some(({ type }) => type === 'stack.peek'),
    true,
  );
  assert.equal(
    commands.some(({ type }) => type === 'stack.compare'),
    false,
  );
});

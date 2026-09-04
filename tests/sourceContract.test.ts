import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPrimaryStructureIdentifier,
  getVisualizationSourceHint,
  validateVisualizationSource,
} from '../src/instrumentation/sourceContract';
import { instrumentJavaScript } from '../src/instrumentation/instrumentJavaScript';
import type { InstrumentableStructure } from '../src/instrumentation/instrumentationTypes';
import { runSandbox } from '../src/sandbox/runSandbox';

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

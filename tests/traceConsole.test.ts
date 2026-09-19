import assert from 'node:assert/strict';
import test from 'node:test';

import type { TraceCommand } from '../src/protocol';

test('formats trace command types as concise operation names', async () => {
  const { formatTraceOperationType } =
    await import('../src/features/traceConsole');
  const cases: ReadonlyArray<
    readonly [TraceCommand['type'], expected: string]
  > = [
    ['scene.init', 'Initialize'],
    ['array.swap', 'Swap'],
    ['tree.setChildren', 'Set children'],
    ['graph.visitNode', 'Visit node'],
    ['linked-list.setPrevious', 'Set previous'],
    ['hash-table.visitBucket', 'Visit bucket'],
    ['message', 'Message'],
  ];

  for (const [type, expected] of cases) {
    assert.equal(formatTraceOperationType(type), expected);
  }
});

test('shows every operation newest first when playback is loaded', async () => {
  const { createTraceOperationEntries } =
    await import('../src/features/traceConsole');
  const commands = [
    { type: 'scene.init', structure: 'array' },
    { type: 'array.create', values: [2, 1] },
    { type: 'array.compare', indices: [0, 1] },
    { type: 'array.swap', indices: [0, 1] },
  ] satisfies readonly TraceCommand[];

  assert.deepEqual(createTraceOperationEntries(commands), [
    { sequence: 3, level: 'log', text: 'Swap' },
    { sequence: 2, level: 'log', text: 'Compare' },
    { sequence: 1, level: 'log', text: 'Create' },
    { sequence: 0, level: 'log', text: 'Initialize' },
  ]);
});

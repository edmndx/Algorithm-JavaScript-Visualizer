import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  configFile: false,
  server: { middlewareMode: true },
});
after(() => vite.close());

const [{ buildTimeline, getPlaybackSourceLocation }, { getActiveTrace }] =
  await Promise.all([
    vite.ssrLoadModule('/src/playback/timeline.ts'),
    vite.ssrLoadModule('/src/features/useTraceSession.ts'),
  ]);

const commands = [
  { type: 'scene.init', structure: 'array', source: { line: 1 } },
  { type: 'array.create', values: [3, 2], source: { line: 2 } },
  {
    type: 'array.compare',
    indices: [0, 1],
    source: { line: 12, column: 3, endLine: 12, endColumn: 20 },
  },
  { type: 'array.mark', marker: 'probe', indices: [0] },
  { type: 'array.swap', indices: [0, 1], source: { line: 15 } },
  { type: 'array.mark', marker: 'probe', indices: [1], source: { line: 15 } },
];

const timelineResult = buildTimeline(commands);
assert.equal(timelineResult.ok, true);
const timeline = timelineResult.timeline;

test('playback source location follows the selected operation step', () => {
  assert.equal(getPlaybackSourceLocation(timeline, 0), null);
  assert.deepEqual(getPlaybackSourceLocation(timeline, 1), {
    line: 12,
    column: 3,
    endLine: 12,
    endColumn: 20,
  });
  assert.equal(getPlaybackSourceLocation(timeline, 2), null);
  assert.deepEqual(getPlaybackSourceLocation(timeline, 3), { line: 15 });
  assert.deepEqual(getPlaybackSourceLocation(timeline, 4), { line: 15 });
  assert.deepEqual(getPlaybackSourceLocation(timeline, 1), {
    line: 12,
    column: 3,
    endLine: 12,
    endColumn: 20,
  });
});

test('source revision changes make a generated trace stale', () => {
  const acceptedTrace = {
    kind: 'generated',
    sourceRevision: 4,
    structure: 'array',
  };

  assert.deepEqual(
    getActiveTrace(acceptedTrace, {
      code: 'const array = [];',
      revision: 4,
      structure: 'array',
    }),
    { kind: 'generated', structure: 'array' },
  );
  assert.deepEqual(
    getActiveTrace(acceptedTrace, {
      code: 'const array = [1];',
      revision: 5,
      structure: 'array',
    }),
    { kind: 'stale' },
  );
});

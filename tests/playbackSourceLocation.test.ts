import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTimeline,
  getPlaybackSourceLocation,
} from '../src/playback/timeline';

const timelineResult = buildTimeline([
  { type: 'scene.init', structure: 'array', source: { line: 1 } },
  { type: 'array.create', values: [3, 2], source: { line: 2 } },
  { type: 'array.compare', indices: [0, 1], source: { line: 12 } },
  { type: 'array.mark', marker: 'probe', indices: [0] },
  { type: 'array.swap', indices: [0, 1], source: { line: 15 } },
]);

if (!timelineResult.ok) throw timelineResult.error;
const timeline = timelineResult.timeline;

test('playback source location follows the selected operation step', () => {
  assert.equal(getPlaybackSourceLocation(timeline, 0), null);
  assert.deepEqual(getPlaybackSourceLocation(timeline, 1), { line: 12 });
  assert.equal(getPlaybackSourceLocation(timeline, 2), null);
  assert.deepEqual(getPlaybackSourceLocation(timeline, 3), { line: 15 });
  assert.deepEqual(getPlaybackSourceLocation(timeline, 1), { line: 12 });
});

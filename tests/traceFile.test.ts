import assert from 'node:assert/strict';
import test from 'node:test';

import type { TraceCommand } from '../src/protocol';
import { buildTimeline } from '../src/playback';

const commands = [
  { type: 'scene.init', structure: 'array' },
  { type: 'array.create', values: [2, 1] },
  { type: 'array.compare', indices: [0, 1] },
  { type: 'array.swap', indices: [0, 1] },
] satisfies readonly TraceCommand[];

test('exports the playback commands in the versioned trace envelope', async () => {
  const { serializeTraceFile } = await import('../src/features/traceFile');

  assert.equal(
    serializeTraceFile(commands),
    `{
  "version": "1",
  "commands": [
    {
      "type": "scene.init",
      "structure": "array"
    },
    {
      "type": "array.create",
      "values": [
        2,
        1
      ]
    },
    {
      "type": "array.compare",
      "indices": [
        0,
        1
      ]
    },
    {
      "type": "array.swap",
      "indices": [
        0,
        1
      ]
    }
  ]
}`,
  );
});

test('imports valid trace JSON as commands accepted by playback', async () => {
  const { parseTraceFile } = await import('../src/features/traceFile');
  const result = parseTraceFile(JSON.stringify({ version: '1', commands }));

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.commands, commands);
  assert.equal(buildTimeline(result.commands).ok, true);
});

test('rejects malformed JSON without producing playback commands', async () => {
  const { parseTraceFile } = await import('../src/features/traceFile');

  assert.deepEqual(parseTraceFile('{"version":'), {
    ok: false,
    error: {
      code: 'INVALID_JSON',
      message: 'Trace file is not valid JSON.',
    },
  });
});

test('rejects a JSON value that is not a valid trace envelope', async () => {
  const { parseTraceFile } = await import('../src/features/traceFile');
  const result = parseTraceFile(JSON.stringify({ version: '2', commands }));

  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.equal(result.error.code, 'INVALID_TRACE');
  assert.match(result.error.message, /^Trace file validation failed: /);
});

test('uses the algorithm name in the exported trace filename', async () => {
  const { createTraceFileName } = await import('../src/features/traceFile');

  assert.equal(createTraceFileName('bubble-sort'), 'bubble-sort-trace.json');
});

test('an import claim prevents an older execution from owning playback', async () => {
  const { createTraceOwnership } = await import('../src/features/traceFile');
  const ownership = createTraceOwnership();

  ownership.claimExecution();
  assert.equal(ownership.isExecutionOwner(), true);

  ownership.claimImport();
  assert.equal(ownership.isExecutionOwner(), false);
});

test('downloads the exact trace through an attached temporary link', async () => {
  const { downloadTraceFile } = await import('../src/features/traceFile');
  const documentDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
  );
  const createObjectUrl = URL.createObjectURL;
  const revokeObjectUrl = URL.revokeObjectURL;
  const events: string[] = [];
  const capture: { blob?: Blob } = {};
  const link = {
    click() {
      events.push('click');
    },
    download: '',
    href: '',
    remove() {
      events.push('remove');
    },
  };

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      body: {
        append(candidate: unknown) {
          assert.equal(candidate, link);
          events.push('append');
        },
      },
      createElement(tagName: string) {
        assert.equal(tagName, 'a');
        return link;
      },
    },
  });
  URL.createObjectURL = (blob) => {
    assert.ok(blob instanceof Blob);
    capture.blob = blob;
    events.push('create');
    return 'blob:trace-file';
  };
  URL.revokeObjectURL = (url) => {
    assert.equal(url, 'blob:trace-file');
    events.push('revoke');
  };

  try {
    downloadTraceFile('bubble-sort', commands);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(link.href, 'blob:trace-file');
    assert.equal(link.download, 'bubble-sort-trace.json');
    assert.deepEqual(events, ['create', 'append', 'click', 'remove', 'revoke']);
    assert.ok(capture.blob);
    assert.equal(capture.blob.type, 'application/json');
    assert.deepEqual(JSON.parse(await capture.blob.text()), {
      version: '1',
      commands,
    });
  } finally {
    URL.createObjectURL = createObjectUrl;
    URL.revokeObjectURL = revokeObjectUrl;

    if (documentDescriptor === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      Object.defineProperty(globalThis, 'document', documentDescriptor);
    }
  }
});

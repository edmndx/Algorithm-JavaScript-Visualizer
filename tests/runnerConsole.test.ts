import assert from 'node:assert/strict';
import test from 'node:test';

import { runCode } from '../src/runner/runner';

test('runs console call arguments without returning captured output', async () => {
  const result = await runCode(
    `
      let callCount = 0;
      console.log(++callCount);
      console.warn(++callCount);
      console.error(++callCount);

      if (callCount !== 3) {
        throw new Error('Console call arguments were not evaluated.');
      }
    `,
    { tracing: false },
  );

  assert.deepEqual(result, { ok: true, commands: [] });
});

test('isolates console mutations between runs', async () => {
  const firstRun = await runCode(
    `console.log = () => { throw new Error('mutated console'); };`,
    { tracing: false },
  );
  const secondRun = await runCode(`console.log('ignored');`, {
    tracing: false,
  });

  assert.deepEqual(firstRun, { ok: true, commands: [] });
  assert.deepEqual(secondRun, { ok: true, commands: [] });
});

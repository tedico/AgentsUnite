import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHeadless, extractJson } from '../lib/proc.js';

test('captures stdout and stderr separately with exit code', async () => {
  const r = await runHeadless({
    cmd: process.execPath,
    args: ['-e', 'process.stdout.write("OUT"); process.stderr.write("ERR"); process.exit(3)'],
  });
  assert.equal(r.stdout, 'OUT');
  assert.equal(r.stderr, 'ERR');
  assert.equal(r.code, 3);
  assert.equal(r.timedOut, false);
});

test('pipes stdinText to the child', async () => {
  const r = await runHeadless({
    cmd: process.execPath,
    args: ['-e', 'process.stdout.write(require("node:fs").readFileSync(0, "utf8"))'],
    stdinText: 'hello-stdin',
  });
  assert.equal(r.stdout, 'hello-stdin');
});

test('kills on timeout', async () => {
  const r = await runHeadless({
    cmd: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 60000)'],
    timeoutMs: 200,
  });
  assert.equal(r.timedOut, true);
});

test('missing binary resolves with spawnError, never throws', async () => {
  const r = await runHeadless({ cmd: '/nonexistent/binary-xyz', args: [] });
  assert.equal(r.spawnError, true);
  assert.equal(r.code, -1);
});

test('extractJson pulls outermost object from noisy output', () => {
  const noisy = 'update available!\n{"a": {"b": "}"}, "ok": true}\ntrailing junk';
  assert.deepEqual(extractJson(noisy), { a: { b: '}' }, ok: true });
  assert.equal(extractJson('no json here'), null);
  assert.equal(extractJson('{"truncated": '), null);
});

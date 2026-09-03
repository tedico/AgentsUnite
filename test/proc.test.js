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

test('EPIPE from a fast-exiting child while writing large stdinText never throws (F4)', async () => {
  // Without child.stdin.on('error', () => {}) this reliably crashes the whole
  // process with an unhandled 'error' event (verified: 3/3 runs on Node 22
  // throw "Error: write EPIPE" before the guard was added). The child exits
  // immediately, closing its stdin pipe while a large write is still landing.
  const big = 'x'.repeat(50 * 1024 * 1024); // 50MB — large enough to still be writing after exit
  const r = await runHeadless({
    cmd: process.execPath,
    args: ['-e', 'process.exit(0)'],
    stdinText: big,
  });
  assert.equal(r.spawnError, false);
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

test('extractJson skips non-JSON braces and tries next candidate', () => {
  assert.deepEqual(extractJson('[info {init: true}]\n{"ok": true}'), { ok: true });
});

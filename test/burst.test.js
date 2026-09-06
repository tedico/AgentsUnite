import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBurstMerger } from '../lib/burst.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('lines within the window merge into one message joined by newline', async () => {
  const out = [];
  const push = makeBurstMerger((t) => out.push(t), { windowMs: 30 });
  push('self-e');
  push('vident');
  push('truths');
  assert.deepEqual(out, []); // nothing until the window closes
  await sleep(60);
  assert.deepEqual(out, ['self-e\nvident\ntruths']);
});

test('lines separated by more than the window are separate messages', async () => {
  const out = [];
  const push = makeBurstMerger((t) => out.push(t), { windowMs: 20 });
  push('first');
  await sleep(50);
  push('second');
  await sleep(50);
  assert.deepEqual(out, ['first', 'second']);
});

test('a single line still arrives (window default is 300ms)', async () => {
  const out = [];
  const push = makeBurstMerger((t) => out.push(t));
  push('/quit');
  await sleep(350);
  assert.deepEqual(out, ['/quit']);
});

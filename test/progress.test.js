import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTracker } from '../lib/progress.js';

test('tracker emits ts + phase, counts tools, keeps the last tool name', () => {
  const evts = [];
  const t = makeTracker((e) => evts.push(e));
  t.heartbeat();
  t.phase('connected');
  t.tool('Read');
  t.tool('Grep');
  t.phase('replying');
  assert.equal(evts.length, 5);
  assert.ok(evts.every((e) => typeof e.ts === 'number'));
  assert.equal(evts[0].phase, 'alive'); // first bytes arrived
  assert.equal(evts[1].phase, 'connected');
  assert.deepEqual([evts[2].phase, evts[2].lastTool, evts[2].toolCount], ['tool: Read', 'Read', 1]);
  assert.deepEqual([evts[3].phase, evts[3].toolCount], ['tool: Grep', 2]);
  assert.deepEqual([evts[4].phase, evts[4].lastTool, evts[4].toolCount], ['replying', 'Grep', 2]);
});

test('heartbeat only flips starting → alive; later phases are kept', () => {
  const evts = [];
  const t = makeTracker((e) => evts.push(e));
  t.phase('thinking');
  t.heartbeat();
  assert.equal(evts.at(-1).phase, 'thinking');
});

test('tracker with no onProgress is a no-op', () => {
  const t = makeTracker(undefined);
  t.heartbeat(); t.phase('x'); t.tool('Read');
});

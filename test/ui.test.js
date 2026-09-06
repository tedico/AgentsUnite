import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatStatus, makeUi } from '../lib/ui.js';

test('formatStatus without live data is the legacy line', () => {
  const s = formatStatus(0, 'gemini', 32, 2, 3);
  assert.match(s, /@gemini is thinking… \(32s\) — turn 2\/3/);
});

test('formatStatus with live data shows phase, tool count, last tool, idle time', () => {
  const s = formatStatus(0, 'claude', 42, 1, 1, { phase: 'thinking', lastTool: 'Read', toolCount: 3, idleSec: 2 });
  assert.match(s, /@claude thinking · 3 tools \(last Read\) · last activity 2s ago \(42s\) — turn 1\/1/);
  const t = formatStatus(0, 'claude', 5, 1, 1, { phase: 'tool: Grep', lastTool: 'Grep', toolCount: 1, idleSec: 0 });
  assert.match(t, /@claude tool: Grep · 1 tool · last activity 0s ago \(5s\)/);
  const u = formatStatus(0, 'gemini', 1, 1, 2, { phase: 'starting', toolCount: 0, idleSec: null });
  assert.match(u, /@gemini starting \(1s\) — turn 1\/2/);
});

test('printReply and printSystem write colored prefixed lines', () => {
  let buf = '';
  const ui = makeUi({ write: (s) => { buf += s; } });
  ui.printReply('claude', 'hello');
  assert.match(buf, /claude>/);
  assert.match(buf, /hello/);
  buf = '';
  ui.printSystem('turn budget reached');
  assert.match(buf, /turn budget reached/);
});

test('startStatus returns {update, stop}: starts at "starting", update feeds the next render, stop clears', async () => {
  let buf = '';
  const ui = makeUi({ write: (s) => { buf += s; } });
  const status = ui.startStatus('claude', 1, 1);
  assert.match(buf, /@claude starting \(0s\) — turn 1\/1/);
  status.update({ ts: Date.now(), phase: 'tool: Read', lastTool: 'Read', toolCount: 1 });
  await new Promise((r) => setTimeout(r, 300)); // renders run on the 250ms spinner tick
  assert.match(buf, /@claude tool: Read · 1 tool · last activity 0s ago/);
  buf = '';
  status.stop();
  assert.match(buf, /\r/); // line clear happened
  status.update({ ts: Date.now(), phase: 'late' }); // after stop: must not throw or write
  assert.equal(buf, '\r\x1b[2K');
});

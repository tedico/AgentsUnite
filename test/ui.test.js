import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatStatus, makeUi } from '../lib/ui.js';

test('formatStatus shows spinner frame, seat, elapsed, queue position', () => {
  const s = formatStatus(0, 'gemini', 32, 2, 3);
  assert.match(s, /@gemini is thinking… \(32s\) — turn 2\/3/);
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

test('startStatus returns a stop function that clears the line', () => {
  let buf = '';
  const ui = makeUi({ write: (s) => { buf += s; } });
  const stop = ui.startStatus('claude', 1, 1);
  stop();
  assert.match(buf, /\r/); // line clear happened
});

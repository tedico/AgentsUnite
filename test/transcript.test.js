import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendMessage, readTranscript, loadState, saveState, appendErrorLog, lastError } from '../lib/transcript.js';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'unite-chat-')); }
const ROSTER = ['claude', 'gemini', 'cursor'];

test('append + read round-trips messages in order', () => {
  const dir = tmpDir();
  assert.deepEqual(readTranscript(dir), []);
  const m1 = { ts: '2026-09-02T22:00:00Z', from: 'ted', text: 'hi @claude', mentions: ['claude'] };
  const m2 = { ts: '2026-09-02T22:00:05Z', from: 'claude', text: 'hello\nmultiline', mentions: [] };
  appendMessage(dir, m1); appendMessage(dir, m2);
  assert.deepEqual(readTranscript(dir), [m1, m2]);
});

test('loadState defaults missing seats; saveState round-trips', () => {
  const dir = tmpDir();
  const s = loadState(dir, ROSTER);
  assert.deepEqual(s.agents.gemini, { sessionRef: null, cursor: 0 });
  s.agents.gemini = { sessionRef: 'conv-1', cursor: 3 };
  saveState(dir, s);
  const s2 = loadState(dir, ROSTER);
  assert.deepEqual(s2.agents.gemini, { sessionRef: 'conv-1', cursor: 3 });
  assert.deepEqual(s2.agents.claude, { sessionRef: null, cursor: 0 });
});

test('error log appends and lastError returns most recent block', () => {
  const dir = tmpDir();
  assert.equal(lastError(dir), null);
  appendErrorLog(dir, 'gemini', 'first failure');
  appendErrorLog(dir, 'cursor', 'second failure');
  assert.match(lastError(dir), /cursor/);
  assert.match(lastError(dir), /second failure/);
});

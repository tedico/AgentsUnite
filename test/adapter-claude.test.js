import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeAdapter } from '../lib/adapters/claude.js';
import { makeStub, readStubCall, stubDir } from './helpers/stub.js';

const OK_JSON = JSON.stringify({ result: 'hello from claude', session_id: 'sess-123' });

test('first turn: plan mode, json output, prompt via stdin, captures session_id', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: `noise before\n${OK_JSON}` });
  const a = claudeAdapter({ binary: bin, timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'THE DELTA', sessionRef: null });
  assert.deepEqual(res, { ok: true, replyText: 'hello from claude', sessionRef: 'sess-123' });
  const call = readStubCall();
  assert.deepEqual(call.argv, ['-p', '--permission-mode', 'plan', '--output-format', 'json']);
  assert.equal(call.stdin, 'THE DELTA');
});

test('later turn adds --resume; model override adds --model', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: OK_JSON });
  const a = claudeAdapter({ binary: bin, model: 'opus', timeoutMs: 5000 });
  await a.invoke({ prompt: 'x', sessionRef: 'sess-123' });
  const call = readStubCall();
  assert.deepEqual(call.argv,
    ['-p', '--permission-mode', 'plan', '--output-format', 'json', '--model', 'opus', '--resume', 'sess-123']);
});

test('nonzero exit with a sessionRef reports sessionLost for engine self-heal', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stderr: 'session not found', code: 1 });
  const a = claudeAdapter({ binary: bin, timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'x', sessionRef: 'gone' });
  assert.equal(res.ok, false);
  assert.equal(res.sessionLost, true);
  assert.match(res.stderr, /session not found/);
});

test('nonzero exit without sessionRef is a plain failure', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stderr: 'auth broke', code: 2 });
  const a = claudeAdapter({ binary: bin, timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'x', sessionRef: null });
  assert.deepEqual({ ok: res.ok, sessionLost: res.sessionLost ?? false }, { ok: false, sessionLost: false });
});

test('garbage stdout is a bad-json failure, not a crash', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: 'I am not JSON' });
  const a = claudeAdapter({ binary: bin, timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'x', sessionRef: null });
  assert.equal(res.ok, false);
  assert.match(res.error, /json/i);
});

test('a leading JSON update notice does not shadow the result payload', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: `{"notice":"update available"}\n${OK_JSON}` });
  const a = claudeAdapter({ binary: bin, timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'x', sessionRef: null });
  assert.deepEqual(res, { ok: true, replyText: 'hello from claude', sessionRef: 'sess-123' });
});

test('missing binary is a failure result, not an exception', async () => {
  stubDir();
  const a = claudeAdapter({ binary: '/nope/claude', timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'x', sessionRef: null });
  assert.equal(res.ok, false);
});

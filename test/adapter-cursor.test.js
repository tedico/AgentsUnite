import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cursorAdapter } from '../lib/adapters/cursor.js';
import { makeStub, readStubCall, stubDir } from './helpers/stub.js';

test('first turn: plan mode, json output, prompt as trailing positional', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: JSON.stringify({ chatId: 'chat-7', result: 'cursor here' }) });
  const a = cursorAdapter({ binary: bin, timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'THE DELTA', sessionRef: null });
  assert.deepEqual(res, { ok: true, replyText: 'cursor here', sessionRef: 'chat-7' });
  assert.deepEqual(readStubCall().argv,
    ['-p', '--mode', 'plan', '--output-format', 'json', 'THE DELTA']);
});

test('later turn adds --resume; tolerates alternate JSON field names', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: JSON.stringify({ chat_id: 'chat-7', response: 'alt fields' }) });
  const a = cursorAdapter({ binary: bin, timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'x', sessionRef: 'chat-7' });
  assert.deepEqual(res, { ok: true, replyText: 'alt fields', sessionRef: 'chat-7' });
  assert.deepEqual(readStubCall().argv,
    ['-p', '--mode', 'plan', '--output-format', 'json', '--resume', 'chat-7', 'x']);
});

test('reply text missing entirely → bad json failure', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: JSON.stringify({ chatId: 'chat-7' }) });
  const a = cursorAdapter({ binary: bin, timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'x', sessionRef: null });
  assert.equal(res.ok, false);
});

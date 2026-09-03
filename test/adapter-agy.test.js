import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agyAdapter } from '../lib/adapters/agy.js';
import { makeStub, readStubCall, stubDir } from './helpers/stub.js';

const OK_JSON = JSON.stringify({ conversation_id: 'conv-9', status: 'SUCCESS', response: 'gemini here' });

test('first turn: prompt is the VALUE of --print (greedy-parse safe), plan mode', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: OK_JSON, stderr: 'jetski: telemetry noise' });
  const a = agyAdapter({ binary: bin, timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'THE DELTA', sessionRef: null });
  assert.deepEqual(res, { ok: true, replyText: 'gemini here', sessionRef: 'conv-9' });
  const call = readStubCall();
  assert.deepEqual(call.argv,
    ['--print', 'THE DELTA', '--mode', 'plan', '--output-format', 'json']);
});

test('later turn adds --conversation', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: OK_JSON });
  const a = agyAdapter({ binary: bin, timeoutMs: 5000 });
  await a.invoke({ prompt: 'x', sessionRef: 'conv-9' });
  assert.deepEqual(readStubCall().argv,
    ['--print', 'x', '--mode', 'plan', '--output-format', 'json', '--conversation', 'conv-9']);
});

test('failure shapes: nonzero exit w/ session → sessionLost; garbage json → bad json', async () => {
  const dir = stubDir();
  const bad = agyAdapter({ binary: makeStub(dir, { code: 2, stderr: 'dead conv' }), timeoutMs: 5000 });
  const r1 = await bad.invoke({ prompt: 'x', sessionRef: 'conv-9' });
  assert.deepEqual({ ok: r1.ok, sessionLost: r1.sessionLost }, { ok: false, sessionLost: true });
  const garbage = agyAdapter({ binary: makeStub(dir, { stdout: 'nope' }), timeoutMs: 5000 });
  const r2 = await garbage.invoke({ prompt: 'x', sessionRef: null });
  assert.match(r2.error, /json/i);
});

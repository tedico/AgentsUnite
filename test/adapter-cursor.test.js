import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cursorAdapter } from '../lib/adapters/cursor.js';
import { makeStub, readStubCall, stubDir } from './helpers/stub.js';

// Trimmed from a real `cursor-agent -p --trust --mode plan --output-format
// stream-json` run (2026-09-06). Note the thinking events' top-level "text".
const STREAM = [
  '{"type":"system","subtype":"init","apiKeySource":"login","cwd":"/x","session_id":"chat-7","model":"Cursor Grok 4.6 High Fast","permissionMode":"default"}',
  '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"THE DELTA"}]},"session_id":"chat-7"}',
  '{"type":"thinking","subtype":"delta","text":"Reading package.json","session_id":"chat-7","timestamp_ms":1}',
  '{"type":"thinking","subtype":"completed","session_id":"chat-7","timestamp_ms":2}',
  '{"type":"tool_call","subtype":"started","call_id":"call-1","tool_call":{"readToolCall":{"args":{"path":"/x/package.json"}},"toolCallId":"call-1"},"session_id":"chat-7"}',
  '{"type":"tool_call","subtype":"completed","call_id":"call-1","tool_call":{"readToolCall":{"args":{"path":"/x/package.json"},"result":{"success":{"content":"{}"}}},"toolCallId":"call-1"},"session_id":"chat-7"}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"cursor here"}]},"session_id":"chat-7"}',
  '{"type":"result","subtype":"success","duration_ms":4291,"is_error":false,"result":"cursor here","session_id":"chat-7","request_id":"r-1"}',
].join('\n') + '\n';

const BASE_ARGV = ['-p', '--trust', '--mode', 'plan', '--output-format', 'stream-json'];

test('first turn: plan mode, stream-json, prompt as trailing positional, result event parsed', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: STREAM });
  const a = cursorAdapter({ binary: bin, timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'THE DELTA', sessionRef: null });
  assert.deepEqual(res, { ok: true, replyText: 'cursor here', sessionRef: 'chat-7' });
  assert.deepEqual(readStubCall().argv, [...BASE_ARGV, '--', 'THE DELTA']);
});

test('thinking events (top-level "text") never shadow the reply', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: STREAM });
  const a = cursorAdapter({ binary: bin, timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'x', sessionRef: null });
  assert.equal(res.replyText, 'cursor here');
});

test('progress: connected → thinking → tool: read (count 1) → replying', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: STREAM });
  const a = cursorAdapter({ binary: bin, timeoutMs: 5000 });
  const evts = [];
  await a.invoke({ prompt: 'x', sessionRef: null, onProgress: (e) => evts.push(e) });
  const phases = evts.map((e) => e.phase);
  for (const p of ['connected', 'thinking', 'tool: read', 'replying']) assert.ok(phases.includes(p), `missing phase ${p}`);
  assert.ok(phases.indexOf('connected') < phases.indexOf('tool: read'));
  const toolEvt = evts.find((e) => e.phase === 'tool: read');
  assert.deepEqual([toolEvt.lastTool, toolEvt.toolCount], ['read', 1]);
  assert.equal(evts.at(-1).toolCount, 1); // "completed" does not double-count
});

test('later turn adds --resume', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: STREAM });
  const a = cursorAdapter({ binary: bin, timeoutMs: 5000 });
  await a.invoke({ prompt: 'x', sessionRef: 'chat-7' });
  assert.deepEqual(readStubCall().argv, [...BASE_ARGV, '--resume', 'chat-7', '--', 'x']);
});

test('result event with an alternate reply field name is tolerated', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: '{"type":"result","response":"alt fields","session_id":"sess-9"}\n' });
  const a = cursorAdapter({ binary: bin, timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'x', sessionRef: null });
  assert.deepEqual(res, { ok: true, replyText: 'alt fields', sessionRef: 'sess-9' });
});

test('reply text missing entirely → bad json failure', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: '{"type":"result","session_id":"chat-7"}\n' });
  const a = cursorAdapter({ binary: bin, timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'x', sessionRef: null });
  assert.equal(res.ok, false);
});

test('nonzero exit with sessionRef reports sessionLost for engine self-heal', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stderr: 'chat not found', code: 1 });
  const a = cursorAdapter({ binary: bin, timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'x', sessionRef: 'chat-7' });
  assert.equal(res.ok, false);
  assert.equal(res.sessionLost, true);
  assert.match(res.stderr, /chat not found/);
});

test('nonzero stream-json result preserves its stdout diagnostic', async () => {
  const dir = stubDir();
  const diagnostic = 'Cursor request limit reached; try again later';
  const stdout = `${JSON.stringify({ type: 'result', is_error: true, result: diagnostic })}\n`;
  const a = cursorAdapter({ binary: makeStub(dir, { stdout, code: 1 }), timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'x', sessionRef: null });
  assert.equal(res.ok, false);
  assert.match(res.stderr, /request limit/);
});

test('empty result is an empty-reply failure', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: '{"type":"result","is_error":false,"result":""}\n' });
  const res = await cursorAdapter({ binary: bin, timeoutMs: 5000 }).invoke({ prompt: 'x', sessionRef: null });
  assert.equal(res.ok, false);
  assert.match(res.error, /empty/i);
});

test('is_error result is a failure, not a reply', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: '{"type":"result","is_error":true,"result":"authentication expired"}\n' });
  const res = await cursorAdapter({ binary: bin, timeoutMs: 5000 }).invoke({ prompt: 'x', sessionRef: null });
  assert.equal(res.ok, false);
  assert.match(res.stderr, /authentication expired/);
  assert.equal('replyText' in res, false);
});

test('a leading JSON update notice does not shadow the payload', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: `{"notice":"update available"}\n${STREAM}` });
  const a = cursorAdapter({ binary: bin, timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'x', sessionRef: null });
  assert.deepEqual(res, { ok: true, replyText: 'cursor here', sessionRef: 'chat-7' });
});

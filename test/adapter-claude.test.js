import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeAdapter, NO_MCP_ARGS } from '../lib/adapters/claude.js';
import { makeStub, readStubCall, stubDir } from './helpers/stub.js';

// Trimmed from a real `claude -p --output-format stream-json --verbose` run
// (claude 2.1.263, 2026-09-06). Event order and key names are the real ones.
const STREAM = [
  '{"type":"system","subtype":"hook_started","hook_name":"SessionStart:startup","session_id":"sess-123"}',
  '{"type":"system","subtype":"init","cwd":"/x","session_id":"sess-123","tools":["Read"],"mcp_servers":[],"model":"claude-fable-5-1","permissionMode":"plan"}',
  '{"type":"system","subtype":"thinking_tokens","estimated_tokens":50,"session_id":"sess-123"}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"/x/package.json"}}]},"session_id":"sess-123"}',
  '{"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_1","type":"tool_result","content":"{\\"result\\": \\"decoy\\"}"}]},"session_id":"sess-123"}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello from claude"}]},"session_id":"sess-123"}',
  '{"type":"result","subtype":"success","is_error":false,"num_turns":2,"result":"hello from claude","session_id":"sess-123","duration_ms":5718}',
].join('\n') + '\n';

const BASE_ARGV = ['-p', '--permission-mode', 'plan', '--output-format', 'stream-json', '--verbose', ...NO_MCP_ARGS];

test('first turn: plan mode, stream-json + --verbose, MCP off, prompt via stdin, result event parsed', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: `noise before\n${STREAM}` });
  const a = claudeAdapter({ binary: bin, timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'THE DELTA', sessionRef: null });
  assert.deepEqual(res, { ok: true, replyText: 'hello from claude', sessionRef: 'sess-123' });
  const call = readStubCall();
  assert.deepEqual(call.argv, BASE_ARGV);
  assert.equal(call.stdin, 'THE DELTA');
});

test('NO_MCP_ARGS are the verified flags', () => {
  assert.deepEqual(NO_MCP_ARGS, ['--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}']);
});

test('progress: connected → thinking → tool: Read (count 1) → replying', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: STREAM });
  const a = claudeAdapter({ binary: bin, timeoutMs: 5000 });
  const evts = [];
  await a.invoke({ prompt: 'x', sessionRef: null, onProgress: (e) => evts.push(e) });
  const phases = evts.map((e) => e.phase);
  for (const p of ['connected', 'thinking', 'tool: Read', 'replying']) assert.ok(phases.includes(p), `missing phase ${p}`);
  assert.ok(phases.indexOf('connected') < phases.indexOf('tool: Read'));
  assert.ok(phases.indexOf('tool: Read') < phases.indexOf('replying'));
  const toolEvt = evts.find((e) => e.phase === 'tool: Read');
  assert.deepEqual([toolEvt.lastTool, toolEvt.toolCount], ['Read', 1]);
  assert.ok(evts.every((e) => typeof e.ts === 'number'));
});

test('a tool result that contains a "result" key does not shadow the reply', async () => {
  // The user/tool_result line in STREAM carries {"result": "decoy"} as text.
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: STREAM });
  const a = claudeAdapter({ binary: bin, timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'x', sessionRef: null });
  assert.equal(res.replyText, 'hello from claude');
});

test('later turn adds --resume; model override adds --model; mcp:true drops the MCP flags', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: STREAM });
  const a = claudeAdapter({ binary: bin, model: 'opus', timeoutMs: 5000 });
  await a.invoke({ prompt: 'x', sessionRef: 'sess-123' });
  assert.deepEqual(readStubCall().argv, [...BASE_ARGV, '--model', 'opus', '--resume', 'sess-123']);
  const b = claudeAdapter({ binary: bin, timeoutMs: 5000, mcp: true });
  await b.invoke({ prompt: 'x', sessionRef: null });
  assert.deepEqual(readStubCall().argv, ['-p', '--permission-mode', 'plan', '--output-format', 'stream-json', '--verbose']);
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
  const bin = makeStub(dir, { stdout: `{"notice":"update available"}\n${STREAM}` });
  const a = claudeAdapter({ binary: bin, timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'x', sessionRef: null });
  assert.deepEqual(res, { ok: true, replyText: 'hello from claude', sessionRef: 'sess-123' });
});

test('a single result object with no trailing newline is still parsed (flush)', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: '{"type":"result","result":"terse","session_id":"s9"}' });
  const a = claudeAdapter({ binary: bin, timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'x', sessionRef: null });
  assert.deepEqual(res, { ok: true, replyText: 'terse', sessionRef: 's9' });
});

test('missing binary is a failure result, not an exception', async () => {
  stubDir();
  const a = claudeAdapter({ binary: '/nope/claude', timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'x', sessionRef: null });
  assert.equal(res.ok, false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgv, parsePlanCommand, PLAN_USAGE } from '../lib/cli.js';

const UNITE = fileURLToPath(new URL('../bin/unite.js', import.meta.url));

function runUnite(cwd, args, { timeoutMs = 5000, stdin } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [UNITE, ...args], {
      cwd,
      stdio: [stdin != null ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    if (stdin != null) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

test('argv dispatch', () => {
  assert.deepEqual(parseArgv([]), { cmd: 'open', name: null });
  assert.deepEqual(parseArgv(['new', 'sprint']), { cmd: 'new', name: 'sprint' });
  assert.deepEqual(parseArgv(['new']), { cmd: 'new', name: 'main' });
  assert.deepEqual(parseArgv(['resume']), { cmd: 'resume', name: null });
  assert.deepEqual(parseArgv(['ls']), { cmd: 'ls', name: null });
  assert.deepEqual(parseArgv(['digest', 'sprint']), { cmd: 'digest', name: 'sprint' });
  assert.deepEqual(parseArgv(['digest']), { cmd: 'digest', name: null });
});

test('unknown roster seat in config fails fast with a clean error, even for ls', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unite-c1-'));
  fs.mkdirSync(path.join(root, '.unite'), { recursive: true });
  fs.writeFileSync(path.join(root, '.unite', 'config.json'),
    JSON.stringify({ roster: ['claude', 'gpt'] }));
  const { code, stdout, stderr } = await runUnite(root, ['ls']);
  assert.equal(code, 1);
  assert.match(stderr, /unknown seat "gpt" in config roster; valid seats: claude, gemini, cursor/);
  assert.doesNotMatch(stderr, /TypeError/);
  assert.doesNotMatch(stderr, /^\s+at /m);
  assert.doesNotMatch(stdout, /TypeError/);
});

test('throwing round appends the full stack to the chat errors.log', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unite-c5-'));
  const chat = path.join(root, '.unite', 'chats', 'main');
  fs.mkdirSync(chat, { recursive: true });
  fs.writeFileSync(path.join(chat, 'transcript.jsonl'),
    JSON.stringify({ ts: 't0', from: 'ted', text: null, mentions: ['claude'] }) + '\n');
  await runUnite(root, [], { stdin: '@claude go\n/quit\n' });
  const log = fs.readFileSync(path.join(chat, 'errors.log'), 'utf8');
  assert.match(log, /round failed|TypeError|Cannot read propert/i);
  assert.match(log, /^\s+at /m);
});

const ROSTER = ['claude', 'gemini', 'cursor'];

test('parsePlanCommand: not a /plan line → null', () => {
  assert.equal(parsePlanCommand('hello @claude', ROSTER), null);
  assert.equal(parsePlanCommand('/planet earth', ROSTER), null);
});

test('parsePlanCommand: bare /plan → usage; /plan off → off', () => {
  assert.deepEqual(parsePlanCommand('/plan', ROSTER), { kind: 'usage' });
  assert.deepEqual(parsePlanCommand('/plan   ', ROSTER), { kind: 'usage' });
  assert.deepEqual(parsePlanCommand('/plan off', ROSTER), { kind: 'off' });
  assert.match(PLAN_USAGE, /\/plan \[@seat\] <what to plan>/);
});

test('parsePlanCommand: text without a seat uses the default planner (null)', () => {
  assert.deepEqual(parsePlanCommand('/plan build a widget', ROSTER), { kind: 'start', planner: null, text: 'build a widget' });
});

test('parsePlanCommand: leading @seat picks the planner and is stripped from the text', () => {
  assert.deepEqual(parsePlanCommand('/plan @gemini build a widget', ROSTER), { kind: 'start', planner: 'gemini', text: 'build a widget' });
  assert.deepEqual(parsePlanCommand('/plan @Gemini  multi\nline', ROSTER), { kind: 'start', planner: 'gemini', text: 'multi\nline' });
});

test('parsePlanCommand: unknown seat, or a seat with no text, is rejected', () => {
  assert.deepEqual(parsePlanCommand('/plan @bogus build', ROSTER), { kind: 'bad-seat', seat: 'bogus' });
  assert.deepEqual(parsePlanCommand('/plan @gemini', ROSTER), { kind: 'usage' });
});

test('REPL: /plan usage, unknown seat, and /plan off work end to end without a model call', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unite-c6-'));
  const { code, stdout } = await runUnite(root, ['new', 'play'], { stdin: '/plan\n/plan @bogus x\n/plan off\n/quit\n' });
  assert.equal(code, 0);
  assert.match(stdout, /usage: \/plan \[@seat\] <what to plan>/);
  assert.match(stdout, /unknown seat "@bogus"/);
  assert.match(stdout, /planning mode was not on/);
  const chat = path.join(root, '.unite', 'chats', 'play');
  const state = JSON.parse(fs.readFileSync(path.join(chat, 'state.json'), 'utf8'));
  assert.equal(state.planner, null);
  assert.equal(state.policyVersion, 2); // fresh chat: stamped, no notice line
  const lines = fs.readFileSync(path.join(chat, 'transcript.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((m) => m.text), ['Planning mode ended.']);
});

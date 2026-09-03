import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runRound, RoundControl } from '../lib/engine.js';
import { readTranscript, loadState } from '../lib/transcript.js';
import { BUDGET_NOTICE } from '../lib/deltas.js';

const CONFIG = { roster: ['claude', 'gemini', 'cursor'], turnCap: 8, timeoutMs: 1000, binaries: {}, models: {} };
const quietUi = { startStatus: () => () => {}, printReply: () => {}, printSystem: () => {} };
const ROSTER = CONFIG.roster;

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'unite-eng-')); }

function fakeAdapter(seat, replies = []) {
  const calls = [];
  return {
    seat,
    calls,
    async invoke({ prompt, sessionRef, signal }) {
      calls.push({ prompt, sessionRef });
      return replies.shift() ?? { ok: true, replyText: `${seat} says ok`, sessionRef: `s-${seat}` };
    },
  };
}

function run(dir, adapters, humanText, config = CONFIG) {
  return runRound({ humanText, dir, adapters, config, ui: quietUi, control: new RoundControl() });
}

test('single mention: one turn, transcript and state updated', async () => {
  const dir = tmpDir();
  const claude = fakeAdapter('claude');
  await run(dir, { claude: claude, gemini: fakeAdapter('gemini'), cursor: fakeAdapter('cursor') }, 'hey @claude');
  const t = readTranscript(dir);
  assert.equal(t.length, 2);
  assert.equal(t[0].from, 'ted');
  assert.equal(t[1].from, 'claude');
  assert.equal(claude.calls.length, 1);
  assert.match(claude.calls[0].prompt, /You are Claude/); // first turn gets preamble
  const s = loadState(dir, ROSTER);
  assert.equal(s.agents.claude.sessionRef, 's-claude');
  assert.equal(s.agents.claude.cursor, 2); // saw ted's msg + own reply
  assert.equal(s.agents.gemini.cursor, 0);
});

test('@all runs sequentially; later agents see earlier replies', async () => {
  const dir = tmpDir();
  const adapters = { claude: fakeAdapter('claude'), gemini: fakeAdapter('gemini'), cursor: fakeAdapter('cursor') };
  await run(dir, adapters, '@all thoughts?');
  assert.match(adapters.gemini.calls[0].prompt, /\[Claude\]: claude says ok/);
  assert.match(adapters.cursor.calls[0].prompt, /\[Gemini\]: gemini says ok/);
});

test('chained mention queues that agent once, never self, never duplicates', async () => {
  const dir = tmpDir();
  const claude = fakeAdapter('claude', [
    { ok: true, replyText: 'ask @gemini and again @gemini and myself @claude', sessionRef: 's-claude' },
  ]);
  const gemini = fakeAdapter('gemini');
  await run(dir, { claude, gemini, cursor: fakeAdapter('cursor') }, '@claude go');
  assert.equal(claude.calls.length, 1);
  assert.equal(gemini.calls.length, 1);
});

test('turn cap: stops at cap, final turn gets budget notice', async () => {
  const dir = tmpDir();
  // claude and gemini mention each other forever
  const loop = (seat, other) => ({
    seat,
    calls: [],
    async invoke({ prompt }) {
      this.calls.push({ prompt });
      return { ok: true, replyText: `over to @${other}`, sessionRef: `s-${seat}` };
    },
  });
  const claude = loop('claude', 'gemini');
  const gemini = loop('gemini', 'claude');
  await run(dir, { claude, gemini, cursor: fakeAdapter('cursor') }, '@claude start');
  const agentTurns = claude.calls.length + gemini.calls.length;
  assert.equal(agentTurns, 8);
  const lastPrompt = (gemini.calls.length ? gemini : claude).calls.at(-1).prompt;
  assert.match(lastPrompt, new RegExp(BUDGET_NOTICE.slice(0, 20)));
});

test('turn cap: printSystem notice fires when the final turn\'s reply is suppressed (ping-pong)', async () => {
  const dir = tmpDir();
  // claude and gemini mention each other forever; the final turn's mention
  // never lands in the queue (nothing left to drain there) but IS suppressed.
  const loop = (seat, other) => ({
    seat,
    calls: [],
    async invoke() { return { ok: true, replyText: `over to @${other}`, sessionRef: `s-${seat}` }; },
  });
  const claude = loop('claude', 'gemini');
  const gemini = loop('gemini', 'claude');
  const systemMsgs = [];
  const ui = { startStatus: () => () => {}, printReply: () => {}, printSystem: (t) => systemMsgs.push(t) };
  await runRound({ humanText: '@claude start', dir, adapters: { claude, gemini, cursor: fakeAdapter('cursor') }, config: CONFIG, ui, control: new RoundControl() });
  assert.ok(systemMsgs.some((m) => /turn budget \(8\) reached — back to you/.test(m)));
});

test('turn cap: no printSystem notice when the round ends naturally under the cap', async () => {
  const dir = tmpDir();
  const systemMsgs = [];
  const ui = { startStatus: () => () => {}, printReply: () => {}, printSystem: (t) => systemMsgs.push(t) };
  // default reply mentions nobody, so the round ends naturally after 1 turn, well under the cap.
  const claude = fakeAdapter('claude');
  await runRound({ humanText: '@claude hi', dir, adapters: { claude, gemini: fakeAdapter('gemini'), cursor: fakeAdapter('cursor') }, config: CONFIG, ui, control: new RoundControl() });
  assert.ok(!systemMsgs.some((m) => /turn budget/.test(m)));
});

test('rejected invoke degrades to failure-as-absence, not an unhandled rejection', async () => {
  const dir = tmpDir();
  const gemini = { seat: 'gemini', calls: [], async invoke() { this.calls.push({}); throw new Error('boom'); } };
  const cursor = fakeAdapter('cursor');
  await run(dir, { claude: fakeAdapter('claude'), gemini, cursor }, '@gemini then @cursor');
  const t = readTranscript(dir);
  assert.ok(t.some((m) => m.from === 'system' && /gemini offline/.test(m.text)));
  assert.equal(cursor.calls.length, 1); // queue continued despite the throw
  const s = loadState(dir, ROSTER);
  assert.equal(s.agents.gemini.cursor, 0); // failed agent saw nothing
});

test('failure = absence: system message recorded, cursor not advanced, round continues', async () => {
  const dir = tmpDir();
  const gemini = fakeAdapter('gemini', [{ ok: false, error: 'exit 1', stderr: 'boom' }]);
  const cursor = fakeAdapter('cursor');
  await run(dir, { claude: fakeAdapter('claude'), gemini, cursor }, '@gemini then @cursor');
  const t = readTranscript(dir);
  assert.ok(t.some((m) => m.from === 'system' && /gemini offline/.test(m.text)));
  assert.equal(cursor.calls.length, 1); // queue continued
  const s = loadState(dir, ROSTER);
  assert.equal(s.agents.gemini.cursor, 0); // failed agent saw nothing
  assert.ok(fs.existsSync(path.join(dir, 'errors.log')));
});

test('self-healing: sessionLost triggers one fresh-session replay retry', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'state.json'),
    JSON.stringify({ agents: { claude: { sessionRef: 'dead-session', cursor: 0 } } }));
  const claude = fakeAdapter('claude', [
    { ok: false, error: 'exit 1', sessionLost: true },
    { ok: true, replyText: 'recovered', sessionRef: 's-new' },
  ]);
  await run(dir, { claude, gemini: fakeAdapter('gemini'), cursor: fakeAdapter('cursor') }, '@claude hi');
  assert.equal(claude.calls.length, 2);
  assert.equal(claude.calls[0].sessionRef, 'dead-session');
  assert.equal(claude.calls[1].sessionRef, null);
  assert.match(claude.calls[1].prompt, /You are Claude/); // replay includes preamble
  const s = loadState(dir, ROSTER);
  assert.equal(s.agents.claude.sessionRef, 's-new');
});

test('prompt-building throw still stops the spinner via finally (F5)', async () => {
  const dir = tmpDir();
  // A malformed transcript line (e.g. from a corrupt write) parses fine as
  // JSON but has a non-string text field, which blows up inside buildPrompt
  // (renderLines calls m.text.replace). The spinner must still be stopped.
  fs.appendFileSync(path.join(dir, 'transcript.jsonl'),
    JSON.stringify({ ts: 't0', from: 'ted', text: null, mentions: ['claude'] }) + '\n');
  let started = 0;
  let stopped = 0;
  const ui = {
    startStatus: () => { started++; return () => { stopped++; }; },
    printReply: () => {},
    printSystem: () => {},
  };
  await assert.rejects(runRound({
    humanText: '@claude go', dir, adapters: { claude: fakeAdapter('claude'), gemini: fakeAdapter('gemini'), cursor: fakeAdapter('cursor') },
    config: CONFIG, ui, control: new RoundControl(),
  }));
  assert.equal(started, 1);
  assert.equal(stopped, 1); // stopStatus ran via finally despite the throw
});

test('drain() stops the queue', async () => {
  const dir = tmpDir();
  const control = new RoundControl();
  const claude = {
    seat: 'claude', calls: [],
    async invoke() { control.drain(); return { ok: true, replyText: 'ok @gemini', sessionRef: 's' }; },
  };
  const gemini = fakeAdapter('gemini');
  await runRound({ humanText: '@claude go', dir, adapters: { claude, gemini, cursor: fakeAdapter('cursor') }, config: CONFIG, ui: quietUi, control });
  assert.equal(gemini.calls.length, 0);
});

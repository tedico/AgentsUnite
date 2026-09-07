import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runRound, RoundControl, applyPolicyNotice, endPlanning } from '../lib/engine.js';
import { readTranscript, loadState, appendMessage } from '../lib/transcript.js';
import { BUDGET_NOTICE, POLICY_NOTICE } from '../lib/deltas.js';

const CONFIG = { roster: ['claude', 'gemini', 'cursor'], turnCap: 8, timeoutMs: 1000, binaries: {}, models: {}, planner: 'claude' };
const noStatus = () => ({ update() {}, stop() {} });
const quietUi = { startStatus: noStatus, printReply: () => {}, printSystem: () => {} };
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
  const ui = { startStatus: noStatus, printReply: () => {}, printSystem: (t) => systemMsgs.push(t) };
  await runRound({ humanText: '@claude start', dir, adapters: { claude, gemini, cursor: fakeAdapter('cursor') }, config: CONFIG, ui, control: new RoundControl() });
  assert.ok(systemMsgs.some((m) => /turn budget \(8\) reached — back to you/.test(m)));
});

test('turn cap: no printSystem notice when the round ends naturally under the cap', async () => {
  const dir = tmpDir();
  const systemMsgs = [];
  const ui = { startStatus: noStatus, printReply: () => {}, printSystem: (t) => systemMsgs.push(t) };
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
    startStatus: () => { started++; return { update() {}, stop() { stopped++; } }; },
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

test('ok reply with no sessionRef prints a system warning', async () => {
  const dir = tmpDir();
  const systemMsgs = [];
  const ui = { startStatus: noStatus, printReply: () => {}, printSystem: (t) => systemMsgs.push(t) };
  const claude = fakeAdapter('claude', [{ ok: true, replyText: 'hi', sessionRef: null }]);
  await runRound({
    humanText: '@claude go', dir,
    adapters: { claude, gemini: fakeAdapter('gemini'), cursor: fakeAdapter('cursor') },
    config: CONFIG, ui, control: new RoundControl(),
  });
  assert.ok(systemMsgs.some((m) => /@claude/.test(m) && /session ref/i.test(m)));
  const s = loadState(dir, ROSTER);
  assert.equal(s.agents.claude.sessionRef, null);
});

test('a turn aborted by ^C records "skipped by Ted (^C)", never "offline"', async () => {
  const dir = tmpDir();
  const control = new RoundControl();
  const claude = {
    seat: 'claude',
    async invoke({ signal }) {
      control.skipTurn(); // what bin/unite.js does on the first ^C
      assert.equal(signal.aborted, true);
      return { ok: false, error: 'exit 137', stderr: 'killed' };
    },
  };
  const systemMsgs = [];
  const ui = { startStatus: noStatus, printReply: () => {}, printSystem: (t) => systemMsgs.push(t) };
  await runRound({ humanText: '@claude go', dir, adapters: { claude, gemini: fakeAdapter('gemini'), cursor: fakeAdapter('cursor') }, config: CONFIG, ui, control });
  const t = readTranscript(dir);
  assert.ok(t.some((m) => m.from === 'system' && m.text === '@claude skipped by Ted (^C)'));
  assert.ok(!t.some((m) => /offline/.test(m.text)));
  assert.ok(systemMsgs.includes('claude> [skipped by Ted (^C)]'));
  assert.equal(loadState(dir, ROSTER).agents.claude.cursor, 0); // skipped seat saw nothing
});

test('a non-zero exit still records "offline: exit N"', async () => {
  const dir = tmpDir();
  const claude = fakeAdapter('claude', [{ ok: false, error: 'exit 2', stderr: 'boom' }]);
  const systemMsgs = [];
  const ui = { startStatus: noStatus, printReply: () => {}, printSystem: (t) => systemMsgs.push(t) };
  await runRound({ humanText: '@claude go', dir, adapters: { claude, gemini: fakeAdapter('gemini'), cursor: fakeAdapter('cursor') }, config: CONFIG, ui, control: new RoundControl() });
  assert.ok(readTranscript(dir).some((m) => m.text === '@claude offline: exit 2'));
  assert.ok(systemMsgs.some((m) => /claude> \[offline: exit 2/.test(m)));
});

test('adapter progress events reach the status line and never the transcript', async () => {
  const dir = tmpDir();
  const seen = [];
  const ui = { startStatus: () => ({ update: (e) => seen.push(e), stop() {} }), printReply: () => {}, printSystem: () => {} };
  const claude = {
    seat: 'claude',
    async invoke({ onProgress }) {
      onProgress({ ts: 1, phase: 'connected' });
      onProgress({ ts: 2, phase: 'tool: Read', lastTool: 'Read', toolCount: 1 });
      return { ok: true, replyText: 'hi', sessionRef: 's' };
    },
  };
  await runRound({ humanText: '@claude go', dir, adapters: { claude, gemini: fakeAdapter('gemini'), cursor: fakeAdapter('cursor') }, config: CONFIG, ui, control: new RoundControl() });
  assert.deepEqual(seen.map((e) => e.phase), ['connected', 'tool: Read']);
  assert.ok(!JSON.stringify(readTranscript(dir)).includes('tool: Read'));
});

test('applyPolicyNotice: an existing chat gets exactly one notice across two starts', () => {
  const dir = tmpDir();
  appendMessage(dir, { ts: 't0', from: 'ted', text: 'hi @claude', mentions: ['claude'] });
  assert.equal(applyPolicyNotice(dir, ROSTER), true);
  assert.equal(applyPolicyNotice(dir, ROSTER), false);
  const notices = readTranscript(dir).filter((m) => m.from === 'system' && m.text === POLICY_NOTICE);
  assert.equal(notices.length, 1);
  assert.deepEqual(notices[0].mentions, []);
  assert.equal(loadState(dir, ROSTER).policyVersion, 2);
});

test('applyPolicyNotice: a fresh chat is stamped without a notice (its preamble already carries the policy)', () => {
  const dir = tmpDir();
  assert.equal(applyPolicyNotice(dir, ROSTER), false);
  assert.deepEqual(readTranscript(dir), []);
  assert.equal(loadState(dir, ROSTER).policyVersion, 2);
});

test('the policy notice reaches a seat in its next delta', async () => {
  const dir = tmpDir();
  appendMessage(dir, { ts: 't0', from: 'ted', text: 'earlier @claude', mentions: ['claude'] });
  fs.writeFileSync(path.join(dir, 'state.json'),
    JSON.stringify({ agents: { claude: { sessionRef: 's-old', cursor: 1 } } }));
  applyPolicyNotice(dir, ROSTER);
  const claude = fakeAdapter('claude');
  await run(dir, { claude, gemini: fakeAdapter('gemini'), cursor: fakeAdapter('cursor') }, '@claude again');
  assert.match(claude.calls[0].prompt, /\[System\]: Policy update:/);
  assert.ok(!claude.calls[0].prompt.includes('You are Claude')); // not a first turn
});

test('/plan: planner set, plan notice appended once, planner seeded without a mention', async () => {
  const dir = tmpDir();
  const claude = fakeAdapter('claude');
  const adapters = { claude, gemini: fakeAdapter('gemini'), cursor: fakeAdapter('cursor') };
  await runRound({ humanText: 'build a widget', dir, adapters, config: CONFIG, ui: quietUi, control: new RoundControl(), planStart: true, planner: null });
  const t = readTranscript(dir);
  assert.deepEqual(t.map((m) => m.from), ['ted', 'system', 'claude']);
  assert.match(t[1].text, /^Planning mode started by Ted\. @claude:/);
  assert.deepEqual(t[1].mentions, []);
  assert.equal(loadState(dir, ROSTER).planner, 'claude');
  assert.equal(claude.calls.length, 1);
  assert.match(claude.calls[0].prompt, /\[Ted\]: build a widget\n\[System\]: Planning mode started/);
});

test('/plan @gemini picks the planner seat', async () => {
  const dir = tmpDir();
  const claude = fakeAdapter('claude');
  const gemini = fakeAdapter('gemini');
  await runRound({ humanText: 'build a widget', dir, adapters: { claude, gemini, cursor: fakeAdapter('cursor') }, config: CONFIG, ui: quietUi, control: new RoundControl(), planStart: true, planner: 'gemini' });
  assert.equal(gemini.calls.length, 1);
  assert.equal(claude.calls.length, 0);
  assert.equal(loadState(dir, ROSTER).planner, 'gemini');
  assert.match(readTranscript(dir)[1].text, /@gemini: invoke/);
});

test('/plan without a config planner falls back to claude', async () => {
  const dir = tmpDir();
  const { planner, ...noPlanner } = CONFIG;
  const claude = fakeAdapter('claude');
  await runRound({ humanText: 'x', dir, adapters: { claude, gemini: fakeAdapter('gemini'), cursor: fakeAdapter('cursor') }, config: noPlanner, ui: quietUi, control: new RoundControl(), planStart: true, planner: null });
  assert.equal(claude.calls.length, 1);
});

test('planner routing: un-mentioned Ted text goes to the planner; explicit @mentions win', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ agents: {}, planner: 'claude' }));
  const claude = fakeAdapter('claude');
  const gemini = fakeAdapter('gemini');
  const adapters = { claude, gemini, cursor: fakeAdapter('cursor') };
  await run(dir, adapters, 'blue, please');
  assert.equal(claude.calls.length, 1);
  await run(dir, adapters, '@gemini review this');
  assert.equal(gemini.calls.length, 1);
  assert.equal(claude.calls.length, 1); // the explicit mention did not also wake the planner
  await run(dir, adapters, '@all thoughts?');
  assert.equal(claude.calls.length, 2);
  assert.equal(gemini.calls.length, 2);
});

test('planner not in the roster is ignored, not crashed on', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ agents: {}, planner: 'nobody' }));
  const claude = fakeAdapter('claude');
  await run(dir, { claude, gemini: fakeAdapter('gemini'), cursor: fakeAdapter('cursor') }, 'hello');
  assert.equal(claude.calls.length, 0);
});

test('endPlanning clears the planner, appends the end notice, and plain text yields no reply', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ agents: {}, planner: 'claude' }));
  assert.equal(endPlanning(dir, ROSTER), 'claude');
  assert.equal(loadState(dir, ROSTER).planner, null);
  assert.ok(readTranscript(dir).some((m) => m.from === 'system' && m.text === 'Planning mode ended.'));
  const claude = fakeAdapter('claude');
  await run(dir, { claude, gemini: fakeAdapter('gemini'), cursor: fakeAdapter('cursor') }, 'hello');
  assert.equal(claude.calls.length, 0);
  assert.equal(endPlanning(dir, ROSTER), null); // was not on
});

test('runRound accepts a caller-supplied buildPrompt and uses it for every turn', async () => {
  const dir = tmpDir();
  const claude = fakeAdapter('claude', [{ ok: true, replyText: 'over to @gemini', sessionRef: 's-claude' }]);
  const gemini = fakeAdapter('gemini');
  const seen = [];
  const custom = (args) => { seen.push(args); return `CUSTOM for ${args.seat} from ${args.cursor}`; };
  await runRound({ humanText: 'hey @claude', dir, adapters: { claude, gemini }, config: CONFIG, ui: quietUi, control: new RoundControl(), buildPrompt: custom });
  assert.equal(claude.calls[0].prompt, 'CUSTOM for claude from 0');
  assert.equal(gemini.calls[0].prompt, 'CUSTOM for gemini from 0');
  assert.deepEqual(Object.keys(seen[0]).sort(), ['budgetNotice', 'cursor', 'firstTurn', 'messages', 'roster', 'seat']);
  assert.equal(seen[0].firstTurn, true);
});

test('the session-lost replay also uses the caller-supplied buildPrompt', async () => {
  const dir = tmpDir();
  const claude = fakeAdapter('claude', [
    { ok: false, error: 'exit 1', sessionLost: true },
    { ok: true, replyText: 'back', sessionRef: 's-claude-2' },
  ]);
  const { saveState, loadState } = await import('../lib/transcript.js');
  const st = loadState(dir, CONFIG.roster);
  st.agents.claude.sessionRef = 's-claude-old';
  saveState(dir, st);
  const custom = ({ cursor, firstTurn }) => `CUSTOM cursor=${cursor} first=${firstTurn}`;
  await runRound({ humanText: 'hey @claude', dir, adapters: { claude }, config: CONFIG, ui: quietUi, control: new RoundControl(), buildPrompt: custom });
  assert.equal(claude.calls[0].prompt, 'CUSTOM cursor=0 first=false');
  assert.equal(claude.calls[1].prompt, 'CUSTOM cursor=0 first=true');
});

test('without buildPrompt the CLI preamble is still used', async () => {
  const dir = tmpDir();
  const claude = fakeAdapter('claude');
  await runRound({ humanText: 'hey @claude', dir, adapters: { claude }, config: CONFIG, ui: quietUi, control: new RoundControl() });
  assert.match(claude.calls[0].prompt, /You are Claude, in a terminal group chat/);
});

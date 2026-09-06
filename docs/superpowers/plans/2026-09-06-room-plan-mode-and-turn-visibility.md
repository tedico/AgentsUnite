# Room `/plan` Mode, Tool Policy, Turn Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the unite room usable for Claude-driven planning: read-only tools allowed, a live status line that shows what a seat is doing, honest skip messages, a `/plan` command that routes Ted's plain-text answers to the planner, a faster headless Claude seat, and dictation that lands as one message.

**Architecture:** Every seat already runs as a headless CLI child in plan mode. All three CLIs switch to their `stream-json` output so the adapter can parse one JSON event per line, map each CLI's event dialect onto one shared progress event, and hand it to the status line. The reply is taken from the parsed `result` event. Planning mode is a `planner` field in `state.json` that seeds the turn queue when Ted's message carries no @mention. Live sessions learn about the new tool policy through a one-time `[System]` transcript message.

**Tech Stack:** Node.js ≥ 20 (Ted runs 26.8.1), ES modules, zero runtime dependencies, `node --test`. Seat binaries: `claude` 2.1.263, `agy`, `cursor-agent`.

**Spec:** `docs/superpowers/specs/2026-09-06-room-plan-mode-and-turn-visibility-design.md`

## Global Constraints

- Zero runtime dependencies; Node built-ins only. `"type": "module"`; Node ≥ 20.
- Seat names are exactly `claude`, `gemini`, `cursor`; human is `ted`; engine notices use `system`.
- `timeoutMs` stays `300000`. No SIGTERM grace; abort and timeout still `SIGKILL`.
- No progress data ever enters the transcript. Progress goes to the status line only.
- Shared progress event, emitted by adapters, consumed only by the UI: `{ ts: number, phase?: string, lastTool?: string, toolCount?: number }`.
- Message shape: `{ ts: string, from: 'ted'|'claude'|'gemini'|'cursor'|'system', text: string, mentions: string[] }`.
- State shape after this plan: `{ agents: {<seat>: {sessionRef, cursor}}, policyVersion: number, planner: string|null }`. `policyVersion` defaults to `1` when absent; this upgrade sets it to `2`.
- Read-only guarantee is unchanged: `claude --permission-mode plan`, `agy --mode plan`, `cursor-agent --mode plan`.
- Run the full suite with `node --test test/*.test.js` before every commit; it starts at 73 passing.
- Every agent-authored commit ends with one `Co-Authored-By:` trailer per agent that wrote part of the change, naming the real model with its brand mark (Ted's global rule). The lines are:
  `Co-Authored-By: ✳️ Claude Fable 5.1 <noreply@anthropic.com>`
  `Co-Authored-By: ✦ Gemini (Antigravity) <noreply@google.com>`
  `Co-Authored-By: 🤖 Cursor Agent 🤖 <noreply@cursor.com>`
  In the commit steps below, `<trailer>` means the line for whichever agent executes that task. A Claude executor also appends `Claude-Session: <session URL>` when its harness provides one.

## Verified spike results (2026-09-06, on Ted's machine)

The spec's pre-implementation spikes were run while writing this plan. The plan argues from these facts, not from the spec's guesses.

| Question | Result |
|---|---|
| Does `claude -p --output-format stream-json` need `--verbose`? | Yes. Without it: `Error: When using --print, --output-format=stream-json requires --verbose`, exit 1. |
| Claude stream events | `system/hook_started`, `system/hook_response`, `system/init` (has `session_id`, `mcp_servers`, `permissionMode`, `skills`, `slash_commands`), `system/thinking_tokens`, `assistant` (`message.content[]` blocks of type `thinking`, `tool_use` with `name`, `text`), `rate_limit_event`, `user` (tool_result), `result` (`type:"result"`, `subtype:"success"`, `result: string`, `session_id`, `is_error`). |
| MCP off flags | `--strict-mcp-config --mcp-config '{"mcpServers":{}}'` gives `mcp_servers: []` with plan mode, skills, and all `superpowers:*` slash commands still listed in init. |
| Startup cost, trivial prompt, `json` output | All connectors: 5.3 s wall, $0.66, 32.9K cache-creation tokens. MCP off: 3.5 s wall, $0.32, 15.9K tokens. |
| `agy --output-format json` chunking | Silent for the whole turn (17.5 s), one stdout chunk at the end. Heartbeat on `json` mode is worthless. |
| `agy --output-format stream-json` events | `{"event":"init","conversation_id"}` at ~2.1 s, then `{"event":"step_update","step_update":{step_type:"user_input"|"agent_response"|"tool", state:"ACTIVE"|"DONE"|"ERROR", tool_name}}`, then `{"event":"result","result":{conversation_id,status,response,...}}`. Note the reply is nested one level deeper than in `json` mode. |
| `cursor-agent --output-format json` chunking | Silent for the whole turn (9.9 s), one chunk at the end. |
| `cursor-agent --output-format stream-json` events | `system/init` (`session_id`) at ~5 s, `user`, `thinking/delta` (**top-level `text` key**), `thinking/completed`, `assistant`, `tool_call/started` and `tool_call/completed` (`tool_call: { "<name>ToolCall": {...} }`, e.g. `readToolCall`), `result` (`type:"result"`, `result`, `session_id`), same shape as `json` mode. |
| Node readline and bracketed paste | readline never enables terminal paste mode (`ESC[?2004h`), so no markers arrive today. The keypress emitter does name `ESC[200~`/`ESC[201~` as `paste-start`/`paste-end`, but the Interface does nothing with them. |
| Spike 4 (dictation hex dump) | Needs Ted at the keyboard. Shipped as `scripts/dictation-spike.mjs` in Task 9 and logged under `## Human` in `SPRINT.md`. |

Consequences for the plan:

1. All three adapters move to `stream-json`. Heartbeat-only on `json` mode would show `starting` for the entire turn, which is the exact "looks hung" defect Change 2 exists to fix. The spec's decision rule ("decide heartbeat versus structured progress per seat from what actually arrives") selects structured progress for every seat.
2. The reply comes from the line-parsed `result` event, with `extractJson` kept only as a fallback. Cursor's `thinking` events carry a top-level `text` key, so the old any-of key scan over the whole stream would return the first thinking fragment as the reply.
3. Change 5 (MCP off) is a config toggle `mcp: false` on the claude seat, exactly as the spec proposed; the flags are verified.

## File map

| File | Responsibility after this plan |
|---|---|
| `lib/proc.js` | Spawn a headless child; `onData(chunk, stream)` per chunk; `makeLineSplitter` for NDJSON; `extractJson` fallback. |
| `lib/progress.js` (new) | `makeTracker(onProgress)`: the one place the shared progress event is built. |
| `lib/ui.js` | `formatStatus` renders the live line; `startStatus` returns `{ update, stop }`. |
| `lib/engine.js` | `runRound` (planner routing, progress plumbing, honest skip), `applyPolicyNotice`, `endPlanning`. |
| `lib/adapters/{claude,agy,cursor}.js` | Per-CLI args, per-CLI event dialect → tracker, reply from `result` event. |
| `lib/deltas.js` | Preamble text, `TOOL_POLICY`, `POLICY_NOTICE`, `POLICY_VERSION`, `planNotice`, `PLAN_END_NOTICE`. |
| `lib/transcript.js` | `loadState` defaults `policyVersion` and `planner`. |
| `lib/config.js` | New keys `mcp` (default `false`) and `planner` (default `'claude'`). |
| `lib/cli.js` | `parsePlanCommand`, `PLAN_USAGE`. |
| `lib/burst.js` (new) | `makeBurstMerger`: merge readline lines that land within 300 ms. |
| `bin/unite.js` | Wire policy notice at start, `/plan` commands, burst merger. |
| `scripts/dictation-spike.mjs` (new) | Raw-mode hex dump for Spike 4. |
| `scripts/smoke.mjs` | Print progress events during the live smoke. |
| `README.md`, `SPRINT.md` | Docs and sprint bookkeeping. |

---

### Task 1: `runHeadless` streams chunks; NDJSON line splitter

**Files:**
- Modify: `lib/proc.js:3-37`
- Test: `test/proc.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `runHeadless({ cmd, args, stdinText, timeoutMs, signal, onData })` where `onData(chunk: string, stream: 'stdout'|'stderr')` is optional and fires once per data event, before the child closes. `makeLineSplitter(onLine: (line: string) => void) → { push(chunk: string): void, flush(): void }`; blank lines are dropped; `flush()` delivers a trailing partial line.

- [ ] **Step 1: Write the failing tests**

Append to `test/proc.test.js` (add `makeLineSplitter` to the import on line 3):

```js
test('onData fires per chunk with the stream name, before close', async () => {
  const chunks = [];
  const r = await runHeadless({
    cmd: process.execPath,
    args: ['-e', 'process.stdout.write("one\\n"); setTimeout(() => { process.stderr.write("err"); process.stdout.write("two\\n"); }, 50)'],
    onData: (chunk, stream) => chunks.push([stream, chunk]),
  });
  assert.equal(r.stdout, 'one\ntwo\n');
  assert.equal(r.stderr, 'err');
  assert.deepEqual(chunks[0], ['stdout', 'one\n']);
  assert.ok(chunks.some(([s, c]) => s === 'stderr' && c === 'err'));
  assert.ok(chunks.some(([s, c]) => s === 'stdout' && c === 'two\n'));
});

test('runHeadless without onData still works', async () => {
  const r = await runHeadless({ cmd: process.execPath, args: ['-e', 'process.stdout.write("ok")'] });
  assert.equal(r.stdout, 'ok');
});

test('makeLineSplitter reassembles lines across chunk boundaries and flushes the tail', () => {
  const lines = [];
  const s = makeLineSplitter((l) => lines.push(l));
  s.push('{"a":1}\n{"b"');
  s.push(':2}\n\n{"c":3}');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
  s.flush();
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
  s.flush(); // idempotent: nothing buffered, nothing emitted
  assert.equal(lines.length, 3);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/proc.test.js`
Expected: FAIL. `makeLineSplitter` is not exported; the `onData` test fails because `chunks` is empty.

- [ ] **Step 3: Implement**

In `lib/proc.js`, change the `runHeadless` signature and the two data listeners, and add the splitter after `runHeadless`:

```js
export function runHeadless({ cmd, args, stdinText, timeoutMs = 300000, signal, onData }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    // utf8 decoding at the stream level so a multi-byte character split
    // across two chunks is never mangled by per-chunk String() coercion.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError = false;
    let settled = false;

    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, spawnError });
    };

    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    signal?.addEventListener('abort', () => child.kill('SIGKILL'), { once: true });

    child.on('error', (err) => { spawnError = true; stderr += String(err); finish(-1); });
    child.stdout.on('data', (d) => { stdout += d; onData?.(d, 'stdout'); });
    child.stderr.on('data', (d) => { stderr += d; onData?.(d, 'stderr'); });
    child.on('close', (code) => finish(code ?? -1));

    // F4: a fast-failing child can close its stdin before we finish writing
    // (e.g. exits immediately), which turns the write into an EPIPE. With no
    // listener, that 'error' event is unhandled and kills the whole process.
    child.stdin.on('error', () => {});

    if (child.stdin.writable) {
      if (stdinText != null) child.stdin.write(stdinText);
      child.stdin.end();
    }
  });
}

// NDJSON helper for the stream-json adapters: feed raw chunks in, get whole
// lines out. Chunk boundaries fall anywhere, so a line is only complete at "\n".
export function makeLineSplitter(onLine) {
  let buf = '';
  return {
    push(chunk) {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.trim()) onLine(line);
      }
    },
    flush() {
      if (buf.trim()) onLine(buf);
      buf = '';
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/*.test.js`
Expected: all pass (76).

- [ ] **Step 5: Commit**

```bash
git add lib/proc.js test/proc.test.js
git commit -m "feat(proc): stream child chunks via onData, add NDJSON line splitter

Groundwork for live status: adapters can now see output as it arrives.
No adapter uses it yet.

<trailer>"
```

---

### Task 2: Progress tracker and live status line

**Files:**
- Create: `lib/progress.js`
- Modify: `lib/ui.js:12-27`
- Test: `test/progress.test.js` (new), `test/ui.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `makeTracker(onProgress) → { heartbeat(), phase(name: string), tool(name: string) }`; each call emits one shared progress event `{ ts, phase, lastTool, toolCount }` to `onProgress` (no-op when `onProgress` is undefined). `formatStatus(frame, seat, elapsedSec, pos, total, live?)` where `live = { phase, lastTool, toolCount, idleSec: number|null }`; without `live` the legacy line is returned unchanged. `makeUi().startStatus(seat, pos, total) → { update(evt), stop() }`.

- [ ] **Step 1: Write the failing tests**

Create `test/progress.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTracker } from '../lib/progress.js';

test('tracker emits ts + phase, counts tools, keeps the last tool name', () => {
  const evts = [];
  const t = makeTracker((e) => evts.push(e));
  t.heartbeat();
  t.phase('connected');
  t.tool('Read');
  t.tool('Grep');
  t.phase('replying');
  assert.equal(evts.length, 5);
  assert.ok(evts.every((e) => typeof e.ts === 'number'));
  assert.equal(evts[0].phase, 'alive'); // first bytes arrived
  assert.equal(evts[1].phase, 'connected');
  assert.deepEqual([evts[2].phase, evts[2].lastTool, evts[2].toolCount], ['tool: Read', 'Read', 1]);
  assert.deepEqual([evts[3].phase, evts[3].toolCount], ['tool: Grep', 2]);
  assert.deepEqual([evts[4].phase, evts[4].lastTool, evts[4].toolCount], ['replying', 'Grep', 2]);
});

test('heartbeat only flips starting → alive; later phases are kept', () => {
  const evts = [];
  const t = makeTracker((e) => evts.push(e));
  t.phase('thinking');
  t.heartbeat();
  assert.equal(evts.at(-1).phase, 'thinking');
});

test('tracker with no onProgress is a no-op', () => {
  const t = makeTracker(undefined);
  t.heartbeat(); t.phase('x'); t.tool('Read');
});
```

Replace `test/ui.test.js` with:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatStatus, makeUi } from '../lib/ui.js';

test('formatStatus without live data is the legacy line', () => {
  const s = formatStatus(0, 'gemini', 32, 2, 3);
  assert.match(s, /@gemini is thinking… \(32s\) — turn 2\/3/);
});

test('formatStatus with live data shows phase, tool count, last tool, idle time', () => {
  const s = formatStatus(0, 'claude', 42, 1, 1, { phase: 'thinking', lastTool: 'Read', toolCount: 3, idleSec: 2 });
  assert.match(s, /@claude thinking · 3 tools \(last Read\) · last activity 2s ago \(42s\) — turn 1\/1/);
  const t = formatStatus(0, 'claude', 5, 1, 1, { phase: 'tool: Grep', lastTool: 'Grep', toolCount: 1, idleSec: 0 });
  assert.match(t, /@claude tool: Grep · 1 tool · last activity 0s ago \(5s\)/);
  const u = formatStatus(0, 'gemini', 1, 1, 2, { phase: 'starting', toolCount: 0, idleSec: null });
  assert.match(u, /@gemini starting \(1s\) — turn 1\/2/);
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

test('startStatus returns {update, stop}: starts at "starting", update feeds the next render, stop clears', async () => {
  let buf = '';
  const ui = makeUi({ write: (s) => { buf += s; } });
  const status = ui.startStatus('claude', 1, 1);
  assert.match(buf, /@claude starting \(0s\) — turn 1\/1/);
  status.update({ ts: Date.now(), phase: 'tool: Read', lastTool: 'Read', toolCount: 1 });
  await new Promise((r) => setTimeout(r, 300)); // renders run on the 250ms spinner tick
  assert.match(buf, /@claude tool: Read · 1 tool · last activity 0s ago/);
  buf = '';
  status.stop();
  assert.match(buf, /\r/); // line clear happened
  status.update({ ts: Date.now(), phase: 'late' }); // after stop: must not throw or write
  assert.equal(buf, '\r\x1b[2K');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/progress.test.js test/ui.test.js`
Expected: FAIL. `lib/progress.js` does not exist; `startStatus` returns a function, not an object.

- [ ] **Step 3: Implement**

Create `lib/progress.js`:

```js
// Shared progress event, emitted by adapters, consumed only by the status
// line. It never enters the transcript.
//   { ts: number, phase?: string, lastTool?: string, toolCount?: number }
// Phases: starting (no bytes yet) → alive (bytes, no structure yet) →
// connected (init event) → thinking → tool: <name> → replying (result event).
export function makeTracker(onProgress) {
  const st = { phase: 'starting', lastTool: undefined, toolCount: 0 };
  const emit = () => onProgress?.({ ts: Date.now(), ...st });
  return {
    heartbeat() { if (st.phase === 'starting') st.phase = 'alive'; emit(); },
    phase(p) { st.phase = p; emit(); },
    tool(name) { st.toolCount++; st.lastTool = name; st.phase = `tool: ${name}`; emit(); },
  };
}
```

In `lib/ui.js`, replace `formatStatus` and `startStatus`:

```js
export function formatStatus(frame, seat, elapsedSec, pos, total, live) {
  const spin = FRAMES[frame % FRAMES.length];
  if (!live) return `${spin} @${seat} is thinking… (${elapsedSec}s) — turn ${pos}/${total}`;
  const parts = [`@${seat} ${live.phase ?? 'thinking'}`];
  if (live.toolCount) {
    const inTool = String(live.phase).startsWith('tool:');
    const last = live.lastTool && !inTool ? ` (last ${live.lastTool})` : '';
    parts.push(`${live.toolCount} tool${live.toolCount === 1 ? '' : 's'}${last}`);
  }
  if (live.idleSec != null) parts.push(`last activity ${live.idleSec}s ago`);
  return `${spin} ${parts.join(' · ')} (${elapsedSec}s) — turn ${pos}/${total}`;
}
```

```js
    startStatus(seat, pos, total) {
      const t0 = Date.now();
      let frame = 0;
      let stopped = false;
      let lastTs = null;
      const live = { phase: 'starting', lastTool: undefined, toolCount: 0, idleSec: null };
      const render = () => {
        const now = Date.now();
        live.idleSec = lastTs == null ? null : Math.round((now - lastTs) / 1000);
        out.write(CLEAR + formatStatus(frame, seat, Math.round((now - t0) / 1000), pos, total, live));
      };
      render();
      const timer = setInterval(() => { frame++; render(); }, 250);
      return {
        // Mutate only; the spinner tick renders. Chatty streams (cursor emits
        // a thinking delta per few words) must not turn into a write storm.
        update(evt) {
          if (stopped || !evt) return;
          lastTs = evt.ts ?? Date.now();
          if (evt.phase) live.phase = evt.phase;
          if (evt.lastTool) live.lastTool = evt.lastTool;
          if (evt.toolCount != null) live.toolCount = evt.toolCount;
        },
        stop() { if (stopped) return; stopped = true; clearInterval(timer); out.write(CLEAR); },
      };
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/progress.test.js test/ui.test.js`
Expected: PASS. (`test/engine.test.js` now fails because its fake UI still returns a function from `startStatus`; Task 3 fixes that.)

- [ ] **Step 5: Commit**

```bash
git add lib/progress.js lib/ui.js test/progress.test.js test/ui.test.js
git commit -m "feat(ui): live status line with phase, tool count, last activity

startStatus now returns {update, stop}; engine wiring follows in the next
commit, so engine tests are red at this point.

<trailer>"
```

---

### Task 3: Engine plumbs progress to the status line; honest skip message

**Files:**
- Modify: `lib/engine.js:39-86`
- Test: `test/engine.test.js`

**Interfaces:**
- Consumes: `ui.startStatus(seat, pos, total) → { update(evt), stop() }` (Task 2).
- Produces: adapters are invoked as `adapter.invoke({ prompt, sessionRef, signal, onProgress })` where `onProgress(evt)` forwards to `status.update`. When `signal.aborted`, the transcript gets `@<seat> skipped by Ted (^C)` and the screen gets `<seat>> [skipped by Ted (^C)]`. Other failures keep `@<seat> offline: <reason>`.

- [ ] **Step 1: Update the fake UI in the existing engine tests**

In `test/engine.test.js`:

Replace line 11 with:
```js
const noStatus = () => ({ update() {}, stop() {} });
const quietUi = { startStatus: noStatus, printReply: () => {}, printSystem: () => {} };
```

Replace every remaining `startStatus: () => () => {}` (lines 99, 107, 193) with `startStatus: noStatus`.

In the F5 test (lines 165-169) replace the `ui` object with:
```js
  const ui = {
    startStatus: () => { started++; return { update() {}, stop() { stopped++; } }; },
    printReply: () => {},
    printSystem: () => {},
  };
```

- [ ] **Step 2: Write the failing tests**

Append to `test/engine.test.js`:

```js
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test test/engine.test.js`
Expected: FAIL. `stopStatus is not a function` on the old return shape, the abort test sees `offline: exit 137`, and `onProgress` is undefined in the progress test.

- [ ] **Step 4: Implement**

In `lib/engine.js`, replace lines 39-86 (from `control.turnController = new AbortController();` through the end of the `else` branch) with:

```js
    control.turnController = new AbortController();
    const signal = control.turnController.signal;
    const status = ui.startStatus(seat, turns, turns + queue.length);
    const onProgress = (evt) => status.update(evt);

    let res;
    try {
      res = await invokeSafely(adapters[seat], {
        prompt: buildPrompt({ messages, cursor: agent.cursor, seat, roster, firstTurn: agent.sessionRef === null, budgetNotice: isFinal }),
        sessionRef: agent.sessionRef,
        signal,
        onProgress,
      });

      if (!res.ok && res.sessionLost && agent.sessionRef !== null && !signal.aborted) {
        // self-healing: fresh session + full-transcript replay
        res = await invokeSafely(adapters[seat], {
          prompt: buildPrompt({ messages, cursor: 0, seat, roster, firstTurn: true, budgetNotice: isFinal }),
          sessionRef: null,
          signal,
          onProgress,
        });
      }
    } finally {
      // F5: guarantee the spinner is always stopped, even if prompt-building
      // (or anything else in this block) throws instead of resolving.
      status.stop();
      control.turnController = null;
    }

    let suppressed = false;
    if (res.ok) {
      appendMessage(dir, { ts: now(), from: seat, text: res.replyText, mentions: parseMentions(res.replyText, roster) });
      agent.sessionRef = res.sessionRef ?? agent.sessionRef;
      agent.cursor = messages.length + 1; // everything it was shown + its own reply
      ui.printReply(seat, res.replyText);
      if (!res.sessionRef) {
        ui.printSystem(`@${seat} returned no session ref — later turns will not resume this native session`);
      }
      const newMentions = parseMentions(res.replyText, roster).filter((m) => m !== seat && !queue.includes(m));
      if (!isFinal) {
        for (const m of newMentions) queue.push(m);
      } else if (newMentions.length > 0) {
        suppressed = true; // cap truncated a hand-off this reply would have made
      }
    } else if (signal.aborted) {
      // Change 3: Ted pressed ^C. The engine killed the child on purpose, so
      // this is neither "offline" nor a timeout. Say so in both places.
      appendMessage(dir, { ts: now(), from: 'system', text: `@${seat} skipped by Ted (^C)`, mentions: [] });
      ui.printSystem(`${seat}> [skipped by Ted (^C)]`);
    } else {
      const reason = res.error ?? 'unknown';
      if (res.stderr) appendErrorLog(dir, seat, res.stderr);
      appendMessage(dir, { ts: now(), from: 'system', text: `@${seat} offline: ${reason}`, mentions: [] });
      ui.printSystem(`${seat}> [offline: ${reason} — /last-error for details]`);
    }
```

- [ ] **Step 5: Run the full suite**

Run: `node --test test/*.test.js`
Expected: all pass (83).

- [ ] **Step 6: Commit**

```bash
git add lib/engine.js test/engine.test.js
git commit -m "feat(engine): forward adapter progress to the status line; ^C says 'skipped by Ted'

'offline' is now reserved for timeout, exit N, binary not found, bad json.

<trailer>"
```

---

### Task 4: Claude seat: stream-json progress, MCP off by default

**Files:**
- Modify: `lib/adapters/claude.js`, `lib/config.js:5-11`, `bin/unite.js:27-31`
- Test: `test/adapter-claude.test.js`, `test/config.test.js`

**Interfaces:**
- Consumes: `runHeadless(... onData)`, `makeLineSplitter` (Task 1); `makeTracker` (Task 2).
- Produces: `claudeAdapter({ binary, model, timeoutMs, mcp = false })`; `NO_MCP_ARGS` (exported const); `invoke({ prompt, sessionRef, signal, onProgress })` returns the same `{ ok, replyText, sessionRef }` / failure shapes as before. `DEFAULT_CONFIG.mcp === false`.

- [ ] **Step 1: Write the failing tests**

Replace `test/adapter-claude.test.js` with:

```js
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
```

Append to `test/config.test.js`:

```js
test('room defaults: MCP off for the claude seat, claude is the default planner', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unite-cfg-'));
  const cfg = loadConfig(root);
  assert.equal(cfg.mcp, false);
  assert.equal(cfg.planner, 'claude');
  fs.mkdirSync(path.join(root, '.unite'), { recursive: true });
  fs.writeFileSync(path.join(root, '.unite', 'config.json'), JSON.stringify({ mcp: true, planner: 'gemini' }));
  const over = loadConfig(root);
  assert.equal(over.mcp, true);
  assert.equal(over.planner, 'gemini');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/adapter-claude.test.js test/config.test.js`
Expected: FAIL. `NO_MCP_ARGS` is not exported, argv still says `json`, no progress events, `cfg.mcp` is undefined.

- [ ] **Step 3: Implement**

Replace `lib/adapters/claude.js` with:

```js
import { runHeadless, extractJson, makeLineSplitter } from '../proc.js';
import { makeTracker } from '../progress.js';

// Change 5: the room never needs Ted's claude.ai connectors. Verified on
// claude 2.1.263: init reports mcp_servers: [] while plan mode, skills and
// the superpowers slash commands still load; a trivial turn drops from 5.3s
// to 3.5s and from 32.9K to 15.9K cache-creation tokens.
export const NO_MCP_ARGS = ['--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'];

export function claudeAdapter({ binary = 'claude', model, timeoutMs = 300000, mcp = false }) {
  return {
    seat: 'claude',
    async invoke({ prompt, sessionRef, signal, onProgress }) {
      // stream-json in print mode requires --verbose (verified: without it
      // claude exits 1 with "requires --verbose").
      const args = ['-p', '--permission-mode', 'plan', '--output-format', 'stream-json', '--verbose'];
      if (!mcp) args.push(...NO_MCP_ARGS);
      if (model) args.push('--model', model);
      if (sessionRef) args.push('--resume', sessionRef);

      const track = makeTracker(onProgress);
      let result = null;
      const lines = makeLineSplitter((line) => {
        let evt;
        try { evt = JSON.parse(line); } catch { return; } // update notices etc.
        if (evt.type === 'system' && evt.subtype === 'init') track.phase('connected');
        else if (evt.type === 'system' && evt.subtype === 'thinking_tokens') track.phase('thinking');
        else if (evt.type === 'assistant') {
          const tools = (evt.message?.content ?? []).filter((b) => b.type === 'tool_use');
          if (tools.length) for (const b of tools) track.tool(b.name);
          else track.phase('thinking');
        } else if (evt.type === 'user') track.phase('thinking'); // tool result landed
        else if (evt.type === 'result') { result = evt; track.phase('replying'); }
      });
      const onData = (chunk, stream) => {
        track.heartbeat();
        if (stream === 'stdout') lines.push(chunk);
      };

      const r = await runHeadless({ cmd: binary, args, stdinText: prompt, timeoutMs, signal, onData });
      lines.flush();
      if (r.timedOut) return { ok: false, error: 'timeout', stderr: r.stderr };
      if (r.spawnError) return { ok: false, error: 'binary not found', stderr: r.stderr };
      if (r.code !== 0) {
        return { ok: false, error: `exit ${r.code}`, stderr: r.stderr, sessionLost: sessionRef != null };
      }
      // The line parser is the source of truth; extractJson is a fallback for
      // output that was not line-delimited.
      const j = result ?? extractJson(r.stdout, ['result']);
      if (!j || typeof j.result !== 'string') {
        return { ok: false, error: 'bad json from claude', stderr: `${r.stderr}\n${r.stdout.slice(0, 2000)}` };
      }
      return { ok: true, replyText: j.result, sessionRef: j.session_id ?? sessionRef ?? null };
    },
  };
}
```

In `lib/config.js`, add two keys to `DEFAULT_CONFIG` (after `models: {}`):

```js
  mcp: false,          // claude seat: load Ted's claude.ai MCP connectors? The room never needs them.
  planner: 'claude',   // seat that drives /plan by default (only seat with superpowers today)
```

In `bin/unite.js` lines 27-31, pass `mcp` to the factories:

```js
const adapters = Object.fromEntries(config.roster.map((seat) => [seat, FACTORIES[seat]({
  binary: config.binaries[seat],
  model: config.models[seat],
  timeoutMs: config.timeoutMs,
  mcp: config.mcp,
})]));
```

- [ ] **Step 4: Run the full suite**

Run: `node --test test/*.test.js`
Expected: all pass (88).

- [ ] **Step 5: Live check (one real call)**

Run: `node scripts/smoke.mjs claude`
Expected: `round 1: OK (session …)` and `round 2 (resume): MEMORY OK`. This proves stream-json + `--verbose` + `--resume` + MCP-off work against the installed binary.

- [ ] **Step 6: Commit**

```bash
git add lib/adapters/claude.js lib/config.js bin/unite.js test/adapter-claude.test.js test/config.test.js
git commit -m "feat(claude): stream-json progress events; MCP connectors off by default (config.mcp)

The status line now shows connected/thinking/tool: <name>/replying for the
Claude seat. Trivial turn 5.3s→3.5s and half the cache-creation tokens.

<trailer>"
```

---

### Task 5: Gemini (agy) seat: stream-json progress

**Files:**
- Modify: `lib/adapters/agy.js`
- Test: `test/adapter-agy.test.js`

**Interfaces:**
- Consumes: `runHeadless(... onData)`, `makeLineSplitter`, `makeTracker`.
- Produces: `agyAdapter(...).invoke({ prompt, sessionRef, signal, onProgress })`, same result shapes as before. Args become `['--print', prompt, '--mode', 'plan', '--output-format', 'stream-json', ...]`.

- [ ] **Step 1: Write the failing tests**

Replace `test/adapter-agy.test.js` with:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { agyAdapter } from '../lib/adapters/agy.js';
import { makeStub, readStubCall, stubDir } from './helpers/stub.js';

// Trimmed from a real `agy --print ... --mode plan --output-format stream-json`
// run (2026-09-06). In stream mode the reply is nested under "result".
const STREAM = [
  '{"event":"init","conversation_id":"conv-9","init":{"cwd":"/x","tools":["read_file"]}}',
  '{"event":"step_update","step_update":{"conversation_id":"conv-9","step_index":0,"state":"DONE","step_type":"user_input"}}',
  '{"event":"step_update","step_update":{"conversation_id":"conv-9","step_index":1,"state":"ACTIVE","step_type":"tool","tool_name":"read_file","tool_info":{"name":"read_file","parameters":{"path":"package.json"}}}}',
  '{"event":"step_update","step_update":{"conversation_id":"conv-9","step_index":1,"state":"DONE","step_type":"tool","tool_name":"read_file"}}',
  '{"event":"result","result":{"conversation_id":"conv-9","status":"SUCCESS","response":"gemini here","duration_seconds":12.1,"num_turns":1}}',
].join('\n') + '\n';

function makeSlowStub(dir, { stdout, delayMs }) {
  const p = path.join(dir, `stub-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(p, `#!/usr/bin/env node
setTimeout(() => {
  process.stdout.write(${JSON.stringify(stdout)});
  process.exit(0);
}, ${delayMs});
`);
  fs.chmodSync(p, 0o755);
  return p;
}

test('first turn: prompt is the VALUE of --print (greedy-parse safe), plan mode, stream-json', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: STREAM, stderr: 'jetski: telemetry noise' });
  const a = agyAdapter({ binary: bin, timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'THE DELTA', sessionRef: null });
  assert.deepEqual(res, { ok: true, replyText: 'gemini here', sessionRef: 'conv-9' });
  assert.deepEqual(readStubCall().argv,
    ['--print', 'THE DELTA', '--mode', 'plan', '--output-format', 'stream-json']);
});

test('progress: connected → tool: read_file (count 1) → replying', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: STREAM });
  const a = agyAdapter({ binary: bin, timeoutMs: 5000 });
  const evts = [];
  await a.invoke({ prompt: 'x', sessionRef: null, onProgress: (e) => evts.push(e) });
  const phases = evts.map((e) => e.phase);
  for (const p of ['connected', 'tool: read_file', 'replying']) assert.ok(phases.includes(p), `missing phase ${p}`);
  assert.ok(phases.indexOf('connected') < phases.indexOf('tool: read_file'));
  const toolEvt = evts.find((e) => e.phase === 'tool: read_file');
  assert.deepEqual([toolEvt.lastTool, toolEvt.toolCount], ['read_file', 1]);
  // the DONE step_update for the same tool must not count it twice
  assert.equal(evts.at(-1).toolCount, 1);
});

test('later turn adds --conversation', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: STREAM });
  const a = agyAdapter({ binary: bin, timeoutMs: 5000 });
  await a.invoke({ prompt: 'x', sessionRef: 'conv-9' });
  assert.deepEqual(readStubCall().argv,
    ['--print', 'x', '--mode', 'plan', '--output-format', 'stream-json', '--conversation', 'conv-9']);
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

test('a leading JSON update notice does not shadow the response payload', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: `{"notice":"update available"}\n${STREAM}` });
  const a = agyAdapter({ binary: bin, timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'x', sessionRef: null });
  assert.deepEqual(res, { ok: true, replyText: 'gemini here', sessionRef: 'conv-9' });
});

test('json-mode shape (flat object) is still accepted via the fallback', async () => {
  const dir = stubDir();
  const flat = JSON.stringify({ conversation_id: 'conv-1', status: 'SUCCESS', response: 'flat reply' });
  const a = agyAdapter({ binary: makeStub(dir, { stdout: flat }), timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'x', sessionRef: null });
  assert.deepEqual(res, { ok: true, replyText: 'flat reply', sessionRef: 'conv-1' });
});

test('agy adapter adds 15000ms grace to timeoutMs', async () => {
  const dir = stubDir();
  // Child sleeps longer than timeoutMs; without the 15s --print-timeout grace
  // the adapter would SIGKILL it. With grace it must still finish.
  const bin = makeSlowStub(dir, { stdout: STREAM, delayMs: 600 });
  const a = agyAdapter({ binary: bin, timeoutMs: 150 });
  const res = await a.invoke({ prompt: 'x', sessionRef: null });
  assert.equal(res.ok, true);
  assert.equal(res.replyText, 'gemini here');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/adapter-agy.test.js`
Expected: FAIL. argv still says `json`; the nested stream result is not found by `extractJson(..., ['response'])` at the top level (it may find it by nested scanning, but the progress and argv tests fail regardless).

- [ ] **Step 3: Implement**

Replace `lib/adapters/agy.js` with:

```js
import { runHeadless, extractJson, makeLineSplitter } from '../proc.js';
import { makeTracker } from '../progress.js';

export function agyAdapter({ binary = 'agy', model, timeoutMs = 300000 }) {
  return {
    seat: 'gemini',
    async invoke({ prompt, sessionRef, signal, onProgress }) {
      // agy's -p parses greedily; the prompt MUST be the value of --print.
      // Note: --disable-slash-commands conflicts with --mode plan and silently disables read-only mode.
      // stream-json: json mode is silent until the end (verified 17s of
      // nothing), so structured events are the only liveness signal.
      const args = ['--print', prompt, '--mode', 'plan', '--output-format', 'stream-json'];
      if (model) args.push('--model', model);
      if (sessionRef) args.push('--conversation', sessionRef);

      const track = makeTracker(onProgress);
      let result = null;
      const lines = makeLineSplitter((line) => {
        let evt;
        try { evt = JSON.parse(line); } catch { return; }
        if (evt.event === 'init') track.phase('connected');
        else if (evt.event === 'step_update') {
          const su = evt.step_update ?? {};
          if (su.step_type === 'tool' && su.state === 'ACTIVE') track.tool(su.tool_name ?? 'tool');
          else track.phase('thinking');
        } else if (evt.event === 'result') { result = evt.result; track.phase('replying'); }
      });
      const onData = (chunk, stream) => {
        track.heartbeat();
        if (stream === 'stdout') lines.push(chunk);
      };

      // agy's --print-timeout defaults to 5m0s, matching our adapter default.
      // Node's setTimeout starts before fork/exec and CLI flag parsing, so our
      // SIGKILL would fire ~100–300ms before agy can emit its own timeout
      // diagnostic. Add 15s grace so agy's --print-timeout wins the race.
      const r = await runHeadless({ cmd: binary, args, timeoutMs: timeoutMs + 15000, signal, onData });
      lines.flush();
      if (r.timedOut) return { ok: false, error: 'timeout', stderr: r.stderr };
      if (r.spawnError) return { ok: false, error: 'binary not found', stderr: r.stderr };
      if (r.code !== 0) {
        return { ok: false, error: `exit ${r.code}`, stderr: r.stderr, sessionLost: sessionRef != null };
      }
      const j = result ?? extractJson(r.stdout, ['response']);
      if (!j || typeof j.response !== 'string') {
        return { ok: false, error: 'bad json from agy', stderr: `${r.stderr}\n${r.stdout.slice(0, 2000)}` };
      }
      return { ok: true, replyText: j.response, sessionRef: j.conversation_id ?? sessionRef ?? null };
    },
  };
}
```

- [ ] **Step 4: Run the full suite**

Run: `node --test test/*.test.js`
Expected: all pass (90).

- [ ] **Step 5: Live check**

Run: `node scripts/smoke.mjs gemini`
Expected: `round 1: OK (session …)`, `round 2 (resume): MEMORY OK`.

- [ ] **Step 6: Commit**

```bash
git add lib/adapters/agy.js test/adapter-agy.test.js
git commit -m "feat(agy): stream-json progress events (init/step_update/result)

json mode gave no bytes until the end of the turn; the Gemini seat now
reports connected/thinking/tool: <name>/replying like the Claude seat.

<trailer>"
```

---

### Task 6: Cursor seat: stream-json progress

**Files:**
- Modify: `lib/adapters/cursor.js`
- Test: `test/adapter-cursor.test.js`

**Interfaces:**
- Consumes: `runHeadless(... onData)`, `makeLineSplitter`, `makeTracker`.
- Produces: `cursorAdapter(...).invoke({ prompt, sessionRef, signal, onProgress })`, same result shapes as before. Args become `['-p', '--trust', '--mode', 'plan', '--output-format', 'stream-json', ..., '--', prompt]`.

- [ ] **Step 1: Write the failing tests**

Replace `test/adapter-cursor.test.js` with:

```js
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

test('a leading JSON update notice does not shadow the payload', async () => {
  const dir = stubDir();
  const bin = makeStub(dir, { stdout: `{"notice":"update available"}\n${STREAM}` });
  const a = cursorAdapter({ binary: bin, timeoutMs: 5000 });
  const res = await a.invoke({ prompt: 'x', sessionRef: null });
  assert.deepEqual(res, { ok: true, replyText: 'cursor here', sessionRef: 'chat-7' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/adapter-cursor.test.js`
Expected: FAIL. argv says `json`; the "thinking" test returns `Reading package.json` as the reply (the any-of key scan hits the thinking event's `text`); no progress events.

- [ ] **Step 3: Implement**

Replace `lib/adapters/cursor.js` with:

```js
import { runHeadless, extractJson, makeLineSplitter } from '../proc.js';
import { makeTracker } from '../progress.js';

export function cursorAdapter({ binary = 'cursor-agent', model, timeoutMs = 300000 }) {
  return {
    seat: 'cursor',
    async invoke({ prompt, sessionRef, signal, onProgress }) {
      // --trust: headless has no TTY to answer cursor-agent's interactive
      // workspace-trust prompt (exit 1 otherwise, live-verified 2026-09-03).
      // Safe here — --mode plan is the load-bearing read-only guarantee,
      // same as the agy seat; --trust only skips the confirmation dialog.
      // stream-json: json mode is silent until the end (verified ~10s of
      // nothing), so structured events are the only liveness signal.
      const args = ['-p', '--trust', '--mode', 'plan', '--output-format', 'stream-json'];
      if (model) args.push('--model', model);
      if (sessionRef) args.push('--resume', sessionRef);
      args.push('--', prompt); // -- guard + trailing positional

      const track = makeTracker(onProgress);
      let result = null;
      const lines = makeLineSplitter((line) => {
        let evt;
        try { evt = JSON.parse(line); } catch { return; }
        if (evt.type === 'system' && evt.subtype === 'init') track.phase('connected');
        else if (evt.type === 'thinking' || evt.type === 'assistant') track.phase('thinking');
        else if (evt.type === 'tool_call' && evt.subtype === 'started') {
          // tool_call: { "<name>ToolCall": {...}, toolCallId, ... }
          const key = Object.keys(evt.tool_call ?? {}).find((k) => k.endsWith('ToolCall'));
          track.tool(key ? key.replace(/ToolCall$/, '') : 'tool');
        } else if (evt.type === 'result') { result = evt; track.phase('replying'); }
      });
      const onData = (chunk, stream) => {
        track.heartbeat();
        if (stream === 'stdout') lines.push(chunk);
      };

      const r = await runHeadless({ cmd: binary, args, timeoutMs, signal, onData });
      lines.flush();
      if (r.timedOut) return { ok: false, error: 'timeout', stderr: r.stderr };
      if (r.spawnError) return { ok: false, error: 'binary not found', stderr: r.stderr };
      if (r.code !== 0) {
        return { ok: false, error: `exit ${r.code}`, stderr: r.stderr, sessionLost: sessionRef != null };
      }
      // Only the result event is a reply. cursor-agent's thinking events carry
      // a top-level "text" key, so an any-of scan over the whole stream would
      // hand back the first thinking fragment. Fallback keys are "result" only.
      const j = result ?? extractJson(r.stdout, ['result']);
      const replyText = j?.result ?? j?.response ?? j?.text;
      if (typeof replyText !== 'string') {
        return { ok: false, error: 'bad json from cursor-agent', stderr: `${r.stderr}\n${r.stdout.slice(0, 2000)}` };
      }
      return { ok: true, replyText, sessionRef: j.chatId ?? j.chat_id ?? j.session_id ?? sessionRef ?? null };
    },
  };
}
```

- [ ] **Step 4: Run the full suite**

Run: `node --test test/*.test.js`
Expected: all pass (92).

- [ ] **Step 5: Live check**

Run: `node scripts/smoke.mjs cursor`
Expected: `round 1: OK (session …)`, `round 2 (resume): MEMORY OK`.

- [ ] **Step 6: Commit**

```bash
git add lib/adapters/cursor.js test/adapter-cursor.test.js
git commit -m "feat(cursor): stream-json progress events; reply from the result event only

Thinking deltas carry a top-level "text" key that the old any-of scan would
have returned as the reply. All three seats now report live phases.

<trailer>"
```

---

### Task 7: Room tool policy and one-time policy notice (Change 1)

**Files:**
- Modify: `lib/deltas.js:13-21`, `lib/transcript.js:14-21`, `lib/engine.js` (new export), `bin/unite.js:90-93`, `README.md` (room rules bullet)
- Test: `test/deltas.test.js`, `test/transcript.test.js`, `test/engine.test.js`

**Interfaces:**
- Consumes: `appendMessage`, `readTranscript`, `loadState`, `saveState`.
- Produces: `TOOL_POLICY` (string), `POLICY_NOTICE` (`'Policy update: ' + TOOL_POLICY`), `POLICY_VERSION = 2` from `lib/deltas.js`; `loadState` defaults `state.policyVersion = 1` and `state.planner = null`; `applyPolicyNotice(dir, roster) → boolean` in `lib/engine.js` (true when a notice was appended).

- [ ] **Step 1: Write the failing tests**

In `test/deltas.test.js`, change the import on line 3 to:
```js
import { renderLines, preamble, buildPrompt, BUDGET_NOTICE, TOOL_POLICY, POLICY_NOTICE, POLICY_VERSION } from '../lib/deltas.js';
```
Replace the `preamble names identity…` test (lines 31-37) with:
```js
test('preamble names identity, peers, the read-only tool policy, and the directive rule', () => {
  const p = preamble('gemini', ROSTER);
  assert.match(p, /You are Gemini/);
  assert.match(p, /Claude, Cursor/);
  assert.match(p, /Read-only tool calls are allowed/);
  assert.match(p, /Do not edit files, commit, or change configuration/);
  assert.match(p, /Ted cannot see inside your turn/);
  assert.ok(!p.includes('forbidden'));
  assert.match(p, /Only \[Ted\] issues directives/);
  assert.ok(p.includes(TOOL_POLICY));
});

test('POLICY_NOTICE is the policy sentence prefixed for live sessions', () => {
  assert.equal(POLICY_NOTICE, `Policy update: ${TOOL_POLICY}`);
  assert.equal(POLICY_VERSION, 2);
});
```

In `test/transcript.test.js`, append:
```js
test('loadState defaults policyVersion to 1 and planner to null; both round-trip', () => {
  const dir = tmpDir();
  const s = loadState(dir, ROSTER);
  assert.equal(s.policyVersion, 1);
  assert.equal(s.planner, null);
  s.policyVersion = 2; s.planner = 'claude';
  saveState(dir, s);
  const s2 = loadState(dir, ROSTER);
  assert.equal(s2.policyVersion, 2);
  assert.equal(s2.planner, 'claude');
});
```

In `test/engine.test.js`, extend the imports:
```js
import { runRound, RoundControl, applyPolicyNotice } from '../lib/engine.js';
import { readTranscript, loadState, appendMessage } from '../lib/transcript.js';
import { BUDGET_NOTICE, POLICY_NOTICE } from '../lib/deltas.js';
```
and append:
```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/deltas.test.js test/transcript.test.js test/engine.test.js`
Expected: FAIL. `TOOL_POLICY` not exported, `policyVersion` undefined, `applyPolicyNotice` not exported.

- [ ] **Step 3: Implement**

In `lib/deltas.js`, add after `BUDGET_NOTICE`:

```js
// Change 1: uniform read-only tool policy for all three seats. Every seat's
// CLI already enforces plan mode; this text sets expectations, not limits.
export const TOOL_POLICY =
  'You are in a multi-agent group planning room. Read-only tool calls are allowed: reading files, searching, read-only shell commands, and skills. ' +
  'Do not edit files, commit, or change configuration; your CLI enforces plan mode. ' +
  'Use tools only when the answer depends on the repo, prefer direct reads over subagents, and avoid long explorations unless Ted asks for grounded work. ' +
  "Ted cannot see inside your turn, so say what you're about to do, keep tool use short, and lead with text.";
export const POLICY_NOTICE = `Policy update: ${TOOL_POLICY}`;
export const POLICY_VERSION = 2;
```

and replace line 17 of `preamble` (the `'You are in a multi-agent group planning room. Tool calls and file edits are forbidden…'` string) with `TOOL_POLICY,`.

In `lib/transcript.js`, `loadState` becomes:

```js
export function loadState(dir, roster) {
  let state = { agents: {} };
  try { state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')); }
  catch { /* fresh chat */ }
  state.agents ??= {};
  for (const seat of roster) state.agents[seat] ??= { sessionRef: null, cursor: 0 };
  state.policyVersion ??= 1; // chats from before the tool-policy change
  state.planner ??= null;    // seat driving /plan mode, or null
  return state;
}
```

In `lib/engine.js`, extend the imports and add the function:

```js
import { buildPrompt, POLICY_NOTICE, POLICY_VERSION } from './deltas.js';
```

```js
// Change 1: live sessions learn the new tool policy through the transcript,
// which every seat already reads as its next delta. A fresh chat has no seat
// to update (its preamble carries the policy), so it is only stamped.
export function applyPolicyNotice(dir, roster) {
  const state = loadState(dir, roster);
  if (state.policyVersion >= POLICY_VERSION) return false;
  const notify = readTranscript(dir).length > 0;
  if (notify) appendMessage(dir, { ts: new Date().toISOString(), from: 'system', text: POLICY_NOTICE, mentions: [] });
  state.policyVersion = POLICY_VERSION;
  saveState(dir, state);
  return notify;
}
```

In `bin/unite.js`, import it (`import { runRound, RoundControl, applyPolicyNotice } from '../lib/engine.js';`) and add after the two `console.log` banner lines (line 93):

```js
if (applyPolicyNotice(dir, config.roster)) ui.printSystem('(policy update posted to the room — each seat sees it on its next turn)');
```

In `README.md`, replace the "Pure dialogue" room-rules bullet with:

```markdown
- **Read-only tools, short turns** — seats may read files, search, run
  read-only shell commands, and use skills; no edits, commits, or config
  changes. Read-only is hard-enforced per seat: `claude --permission-mode
  plan`, `agy --mode plan`, `cursor-agent --mode plan`. Seats are told to
  announce tool use and keep it short, because you cannot see inside a turn.
  Chats that predate this policy get one `[System]: Policy update` line the
  next time you open them.
```

- [ ] **Step 4: Run the full suite**

Run: `node --test test/*.test.js`
Expected: all pass (97).

- [ ] **Step 5: Commit**

```bash
git add lib/deltas.js lib/transcript.js lib/engine.js bin/unite.js README.md test/deltas.test.js test/transcript.test.js test/engine.test.js
git commit -m "feat(room): read-only tool policy in the preamble; one-time policy notice for live chats

state.policyVersion (default 1) gates the notice; fresh chats are stamped
to 2 without a transcript line.

<trailer>"
```

---

### Task 8: `/plan` command and planner routing (Change 4)

**Files:**
- Modify: `lib/deltas.js`, `lib/cli.js`, `lib/engine.js` (`runRound`, new `endPlanning`), `bin/unite.js:92-134`, `README.md` (slash-command table, config bullet)
- Test: `test/deltas.test.js`, `test/cli.test.js`, `test/engine.test.js`

**Interfaces:**
- Consumes: `state.planner` (Task 7), `config.planner` (Task 4).
- Produces: `planNotice(planner: string) → string` and `PLAN_END_NOTICE` from `lib/deltas.js`; `parsePlanCommand(text, roster) → null | { kind: 'usage' } | { kind: 'off' } | { kind: 'bad-seat', seat } | { kind: 'start', planner: string|null, text: string }` and `PLAN_USAGE` from `lib/cli.js`; `runRound({ ..., planStart?: boolean, planner?: string|null })`; `endPlanning(dir, roster) → string|null` (the seat that was planning).

- [ ] **Step 1: Write the failing tests**

In `test/deltas.test.js`, add `planNotice, PLAN_END_NOTICE` to the import and append:
```js
test('planNotice addresses the chosen planner and tells it where the spec goes', () => {
  const n = planNotice('gemini');
  assert.match(n, /^Planning mode started by Ted\. @gemini: invoke your brainstorming skill/);
  assert.match(n, /one clarifying question at a time/);
  assert.match(n, /Other seats: review only when @mentioned/);
  assert.match(n, /~\/\.claude\/plans\//);
  assert.equal(PLAN_END_NOTICE, 'Planning mode ended.');
});
```

In `test/cli.test.js`, change the import on line 8 to `import { parseArgv, parsePlanCommand, PLAN_USAGE } from '../lib/cli.js';` and append (the file already has `runUnite`, `fs`, `os`, `path`):
```js
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
```

In `test/engine.test.js`, add `endPlanning` to the engine import, add `planner: 'claude'` to `CONFIG`, and append:
```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/deltas.test.js test/cli.test.js test/engine.test.js`
Expected: FAIL on the new exports and on `planStart` being ignored.

- [ ] **Step 3: Implement**

In `lib/deltas.js`, append:

```js
// Change 4: posted as [System] right after Ted's /plan message. The planner
// seat is interpolated so `/plan @gemini …` addresses the right seat.
export function planNotice(planner) {
  return `Planning mode started by Ted. @${planner}: invoke your brainstorming skill (superpowers:brainstorming) and drive the design: ` +
    'classify the task, ask Ted one clarifying question at a time, then propose approaches and present the design in sections. ' +
    'Grounded exploration is expected here; announce it first and keep each turn short. ' +
    'Other seats: review only when @mentioned; do not run a parallel brainstorm. ' +
    'Ask questions in plain text; the interactive question and plan-exit tools are not available to headless seats. ' +
    'The room is read-only: write the finished spec to your plan file under ~/.claude/plans/ and report its path; Ted copies it into the repo.';
}
export const PLAN_END_NOTICE = 'Planning mode ended.';
```

In `lib/cli.js`, append:

```js
export const PLAN_USAGE =
  'usage: /plan [@seat] <what to plan> — start planning mode (default planner from config); /plan off — end it';

// /plan [@seat] <text> | /plan off | /plan
export function parsePlanCommand(text, roster) {
  const m = text.match(/^\/plan(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const rest = (m[1] ?? '').trim();
  if (!rest) return { kind: 'usage' };
  if (rest === 'off') return { kind: 'off' };
  const seat = rest.match(/^@(\w+)(?:\s+([\s\S]*))?$/);
  if (!seat) return { kind: 'start', planner: null, text: rest };
  const name = seat[1].toLowerCase();
  if (!roster.includes(name)) return { kind: 'bad-seat', seat: name };
  const body = (seat[2] ?? '').trim();
  if (!body) return { kind: 'usage' };
  return { kind: 'start', planner: name, text: body };
}
```

In `lib/engine.js`:

Extend the deltas import: `import { buildPrompt, POLICY_NOTICE, POLICY_VERSION, planNotice, PLAN_END_NOTICE } from './deltas.js';`

Replace the top of `runRound` (lines 22-30, through `let turns = 0;`) with:

```js
export async function runRound({ humanText, dir, adapters, config, ui, control, planStart = false, planner = null }) {
  const roster = config.roster.filter((s) => adapters[s]);
  const now = () => new Date().toISOString();
  const state = loadState(dir, roster);

  if (planStart) {
    state.planner = planner ?? config.planner ?? 'claude';
    saveState(dir, state);
  }
  appendMessage(dir, { ts: now(), from: 'ted', text: humanText, mentions: parseMentions(humanText, roster) });
  if (planStart) appendMessage(dir, { ts: now(), from: 'system', text: planNotice(state.planner), mentions: [] });

  const queue = [...parseMentions(humanText, roster)];
  // Change 4: while planning mode is on, an un-mentioned Ted message goes to
  // the planner, so Ted can answer a question in plain text and get the next
  // one back. Explicit @mentions (including @all) always win for the round.
  if (queue.length === 0 && state.planner && roster.includes(state.planner)) queue.push(state.planner);
  let turns = 0;
```

Append to `lib/engine.js`:

```js
// /plan off
export function endPlanning(dir, roster) {
  const state = loadState(dir, roster);
  const was = state.planner ?? null;
  state.planner = null;
  saveState(dir, state);
  appendMessage(dir, { ts: new Date().toISOString(), from: 'system', text: PLAN_END_NOTICE, mentions: [] });
  return was;
}
```

In `bin/unite.js`:

Update imports:
```js
import { parseArgv, parsePlanCommand, PLAN_USAGE } from '../lib/cli.js';
import { runRound, RoundControl, applyPolicyNotice, endPlanning } from '../lib/engine.js';
import { readTranscript, lastError, appendRoundError, loadState } from '../lib/transcript.js';
```

Replace lines 92-131 (the banner through the end of the `rl.on('line', …)` handler) with:

```js
console.log(`unite — chat "${chatName}" — roster: ${config.roster.map((s) => '@' + s).join(' ')} (@all)`);
console.log('mention someone to get a reply; /plan [@seat] <text> · /plan off · /who /last /last-error /quit\n');
if (applyPolicyNotice(dir, config.roster)) ui.printSystem('(policy update posted to the room — each seat sees it on its next turn)');
{
  const planner = loadState(dir, config.roster).planner;
  if (planner) ui.printSystem(`(planning mode is on — @${planner} drives; plain text goes to @${planner}; /plan off to end)`);
}

async function startRound(extra) {
  activeControl = new RoundControl();
  sigints = 0;
  try {
    await runRound({ dir, adapters, config, ui, control: activeControl, ...extra });
  } catch (err) {
    // F5: an uncaught throw here (corrupt transcript line, disk full, etc.)
    // would otherwise escape this async event handler as a process-fatal
    // unhandled rejection, killing the whole session mid-chat.
    ui.printSystem(`(round failed: ${err?.message ?? err})`);
    appendRoundError(dir, err);
  } finally {
    activeControl = null;
    rl.prompt();
  }
}

async function handleInput(line) {
  // Input keeps flowing during a round (F1: rl.pause() made SIGINT
  // unreachable mid-round, since a paused stream can't process keypresses).
  // Lines that arrive while a round is in flight are dropped with a hint —
  // not recorded, not queued.
  if (activeControl) { ui.printSystem('(agents are thinking — ^C skips the turn)'); return; }
  const text = line.trim();
  if (!text) { rl.prompt(); return; }
  if (text === '/quit') { rl.close(); return; }
  if (text === '/who') {
    for (const s of config.roster) ui.printSystem(`@${s} → ${config.binaries[s]}`);
    rl.prompt(); return;
  }
  if (text === '/last') {
    const last = readTranscript(dir).filter((m) => m.from !== 'ted').at(-1);
    if (last) ui.printReply(last.from, last.text); else ui.printSystem('(no replies yet)');
    rl.prompt(); return;
  }
  if (text === '/last-error') {
    ui.printSystem(lastError(dir) ?? '(no errors logged)');
    rl.prompt(); return;
  }
  const plan = parsePlanCommand(text, config.roster);
  if (plan) {
    if (plan.kind === 'usage') { ui.printSystem(PLAN_USAGE); rl.prompt(); return; }
    if (plan.kind === 'bad-seat') {
      ui.printSystem(`unknown seat "@${plan.seat}" — roster: ${config.roster.map((s) => '@' + s).join(' ')}`);
      rl.prompt(); return;
    }
    if (plan.kind === 'off') {
      const was = endPlanning(dir, config.roster);
      ui.printSystem(was ? `(planning mode ended — @${was} no longer receives un-mentioned messages)` : '(planning mode was not on)');
      rl.prompt(); return;
    }
    const planner = plan.planner ?? config.planner;
    if (!config.roster.includes(planner)) {
      ui.printSystem(`planner "@${planner}" is not in the roster — use /plan @seat <text> or set "planner" in .unite/config.json`);
      rl.prompt(); return;
    }
    ui.printSystem(`(planning mode: @${planner} drives; plain text goes to @${planner}; @mentions still work; /plan off to end)`);
    await startRound({ humanText: plan.text, planStart: true, planner });
    return;
  }
  await startRound({ humanText: text });
}

rl.on('line', handleInput);
```

(`rl.on('close', …)` and the final `rl.prompt();` stay as they are.)

In `README.md`:

Add to the slash-commands table, above `/who`:
```markdown
| `/plan <text>` | start planning mode: the planner seat (default `@claude`) drives with its brainstorming skill; your plain-text replies go to it without an @mention |
| `/plan @seat <text>` | same, with a different seat driving |
| `/plan off` | end planning mode (plain text goes back to being a note) |
```

Update the "No mention = a note" bullet to:
```markdown
- **No mention = a note**: logged and forwarded in later context, triggers
  nobody. Exception: while `/plan` mode is on, an un-mentioned message goes to
  the planner seat, so you can answer its questions in plain text.
```

Update the config bullet under "Memory & state" to:
```markdown
- Optional `.unite/config.json`: roster, seat→binary map, models, `turnCap`,
  `timeoutMs`, `planner` (seat that drives `/plan`, default `claude`), `mcp`
  (load Ted's claude.ai connectors in the Claude seat, default `false`).
```

- [ ] **Step 4: Run the full suite**

Run: `node --test test/*.test.js`
Expected: all pass (110).

- [ ] **Step 5: Interactive check (optional; the REPL test above covers the wiring)**

Run `node bin/unite.js new play` in a scratch project and type `/plan`, `/plan @bogus x`, `/plan off`, `/quit`. Each prints the line the REPL test asserts.

- [ ] **Step 6: Commit**

```bash
git add lib/deltas.js lib/cli.js lib/engine.js bin/unite.js README.md test/deltas.test.js test/cli.test.js test/engine.test.js
git commit -m "feat(room): /plan [@seat] <text> and /plan off; un-mentioned text routes to the planner

state.planner persists across resume; explicit @mentions always win.
The plan notice tells the planner to write its spec under ~/.claude/plans/.

<trailer>"
```

---

### Task 9: Dictation-safe input: burst merge and the Spike 4 script (Change 6)

**Files:**
- Create: `lib/burst.js`, `scripts/dictation-spike.mjs`
- Modify: `bin/unite.js` (the `rl.on('line', handleInput)` line), `SPRINT.md`
- Test: `test/burst.test.js` (new), `test/scripts.test.js` (new)

**Interfaces:**
- Consumes: `handleInput(line)` from Task 8; `runHeadless` (Task 1) in the script test.
- Produces: `makeBurstMerger(onMessage: (text: string) => void, { windowMs = 300 } = {}) → (line: string) => void`. Lines arriving within `windowMs` of the previous one are joined with `"\n"` and delivered once, after the window closes.

Why this rung first: readline emits one `line` event per newline, and dictation bursts and pastes both carry newlines at pauses. Each newline would otherwise send a fragment to the seats as its own message. This is the middle rung of the spec's ladder and applies whether or not paste markers turn out to exist; the top rung (bracketed paste) cannot apply today because readline never enables paste mode, so no markers arrive. The bottom rung is Task 10 and waits for the spike.

- [ ] **Step 1: Write the failing tests**

Create `test/burst.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBurstMerger } from '../lib/burst.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('lines within the window merge into one message joined by newline', async () => {
  const out = [];
  const push = makeBurstMerger((t) => out.push(t), { windowMs: 30 });
  push('self-e');
  push('vident');
  push('truths');
  assert.deepEqual(out, []); // nothing until the window closes
  await sleep(60);
  assert.deepEqual(out, ['self-e\nvident\ntruths']);
});

test('lines separated by more than the window are separate messages', async () => {
  const out = [];
  const push = makeBurstMerger((t) => out.push(t), { windowMs: 20 });
  push('first');
  await sleep(50);
  push('second');
  await sleep(50);
  assert.deepEqual(out, ['first', 'second']);
});

test('a single line still arrives (window default is 300ms)', async () => {
  const out = [];
  const push = makeBurstMerger((t) => out.push(t));
  push('/quit');
  await sleep(350);
  assert.deepEqual(out, ['/quit']);
});
```

Create `test/scripts.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runHeadless } from '../lib/proc.js';

const SPIKE = fileURLToPath(new URL('../scripts/dictation-spike.mjs', import.meta.url));

test('dictation spike flags newline, backspace and paste markers in piped input, exits on ^C byte', async () => {
  const r = await runHeadless({
    cmd: process.execPath,
    args: [SPIKE],
    stdinText: 'hel\x7flo\nworld \x1b[200~pasted\x1b[201~\x03',
    timeoutMs: 5000,
  });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /BACKSPACE/);
  assert.match(r.stdout, /NEWLINE/);
  assert.match(r.stdout, /PASTE-START/);
  assert.match(r.stdout, /PASTE-END/);
  assert.match(r.stdout, /\[ctrl-c\] done/);
  assert.match(r.stdout, /68 65 6c 7f 6c 6f/); // hex of "hel<DEL>lo"
});

test('dictation spike exits cleanly when stdin just ends', async () => {
  const r = await runHeadless({ cmd: process.execPath, args: [SPIKE], stdinText: 'abc', timeoutMs: 5000 });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /61 62 63/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/burst.test.js test/scripts.test.js`
Expected: FAIL. Neither module exists.

- [ ] **Step 3: Implement**

Create `lib/burst.js`:

```js
// Change 6: dictation and pastes land as a burst of keystrokes that can carry
// newlines at pauses. readline emits one 'line' per newline, which would send
// each fragment to the seats as its own message. Lines that arrive within
// windowMs of each other are merged into one message.
export function makeBurstMerger(onMessage, { windowMs = 300 } = {}) {
  let pending = [];
  let timer = null;
  return (line) => {
    pending.push(line);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const text = pending.join('\n');
      pending = [];
      onMessage(text);
    }, windowMs);
  };
}
```

Create `scripts/dictation-spike.mjs`:

```js
#!/usr/bin/env node
// Spike 4 (throwaway, keep for re-runs): what does the terminal deliver while
// Ted dictates? Raw-mode hex dump of stdin with flags for the things the fix
// depends on. Run: node scripts/dictation-spike.mjs → dictate one long
// sentence with a correction → press Ctrl-C. Paste the output on the board.
import process from 'node:process';

const t0 = Date.now();
if (process.stdin.isTTY) process.stdin.setRawMode(true);
// Enable bracketed paste so a paste (if that is what dictation does) shows markers.
process.stdout.write('\x1b[?2004h');
process.on('exit', () => process.stdout.write('\x1b[?2004l'));

process.stdin.on('data', (d) => {
  const flags = [];
  if (d.includes('\x1b[200~')) flags.push('PASTE-START');
  if (d.includes('\x1b[201~')) flags.push('PASTE-END');
  if (d.includes(0x0a) || d.includes(0x0d)) flags.push('NEWLINE');
  if (d.includes(0x7f) || d.includes(0x08)) flags.push('BACKSPACE');
  if (d.includes('\x1b[D') || d.includes('\x1b[C')) flags.push('CURSOR-MOVE');
  const hex = [...d].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  console.log(`[+${Date.now() - t0}ms ${d.length}B ${flags.join(' ') || '-'}] ${hex}`);
  if (d.includes(0x03)) { console.log('[ctrl-c] done'); process.exit(0); }
});
process.stdin.on('end', () => process.exit(0));
console.log('dictate one long sentence now (include a correction); Ctrl-C to finish');
```

Then `chmod +x scripts/dictation-spike.mjs`.

In `bin/unite.js`, import the merger (`import { makeBurstMerger } from '../lib/burst.js';`) and replace `rl.on('line', handleInput);` with:

```js
// Change 6: merge a burst of lines (dictation pauses, pastes) into one message.
// Only on a TTY: piped stdin (tests, scripts) is line-oriented by nature and
// must keep one 'line' = one input (test/cli.test.js pipes several lines at once).
rl.on('line', process.stdin.isTTY ? makeBurstMerger(handleInput) : handleInput);
```

In `SPRINT.md`, confirm this item is present under `## Human` (it was logged when the plan was written); add it if missing:

```markdown
- Dictation spike (Change 6): run `node scripts/dictation-spike.mjs` in a terminal,
  dictate one long sentence with a spoken correction, press Ctrl-C, paste the
  output on the board. Decides whether Task 10 of the plan (`terminal: false`
  input) is needed. Look for: BACKSPACE bursts, CURSOR-MOVE, PASTE-START.
```

- [ ] **Step 4: Run the full suite**

Run: `node --test test/*.test.js`
Expected: all pass (115).

- [ ] **Step 5: Manual check**

Run `node bin/unite.js new burst` in a scratch project, paste three lines of text at once (Cmd-V of a multi-line clipboard), then `/quit`. `transcript.jsonl` must contain a single `ted` message whose `text` has two `\n`, not three messages.

- [ ] **Step 6: Commit**

```bash
git add lib/burst.js scripts/dictation-spike.mjs bin/unite.js SPRINT.md test/burst.test.js test/scripts.test.js
git commit -m "feat(input): merge line bursts (dictation, paste) into one message; ship dictation spike

Fragments no longer reach the seats as separate messages. Whether readline's
redraw also needs replacing waits on Ted's hex dump (SPRINT.md Human item).

<trailer>"
```

---

### Task 10: Conditional: cooked-mode input if the spike shows readline scrambling

**Gate:** execute this task only if Ted's `dictation-spike` output shows `BACKSPACE` bursts or `CURSOR-MOVE` sequences inside the dictated burst, or if Ted reports that the doubled line or scrambled word order persists after Task 9. If the dump shows only plain text with `NEWLINE`s, Task 9 was the fix; skip this task and say so in the Build Journal.

**Files:**
- Modify: `bin/unite.js` (readline construction, SIGINT wiring), `lib/proc.js` (spawn options)

**Interfaces:**
- Consumes: the existing `rl.on('SIGINT')` handler body.
- Produces: the same skip/drain behavior via `process.on('SIGINT')`; children spawned `detached: true` so the terminal's Ctrl-C reaches only unite.

Why: with `terminal: true`, readline re-renders the whole line on every keypress from its own model of the cursor. A burst of backspaces or cursor moves on a wrapped line makes that model disagree with the terminal, which is what doubles rows and inserts text at the wrong position. With `terminal: false` the tty's canonical line editing handles the burst and readline only ever sees whole lines. Costs history and arrow-key editing, which the room does not need. Two consequences must be handled: Ctrl-C now arrives as a signal instead of a keypress, and that signal goes to every process in the foreground group, including the seat's child.

- [ ] **Step 1: Switch readline to cooked mode**

In `bin/unite.js`, change the interface construction to:

```js
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: ui.prompt(), terminal: false });
```

- [ ] **Step 2: Move the SIGINT handler to the process**

Replace `rl.on('SIGINT', () => {` with `process.on('SIGINT', () => {` and keep the body unchanged. Update the comment above it to:

```js
// In cooked mode (terminal: false) Ctrl-C is a real SIGINT, not a keypress,
// so it is handled at the process level. Children are spawned detached so the
// terminal's Ctrl-C reaches unite alone; the engine aborts the child itself.
```

- [ ] **Step 3: Detach children**

In `lib/proc.js`, change the spawn line to:

```js
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], detached: true });
```

`child.kill('SIGKILL')` on abort and timeout is unchanged and still targets the child pid.

- [ ] **Step 4: Run the suite and the manual checks**

Run: `node --test test/*.test.js`
Expected: all pass (the proc tests spawn detached children and still see their output and exit codes).

Manual, in a scratch project with `unite new cooked`:
1. Type `hello @claude` and Enter; the round runs; the status line ticks.
2. Press Ctrl-C once during the turn → `(skipping current turn — ^C again to drain the queue)` then `claude> [skipped by Ted (^C)]`.
3. Press Ctrl-C at the idle prompt → `(/quit to exit)`, the process stays up.
4. `unite resume` → the chat picker still accepts a number.
5. Dictate the sentence that failed before; it must arrive as one `ted` message with the words in order.

- [ ] **Step 5: Commit**

```bash
git add bin/unite.js lib/proc.js
git commit -m "fix(input): cooked-mode prompt so dictation bursts cannot scramble readline's redraw

Ctrl-C is now a process SIGINT; seat children are detached so only unite
receives it. Chosen from the dictation hex dump (see board).

<trailer>"
```

---

### Task 11: Live verification, smoke progress, sprint close-out

**Files:**
- Modify: `scripts/smoke.mjs`, `README.md` (turn-time bullet, troubleshooting), `SPRINT.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new in code; the sprint record.

- [ ] **Step 1: Show progress in the smoke script**

In `scripts/smoke.mjs`, replace the two `a.invoke(...)` calls so each prints the progress phases it saw:

```js
const progress = () => {
  const phases = [];
  return {
    phases,
    onProgress: (e) => { if (phases.at(-1) !== e.phase) phases.push(e.phase); },
  };
};
for (const seat of seats) {
  const a = FACTORIES[seat]({ binary: config.binaries[seat], timeoutMs: config.timeoutMs, mcp: config.mcp });
  console.log(`\n=== ${seat} (${config.binaries[seat]}) ===`);
  const p1 = progress();
  const r1 = await a.invoke({ prompt: 'Remember the codeword "walnut". Reply only: OK', sessionRef: null, onProgress: p1.onProgress });
  console.log('round 1:', r1.ok ? `OK (session ${r1.sessionRef})` : `FAIL: ${r1.error}\n${r1.stderr}`, '— phases:', p1.phases.join(' → '));
  if (!r1.ok) continue;
  const p2 = progress();
  const r2 = await a.invoke({ prompt: 'Read the file package.json here and reply with only its "name" value, then the codeword.', sessionRef: r1.sessionRef, onProgress: p2.onProgress });
  const remembered = r2.ok && /walnut/i.test(r2.replyText);
  console.log('round 2 (resume + one tool):', r2.ok ? (remembered ? 'MEMORY OK' : `NO MEMORY — got: ${r2.replyText}`) : `FAIL: ${r2.error}\n${r2.stderr}`, '— phases:', p2.phases.join(' → '));
}
console.log('\nSpike checklist: round-2 MEMORY OK for gemini proves --conversation resume; ' +
  'for cursor proves --resume + session-id capture. A "tool: …" phase in round 2 proves live progress. ' +
  'Any FAIL: check errors above, adjust adapter, re-run.');
```

- [ ] **Step 2: Run the smoke against all three seats**

Run: `node scripts/smoke.mjs`
Expected: each seat prints `OK`, `MEMORY OK`, and round-2 phases that include `connected`, a `tool: …` entry, and `replying`. If a seat's plan mode denies its read tool (agy chose `run_command` for `pwd` in the spike and was auto-denied), `MEMORY OK` still holds and the phases still show `tool: …`; that is a seat-side permission quirk, not an adapter failure.

- [ ] **Step 3: End-to-end verification in a real project**

From the spec, run in `AgentsUniteDesktop` (or any project with a `.unite/`):

1. `unite`, type `/plan build a widget`. Claude replies with a classification and one question. Answer in plain text with no @mention; Claude asks the next question.
2. Ask the Claude seat to read one file. The status line shows `tool: Read · 1 tool` during the turn. `grep -c '"tool:' .unite/chats/*/transcript.jsonl` prints 0.
3. Press Ctrl-C mid-turn. Screen and transcript say `skipped by Ted (^C)`.
4. Open a chat that predates this upgrade. Exactly one `[System]: Policy update` line is appended (check with `grep -c 'Policy update' transcript.jsonl` before and after a second start: still 1).
5. Gemini and Cursor seats show `connected` then `last activity Ns ago` ticking during a turn.
6. `/plan off`, then plain text with no @mention: no seat replies.

Record each result as pass/fail in the Build Journal entry.

- [ ] **Step 4: README turn-time bullet and troubleshooting**

Replace the "Expect 30–90s per turn" bullet with:

```markdown
- **Expect 10–90s per turn** — each is a real headless model call. The status
  line shows the stage (`starting`, `connected`, `thinking`, `tool: <name>`,
  `replying`), how many tools the seat has used, and how long since it last
  produced output. A seat that says `starting` for more than ~10s is stuck
  before its CLI booted; one that says `last activity 120s ago` is stuck
  inside a tool.
```

Add to Troubleshooting:

```markdown
- A seat prints `[skipped by Ted (^C)]` → you pressed Ctrl-C; nothing is wrong.
- The Claude seat feels slow to `connected` → check `.unite/config.json`
  does not set `"mcp": true`; the room runs Claude without your claude.ai
  connectors by default.
```

- [ ] **Step 5: SPRINT.md**

Under `## Phases`, add and tick:
```markdown
- [x] Phase 4 — Room /plan mode + turn visibility: read-only tool policy, stream-json status line, honest ^C, /plan routing, MCP-off Claude seat, burst-merged input
```
Set `## Current phase` to `Phase 4 — complete; awaiting Ted's acceptance run of the six end-to-end checks`.
Set `## Next` to `Ted runs the dictation spike (Human item) → decide Task 10; then acceptance run of /plan in AgentsUniteDesktop`.
Keep the Task 9 Human item. Set `## Blockers` to `none`.

- [ ] **Step 6: Full suite, then commit**

Run: `node --test test/*.test.js`
Expected: all pass.

```bash
git add scripts/smoke.mjs README.md SPRINT.md
git commit -m "docs: Phase 4 close-out — smoke shows progress phases, README status-line and /plan docs

All six end-to-end checks recorded in the Build Journal; Task 10 gated on
the dictation spike.

<trailer>"
```

---

## Self-review against the spec

**Coverage.** Change 1 → Task 7. Change 2 (status line, `onData`, per-adapter progress, `startStatus` shape, `formatStatus`) → Tasks 1, 2, 3, 4, 5, 6; the addendum's phases (`starting`, `connected`, `thinking`, `tool: <name>`, `replying`, plus `alive` for bytes-before-structure) → Tasks 2 and 4-6. Change 3 → Task 3. Change 4 (`/plan [@seat]`, `/plan off`, planner routing, `config.planner`, plan notice with the `~/.claude/plans/` instruction, mention precedence) → Task 8. Change 5 (`mcp: false`, verified flags) → Task 4. Change 6 (spike script, burst merge, cooked-mode fallback) → Tasks 9 and 10. Spec test list: `proc.js onData` (Task 1), claude fixture with `lastTool`/`toolCount` (Task 4), aborted turn wording and `offline: exit N` (Task 3), policy notice once across two starts (Task 7), all five `/plan` assertions (Task 8). Spec verification steps 1-6 → Task 11. Session-end protocol (SPRINT Phase 4, trailers) → Task 11 and Global Constraints.

**Deviations from the spec, each argued from a spike result:** all three seats use `stream-json` rather than heartbeat-only for agy and cursor (their `json` modes emit nothing until the end); the reply comes from the parsed `result` event rather than `extractJson` over the whole stream (cursor's thinking events carry a top-level `text`); `PLAN_NOTICE` is `planNotice(planner)` so `/plan @gemini` addresses the right seat; a fresh chat is stamped to `policyVersion 2` without a transcript line (its preamble already carries the policy); Task 10 is gated on Ted's spike rather than executed blind.

**Type consistency.** `onData(chunk, stream)` (Task 1) is what Tasks 4-6 pass. `makeTracker` phases in Task 2 match the strings asserted in Tasks 4-6 (`connected`, `thinking`, `tool: <name>`, `replying`, `alive`). `startStatus` returns `{ update, stop }` in Task 2 and the engine calls exactly those in Task 3. `runRound({ planStart, planner })`, `endPlanning`, `applyPolicyNotice` are named identically in Tasks 7, 8, and `bin/unite.js`. `config.mcp` and `config.planner` are added in Task 4 and consumed in Tasks 4 and 8. `parsePlanCommand`'s five result kinds in Task 8 match the branches in `handleInput`.

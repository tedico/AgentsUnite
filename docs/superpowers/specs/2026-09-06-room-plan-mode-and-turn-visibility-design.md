# AgentsUnite CLI minor upgrade: `/plan` in the room, tool policy, turn visibility

Target repo: `/Users/teds/Projekts/AgentsUnite`
Spec destination: `docs/superpowers/specs/2026-09-06-room-plan-mode-and-turn-visibility-design.md`
Status: design approved in the unite room by Ted on 2026-09-06. All markers resolved. Ready for writing-plans.

## Goal

Replicate, inside the unite room, the 1:1 Claude Code experience Ted already
has: Ted types `/plan`, Claude invokes `superpowers:brainstorming` and drives
the design (classify, one clarifying question at a time, approaches, sectioned
design, spec), and Ted answers in plain text without re-addressing Claude every
turn. In the room, Gemini and Cursor are reviewers the planner pulls in by
@mention. Changes 1 to 3 are the prerequisites that make Change 4 usable.

## Context

On 2026-09-06 the Claude seat invoked brainstorming in the room and dispatched
a read-only exploration. The turn ran silently, Ted pressed Ctrl-C, and the
transcript recorded `@claude offline: skipped`. Defects surfaced:

1. The room preamble (`lib/deltas.js:17`) forbids all tool calls. That conflicts
   with the superpowers SessionStart hook and over-restricts relative to what
   the CLIs already enforce (every seat runs in plan mode).
2. The status line (`lib/ui.js` `startStatus`) shows only a spinner and elapsed
   seconds. A seat doing real tool work looks identical to a hung one.
3. The skip message says "offline", which pointed the diagnosis at timeouts.
   Default `timeoutMs` is 300000 and was never reached.
4. `/plan <text>` is not a command (`bin/unite.js:103-116`). It falls through to
   `runRound` as chat, and since it carries no @mention, no seat replies. Ted's
   plain-text answers to a planner's questions have the same problem.

## Decisions (resolved with Ted in the room)

- Uniform read-only tool policy for all three seats.
- Live sessions get one-time `[System]` notices via the transcript; no restart.
- Preamble carries soft tools-per-turn guidance so Change 1 doesn't recreate
  the long-silent-turn problem that Change 2 mitigates.
- `timeoutMs` stays at 300000. No SIGTERM-then-SIGKILL grace: the engine knows
  an abort came from Ted before it kills the child, and the Claude seat's
  session survived SIGKILL intact. Revisit only if a seat provably loses its
  native session on kill.
- No progress data ever enters the transcript. Status line only.
- No new dependencies. Zero-dep Node stays zero-dep.

## Change 1: room preamble tool policy

File: `lib/deltas.js`, replace the line-17 sentence with:

> You are in a multi-agent group planning room. Read-only tool calls are
> allowed: reading files, searching, read-only shell commands, and skills.
> Do not edit files, commit, or change configuration; your CLI enforces plan
> mode. Use tools only when the answer depends on the repo, prefer direct
> reads over subagents, and avoid long explorations unless Ted asks for
> grounded work. Ted cannot see inside your turn, so say what you're about to
> do, keep tool use short, and lead with text.

Live-session notice, reusing the transcript as the message bus:

- Add `policyVersion` to state (`lib/transcript.js` `loadState`/`saveState`;
  default 1 when absent).
- On CLI start (`bin/unite.js`), if `state.policyVersion < 2`, append one
  `{ from: 'system', text: POLICY_NOTICE }` message and set `policyVersion = 2`.
  Every seat sees `[System]: ...` in its next delta through the existing
  `readTranscript` + cursor path.
- `POLICY_NOTICE` exported from `lib/deltas.js` beside `BUDGET_NOTICE`: the new
  preamble sentence prefixed "Policy update:".

## Change 2: live activity in the status line

Shared progress event, emitted by adapters, consumed only by the UI:

```js
{ ts: number, lastTool?: string, toolCount?: number }
```

- `lib/proc.js` `runHeadless`: accept optional `onData(chunk, 'stdout'|'stderr')`
  and call it from the existing `data` listeners. No parsing here.
- `lib/adapters/claude.js`: args become
  `['-p', '--permission-mode', 'plan', '--output-format', 'stream-json', '--verbose']`
  (verify whether print mode requires `--verbose`; drop it if not). Line-buffer
  stdout, `JSON.parse` each complete line, and on an `assistant` event with
  `tool_use` content blocks call `onProgress({ ts, lastTool: block.name,
  toolCount })`. On any chunk call `onProgress({ ts })`. Final reply extraction
  is unchanged: `extractJson(r.stdout, ['result'])` still finds the `result`
  event, which also carries `session_id`.
- `lib/adapters/agy.js`, `lib/adapters/cursor.js`: pass `onData` through and
  call `onProgress({ ts })` per chunk. Heartbeat only, until the spike below
  shows either CLI emits structured events before the final object.
- `lib/engine.js`: `startStatus` returns `{ update(evt), stop() }`; pass
  `onProgress: (evt) => status.update(evt)` into `adapters[seat].invoke`. The
  `finally` block calls `status.stop()` as today.
- `lib/ui.js`: `formatStatus` renders tool count, last tool name, and
  "last activity Ns ago" when known. With no progress data the line is
  unchanged from today.

## Change 3: honest skip message

File: `lib/engine.js:82-85`. When `signal.aborted`, record
`@${seat} skipped by Ted (^C)` in the transcript and print
`${seat}> [skipped by Ted (^C)]`. Keep `offline: <reason>` for `timeout`,
`exit N`, `binary not found`, and `bad json`, which the adapters already
distinguish.

## Change 4: `/plan` room command and planner routing

This is the change the other three exist for.

- `bin/unite.js`: two new commands before the fall-through at line 117.
  `/plan [@seat] <text>` calls `runRound({ humanText: text, planStart: true,
  planner: seat ?? config.planner, ... })`. The optional leading `@seat` picks
  the planner (`/plan @gemini ...`), so the seat is a default, not a hard-code.
  `/plan off` clears `state.planner`, appends a `[System]: Planning mode
  ended` message, prints a notice. Bare `/plan` with no text prints usage.
- Escape hatches: explicit @mentions (including `@all`, already parsed) always
  win over planner routing for that round, and `/plan off` leaves planning
  mode. No separate `/chat` alias; one exit command is enough.
- `lib/engine.js` `runRound`:
  - On `planStart`: set `state.planner = planner ?? config.planner ?? 'claude'`, append
    Ted's message, then append `{ from: 'system', text: PLAN_NOTICE }`.
  - Queue seeding: explicit @mentions as today. If the queue is empty and
    `state.planner` is set, seed `[state.planner]`. This is what lets Ted
    answer a planner's question in plain text and get the next question back,
    the way 1:1 plan mode works.
  - `state.planner` persists in state.json via `loadState`/`saveState`.
- `lib/config.js`: optional `planner` key, default `'claude'` (the only seat
  with the superpowers plugin installed today).
- `lib/deltas.js`: `PLAN_NOTICE`:

  > Planning mode started by Ted. @claude: invoke your brainstorming skill
  > (superpowers:brainstorming) and drive the design: classify the task, ask
  > Ted one clarifying question at a time, then propose approaches and present
  > the design in sections. Grounded exploration is expected here; announce it
  > first and keep each turn short. Other seats: review only when @mentioned;
  > do not run a parallel brainstorm. Ask questions in plain text; the
  > interactive question and plan-exit tools are not available to headless
  > seats.

- Spec output while planning (resolved by Ted, 2026-09-06): the room stays
  strictly read-only. The planner writes the spec to its Claude plan-file path
  under `~/.claude/plans/` (allowed in plan mode), reports the path, and Ted
  copies it into the repo. PLAN_NOTICE should say so, so the planner reports
  the path rather than attempting a repo write. The scoped-write alternative
  is recorded under Follow-ups.

## Follow-ups (named, not in this upgrade)

- Option (b) above: scoped write allowlist for `docs/superpowers/specs/**` so
  a room `/plan` session lands its spec in the repo without a copy step. Own
  change, own spec: it touches the read-only guarantee in all three adapters
  and the uniform preamble agreed in Change 1.

## Pre-implementation spikes (throwaway, minutes each)

1. Pipe `agy --print hi --mode plan --output-format json` and
   `cursor-agent -p --trust --mode plan --output-format json -- hi` through a
   tiny node script that timestamps stdout chunks. Decide heartbeat versus
   structured progress per seat from what actually arrives.
2. Confirm `claude -p --output-format stream-json` accepts or requires
   `--verbose`, and capture one real event stream as a test fixture.

## Tests (`node --test`, existing suite plus)

- `proc.js`: `onData` fires per chunk for a `node -e` child that writes twice
  with a delay.
- `adapters/claude.js`: stream-json fixture (init, assistant tool_use, result)
  yields the right `replyText`, `sessionRef`, and a progress call carrying
  `lastTool` and `toolCount`.
- `engine.js`: aborted turn records `skipped by Ted (^C)`; non-zero exit still
  records `offline: exit N`.
- Policy notice appended exactly once across two CLI starts when
  `policyVersion` starts absent.
- `/plan x`: planner seeded, `PLAN_NOTICE` appended once. Un-mentioned Ted
  message routes to planner while `state.planner` is set. Explicit @mentions
  still take precedence. `/plan off` clears and plain text yields no reply.

## Verification (end to end)

1. Run `unite` in `AgentsUniteDesktop`, type `/plan build a widget`. Claude
   replies with a path classification and one question. Answer in plain text
   with no @mention; Claude asks the next question.
2. Ask the Claude seat to read one file. Status line shows a tool name and
   count during the turn; the transcript contains no progress data.
3. Press Ctrl-C mid-turn. Transcript and screen say `skipped by Ted (^C)`.
4. Start a chat with existing per-seat sessions. Exactly one `[System]: Policy
   update` line appears and each seat's next reply reflects it.
5. Gemini and Cursor seats show "last activity Ns ago" ticking during a turn.
6. `/plan off`, then plain text with no @mention: no seat replies, as today.

## Scope

Six files (`bin/unite.js`, `lib/engine.js`, `lib/deltas.js`, `lib/proc.js`,
`lib/ui.js`, `lib/config.js`) plus the three adapters for the `onData`
pass-through. Roughly 150 lines. Two new state fields. No dependencies.

## Session-end protocol for the AgentsUnite repo

- `SPRINT.md`: add `Phase 4 — Room /plan mode + turn visibility`, set as
  current, `Next:` = run the two spikes, `Human:` none, `Blockers:` resolve the
  Change 4 marker.
- Commit the spec, and later the implementation, with status-signal messages
  and one trailer per contributing agent. Gemini's and Cursor's review changed
  the design (crash/skip wording split, soft tool cap, shared event shape,
  keep progress off the transcript), so the spec commit carries all three:
  `Co-Authored-By: ✳️ Claude Fable 5.1 <noreply@anthropic.com>`
  `Co-Authored-By: ✦ Gemini (Antigravity) <noreply@google.com>`
  `Co-Authored-By: 🤖 Cursor Agent 🤖 <noreply@cursor.com>`

## Next step

Resolve the Change 4 marker, then in a regular `claude` session in
`/Users/teds/Projekts/AgentsUnite`: copy this file to the spec destination,
commit it with the trailers, and invoke `superpowers:writing-plans` against it.

## Addendum (2026-09-06, after Ted's "frozen or CLI?" feedback)

Observed cause of long silent turns on the Claude seat: each turn spawns a
fresh `claude -p --resume` process that reloads the session, runs the
superpowers SessionStart hook, and connects every claude.ai MCP connector on
Ted's account (a dozen servers, hundreds of tool definitions) before the
prompt is processed. Tool calls made during the turn add further silence.

### Change 2 extension: status-line phases

With stream-json the first event from claude is a `system` init message, so
the UI can show which stage a turn is in, not just that it is running:
`starting` (no bytes yet), `connected` (init event seen), `thinking`
(assistant text, no tool), `tool: <name>` (tool_use seen), `replying`
(result event seen). Seats without structured output show `starting` until
first bytes, then `alive, last activity Ns ago`. Add `phase?: string` to the
shared progress event.

### Change 5: no MCP connectors for the headless Claude seat

The room never needs Ted's claude.ai connectors. Launch the Claude seat with
MCP disabled to cut startup time. Spike 3: verify the flags on the installed
claude version (candidate: `--strict-mcp-config` together with an empty
`--mcp-config`), measure startup before and after with a trivial prompt, and
confirm skills and plan mode still load. Make it a config toggle
(`mcp: false` default for the room) in case a future room needs a connector.

## Change 6: dictation-safe input (added 2026-09-06 after Ted's report)

Symptom: when Ted dictates into the unite prompt, the line visually doubles
and the message reaches seats split into fragments with scrambled order
(observed in the transcript: "self-e" / "vident" cut across two messages,
sentence ends arriving before their beginnings). Ted confirmed it happens
mainly when dictating, not specifically while agents think or on long typed
lines.

Cause class: Node readline redraws the whole input line on every keypress.
Dictation injects a burst of hundreds of characters, often with embedded
newlines at pauses and sometimes backspace sequences for corrections. Burst +
wrapped line = duplicated rows on screen; embedded newline = premature
submit; backspace burst on a wrapped line = scrambled insert position.

Spike 4 (throwaway): a ten-line node script that puts stdin in raw mode and
hex-dumps what arrives while Ted dictates one long sentence. Look for
bracketed-paste markers (`ESC[200~` ... `ESC[201~`), embedded `\n`, and
backspace (`0x7f`) bursts. Also check whether the installed Node's readline
already handles bracketed paste.

Fix, chosen by the spike result, cheapest first:

- Paste markers present: buffer everything between the markers, insert it as
  one line with a single redraw, and never submit on a newline that is inside
  a paste. If readline already does this natively, it is a flag, not code.
- No markers, but newlines in the burst: merge `line` events that arrive
  within roughly 300 ms into one message before `runRound`. Small change in
  `bin/unite.js` `rl.on('line')`.
- Backspace bursts scrambling position: readline's redraw is the problem.
  Fall back to `terminal: false` for the prompt (the tty echoes input itself,
  handles wrapping correctly; costs history and arrow-key editing, which the
  room does not need), or replace the redraw with our own minimal reader.

Not in scope: an editor-style composer. The desktop app is the real answer
to input ergonomics; the CLI gets the smallest patch that makes dictation
land as one intact message.

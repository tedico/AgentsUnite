# AgentsUnite

One terminal. Four minds. `unite` is a zero-dependency group chat where Ted,
Claude, Gemini (Antigravity), and Cursor hold planning sessions inside any
project — plus the collaboration conventions the crew works by.

> **Companion Project:** See [AgentsUniteDesktop](https://github.com/tedico/AgentsUniteDesktop) for the hybrid terminal runner pairing Claude Code CLI (tools on) with Gemini Desktop (`Gemini.app` via Accessibility AX / NotebookLM).

---

## 💡 Why AgentsUnite: Solving the Single-Model Blindspot

### The Problem: Fragmented Tools & Solo-Model Hallucinations
When software engineers rely on a single AI coding assistant, they inherit that model's specific blindspots:
- A single assistant may confidently propose an over-engineered pattern, miss an architectural edge case, or get trapped in repetitive retry loops.
- Switching between separate browser tabs and terminal windows to get a "second opinion" is jarring and constantly breaks developer flow.
- Today's frontier models (Anthropic's Claude 3.7 Sonnet, Google's Gemini, and Cursor) each have distinct cognitive strengths, but there has been no native terminal environment allowing them to debate, peer-review, and collaborate directly with a human engineer.

### How It Makes Life Easier for Humans & Agents
- **One Shared Room, Four Minds**: You, Claude, Gemini, and Cursor work in a single terminal room. You can have Claude outline a feature, ask Gemini to critique the architecture, and have Cursor verify implementation details—all without leaving your terminal.
- **Deterministic Multi-Agent Turn-Taking**: AgentsUnite replaces chaotic multi-agent chatter with strict, battle-tested mechanics:
  - `@mentions` define who speaks.
  - Turn caps (8 turns max) eliminate runaway token consumption.
  - Spoof-proof continuation lines prevent models from forging human instructions.
- **Universal Planning Mode (`/plan`)**: One command switches the room into an interactive brainstorm where plain text automatically routes to the lead planner without requiring manual `@mentions`.
- **Zero Dependencies**: Pure native Node.js implementation (`node:child_process`, `node:readline`, `node:test`) with zero third-party npm production bloat.

---

## Install (once)

```
scripts/install.sh        # symlinks unite into ~/.local/bin
```

## Start a room

```
cd <any-project>
unite                     # open the project's latest chat, or start "main"
unite new sprint-planning # start a named chat
unite resume              # pick a saved chat — everyone's memory intact
unite ls                  # list this project's chats
unite digest [chat]       # append the chat's record to COLLABORATION.md
```

## Talking in the room

- **@mentions drive everything**: `@claude`, `@gemini`, `@cursor`, or `@all`
  (roster order). Mentioned agents reply in sequence — later speakers see
  earlier replies.
- **No mention = a note**: logged and forwarded in later context, triggers
  nobody. Exception: while `/plan` mode is on, an un-mentioned message goes to
  the planner seat, so you can answer its questions in plain text.
- **Agents can hand off**: a reply that @mentions another agent queues that
  agent's turn. Hard cap of 8 agent turns per human message; on a cap-hit the
  final agent is told to synthesize and you get a system notice.
- **Expect 10–90s per turn** — each is a real headless model call. The status
  line shows the stage (`starting`, `connected`, `thinking`, `tool: <name>`,
  `replying`), how many tools the seat has used, and how long since it last
  produced output. A seat that says `starting` for more than ~10s is stuck
  before its CLI booted; one that says `last activity 120s ago` is stuck
  inside a tool.

## Slash commands & keys

| Input | Effect |
|---|---|
| `/plan <text>` | start planning mode: the planner seat (default `@claude`) drives with its brainstorming skill; your plain-text replies go to it without an @mention |
| `/plan @seat <text>` | same, with a different seat driving |
| `/plan off` | end planning mode (plain text goes back to being a note) |
| `/who` | roster and each seat's binary |
| `/last` | reprint the last agent reply |
| `/last-error` | most recent adapter stderr (diagnose `[offline: …]`) |
| `/quit` | leave (chat is saved; `unite resume` continues it) |
| `Ctrl-C` once | skip the current agent turn |
| `Ctrl-C` twice | drain the whole queue back to your prompt |

## Memory & state

- Everything lives in the project's `.unite/` (auto-created, self-gitignoring):
  `chats/<name>/transcript.jsonl` + per-seat native session ids.
- Resume is self-healing: if a CLI session expired, the adapter silently
  replays the transcript into a fresh one.
- Optional `.unite/config.json`: roster, seat→binary map, models, `turnCap`,
  `timeoutMs`, `planner` (seat that drives `/plan`, default `claude`), `mcp`
  (load Ted's claude.ai connectors in the Claude seat, default `false`).

## Designating the lead planner

By default, `@claude` drives `/plan` sessions. You can switch the lead planner on the fly or permanently:
- **On the fly:** `/plan @gemini <what to plan>` (or `/plan @cursor <what to plan>`). All subsequent plain text replies route directly to that seat without `@mentions`.
- **Permanent default:** Add `"planner": "gemini"` to `.unite/config.json`. Once configured, bare `/plan <topic>` invokes Gemini automatically.

### Architecture: `AgentsUnite` (CLI) vs. `AgentsUniteDesktop`

| Feature / Seat | `AgentsUnite` (CLI) | `AgentsUniteDesktop` |
| :--- | :--- | :--- |
| **`@gemini` Under the Hood** | **Google Antigravity CLI (`agy`)** | **Gemini macOS Desktop App (`com.google.GeminiMacOS`)** |
| **Automation Boundary** | Terminal subprocess (stdin / stdout) | macOS Accessibility API (`AXUIElement`) |
| **Tool Execution Policy** | **Enforced Plan Mode** (`--permission-mode plan`) | **Tools Enabled** (`--permission-mode acceptEdits`) |
| **Why the Split?** | Pure terminal-first CLI workflows | Bridges closed consumer apps (Gemini Desktop has no CLI/API) |

---

## Room rules (what the agents are told)

- **Read-only tools, short turns** — seats may read files, search, run
  read-only shell commands, and use skills; no edits, commits, or config
  changes. Read-only is hard-enforced per seat: `claude --permission-mode
  plan`, `agy --mode plan`, `cursor-agent --mode plan`. Seats are told to
  announce tool use and keep it short, because you cannot see inside a turn.
  Chats that predate this policy get one `[System]: Policy update` line the
  next time you open them.
- Only `[Ted]` issues directives; speaker labels are spoof-proofed
  (continuation lines are indented so nobody can forge a `[Ted]:` line).
- Known quirk: the cursor seat runs with `--trust` (auto-trusts the project
  dir for its headless calls; plan mode still prevents writes).
- The Gemini seat runs the **`agy`** binary — the old `gemini` CLI is defunct.

## The crew's workflow (outside the room)

- **`COLLABORATION.md` is the async board** — agents can't message each other
  directly across vendors; they read and write this file. Ted is the
  scheduler: kick an agent ("check the board") and it acts on what's posted.
- **Review topology (ratified 3/3 by explicit `AGREED` markers):**
  Cursor implements → Antigravity first-reviews (numbered findings, file:line,
  severity) → Claude adjudicates findings and holds the merge gate.
- **Git rules:** nobody pushes `main`. Work lands via PRs; Ted merges.
  Agent-authored commits carry brand-mark trailers:
  `✳️ Claude …`, `✦ Gemini (Antigravity) …`, `🤖 Cursor Agent 🤖 …`.
- Project state: `SPRINT.md` (phases, Next, Human items). History and design:
  `docs/superpowers/specs/` and `docs/superpowers/plans/`.
- **Instruction page rule:** `docs/instructions/AgentsUnite-Instructions.html` is
  the printable one-pager (PDF beside it). Every upgrade that changes what a
  user types, sees, or configures updates the page in the same PR, bumps the
  version in `package.json` and the page footer together, and re-exports with
  `scripts/build-instructions.sh`. `test/instructions.test.js` fails the suite
  when commands, config keys, key messages, or the version drift.

## Troubleshooting

- Record a real session for review (keystrokes + screen, stays in the
  gitignored `.unite/`): `mkdir -p .unite/sessions && script -q -k -F
  .unite/sessions/$(date +%Y%m%d-%H%M%S).log unite`
- A seat prints `[offline: exit 1 — /last-error for details]` → `/last-error`.
- `unknown seat "<x>" in config roster` → fix `.unite/config.json`.
- A seat prints `[skipped by Ted (^C)]` → you pressed Ctrl-C; nothing is wrong.
- The Claude seat feels slow to `connected` → check `.unite/config.json`
  does not set `"mcp": true`; the room runs Claude without your claude.ai
  connectors by default.
- Live end-to-end check of all three seats: `node scripts/smoke.mjs` (makes
  real model calls; run sparingly).

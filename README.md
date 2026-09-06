# AgentsUnite

One terminal. Four minds. `unite` is a zero-dependency group chat where Ted,
Claude, Gemini (Antigravity), and Cursor hold planning sessions inside any
project — plus the collaboration conventions the crew works by.

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
- **No mention = a note**: logged and forwarded in later context, triggers nobody.
- **Agents can hand off**: a reply that @mentions another agent queues that
  agent's turn. Hard cap of 8 agent turns per human message; on a cap-hit the
  final agent is told to synthesize and you get a system notice.
- **Expect 30–90s per turn** — each is a real headless model call; the status
  line shows who's thinking and for how long.

## Slash commands & keys

| Input | Effect |
|---|---|
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
  `timeoutMs`.

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

## Troubleshooting

- A seat prints `[offline: exit 1 — /last-error for details]` → `/last-error`.
- `unknown seat "<x>" in config roster` → fix `.unite/config.json`.
- Live end-to-end check of all three seats: `node scripts/smoke.mjs` (makes
  real model calls; run sparingly).

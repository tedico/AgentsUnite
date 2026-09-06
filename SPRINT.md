# Sprint Plan — AgentsUnite (`unite`)

## Phases
- [x] Phase 0 — Design: spec approved by Ted (sections in chat) + Gemini (adversarial review, O1–O5 → A1–A5)
- [x] Phase 1 — Core engine: REPL, turn engine, transcript/state, fake-adapter tests
- [x] Phase 2 — Adapters: spike checklist, then claude/agy/cursor adapters + contract tests
- [x] Phase 3 — Polish: self-healing resume, `unite digest`, install-to-PATH, live smoke test
- [x] Phase 4 — Room /plan mode + turn visibility: read-only tool policy, stream-json status line, honest ^C, /plan routing, MCP-off Claude seat, burst-merged input

## Current phase
Phase 4 — complete; awaiting Ted's acceptance run of the six end-to-end checks

## Next
Ted runs the dictation spike (Human item) → decide Task 10; then acceptance run of /plan in AgentsUniteDesktop.

## Human
- Acceptance: run the six end-to-end checks from PR #5's body (`/plan build a widget` → answer in plain text; one file read shows `tool: Read`; Ctrl-C says `skipped by Ted (^C)`; pre-upgrade chat gets one `[System]: Policy update`; Gemini/Cursor show `connected` then `last activity Ns ago`; `/plan off` then plain text → no reply). Tick them on the PR.
- Run a real `unite` planning session and judge the UX (via `/plan`, now on main)
- Decide /who liveness: implement a liveness marker or amend the spec wording (final review #10)
- Acknowledge: cursor seat runs with --trust (auto-trusts the project dir for headless cursor calls; read-only still enforced by --mode plan)
- Dictation spike (Change 6): once plan Task 9 lands, run `node scripts/dictation-spike.mjs` in a terminal, dictate one long sentence with a spoken correction, press Ctrl-C, paste the output on the board. Decides whether plan Task 10 (`terminal: false` input) is needed. Look for: BACKSPACE bursts, CURSOR-MOVE, PASTE-START.

## Blockers
none

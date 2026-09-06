# Sprint Plan — AgentsUnite (`unite`)

## Phases
- [x] Phase 0 — Design: spec approved by Ted (sections in chat) + Gemini (adversarial review, O1–O5 → A1–A5)
- [x] Phase 1 — Core engine: REPL, turn engine, transcript/state, fake-adapter tests
- [x] Phase 2 — Adapters: spike checklist, then claude/agy/cursor adapters + contract tests
- [x] Phase 3 — Polish: self-healing resume, `unite digest`, install-to-PATH, live smoke test
- [ ] Phase 4 — Room /plan mode + turn visibility: read-only tool policy, stream-json status line, honest ^C, `/plan` routing, MCP-off Claude seat, dictation-safe input (spec + plan dated 2026-09-06)

## Current phase
Phase 4 — spec approved, spikes run, implementation plan written (2026-09-06); implementation not started

## Next
Execute `docs/superpowers/plans/2026-09-06-room-plan-mode-and-turn-visibility.md` Tasks 1–9 and 11 (Task 10 is gated on the dictation spike below). Default lane per the board: Cursor implements, Antigravity reviews, Claude adjudicates and gates the merge.

## Human
- Push `main` (spec, plan, board sync — local is 3 commits ahead of origin) before Cursor opens the Phase 4 PR; then kick Cursor and Antigravity with "check the board"
- Run a real `unite` planning session and judge the UX (via `/plan` once Phase 4 lands)
- Decide /who liveness: implement a liveness marker or amend the spec wording (final review #10)
- Acknowledge: cursor seat runs with --trust (auto-trusts the project dir for headless cursor calls; read-only still enforced by --mode plan)
- Dictation spike (Change 6): once plan Task 9 lands, run `node scripts/dictation-spike.mjs` in a terminal, dictate one long sentence with a spoken correction, press Ctrl-C, paste the output on the board. Decides whether plan Task 10 (`terminal: false` input) is needed. Look for: BACKSPACE bursts, CURSOR-MOVE, PASTE-START.

## Blockers
none

# Sprint Plan — AgentsUnite (`unite`)

## Phases
- [x] Phase 0 — Design: spec approved by Ted (sections in chat) + Gemini (adversarial review, O1–O5 → A1–A5)
- [x] Phase 1 — Core engine: REPL, turn engine, transcript/state, fake-adapter tests
- [x] Phase 2 — Adapters: spike checklist, then claude/agy/cursor adapters + contract tests
- [x] Phase 3 — Polish: self-healing resume, `unite digest`, install-to-PATH, live smoke test
- [x] Phase 4 — Room /plan mode + turn visibility: read-only tool policy, stream-json status line, honest ^C, /plan routing, MCP-off Claude seat, burst-merged input. Accepted 2026-09-06: six end-to-end checks pass on the AgentsUniteDesktop room (board post).

## Current phase
Phase 4 — accepted; one gated task (plan Task 10, cooked-mode input) waits on the dictation spike

## Next
Ted runs the dictation spike → decide plan Task 10. Follow-up spec now covers four items: quoted @all chains a hand-off; a ^C'd request is replayed next turn; the unproven→now-characterized plan-mode write path (finding F-PM1: model-enforced, wants a hard backstop for Bash-holding seats); and a TOOL_POLICY sentence steering seats to file-read tools over shell.

## Human
- Dictation spike (Change 6): run `node scripts/dictation-spike.mjs` in a terminal, dictate one long sentence with a spoken correction, press Ctrl-C, paste the output on the board. Decides whether plan Task 10 (`terminal: false` input) is needed. Look for: BACKSPACE bursts, CURSOR-MOVE, PASTE-START.
- (done 2026-09-06) Live plan-mode write test run — see board finding F-PM1: the Claude seat read-only guarantee is model-enforced, not a hard gate.
- Decide /who liveness: implement a liveness marker or amend the spec wording (final review #10)
- Acknowledge: cursor seat runs with --trust (auto-trusts the project dir for headless cursor calls; read-only still enforced by --mode plan)

## Blockers
none

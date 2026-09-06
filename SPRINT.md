# Sprint Plan — AgentsUnite (`unite`)

## Phases
- [x] Phase 0 — Design: spec approved by Ted (sections in chat) + Gemini (adversarial review, O1–O5 → A1–A5)
- [x] Phase 1 — Core engine: REPL, turn engine, transcript/state, fake-adapter tests
- [x] Phase 2 — Adapters: spike checklist, then claude/agy/cursor adapters + contract tests
- [x] Phase 3 — Polish: self-healing resume, `unite digest`, install-to-PATH, live smoke test
- [x] Phase 4 — Room /plan mode + turn visibility: read-only tool policy, stream-json status line, honest ^C, /plan routing, MCP-off Claude seat, burst-merged input. Accepted 2026-09-06: six end-to-end checks pass on the AgentsUniteDesktop room (board post).

## Current phase
Phase 4 — accepted and documented (instruction page v0.2.0 in repo, drift test). Next phase not started; the next spec is written from a recorded real session.

## Next
Ted prints the v0.2.0 instruction page, then runs a real AgentsUniteDesktop session under `script` recording with Claude watching live. Findings from that recording → decide plan Task 10 and write the follow-up spec (quoted @all hand-off, ^C replay, F-PM1 hard backstop, TOOL_POLICY read-tool steer, events journal / `unite report`).

## Human
- Print `docs/instructions/AgentsUnite-Instructions.pdf` (v0.2.0) — also sent to you directly. Keep it by the keyboard for the monitored session.
- Start the next real AgentsUniteDesktop session with the record command on the instruction page (`script -q -k -F .unite/sessions/<ts>.log unite`) and tell Claude to watch. Replaces the dictation spike: real dictation into unite captures the same bytes in context.
- (done 2026-09-06) Live plan-mode write test run — see board finding F-PM1: the Claude seat read-only guarantee is model-enforced, not a hard gate.
- Decide /who liveness: implement a liveness marker or amend the spec wording (final review #10)
- Acknowledge: cursor seat runs with --trust (auto-trusts the project dir for headless cursor calls; read-only still enforced by --mode plan)

## Blockers
none

# Sprint Plan — AgentsUnite (`unite`)

## Phases
- [x] Phase 0 — Design: spec approved by Ted (sections in chat) + Gemini (adversarial review, O1–O5 → A1–A5)
- [x] Phase 1 — Core engine: REPL, turn engine, transcript/state, fake-adapter tests
- [x] Phase 2 — Adapters: spike checklist, then claude/agy/cursor adapters + contract tests
- [x] Phase 3 — Polish: self-healing resume, `unite digest`, install-to-PATH, live smoke test
- [x] Phase 4 — Room /plan mode + turn visibility: read-only tool policy, stream-json status line, honest ^C, /plan routing, MCP-off Claude seat, burst-merged input. Accepted 2026-09-06: six end-to-end checks pass on the AgentsUniteDesktop room (board post).

## Current phase
Phase 4 accepted and documented. First real-usage session watched live (2026-09-06): 87 messages, 54 agent turns, zero adapter failures, findings U1-U9 on the board. Next phase is the U-backlog, scheduled by Ted.

## Next
Work the U-backlog from the session-1 findings, cheapest first: U3/U4 are preamble text (list the slash commands; note @all works in planning mode); U2/U5/U8 are instruction-page lines (a mention costs a turn; share an image by file path; real turn times are 11-14s not 30-90s); U1 is the one code change (strip code spans and quotes in parseMentions, killing the citation-chain class); U9 adds a line to TOOL_POLICY. U6 (spec goes stale after the copy step) needs the scoped-write decision already on file. Any of these that change what a user types or sees must update the instruction page and bump the version per CLAUDE.md.

## Human
- Print `docs/instructions/AgentsUnite-Instructions.pdf` (v0.2.0) — also sent to you directly. Keep it by the keyboard for the monitored session.
- (done 2026-09-06) First monitored session ran; findings U1-U9 on the board. Record future sessions with `script -q -k -F .unite/sessions/<ts>.log unite` if you want the keystroke layer too.
- (done 2026-09-06) Live plan-mode write test run — see board finding F-PM1: the Claude seat read-only guarantee is model-enforced, not a hard gate.
- Decide /who liveness: implement a liveness marker or amend the spec wording (final review #10)
- Acknowledge: cursor seat runs with --trust (auto-trusts the project dir for headless cursor calls; read-only still enforced by --mode plan)

## Decisions
- Plan Task 10 (cooked-mode input) CLOSED as not needed, 2026-09-06: 32 real messages up to 722 chars, many dictated, none containing an embedded newline and none fragmented. The burst merger stays (harmless, TTY-gated) but was not what prevented it. Reopen only if scrambling returns.

## Blockers
none

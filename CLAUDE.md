# AgentsUnite — project instructions

- **Instruction page rule.** `docs/instructions/AgentsUnite-Instructions.html` is the
  printable one-pager Ted keeps by the keyboard (PDF beside it). Any change to what a
  user types, sees, or configures — commands, keys, status line, room rules, config
  keys, user-facing messages — updates the page in the same PR, bumps `version` in
  `package.json` and the page footer together, and re-exports the PDF with
  `scripts/build-instructions.sh`. `test/instructions.test.js` fails the suite when
  commands, config keys, key messages, or the version drift. Rule text also lives in
  README "The crew's workflow". When writing a plan, put this in Global Constraints.
- Project state: `SPRINT.md`. Board: `COLLABORATION.md`. Specs and plans:
  `docs/superpowers/`. Ted's global protocols (commit trailers, SPRINT, spec markers)
  apply on top of this file.
- **Seat Architecture Reference:** In `AgentsUnite` (CLI), seats run as headless sub-processes (`gemini` -> `agy`, `claude` -> `claude`, `cursor` -> `cursor-agent`) strictly enforced in read-only plan mode. In `AgentsUniteDesktop`, `@gemini` automates consumer `Gemini.app` via macOS Accessibility (`AXUIElement`) because Gemini Desktop has no CLI/API. Lead planner can be changed on the fly via `/plan @<seat> <text>` or permanently via `.unite/config.json` (`"planner": "<seat>"`).

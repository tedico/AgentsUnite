#!/usr/bin/env node
import readline from 'node:readline';
import process from 'node:process';
import { parseArgv, parsePlanCommand, PLAN_USAGE } from '../lib/cli.js';
import { loadConfig } from '../lib/config.js';
import { ensureChat, listChats, latestChat } from '../lib/paths.js';
import { runRound, RoundControl, applyPolicyNotice, endPlanning } from '../lib/engine.js';
import { makeUi } from '../lib/ui.js';
import { claudeAdapter } from '../lib/adapters/claude.js';
import { agyAdapter } from '../lib/adapters/agy.js';
import { cursorAdapter } from '../lib/adapters/cursor.js';
import { appendDigest } from '../lib/digest.js';
import { readTranscript, lastError, appendRoundError, loadState } from '../lib/transcript.js';

const root = process.cwd();
const config = loadConfig(root);
const ui = makeUi();

const FACTORIES = { claude: claudeAdapter, gemini: agyAdapter, cursor: cursorAdapter };
const VALID_SEATS = Object.keys(FACTORIES);
for (const seat of config.roster) {
  if (!FACTORIES[seat]) {
    console.error(`unknown seat "${seat}" in config roster; valid seats: ${VALID_SEATS.join(', ')}`);
    process.exit(1);
  }
}
const adapters = Object.fromEntries(config.roster.map((seat) => [seat, FACTORIES[seat]({
  binary: config.binaries[seat],
  model: config.models[seat],
  timeoutMs: config.timeoutMs,
  mcp: config.mcp,
})]));

const { cmd, name } = parseArgv(process.argv.slice(2));

if (cmd === 'ls') {
  for (const c of listChats(root)) console.log(c);
  process.exit(0);
}

if (cmd === 'digest') {
  const target = name ?? latestChat(root);
  if (!target) { console.error('no chats to digest'); process.exit(1); }
  const md = appendDigest(root, target);
  console.log(md ? `digest of "${target}" appended to COLLABORATION.md` : `chat "${target}" is empty`);
  process.exit(0);
}

// One readline interface for the whole program's lifetime (G4 ruling: a
// throwaway interface created/closed before the main REPL exists can
// pause/terminate process.stdin on some Node environments). The resume
// chat picker below uses this same interface via a promisified question().
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: ui.prompt() });
const question = (q) => new Promise((res) => rl.question(q, res));

let activeControl = null;
let sigints = 0;
let pickerActive = false;

// Registered immediately after rl exists, before any picker: while a
// question() is pending there are otherwise zero 'SIGINT' listeners, which
// makes Node auto-pause the stream with no way to resume it (F2).
rl.on('SIGINT', () => {
  if (pickerActive) {
    console.log();
    process.exit(0);
  } else if (activeControl) {
    sigints++;
    if (sigints === 1) { ui.printSystem('(skipping current turn — ^C again to drain the queue)'); activeControl.skipTurn(); }
    else activeControl.drain();
  } else {
    ui.printSystem('(/quit to exit)');
    rl.prompt();
  }
});

let chatName;
if (cmd === 'new') {
  chatName = name;
} else if (cmd === 'resume') {
  const chats = listChats(root);
  if (chats.length === 0) { console.error('no chats yet — run: unite new <name>'); process.exit(1); }
  chats.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
  pickerActive = true;
  const answer = await question(`chat number [1]: `);
  pickerActive = false;
  chatName = chats[(parseInt(answer, 10) || 1) - 1] ?? chats[0];
} else {
  chatName = latestChat(root) ?? 'main';
}
const dir = ensureChat(root, chatName);

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

rl.on('close', () => { console.log(); process.exit(0); });
rl.prompt();

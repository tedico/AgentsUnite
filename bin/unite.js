#!/usr/bin/env node
import readline from 'node:readline';
import process from 'node:process';
import { parseArgv } from '../lib/cli.js';
import { loadConfig } from '../lib/config.js';
import { ensureChat, listChats, latestChat, chatDir } from '../lib/paths.js';
import { runRound, RoundControl } from '../lib/engine.js';
import { makeUi } from '../lib/ui.js';
import { claudeAdapter } from '../lib/adapters/claude.js';
import { agyAdapter } from '../lib/adapters/agy.js';
import { cursorAdapter } from '../lib/adapters/cursor.js';
import { appendDigest } from '../lib/digest.js';
import { readTranscript, lastError } from '../lib/transcript.js';

const root = process.cwd();
const config = loadConfig(root);
const ui = makeUi();

const FACTORIES = { claude: claudeAdapter, gemini: agyAdapter, cursor: cursorAdapter };
const adapters = Object.fromEntries(config.roster.map((seat) => [seat, FACTORIES[seat]({
  binary: config.binaries[seat],
  model: config.models[seat],
  timeoutMs: config.timeoutMs,
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

let chatName;
if (cmd === 'new') {
  chatName = name;
} else if (cmd === 'resume') {
  const chats = listChats(root);
  if (chats.length === 0) { console.error('no chats yet — run: unite new <name>'); process.exit(1); }
  chats.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
  const answer = await question(`chat number [1]: `);
  chatName = chats[(parseInt(answer, 10) || 1) - 1] ?? chats[0];
} else {
  chatName = latestChat(root) ?? 'main';
}
const dir = ensureChat(root, chatName);

console.log(`unite — chat "${chatName}" — roster: ${config.roster.map((s) => '@' + s).join(' ')} (@all)`);
console.log('mention someone to get a reply; /who /last /last-error /quit\n');

let activeControl = null;
let sigints = 0;

rl.on('SIGINT', () => {
  if (activeControl) {
    sigints++;
    if (sigints === 1) { ui.printSystem('(skipping current turn — ^C again to drain the queue)'); activeControl.skipTurn(); }
    else activeControl.drain();
  } else {
    ui.printSystem('(/quit to exit)');
    rl.prompt();
  }
});

rl.on('line', async (line) => {
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
  activeControl = new RoundControl();
  sigints = 0;
  rl.pause();
  try {
    await runRound({ humanText: text, dir, adapters, config, ui, control: activeControl });
  } finally {
    activeControl = null;
    rl.resume();
    rl.prompt();
  }
});

rl.on('close', () => { console.log(); process.exit(0); });
rl.prompt();

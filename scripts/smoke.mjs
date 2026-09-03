// Live smoke: two-round memory test per installed seat + spike checklist.
// Run by hand: node scripts/smoke.mjs [seat...]   (default: all three)
import { claudeAdapter } from '../lib/adapters/claude.js';
import { agyAdapter } from '../lib/adapters/agy.js';
import { cursorAdapter } from '../lib/adapters/cursor.js';
import { loadConfig } from '../lib/config.js';

const config = loadConfig(process.cwd());
const FACTORIES = { claude: claudeAdapter, gemini: agyAdapter, cursor: cursorAdapter };
const seats = process.argv.slice(2).length ? process.argv.slice(2) : config.roster;

for (const seat of seats) {
  const a = FACTORIES[seat]({ binary: config.binaries[seat], timeoutMs: config.timeoutMs });
  console.log(`\n=== ${seat} (${config.binaries[seat]}) ===`);
  const r1 = await a.invoke({ prompt: 'Remember the codeword "walnut". Reply only: OK', sessionRef: null });
  console.log('round 1:', r1.ok ? `OK (session ${r1.sessionRef})` : `FAIL: ${r1.error}\n${r1.stderr}`);
  if (!r1.ok) continue;
  const r2 = await a.invoke({ prompt: 'What was the codeword? Reply with just it.', sessionRef: r1.sessionRef });
  const remembered = r2.ok && /walnut/i.test(r2.replyText);
  console.log('round 2 (resume):', r2.ok ? (remembered ? 'MEMORY OK' : `NO MEMORY — got: ${r2.replyText}`) : `FAIL: ${r2.error}\n${r2.stderr}`);
}
console.log('\nSpike checklist: round-2 MEMORY OK for gemini proves --conversation resume; ' +
  'for cursor proves --resume + chat-id capture. Any FAIL: check errors above, adjust adapter, re-run.');

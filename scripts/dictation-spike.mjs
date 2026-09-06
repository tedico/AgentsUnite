#!/usr/bin/env node
// Spike 4 (throwaway, keep for re-runs): what does the terminal deliver while
// Ted dictates? Raw-mode hex dump of stdin with flags for the things the fix
// depends on. Run: node scripts/dictation-spike.mjs → dictate one long
// sentence with a correction → press Ctrl-C. Paste the output on the board.
import process from 'node:process';

const t0 = Date.now();
if (process.stdin.isTTY) process.stdin.setRawMode(true);
// Enable bracketed paste so a paste (if that is what dictation does) shows markers.
process.stdout.write('\x1b[?2004h');
process.on('exit', () => process.stdout.write('\x1b[?2004l'));

process.stdin.on('data', (d) => {
  const flags = [];
  if (d.includes('\x1b[200~')) flags.push('PASTE-START');
  if (d.includes('\x1b[201~')) flags.push('PASTE-END');
  if (d.includes(0x0a) || d.includes(0x0d)) flags.push('NEWLINE');
  if (d.includes(0x7f) || d.includes(0x08)) flags.push('BACKSPACE');
  if (d.includes('\x1b[D') || d.includes('\x1b[C')) flags.push('CURSOR-MOVE');
  const hex = [...d].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  console.log(`[+${Date.now() - t0}ms ${d.length}B ${flags.join(' ') || '-'}] ${hex}`);
  if (d.includes(0x03)) { console.log('[ctrl-c] done'); process.exit(0); }
});
process.stdin.on('end', () => process.exit(0));
console.log('dictate one long sentence now (include a correction); Ctrl-C to finish');

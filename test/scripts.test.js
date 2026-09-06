import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runHeadless } from '../lib/proc.js';

const SPIKE = fileURLToPath(new URL('../scripts/dictation-spike.mjs', import.meta.url));

test('dictation spike flags newline, backspace and paste markers in piped input, exits on ^C byte', async () => {
  const r = await runHeadless({
    cmd: process.execPath,
    args: [SPIKE],
    stdinText: 'hel\x7flo\nworld \x1b[200~pasted\x1b[201~\x03',
    timeoutMs: 5000,
  });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /BACKSPACE/);
  assert.match(r.stdout, /NEWLINE/);
  assert.match(r.stdout, /PASTE-START/);
  assert.match(r.stdout, /PASTE-END/);
  assert.match(r.stdout, /\[ctrl-c\] done/);
  assert.match(r.stdout, /68 65 6c 7f 6c 6f/); // hex of "hel<DEL>lo"
});

test('dictation spike exits cleanly when stdin just ends', async () => {
  const r = await runHeadless({ cmd: process.execPath, args: [SPIKE], stdinText: 'abc', timeoutMs: 5000 });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /61 62 63/);
});

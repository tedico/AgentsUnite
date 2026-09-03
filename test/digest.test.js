import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderDigest, appendDigest } from '../lib/digest.js';
import { ensureChat } from '../lib/paths.js';
import { appendMessage } from '../lib/transcript.js';

test('renderDigest produces a labeled markdown section', () => {
  const md = renderDigest('plan', [
    { ts: 't', from: 'ted', text: 'decision: use pipeline', mentions: [] },
    { ts: 't', from: 'claude', text: 'agreed\nsecond line', mentions: [] },
  ], '2026-09-02');
  assert.match(md, /## Chat digest: plan \(2026-09-02\)/);
  assert.match(md, /\*\*ted\*\*: decision: use pipeline/);
  assert.match(md, /\*\*claude\*\*: agreed\n {2}second line/);
});

test('appendDigest appends to COLLABORATION.md; null for empty chat', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unite-dig-'));
  fs.writeFileSync(path.join(root, 'COLLABORATION.md'), '# Hub\n');
  const dir = ensureChat(root, 'plan');
  assert.equal(appendDigest(root, 'empty-chat'), null);
  appendMessage(dir, { ts: 't', from: 'ted', text: 'ship it', mentions: [] });
  const rendered = appendDigest(root, 'plan');
  const hub = fs.readFileSync(path.join(root, 'COLLABORATION.md'), 'utf8');
  assert.ok(hub.startsWith('# Hub\n'));
  assert.ok(hub.includes(rendered));
});

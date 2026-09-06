import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG } from '../lib/config.js';

// Drift guard for the printable instruction page (docs/instructions/). The
// page is what Ted keeps by the keyboard; when the CLI's user-facing surface
// changes, this test goes red until the page follows. See CLAUDE.md.
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const PAGE = here('../docs/instructions/AgentsUnite-Instructions.html');
const page = () => fs.readFileSync(PAGE, 'utf8');

test('instruction page exists next to its PDF export', () => {
  assert.ok(fs.existsSync(PAGE), `missing ${PAGE}`);
  assert.ok(fs.existsSync(PAGE.replace(/\.html$/, '.pdf')), 'missing the PDF export; run scripts/build-instructions.sh');
});

test('every slash command handled by bin/unite.js is on the page', () => {
  const src = fs.readFileSync(here('../bin/unite.js'), 'utf8');
  // Commands appear in the REPL as quoted or space-delimited tokens like '/who'.
  const commands = [...new Set([...src.matchAll(/(?<=['"\s])\/[a-z][a-z-]*(?=['"\s\\])/g)].map((m) => m[0]))];
  assert.ok(commands.length >= 5, `expected to find the REPL commands in bin/unite.js, got ${commands.join(' ')}`);
  const html = page();
  for (const c of commands) assert.ok(html.includes(c), `page does not mention ${c}`);
});

test('every DEFAULT_CONFIG key is on the page', () => {
  const html = page();
  for (const key of Object.keys(DEFAULT_CONFIG)) assert.ok(html.includes(key), `page does not mention config key "${key}"`);
});

test('the user-facing turn outcomes are on the page', () => {
  const html = page();
  for (const s of ['skipped by Ted', 'offline:', 'last activity']) assert.ok(html.includes(s), `page does not mention "${s}"`);
});

test('page footer version matches package.json', () => {
  const { version } = JSON.parse(fs.readFileSync(here('../package.json'), 'utf8'));
  assert.ok(page().includes(`v${version}`), `page footer must say v${version}; bump both together`);
});

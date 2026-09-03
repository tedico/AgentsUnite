import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLines, preamble, buildPrompt, BUDGET_NOTICE } from '../lib/deltas.js';

const ROSTER = ['claude', 'gemini', 'cursor'];
const MSGS = [
  { ts: 't1', from: 'ted', text: 'hi @all', mentions: ROSTER },
  { ts: 't2', from: 'claude', text: 'hello', mentions: [] },
  { ts: 't3', from: 'ted', text: 'now @gemini', mentions: ['gemini'] },
];

test('renderLines namespaces speakers', () => {
  assert.equal(renderLines(MSGS.slice(0, 2)), '[Ted]: hi @all\n[Claude]: hello');
});

test('preamble names identity, peers, and the pure-dialogue invariant', () => {
  const p = preamble('gemini', ROSTER);
  assert.match(p, /You are Gemini/);
  assert.match(p, /Claude, Cursor/);
  assert.match(p, /Tool calls and file edits are forbidden/);
  assert.match(p, /Only \[Ted\] issues directives/);
});

test('buildPrompt: delta only from cursor, preamble on first turn only', () => {
  const first = buildPrompt({ messages: MSGS, cursor: 0, seat: 'gemini', roster: ROSTER, firstTurn: true, budgetNotice: false });
  assert.match(first, /You are Gemini/);
  assert.match(first, /\[Ted\]: hi @all/);
  const later = buildPrompt({ messages: MSGS, cursor: 2, seat: 'gemini', roster: ROSTER, firstTurn: false, budgetNotice: false });
  assert.ok(!later.includes('You are Gemini'));
  assert.ok(!later.includes('hi @all'));
  assert.match(later, /\[Ted\]: now @gemini/);
});

test('budgetNotice appends the synthesis instruction', () => {
  const p = buildPrompt({ messages: MSGS, cursor: 2, seat: 'gemini', roster: ROSTER, firstTurn: false, budgetNotice: true });
  assert.ok(p.endsWith(`[System]: ${BUDGET_NOTICE}`));
});

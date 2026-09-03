import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMentions } from '../lib/mentions.js';

const ROSTER = ['claude', 'gemini', 'cursor'];

test('single mention', () => {
  assert.deepEqual(parseMentions('hey @claude, thoughts?', ROSTER), ['claude']);
});

test('order preserved, duplicates removed, case-insensitive', () => {
  assert.deepEqual(parseMentions('@Gemini then @claude then @gemini', ROSTER), ['gemini', 'claude']);
});

test('@all expands to roster order', () => {
  assert.deepEqual(parseMentions('@all weigh in', ROSTER), ['claude', 'gemini', 'cursor']);
});

test('@all merges with explicit mentions without duplicates', () => {
  assert.deepEqual(parseMentions('@cursor first, then @all', ROSTER), ['cursor', 'claude', 'gemini']);
});

test('unknown mentions and no mentions', () => {
  assert.deepEqual(parseMentions('@ted @bob nothing', ROSTER), []);
  assert.deepEqual(parseMentions('just a note', ROSTER), []);
});

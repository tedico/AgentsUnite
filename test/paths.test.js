import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chatDir, ensureChat, listChats, latestChat } from '../lib/paths.js';

function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'unite-root-')); }

test('chatDir builds .unite/chats/<name>', () => {
  assert.equal(chatDir('/r', 'main'), path.join('/r', '.unite', 'chats', 'main'));
});

test('ensureChat creates the directory', () => {
  const root = tmpRoot();
  const dir = ensureChat(root, 'plan');
  assert.ok(fs.statSync(dir).isDirectory());
});

test('listChats orders by transcript mtime, latestChat picks first', () => {
  const root = tmpRoot();
  const a = ensureChat(root, 'older'); const b = ensureChat(root, 'newer');
  fs.writeFileSync(path.join(a, 'transcript.jsonl'), '{}\n');
  fs.writeFileSync(path.join(b, 'transcript.jsonl'), '{}\n');
  fs.utimesSync(path.join(a, 'transcript.jsonl'), new Date(0), new Date(0));
  assert.deepEqual(listChats(root), ['newer', 'older']);
  assert.equal(latestChat(root), 'newer');
  assert.equal(latestChat(tmpRoot()), null);
});

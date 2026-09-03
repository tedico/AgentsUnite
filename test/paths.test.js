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

test('ensureChat writes a self-ignoring .unite/.gitignore (F6)', () => {
  const root = tmpRoot();
  ensureChat(root, 'plan');
  const giPath = path.join(root, '.unite', '.gitignore');
  assert.equal(fs.readFileSync(giPath, 'utf8'), '*\n');
  // idempotent: a second ensureChat call (e.g. a later session) doesn't error
  // and leaves the content untouched.
  ensureChat(root, 'plan');
  assert.equal(fs.readFileSync(giPath, 'utf8'), '*\n');
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

test('chatDir and ensureChat reject path traversal in the chat name', () => {
  const root = tmpRoot();
  const bad = '../../evil';
  assert.throws(() => chatDir(root, bad), /invalid chat name "\.\.\/\.\.\/evil"/);
  assert.throws(() => ensureChat(root, bad), /invalid chat name "\.\.\/\.\.\/evil"/);
  assert.ok(!fs.existsSync(path.join(root, 'evil')));
  assert.ok(!fs.existsSync(path.join(root, '.unite', 'chats', '..', '..', 'evil')));
});

test('legal dotted chat names are accepted', () => {
  const root = tmpRoot();
  const dir = ensureChat(root, 'notes.v1');
  assert.equal(dir, path.join(root, '.unite', 'chats', 'notes.v1'));
  assert.ok(fs.statSync(dir).isDirectory());
});

test('chat names "." and ".." are rejected', () => {
  const root = tmpRoot();
  const dotMsg = /invalid chat name "\."; must match .* and cannot be "\." or "\.\."/;
  const dotDotMsg = /invalid chat name "\.\."; must match .* and cannot be "\." or "\.\."/;
  assert.throws(() => chatDir(root, '.'), dotMsg);
  assert.throws(() => chatDir(root, '..'), dotDotMsg);
  assert.throws(() => ensureChat(root, '.'), dotMsg);
  assert.throws(() => ensureChat(root, '..'), dotDotMsg);
});

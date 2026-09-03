import fs from 'node:fs';
import path from 'node:path';

export const UNITE_DIR = '.unite';

export function chatDir(root, name) {
  return path.join(root, UNITE_DIR, 'chats', name);
}

export function ensureChat(root, name) {
  const dir = chatDir(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function transcriptMtime(dir) {
  try { return fs.statSync(path.join(dir, 'transcript.jsonl')).mtimeMs; }
  catch { return 0; }
}

export function listChats(root) {
  const base = path.join(root, UNITE_DIR, 'chats');
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => transcriptMtime(chatDir(root, b)) - transcriptMtime(chatDir(root, a)));
}

export function latestChat(root) {
  return listChats(root)[0] ?? null;
}

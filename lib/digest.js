import fs from 'node:fs';
import path from 'node:path';
import { chatDir } from './paths.js';
import { readTranscript } from './transcript.js';

export function renderDigest(name, messages, date) {
  const lines = ['', '---', '', `## Chat digest: ${name} (${date})`, ''];
  for (const m of messages) {
    lines.push(`- **${m.from}**: ${m.text.replace(/\n/g, '\n  ')}`);
  }
  return lines.join('\n') + '\n';
}

export function appendDigest(root, name) {
  const messages = readTranscript(chatDir(root, name));
  if (messages.length === 0) return null;
  const md = renderDigest(name, messages, new Date().toISOString().slice(0, 10));
  fs.appendFileSync(path.join(root, 'COLLABORATION.md'), md);
  return md;
}

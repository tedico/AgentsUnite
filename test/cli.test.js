import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgv } from '../lib/cli.js';

const UNITE = fileURLToPath(new URL('../bin/unite.js', import.meta.url));

function runUnite(cwd, args, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [UNITE, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

test('argv dispatch', () => {
  assert.deepEqual(parseArgv([]), { cmd: 'open', name: null });
  assert.deepEqual(parseArgv(['new', 'sprint']), { cmd: 'new', name: 'sprint' });
  assert.deepEqual(parseArgv(['new']), { cmd: 'new', name: 'main' });
  assert.deepEqual(parseArgv(['resume']), { cmd: 'resume', name: null });
  assert.deepEqual(parseArgv(['ls']), { cmd: 'ls', name: null });
  assert.deepEqual(parseArgv(['digest', 'sprint']), { cmd: 'digest', name: 'sprint' });
  assert.deepEqual(parseArgv(['digest']), { cmd: 'digest', name: null });
});

test('unknown roster seat in config fails fast with a clean error, even for ls', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unite-c1-'));
  fs.mkdirSync(path.join(root, '.unite'), { recursive: true });
  fs.writeFileSync(path.join(root, '.unite', 'config.json'),
    JSON.stringify({ roster: ['claude', 'gpt'] }));
  const { code, stdout, stderr } = await runUnite(root, ['ls']);
  assert.equal(code, 1);
  assert.match(stderr, /unknown seat "gpt" in config roster; valid seats: claude, gemini, cursor/);
  assert.doesNotMatch(stderr, /TypeError/);
  assert.doesNotMatch(stderr, /^\s+at /m);
  assert.doesNotMatch(stdout, /TypeError/);
});

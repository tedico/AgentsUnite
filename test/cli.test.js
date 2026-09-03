import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgv } from '../lib/cli.js';

test('argv dispatch', () => {
  assert.deepEqual(parseArgv([]), { cmd: 'open', name: null });
  assert.deepEqual(parseArgv(['new', 'sprint']), { cmd: 'new', name: 'sprint' });
  assert.deepEqual(parseArgv(['new']), { cmd: 'new', name: 'main' });
  assert.deepEqual(parseArgv(['resume']), { cmd: 'resume', name: null });
  assert.deepEqual(parseArgv(['ls']), { cmd: 'ls', name: null });
  assert.deepEqual(parseArgv(['digest', 'sprint']), { cmd: 'digest', name: 'sprint' });
  assert.deepEqual(parseArgv(['digest']), { cmd: 'digest', name: null });
});

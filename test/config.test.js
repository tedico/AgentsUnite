import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, DEFAULT_CONFIG } from '../lib/config.js';

test('defaults when no config file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unite-cfg-'));
  const cfg = loadConfig(root);
  assert.deepEqual(cfg, DEFAULT_CONFIG);
  assert.equal(cfg.binaries.gemini, 'agy');
  assert.equal(cfg.turnCap, 8);
});

test('user config shallow-merges, binaries/models deep-merge', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unite-cfg-'));
  fs.mkdirSync(path.join(root, '.unite'), { recursive: true });
  fs.writeFileSync(path.join(root, '.unite', 'config.json'),
    JSON.stringify({ turnCap: 4, binaries: { gemini: '/opt/agy' } }));
  const cfg = loadConfig(root);
  assert.equal(cfg.turnCap, 4);
  assert.equal(cfg.binaries.gemini, '/opt/agy');
  assert.equal(cfg.binaries.claude, 'claude');
});

test('roster is a fresh copy, not shared with DEFAULT_CONFIG', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unite-cfg-'));
  const cfg = loadConfig(root);
  assert.notEqual(cfg.roster, DEFAULT_CONFIG.roster);
  assert.deepEqual(cfg.roster, DEFAULT_CONFIG.roster);
  cfg.roster.push('new-agent');
  assert.ok(!DEFAULT_CONFIG.roster.includes('new-agent'));
});

test('room defaults: MCP off for the claude seat, claude is the default planner', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unite-cfg-'));
  const cfg = loadConfig(root);
  assert.equal(cfg.mcp, false);
  assert.equal(cfg.planner, 'claude');
  fs.mkdirSync(path.join(root, '.unite'), { recursive: true });
  fs.writeFileSync(path.join(root, '.unite', 'config.json'), JSON.stringify({ mcp: true, planner: 'gemini' }));
  const over = loadConfig(root);
  assert.equal(over.mcp, true);
  assert.equal(over.planner, 'gemini');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { acquireAccountLock } from '../src/tg-gateway/lock.js';
import { watchPolicy } from '../src/tg-gateway/watch.js';
import { exampleConfig } from '../src/tg-gateway/index.js';
async function temp(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tg-state-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }
test('Telegram lock release never unlinks a replaced ownership file', async t => {
  const dir = await temp(t), release = await acquireAccountLock(dir), file = path.join(dir, 'runtime.lock');
  await assert.rejects(acquireAccountLock(dir), /tg_account_locked/);
  await fs.unlink(file); await fs.writeFile(file, 'replacement', { flag: 'wx', mode: 0o600 });
  await assert.rejects(release(), /tg_lock_changed/); assert.equal(await fs.readFile(file, 'utf8'), 'replacement');
});
test('Telegram policy reload applies access fields, preserves runtime model and retains last valid policy', async t => {
  const dir = await temp(t), file = path.join(dir, 'config.json'), config = { ...structuredClone(exampleConfig), botId: '123' }; config.access.owner = '7';
  const newer = structuredClone(config); newer.access.private.tools = 'all'; newer.model = { provider: 'different', id: 'restart-required' };
  await fs.writeFile(file, JSON.stringify(newer)); let state; const logs = [];
  const stop = await watchPolicy({ file, config, apply: s => { state = s; }, isClosed: () => false, log: c => logs.push(c), interval: 5 }); t.after(stop);
  assert.equal(state.config.access.private.tools, 'all'); assert.equal(state.config.model, null);
  const invalid = structuredClone(newer); invalid.botId = '999'; await fs.writeFile(file, JSON.stringify(invalid)); await sleep(30);
  assert.ok(logs.includes('tg_policy_reload_failed')); assert.equal(state.config.botId, '123');
  newer.access.private.tools = 'none'; await fs.writeFile(file, JSON.stringify(newer));
  for (let i = 0; i < 30 && state.config.access.private.tools !== 'none'; i++) await sleep(5);
  assert.equal(state.config.access.private.tools, 'none');
});

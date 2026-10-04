import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exampleConfig, validateConfig, loadCredentials, publicError } from '../src/tg-gateway/index.js';
import { setupTelegram, collectIdentities } from '../src/tg-gateway/setup.js';
import { resolveCommand } from '../src/cli/index.js';
import { runServicePlan } from '../src/cli/service.js';
import { registerTelegramExtension } from '../src/tg-gateway/extension.js';
const token = '123:' + 'x'.repeat(30);
function config() { const c = structuredClone(exampleConfig); c.botId = '123'; c.access.owner = '7'; return c; }
async function temp(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tg-config-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return path.join(dir, 'config.json'); }
test('Telegram config validates ownership, policies, IDs, webhook loopback and HTTPS', () => {
  assert.equal(validateConfig(config()).botId, '123');
  for (const mutate of [c => { c.access.owner = null; }, c => { c.access.private.tools = 'unsafe'; }, c => { c.access.admins = ['ou_lark']; }, c => { c.botId = '-123'; }, c => { c.model = { provider: '', id: '' }; }]) {
    const c = config(); mutate(c); assert.throws(() => validateConfig(c), /invalid_config/);
  }
  const c = config(); c.transport = 'webhook'; c.webhook = { host: '127.0.0.1', port: 8081, path: '/tg', url: 'https://example.com/tg' }; validateConfig(c);
  c.webhook.host = '0.0.0.0'; assert.throws(() => validateConfig(c), /webhook/);
});
test('Telegram credentials enforce permissions, token identity and environment precedence', async t => {
  const file = await temp(t), c = config(); c.credentialsFile = 'credentials-test.json';
  const secretFile = path.join(path.dirname(file), c.credentialsFile);
  await fs.writeFile(secretFile, JSON.stringify({ token }), { mode: 0o600 });
  assert.equal((await loadCredentials(c, file, {})).token, token);
  await fs.chmod(secretFile, 0o644); await assert.rejects(loadCredentials(c, file, {}), /tg_credentials_permissions/);
  assert.equal((await loadCredentials(c, file, { TELEGRAM_BOT_TOKEN: token })).token, token);
  await assert.rejects(loadCredentials(c, file, { TELEGRAM_BOT_TOKEN: '124:' + 'x'.repeat(30) }), /tg_credentials_invalid/);
  assert.ok(!publicError(new Error('https://api.telegram.org/bot' + token)).includes(token));
});
test('Telegram wizard masks secret, saves 0600 and does not call incomplete owner configuration ready', async t => {
  const file = await temp(t), answers = [token, 'polling', '', 'n']; let hidden = false;
  const ready = await setupTelegram({ file, say() {}, ask: async (_label, secret) => { if (secret) hidden = true; return answers.shift(); }, probe: () => ({ async probe() {}, async close() {} }) });
  assert.equal(ready, false); assert.equal(hidden, true);
  const saved = JSON.parse(await fs.readFile(file)); assert.equal(saved.access.owner, null);
  assert.equal(saved.access.private.tools, 'none'); assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.join(path.dirname(file), saved.credentialsFile))).mode & 0o777, 0o600);
  assert.ok(!(await fs.readFile(file, 'utf8')).includes(token));
});
test('Telegram owner discovery requires selecting and confirming a received private identity', async t => {
  const file = await temp(t), c = config(); c.access.owner = null; await fs.writeFile(file, JSON.stringify(c));
  let closed = 0; const answers = ['', '0', 'y'];
  const ready = await collectIdentities({ file, say() {}, ask: async () => answers.shift(), start: async ({ onIdentity }) => {
    onIdentity({ Telegram: { chat_id: '8', chat_type: 'private', sender: { user_id: '8' } } }); return { async close() { closed++; } };
  } });
  assert.equal(ready, true); assert.equal(closed, 1); assert.equal(JSON.parse(await fs.readFile(file)).access.owner, '8');
});
test('Telegram discovery without events leaves configuration untouched', async t => {
  const file = await temp(t), c = config(), original = JSON.stringify(c); await fs.writeFile(file, original);
  assert.equal(await collectIdentities({ file, say() {}, ask: async () => '', start: async () => ({ async close() {} }) }), false);
  assert.equal(await fs.readFile(file, 'utf8'), original);
});
test('Telegram unified CLI keeps explicit config in foreground and uses deferred restart path', async () => {
  const plan = await resolveCommand(['tg', 'start', '--foreground', '--config', '/tmp/tg-test.json']);
  assert.equal(plan.script, 'bin/pi-tg-gateway.js');
  assert.equal(await runServicePlan(plan), false); assert.deepEqual(plan.args, ['start', '--config', '/tmp/tg-test.json']);
  assert.equal(await runServicePlan({ platform: 'tg', args: ['restart'] }), false);
  assert.equal((await resolveCommand(['tg', 'webhook-register'])).args[0], 'webhook-register');
});
test('Telegram Pi extension has no load-time side effects and rejects remote noninteractive commands', async () => {
  let command, shutdown, starts = 0, stops = 0;
  registerTelegramExtension({ registerCommand(_name, value) { command = value; }, on(_name, fn) { shutdown = fn; } }, async () => { starts++; return { status: () => 'running', async close() { stops++; } }; });
  assert.equal(starts, 0); await command.handler('start', { hasUI: false }); assert.equal(starts, 0);
  const ctx = { hasUI: true, ui: { notify() {} } }; await command.handler('start', ctx); await command.handler('start', ctx);
  assert.equal(starts, 1); await shutdown(); assert.equal(stops, 1);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeConfig, validateConfig, admit, isAdmin, writeJson, migrateConfig, loadConfig, openPolicy } from '../src/config/index.js';
const credentials = { appId: 'cli_test', domain: 'feishu', appSecret: 'fake-test-secret', ownerOpenId: 'owner' };
const event = (id = 'visitor') => ({ sender: { sender_type: 'user', sender_id: { open_id: id } }, message: { chat_id: 'group1', chat_type: 'group' } });
test('defaults require approval and mentions, tools disabled', () => {
  const config = makeConfig(credentials);
  assert.equal(admit(event(), { config, groups: {} }), false);
  assert.equal(config.access.groups.trigger, 'mention');
  for (const p of [config.access.private, config.access.groups]) {
    assert.equal(p.users, 'allowlist'); assert.equal(p.onUnknown, 'ask_owner'); assert.equal(p.tools, 'none');
  }
  assert.equal(isAdmin(config, 'visitor'), false);
  assert.equal(isAdmin(config, 'owner'), true);
  config.access.admins.push('admin'); assert.equal(isAdmin(config, 'admin'), true);
});
test('existing v2 explicit tool policies survive migration', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gateway-config-'));
  try {
    const file = path.join(dir, 'config.json');
    const config = makeConfig(credentials);
    config.access.private.tools = 'all'; config.access.groups.tools = 'all';
    await writeJson(file, config);
    assert.deepEqual(await migrateConfig(file), config);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), config);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('allowlist, disabled group, mention and per-group overrides', () => {
  const config = makeConfig(credentials); const state = { config, groups: {} };
  config.access.groups.users = 'allowlist'; config.access.groups.trigger = 'all';
  assert.equal(admit(event(), state), false);
  assert.equal(admit(event('owner'), state), true);
  state.groups.group1 = openPolicy(); assert.equal(admit(event(), state), true);
  state.groups.group1.enabled = false; assert.equal(admit(event('owner'), state), false);
  state.groups.group1.enabled = true; state.groups.group1.trigger = 'mention';
  assert.equal(admit(event(), state), false);
  config.bot.openId = 'bot'; const e = event(); e.message.mentions = [{ id: { open_id: 'bot' } }];
  assert.equal(admit(e, state), true);
  e.message.mentions = []; e.message.root_id = 'root'; assert.equal(admit(e, state), false);
});
test('validation rejects unsupported tools and bad policy', () => {
  const c = makeConfig(credentials); c.access.groups.tools = 'bash';
  assert.throws(() => validateConfig(c));
  c.access.groups.tools = 'none'; c.access.groups.users = 'anyone'; assert.throws(() => validateConfig(c));
});
test('v1 migration separates secret and preserves effective open policy', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gateway-config-')); const file = path.join(dir, 'config.json');
  try {
    await writeJson(file, { version: 1, lark: credentials, access: { allowedUsers: ['owner'] } });
    await migrateConfig(file); const { config, secret } = await loadConfig(file);
    assert.equal(config.access.owner, 'owner'); assert.equal(secret.appSecret, credentials.appSecret);
    assert.equal(config.access.groups.users, 'all');
    assert.ok(!(await readFile(file, 'utf8')).includes(credentials.appSecret));
    assert.equal((await stat(path.join(dir, config.bot.credentialsFile))).mode & 0o777, 0o600);
    assert.deepEqual(await migrateConfig(file), config);
    await writeJson(path.join(dir, 'groups.json'), { version: 1, groups: { bad: {} } });
    await assert.rejects(loadConfig(file));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

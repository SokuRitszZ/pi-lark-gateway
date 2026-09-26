import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PERMISSIONS, permissionsGuide, permissionsJson } from '../src/onboarding/permissions.js';
import { finishSetup } from '../src/onboarding/finish.js';

const root = fileURLToPath(new URL('../', import.meta.url));
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gateway-permissions-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('recommended application scopes cover current features without sensitive or unrelated extras', () => {
  const data = permissionsJson();
  assert.deepEqual(data.scopes.tenant, [
    'im:message.p2p_msg:readonly', 'im:message.group_at_msg:readonly', 'im:message:send_as_bot',
    'im:message.reactions:write_only', 'im:chat:read', 'cardkit:card:write',
  ]);
  assert.deepEqual(data.scopes.user, []);
  assert.equal(new Set(data.scopes.tenant).size, data.scopes.tenant.length);
  assert.equal(PERMISSIONS.filter(item => item.level === '基础').length, 3);
  assert.equal(PERMISSIONS.find(item => item.scope === 'im:message.group_msg').level, '按需敏感');
  assert.ok(!data.scopes.tenant.includes('im:message.group_msg'));
  assert.ok(!data.scopes.tenant.includes('im:message'));
  assert.ok(!data.scopes.tenant.some(scope => /contact:|drive:|calendar:|im:resource/.test(scope)));
});
test('guide separates permissions from events and links the actual application safely', async () => {
  const guide = permissionsGuide('cli_fixture');
  assert.match(guide, /https:\/\/open.feishu.cn\/app\/cli_fixture\/auth/);
  for (const item of PERMISSIONS) assert.ok(guide.includes(item.scope));
  for (const text of ['im.message.receive_v1', 'card.action.trigger', '长连接', '发布', '审批', '可用范围', '不是用户 OAuth', '不申请或变更权限']) assert.ok(guide.includes(text));
  assert.doesNotMatch(permissionsGuide('cli_bad?private=value'), /cli_bad|private=value/);
  const docs = await fs.readFile(path.join(root, 'docs/PERMISSIONS.md'), 'utf8');
  for (const item of PERMISSIONS) assert.ok(docs.includes('`' + item.scope + '`'));
});
for (const ownerOpenId of ['ou_owner', null]) test(`shared QR/manual completion persists privately then prints setup gates, owner=${!!ownerOpenId}`, async t => {
  const directory = await temporary(t), configPath = path.join(directory, 'config.json'), output = [];
  await finishSetup({ configPath, credentials: { appId: 'cli_fixture', appSecret: 'DO_NOT_PRINT_THIS', ownerOpenId, domain: 'feishu' },
    startCommand: 'pi-lark-gateway start', output: line => output.push(line) });
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal((await fs.stat(configPath)).mode & 0o777, 0o600);
  assert.equal(config.access.private.tools, 'none'); assert.equal(config.access.groups.trigger, 'mention');
  assert.equal(config.access.private.users, 'allowlist');
  const rendered = output.join('\n');
  assert.doesNotMatch(rendered, /DO_NOT_PRINT_THIS/);
  assert.match(rendered, /cli_fixture\/auth/); assert.match(rendered, /cardkit:card:write/);
  assert.match(output.at(-1), /完成上述权限、事件\/回调、发布及可用范围检查后/);
  assert.match(output.at(-1), /pi-lark-gateway start/);
  assert.equal(rendered.includes('未取得用户 open_id'), ownerOpenId === null);
});
test('failed persistence does not claim onboarding or permission setup succeeded', async () => {
  const output = [];
  await assert.rejects(finishSetup({ configPath: 'unused', credentials: {}, startCommand: 'npm start',
    output: value => output.push(value), save: async () => { throw new Error('save_failed'); } }), /save_failed/);
  assert.deepEqual(output, []);
});
test('permission CLI modes are offline/read-only and work even with an existing config', async t => {
  const home = await temporary(t), config = path.join(home, 'config.json');
  await fs.writeFile(config, 'DO_NOT_READ_OR_OVERWRITE');
  const preload = path.join(home, 'offline.mjs');
  await fs.writeFile(preload, 'globalThis.fetch = () => { throw new Error("network_forbidden"); };');
  for (const mode of ['--permissions', '--permissions-json']) {
    const result = spawnSync(process.execPath, ['--import', preload, 'src/onboarding/index.js', 'setup', mode, '--config', config],
      { cwd: root, env: { ...process.env, HOME: home, PI_LARK_CONFIG: config }, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    if (mode === '--permissions-json') assert.deepEqual(JSON.parse(result.stdout), permissionsJson());
    else assert.match(result.stdout, /card.action.trigger/);
  }
  const cli = spawnSync(process.execPath, ['bin/pi-lark-gateway.js', 'setup', '--permissions-json'],
    { cwd: root, env: { ...process.env, HOME: home, PI_LARK_CONFIG: config }, encoding: 'utf8', timeout: 10000 });
  assert.equal(cli.status, 0, cli.stderr); assert.deepEqual(JSON.parse(cli.stdout), permissionsJson());
  assert.equal(await fs.readFile(config, 'utf8'), 'DO_NOT_READ_OR_OVERWRITE');
  assert.deepEqual((await fs.readdir(home)).sort(), ['config.json', 'offline.mjs']);
});

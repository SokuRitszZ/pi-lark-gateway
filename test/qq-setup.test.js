import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setupQQ } from '../src/qq-gateway/setup.js';
import { loadConfig, loadCredentials } from '../src/qq-gateway/config.js';

test('QQ setup saves private credentials and only grants selected verified identities', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qq-setup-'));
  t.after(() => fs.rm(dir, { force: true, recursive: true }));
  const file = path.join(dir, 'config.json'), output = [];
  const inputs = ['app', 'test-only-secret', '1', 'provider', 'model', '', '', '2', 'y'];
  let closed = false;
  await setupQQ({ file, ask: async () => inputs.shift(), say: text => output.push(text), start: async options => {
    assert.equal(await loadCredentials(await loadConfig(file, { discover: true }), file, {}), 'test-only-secret');
    options.onIdentity({ QQ: { chat_type: 'c2c', group_openid: null, sender: { user_openid: 'stranger' } } });
    options.onIdentity({ QQ: { chat_type: 'group', group_openid: 'group', sender: { member_openid: 'member' } } });
    return { close: async () => { closed = true; } };
  } });
  assert.equal(closed, true); assert.equal(inputs.length, 0);
  const config = await loadConfig(file);
  assert.deepEqual(config.access, { c2cUsers: [], groups: { group: ['member'] } });
  assert.equal(config.tools, 'none');
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.join(dir, config.credentialsFile))).mode & 0o777, 0o600);
  assert.ok(!output.join('').includes('test-only-secret'));
  assert.ok(!(await fs.readFile(file, 'utf8')).includes('test-only-secret'));
  assert.equal(await loadCredentials(config, file, { QQBOT_APP_SECRET: 'override' }), 'override');
  await fs.chmod(path.join(dir, config.credentialsFile), 0o644);
  await assert.rejects(loadCredentials(config, file, {}), /credentials_permissions/);
});
test('setup preserves existing configuration when overwrite is declined', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qq-setup-'));
  t.after(() => fs.rm(dir, { force: true, recursive: true }));
  const file = path.join(dir, 'config.json'); await fs.writeFile(file, '{}');
  await setupQQ({ file, ask: async () => 'n' });
  assert.equal(await fs.readFile(file, 'utf8'), '{}');
  await assert.rejects(loadCredentials({ credentialsFile: '../secret' }, file, {}));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRegistration } from '../src/onboarding/registration.js';
import { saveConfig } from '../src/config/index.js';

const init = { supported_auth_methods: ['client_secret'] };
const begin = { device_code: 'device-test', verification_uri_complete: 'https://accounts.feishu.cn/verify?code=test', interval: 1, expire_in: 20 };
const credentials = { client_id: 'cli_test', client_secret: 'test-only', user_info: { open_id: 'ou_test' } };
function fixture(replies) {
  let clock = 0;
  const calls = [];
  const client = createRegistration({ now: () => clock,
    wait: async ms => { clock += ms; },
    fetchImpl: async (url, options) => {
      calls.push({ url, fields: Object.fromEntries(options.body) });
      const data = replies.shift();
      assert.ok(data, 'unexpected request');
      return new Response(JSON.stringify(data), { status: data.error ? 400 : 200 });
    },
  });
  return { client, calls };
}
test('init → begin → pending HTTP 400 → credentials', async () => {
  const { client, calls } = fixture([init, begin, { error: 'authorization_pending' }, credentials]);
  const result = await client.poll(await client.begin());
  assert.equal(result.ownerOpenId, 'ou_test');
  assert.equal(result.appId, 'cli_test');
  assert.deepEqual(calls.map(c => c.fields.action), ['init', 'begin', 'poll', 'poll']);
  assert.equal(calls[1].fields.archetype, 'PersonalAgent');
});
test('rejects international tenant without switching hosts', async () => {
  const { client, calls } = fixture([init, begin, { error: 'authorization_pending', user_info: { tenant_brand: 'lark' } }, credentials]);
  await assert.rejects(client.poll(await client.begin()), /不支持国际版/);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.url.startsWith('https://accounts.feishu.cn/')));
});
test('rejects international domain and QR URLs', async () => {
  const { client, calls } = fixture([]);
  await assert.rejects(client.begin({ domain: 'lark' }), /仅支持国内飞书/);
  assert.equal(calls.length, 0);
  await assert.rejects(fixture([init, { ...begin, verification_uri_complete: 'https://accounts.larksuite.com/verify' }]).client.begin(), /拒绝/);
});
for (const error of ['access_denied', 'expired_token', 'invalid_client']) {
  test(`stops on ${error}`, async () => {
    const { client } = fixture([init, begin, { error }]);
    await assert.rejects(client.poll(await client.begin()));
  });
}
test('slow_down and timeout', async () => {
  const { client, calls } = fixture([init, { ...begin, expire_in: 2 }, { error: 'slow_down' }]);
  await assert.rejects(client.poll(await client.begin()), /超时/);
  assert.equal(calls.length, 3);
});
test('cancellation before polling', async () => {
  const { client } = fixture([init, begin]);
  const ticket = await client.begin();
  await assert.rejects(client.poll(ticket, { signal: AbortSignal.abort() }));
});
test('rejects unsupported environment and untrusted QR URL', async () => {
  await assert.rejects(fixture([{}]).client.begin(), /不支持扫码/);
  await assert.rejects(fixture([init, { ...begin, verification_uri_complete: 'https://feishu.cn.attacker.example/' }]).client.begin(), /拒绝/);
});
test('secure persistence, fail closed, no overwrite', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pi-lark-test-'));
  const file = path.join(dir, 'nested/config.json');
  try {
    await saveConfig(file, { appId: 'cli_test', appSecret: 'test-only', domain: 'feishu', ownerOpenId: null });
    const config = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(config.access.owner, null);
    assert.equal(config.access.private.users, 'allowlist');
    assert.equal(config.access.groups.trigger, 'mention');
    assert.equal(config.access.groups.onUnknown, 'ask_owner');
    assert.equal(config.bot.appSecret, undefined);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    await assert.rejects(saveConfig(file, {}), { code: 'EEXIST' });
    assert.equal(JSON.parse(await readFile(file, 'utf8')).bot.appId, 'cli_test');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

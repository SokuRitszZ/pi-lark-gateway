import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setupQQ, authorizeQQ } from '../src/qq-gateway/setup.js';
import { loadConfig } from '../src/qq-gateway/config.js';
import { publicError } from '../src/qq-gateway/errors.js';
import { UserCancelled, resolveCommand } from '../src/cli/index.js';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qq-authorize-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'config.json');
  const answers = ['app', 'fake-only-secret', '1', 'provider', 'model', 'n'];
  const result = await setupQQ({ file, ask: async () => answers.shift(), say() {}, start: () => assert.fail('discovery skipped') });
  assert.equal(result.ready, false, 'saving basic config is not a completed onboarding');
  return { file, dir };
}
test('authorize resumes empty allowlist without replacing credentials or unrelated settings', async t => {
  const { file, dir } = await fixture(t);
  const before = await loadConfig(file, { discover: true });
  const files = await fs.readdir(dir), answers = ['', '1', 'y'];
  let closed = false;
  const result = await authorizeQQ({ file, env: {}, say() {}, ask: async (_message, _secret, options) => {
    if (options?.kind === 'multiselect') assert.equal(closed, true);
    return answers.shift();
  }, start: async options => {
    assert.equal(options.discover, true); assert.deepEqual(options.env, {});
    options.onIdentity({ QQ: { chat_type: 'c2c', sender: { user_openid: 'confirmed-user' } } });
    return { close: async () => { closed = true; } };
  } });
  assert.equal(result.ready, true);
  const after = await loadConfig(file);
  assert.deepEqual(after, { ...before, access: { c2cUsers: ['confirmed-user'], groups: {} } });
  assert.deepEqual(await fs.readdir(dir), files);
});
test('missing events and declined authorization leave config incomplete and unchanged', async t => {
  for (const mode of ['no-event', 'no-selection', 'decline']) {
    const { file } = await fixture(t), before = await fs.readFile(file, 'utf8');
    const answers = ['', mode === 'no-selection' ? '' : '1', 'n'];
    let closed = false;
    const result = await authorizeQQ({ file, say() {}, ask: async () => answers.shift(), start: async options => {
      if (mode !== 'no-event') options.onIdentity({ QQ: { chat_type: 'c2c', sender: { user_openid: 'candidate' } } });
      return { close: async () => { closed = true; } };
    } });
    assert.equal(result.ready, false); assert.equal(closed, true);
    assert.equal(await fs.readFile(file, 'utf8'), before);
  }
});
test('cancelling authorization closes discovery and never grants an identity', async t => {
  const { file } = await fixture(t), before = await fs.readFile(file, 'utf8');
  let closed = false;
  await assert.rejects(authorizeQQ({ file, say() {}, ask: async () => { throw new UserCancelled(); },
    start: async () => ({ close: async () => { closed = true; } }) }), UserCancelled);
  assert.equal(closed, true); assert.equal(await fs.readFile(file, 'utf8'), before);
});
test('menu and safe diagnostics expose the recovery command', async () => {
  const choices = ['qq', '4'];
  const plan = await resolveCommand([], undefined, async () => choices.shift());
  assert.deepEqual(plan.args, ['authorize']);
  assert.match(publicError(new Error('invalid_config:empty_allowlist')), /pi-gateway qq authorize/);
  assert.match(publicError({ code: 'ENOENT' }), /pi-gateway qq setup/);
});

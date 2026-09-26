import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { collectCredentials } from '../src/onboarding/manual.js';
import { makeConfig, validateConfig, saveConfig } from '../src/config/index.js';
import { copyReleaseSource, buildRelease } from '../scripts/release.js';
import { createBackup } from '../scripts/backup.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gateway-ops-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir;
}

test('manual credentials request secret masking and require owner; domestic config only', async () => {
  const values = ['cli_test', 'fake-secret', 'ou_owner']; const masks = [];
  const result = await collectCredentials(async (label, secret = false) => { masks.push(secret); return values.shift(); });
  assert.deepEqual(masks, [false, true, false]); assert.equal(result.domain, 'feishu');
  assert.equal(makeConfig(result).access.private.tools, 'none');
  await assert.rejects(collectCredentials(async () => ''), /App ID/);
  const missingOwner = ['cli_test', 'fake-secret', ''];
  await assert.rejects(collectCredentials(async () => missingOwner.shift()), /Owner/);
  const config = makeConfig(result); config.bot.domain = 'lark';
  assert.throws(() => validateConfig(config), /only_feishu/);
});

test('setup CLI advertises approval and rejects international mode before networking', () => {
  const help = spawnSync(process.execPath, ['src/onboarding/index.js', 'setup', '--help'], { cwd: root, encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /默认白名单审批/); assert.doesNotMatch(help.stdout, /feishu\|lark|默认允许所有用户/);
  const reject = spawnSync(process.execPath, ['src/onboarding/index.js', 'setup', '--domain', 'lark'], { cwd: root, encoding: 'utf8' });
  assert.equal(reject.status, 1); assert.match(reject.stderr, /仅支持国内飞书/);
});

test('release package includes lockfile and file hashes, excludes local credentials, requires traceable source by default', async t => {
  const dir = await tempDir(t), source = path.join(dir, 'source'), outputDir = path.join(dir, 'dist');
  await copyReleaseSource(root, source);
  await fs.writeFile(path.join(source, 'credentials-private.json'), 'do not package');
  await fs.writeFile(path.join(source, '.env'), 'do not package');
  await assert.rejects(buildRelease({ root: source, outputDir }), /requires_git_commit/);
  const file = await buildRelease({ root: source, outputDir, allowUnversioned: true });
  const unpacked = path.join(dir, 'unpacked'); await fs.mkdir(unpacked);
  const tar = spawnSync('tar', ['-xzf', file, '-C', unpacked], { encoding: 'utf8' }); assert.equal(tar.status, 0);
  const packaged = path.join(unpacked, (await fs.readdir(unpacked))[0]);
  const manifest = JSON.parse(await fs.readFile(path.join(packaged, 'release-manifest.json')));
  assert.equal(manifest.sourceCommit, null);
  assert.ok(manifest.files['package-lock.json']); assert.ok(manifest.files['docs/OPERATIONS.md']);
  assert.equal(manifest.files['credentials-private.json'], undefined); assert.equal(manifest.files['.env'], undefined);
  for (const [name, hash] of Object.entries(manifest.files)) assert.equal(createHash('sha256').update(await fs.readFile(path.join(packaged, name))).digest('hex'), hash);
  const checksum = createHash('sha256').update(await fs.readFile(file)).digest('hex');
  assert.ok((await fs.readFile(`${file}.sha256`, 'utf8')).startsWith(checksum));
  await assert.rejects(buildRelease({ root: source, outputDir, allowUnversioned: true }), { code: 'EEXIST' });
  await fs.writeFile(path.join(source, 'src', 'credentials-oops.json'), 'unsafe');
  await assert.rejects(copyReleaseSource(source, path.join(dir, 'blocked')), /unsafe_source/);
});

test('stopped-service backup is private, restorable in staging, never overwrites and excludes model auth', async t => {
  const home = await tempDir(t), configFile = path.join(home, 'config/config.json');
  const fakeSecret = 'test-only-secret-never-log';
  await saveConfig(configFile, { appId: 'cli_test', appSecret: fakeSecret, ownerOpenId: 'ou_owner', domain: 'feishu' });
  const state = path.join(home, '.local/share/pi-lark-gateway/cli_test'); await fs.mkdir(state, { recursive: true });
  await fs.writeFile(path.join(state, 'access-approvals.json'), '{"version":1,"requests":{},"grants":{}}');
  await fs.mkdir(path.join(home, '.pi/agent'), { recursive: true });
  await fs.writeFile(path.join(home, '.pi/agent/auth.json'), 'not in gateway backup');
  const output = path.join(home, 'private/backup.tar.gz');
  await assert.rejects(createBackup({ configFile, output, home }), /stop_service/);
  await createBackup({ configFile, output, home, serviceStopped: true });
  assert.equal((await fs.stat(output)).mode & 0o777, 0o600);
  const restore = path.join(home, 'restore'); await fs.mkdir(restore);
  assert.equal(spawnSync('tar', ['-xzf', output, '-C', restore]).status, 0);
  const restoredConfig = path.join(restore, 'backup/config/config.json');
  assert.equal(JSON.parse(await fs.readFile(path.join(restore, 'backup/config/credentials.json'))).appSecret, fakeSecret);
  assert.equal(JSON.parse(await fs.readFile(path.join(restore, 'backup/manifest.json'))).modelCredentialsIncluded, false);
  await fs.access(path.join(restore, 'backup/state/cli_test/access-approvals.json'));
  await assert.rejects(fs.access(path.join(restore, 'backup/.pi')), { code: 'ENOENT' });
  const doctor = spawnSync(process.execPath, ['scripts/doctor.js', '--config', restoredConfig], { cwd: root, encoding: 'utf8', env: { ...process.env, HOME: home, PI_OFFLINE: '1' }, timeout: 30000 });
  assert.equal(doctor.status, 0); assert.ok(!`${doctor.stdout}${doctor.stderr}`.includes(fakeSecret));
  await assert.rejects(createBackup({ configFile, output, home, serviceStopped: true }), { code: 'EEXIST' });
});

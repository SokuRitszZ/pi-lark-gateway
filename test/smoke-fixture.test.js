import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { copySmokeSource, packSmokeFixture, checkPackageContents } from '../scripts/smoke-fixture.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gateway-smoke-fixture-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir;
}

test('smoke package preserves manifests and scripts without executing hooks or modifying checkout', async t => {
  const dir = await tempDir(t), source = path.join(dir, 'source');
  await copySmokeSource(root, source);
  const pkgPath = path.join(source, 'package.json'), lockPath = path.join(source, 'package-lock.json');
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
  pkg.scripts.prepack = 'node -e "process.exit(99)"';
  await fs.writeFile(pkgPath, JSON.stringify(pkg));
  const before = [await fs.readFile(pkgPath), await fs.readFile(lockPath)];
  const artifact = await packSmokeFixture({ root: source, directory: path.join(dir, 'fixture') });
  assert.deepEqual(await fs.readFile(pkgPath), before[0]); assert.deepEqual(await fs.readFile(lockPath), before[1]);
  assert.equal(artifact.version, pkg.version);
  assert.ok(!artifact.files.some(name => /^(?:test\/|\.github\/|scripts\/smoke)/.test(name)));
  assert.equal(spawnSync('tar', ['-xzf', artifact.file, '-C', dir]).status, 0);
  const packaged = JSON.parse(await fs.readFile(path.join(dir, 'package/package.json'), 'utf8'));
  const lock = JSON.parse(await fs.readFile(path.join(dir, 'package/npm-shrinkwrap.json'), 'utf8'));
  assert.deepEqual(packaged.scripts, pkg.scripts); assert.deepEqual(packaged.publishConfig, pkg.publishConfig);
  assert.equal(lock.version, packaged.version); assert.deepEqual(lock.packages[''].dependencies, packaged.dependencies);
  assert.ok((await fs.stat(path.join(dir, 'package/bin/pi-lark-gateway.js'))).mode & 0o111);
  const cli = path.join(dir, 'package/bin/pi-lark-gateway.js');
  assert.equal(spawnSync(process.execPath, [cli, '--help'], { cwd: dir }).status, 0);
  assert.equal(spawnSync(process.execPath, [cli, 'not-a-command'], { cwd: dir }).status, 1);
  await assert.rejects(packSmokeFixture({ root: source, directory: path.join(dir, 'fixture') }), { code: 'EEXIST' });

  // The same content gate runs for a supplied Action artifact, not only local fixtures.
  for (const [relative, content] of [['test/leaked.js', ''], ['src/credentials-oops.json', '{}']]) {
    const file = path.join(dir, 'package', relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content);
    const bad = path.join(dir, 'bad.tgz');
    assert.equal(spawnSync('tar', ['-czf', bad, '-C', dir, 'package'], { env: { ...process.env, COPYFILE_DISABLE: '1' } }).status, 0);
    assert.throws(() => checkPackageContents(bad), /unexpected_package_contents/);
    await fs.rm(file);
  }
  await fs.rm(path.join(dir, 'package/scripts/restart.js'));
  const missing = path.join(dir, 'missing.tgz');
  assert.equal(spawnSync('tar', ['-czf', missing, '-C', dir, 'package'], { env: { ...process.env, COPYFILE_DISABLE: '1' } }).status, 0);
  assert.throws(() => checkPackageContents(missing), /unexpected_package_contents/);
});

test('clean-source fixture excludes local roots and refuses nested credentials and links', async t => {
  const dir = await tempDir(t), source = path.join(dir, 'source'); await copySmokeSource(root, source);
  await fs.writeFile(path.join(source, '.env'), 'test-only');
  await fs.writeFile(path.join(source, 'credentials-private.json'), 'test-only');
  const clean = path.join(dir, 'clean'); await copySmokeSource(source, clean);
  for (const name of ['.env', 'credentials-private.json']) await assert.rejects(fs.access(path.join(clean, name)), { code: 'ENOENT' });
  const unsafe = path.join(source, 'src/credentials-oops.json'); await fs.writeFile(unsafe, '{}');
  await assert.rejects(copySmokeSource(source, path.join(dir, 'blocked-secret')), /unsafe_source/);
  await fs.rm(unsafe); await fs.symlink('../package.json', path.join(source, 'src/link.json'));
  await assert.rejects(copySmokeSource(source, path.join(dir, 'blocked-link')), /unsafe_source/);
});

test('smoke fixture refuses mismatched lock versions instead of inventing release versions', async t => {
  const dir = await tempDir(t), source = path.join(dir, 'source'); await copySmokeSource(root, source);
  const file = path.join(source, 'package-lock.json'), lock = JSON.parse(await fs.readFile(file, 'utf8'));
  lock.version = '999.0.0'; await fs.writeFile(file, JSON.stringify(lock));
  await assert.rejects(packSmokeFixture({ root: source, directory: path.join(dir, 'fixture') }), /manifest_mismatch/);
});

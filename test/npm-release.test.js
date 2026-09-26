import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { packNpm, npmTag, validatePublishIntent } from '../scripts/npm-release.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('prereleases go to next, stable to latest; publication requires explicit confirmation', () => {
  assert.equal(npmTag('1.0.0-rc.1'), 'next'); assert.equal(npmTag('1.0.0'), 'latest');
  assert.throws(() => validatePublishIntent({ publish: true }));
  assert.throws(() => validatePublishIntent({ publish: true, confirmPublication: true, allowUnversioned: true }));
  assert.throws(() => validatePublishIntent({ publish: true, confirmPublication: true, dryRun: true }));
  assert.doesNotThrow(() => validatePublishIntent({ publish: true, confirmPublication: true }));
  assert.doesNotThrow(() => validatePublishIntent({ dryRun: true, allowUnversioned: true }));
});

test('npm tarball contains executable CLI, runtime and shrinkwrap, but no source lifecycle hooks or test/release tools', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'npm-pack-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const artifact = await packNpm({ root, outputDir: dir, allowUnversioned: true });
  const expectedTag = npmTag(JSON.parse(await fs.readFile(path.join(root, 'package.json'))).version);
  assert.equal(artifact.tag, expectedTag);
  assert.ok(artifact.files.includes('npm-shrinkwrap.json'));
  assert.ok(!artifact.files.some(name => /^(?:test\/|\.github\/|scripts\/npm-release)/.test(name)));
  assert.equal(spawnSync('tar', ['-xzf', artifact.file, '-C', dir]).status, 0);
  const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package/package.json')));
  const lock = JSON.parse(await fs.readFile(path.join(dir, 'package/npm-shrinkwrap.json')));
  assert.equal(pkg.scripts, undefined); assert.equal(pkg.private, undefined);
  assert.equal(pkg.publishConfig.tag, expectedTag); assert.equal(pkg.bin['pi-lark-gateway'], 'bin/pi-lark-gateway.js');
  assert.equal(lock.version, pkg.version); assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
  assert.ok((await fs.stat(path.join(dir, 'package/bin/pi-lark-gateway.js'))).mode & 0o111);
  const help = spawnSync(process.execPath, [path.join(dir, 'package/bin/pi-lark-gateway.js'), '--help'], { cwd: dir, encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /start\|setup\|doctor\|backup/);
  const invalid = spawnSync(process.execPath, [path.join(dir, 'package/bin/pi-lark-gateway.js'), 'not-a-command'], { cwd: dir, encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  await assert.rejects(packNpm({ root, outputDir: dir, allowUnversioned: true }), { code: 'EEXIST' });
});

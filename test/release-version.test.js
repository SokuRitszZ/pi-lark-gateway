import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { releaseManifests, writeReleaseManifests } from '../scripts/release-version.js';

for (const version of ['1.2.3-beta.42', '1.2.3', '1.2.3-beta.1']) {
  test(`npm stamps staged manifests to ${version} without changing source or running hooks`, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gateway-version-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const pkg = { name: 'pi-lark-gateway', version: '1.2.3-beta.1', dependencies: {},
      scripts: { preversion: 'exit 91', version: 'exit 92', postversion: 'exit 93' } };
    const lock = { name: pkg.name, version: pkg.version, lockfileVersion: 3,
      packages: { '': { name: pkg.name, version: pkg.version, dependencies: {} } } };
    await writeReleaseManifests(root, { pkg, lock });
    const files = ['package.json', 'package-lock.json'];
    const before = await Promise.all(files.map(file => fs.readFile(path.join(root, file), 'utf8')));
    const updated = await releaseManifests(root, version);
    assert.equal(updated.sourceVersion, pkg.version);
    assert.equal(updated.pkg.version, version);
    assert.equal(updated.lock.version, version);
    assert.equal(updated.lock.packages[''].version, version);
    assert.deepEqual(updated.pkg.scripts, pkg.scripts);
    assert.deepEqual(await Promise.all(files.map(file => fs.readFile(path.join(root, file), 'utf8'))), before);
    assert.deepEqual((await fs.readdir(root)).sort(), files.sort());
  });
}

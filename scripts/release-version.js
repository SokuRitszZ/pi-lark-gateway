import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

export const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/;

// Version stamping is restricted to staged manifests, never the checked-out source.
export async function releaseManifests(root, version) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json')));
  if (pkg.name !== 'pi-lark-gateway' || typeof pkg.version !== 'string' || pkg.version.trim() !== pkg.version || !RELEASE_VERSION.test(pkg.version)) throw new Error('release_invalid_package');
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version || JSON.stringify(lock.packages[''].dependencies) !== JSON.stringify(pkg.dependencies)) throw new Error('release_lock_mismatch');
  const sourceVersion = pkg.version;
  if (version !== undefined) {
    if (typeof version !== 'string' || version.trim() !== version || !RELEASE_VERSION.test(version)) throw new Error('release_invalid_version_override');
    // npm owns version/lockfile updates, but only sees isolated manifest copies.
    const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'gateway-release-version-'));
    try {
      await writeReleaseManifests(stage, { pkg, lock });
      const result = spawnSync('npm', ['version', version, '--no-git-tag-version', '--ignore-scripts',
        '--allow-same-version', '--workspaces=false', '--offline'],
      { cwd: stage, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
      if (result.error || result.status !== 0) throw new Error('release_npm_version_failed');
      const updated = await releaseManifests(stage);
      if (updated.pkg.version !== version) throw new Error('release_npm_version_mismatch');
      return { ...updated, sourceVersion };
    } finally { await fs.rm(stage, { recursive: true, force: true }); }
  }
  return { pkg, lock, sourceVersion };
}

export async function writeReleaseManifests(directory, { pkg, lock }) {
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  await fs.writeFile(path.join(directory, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
}

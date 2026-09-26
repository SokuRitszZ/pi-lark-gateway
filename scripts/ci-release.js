import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { npmTag, packNpm } from './npm-release.js';
import { buildRelease } from './release.js';
import { releaseManifests } from './release-version.js';
import { planRelease } from './release-plan.js';

export async function releaseMetadata({ root, tag, repository }) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json')));
  if (pkg.name !== 'pi-lark-gateway' || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(pkg.version) || tag !== `v${pkg.version}`) throw new Error('release_tag_version_mismatch');
  if (lock.version !== pkg.version || lock.packages[''].version !== pkg.version || JSON.stringify(lock.packages[''].dependencies) !== JSON.stringify(pkg.dependencies)) throw new Error('release_lock_mismatch');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) throw new Error('release_repository_missing');
  const git = args => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) throw new Error('release_git_failed');
    return result.stdout.trim();
  };
  const commit = git(['rev-parse', 'HEAD']);
  if (git(['status', '--porcelain']) || git(['rev-parse', `refs/tags/${tag}^{commit}`]) !== commit) throw new Error('release_not_clean_tagged_commit');
  return { name: pkg.name, version: pkg.version, sourceVersion: pkg.version, tag, commit, repository,
    distTag: npmTag(pkg.version), prerelease: npmTag(pkg.version) !== 'latest',
    artifactName: `release-${pkg.version}-${commit}` };
}

export async function workflowReleaseMetadata({ root, env = process.env, event }) {
  const { pkg } = await releaseManifests(root);
  event ??= JSON.parse(await fs.readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  const plan = planRelease({ eventName: env.GITHUB_EVENT_NAME, event, repository: env.GITHUB_REPOSITORY,
    ref: env.GITHUB_REF, sha: env.GITHUB_SHA, runNumber: env.GITHUB_RUN_NUMBER,
    requestedVersion: env.RELEASE_VERSION });
  const git = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const head = git(['rev-parse', 'HEAD']), status = git(['status', '--porcelain']);
  if (head.status !== 0 || head.stdout.trim() !== plan.commit || status.status !== 0 || status.stdout.trim()) throw new Error('release_not_clean_event_commit');
  const tag = git(['rev-parse', '--verify', '--quiet', `refs/tags/${plan.tag}^{commit}`]);
  if ((tag.status === 0 && tag.stdout.trim() !== plan.commit) || ![0, 1].includes(tag.status)) throw new Error('release_existing_tag_conflict');
  return { name: pkg.name, sourceVersion: pkg.version, ...plan };
}

function readTarJson(file, member) {
  const result = spawnSync('tar', ['-xOzf', file, member], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('release_invalid_tar_member');
  return JSON.parse(result.stdout);
}

export async function verifyReleaseBundle(root, metadata, directory = path.join(root, 'dist')) {
  const stem = `${metadata.name}-${metadata.version}`;
  const source = path.join(directory, `${stem}.tar.gz`), npm = path.join(directory, 'npm', `${stem}.tgz`);
  const assets = [];
  for (const file of [source, npm]) {
    const data = await fs.readFile(file);
    const hash = createHash('sha256').update(data).digest('hex');
    const checksum = await fs.readFile(`${file}.sha256`, 'utf8');
    if (checksum.trim() !== `${hash}  ${path.basename(file)}`) throw new Error('release_checksum_mismatch');
    assets.push({ file, name: path.basename(file), digest: `sha256:${hash}` });
    assets.push({ file: `${file}.sha256`, name: `${path.basename(file)}.sha256`, digest: `sha256:${createHash('sha256').update(checksum).digest('hex')}` });
  }
  const manifest = readTarJson(source, `${stem}/release-manifest.json`);
  const npmManifest = readTarJson(npm, 'package/npm-release.json');
  const pkg = readTarJson(npm, 'package/package.json');
  const shrinkwrap = readTarJson(npm, 'package/npm-shrinkwrap.json');
  const expected = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
  for (const record of [manifest, npmManifest]) {
    if (record.version !== metadata.version || record.sourceCommit !== metadata.commit || record.sourceVersion !== expected.version) throw new Error('release_artifact_source_mismatch');
  }
  const sourcePkg = readTarJson(source, `${stem}/package.json`);
  const sourceLock = readTarJson(source, `${stem}/package-lock.json`);
  if (sourcePkg.version !== metadata.version || sourceLock.version !== metadata.version || sourceLock.packages?.['']?.version !== metadata.version ||
    JSON.stringify(sourcePkg.dependencies) !== JSON.stringify(expected.dependencies) || JSON.stringify(sourceLock.packages[''].dependencies) !== JSON.stringify(expected.dependencies)) throw new Error('release_source_version_mismatch');
  if (pkg.name !== metadata.name || pkg.version !== metadata.version || npmManifest.tag !== metadata.distTag || pkg.publishConfig?.tag !== metadata.distTag ||
    pkg.repository?.url !== `git+https://github.com/${metadata.repository}.git` || pkg.scripts || pkg.private ||
    shrinkwrap.version !== metadata.version || shrinkwrap.packages?.['']?.version !== metadata.version ||
    JSON.stringify(pkg.dependencies) !== JSON.stringify(expected.dependencies) || JSON.stringify(shrinkwrap.packages[''].dependencies) !== JSON.stringify(expected.dependencies)) {
    throw new Error('release_runtime_metadata_mismatch');
  }
  return { metadata, assets, npm, npmIntegrity: `sha512-${createHash('sha512').update(await fs.readFile(npm)).digest('base64')}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  (async () => {
    const metadata = await workflowReleaseMetadata({ root });
    if (process.argv[2] === 'build') {
      await buildRelease({ root, outputDir: path.join(root, 'dist'), version: metadata.version });
      await packNpm({ root, outputDir: path.join(root, 'dist/npm'), version: metadata.version, repository: metadata.repository });
      await verifyReleaseBundle(root, metadata);
    } else if (process.argv[2] === 'verify') await verifyReleaseBundle(root, metadata);
    else if (process.argv[2] && process.argv[2] !== 'metadata') throw new Error('release_invalid_command');
    if (process.env.GITHUB_OUTPUT) {
      await fs.appendFile(process.env.GITHUB_OUTPUT, Object.entries(metadata).map(([key, value]) => `${key}=${value}\n`).join(''));
    }
    console.log(`release_verified: ${metadata.tag} ${metadata.commit}`);
  })().catch(() => { console.error('release_validation_failed: check release branch/merged PR event, clean source commit, lockfile, version plan and artifact checksums/metadata.'); process.exitCode = 1; });
}

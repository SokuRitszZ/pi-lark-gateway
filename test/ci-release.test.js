import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { copyReleaseSource, buildRelease } from '../scripts/release.js';
import { packNpm } from '../scripts/npm-release.js';
import { releaseMetadata, workflowReleaseMetadata, verifyReleaseBundle } from '../scripts/ci-release.js';
import { publishNpmBundle } from '../scripts/publish-npm.js';
import { publishGitHubBundle } from '../scripts/github-release.js';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const missing = { status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }) };
const integrityResult = integrity => ({ status: 0, stdout: JSON.stringify(integrity) });
const simpleBundle = { metadata: { name: 'pi-lark-gateway', version: '1.0.0-rc.1', tag: 'v1.0.0-rc.1', commit: 'test-commit', distTag: 'next', prerelease: true }, npm: '/fake/package.tgz', npmIntegrity: 'sha512-test' };

async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ci-release-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'source'); await copyReleaseSource(project, root);
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Release Test', GIT_COMMITTER_NAME: 'Release Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
  function git(args) {
    const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.excludesFile=/dev/null', ...args], { cwd: root, env, encoding: 'utf8' });
    assert.equal(result.status, 0, 'fixture git operation failed'); return result.stdout.trim();
  }
  git(['init', '--template=', '-b', 'main']); git(['add', '.']); git(['commit', '-m', 'test source']);
  const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'))).version;
  const tag = `v${version}`; git(['tag', tag]);
  const metadata = await releaseMetadata({ root, tag, repository: 'example/gateway' });
  await buildRelease({ root, outputDir: path.join(root, 'dist') });
  await packNpm({ root, outputDir: path.join(root, 'dist/npm'), repository: 'example/gateway' });
  return { root, metadata, git };
}

test('release binds clean tag/version/commit, source and npm bundles, repository and checksums', async t => {
  const { root, metadata } = await fixture(t);
  const bundle = await verifyReleaseBundle(root, metadata);
  assert.equal(bundle.assets.length, 4); assert.match(bundle.npmIntegrity, /^sha512-/);
  await assert.rejects(releaseMetadata({ root, tag: 'v0.0.0', repository: 'example/gateway' }), /tag_version/);
  await assert.rejects(verifyReleaseBundle(root, { ...metadata, commit: 'wrong' }), /source_mismatch/);
  await assert.rejects(verifyReleaseBundle(root, { ...metadata, repository: 'other/repo' }), /runtime_metadata/);
  await fs.appendFile(bundle.npm, 'tampered');
  await assert.rejects(verifyReleaseBundle(root, metadata), /checksum/);
  await fs.appendFile(path.join(root, 'README.md'), '\nmodified');
  await assert.rejects(releaseMetadata({ root, tag: metadata.tag, repository: metadata.repository }), /clean_tagged/);
});

test('branch-driven beta and merged stable builds stamp both manifests without modifying source or inventing commits', async t => {
  const { root, metadata: initial } = await fixture(t);
  const beforePackage = await fs.readFile(path.join(root, 'package.json'));
  const beforeLock = await fs.readFile(path.join(root, 'package-lock.json'));
  const env = { GITHUB_REPOSITORY: initial.repository, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/release/2.3.4',
    GITHUB_SHA: initial.commit, GITHUB_RUN_NUMBER: '88', GITHUB_RUN_ATTEMPT: '1' };
  const push = { repository: { full_name: initial.repository }, ref: env.GITHUB_REF, after: initial.commit, deleted: false };
  const beta = await workflowReleaseMetadata({ root, env, event: push });
  assert.equal(beta.version, '2.3.4-beta.88'); assert.equal(beta.distTag, 'beta');
  assert.equal(beta.sourceVersion, initial.version); assert.equal(beta.commit, initial.commit);
  const pr = { action: 'closed', repository: push.repository, pull_request: { merged: true, merge_commit_sha: initial.commit,
    head: { ref: 'release/2.3.4', repo: push.repository }, base: { ref: 'main', repo: push.repository } } };
  const stable = await workflowReleaseMetadata({ root, env: { ...env, GITHUB_EVENT_NAME: 'pull_request' }, event: pr });
  assert.equal(stable.version, '2.3.4'); assert.equal(stable.distTag, 'latest');
  for (const metadata of [beta, stable]) {
    const directory = path.join(root, 'dist', metadata.kind);
    await buildRelease({ root, outputDir: directory, version: metadata.version });
    await packNpm({ root, outputDir: path.join(directory, 'npm'), version: metadata.version, repository: metadata.repository });
    const bundle = await verifyReleaseBundle(root, metadata, directory);
    assert.equal(bundle.assets.length, 4);
  }
  assert.deepEqual(await fs.readFile(path.join(root, 'package.json')), beforePackage);
  assert.deepEqual(await fs.readFile(path.join(root, 'package-lock.json')), beforeLock);
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout.trim(), '');
  const wrong = 'f'.repeat(40);
  await assert.rejects(workflowReleaseMetadata({ root, env: { ...env, GITHUB_SHA: wrong }, event: { ...push, after: wrong } }), /clean_event_commit/);
});

test('already published identical npm version is skipped without moving dist-tags', async () => {
  const calls = [];
  assert.equal(await publishNpmBundle(simpleBundle, { run: async args => { calls.push(args); return integrityResult('sha512-test'); } }), 'already-published');
  assert.deepEqual(calls.map(args => args[0]), ['view']);
});

test('different existing npm bytes and non-404 registry failures never publish', async () => {
  for (const result of [integrityResult('sha512-other'), { status: 1, stdout: JSON.stringify({ error: { code: 'E403' } }) }, { status: 1, stdout: 'network failure' }]) {
    const calls = [];
    await assert.rejects(publishNpmBundle(simpleBundle, { run: async args => { calls.push(args); return result; } }));
    assert.deepEqual(calls.map(args => args[0]), ['view']);
  }
});

test('npm publishes the existing tarball once and verifies registry integrity with bounded visibility retry', async () => {
  const replies = [missing, { status: 0 }, missing, integrityResult('sha512-test')], calls = [], waits = [];
  assert.equal(await publishNpmBundle(simpleBundle, { run: async args => { calls.push(args); return replies.shift(); }, wait: async ms => waits.push(ms) }), 'published');
  assert.deepEqual(calls.map(args => args[0]), ['view', 'publish', 'view', 'view']);
  assert.equal(calls[1][1], simpleBundle.npm); assert.equal(calls[1][calls[1].indexOf('--tag') + 1], 'next');
  assert.deepEqual(waits, [2000]);
});

test('failed npm upload does not continue or retry publication blindly', async () => {
  const calls = [];
  await assert.rejects(publishNpmBundle(simpleBundle, { run: async args => { calls.push(args); return calls.length === 1 ? missing : { status: 1 }; } }), /publication_failed/);
  assert.deepEqual(calls.map(args => args[0]), ['view', 'publish']);
});

function githubFixture(bundle, { previous = [], releaseExists = false, draft = true, failUpload = false } = {}) {
  const calls = [];
  const release = { id: 1, tag_name: bundle.metadata.tag, prerelease: bundle.metadata.prerelease, draft };
  const github = { rest: { repos: {
    getReleaseByTag: async () => { if (!releaseExists) throw Object.assign(new Error('not found'), { status: 404 }); return { data: release }; },
    createRelease: async args => { calls.push(['create', args]); return { data: release }; },
    listReleaseAssets: () => {},
    uploadReleaseAsset: async args => { calls.push(['upload', args.name]); if (failUpload) throw new Error('upload failed'); },
    updateRelease: async args => { calls.push(['update', args]); },
    getReleaseAsset: async () => { throw new Error('unexpected legacy asset fetch'); },
  } }, paginate: async () => previous };
  return { github, calls };
}

test('GitHub Release is a draft until all artifacts upload; retry skips matching assets without clobber', async t => {
  const { root, metadata } = await fixture(t);
  const bundle = await verifyReleaseBundle(root, metadata);
  const fresh = githubFixture(bundle);
  await publishGitHubBundle(bundle, { github: fresh.github, owner: 'example', repo: 'gateway' });
  assert.equal(fresh.calls[0][0], 'create'); assert.equal(fresh.calls[0][1].draft, true);
  assert.equal(fresh.calls.filter(call => call[0] === 'upload').length, 4);
  assert.equal(fresh.calls.at(-1)[0], 'update'); assert.equal(fresh.calls.at(-1)[1].draft, false);
  const retry = githubFixture(bundle, { previous: bundle.assets, releaseExists: true, draft: false });
  await publishGitHubBundle(bundle, { github: retry.github, owner: 'example', repo: 'gateway' });
  assert.deepEqual(retry.calls, []);
  const partial = githubFixture(bundle, { previous: [bundle.assets[0]], releaseExists: true });
  await publishGitHubBundle(bundle, { github: partial.github, owner: 'example', repo: 'gateway' });
  assert.equal(partial.calls.filter(call => call[0] === 'upload').length, 3); assert.equal(partial.calls.at(-1)[0], 'update');
  const conflict = githubFixture(bundle, { previous: [{ ...bundle.assets[0], digest: 'sha256:wrong' }], releaseExists: true });
  await assert.rejects(publishGitHubBundle(bundle, { github: conflict.github, owner: 'example', repo: 'gateway' }), /asset_mismatch/);
  assert.deepEqual(conflict.calls, []);
  const failed = githubFixture(bundle, { failUpload: true });
  await assert.rejects(publishGitHubBundle(bundle, { github: failed.github, owner: 'example', repo: 'gateway' }));
  assert.equal(failed.calls.some(call => call[0] === 'update'), false);
});

test('workflow contract separates unprivileged validation from exact-artifact publication', async () => {
  const release = await fs.readFile(path.join(project, '.github/workflows/release.yml'), 'utf8');
  const ci = await fs.readFile(path.join(project, '.github/workflows/ci.yml'), 'utf8');
  assert.match(release, /branches: \['release\/\*'\]/); assert.match(release, /types: \[closed\]/);
  assert.match(release, /group: release-run-\$\{\{ github.run_id \}\}/); assert.match(release, /cancel-in-progress: false/);
  assert.match(release, /pull_request.merged == true/); assert.match(release, /head.repo.full_name == github.repository/);
  const action = 'SokuRitszZ/npm-release-action@5c5679ea86d68f72df2e82f1e1c1275dd9c3c09d';
  assert.equal(release.split(`uses: ${action}`).length - 1, 4);
  for (const phase of ['plan', 'build', 'publish-npm', 'publish-github']) assert.ok(release.includes(`phase: ${phase}\n`));
  for (const setting of ["working-directory: '.'", "release-branch-prefix: 'release/'", 'main-branch: main',
    'prerelease-id: beta', 'prerelease-tag: beta', 'stable-tag: latest', 'tag-prefix: v',
    "registry-url: 'https://registry.npmjs.org/'", 'access: public', "shrinkwrap: 'true'", "source-archive: 'true'"]) {
    assert.equal(release.split(setting).length - 1, 4, `all phases agree on ${setting}`);
  }
  assert.match(release, /steps.meta.outputs.artifact-name/);
  assert.match(release, /steps.bundle.outputs.npm-file/);
  assert.match(release, /steps.bundle.outputs.artifact-directory/);
  assert.equal((release.match(/path: \$\{\{ runner.temp \}\}\/npm-release/g) || []).length, 2);
  assert.equal((release.match(/dry-run: 'false'/g) || []).length, 2);
  assert.match(release, /--expected-version/);
  assert.doesNotMatch(release, /tags:|RELEASE_TAG|workflow_dispatch:/);
  assert.match(release, /needs: \[prepare, verify\]/); assert.match(release, /environment: npm-publish/);
  assert.equal((release.match(/id-token: write/g) || []).length, 1);
  assert.equal((release.match(/contents: write/g) || []).length, 1);
  assert.match(release, /NPM_PUBLISH_ENABLED == 'true'/); assert.doesNotMatch(release, /NODE_AUTH_TOKEN|NPM_TOKEN/);
  assert.match(release, /smoke:npm -- --artifact/);
  assert.doesNotMatch(release, /scripts\/(?:ci-release|publish-npm|github-release)\.js|actions\/github-script/);
  for (const job of ['publish-npm', 'github-release']) {
    const block = release.split(`\n  ${job}:\n`)[1].split(/\n  [a-z-]+:\n/)[0];
    assert.match(block, /if: vars.NPM_PUBLISH_ENABLED == 'true'/);
    assert.doesNotMatch(block, /npm ci|phase: build/);
  }
  const pkg = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
  assert.equal(pkg.repository.url, 'git+https://github.com/SokuRitszZ/pi-lark-gateway.git');
  assert.match(ci, /workflow_call:/); assert.doesNotMatch(ci, /id-token: write|contents: write/);
});

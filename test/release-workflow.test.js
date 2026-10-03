import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('workflow contract separates unprivileged validation from exact-artifact publication', async () => {
  const release = await fs.readFile(path.join(project, '.github/workflows/release.yml'), 'utf8');
  const ci = await fs.readFile(path.join(project, '.github/workflows/ci.yml'), 'utf8');
  assert.match(release, /branches: \['release\/\*'\]/); assert.match(release, /types: \[closed\]/);
  assert.match(release, /group: release-run-\$\{\{ github.run_id \}\}/); assert.match(release, /cancel-in-progress: false/);
  assert.match(release, /pull_request.merged == true/); assert.match(release, /head.repo.full_name == github.repository/);
  const action = 'SokuRitszZ/npm-release-action@c8f64fb95b299b733e3468deb51ab33affc83a75';
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
  assert.equal(pkg.scripts['release:pack'], undefined); assert.equal(pkg.scripts['release:npm'], undefined);
  assert.match(ci, /workflow_call:/); assert.doesNotMatch(ci, /id-token: write|contents: write/);
  for (const command of ['release:check', 'smoke:clean', 'smoke:npm']) assert.ok(ci.includes(`npm run ${command}`));
});

test('source publication remains fail-closed and points to the shared workflow', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.prepublishOnly, 'node scripts/npm-publish-guard.js');
  const result = spawnSync(process.execPath, ['scripts/npm-publish-guard.js'], { cwd: project, encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /release.yml/);
  assert.doesNotMatch(result.stderr, /npm run release:npm/);
});

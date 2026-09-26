import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRelease } from '../scripts/release-plan.js';
import { npmTag } from '../scripts/npm-release.js';

const repository = 'example/gateway', sha = 'a'.repeat(40), merged = 'b'.repeat(40);
const push = (branch = 'release/1.2.3') => ({ eventName: 'push', repository, ref: `refs/heads/${branch}`, sha,
  runNumber: '42', runAttempt: '1', event: { repository: { full_name: repository }, ref: `refs/heads/${branch}`, after: sha, deleted: false, created: true } });
const pull = () => ({ eventName: 'pull_request', repository, sha: merged, event: { action: 'closed', repository: { full_name: repository }, pull_request: {
  merged: true, merge_commit_sha: merged,
  head: { ref: 'release/1.2.3', sha, repo: { full_name: repository } },
  base: { ref: 'main', repo: { full_name: repository } },
} } });

test('release branch creation/push derives unique beta version and beta channel without a pre-existing tag', () => {
  const first = planRelease(push());
  assert.equal(first.version, '1.2.3-beta.42'); assert.equal(first.distTag, 'beta'); assert.equal(first.commit, sha);
  assert.equal(first.tag, 'v1.2.3-beta.42'); assert.equal(first.prerelease, true);
  const update = push(); update.runNumber = '43'; update.event.created = false;
  assert.equal(planRelease(update).version, '1.2.3-beta.43');
  assert.equal(npmTag(first.version), 'beta'); assert.equal(npmTag('1.2.3-rc.1'), 'next'); assert.equal(npmTag('1.2.3'), 'latest');
});

test('all retries retain one beta run number and overrides must match exactly', () => {
  const retry = { ...push(), runAttempt: '2' };
  assert.deepEqual(planRelease(retry), planRelease(push()));
  assert.deepEqual(planRelease({ ...push(), runAttempt: undefined }), planRelease(push()));
  assert.equal(planRelease({ ...retry, requestedVersion: '1.2.3-beta.42' }).version, '1.2.3-beta.42');
  for (const requestedVersion of ['1.2.3-beta.41', '1.2.3-beta.43', '1.2.4-beta.42', '1.2.3', '1.2.3-beta.042', '1.2.3-beta.42.1']) {
    assert.throws(() => planRelease({ ...retry, requestedVersion }), /beta_override/);
  }
});

test('merging a same-repository release PR into main publishes the base version from the merge commit', () => {
  const plan = planRelease(pull());
  assert.equal(plan.version, '1.2.3'); assert.equal(plan.kind, 'stable'); assert.equal(plan.distTag, 'latest');
  assert.equal(plan.commit, merged); assert.notEqual(plan.commit, sha); assert.equal(plan.prerelease, false);
  assert.throws(() => planRelease({ ...pull(), requestedVersion: '1.2.4' }), /stable_override/);
});

test('non-release branches, malformed versions, deleted refs, unrelated events and forged push identity fail closed', () => {
  for (const branch of ['main', 'feature/1.2.3', 'release/01.2.3', 'release/1.2', 'release/1.2.3-beta.1', 'release/1.2.3/extra', 'release/1.2.3\n']) assert.throws(() => planRelease(push(branch)));
  for (const eventName of ['create', 'workflow_dispatch', 'release']) assert.throws(() => planRelease({ ...push(), eventName }));
  const deleted = push(); deleted.event.deleted = true; assert.throws(() => planRelease(deleted));
  const wrongSha = push(); wrongSha.event.after = merged; assert.throws(() => planRelease(wrongSha));
  const wrongRepo = push(); wrongRepo.event.repository.full_name = 'fork/gateway'; assert.throws(() => planRelease(wrongRepo));
  for (const runNumber of ['0', '01', '', '1.2', '-1']) assert.throws(() => planRelease({ ...push(), runNumber }));
});

test('closed-unmerged, forked, non-main and ordinary PRs never publish stable versions', () => {
  const cases = [
    p => { p.merged = false; }, p => { p.head.repo.full_name = 'fork/gateway'; },
    p => { p.base.repo.full_name = 'other/gateway'; }, p => { p.base.ref = 'develop'; },
    p => { p.head.ref = 'feature/new'; }, p => { p.merge_commit_sha = null; },
  ];
  for (const mutate of cases) { const input = pull(); mutate(input.event.pull_request); assert.throws(() => planRelease(input)); }
  const opened = pull(); opened.event.action = 'opened'; assert.throws(() => planRelease(opened));
});

const BRANCH = /^release\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const counter = value => typeof value === 'string' && value.trim() === value && /^[1-9]\d*$/.test(value);

// Only authenticated GitHub event fields determine source commit and base version.
export function planRelease({ eventName, event, repository, ref, sha, runNumber, requestedVersion }) {
  if (typeof repository !== 'string' || repository.trim() !== repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || event?.repository?.full_name !== repository) throw new Error('release_repository_mismatch');
  let branch, commit, kind;
  if (eventName === 'push') {
    if (event.deleted || !ref?.startsWith('refs/heads/') || event.ref !== ref || event.after !== sha) throw new Error('release_invalid_push');
    branch = ref.slice('refs/heads/'.length); commit = sha; kind = 'beta';
  } else if (eventName === 'pull_request') {
    const pr = event.pull_request;
    if (event.action !== 'closed' || pr?.merged !== true || pr.base?.ref !== 'main' ||
      pr.head?.repo?.full_name !== repository || pr.base?.repo?.full_name !== repository) throw new Error('release_requires_merged_same_repo_pr');
    branch = pr.head.ref; commit = pr.merge_commit_sha; kind = 'stable';
  } else throw new Error('release_unsupported_event');
  if (typeof branch !== 'string' || branch.trim() !== branch || !BRANCH.test(branch) || typeof commit !== 'string' || ![40, 64].includes(commit.length) || !SHA.test(commit)) throw new Error('release_invalid_branch_or_commit');
  const baseVersion = branch.slice('release/'.length);
  let version = baseVersion;
  if (kind === 'beta') {
    if (!counter(runNumber)) throw new Error('release_invalid_run_counter');
    version = `${baseVersion}-beta.${runNumber}`;
    if (requestedVersion && requestedVersion !== version) throw new Error('release_invalid_beta_override');
  } else if (requestedVersion && requestedVersion !== baseVersion) throw new Error('release_invalid_stable_override');
  return { version, baseVersion, branch, kind, commit, repository, tag: `v${version}`,
    distTag: kind === 'beta' ? 'beta' : 'latest', prerelease: kind === 'beta',
    artifactName: `release-${version}-${commit}` };
}

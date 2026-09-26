import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { releaseMetadata, verifyReleaseBundle } from './ci-release.js';

export async function publishGitHubBundle(bundle, { github, owner, repo }) {
  const { metadata, assets } = bundle;
  let release;
  try { release = (await github.rest.repos.getReleaseByTag({ owner, repo, tag: metadata.tag })).data; }
  catch (error) {
    if (error.status !== 404) throw new Error('github_release_lookup_failed');
    release = (await github.rest.repos.createRelease({ owner, repo, tag_name: metadata.tag,
      target_commitish: metadata.commit, name: metadata.tag, draft: true,
      prerelease: metadata.prerelease, generate_release_notes: true })).data;
  }
  if (release.tag_name !== metadata.tag || release.prerelease !== metadata.prerelease) throw new Error('github_release_metadata_mismatch');
  const existing = await github.paginate(github.rest.repos.listReleaseAssets, { owner, repo, release_id: release.id, per_page: 100 });
  for (const asset of assets) {
    const previous = existing.find(item => item.name === asset.name);
    if (previous) {
      let digest = previous.digest;
      if (!digest) {
        const response = await github.rest.repos.getReleaseAsset({ owner, repo, asset_id: previous.id, headers: { accept: 'application/octet-stream' } });
        digest = `sha256:${createHash('sha256').update(Buffer.from(response.data)).digest('hex')}`;
      }
      if (digest !== asset.digest) throw new Error('github_existing_asset_mismatch');
      continue; // Immutable assets: no clobber on retries.
    }
    const data = await fs.readFile(asset.file);
    await github.rest.repos.uploadReleaseAsset({ owner, repo, release_id: release.id, name: asset.name,
      data, headers: { 'content-type': 'application/octet-stream', 'content-length': data.length } });
  }
  // Keep partial uploads in a draft. Publish only once every expected asset exists.
  if (release.draft) await github.rest.repos.updateRelease({ owner, repo, release_id: release.id, draft: false,
    prerelease: metadata.prerelease, make_latest: metadata.prerelease ? 'false' : 'true' });
}

export async function runGitHubRelease({ github, context, root = process.cwd() }) {
  const metadata = await releaseMetadata({ root, tag: process.env.RELEASE_TAG, repository: `${context.repo.owner}/${context.repo.repo}` });
  const bundle = await verifyReleaseBundle(root, metadata, path.join(root, 'dist'));
  await publishGitHubBundle(bundle, { github, ...context.repo });
}

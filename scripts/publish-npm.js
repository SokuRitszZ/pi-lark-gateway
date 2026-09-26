import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { workflowReleaseMetadata, verifyReleaseBundle } from './ci-release.js';

const REGISTRY = 'https://registry.npmjs.org/';
const parse = text => { try { return JSON.parse(text); } catch { return null; } };

export async function publishNpmBundle(bundle, { run, wait = sleep, log = () => {} }) {
  const { metadata, npm, npmIntegrity } = bundle;
  async function existingIntegrity() {
    const result = await run(['view', `${metadata.name}@${metadata.version}`, 'dist.integrity', '--json', '--prefer-online', '--registry', REGISTRY]);
    const data = parse(result.stdout);
    if (result.status === 0 && typeof data === 'string' && data.startsWith('sha512-')) return data;
    if (result.status !== 0 && (data?.error?.code === 'E404' || parse(result.stderr)?.error?.code === 'E404')) return null;
    throw new Error('npm_registry_lookup_failed');
  }
  const existing = await existingIntegrity();
  if (existing) {
    if (existing !== npmIntegrity) throw new Error('npm_existing_version_integrity_mismatch');
    log('npm_already_published_identical');
    return 'already-published'; // Never move next/latest backwards during an old release retry.
  }
  const result = await run(['publish', npm, '--ignore-scripts', '--access', 'public', '--tag', metadata.distTag, '--registry', REGISTRY]);
  if (result.status !== 0) throw new Error('npm_publication_failed_check_registry_before_retry');
  for (let attempt = 0; attempt < 5; attempt++) {
    const integrity = await existingIntegrity();
    if (integrity === npmIntegrity) { log('npm_published_verified'); return 'published'; }
    if (integrity) throw new Error('npm_published_integrity_mismatch');
    if (attempt < 4) await wait(2000);
  }
  throw new Error('npm_publication_not_yet_visible');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  (async () => {
    if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.ACTIONS_ID_TOKEN_REQUEST_URL || process.env.NPM_PUBLISH_ENABLED !== 'true') throw new Error('npm_trusted_publishing_not_enabled');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const metadata = await workflowReleaseMetadata({ root });
    const bundle = await verifyReleaseBundle(root, metadata);
    await publishNpmBundle(bundle, { log: console.log, run: args => spawnSync('npm', args, { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 }) });
  })().catch(() => {
    console.error('npm_ci_publication_failed: verify OIDC trusted publisher/environment, package ownership, enabled setting and artifact integrity. If interrupted, inspect registry before retrying; never overwrite a published version.');
    process.exitCode = 1;
  });
}

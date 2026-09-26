import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyReleaseSource } from './release.js';
import { releaseManifests } from './release-version.js';

const REGISTRY = 'https://registry.npmjs.org/';
export const npmTag = version => version.includes('-beta.') ? 'beta' : version.includes('-') ? 'next' : 'latest';
const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
export function validatePublishIntent({ publish, confirmPublication, allowUnversioned, dryRun }) {
  if (publish && (!confirmPublication || allowUnversioned || dryRun)) throw new Error('npm_publish_requires_confirmation_and_committed_source');
}

export async function packNpm({ root, outputDir, allowUnversioned = false, publish = false, env = process.env, repository = env.GITHUB_REPOSITORY, version }) {
  if (repository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('npm_invalid_repository');
  const { pkg, lock, sourceVersion } = await releaseManifests(root, version);
  const head = git(root, ['rev-parse', 'HEAD']);
  const status = git(root, ['status', '--porcelain']);
  const commit = head.status === 0 && status.status === 0 && !status.stdout.trim() ? head.stdout.trim() : null;
  if (!commit && (!allowUnversioned || publish || version !== undefined)) throw new Error('npm_requires_clean_committed_source');
  if (publish) {
    const tag = git(root, ['rev-parse', `refs/tags/v${pkg.version}^{commit}`]);
    if (tag.status !== 0 || tag.stdout.trim() !== commit) throw new Error('npm_requires_matching_release_tag');
  }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gateway-npm-pack-'));
  try {
    const stage = path.join(temp, 'source'), packed = path.join(temp, 'packed');
    await copyReleaseSource(root, stage);
    await fs.mkdir(packed);
    const runtime = { ...pkg, files: [...pkg.files, 'npm-shrinkwrap.json', 'npm-release.json'], publishConfig: { registry: REGISTRY, access: 'public', tag: npmTag(pkg.version) } };
    if (repository) runtime.repository = { type: 'git', url: `git+https://github.com/${repository}.git` };
    // Installed packages are runtime artifacts, not release workspaces; no lifecycle hooks.
    delete runtime.scripts; delete runtime.private;
    await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify(runtime, null, 2) + '\n');
    await fs.writeFile(path.join(stage, 'npm-shrinkwrap.json'), JSON.stringify(lock, null, 2) + '\n');
    await fs.writeFile(path.join(stage, 'npm-release.json'), JSON.stringify({ version: pkg.version, sourceVersion, sourceCommit: commit, tag: npmTag(pkg.version) }, null, 2) + '\n');
    const result = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', packed], { cwd: stage, env, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error('npm_pack_failed');
    const [info] = JSON.parse(result.stdout);
    const required = ['package.json', 'npm-shrinkwrap.json', 'npm-release.json', 'bin/pi-lark-gateway.js', 'src/index.js', 'scripts/doctor.js', 'scripts/backup.js', 'scripts/restart.js'];
    const files = info.files.map(file => file.path);
    if (required.some(file => !files.includes(file)) || files.some(file => !/^(?:bin\/|src\/|docs\/|deploy\/|scripts\/(?:doctor|backup|restart)\.js$|(?:package\.json|npm-shrinkwrap\.json|npm-release\.json|README\.md|LICENSE|CHANGELOG\.md|SECURITY\.md)$)/.test(file))) throw new Error('npm_unexpected_package_contents');
    await fs.mkdir(outputDir, { recursive: true });
    const output = path.join(outputDir, info.filename);
    await fs.copyFile(path.join(packed, info.filename), output, fs.constants.COPYFILE_EXCL);
    const checksum = createHash('sha256').update(await fs.readFile(output)).digest('hex');
    await fs.writeFile(`${output}.sha256`, `${checksum}  ${info.filename}\n`, { flag: 'wx' });
    return { file: output, tag: npmTag(pkg.version), version: pkg.version, sourceCommit: commit, files };
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  async function main() {
    const { values } = parseArgs({ options: { output: { type: 'string' }, 'allow-unversioned': { type: 'boolean' }, 'dry-run': { type: 'boolean' }, publish: { type: 'boolean' }, 'confirm-publication': { type: 'boolean' } } });
    validatePublishIntent({ publish: values.publish, confirmPublication: values['confirm-publication'], allowUnversioned: values['allow-unversioned'], dryRun: values['dry-run'] });
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const artifact = await packNpm({ root, outputDir: path.resolve(values.output || path.join(root, 'dist/npm')), allowUnversioned: values['allow-unversioned'], publish: values.publish });
    console.log(`npm artifact: ${artifact.file}; tag=${artifact.tag}; source=${artifact.sourceCommit || 'UNVERSIONED (local only)'}`);
    if (values['dry-run'] || values.publish) {
      const result = spawnSync('npm', ['publish', artifact.file, '--ignore-scripts', '--access', 'public', '--tag', artifact.tag, '--registry', REGISTRY, ...(values.publish ? [] : ['--dry-run'])], { stdio: values.publish ? 'inherit' : 'pipe', encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
      if (result.error || result.status !== 0) throw new Error('npm_publish_or_dry_run_failed');
      console.log(values.publish ? 'npm publication succeeded.' : 'npm publish dry-run passed. Nothing uploaded.');
    }
  }
  main().catch(() => {
    console.error('npm_release_failed: verify tests, matching version/lockfile, clean committed source, unused output path; publication additionally requires --publish --confirm-publication and matching v<version> tag. Check registry credentials/rights privately.');
    process.exitCode = 1;
  });
}

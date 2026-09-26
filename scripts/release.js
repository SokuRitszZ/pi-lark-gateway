import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const RELEASE_PATHS = ['package.json', 'package-lock.json', 'README.md', 'AGENTS.md', 'LICENSE', 'CHANGELOG.md', 'SECURITY.md', '.gitignore', '.github', 'bin', 'src', 'scripts', 'test', 'docs', 'deploy'];
const hash = data => createHash('sha256').update(data).digest('hex');
const forbidden = name => /^(?:\.env(?:\..*)?|auth\.json|config\.json|groups\.json|credentials.*\.json)$/.test(name)
  || /\.(?:env|jsonl|log|pem|key|tgz|tar|tar\.gz|zip|sha256)$/.test(name);

export async function copyReleaseSource(root, destination) {
  const files = {};
  async function copy(relative) {
    const source = path.join(root, relative), target = path.join(destination, relative);
    const stat = await fs.lstat(source);
    if (stat.isSymbolicLink() || forbidden(path.basename(relative))) throw new Error('release_unsafe_source');
    if (stat.isDirectory()) {
      await fs.mkdir(target, { recursive: true });
      for (const name of (await fs.readdir(source)).sort()) await copy(path.join(relative, name));
    } else if (stat.isFile()) {
      const data = await fs.readFile(source);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, data, { mode: relative.startsWith(`bin${path.sep}`) ? 0o755 : 0o644 });
      files[relative.split(path.sep).join('/')] = hash(data);
    } else throw new Error('release_unsafe_source');
  }
  for (const relative of RELEASE_PATHS) await copy(relative);
  return files;
}

export async function buildRelease({ root, outputDir, allowUnversioned = false }) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json')));
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(pkg.version) || pkg.name !== 'pi-lark-gateway') throw new Error('release_invalid_version');
  if (lock.version !== pkg.version || lock.packages[''].version !== pkg.version || JSON.stringify(lock.packages[''].dependencies) !== JSON.stringify(pkg.dependencies)) throw new Error('release_lock_mismatch');
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const commit = git.status === 0 ? git.stdout.trim() : null;
  if (!commit && !allowUnversioned) throw new Error('release_requires_git_commit_or_allow_unversioned');
  if (commit) {
    const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
    if (status.status !== 0 || status.stdout.trim()) throw new Error('release_requires_clean_worktree');
  }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gateway-release-'));
  const name = `pi-lark-gateway-${pkg.version}${commit ? '' : '-unversioned'}`;
  try {
    const staged = path.join(temp, name);
    const files = await copyReleaseSource(root, staged);
    await fs.writeFile(path.join(staged, 'release-manifest.json'), JSON.stringify({ version: pkg.version, sourceCommit: commit, node: process.version, files }, null, 2) + '\n');
    const archive = path.join(temp, `${name}.tar.gz`);
    const tar = spawnSync('tar', ['-czf', archive, '-C', temp, name], { encoding: 'utf8', env: { ...process.env, COPYFILE_DISABLE: '1' } });
    if (tar.error || tar.status !== 0) throw new Error('release_tar_failed');
    await fs.mkdir(outputDir, { recursive: true });
    const result = path.join(outputDir, `${name}.tar.gz`);
    await fs.copyFile(archive, result, fs.constants.COPYFILE_EXCL);
    await fs.writeFile(`${result}.sha256`, `${hash(await fs.readFile(result))}  ${path.basename(result)}\n`, { flag: 'wx' });
    return result;
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { 'allow-unversioned': { type: 'boolean' }, output: { type: 'string' } } });
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  buildRelease({ root, outputDir: path.resolve(values.output || path.join(root, 'dist')), allowUnversioned: values['allow-unversioned'] })
    .then(file => console.log(`Release archive: ${file}`))
    .catch(() => { console.error('release_failed: check clean Git source, matching lockfile, required files and unused output path; use --allow-unversioned only for local candidates.'); process.exitCode = 1; });
}

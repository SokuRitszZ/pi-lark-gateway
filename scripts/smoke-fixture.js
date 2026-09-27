import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Local smoke fixtures only: no version stamping, release metadata, Git tags,
// checksums, registry calls or publication. Real releases belong to the Action.
const SOURCE_PATHS = ['package.json', 'package-lock.json', 'README.md', 'AGENTS.md', 'LICENSE', 'CHANGELOG.md', 'SECURITY.md', '.gitignore', '.github', 'bin', 'src', 'scripts', 'test', 'docs', 'deploy'];
const forbidden = name => /^(?:\.env(?:\..*)?|auth\.json|config\.json|groups\.json|credentials.*\.json)$/.test(name)
  || /\.(?:env|jsonl|log|pem|key|tgz|tar|tar\.gz|zip|sha256)$/.test(name);
export async function copySmokeSource(root, destination) {
  async function copy(relative) {
    const source = path.join(root, relative), target = path.join(destination, relative), stat = await fs.lstat(source);
    if (stat.isSymbolicLink() || forbidden(path.basename(relative))) throw new Error('smoke_unsafe_source');
    if (stat.isDirectory()) {
      await fs.mkdir(target, { recursive: true });
      for (const name of await fs.readdir(source)) await copy(path.join(relative, name));
    } else if (stat.isFile()) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    } else throw new Error('smoke_unsafe_source');
  }
  for (const relative of SOURCE_PATHS) await copy(relative);
}

export function checkPackageContents(file) {
  const result = spawnSync('tar', ['-tzf', file], { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('smoke_package_list_failed');
  const entries = result.stdout.trim().split('\n');
  if (entries.some(name => !name.startsWith('package/') || name.includes('\\') || name.split('/').includes('..'))) throw new Error('smoke_package_path_invalid');
  const files = entries.filter(name => !name.endsWith('/')).map(name => name.slice('package/'.length));
  const required = ['package.json', 'npm-shrinkwrap.json', 'bin/pi-lark-gateway.js', 'src/index.js', 'scripts/doctor.js', 'scripts/backup.js', 'scripts/restart.js'];
  const allowed = /^(?:bin\/|src\/|docs\/|deploy\/|scripts\/(?:doctor|backup|restart)\.js$|(?:package\.json|npm-shrinkwrap\.json|README\.md|LICENSE|CHANGELOG\.md|SECURITY\.md)$)/;
  if (new Set(files).size !== files.length || required.some(name => !files.includes(name)) || files.some(name => !allowed.test(name) || forbidden(path.posix.basename(name)))) throw new Error('smoke_unexpected_package_contents');
  return files;
}

export async function packSmokeFixture({ root, directory, env = process.env }) {
  await fs.mkdir(directory, { mode: 0o700 });
  const source = path.join(directory, 'source'), packed = path.join(directory, 'packed');
  await copySmokeSource(root, source); await fs.mkdir(packed);
  const pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
  const lock = JSON.parse(await fs.readFile(path.join(source, 'package-lock.json'), 'utf8'));
  if (pkg.version !== lock.version || pkg.version !== lock.packages?.['']?.version || pkg.name !== lock.name) throw new Error('smoke_manifest_mismatch');
  // Match the Action's lock inclusion and preserve scripts; never run hooks.
  pkg.files = [...new Set([...pkg.files, 'npm-shrinkwrap.json'])];
  await fs.writeFile(path.join(source, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  await fs.copyFile(path.join(source, 'package-lock.json'), path.join(source, 'npm-shrinkwrap.json'));
  const result = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', packed], { cwd: source, env, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('smoke_pack_failed');
  const [info] = JSON.parse(result.stdout);
  if (!info?.filename || path.basename(info.filename) !== info.filename) throw new Error('smoke_pack_filename_invalid');
  const file = path.join(packed, info.filename);
  return { file, version: pkg.version, files: checkPackageContents(file) };
}

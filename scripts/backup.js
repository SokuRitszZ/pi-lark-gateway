import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { defaultConfigPath, loadConfig } from '../src/config/index.js';
import { writeJson } from '../src/storage/index.js';

async function copyPrivateTree(source, target) {
  const stat = await fs.lstat(source);
  if (stat.isDirectory()) {
    await fs.mkdir(target, { recursive: true, mode: 0o700 });
    for (const name of await fs.readdir(source)) await copyPrivateTree(path.join(source, name), path.join(target, name));
  } else if (stat.isFile()) {
    await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    await fs.chmod(target, 0o600);
  } else throw new Error('backup_refuses_symlinks_or_special_files');
}

export async function createBackup({ configFile, output, serviceStopped, home = os.homedir() }) {
  if (!serviceStopped) throw new Error('stop_service_before_backup');
  const { config, secret, groups } = await loadConfig(configFile);
  if (!/^cli_[A-Za-z0-9]+$/.test(config.bot.appId)) throw new Error('invalid_backup_app_id');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gateway-backup-'));
  try {
    const bundle = path.join(temp, 'backup');
    const normalized = structuredClone(config);
    normalized.bot.credentialsFile = 'credentials.json';
    await writeJson(path.join(bundle, 'config/config.json'), normalized);
    await writeJson(path.join(bundle, 'config/credentials.json'), secret);
    await writeJson(path.join(bundle, 'config/groups.json'), { version: 1, groups });
    const state = path.join(home, '.local/share/pi-lark-gateway', config.bot.appId);
    let hasState = true;
    try { await fs.lstat(state); } catch (error) { if (error.code === 'ENOENT') hasState = false; else throw error; }
    if (hasState) {
      await fs.mkdir(path.join(bundle, 'state'), { mode: 0o700 });
      await copyPrivateTree(state, path.join(bundle, 'state', config.bot.appId));
    }
    await writeJson(path.join(bundle, 'manifest.json'), { version: 1, appId: config.bot.appId, createdAt: new Date().toISOString(), hasState, modelCredentialsIncluded: false });
    const archive = path.join(temp, 'backup.tar.gz');
    const handle = await fs.open(archive, 'wx', 0o600); await handle.close();
    const tar = spawnSync('tar', ['-czf', archive, '-C', temp, 'backup'], { encoding: 'utf8', env: { ...process.env, COPYFILE_DISABLE: '1' } });
    if (tar.error || tar.status !== 0) throw new Error('backup_tar_failed');
    await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
    await fs.copyFile(archive, output, fs.constants.COPYFILE_EXCL);
    await fs.chmod(output, 0o600);
    const hash = createHash('sha256').update(await fs.readFile(output)).digest('hex');
    await fs.writeFile(`${output}.sha256`, `${hash}  ${path.basename(output)}\n`, { flag: 'wx', mode: 0o600 });
    return output;
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  async function main() {
    const { values } = parseArgs({ options: { config: { type: 'string' }, output: { type: 'string' }, 'service-stopped': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
    if (values.help) { console.log(`用法：${process.env.PI_LARK_CLI === '1' ? 'pi-lark-gateway backup' : 'npm run backup --'} --service-stopped --output /安全目录/backup.tar.gz [--config 路径]\n必须先停服务；包含明文应用凭据和会话，不含 Pi 模型凭据。不覆盖已有文件。`); return; }
    if (!values.output) throw new Error('backup_output_required');
    await createBackup({ configFile: path.resolve(values.config || process.env.PI_LARK_CONFIG || defaultConfigPath()), output: path.resolve(values.output), serviceStopped: values['service-stopped'] });
    console.log('backup_created: private archive and SHA-256 saved; keep encrypted/offline. Model credentials not included.');
  }
  main().catch(() => { console.error('backup_failed: stop service first, check config, permissions, regular state files and unused output path. No credentials printed.'); process.exitCode = 1; });
}

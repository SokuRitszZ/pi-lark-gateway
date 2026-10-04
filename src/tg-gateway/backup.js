import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { acquireAccountLock } from './lock.js';
import { validateConfig, dataDirectory } from './config/index.js';
const exec = promisify(execFile);
async function assertPlain(file) {
  const stat = await fs.lstat(file);
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('tg_backup_unsafe_entry');
  if (stat.isDirectory()) for (const name of await fs.readdir(file)) await assertPlain(path.join(file, name));
}
export async function backupTelegram(configPath, output, { serviceStopped = false } = {}) {
  if (!serviceStopped || !output) throw new Error('tg_backup_requires_stopped_confirmation');
  const original = await fs.readFile(configPath, 'utf8'), config = validateConfig(JSON.parse(original)), base = dataDirectory(config.botId);
  try { await fs.lstat(path.join(base, 'runtime.lock')); throw new Error('tg_account_locked'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await fs.lstat(output); throw new Error('tg_backup_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const parent = path.dirname(path.resolve(output)); await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  if (path.resolve(output).startsWith(path.resolve(base) + path.sep)) throw new Error('tg_backup_output_inside_state');
  const temp = await fs.mkdtemp(path.join(parent, '.tg-backup-')), lockFile = path.join(base, 'runtime.lock');
  let releaseLock;
  try {
    releaseLock = await acquireAccountLock(base, 'backup');
    await fs.mkdir(path.join(temp, 'config'), { mode: 0o700 });
    await assertPlain(configPath); await fs.writeFile(path.join(temp, 'config/config.json'), original, { mode: 0o600 });
    if (config.credentialsFile) {
      if (!/^credentials-[A-Za-z0-9-]+\.json$/.test(config.credentialsFile)) throw new Error('invalid_config:credentialsFile');
      const file = path.join(path.dirname(configPath), config.credentialsFile); await assertPlain(file);
      await fs.copyFile(file, path.join(temp, 'config', config.credentialsFile));
    }
    try { await assertPlain(base); await fs.cp(base, path.join(temp, 'state'), { recursive: true, dereference: false, errorOnExist: true, filter: source => source !== lockFile }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await fs.mkdir(path.join(temp, 'state'), { mode: 0o700 }); }
    const archive = path.join(temp, 'backup.tar.gz');
    await fs.writeFile(archive, '', { mode: 0o600, flag: 'wx' });
    await exec('tar', ['-czf', archive, '-C', temp, 'config', 'state']);
    await fs.chmod(archive, 0o600); await fs.link(archive, path.resolve(output));
  } finally { try { await releaseLock?.(); } finally { await fs.rm(temp, { recursive: true, force: true }); } }
}

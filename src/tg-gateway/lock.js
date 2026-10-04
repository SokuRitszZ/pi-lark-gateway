import fs from 'node:fs/promises';
import path from 'node:path';
export async function acquireAccountLock(base, kind = 'gateway') {
  await fs.mkdir(base, { recursive: true, mode: 0o700 });
  const directory = await fs.lstat(base);
  if (!directory.isDirectory() || (directory.mode & 0o077) || (process.getuid && directory.uid !== process.getuid())) throw new Error('tg_state_permissions');
  const file = path.join(base, 'runtime.lock');
  const handle = await fs.open(file, 'wx', 0o600).catch(() => { throw new Error('tg_account_locked'); });
  let original;
  try { original = await handle.stat(); } catch (error) { await handle.close(); throw error; }
  let released = false;
  const release = async () => {
    if (released) return; released = true;
    try {
      const current = await fs.lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (current && (current.ino !== original.ino || current.dev !== original.dev)) throw new Error('tg_lock_changed');
      if (current) await fs.unlink(file);
    } finally { await handle.close(); }
  };
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, kind, startedAt: Date.now() })); }
  catch (error) { await release(); throw error; }
  // Keep the descriptor until release so the owned inode cannot be reused.
  return release;
}

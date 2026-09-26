import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MAX_BYTES, safeName } from './content.js';
import { mediaError } from './errors.js';

async function directory(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw mediaError('MEDIA_PATH_DENIED');
  return dir;
}
export async function attachmentDirectories(workspace) {
  await directory(workspace);
  const root = await directory(path.join(workspace, 'attachments'));
  return { inbox: await directory(path.join(root, 'inbox')), outbox: await directory(path.join(root, 'outbox')) };
}

// Counts only managed inbox files. No automatic deletion of user data.
export function createInboxStore(base, { maxBytes = 512 * 1024 * 1024 } = {}) {
  let used = 0, initialized;
  async function scan() {
    for (const entry of await fs.readdir(base, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
      const attachments = path.join(base, entry.name, 'attachments'), inbox = path.join(attachments, 'inbox');
      try {
        if (!(await fs.lstat(attachments)).isDirectory() || !(await fs.lstat(inbox)).isDirectory()) continue;
        for (const file of await fs.readdir(inbox, { withFileTypes: true })) {
          if (file.isFile()) used += (await fs.lstat(path.join(inbox, file.name))).size;
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  return { async save(workspace, bytes, name) {
    await (initialized ||= scan());
    if (used + bytes.length > maxBytes) throw mediaError('MEDIA_STORAGE_FULL');
    used += bytes.length; // Reserve before any await so concurrent sessions share the cap.
    let file, created = false;
    try {
      const { inbox } = await attachmentDirectories(workspace);
      file = path.join(inbox, `${randomUUID()}-${safeName(name)}`);
      const handle = await fs.open(file, 'wx', 0o600); created = true;
      try { await handle.writeFile(bytes); } finally { await handle.close(); }
      return file;
    } catch (error) {
      used -= bytes.length;
      if (created) await fs.unlink(file).catch(() => {});
      throw error;
    }
  } };
}

export async function readOutgoing(workspace, requested) {
  if (typeof requested !== 'string' || !requested || requested.includes('\0')) throw mediaError('MEDIA_PATH_DENIED');
  await attachmentDirectories(workspace);
  const file = path.resolve(workspace, requested), relative = path.relative(workspace, file);
  const parts = relative.split(path.sep);
  if (parts.length < 3 || parts[0] !== 'attachments' || !['inbox', 'outbox'].includes(parts[1]) || parts.some(part => part === '..' || part.startsWith('.'))) throw mediaError('MEDIA_PATH_DENIED');
  let current = workspace;
  for (const part of parts) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw mediaError('MEDIA_PATH_DENIED');
  }
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) throw mediaError('MEDIA_PATH_DENIED');
    if (!stat.size) throw mediaError('MEDIA_EMPTY');
    if (stat.size > MAX_BYTES) throw mediaError('MEDIA_TOO_LARGE');
    // Bounded read even if a file is concurrently enlarged after stat().
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== stat.size) throw mediaError('MEDIA_TOO_LARGE');
    return { bytes: bytes.subarray(0, length), name: safeName(path.basename(file)) };
  } finally { await handle.close(); }
}

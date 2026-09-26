import { mkdir, open, link, unlink, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function writeJson(file, value, { exclusive = false } = {}) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
    if (exclusive) await link(temp, file); else await rename(temp, file);
  } finally { await unlink(temp).catch(() => {}); }
}

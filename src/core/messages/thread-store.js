import fs from 'node:fs/promises';
import path from 'node:path';

export async function createThreadStore(base) {
  const file = path.join(base, 'thread-roots.json');
  let roots;
  try { roots = new Map(JSON.parse(await fs.readFile(file, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; roots = new Map(); }
  let saving = Promise.resolve();
  return {
    roots,
    save() {
      const snapshot = JSON.stringify([...roots]);
      saving = saving.catch(() => {}).then(async () => {
        await fs.writeFile(file + '.tmp', snapshot, { mode: 0o600 });
        await fs.rename(file + '.tmp', file);
      });
      return saving;
    },
  };
}

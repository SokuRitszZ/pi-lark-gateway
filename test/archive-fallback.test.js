import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createSessionLifecycle, sessionDirectory } from '../src/agent/session-lifecycle.js';
import { SESSION_IDLE_MS } from '../src/agent/archive-store.js';

async function fixture(t, summarize) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-fallback-'));
  let now = Date.now();
  const dir = sessionDirectory(base, 'chat'); await fs.mkdir(dir);
  const file = path.join(dir, 'old.jsonl');
  const data = JSON.stringify({ type: 'session', version: 3 }) + '\n';
  await fs.writeFile(file, data);
  const old = new Date(now - SESSION_IDLE_MS - 1000); await fs.utimes(file, old, old);
  const logs = [];
  const pool = createSessionLifecycle(base, { now: () => now, sweepIntervalMs: 0, log: event => logs.push(event),
    summarize, createSession: async (_, tools, summary) => ({ summary, dispose() {} }),
  });
  t.after(async () => { await pool.dispose(); await fs.rm(base, { recursive: true, force: true }); });
  return { dir, file, data, old, pool, logs, advance: () => { now++; } };
}

for (const mode of ['model-failure', 'oversize', 'save-failure', 'bad-archive']) {
  test(`archival ${mode} retains original and normal turns succeed`, async t => {
    const f = await fixture(t, async () => {
      if (mode === 'save-failure') { await fs.mkdir(path.join(f.dir, 'archive.json')); return 'summary'; }
      throw new Error('private failure');
    });
    if (mode === 'oversize') { await fs.truncate(f.file, 33 * 1024 * 1024); await fs.utimes(f.file, f.old, f.old); }
    if (mode === 'bad-archive') await fs.writeFile(path.join(f.dir, 'archive.json'), '{broken');
    const before = await fs.readFile(f.file);
    assert.equal(await f.pool.run('chat', 'none', async () => 'answer'), 'answer');
    assert.deepEqual(await fs.readFile(f.file), before);
    f.advance();
    assert.equal(await f.pool.run('chat', 'none', async () => 'next answer'), 'next answer');
    assert.ok(f.logs.every(log => log === 'session_archive_failed_retained'));
    assert.ok(f.logs.length >= 1);
  });
}

test('resumed interaction invalidates interrupted deletion plan even without new transcript bytes', async t => {
  const f = await fixture(t, async () => 'summary');
  const manifest = { version: 1, lastActivity: f.old.getTime(), summary: 'saved history', pending: [
    { name: 'old.jsonl', hash: createHash('sha256').update(f.data).digest('hex') },
  ] };
  // Pretend a partial cleanup failed and the next foreground attempt sees changed data.
  await fs.writeFile(path.join(f.dir, 'archive.json'), JSON.stringify(manifest));
  await fs.appendFile(f.file, '\n');
  assert.equal(await f.pool.run('chat', 'none', async () => 'recovered'), 'recovered');
  // Return to the original bytes: activity still protects against a stale deletion plan.
  await fs.writeFile(f.file, f.data); await fs.utimes(f.file, f.old, f.old);
  f.advance(); await f.pool.sweep(); await fs.access(f.file);
  const archive = JSON.parse(await fs.readFile(path.join(f.dir, 'archive.json')));
  assert.deepEqual(archive.pending, []); assert.equal(archive.cleanupCancelled, true);
  assert.equal(archive.summary, 'saved history');
  assert.equal(await f.pool.run('chat', 'none', async () => 'still works'), 'still works');
});

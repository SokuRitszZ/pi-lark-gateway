import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSessionLifecycle, sessionDirectory } from '../src/agent/session-lifecycle.js';
import { SESSION_IDLE_MS, ARCHIVE_NOTICE } from '../src/agent/archive-store.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(t, options = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'gateway-lifecycle-'));
  const opened = [], logs = [];
  const pool = createSessionLifecycle(base, {
    createSession: async (dir, tools, summary) => {
      const session = { dir, tools, summary, disposed: false, dispose() { this.disposed = true; }, async abort() {} };
      opened.push(session); return session;
    }, summarize: async () => '历史结论', sweepIntervalMs: 0, log: event => logs.push(event), ...options,
  });
  t.after(async () => { await pool.dispose(); await fs.rm(base, { recursive: true, force: true }); });
  return { base, pool, opened, logs };
}
async function history(dir, time) {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'session.jsonl');
  await fs.writeFile(file, JSON.stringify({ type: 'session', version: 3 }) + '\n' + JSON.stringify({ type: 'message', message: { role: 'user', content: 'old question' } }) + '\n');
  await fs.utimes(file, new Date(time), new Date(time));
  return file;
}

test('default capacity is ten; eleventh session waits and failures release capacity', async t => {
  const { pool, opened } = await fixture(t);
  const barrier = deferred(), startedTen = deferred();
  let started = 0, active = 0, peak = 0;
  const jobs = Array.from({ length: 11 }, (_, i) => pool.run(`key-${i}`, 'none', async () => {
    started++; active++; peak = Math.max(peak, active);
    if (started === 10) startedTen.resolve();
    try { await barrier.promise; if (i === 0) throw new Error('model_failed'); return i; }
    finally { active--; }
  }));
  const results = Promise.allSettled(jobs);
  await startedTen.promise;
  assert.equal(started, 10); assert.equal(opened.length, 10);
  barrier.resolve();
  assert.equal((await results).filter(result => result.status === 'rejected').length, 1);
  assert.equal(started, 11); assert.equal(peak, 10);
});

test('same session is serialized and reused; tool-policy change replaces cached session', async t => {
  const { pool, opened } = await fixture(t);
  const entered = deferred(), release = deferred();
  let secondStarted = false;
  const first = pool.run('same', 'none', async () => { entered.resolve(); await release.promise; });
  const second = pool.run('same', 'none', async () => { secondStarted = true; });
  await entered.promise; assert.equal(secondStarted, false);
  release.resolve(); await Promise.all([first, second]);
  assert.equal(opened.length, 1);
  await pool.run('same', 'all', async () => {});
  assert.equal(opened.length, 2); assert.equal(opened[0].disposed, true);
});

test('expiry evicts a cached session and new conversation receives archive summary', async t => {
  let now = Date.now();
  const { base, pool, opened } = await fixture(t, { now: () => now });
  await pool.run('chat', 'none', async () => {});
  const dir = sessionDirectory(base, 'chat');
  const file = await history(dir, now);
  now += SESSION_IDLE_MS - 1;
  await pool.sweep();
  assert.equal(opened[0].disposed, false); await fs.access(file);
  now += 2;
  await pool.run('chat', 'none', async session => { assert.ok(session.summary.includes(ARCHIVE_NOTICE)); });
  assert.equal(opened.length, 2); assert.equal(opened[0].disposed, true);
  await assert.rejects(fs.access(file), { code: 'ENOENT' });
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'activity.json'))).lastActivity, now);
});

test('startup sweep finds disk-only expired sessions, preserves unrelated files and ignores non-session directories', async t => {
  const now = Date.now();
  const { base, pool } = await fixture(t, { now: () => now });
  const dir = sessionDirectory(base, 'offline');
  const file = await history(dir, now - SESSION_IDLE_MS - 1000);
  await fs.writeFile(path.join(dir, 'work.txt'), 'keep');
  const ignored = await history(path.join(base, 'other-data'), now - SESSION_IDLE_MS - 1000);
  await pool.sweep();
  await assert.rejects(fs.access(file), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(dir, 'work.txt'), 'utf8'), 'keep');
  await fs.access(ignored);
  const archive = JSON.parse(await fs.readFile(path.join(dir, 'archive.json')));
  assert.match(archive.summary, /该会话已过期被归档/); assert.deepEqual(archive.pending, []);
  assert.equal((await fs.stat(path.join(dir, 'archive.json'))).mode & 0o777, 0o600);
});

test('active or queued session is not archived even if a turn exceeds idle threshold', async t => {
  let now = Date.now();
  let summaries = 0;
  const { base, pool, opened } = await fixture(t, { now: () => now, summarize: async () => { summaries++; return 'summary'; } });
  const entered = deferred(), release = deferred();
  const first = pool.run('active', 'none', async () => { entered.resolve(); await release.promise; });
  const second = pool.run('active', 'none', async () => {});
  await entered.promise;
  const file = await history(sessionDirectory(base, 'active'), now);
  now += SESSION_IDLE_MS + 1;
  await pool.sweep();
  assert.equal(summaries, 0); assert.equal(opened[0].disposed, false); await fs.access(file);
  release.resolve(); await Promise.all([first, second]); await pool.sweep();
  assert.equal(summaries, 0);
});

test('failed archival preserves originals and cache; a later sweep retries', async t => {
  let now = Date.now(), fail = true;
  const { base, pool, opened, logs } = await fixture(t, { now: () => now, summarize: async () => { if (fail) throw new Error('private error'); return 'summary'; } });
  await pool.run('retry', 'none', async () => {});
  const file = await history(sessionDirectory(base, 'retry'), now);
  now += SESSION_IDLE_MS + 1;
  await pool.sweep(); await fs.access(file);
  assert.equal(opened[0].disposed, false); assert.deepEqual(logs, ['session_archive_failed_retained']);
  fail = false; await pool.sweep();
  assert.equal(opened[0].disposed, true); await assert.rejects(fs.access(file), { code: 'ENOENT' });
});

test('archive work uses the same capacity as foreground turns', async t => {
  const entered = deferred(), release = deferred();
  const { base, pool, opened } = await fixture(t, { maxConcurrent: 1, summarize: async () => { entered.resolve(); await release.promise; return 'summary'; } });
  await history(sessionDirectory(base, 'expired'), Date.now() - SESSION_IDLE_MS - 1000);
  const sweep = pool.sweep(); await entered.promise;
  const answer = pool.run('fresh', 'none', async () => {});
  await new Promise(resolve => setImmediate(resolve)); assert.equal(opened.length, 0);
  release.resolve(); await Promise.all([sweep, answer]); assert.equal(opened.length, 1);
});

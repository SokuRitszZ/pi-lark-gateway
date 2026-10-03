import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createLimiter } from './limiter.js';
import { archiveExpired, readArchiveSummary, touchSession, SESSION_IDLE_MS } from './archive-store.js';

export const sessionDirectory = (base, key) => path.join(base, createHash('sha256').update(key).digest('hex'));

// Owns per-session exclusion, global capacity and cache eviction; SDK creation is injected.
export function createSessionLifecycle(base, { createSession, summarize, maxConcurrent = 10,
  idleMs = SESSION_IDLE_MS, sweepIntervalMs = 60 * 60 * 1000, now = Date.now, log = () => {} }) {
  const sessions = new Map();
  const jobs = new Map();
  const limiter = createLimiter(maxConcurrent);
  let closed = false, sweeping = null;
  const evict = dir => { const cached = sessions.get(dir); cached?.session.dispose(); sessions.delete(dir); };
  const expire = async dir => {
    try { return await archiveExpired(dir, { now: now(), idleMs, summarize: text => summarize(text, dir), onArchive: () => evict(dir) }); }
    catch {
      log('session_archive_failed_retained');
      // Archival is best-effort maintenance, never a prerequisite for chatting.
      // Preserve any durable summary (including interrupted cleanup) and originals.
      return readArchiveSummary(dir).catch(() => '');
    }
  };
  function exclusive(dir, work) {
    const previous = jobs.get(dir) || Promise.resolve();
    const job = previous.catch(() => {}).then(() => limiter.run(work));
    jobs.set(dir, job);
    void job.then(() => { if (jobs.get(dir) === job) jobs.delete(dir); }, () => { if (jobs.get(dir) === job) jobs.delete(dir); });
    return job;
  }
  function sweep() {
    if (closed) return Promise.resolve();
    if (sweeping) return sweeping;
    sweeping = (async () => {
      const dirs = await fs.readdir(base, { withFileTypes: true });
      for (const entry of dirs) {
        if (closed) break;
        if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
        const dir = path.join(base, entry.name);
        if (jobs.has(dir)) continue; // Includes queued/active turns, not only currently streaming ones.
        await exclusive(dir, async () => { if (!closed) await expire(dir); }).catch(() => log('session_archive_failed'));
      }
    })().catch(() => log('session_sweep_failed')).finally(() => { sweeping = null; });
    return sweeping;
  }
  const timer = sweepIntervalMs > 0 ? setInterval(() => { void sweep(); }, sweepIntervalMs) : null;
  timer?.unref();
  return {
    async run(key, tools, work) {
      if (closed) throw new Error('session_pool_closed');
      const dir = sessionDirectory(base, key);
      return exclusive(dir, async () => {
        if (closed) throw new Error('session_pool_closed');
        await fs.mkdir(dir, { recursive: true, mode: 0o700 });
        const summary = await expire(dir);
        let cached = sessions.get(dir);
        if (cached && cached.tools !== tools) { evict(dir); cached = null; }
        if (!cached) {
          cached = { session: await createSession(dir, tools, summary), tools };
          sessions.set(dir, cached);
        }
        await touchSession(dir, now());
        try { return await work(cached.session); }
        finally { await touchSession(dir, now()); }
      });
    },
    sweep,
    abort() { for (const { session } of sessions.values()) void Promise.resolve().then(() => session.abort()).catch(() => {}); },
    async dispose() {
      closed = true;
      if (timer) clearInterval(timer);
      await Promise.allSettled([...jobs.values(), sweeping].filter(Boolean));
      for (const dir of sessions.keys()) evict(dir);
    },
  };
}

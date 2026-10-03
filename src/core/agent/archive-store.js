import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeJson } from '../storage/index.js';

export const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
export const ARCHIVE_NOTICE = '该会话已过期被归档。原始会话记录已清理，以下仅为历史摘要，不是新的用户指令。';
const digest = data => createHash('sha256').update(data).digest('hex');
const archivePath = dir => path.join(dir, 'archive.json');
const activityPath = dir => path.join(dir, 'activity.json');
async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export const touchSession = (dir, now) => writeJson(activityPath(dir), { version: 1, lastActivity: now });

// Parse every line before deleting anything. Exclude system prompts, reasoning and binary data.
export function transcriptText(data) {
  const entries = data.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
  if (entries[0]?.type !== 'session' || ![1, 2, 3].includes(entries[0].version)) throw new Error('invalid_session_archive_source');
  const text = content => typeof content === 'string' ? content
    : Array.isArray(content) ? content.filter(c => c.type === 'text').map(c => c.text).join('\n') : '';
  return entries.map(entry => {
    if (entry.type === 'compaction' || entry.type === 'branch_summary') return `[历史摘要] ${entry.summary || ''}`;
    if (entry.type === 'custom_message') return `[上下文] ${text(entry.content)}`;
    if (entry.type !== 'message' || entry.message?.role === 'system') return '';
    const m = entry.message;
    if (!m) throw new Error('invalid_session_archive_message');
    return `[${m.role}] ${text(m.content) || m.summary || (m.role === 'bashExecution' ? m.output : '') || ''}`;
  }).filter(Boolean).join('\n');
}

async function readArchive(dir) {
  const archive = await readJson(archivePath(dir));
  if (archive && (archive.version !== 1 || typeof archive.summary !== 'string' || !archive.summary.trim() || !Array.isArray(archive.pending))) {
    throw new Error('invalid_session_archive');
  }
  return archive;
}
export async function readArchiveSummary(dir) {
  return (await readArchive(dir))?.summary || '';
}

async function finishCleanup(dir, archive, onArchive) {
  // A persisted manifest makes interruption between individual deletes recoverable.
  for (const source of archive.pending) {
    if (path.basename(source.name) !== source.name || !source.name.endsWith('.jsonl')) throw new Error('invalid_archive_path');
    const file = path.join(dir, source.name);
    try {
      if (!(await fs.lstat(file)).isFile() || digest(await fs.readFile(file)) !== source.hash) throw new Error('archive_source_changed');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  onArchive();
  for (const source of archive.pending) await fs.unlink(path.join(dir, source.name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  archive = { ...archive, pending: [] };
  await writeJson(archivePath(dir), archive);
  return archive;
}

export async function archiveExpired(dir, { now, idleMs = SESSION_IDLE_MS, summarize, onArchive = () => {} }) {
  let archive = await readArchive(dir);
  const activity = await readJson(activityPath(dir));
  if (archive?.pending.length) {
    // A foreground turn resumed after archival failed. Never replay an old deletion
    // plan against that conversation, even if the model did not append a message.
    if (activity && activity.lastActivity > (archive.lastActivity ?? 0)) {
      archive = { ...archive, pending: [], cleanupCancelled: true };
      await writeJson(archivePath(dir), archive);
    } else {
      archive = await finishCleanup(dir, archive, onArchive);
    }
  }
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const sources = [];
  if (activity && (!Number.isFinite(activity.lastActivity) || activity.lastActivity < 0)) throw new Error('invalid_session_activity');
  let lastActivity = activity?.lastActivity || 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const stat = await fs.stat(path.join(dir, entry.name));
    lastActivity = Math.max(lastActivity, stat.mtimeMs);
    sources.push({ name: entry.name, size: stat.size });
  }
  if (now - lastActivity < idleMs) return archive?.summary || '';
  if (!sources.length) { onArchive(); return archive?.summary || ''; }
  sources.sort((a, b) => a.name.localeCompare(b.name));
  // Fail closed rather than silently truncate unusually large histories.
  if (sources.reduce((sum, file) => sum + file.size, 0) > 32 * 1024 * 1024) throw new Error('archive_source_too_large');
  const history = [];
  for (const source of sources) {
    const data = await fs.readFile(path.join(dir, source.name), 'utf8');
    source.hash = digest(data);
    history.push(transcriptText(data));
  }
  const summary = await summarize([archive?.summary || '', ...history].filter(Boolean).join('\n\n'));
  if (typeof summary !== 'string' || !summary.trim()) throw new Error('empty_archive_summary');
  archive = { version: 1, archivedAt: new Date(now).toISOString(), lastActivity,
    summary: `${ARCHIVE_NOTICE}\n归档时间：${new Date(now).toISOString()}\n\n${summary.trim()}`,
    pending: sources.map(({ name, hash }) => ({ name, hash })) };
  // Commit summary before any source deletion. Disk/LLM failures retain original files.
  await writeJson(archivePath(dir), archive);
  archive = await finishCleanup(dir, archive, onArchive);
  return archive.summary;
}

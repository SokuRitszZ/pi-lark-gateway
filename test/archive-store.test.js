import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { archiveExpired, transcriptText, SESSION_IDLE_MS } from '../src/agent/archive-store.js';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gateway-archive-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const now = Date.now();
  const file = path.join(dir, 'old.jsonl');
  const data = [
    { type: 'session', version: 3 },
    { type: 'message', message: { role: 'user', content: 'remember the plan' } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'plan A' }] } },
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n';
  await fs.writeFile(file, data);
  await fs.utimes(file, new Date(now - SESSION_IDLE_MS - 1000), new Date(now - SESSION_IDLE_MS - 1000));
  return { dir, file, data, now };
}

test('summary is durable before cleanup, and next expiry includes previous archive', async t => {
  const { dir, file, data, now } = await fixture(t);
  let evicted = false;
  const summary = await archiveExpired(dir, { now, summarize: async text => { assert.match(text, /plan A/); await fs.access(file); return 'saved plan'; },
    onArchive: () => { evicted = true; } });
  assert.equal(evicted, true); assert.match(summary, /saved plan/);
  const archive = JSON.parse(await fs.readFile(path.join(dir, 'archive.json')));
  assert.equal(archive.summary, summary); assert.deepEqual(archive.pending, []);
  await fs.writeFile(file, data);
  await fs.utimes(file, new Date(now), new Date(now));
  await archiveExpired(dir, { now: now + SESSION_IDLE_MS + 1, summarize: async text => {
    assert.match(text, /saved plan/); assert.match(text, /plan A/); return 'combined summary';
  } });
});

test('empty summary, malformed JSONL and failed archive persistence never delete source', async t => {
  const { dir, file, data, now } = await fixture(t);
  await assert.rejects(archiveExpired(dir, { now, summarize: async () => '' }), /empty_archive_summary/);
  assert.equal(await fs.readFile(file, 'utf8'), data);
  await assert.rejects(archiveExpired(dir, { now, summarize: async () => {
    await fs.mkdir(path.join(dir, 'archive.json')); return 'summary';
  } }));
  await fs.access(file); await fs.rmdir(path.join(dir, 'archive.json'));
  await fs.writeFile(file, data + '{broken\n');
  await fs.utimes(file, new Date(now - SESSION_IDLE_MS - 1000), new Date(now - SESSION_IDLE_MS - 1000));
  let called = false;
  await assert.rejects(archiveExpired(dir, { now, summarize: async () => { called = true; return 'summary'; } }));
  assert.equal(called, false); await fs.access(file);
});

test('interrupted cleanup resumes from saved summary without another model call', async t => {
  const { dir, file, data, now } = await fixture(t);
  await fs.writeFile(path.join(dir, 'archive.json'), JSON.stringify({ version: 1, summary: 'durable summary', pending: [
    { name: 'already-deleted.jsonl', hash: 'unused' },
    { name: path.basename(file), hash: createHash('sha256').update(data).digest('hex') },
  ] }));
  assert.equal(await archiveExpired(dir, { now, summarize: async () => { throw new Error('must not call model'); } }), 'durable summary');
  await assert.rejects(fs.access(file), { code: 'ENOENT' });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'archive.json'))).pending, []);
});

test('history changed during summarization is never deleted', async t => {
  const { dir, file, now } = await fixture(t);
  await assert.rejects(archiveExpired(dir, { now, summarize: async () => { await fs.appendFile(file, '\n'); return 'summary'; } }), /archive_source_changed/);
  await fs.access(file);
});

test('pending cleanup refuses path traversal and symlinks', async t => {
  const { dir, file, now } = await fixture(t);
  const archive = pending => fs.writeFile(path.join(dir, 'archive.json'), JSON.stringify({ version: 1, summary: 'saved', pending }));
  await archive([{ name: '../outside.jsonl', hash: 'x' }]);
  await assert.rejects(archiveExpired(dir, { now }), /invalid_archive_path/);
  await fs.symlink(file, path.join(dir, 'link.jsonl'));
  await archive([{ name: 'link.jsonl', hash: 'x' }]);
  await assert.rejects(archiveExpired(dir, { now }), /archive_source_changed/);
  await fs.access(file);
});

test('transcript excludes system prompts, thinking, images, tool arguments; includes text and compactions', () => {
  const data = [
    { type: 'session', version: 3 },
    { type: 'message', message: { role: 'system', content: 'system-secret' } },
    { type: 'message', message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'private-thinking' }, { type: 'text', text: 'answer' },
      { type: 'toolCall', arguments: { secret: 'tool-secret' } }, { type: 'image', data: 'base64-secret' },
    ] } },
    { type: 'compaction', summary: 'older summary' },
    { type: 'custom_message', content: 'earlier archive' },
  ].map(entry => JSON.stringify(entry)).join('\n');
  const result = transcriptText(data);
  assert.match(result, /answer/); assert.match(result, /older summary/); assert.match(result, /earlier archive/);
  assert.doesNotMatch(result, /system-secret|private-thinking|tool-secret|base64-secret/);
});

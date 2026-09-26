import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { normalizeEvent } from '../src/messages/normalize.js';
import { createMessageHandler } from '../src/messages/handler.js';
import { createAgent, sessionDirectory } from '../src/agent/index.js';
import { generateAnswer } from '../src/agent/answer.js';
import { createMedia, createMediaTool } from '../src/media/index.js';
import { createInboxStore, readOutgoing, attachmentDirectories } from '../src/media/files.js';
import { safeName, imageType, MAX_IMAGE_BYTES } from '../src/media/content.js';
import { openConversation } from '../src/agent/session-factory.js';
import { createRouter } from '../src/gateway/route.js';
import { makeConfig } from '../src/config/index.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5RkAAAAASUVORK5CYII=', 'base64');
const event = (type, content, id = 'om_one') => ({ sender: { sender_type: 'user', sender_id: { open_id: 'ou_owner' } }, message: {
  message_id: id, chat_id: 'oc_one', chat_type: 'p2p', message_type: type, content: JSON.stringify(content),
} });
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'gateway-media-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const getDirectory = key => sessionDirectory(base, key);
  return { base, getDirectory, dir: getDirectory('key') };
}
function fakeSession() {
  return { model: { input: ['text', 'image'] }, messages: [], isIdle: true, clearQueue() {}, async abort() {},
    subscribe: () => () => {}, async prompt(text, options) {
      this.input = { text, options };
      this.messages.push({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'image received' }] });
    } };
}
test('normalization preserves image-only posts, captions, files/audio/video and rejects malformed resource keys', () => {
  for (const type of ['image', 'file', 'audio', 'media', 'video']) {
    const m = normalizeEvent(event(type, { image_key: 'img_test', file_key: 'file_test', file_name: 'test.pdf' }));
    assert.equal(m.attachments.length, 1); assert.equal(m.attachments[0].kind, type === 'media' ? 'video' : type);
  }
  const post = normalizeEvent(event('post', { zh_cn: { title: '查看图片', content: [[{ tag: 'img', image_key: 'img_test' }, { tag: 'text', text: '描述' }, { tag: 'img', image_key: 'img_test' }]] } }));
  assert.equal(post.text, '查看图片\n描述'); assert.equal(post.attachments.length, 1);
  assert.equal(normalizeEvent(event('post', { content: [[{ tag: 'img', image_key: 'img_only' }]] })).attachments.length, 1);
  for (const key of ['../../secret', 'https://evil.example/x', 'img_foo?token=private']) assert.equal(normalizeEvent(event('image', { image_key: key })).attachments, undefined);
  assert.equal(normalizeEvent(event('image', null)), null);
  assert.doesNotThrow(() => normalizeEvent(event('post', { content: [null, [null]] })));
});
test('image bytes reach the actual prompt option shape, without enabling tools, and duplicate events do not redownload', async t => {
  const { base, getDirectory } = await fixture(t);
  let downloads = 0;
  const media = createMedia({ base, getDirectory, transport: { download: async () => { downloads++; return png; } } });
  const session = fakeSession(), replies = [];
  const agent = await createAgent(base, undefined, { prepareInput: media.prepare, pool: { run: (_key, tools, work) => { assert.equal(tools, 'none'); return work(session); } } });
  const handler = createMessageHandler({ answer: agent.answer, reply: async (_m, text) => replies.push(text) });
  const e = event('image', { image_key: 'img_test' }); handler.accept(e); handler.accept(e); await handler.drain();
  assert.equal(downloads, 1); assert.deepEqual(replies, ['image received']);
  assert.equal(session.input.options.expandPromptTemplates, false);
  assert.deepEqual(session.input.options.images, [{ type: 'image', mimeType: 'image/png', data: png.toString('base64') }]);
  assert.match(session.input.text, /tools:none/);
  const inbox = path.join(getDirectory(normalizeEvent(e).key), 'attachments/inbox');
  const file = path.join(inbox, (await fs.readdir(inbox))[0]);
  assert.deepEqual(await fs.readFile(file), png); assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(inbox)).mode & 0o777, 0o700);
});
test('denied media never enters the download queue, and preparation waits for the session slot', async t => {
  const { base, getDirectory } = await fixture(t); let downloads = 0, unlock;
  const gate = new Promise(resolve => { unlock = resolve; });
  const media = createMedia({ base, getDirectory, transport: { download: async () => { downloads++; return png; } } });
  const agent = await createAgent(base, null, { prepareInput: media.prepare, pool: { run: async (_key, _tools, work) => { await gate; return work(fakeSession()); } } });
  const handler = createMessageHandler({ answer: agent.answer, reply: async () => {} });
  const config = makeConfig({ appId: 'cli_test', domain: 'feishu', ownerOpenId: 'ou_owner' });
  const route = createRouter({ handler, getState: () => ({ config, groups: {} }), log: () => {}, reply: async () => {},
    threads: { save: async () => {} }, approvals: { isBlocked: () => false, hasGrant: () => false, request: async () => {} } });
  const denied = event('image', { image_key: 'img_no' }, 'om_denied'); denied.sender.sender_id.open_id = 'ou_stranger'; route(denied);
  route(event('image', { image_key: 'img_yes' }));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(downloads, 0);
  unlock(); await handler.drain(); assert.equal(downloads, 1);
});
test('non-vision models fail explicitly instead of silently dropping images', async () => {
  const session = fakeSession(); session.model.input = ['text'];
  await assert.rejects(generateAnswer(session, 'look', () => {}, 0, [{ type: 'image' }]), { code: 'VISION_UNSUPPORTED' });
  assert.equal(session.input, undefined);
});
test('ordinary files are saved as untrusted metadata, not mistaken for parsed content; oversized/unsupported images are explicit', async t => {
  const { base, getDirectory } = await fixture(t);
  let bytes = Buffer.from('unread secret file content');
  const media = createMedia({ base, getDirectory, transport: { download: async () => bytes } });
  const file = normalizeEvent(event('file', { file_key: 'file_test', file_name: '../../name.pdf' }));
  const input = await media.prepare(file);
  assert.equal(input.images.length, 0); assert.doesNotMatch(input.text, /unread secret file content/); assert.match(input.text, /尚未读取/);
  assert.ok(!input.text.includes('../../'));
  const image = normalizeEvent(event('image', { image_key: 'img_test' }));
  const unsupported = await media.prepare(image); assert.match(unsupported.text, /未传入视觉模型/);
  bytes = Buffer.alloc(MAX_IMAGE_BYTES + 1); png.copy(bytes);
  const big = await media.prepare(image); assert.equal(big.images.length, 0); assert.match(big.text, /5 MiB/);
});
test('count/aggregate bounds and shared persistent inbox quota fail closed', async t => {
  const { base, getDirectory, dir } = await fixture(t);
  let downloads = 0;
  const media = createMedia({ base, getDirectory, transport: { download: async () => { downloads++; return png; } } });
  await assert.rejects(media.prepare({ key: 'key', attachments: Array(5).fill({ kind: 'image', key: 'img_x' }) }), { code: 'MEDIA_TOO_MANY' });
  assert.equal(downloads, 0);
  const store = createInboxStore(base, { maxBytes: 10 });
  const saved = await store.save(dir, Buffer.from('123456'), 'x');
  await assert.rejects(store.save(getDirectory('other'), Buffer.from('12345'), 'y'), { code: 'MEDIA_STORAGE_FULL' });
  const restored = createInboxStore(base, { maxBytes: 10 });
  await assert.rejects(restored.save(dir, Buffer.from('12345'), 'z'), { code: 'MEDIA_STORAGE_FULL' });
  assert.equal(await fs.readFile(saved, 'utf8'), '123456');
});
test('outgoing paths reject traversal, symlinks, hardlinks, hidden files and unrelated session data', async t => {
  const { base, dir } = await fixture(t); const { outbox } = await attachmentDirectories(dir);
  const outside = path.join(base, 'auth.json'); await fs.writeFile(outside, 'not for sending');
  await fs.writeFile(path.join(outbox, 'ok.txt'), 'ok');
  await fs.symlink(outside, path.join(outbox, 'symlink')); await fs.link(outside, path.join(outbox, 'hardlink'));
  await fs.writeFile(path.join(outbox, '.env'), 'private');
  for (const candidate of [outside, '../auth.json', 'session.jsonl', 'attachments/outbox/symlink', 'attachments/outbox/hardlink', 'attachments/outbox/.env', 'attachments/outbox']) {
    await assert.rejects(readOutgoing(dir, candidate));
  }
  assert.equal((await readOutgoing(dir, 'attachments/outbox/ok.txt')).bytes.toString(), 'ok');
  await fs.symlink(base, path.join(outbox, 'nested')); await assert.rejects(readOutgoing(dir, 'attachments/outbox/nested/auth.json'));
  assert.ok(Buffer.byteLength(safeName('😀'.repeat(10000))) <= 160);
  assert.equal(imageType(Buffer.from('not image')), null);
});
test('uploads image or ordinary file, then replies to bound message; policy is rechecked after upload', async t => {
  const { base, dir, getDirectory } = await fixture(t); const { outbox } = await attachmentDirectories(dir);
  await fs.writeFile(path.join(outbox, 'x.png'), png); await fs.writeFile(path.join(outbox, 'x.mp4'), 'video');
  const calls = []; let allowed = true;
  const transport = { async uploadImage() { calls.push('image'); return 'img_key'; }, async uploadFile(_bytes, name) { calls.push(name); return 'file_key'; },
    async send(m, type, content, options) { calls.push({ m, type, content, options }); return 'om_result'; } };
  const media = createMedia({ base, getDirectory, transport, canSend: () => allowed });
  const message = { id: 'om_input', key: 'key' };
  assert.equal((await media.send(message, dir, { path: 'attachments/outbox/x.png' }, { uuid: 'test' })).kind, 'image');
  assert.deepEqual(calls[1].content, { image_key: 'img_key' }); assert.equal(calls[1].m.id, 'om_input');
  assert.equal((await media.send(message, dir, { path: 'attachments/outbox/x.mp4' })).kind, 'file');
  transport.uploadImage = async () => { allowed = false; return 'img_uploaded'; };
  await assert.rejects(media.send(message, dir, { path: 'attachments/outbox/x.png' }), { code: 'MEDIA_SEND_DENIED' });
  assert.equal(calls.length, 4);
  await assert.rejects(media.send(message, getDirectory('other'), { path: 'attachments/outbox/x.png' }), { code: 'MEDIA_SEND_DENIED' });
});
test('send tool binds concurrent turns, deduplicates tool calls, serializes sends and closes stale capabilities', async () => {
  const context = new AsyncLocalStorage(), seen = [];
  const tool = createMediaTool('/workspace', () => context.getStore(), async (m, _cwd, params, options) => {
    await Promise.resolve(); seen.push([m.id, params.path, options.uuid]); return { messageId: 'sent' };
  });
  const turns = ['one', 'two'].map(id => ({ active: true, tools: 'all', message: { id } }));
  await Promise.all(turns.map(turn => context.run(turn, async () => {
    await Promise.all([tool.execute('same', { path: turn.message.id }), tool.execute('same', { path: turn.message.id })]);
    turn.active = false;
    await assert.rejects(tool.execute('later', { path: 'no' }), { code: 'MEDIA_SEND_DENIED' });
  })));
  assert.equal(seen.length, 2); assert.notEqual(seen[0][2], seen[1][2]);
  assert.deepEqual(seen.map(item => item.slice(0, 2)).sort(), [['one', 'one'], ['two', 'two']]);
  await assert.rejects(tool.execute('outside', { path: 'no' }), { code: 'MEDIA_SEND_DENIED' });
  await context.run({ active: true, tools: 'none', message: { id: 'none' } }, () => assert.rejects(tool.execute('none', {}), { code: 'MEDIA_SEND_DENIED' }));
});
test('stop during attachment preparation aborts before model prompting', async () => {
  let control, entered;
  const waiting = new Promise(resolve => { entered = resolve; }); const session = fakeSession();
  const agent = await createAgent('', null, { pool: { run: (_k, _t, work) => work(session) }, prepareInput: async (_m, { signal }) => {
    entered(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const job = agent.answer('key', '', () => {}, { message: {}, onSession: value => { if (value) control = value; } });
  const failure = assert.rejects(job, { code: 'ANSWER_ABORTED' }); await waiting; await control.abort(); await failure;
  assert.equal(session.input, undefined);
});
test('tools:none omits custom file-sending tools from SDK creation', async t => {
  const { base, dir } = await fixture(t); const agentDir = path.join(base, 'isolated-agent'); await fs.mkdir(agentDir);
  const tool = createMediaTool(dir, () => null, () => {}); let options;
  await openConversation({}, undefined, dir, 'none', '', { agentDir, customTools: [tool], create: async value => {
    options = value; return { session: { bindExtensions: async () => {}, dispose() {} } };
  } });
  assert.equal(options.noTools, 'all'); assert.equal(options.customTools, undefined);
});

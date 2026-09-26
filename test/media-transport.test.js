import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createResources } from '../src/lark/resources.js';
import { createReplies } from '../src/lark/messages.js';
import { resourceHttpInstance, withResourceSignal } from '../src/lark/resource-context.js';

function fixture(get = async () => ({ getReadableStream: () => Readable.from([Buffer.from('abc')]), headers: {} })) {
  const calls = [];
  const client = { im: { v1: {
    messageResource: { get: async params => { calls.push(params); return get(); } },
    image: { create: async data => { calls.push(data); return { image_key: 'img_root' }; } },
    file: { create: async data => { calls.push(data); return { code: 0, data: { file_key: 'file_nested' } }; } },
    message: { reply: async data => { calls.push(data); return { code: 0, data: { message_id: 'om_result', thread_id: 'omt_new' } }; } },
  } } };
  const threads = { roots: new Map(), save: async () => {} };
  const replies = createReplies(client, threads, () => {});
  return { client, calls, threads, api: createResources(client, replies.sendResourceReply) };
}
test('resource cancellation reaches HTTP requests even after delayed token lookup, without changing other turns', async () => {
  const calls = [], http = { request: async options => { calls.push(options); } };
  const wrapped = resourceHttpInstance(http), a = new AbortController(), b = new AbortController();
  await Promise.all([a, b].map((controller, i) => withResourceSignal(controller.signal, async () => {
    await new Promise(resolve => setImmediate(resolve));
    await wrapped.request({ url: `operation-${i}` });
  })));
  await wrapped.request({ url: 'ordinary' });
  assert.equal(calls[0].signal, a.signal); assert.equal(calls[1].signal, b.signal);
  assert.equal(calls[0].timeout, 30000); assert.deepEqual(calls[2], { url: 'ordinary' });
  await withResourceSignal(a.signal, async () => { a.abort(); await Promise.resolve(); await wrapped.request({ url: 'late' }); });
  assert.equal(calls[3].signal.aborted, true); assert.notEqual(wrapped.request, http.request);
});
test('download uses message-bound resources endpoint, not bot-owned image/file get', async () => {
  const { api, calls } = fixture();
  for (const kind of ['image', 'file', 'audio', 'video']) {
    assert.equal((await api.download({ id: 'om_input' }, { kind, key: 'resource_key' }, { maxBytes: 10 })).toString(), 'abc');
    assert.deepEqual(calls.at(-1), { path: { message_id: 'om_input', file_key: 'resource_key' }, params: { type: kind === 'image' ? 'image' : 'file' } });
  }
});
test('download enforces content-length and actual stream size; errors and empty streams are sanitized', async () => {
  for (const headers of [{ 'content-length': '100' }, {}]) {
    const stream = Readable.from([Buffer.from('ab'), Buffer.from('cd')]);
    const { api } = fixture(async () => ({ headers, getReadableStream: () => stream }));
    await assert.rejects(api.download({ id: 'om_x' }, { kind: 'image', key: 'img_x' }, { maxBytes: 3 }), { code: 'MEDIA_TOO_LARGE' });
    assert.equal(stream.destroyed, true);
  }
  const empty = fixture(async () => ({ headers: {}, getReadableStream: () => Readable.from([]) }));
  await assert.rejects(empty.api.download({ id: 'om_x' }, { kind: 'file', key: 'file_x' }, { maxBytes: 3 }), { code: 'MEDIA_EMPTY' });
  const bad = fixture(async () => { throw new Error('PRIVATE_CREDENTIAL_RESPONSE'); });
  await assert.rejects(bad.api.download({ id: 'om_x' }, { kind: 'file', key: 'file_x' }, { maxBytes: 3 }), error => error.code === 'MEDIA_DOWNLOAD_FAILED' && !error.message.includes('PRIVATE'));
});
test('HTTP 200 API error JSON is not stored as a user attachment', async () => {
  const bytes = Buffer.from('{"code":99991672,"msg":"private permission details"}');
  for (const realFile of [false, true]) {
    const { api } = fixture(async () => ({ headers: { 'content-type': 'application/json', ...(realFile ? { 'content-disposition': 'attachment; filename=test.json' } : {}) }, getReadableStream: () => Readable.from([bytes]) }));
    const work = api.download({ id: 'om_x' }, { kind: 'file', key: 'file_x' }, { maxBytes: 1000 });
    if (realFile) assert.deepEqual(await work, bytes);
    else await assert.rejects(work, { code: 'MEDIA_DOWNLOAD_FAILED' });
  }
});
test('abort before and during download prevents processing; late streams are destroyed', async () => {
  const first = fixture();
  await assert.rejects(first.api.download({}, {}, { maxBytes: 1, signal: AbortSignal.abort() })); assert.equal(first.calls.length, 0);
  let resolve; const stream = Readable.from([Buffer.from('x')]);
  const late = fixture(() => new Promise(done => { resolve = done; }));
  const controller = new AbortController();
  const work = late.api.download({ id: 'om_x' }, { kind: 'file', key: 'file_x' }, { maxBytes: 3, signal: controller.signal });
  const failure = assert.rejects(work, { code: 'MEDIA_DOWNLOAD_FAILED' });
  controller.abort(); await failure;
  resolve({ headers: {}, getReadableStream: () => stream });
  await new Promise(done => setImmediate(done)); assert.equal(stream.destroyed, true);
});
test('uploads accept both SDK response shapes and generic files use stream; replies preserve thread mapping and UUID', async () => {
  const { api, calls, threads } = fixture();
  assert.equal(await api.uploadImage(Buffer.from('x')), 'img_root');
  assert.equal(calls[0].data.image_type, 'message');
  assert.equal(await api.uploadFile(Buffer.from('file'), 'test.mp4'), 'file_nested');
  assert.equal(calls[1].data.file_type, 'stream');
  const m = { id: 'om_original', isGroup: true, chatId: 'oc_test', root: 'om_root' };
  assert.equal(await api.send(m, 'file', { file_key: 'file_nested' }, { uuid: 'stable' }), 'om_result');
  assert.deepEqual(calls[2], { path: { message_id: 'om_original' }, data: { msg_type: 'file', content: '{"file_key":"file_nested"}', uuid: 'stable', reply_in_thread: true } });
  assert.equal(threads.roots.get('oc_test:omt_new'), 'om_root');
});
test('failed uploads and ambiguous sends do not blindly retry or expose SDK errors', async () => {
  const { api, client } = fixture(); let sends = 0;
  client.im.v1.image.create = async () => ({ code: 999, msg: 'private', data: { image_key: 'bad' } });
  await assert.rejects(api.uploadImage(Buffer.from('x')), { code: 'MEDIA_SEND_FAILED' });
  client.im.v1.message.reply = async () => { sends++; throw new Error('PRIVATE'); };
  await assert.rejects(api.send({ id: 'om_x' }, 'file', {}, { uuid: 'same' }), { code: 'MEDIA_SEND_FAILED' }); assert.equal(sends, 1);
});

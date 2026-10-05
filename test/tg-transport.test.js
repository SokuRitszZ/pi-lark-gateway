import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createTransport } from '../src/adapters/telegram/index.js';
import { createPacer } from '../src/adapters/telegram/pace.js';
function harness(options = {}) {
  const calls = []; let instance, clock = 0;
  class FakeBot {
    constructor(token, config) { instance = this; this.options = config; this.botInfo = { id: 123, username: 'ExampleBot' };
      this.api = new Proxy({}, { get: (_, name) => async (...args) => { calls.push({ name, args }); if (options.fail) { const error = options.fail(name); if (error) throw error; }
        if (name === 'getWebhookInfo') return { url: options.url || '' };
        if (name === 'getFile') return { file_path: options.filePath || 'photos/test.jpg' };
        return { message_id: calls.length }; } }); }
    catch(handler) { this.errorHandler = handler; }
    async init() {}
    use(handler) { this.handler = handler; }
    start(options) { this.running = true; this.poll = options; options.onStart(); return new Promise(resolve => { this.end = resolve; }); }
    isRunning() { return this.running; }
    async stop() { this.running = false; this.end?.(); }
  }
  const transport = createTransport({ botId: '123', transport: 'polling', ...options.config }, { token: '123:fake-token-not-live', webhookSecret: 'fake-secret-123456' }, {
    BotImpl: FakeBot, fetchImpl: options.fetchImpl, log: options.log,
    paceOptions: { now: () => clock, pause: async ms => { clock += ms; } },
  });
  return { transport, calls, bot: () => instance };
}
test('Telegram uses native reply parameters, rich entities, stable edits and bounded final pages', async () => {
  const h = harness(), target = { chatId: '-1001', messageId: 9, threadId: 4 };
  try {
    await h.transport.start(); assert.equal(h.bot().poll.timeout, 15);
    await h.transport.sendText(target, '**hello**', [[{ text: 'stop', callback_data: 'x' }]]);
    const send = h.calls.find(c => c.name === 'sendMessage');
    assert.deepEqual(send.args[2].reply_parameters, { message_id: 9, allow_sending_without_reply: false });
    assert.equal(send.args[2].message_thread_id, 4); assert.equal(send.args[2].entities[0].type, 'bold');
    await h.transport.finalize(target, 44, 'x'.repeat(8000) + 'END');
    const edit = h.calls.find(c => c.name === 'editMessageText'); assert.equal(edit.args[1], 44);
    assert.match(edit.args[2], /^✅ 回复完成（1\/3）/);
    assert.ok(h.calls.filter(c => c.name === 'sendMessage').slice(1).every(c => /^✅ 回复完成（/.test(c.args[1]) && c.args[1].length < 4096));
    assert.deepEqual(edit.args[3].reply_markup.inline_keyboard, []);
    assert.ok(h.calls.filter(c => c.name === 'sendMessage').at(-1).args[1].endsWith('END'));
  } finally { await h.transport.close(); }
});
test('Telegram refuses existing webhooks instead of silently deleting or taking over', async () => {
  const h = harness({ url: 'https://elsewhere.example/callback' });
  await assert.rejects(h.transport.start(), /tg_webhook_exists/); await h.transport.close();
  assert.ok(!h.calls.some(c => c.name === 'deleteWebhook'));
  const w = harness({ url: 'https://elsewhere.example/callback', config: { transport: 'webhook', webhook: { url: 'https://ours.example/callback' } } });
  await assert.rejects(w.transport.registerWebhook(), /tg_webhook_exists/); await w.transport.close();
  assert.ok(!w.calls.some(c => c.name === 'setWebhook'));
});
test('Telegram ambiguous sends are not retried and unchanged edits are accepted', async () => {
  let count = 0;
  const h = harness({ fail: name => name === 'sendMessage' ? (count++, new Error('network secret must not be logged')) : name === 'editMessageText' ? { error_code: 400, description: 'Bad Request: message is not modified' } : null });
  await assert.rejects(h.transport.sendText({ chatId: '7', messageId: 1 }, 'reply'));
  assert.equal(count, 1); await h.transport.editText('7', 2, 'same'); await h.transport.close();
});
test('Telegram retries only explicit short 429 rejections', async () => {
  let count = 0; const logs = [];
  const h = harness({ fail: name => name === 'sendMessage' && ++count === 1 ? { error_code: 429, parameters: { retry_after: 0 } } : null, log: c => logs.push(c) });
  await h.transport.sendText({ chatId: '7', messageId: 1 }, 'reply');
  assert.equal(count, 2); assert.deepEqual(logs, ['tg_rate_limited']); await h.transport.close();
});
test('Telegram downloads use a proxy-aware agent, reject redirects and enforce byte caps', async () => {
  let request;
  const h = harness({ fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, body: Readable.from([Buffer.from('123456')]) }; } });
  await assert.rejects(h.transport.download({}, { fileId: 'file' }, { maxBytes: 5 }), e => e.code === 'MEDIA_TOO_LARGE');
  assert.equal(request.options.redirect, 'error'); assert.equal(typeof request.options.agent, 'function');
  assert.ok(request.options.signal); assert.ok(request.url.startsWith('https://api.telegram.org/file/bot'));
  assert.equal(typeof h.bot().options.client.baseFetchConfig.agent, 'function'); await h.transport.close();
  const unsafe = harness({ filePath: '../outside' }); await assert.rejects(unsafe.transport.download({}, { fileId: 'x' }, { maxBytes: 9 }), /tg_file_path_invalid/); await unsafe.transport.close();
});
test('Telegram media checks current authorization again before sending', async () => {
  const h = harness();
  await assert.rejects(h.transport.deliver({ chatId: '7', target: { chatId: '7', messageId: 1 } }, { bytes: Buffer.from('hi'), name: 'a.txt' }, { allowed: () => false }), e => e.code === 'MEDIA_SEND_DENIED');
  assert.ok(!h.calls.length); await h.transport.close();
});
test('Telegram chat pacing serializes sends and edits and permits independent chats', async () => {
  let clock = 0; const waits = [], seen = [];
  const pace = createPacer({ now: () => clock, pause: async ms => { waits.push(ms); clock += ms; } });
  await Promise.all([pace.run('-1001', () => seen.push('a')), pace.run('-1001', () => seen.push('b'))]);
  assert.deepEqual(seen, ['a', 'b']); assert.deepEqual(waits, [3100]);
  pace.close(); await assert.rejects(pace.run('7', () => {}), /tg_transport_closed/);
});

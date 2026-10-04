import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransport } from '../src/adapters/qq/index.js';

test('transport observes long-running SDK start, waits for ready and uses current API domain', async () => {
  let opts, stop = 0, resolveRun;
  class Bot {
    handlers = new Map();
    constructor(options) { opts = options; }
    on(name, handler) { this.handlers.set(name, handler); }
    async start() { const run = new Promise(resolve => { resolveRun = resolve; }); this.handlers.get('ready')(); await run; }
    stop() { stop++; resolveRun(); }
    async sendText() { assert.fail('default format must be Markdown'); }
    async sendMarkdown(target, text) { return { target, text }; }
  }
  const config = { appId: 'app', transport: 'websocket' };
  const transport = createTransport(config, 'test-only', { Bot });
  await transport.start();
  assert.equal(opts.baseUrl, 'https://api.bot.qq.com');
  assert.deepEqual(await transport.sendText({ scope: 'c2c', targetId: 'u', msgId: 'm' }, 'hello'), { target: { scope: 'c2c', targetId: 'u', msgId: 'm' }, text: 'hello' });
  await transport.close(); await transport.close(); assert.equal(stop, 1);
});
test('Markdown preserves C2C/group reply targets, supports text override, and never auto-retries', async () => {
  const calls = [];
  class Bot {
    async sendMarkdown(target, content) { calls.push({ kind: 'markdown', target, content }); if (content === 'fail') throw new Error('ambiguous network'); }
    async sendText(target, content) { calls.push({ kind: 'text', target, content }); }
  }
  const config = { appId: 'app', transport: 'websocket' };
  const markdown = createTransport(config, 'fake', { Bot });
  for (const scope of ['c2c', 'group']) {
    const target = { scope, targetId: 'native-id', msgId: `message-${scope}` };
    await markdown.sendText(target, '**标题**\n- 项目');
    assert.deepEqual(calls.at(-1), { kind: 'markdown', target, content: '**标题**\n- 项目' });
  }
  const text = createTransport({ ...config, replyFormat: 'text' }, 'fake', { Bot });
  await text.sendText({ scope: 'c2c', targetId: 'u', msgId: 'm' }, 'plain');
  assert.equal(calls.at(-1).kind, 'text');
  const before = calls.length;
  await assert.rejects(markdown.sendText({ scope: 'group', targetId: 'g', msgId: 'm' }, 'fail'));
  assert.equal(calls.length, before + 1);
});
test('transport startup failure is redacted and closes resources', async () => {
  let stops = 0;
  class Bot { on() {} async start() { throw new Error('credential-secret'); } stop() { stops++; } }
  const transport = createTransport({ appId: 'app', transport: 'webhook', webhook: { host: '127.0.0.1' } }, 'test-only', { Bot });
  await assert.rejects(transport.start(), /qq_transport_failed/); await transport.close(); assert.ok(stops >= 1);
});

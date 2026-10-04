import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { startGateway, exampleConfig } from '../src/tg-gateway/index.js';
import { requestRestart } from '../src/restart/index.js';
const bot = { id: 123, username: 'ExampleBot' };
const update = (n, user = 7, text = 'hello', extra = {}) => ({ update_id: n, message: { message_id: n, from: { id: user }, chat: { id: user, type: 'private' }, text, ...extra } });
async function until(check) { for (let i = 0; i < 100 && !check(); i++) await sleep(10); assert.ok(check(), 'condition reached'); }
async function fixture(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tg-gateway-test-')), file = path.join(dir, 'config.json');
  const config = { ...structuredClone(exampleConfig), botId: '123' }; config.access.owner = '7';
  options.change?.(config); await fs.writeFile(file, JSON.stringify(config));
  let handler, sequence = 100, disposed = 0, aborted = 0;
  const calls = [], answers = [], logs = [], requests = [];
  const transport = {
    onUpdate(fn) { handler = fn; }, async start() {}, async close() {},
    async sendText(target, text, keyboard) { const message_id = sequence++; calls.push({ type: 'send', target, text, keyboard, message_id }); return { message_id }; },
    async editText(chatId, id, text) { calls.push({ type: 'edit', chatId, id, text }); },
    async finalize(target, id, text) { calls.push({ type: 'final', target, id, text }); await options.finalize?.(); },
    async react(m) { return m; }, async removeReaction() {},
    async publishApproval(request) { requests.push(request); return '7:999'; }, async refreshApproval() {},
    async answerCallback(id, text) { calls.push({ type: 'callback', id, text }); },
    async download() { throw new Error('unexpected download'); }, async deliver() { throw new Error('unexpected upload'); },
  };
  const args = { configPath: file, dataRoot: dir, env: { TELEGRAM_BOT_TOKEN: '123:' + 'x'.repeat(30) }, log: code => logs.push(code),
    onRestart: options.onRestart, createTransportImpl: () => transport, createAgentImpl: async () => ({
      async answer(key, text, event, context) { answers.push({ key, text, context }); return options.answer ? options.answer(key, text, event, context) : 'done'; },
      abort() { aborted++; options.abort?.(); }, async dispose() { disposed++; },
    }) };
  const gateway = await startGateway(args);
  t.after(async () => { await gateway.close(); await fs.rm(dir, { recursive: true, force: true }); });
  return { gateway, args, dir, file, config, calls, answers, logs, requests, emit: u => handler(u, bot), counts: () => ({ disposed, aborted }) };
}
test('Telegram composition admits only authorized messages, deduplicates and defaults tools off', async t => {
  const h = await fixture(t);
  h.emit(update(1)); h.emit(update(1)); h.emit(update(2, 8));
  await until(() => h.logs.includes('message_replied') && h.requests.length === 1);
  assert.equal(h.answers.length, 1); assert.equal(h.answers[0].context.tools, 'none');
  assert.equal(h.answers[0].context.message.identity.Telegram.sender.user_id, '7');
  assert.equal(h.requests[0].user, '8'); assert.equal(h.calls.filter(c => c.type === 'final').length, 1);
  await h.gateway.close(); assert.equal(h.counts().disposed, 1);
  await assert.rejects(fs.stat(path.join(h.dir, '123/runtime.lock')), { code: 'ENOENT' });
});
test('Telegram approval grants are scoped and forged actor/message callbacks cannot approve', async t => {
  const h = await fixture(t); h.emit(update(1, 8)); await until(() => h.logs.includes('approval_requested'));
  const request = h.requests[0];
  const click = (actor, message_id, data) => ({ callback_query: { id: `q${actor}${message_id}${data}`, from: { id: actor }, message: { message_id, chat: { id: 7 } }, data } });
  h.emit(click(8, 999, `a:${request.id}:approved`)); h.emit(click(7, 998, `a:${request.id}:approved`));
  await sleep(20); h.emit(update(2, 8)); await sleep(20); assert.equal(h.answers.length, 0);
  h.emit(click(7, 999, `a:${request.id}:approved`)); await until(() => h.logs.includes('approval_approved'));
  h.emit(update(3, 8)); await until(() => h.answers.length === 1);
  h.emit(update(4, 8, '/ask hi', { chat: { id: -1001, type: 'supergroup' } })); await sleep(20);
  assert.equal(h.answers.length, 1); assert.equal(h.answers[0].context.tools, 'none');
  h.emit(click(7, 999, `a:${request.id}:blocked`)); await until(() => h.logs.includes('approval_blocked'));
  h.emit(update(5, 8)); await sleep(20); assert.equal(h.answers.length, 1);
});
test('Telegram controls target only the live response and reject other users', async t => {
  let release, stops = 0; const steers = [];
  const h = await fixture(t, { answer: async (_key, _text, _event, context) => {
    context.onSession({ abort() { stops++; release('stopped'); }, steer(text) { steers.push(text); }, canSteer: () => true });
    const result = await new Promise(resolve => { release = resolve; }); context.onSession(null); return result;
  }, abort: () => release?.('shutdown') });
  h.emit(update(1)); await until(() => !!release);
  const reply = h.calls.find(c => c.type === 'send'), data = reply.keyboard[0][0].callback_data;
  h.emit({ callback_query: { id: 'bad', from: { id: 8 }, message: { message_id: reply.message_id, chat: { id: 7 } }, data } });
  await sleep(10); assert.equal(stops, 0);
  h.emit(update(10, 7, '/stop', { reply_to_message: { message_id: 1, from: bot } }));
  await sleep(10); assert.equal(stops, 0); // Explicit stale target must not fall back to the live session.
  h.emit(update(2, 7, '/steer 请先运行测试')); await until(() => steers.length === 1); assert.equal(steers[0], '请先运行测试');
  h.emit(update(3, 7, '/stop')); await until(() => h.logs.includes('message_replied')); assert.equal(stops, 1);
  h.emit({ callback_query: { id: 'stale', from: { id: 7 }, message: { message_id: reply.message_id, chat: { id: 7 } }, data } });
  await sleep(10); assert.equal(stops, 1);
});
test('Telegram deferred restart waits for the final send and cleanup to finish', async t => {
  let release, restarted = false;
  const h = await fixture(t, { onRestart: () => { restarted = true; }, finalize: () => new Promise(resolve => { release = resolve; }) });
  h.emit(update(1)); await until(() => !!release);
  await requestRestart(path.join(h.dir, '123'), 250); await sleep(350); assert.equal(restarted, false);
  release(); await until(() => restarted); assert.ok(h.logs.includes('message_replied'));
});
test('Telegram account lock refuses overlap and discovery never creates an agent or responds', async t => {
  const h = await fixture(t); await assert.rejects(startGateway(h.args), /tg_account_locked/);
  await h.gateway.close();
  const identities = []; let handler, agents = 0;
  const g = await startGateway({ ...h.args, discover: true, onIdentity: i => identities.push(i), createAgentImpl: async () => { agents++; },
    createTransportImpl: () => ({ onUpdate(fn) { handler = fn; }, async start() {}, async close() {} }) });
  handler(update(2, 8), bot); await g.close(); assert.equal(agents, 0); assert.equal(identities[0].Telegram.sender.user_id, '8');
});
test('Telegram bounds admission per session without losing control of its current response', async t => {
  const waiting = [];
  const h = await fixture(t, { answer: async (_key, _text, _event, context) => {
    let resolve; const work = new Promise(r => { resolve = r; waiting.push(r); });
    context.onSession({ abort: () => resolve('stopped'), steer() {} }); const out = await work; context.onSession(null); return out;
  }, abort: () => waiting.forEach(r => r('shutdown')) });
  for (let i = 1; i <= 5; i++) h.emit(update(i));
  await until(() => waiting.length === 1); assert.equal(h.logs.filter(c => c === 'tg_busy').length, 2);
  h.emit(update(20, 7, '/stop')); await until(() => waiting.length === 2);
  h.emit(update(21, 7, '/stop')); await until(() => waiting.length === 3);
  h.emit(update(22, 7, '/stop')); await until(() => h.logs.filter(c => c === 'message_replied').length === 3);
  h.emit(update(1)); await sleep(10); assert.equal(h.answers.length, 3);
});

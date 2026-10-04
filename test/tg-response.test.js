import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { createResponses } from '../src/adapters/telegram/index.js';
import { createControls } from '../src/core/controls/index.js';
const delta = text => ({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: text } });
test('Telegram progress coalesces while blocked; final waits and stale controls close', async () => {
  let release; const edits = [], finals = [], active = new Map(), byMessage = new Map();
  const controls = createControls({ canControl: () => true });
  const begin = createResponses({ controls, active, byMessage, interval: 1, log() {}, transport: {
    async sendText() { return { message_id: 20 }; },
    async editText(_chat, _id, text) { edits.push(text); await new Promise(r => { release = r; }); },
    async finalize(_target, _id, text) { finals.push(text); },
  } });
  const response = await begin({ key: 'key', chatId: '7', target: { chatId: '7', messageId: 1 } });
  response.onSession({ abort() {} }); response.event(delta('a')); await sleep(10);
  for (let i = 0; i < 20; i++) response.event(delta('b'));
  await sleep(10); assert.equal(edits.length, 1);
  const finish = response.finish('a' + 'b'.repeat(20)); await sleep(10); assert.equal(finals.length, 0);
  release(); await finish; await response.stop(); assert.equal(finals.length, 1); assert.equal(edits.length, 1);
  assert.equal(active.size, 0); assert.equal(byMessage.size, 0);
  response.event(delta('late')); await sleep(10); assert.equal(edits.length, 1);
});
test('Telegram final failure is not blindly resent or replaced with an error message', async () => {
  let attempts = 0;
  const begin = createResponses({ controls: createControls({ canControl: () => true }), active: new Map(), byMessage: new Map(), log() {},
    transport: { async sendText() { return { message_id: 2 }; }, async finalize() { attempts++; throw new Error('ambiguous network'); } } });
  const response = await begin({ key: 'key', chatId: '7', target: {} });
  await assert.rejects(response.finish('final')); await response.finish('error'); await response.stop(); assert.equal(attempts, 1);
});

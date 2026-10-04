import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createQQResponse } from '../src/adapters/qq/index.js';

function fixture(options = {}) {
  const calls = [], logs = [];
  const response = createQQResponse({ message: { target: { scope: 'c2c', msgId: 'm', targetId: 'u' }, receivedAt: Date.now() },
    config: {}, isClosed: () => false, log: code => logs.push(code), onStop: () => calls.push(['stop']), flushIntervalMs: 5,
    transport: { openStream: () => ({ update: async text => calls.push(['update', text]), complete: async () => calls.push(['complete']), cancel: () => calls.push(['cancel']) }),
      sendText: async (_target, text) => calls.push(['plain', text]) }, ...options });
  return { response, calls, logs };
}
const delta = text => ({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: text } });
test('C2C coalesces full-text snapshots and finalizes the authoritative answer once', async () => {
  const { response, calls } = fixture();
  response.event(delta('hello')); response.event(delta(' world')); await delay(20);
  assert.deepEqual(calls[0], ['update', 'hello world']);
  await response.finish('final'); await response.finish('duplicate'); response.event(delta('late'));
  await response.stop(); await delay(10);
  assert.deepEqual(calls.filter(x => x[0] === 'update'), [['update', 'hello world'], ['update', 'final']]);
  assert.equal(calls.filter(x => x[0] === 'complete').length, 1);
  assert.ok(!calls.some(x => x[0] === 'plain'));
});
test('pending deltas are replaced by a terminal error without leaking tool arguments', async () => {
  const { response, calls } = fixture();
  response.event(delta('unfinished')); response.event({ type: 'tool_execution_start', args: { secret: 'must-not-send' } });
  await response.finish('模型请求失败'); await response.stop();
  assert.deepEqual(calls.filter(x => x[0] === 'update'), [['update', '模型请求失败']]);
});
test('ambiguous stream failures cancel, never fall back to an extra plain reply', async () => {
  let sends = 0, cancelled = 0;
  const { response, logs } = fixture({ transport: {
    openStream: () => ({ update: async () => { throw new Error('private error'); }, cancel: () => cancelled++, complete: () => assert.fail() }),
    sendText: async () => sends++,
  } });
  response.event(delta('text')); await delay(20);
  await assert.rejects(response.finish('final')); await response.stop();
  assert.equal(sends, 0); assert.ok(cancelled); assert.deepEqual(logs, ['qq_stream_failed']);
});
test('streaming false and plain-text mode retain final-only replies', async () => {
  for (const config of [{ streaming: false }, { replyFormat: 'text' }]) {
    const { response, calls } = fixture({ config });
    response.event(delta('partial')); await response.finish('final'); await response.stop();
    assert.deepEqual(calls.filter(x => x[0] !== 'stop'), [['plain', 'final']]);
  }
});
test('stop cancels pending updates and releases admission without late sends', async () => {
  const { response, calls } = fixture(); response.event(delta('queued')); await response.stop(); await delay(20);
  assert.deepEqual(calls, [['cancel'], ['stop']]);
});

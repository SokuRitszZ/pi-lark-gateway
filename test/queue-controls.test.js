import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessageHandler } from '../src/messages/index.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const event = (id, root = 'root') => ({ sender: { sender_type: 'user', sender_id: { open_id: 'owner' } }, message: { message_id: id, chat_id: 'chat', chat_type: 'group', root_id: root, message_type: 'text', content: JSON.stringify({ text: id }) } });
test('normal same-thread messages wait through final output, other threads remain independent', async () => {
  const started = [], finished = [], sessions = new Map();
  const running = deferred(), editing = deferred();
  const handler = createMessageHandler({
    beginResponse: async m => ({ onSession: s => sessions.set(m.id, s), event() {}, stop: async () => {},
      finish: async () => { if (m.id === 'first') await editing.promise; finished.push(m.id); } }),
    answer: async (_, text, emit, options) => {
      started.push(text); options.onSession({ abort: () => running.resolve() });
      if (text === 'first') await running.promise;
      return text;
    }, reply: async () => {},
  });
  handler.accept(event('first')); handler.accept(event('second')); handler.accept(event('parallel', 'other-root'));
  await new Promise(r => setImmediate(r));
  assert.deepEqual(started, ['first', 'parallel']);
  sessions.get('first').abort();
  await new Promise(r => setImmediate(r));
  assert.ok(!started.includes('second'));
  editing.resolve(); await handler.drain();
  assert.deepEqual(started, ['first', 'parallel', 'second']);
  assert.ok(finished.indexOf('first') < finished.indexOf('second'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessageHandler, normalizeEvent } from '../src/messages/index.js';
const event = (id, user = 'any-user') => ({ sender: { sender_type: 'user', sender_id: { open_id: user } }, message: { message_id: id, chat_id: 'group', chat_type: 'group', root_id: 'topic-root', message_type: 'text', content: JSON.stringify({ text: '你好' }) } });
test('any user and unmentioned group messages admitted; bot ignored', () => {
  assert.equal(normalizeEvent(event('1')).text, '你好');
  assert.equal(normalizeEvent(event('1')).key, normalizeEvent(event('2', 'other')).key);
  assert.equal(normalizeEvent({ ...event('1'), sender: { sender_type: 'app' } }), null);
});
test('private ignores threads; new group messages create separate topics', () => {
  const a = event('a'), b = event('b');
  delete a.message.root_id; delete b.message.root_id;
  assert.notEqual(normalizeEvent(a).key, normalizeEvent(b).key);
  a.message.chat_type = b.message.chat_type = 'p2p';
  b.message.root_id = 'quoted-message'; b.message.thread_id = 'thread';
  assert.equal(normalizeEvent(a).key, normalizeEvent(b).key);
});
test('thread alias keeps first message and follow-ups in same session', () => {
  const first = event('first'); delete first.message.root_id;
  const normalized = normalizeEvent(first);
  const roots = new Map([['group:thread-1', normalized.root]]);
  const followup = event('followup', 'other');
  followup.message.thread_id = 'thread-1'; delete followup.message.root_id;
  assert.equal(normalizeEvent(followup, roots).key, normalized.key);
  const native = event('native'); delete native.message.root_id; native.message.thread_id = 'native-thread';
  const key = normalizeEvent(native, roots).key;
  native.message.root_id = 'native';
  assert.equal(normalizeEvent(native, roots).key, key);
});
test('deduplication and per-session sequencing', async () => {
  const calls = [];
  const handler = createMessageHandler({ answer: async (_, text) => { calls.push(text); return 'answer'; }, reply: async m => calls.push(m.id) });
  handler.accept(event('1')); handler.accept(event('1')); handler.accept(event('2'));
  await handler.drain();
  assert.deepEqual(calls, ['你好', '1', '你好', '2']);
});
test('reacts once per message and reaction failure does not block answer', async () => {
  const reactions = [], replies = [];
  const handler = createMessageHandler({ random: () => 0,
    react: async (m, emoji) => { reactions.push([m.id, emoji]); throw new Error('permission'); },
    answer: async () => 'OK', reply: async (_, text) => replies.push(text) });
  handler.accept(event('1')); handler.accept(event('1'));
  await handler.drain();
  assert.deepEqual(reactions, [['1', 'SMILE']]);
  assert.deepEqual(replies, ['OK']);
});
for (const failure of [false, true]) {
  test(`removes exact reaction after reply (model failure=${failure})`, async () => {
    const calls = [];
    const handler = createMessageHandler({
      react: async () => 'reaction-123',
      answer: async () => { if (failure) throw new Error('failed'); return 'OK'; },
      reply: async () => calls.push('reply'),
      removeReaction: async (m, id) => calls.push([m.id, id]),
    });
    handler.accept(event('1')); await handler.drain();
    assert.deepEqual(calls, ['reply', ['1', 'reaction-123']]);
  });
}
test('late reaction is still removed; cleanup failure is contained', async () => {
  let resolveReaction;
  const late = new Promise(resolve => { resolveReaction = resolve; });
  const logs = [];
  const handler = createMessageHandler({ react: () => late, answer: async () => 'OK',
    reply: async () => resolveReaction('late-id'),
    removeReaction: async (_, id) => { assert.equal(id, 'late-id'); throw new Error('unavailable'); },
    log: message => logs.push(message),
  });
  handler.accept(event('1')); await handler.drain();
  assert.ok(logs.includes('reaction_remove_failed'));
});
test('model failure gets safe reply', async () => {
  const replies = [];
  const handler = createMessageHandler({ answer: async () => { throw new Error('secret'); }, reply: async (_, text) => replies.push(text) });
  handler.accept(event('1')); await handler.drain();
  assert.equal(replies.length, 1); assert.ok(!replies[0].includes('secret'));
});

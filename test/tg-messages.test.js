import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMessage, normalizeCallback, formatText } from '../src/adapters/telegram/index.js';
import { formatPages } from '../src/adapters/telegram/format.js';
const bot = { id: 123, username: 'ExampleBot' };
const update = extra => ({ update_id: 1, message: { message_id: 11, from: { id: 7, is_bot: false }, chat: { id: -1001, type: 'supergroup' }, text: '/ask@ExampleBot hello', ...extra } });
test('Telegram preserves native identities and isolates bot/chat/topic/member', () => {
  const a = normalizeMessage(update({ message_thread_id: 10 }), bot);
  assert.equal(a.text, 'hello'); assert.equal(a.mentioned, true); assert.equal(a.identity.Telegram.sender.user_id, '7');
  assert.equal(a.target.threadId, 10); assert.equal(a.identity.Lark, undefined);
  assert.notEqual(a.key, normalizeMessage(update({ message_thread_id: 11 }), bot).key);
  assert.notEqual(a.key, normalizeMessage(update({ from: { id: 8 }, message_thread_id: 10 }), bot).key);
  assert.notEqual(a.key, normalizeMessage(update({ message_thread_id: 10 }), { ...bot, id: 124 }).key);
  assert.equal(a.id, normalizeMessage(update({ message_thread_id: 10 }), bot).id);
});
test('Telegram rejects channels, anonymous senders, other bots and unsafe IDs', () => {
  for (const extra of [{ sender_chat: { id: -1 } }, { from: { id: 8, is_bot: true } }, { from: { id: Number.MAX_SAFE_INTEGER + 1 } },
    { chat: { id: -10, type: 'channel' } }, { text: '/ask@OtherBot hey' }, { message_thread_id: -3 }]) assert.equal(normalizeMessage(update(extra), bot), null);
  assert.equal(normalizeMessage({ edited_message: update({}).message }, bot), null);
});
test('Telegram UTF-16 mentions, replies and media captions retain message targets', () => {
  const mention = normalizeMessage(update({ text: '😀 @ExampleBot hi', entities: [{ type: 'mention', offset: 3, length: 11 }] }), bot);
  assert.equal(mention.mentioned, true);
  assert.equal(normalizeMessage(update({ text: 'hi' }), bot).mentioned, false);
  assert.equal(normalizeMessage(update({ text: 'hi', reply_to_message: { message_id: 22, from: bot } }), bot).mentioned, true);
  const m = normalizeMessage(update({ text: undefined, caption: 'photo', photo: [{ file_id: 'small' }, { file_id: 'large' }] }), bot);
  assert.equal(m.attachments[0].fileId, 'large'); assert.equal(m.text, 'photo');
  assert.equal(normalizeMessage(update({ text: '', document: { file_id: 'doc', file_name: '../../evil' } }), bot).attachments.length, 1);
});
test('Telegram callback mapping binds actor and exact chat/message and allowlists actions', () => {
  const id = '12345678-1234-1234-1234-123456789012';
  const cb = data => ({ callback_query: { id: 'click', from: { id: 7 }, message: { message_id: 99, chat: { id: -1001 } }, data } });
  assert.equal(normalizeCallback(cb(`s:${id}`)).messageId, '-1001:99');
  assert.equal(normalizeCallback(cb(`a:${id}:approved`)).value.decision, 'approved');
  assert.equal(normalizeCallback(cb(`a:${id}:admin`)), null); assert.equal(normalizeCallback(cb(`s:${id}:extra`)), null);
});
test('Telegram rich text uses safe entities and clips surrogate pairs and overlapping code spans', () => {
  const result = formatText('**bold `code`** <script>x</script> [link](https://example.com) [bad](javascript:alert(1))');
  assert.ok(result.text.includes('<script>')); assert.ok(result.entities.some(e => e.type === 'code'));
  assert.ok(result.entities.some(e => e.type === 'text_link' && e.url === 'https://example.com'));
  assert.ok(!result.entities.some(e => e.type === 'bold'));
  assert.ok(!result.entities.some(e => e.url?.startsWith('javascript:')));
  const long = formatText('😀'.repeat(4000)); assert.ok(long.text.length < 4096); assert.ok(!/[\uD800-\uDBFF]\n/.test(long.text));
  for (const e of long.entities) assert.ok(e.offset + e.length <= long.text.length);
});
test('Telegram final pages retain final answers, offsets and bounded truncation', () => {
  const input = '**' + '😀'.repeat(4000) + '**\nFINAL ANSWER';
  const pages = formatPages(input); assert.ok(pages.length > 1);
  assert.ok(pages.map(p => p.text).join('').endsWith('FINAL ANSWER'));
  for (const p of pages) { assert.ok(p.text.length < 4096); for (const e of p.entities) assert.ok(e.offset >= 0 && e.offset + e.length <= p.text.length); }
  assert.equal(formatPages('x'.repeat(100000)).length, 12);
  assert.match(formatPages('x'.repeat(100000)).at(-1).text, /截断/);
});

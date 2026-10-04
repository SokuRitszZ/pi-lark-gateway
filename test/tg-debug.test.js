import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMessage } from '../src/adapters/telegram/index.js';
import { transformDebugMessage } from '../src/adapters/telegram/debug.js';
const message = (text, user = 7) => normalizeMessage({ message: { message_id: 1, from: { id: user }, chat: { id: user, type: 'private' }, text } }, { id: 123, username: 'ExampleBot' });
test('Telegram debug uses an isolated synthetic policy subject without forging sender identity', () => {
  const original = message('/debug assume Alice\nhello');
  const result = transformDebugMessage(original, '7').message;
  assert.match(result.userId, /^debug_/); assert.notEqual(result.key, original.key);
  assert.equal(result.identity.Telegram.sender.user_id, '7'); assert.equal(original.identity.Telegram.simulation, undefined);
  assert.equal(result.identity.Telegram.simulation.label, 'Alice'); assert.equal(result.text, 'hello');
  assert.equal(result.command, undefined); assert.equal(result.target.chatId, '7');
  assert.equal(transformDebugMessage(message('/debug assume alice\nhi'), '7').message.userId, result.userId);
  assert.equal(transformDebugMessage(message('ordinary message'), '7').message.userId, '7');
});
test('Telegram debug is owner-only and shares bounded duration syntax', () => {
  assert.equal(transformDebugMessage(message('/debug sleep 500ms', 8), '7').denied, true);
  assert.equal(transformDebugMessage(message('/debug sleep 500ms'), '7').message.debugSleepMs, 500);
  assert.equal(transformDebugMessage(message('/debug sleep 1.5秒'), '7').message.debugSleepMs, 1500);
  assert.ok(transformDebugMessage(message('/debug sleep 11m'), '7').error);
  assert.ok(transformDebugMessage(message('/debug assume Alice'), '7').error);
});

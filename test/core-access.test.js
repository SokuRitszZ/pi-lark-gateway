import test from 'node:test';
import assert from 'node:assert/strict';
import { admitMessage } from '../src/core/access/index.js';
import { accessMessage } from '../src/adapters/lark/index.js';
import { admit } from '../src/config/index.js';

const policy = () => ({ enabled: true, users: 'allowlist', allowedUsers: ['member'], trigger: 'mention',
  denyTextPatterns: ['deny'], allowTextPatterns: ['allow'] });
const state = () => ({ config: { bot: { openId: 'bot' }, access: { owner: 'owner', admins: ['admin'],
  groups: policy(), private: policy() } }, groups: {} });
const message = extra => ({ chatId: 'room', userId: 'member', isGroup: true, text: 'hello', mentioned: true, ...extra });

test('platform-neutral access preserves owner, admin, allowlist and trigger rules', () => {
  for (const userId of ['owner', 'admin', 'member']) assert.equal(admitMessage(message({ userId }), state()), true);
  assert.equal(admitMessage(message({ userId: 'outsider' }), state()), false);
  assert.equal(admitMessage(message({ text: 'deny allow' }), state()), false);
  assert.equal(admitMessage(message({ mentioned: false }), state()), false);
  assert.equal(admitMessage(message({ mentioned: false, text: 'allow' }), state()), true);
  assert.equal(admitMessage(message({ isGroup: false, mentioned: false, text: 'deny' }), state()), true);
  assert.equal(admitMessage(null, state()), false);
  const disabled = state(); disabled.groups.room = { ...policy(), enabled: false };
  assert.equal(admitMessage(message({ userId: 'owner' }), disabled), false);
});

test('Lark admission normalization excludes mention labels and metadata', () => {
  const event = { sender: { sender_type: 'user', sender_id: { open_id: 'member' } }, message: {
    chat_id: 'room', chat_type: 'group', message_type: 'text',
    content: JSON.stringify({ text: '@bot hello', extra: 'deny' }),
    mentions: [{ key: '@bot', name: 'deny', id: { open_id: 'bot' } }],
  } };
  assert.deepEqual(accessMessage(event, 'bot'), message({}));
  assert.equal(admit(event, state()), true);
  assert.equal(accessMessage({ ...event, sender: { sender_type: 'app' } }, 'bot'), null);
  assert.equal(accessMessage({ ...event, message: { ...event.message, chat_type: 'unknown' } }, 'bot'), null);
  assert.equal(accessMessage(event, 'other-bot').mentioned, false);
});

test('policy compatibility wrapper matches normalized evaluation over a policy matrix', () => {
  for (const chatType of ['group', 'p2p', 'invalid']) for (const user of ['owner', 'member', 'unknown']) {
    for (const text of ['hello', 'allow', 'deny allow']) for (const mentioned of [false, true]) {
      const event = { sender: { sender_type: 'user', sender_id: { open_id: user } }, message: {
        chat_id: 'room', chat_type: chatType, message_type: 'text', content: JSON.stringify({ text }),
        mentions: mentioned ? [{ id: { open_id: 'bot' } }] : [],
      } };
      assert.equal(admit(event, state()), admitMessage(accessMessage(event, 'bot'), state()));
    }
  }
});

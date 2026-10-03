import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMessage, isAllowed, replyText } from '../src/adapters/qq/index.js';
export const inbound = (messageId = 'm1', senderId = 'user') => ({ kind: 'c2c', rawEventType: 'C2C_MESSAGE_CREATE', messageId, senderId, content: 'hello' });
test('normalization scopes identities, ignores forged recipient and isolates group members', () => {
  const m = normalizeMessage({ ...inbound(), replyTarget: { targetId: 'victim' } }, 'app');
  assert.equal(m.target.targetId, 'user'); assert.equal(m.identity.QQ.sender.user_openid, 'user');
  const group = { ...inbound(), kind: 'group', rawEventType: 'GROUP_AT_MESSAGE_CREATE', groupOpenid: 'group' };
  const g = normalizeMessage(group, 'app');
  assert.equal(g.identity.QQ.sender.member_openid, 'user');
  assert.notEqual(g.key, normalizeMessage({ ...group, senderId: 'other' }, 'app').key);
  assert.notEqual(g.id, normalizeMessage({ ...group, groupOpenid: 'other' }, 'app').id);
  assert.equal(normalizeMessage({ ...group, rawEventType: 'GROUP_MESSAGE_CREATE' }, 'app'), null);
  assert.equal(normalizeMessage({ ...inbound(), senderIsBot: true }, 'app'), null);
  assert.equal(normalizeMessage({ ...inbound(), kind: 'guild' }, 'app'), null);
});
test('allowlists cannot mix C2C users with group-member identities', () => {
  const config = { access: { c2cUsers: ['user'], groups: { group: ['member'] } } };
  assert.equal(isAllowed(normalizeMessage(inbound(), 'app'), config), true);
  const group = { ...inbound(), kind: 'group', rawEventType: 'GROUP_AT_MESSAGE_CREATE', groupOpenid: 'group' };
  assert.equal(isAllowed(normalizeMessage(group, 'app'), config), false);
  assert.equal(isAllowed(normalizeMessage({ ...group, senderId: 'member' }, 'app'), config), true);
});
test('output has an explicit UTF-8-safe size limit', () => {
  const text = replyText('中文😀'.repeat(3000));
  assert.ok(Buffer.byteLength(text) <= 3500); assert.ok(text.endsWith('请要求分段继续。]'));
  assert.ok(!text.includes('\uFFFD'));
});

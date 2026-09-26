import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformDebugEvent } from '../src/debug/index.js';
import { makeConfig, admit } from '../src/config/index.js';
import { needsApproval } from '../src/approvals/index.js';
const event = (user, text, type = 'group') => ({ sender: { sender_type: 'user', sender_id: { open_id: user } }, message: { message_id: 'm', chat_id: 'chat', chat_type: type, message_type: 'text', content: JSON.stringify({ text }) } });
test('owner-only one-message transformation retains IDs and strips command', () => {
  assert.ok(transformDebugEvent(event('stranger', '/debug assume 张三\n你好'), 'owner').denied);
  assert.ok(transformDebugEvent(event('owner', '/debug assume 张三'), 'owner').error);
  const original = event('owner', '/debug assume 张三\n你好');
  const r = transformDebugEvent(original, 'owner');
  assert.equal(r.debugLabel, '张三');
  assert.equal(JSON.parse(r.event.message.content).text, '你好');
  assert.equal(r.event.message.message_id, 'm');
  assert.ok(r.event.sender.sender_id.open_id.startsWith('debug_'));
  assert.equal(original.sender.sender_id.open_id, 'owner');
  assert.equal(transformDebugEvent(event('owner', '正常问题'), 'owner').event.sender.sender_id.open_id, 'owner');
});
test('standalone directive after display-name prefix cannot bypass allowlist as owner', () => {
  const e = event('owner', 'Andrew Leung\n/debug assume 无名氏\n测试 PI 你好');
  const result = transformDebugEvent(e, 'owner');
  assert.equal(result.debugLabel, '无名氏');
  assert.ok(!JSON.parse(result.event.message.content).text.includes('/debug'));
  const config = makeConfig({ appId: 'app', domain: 'feishu', ownerOpenId: 'owner' });
  config.access.groups.users = 'allowlist'; config.access.groups.trigger = 'all';
  const state = { config, groups: {} };
  assert.equal(admit(result.event, state), false);
  assert.equal(needsApproval(result.event, state), true);
  assert.ok(transformDebugEvent(event('stranger', 'Name\n/debug assume owner\nhi'), 'owner').denied);
});
test('multiline rich-text post is transformed into normal text', () => {
  const e = event('owner', '', 'p2p');
  e.message.message_type = 'post';
  e.message.content = JSON.stringify({ zh_cn: { title: '', content: [
    [{ tag: 'text', text: '/debug assume 张三' }], [{ tag: 'text', text: '你好' }],
  ] } });
  const result = transformDebugEvent(e, 'owner');
  assert.equal(result.debugLabel, '张三');
  assert.equal(result.event.message.message_type, 'text');
  assert.equal(JSON.parse(result.event.message.content).text, '你好');
});
for (const type of ['group', 'p2p']) test(`${type} normal open/allowlist/disabled policy on virtual sender`, () => {
  const config = makeConfig({ appId: 'app', domain: 'feishu', ownerOpenId: 'owner' });
  const state = { config, groups: {} };
  config.access.groups.users = config.access.private.users = 'all';
  config.access.groups.trigger = 'all';
  const r = transformDebugEvent(event('owner', '/debug assume a@example.com\n请回答问题', type), 'owner');
  assert.equal(admit(r.event, state), true); assert.equal(needsApproval(r.event, state), false);
  const p = type === 'group' ? config.access.groups : config.access.private;
  p.users = 'allowlist';
  assert.equal(admit(r.event, state), false); assert.equal(needsApproval(r.event, state), true);
  p.allowedUsers.push(r.event.sender.sender_id.open_id);
  assert.equal(admit(r.event, state), true); assert.equal(needsApproval(r.event, state), false);
  p.enabled = false; assert.equal(admit(r.event, state), false);
});

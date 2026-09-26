import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApprovals, needsApproval, approvalCard } from '../src/approvals/index.js';
import { makeConfig } from '../src/config/index.js';
const event = { sender: { sender_type: 'user', sender_id: { open_id: 'stranger' } }, message: { chat_type: 'group', chat_id: 'chat', message_id: 'message' } };
test('completed card displays success and management buttons', () => {
  const card = approvalCard({ user: 'user', chat: 'chat', chatType: 'group' }, 'approved');
  assert.equal(card.header.template, 'green');
  assert.equal(card.config.update_multi, true);
  assert.ok(card.header.title.content.includes('已授权'));
  assert.ok(card.elements[0].text.content.includes('已授权'));
  const actions = card.elements.find(e => e.tag === 'action').actions;
  assert.deepEqual(actions.map(a => a.value.decision), ['revoked', 'blocked']);
  assert.ok(!card.elements[0].text.content.includes('24 小时'));
  assert.equal(approvalCard({ user: 'user', chat: 'chat' }, 'denied').header.template, 'red');
});
const state = () => { const config = makeConfig({ appId: 'app', domain: 'feishu', ownerOpenId: 'owner' }); config.access.groups.users = 'allowlist'; config.access.groups.trigger = 'all'; return { config, groups: {} }; };
test('card shows chat name and navigation link after approval too', () => {
  const r = { user: 'user', chat: 'oc_id', chatType: 'group', chatName: '测试群', chatUrl: 'https://applink.feishu.cn/client/chat/open?openChatId=oc_id' };
  for (const status of ['pending', 'approved', 'denied']) {
    const card = approvalCard(r, status);
    assert.ok(card.elements[0].text.content.includes('会话：测试群'));
    const buttons = card.elements.filter(e => e.tag === 'action').flatMap(e => e.actions);
    assert.ok(buttons.some(b => b.url === r.chatUrl));
    assert.equal(card.elements.filter(e => e.tag === 'action').length, 1);
    if (status === 'pending') assert.equal(buttons.length, 4);
    else assert.ok(!buttons.some(b => ['approved', 'denied'].includes(b.value?.decision)));
    if (status === 'denied') {
      assert.equal(card.header.template, 'red');
      assert.ok(card.header.title.content.includes('未授权'));
      assert.ok(card.elements[0].text.content.includes('重新申请'));
    }
  }
});
test('only eligible group allowlist requests prompt owner', () => {
  const s = state(); assert.ok(needsApproval(event, s));
  s.config.access.groups.trigger = 'mention'; assert.equal(needsApproval(event, s), false);
  s.config.access.groups.trigger = 'all'; s.config.access.groups.onUnknown = 'deny'; assert.equal(needsApproval(event, s), false);
  s.config.access.groups.onUnknown = 'ask_owner'; s.config.access.groups.enabled = false; assert.equal(needsApproval(event, s), false);
});
for (const decision of ['approved', 'denied']) test(`owner ${decision}, dedup, spoofing protection, persistence`, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lark-approval-'));
  try {
    const s = state(), cards = [], edits = []; let time = 1000;
    const options = { file: path.join(dir, 'approvals.json'), getState: () => s, now: () => time,
      sendCard: async (owner, card) => { assert.equal(owner, 'owner'); cards.push(card); return 'card-id'; },
      updateCard: async (_, card) => edits.push(card) };
    const a = await createApprovals(options);
    await Promise.all([a.request(event), a.request(event)]); assert.equal(cards.length, 1);
    const value = { ...cards[0].elements[1].actions[0].value, decision };
    const callback = { action: { value }, operator: { open_id: 'attacker' }, context: { open_message_id: 'card-id' } };
    assert.equal(a.handle(callback).toast.type, 'error');
    callback.operator.open_id = 'owner'; callback.context.open_message_id = 'other';
    assert.equal(a.handle(callback).toast.type, 'error'); callback.context.open_message_id = 'card-id';
    a.handle(callback); a.handle(callback); await a.drain(); assert.equal(edits.length, 1);
    assert.equal(a.hasGrant('chat', 'stranger'), decision === 'approved');
    assert.equal(a.hasGrant('another-chat', 'stranger'), false);
    assert.equal(a.handle(callback).toast.type, 'error');
    await a.request(event); assert.equal(cards.length, 1);
    if (decision === 'denied') {
      await a.request({ ...event, message: { ...event.message, message_id: 'new-message' } });
      assert.equal(cards.length, 2);
      await a.request({ ...event, message: { ...event.message, message_id: 'another-message' } });
      assert.equal(cards.length, 2); // pending request still merges
    }
    const reloaded = await createApprovals(options); assert.equal(reloaded.hasGrant('chat', 'stranger'), decision === 'approved');
    time += 86400001; assert.equal(reloaded.handle(callback).toast.type, 'error');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

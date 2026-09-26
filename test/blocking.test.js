import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApprovals } from '../src/approvals/index.js';
import { makeConfig } from '../src/config/index.js';
test('revoke, reapply, stale-card protection, block persistence and unblock', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gateway-block-'));
  try {
    const config = makeConfig({ appId: 'app', domain: 'feishu', ownerOpenId: 'owner' });
    config.access.groups.users = 'allowlist'; config.access.groups.trigger = 'all';
    const cards = []; const options = { file: path.join(dir, 'state.json'), getState: () => ({ config, groups: {} }),
      sendCard: async (_, card) => { cards.push(card); return `card-${cards.length}`; }, updateCard: async () => {} };
    let api = await createApprovals(options);
    const message = id => ({ sender: { sender_type: 'user', sender_id: { open_id: 'user' } }, message: { chat_id: 'chat', chat_type: 'group', message_id: id } });
    const callback = (i, decision, who = 'owner') => ({ operator: { open_id: who }, context: { open_message_id: `card-${i+1}` },
      action: { value: { ...cards[i].elements[1].actions[0].value, decision } } });
    await api.request(message('1'));
    api.handle(callback(0, 'approved')); await api.drain(); assert.ok(api.hasGrant('chat', 'user'));
    assert.equal(api.handle(callback(0, 'revoked', 'other')).toast.type, 'error');
    api.handle(callback(0, 'revoked')); await api.drain(); assert.equal(api.hasGrant('chat', 'user'), false);
    await api.request(message('2')); assert.equal(cards.length, 2);
    assert.equal(api.handle(callback(0, 'blocked')).toast.type, 'error');
    api.handle(callback(1, 'blocked')); await api.drain(); assert.ok(api.isBlocked('chat', 'user'));
    assert.equal(api.isBlocked('other-chat', 'user'), false);
    await api.request(message('3')); assert.equal(cards.length, 2);
    api = await createApprovals(options); assert.ok(api.isBlocked('chat', 'user'));
    api.handle(callback(1, 'unblocked')); await api.drain(); assert.equal(api.isBlocked('chat', 'user'), false);
    assert.equal(api.hasGrant('chat', 'user'), false);
    await api.request(message('4')); assert.equal(cards.length, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

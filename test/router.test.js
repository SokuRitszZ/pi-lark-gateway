import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/gateway/route.js';
import { makeConfig } from '../src/config/index.js';

for (const chatType of ['group', 'p2p']) {
  test(`router preserves ${chatType} approval, grant and block order`, async () => {
    const config = makeConfig({ appId: 'app', domain: 'feishu', ownerOpenId: 'owner' });
    config.access.groups.users = config.access.private.users = 'allowlist';
    config.access.groups.trigger = 'all';
    const calls = []; let granted = false, blocked = false;
    const route = createRouter({ getState: () => ({ config, groups: {} }), log: () => {},
      approvals: { isBlocked: () => blocked, hasGrant: () => granted, request: async () => calls.push('approval') },
      handler: { accept: () => calls.push('answer') }, threads: { save: async () => {} }, reply: async () => calls.push('reply') });
    const event = { sender: { sender_type: 'user', sender_id: { open_id: 'owner' } }, message: {
      message_id: 'message', chat_id: 'chat', chat_type: chatType, message_type: 'text',
      content: JSON.stringify({ text: 'Bot Name\n/debug assume Alice\nhello' }),
    } };
    route(event); assert.deepEqual(calls, ['approval']);
    granted = true; route(event); assert.deepEqual(calls, ['approval', 'answer']);
    blocked = true; route(event); assert.deepEqual(calls, ['approval', 'answer']);
    assert.deepEqual(config.access.private.allowedUsers, []);
    assert.deepEqual(config.access.groups.allowedUsers, []);
    await Promise.resolve();
  });
}

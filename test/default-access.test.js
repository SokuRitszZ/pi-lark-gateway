import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeConfig, admit, withGrant } from '../src/config/index.js';
import { needsApproval } from '../src/approvals/index.js';

test('new group defaults: owner, visitor and approved visitor all require bot mention', () => {
  const config = makeConfig({ appId: 'app', domain: 'feishu', ownerOpenId: 'owner' });
  config.bot.openId = 'bot'; const state = { config, groups: {} };
  for (const thread of [{}, { root_id: 'root' }, { thread_id: 'thread' }]) {
    for (const user of ['owner', 'visitor']) {
      const e = { sender: { sender_type: 'user', sender_id: { open_id: user } }, message: { chat_type: 'group', chat_id: 'chat', ...thread } };
      assert.equal(admit(e, state), false); assert.equal(needsApproval(e, state), false);
      e.message.mentions = [{ id: { open_id: 'someone_else' } }];
      assert.equal(needsApproval(e, state), false);
      e.message.mentions = [{ id: { open_id: 'bot' } }];
      assert.equal(admit(e, state), user === 'owner');
      assert.equal(needsApproval(e, state), user !== 'owner');
    }
  }
  config.access.groups.allowedUsers.push('visitor');
  const e = { sender: { sender_type: 'user', sender_id: { open_id: 'visitor' } }, message: { chat_type: 'group', chat_id: 'chat', mentions: [{ id: { open_id: 'bot' } }] } };
  assert.equal(admit(e, state), true); assert.equal(needsApproval(e, state), false);
  config.access.owner = null; config.access.groups.allowedUsers = [];
  assert.equal(admit(e, state), false); assert.equal(needsApproval(e, state), false);
});

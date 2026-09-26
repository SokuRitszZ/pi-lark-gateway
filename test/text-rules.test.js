import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeConfig, validateConfig, admit } from '../src/config/index.js';
import { needsApproval } from '../src/approvals/eligibility.js';

function fixture(text = '测试 PI') {
  const config = makeConfig({ appId: 'cli_test', domain: 'feishu', ownerOpenId: 'owner' });
  config.bot.openId = 'bot';
  config.access.groups.allowTextPatterns = ['^问答：', '测试\\s*PI'];
  config.access.groups.denyTextPatterns = ['不要回复', '^忽略'];
  const state = { config, groups: {} };
  const event = { sender: { sender_type: 'user', sender_id: { open_id: 'owner' } },
    message: { chat_type: 'group', chat_id: 'g', message_type: 'text', content: JSON.stringify({ text }) } };
  return { state, event };
}
test('any allow pattern replaces mention but never membership checks', () => {
  for (const text of ['问答：你好', '测试 PI']) {
    const { state, event } = fixture(text);
    assert.equal(admit(event, state), true);
    event.sender.sender_id.open_id = 'visitor';
    assert.equal(admit(event, state), false);
    assert.equal(needsApproval(event, state), true);
    state.config.access.groups.allowedUsers.push('visitor');
    assert.equal(admit(event, state), true);
  }
});
test('deny patterns override mention, allow patterns and all trigger; no approval', () => {
  for (const text of ['测试 PI 不要回复', '忽略 测试 PI']) {
    const { state, event } = fixture(text);
    event.message.mentions = [{ id: { open_id: 'bot' } }];
    for (const trigger of ['all', 'mention']) {
      state.config.access.groups.trigger = trigger;
      assert.equal(admit(event, state), false);
      event.sender.sender_id.open_id = 'visitor';
      assert.equal(needsApproval(event, state), false);
    }
  }
});
test('fallback mention, thread, group override, disabled and private behavior', () => {
  const { state, event } = fixture('普通消息');
  event.message.root_id = 'root';
  assert.equal(admit(event, state), false);
  event.message.mentions = [{ id: { open_id: 'bot' } }];
  assert.equal(admit(event, state), true);
  event.message.mentions = [];
  state.groups.g = { ...state.config.access.groups, allowTextPatterns: ['普通'] };
  assert.equal(admit(event, state), true);
  state.groups.g.enabled = false;
  assert.equal(admit(event, state), false);
  event.message.chat_type = 'p2p';
  assert.equal(admit(event, state), true);
});
test('rich text supports localized posts, excludes metadata and mention placeholders', () => {
  const { state, event } = fixture();
  event.message.message_type = 'post';
  for (const localized of [false, true]) {
    const post = { title: '标题', content: [[{ tag: 'text', text: '测试 PI' }]] };
    event.message.content = JSON.stringify(localized ? { zh_cn: post } : post);
    assert.equal(admit(event, state), true);
  }
  event.message.message_type = 'image';
  event.message.content = JSON.stringify({ image_key: '测试 PI' });
  assert.equal(admit(event, state), false);
  event.message.message_type = 'text';
  event.message.content = JSON.stringify({ text: '测试 PI' });
  event.message.mentions = [{ key: '测试 PI', id: { open_id: 'other' } }];
  assert.equal(admit(event, state), false);
  event.message.content = '{';
  assert.equal(admit(event, state), false);
});
test('validates regex lists without breaking old configs', () => {
  const { state } = fixture();
  assert.doesNotThrow(() => validateConfig(state.config));
  for (const field of ['allowTextPatterns', 'denyTextPatterns']) {
    for (const bad of ['abc', [3], ['['], [''], Array(51).fill('a')]) {
      const config = structuredClone(state.config);
      config.access.groups[field] = bad;
      assert.throws(() => validateConfig(config), /invalid_config/);
    }
    delete state.config.access.groups[field];
  }
  assert.doesNotThrow(() => validateConfig(state.config));
});

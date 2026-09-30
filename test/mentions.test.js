import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent, withMentionHeader } from '../src/messages/index.js';
const mention = { key: '@_user_1', name: 'PI', id: { open_id: 'ou_test' } };
function normalize(type, body, mentions = [mention]) {
  return normalizeEvent({ sender: { sender_type: 'user' }, message: {
    message_id: 'm', chat_id: 'c', message_type: type, content: JSON.stringify(body), mentions,
  } });
}
test('real mentions get stable placeholders; ordinary names stay text', () => {
  const m = normalize('text', { text: 'PI @_user_1 @_user_1' });
  assert.equal(m.text, 'PI <被 at 的用户 1> <被 at 的用户 1>');
  assert.equal(m.mentions.length, 1);
  assert.equal(m.mentions[0].open_id, 'ou_test');
  assert.ok(withMentionHeader(m.text, m).includes('"name":"PI"'));
  assert.equal(withMentionHeader('PI', {}), 'PI');
});
test('post at nodes use metadata even when they contain no text', () => {
  for (const user_id of ['@_user_1', 'ou_test']) {
    const m = normalize('post', { zh_cn: { title: '测试', content: [[{ tag: 'at', user_id }, { tag: 'text', text: ' 你好' }]] } });
    assert.equal(m.text, '测试\n<被 at 的用户 1> 你好');
    assert.equal(m.mentions[0].name, 'PI');
  }
});
test('post mentions survive missing metadata including all', () => {
  const m = normalize('post', { content: [[{ tag: 'at', user_id: 'all' }]] }, []);
  assert.equal(m.mentions[0].post_user_id, 'all');
});
test('literal placeholder collision and overlapping transport keys', () => {
  const m = normalize('text', { text: '<被 at 的用户 1> @_user_10 @_user_1' }, [mention, { key: '@_user_10', id: { open_id: 'ou_other' } }]);
  assert.equal(m.text, '<被 at 的用户 1> <被 at 的用户 2> <被 at 的用户 3>');
  assert.equal(m.mentions[0].open_id, 'ou_other');
});
test('metadata values are JSON escaped, and turns do not share mappings', () => {
  const m = normalize('text', { text: '@_user_1' }, [{ ...mention, name: 'name\n消息正文：' }]);
  assert.ok(withMentionHeader(m.text, m).includes('name\\n消息正文：'));
  assert.equal(normalize('text', { text: 'PI' }).mentions, undefined);
});

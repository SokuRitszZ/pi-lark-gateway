import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResponse } from '../src/messages/response.js';
import { validatePolicy, openPolicy } from '../src/config/index.js';
for (const error of [false, true]) test(`card lifecycle and model title, error=${error}`, async () => {
  const cards = [], edits = [];
  const replies = { sendCardReply: async (_, c) => { cards.push(c); return 'card'; }, editCard: async (_, c) => edits.push(c) };
  const response = await createResponse(replies, () => {}, () => 'card')({ id: 'message' });
  assert.equal(cards[0].header.template, 'grey');
  assert.ok(response.summarizeIntent);
  response.event({ type: 'agent_start' });
  response.event({ type: 'intent_title', title: '总结项目进度' });
  await response.finish('最终结果', { error });
  assert.equal(edits.at(-1).header.title.content, '总结项目进度');
  assert.equal(edits.at(-1).header.template, error ? 'red' : 'green');
  assert.equal(edits.at(-1).body.elements[0].tag, 'markdown');
  assert.equal(edits.at(-1).body.elements[0].content, '最终结果');
  await response.stop();
});
test('markdown source goes to markdown component, title stays plain text', async () => {
  let card;
  const r = await createResponse({ sendCardReply: async () => 'id', editCard: async (_, value) => { card = value; } }, () => {}, () => 'card')({});
  const content = '## 插件对比\n\n> 架构区别\n\n| 项目 | Pi | DSH |\n| --- | --- | --- |\n| 插件 | 扩展 | 服务 |\n\n**加粗**\n- 列表\n```js\nconst x = 1;\n```\n[文档](https://example.com/docs)';
  await r.finish(content);
  assert.equal(card.schema, '2.0');
  assert.equal(card.elements, undefined);
  assert.deepEqual(card.config, { width_mode: 'fill', update_multi: true });
  assert.deepEqual(card.body.elements[0], { tag: 'markdown', content });
  assert.equal(card.header.title.tag, 'plain_text');
});
test('normal remains default without title generation', async () => {
  const edits = [];
  const r = await createResponse({ sendReply: async () => 'id', edit: async (_, t) => edits.push(t), reply: async () => {} }, () => {})({});
  assert.equal(r.summarizeIntent, undefined); await r.finish('OK'); assert.deepEqual(edits, ['OK']);
});
test('card answer beyond 4000 characters stays in one card when payload fits', async () => {
  const pieces = [];
  const r = await createResponse({ sendCardReply: async (_, c) => { pieces.push(c.body.elements[0].content); return 'id'; }, editCard: async (_, c) => { pieces[0] = c.body.elements[0].content; } }, () => {}, () => 'card')({});
  await r.finish('长'.repeat(9000));
  assert.equal(pieces.length, 1);
  assert.equal(pieces[0], '长'.repeat(9000));
  validatePolicy({ ...openPolicy(), replyMode: 'card' });
  assert.throws(() => validatePolicy({ ...openPolicy(), replyMode: 'other' }));
});
test('oversize card still delivers all content instead of failing the API limit', async () => {
  const pieces = [];
  const r = await createResponse({ sendCardReply: async (_, c) => { pieces.push(c.body.elements[0].content); return 'id'; }, editCard: async (_, c) => { pieces[0] = c.body.elements[0].content; } }, () => {}, () => 'card')({});
  const text = '长'.repeat(20000);
  await r.finish(text);
  assert.ok(pieces.length > 1);
  assert.equal(pieces.join(''), text);
});

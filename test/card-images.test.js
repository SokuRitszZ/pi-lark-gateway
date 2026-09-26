import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardResponse } from '../src/messages/card-response.js';
import { cardPages } from '../src/messages/card-pages.js';
import { createAgent } from '../src/agent/index.js';
import { createMessageHandler } from '../src/messages/handler.js';
import { createMediaTool } from '../src/media/index.js';

const picture = { key: 'img_fixture', name: '测试.png' };
const images = card => card.body.elements.filter(element => element.tag === 'img');
function fixture(editHook = async () => {}) {
  const cards = new Map(); let sends = 0;
  const replies = { async sendCardReply(_m, card) { const id = `m${++sends}`; cards.set(id, card); return id; },
    async editCard(id, card) { await editHook(card); cards.set(id, card); } };
  return { cards, replies, sends: () => sends };
}
test('images update the existing primary card and survive subsequent text and finalization', async () => {
  const f = fixture(), response = await createCardResponse({}, f.replies, () => {});
  response.event({ type: 'agent_start' });
  assert.equal(await response.appendImage(picture), 'm1');
  assert.equal(f.sends(), 1); assert.equal(images(f.cards.get('m1'))[0].img_key, picture.key);
  await response.appendImage(picture); assert.equal(images(f.cards.get('m1')).length, 1);
  response.event({ type: 'message_start', message: { role: 'assistant', content: [{ type: 'text', text: '图片说明' }] } });
  await response.finish('图片说明');
  assert.equal(f.sends(), 1); assert.match(f.cards.get('m1').body.elements[0].content, /图片说明/);
  assert.equal(images(f.cards.get('m1')).length, 1); assert.equal(images(f.cards.get('m1'))[0].scale_type, 'fit_horizontal');
  assert.equal(images(f.cards.get('m1'))[0].compact_width, true);
  assert.equal(images(f.cards.get('m1'))[0].preview, true);
  assert.equal(f.cards.get('m1').config.width_mode, 'default');
  await assert.rejects(response.appendImage({ key: 'img_late' }), { code: 'MEDIA_SEND_DENIED' });
});
test('concurrent image additions are serialized and terminal error retains images', async () => {
  let active = 0, peak = 0;
  const f = fixture(async () => { active++; peak = Math.max(peak, active); await new Promise(resolve => setImmediate(resolve)); active--; });
  const response = await createCardResponse({}, f.replies, () => {});
  await Promise.all([response.appendImage(picture), response.appendImage({ key: 'img_two', name: '2.png' })]);
  await response.finish('出现错误', { error: true });
  assert.equal(peak, 1); assert.equal(f.sends(), 1); assert.equal(images(f.cards.get('m1')).length, 2);
});
test('stopping retains already embedded images and rejects late additions', async () => {
  const f = fixture(); let stopped = false;
  const control = { id: 'control', attach() {}, close() {}, get stopped() { return stopped; } };
  const response = await createCardResponse({}, f.replies, () => {}, { create: () => control });
  await response.appendImage(picture); stopped = true;
  await assert.rejects(response.appendImage({ key: 'img_late' }), { code: 'MEDIA_SEND_DENIED' });
  await response.finish('未完成内容');
  assert.equal(images(f.cards.get('m1')).length, 1); assert.equal(f.cards.get('m1').header.template, 'orange');
});

test('expired permission is rechecked in the render queue and failed edits never create a standalone image', async () => {
  let fail = true;
  const f = fixture(async () => { if (fail) throw new Error('edit_failed'); });
  const response = await createCardResponse({}, f.replies, () => {});
  await assert.rejects(response.appendImage(picture, { isActive: () => false }), { code: 'MEDIA_SEND_DENIED' });
  assert.equal(images(f.cards.get('m1')).length, 0);
  await assert.rejects(response.appendImage(picture), /edit_failed/);
  fail = false; await response.finish('状态说明');
  assert.equal(f.sends(), 1); assert.equal(images(f.cards.get('m1')).length, 1);
});
test('handler → agent turn → send tool binds the current response card end to end', async () => {
  const f = fixture(); let tool;
  const session = { messages: [], subscribe: () => () => {}, clearQueue() {},
    async prompt() {
      const result = await tool.execute('call', { path: 'attachments/outbox/test.png' });
      assert.equal(JSON.parse(result.content[0].text).messageId, 'm1');
      this.messages.push({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: '已放入卡片' }] });
    } };
  const agent = await createAgent('/fixture', null, { getCustomTools: (dir, getTurn) => [createMediaTool(dir, getTurn, async (_m, _dir, _params, options) => {
    return { messageId: await options.appendImage(picture, { isActive: options.isActive }), kind: 'image', delivery: 'inline_card' };
  })], createPool: async (_base, _model, options) => {
    tool = options.getCustomTools('/fixture'); tool = tool[0];
    return { run: (_key, _tools, work) => work(session) };
  } });
  const handler = createMessageHandler({ answer: agent.answer, getTools: () => 'all',
    reply: async () => { throw new Error('unexpected separate reply'); },
    beginResponse: async message => { const response = await createCardResponse(message, f.replies, () => {}); return { ...response, summarizeIntent: false }; },
  });
  handler.accept({ sender: { sender_type: 'user', sender_id: { open_id: 'ou_owner' } }, message: {
    message_id: 'om_input', chat_id: 'oc_input', chat_type: 'p2p', message_type: 'text', content: '{"text":"发张图片"}',
  } });
  await handler.drain();
  assert.equal(f.sends(), 1); assert.equal(images(f.cards.get('m1'))[0].img_key, 'img_fixture');
  assert.match(f.cards.get('m1').body.elements[0].content, /已放入卡片/);
});

test('pagination budgets images on the primary card only and keeps markdown first', () => {
  const pages = cardPages('标题', '长文字'.repeat(30000), 'thinking', 'control', [picture]);
  assert.ok(pages.length > 1);
  for (const [index, card] of pages.entries()) {
    assert.equal(card.body.elements[0].tag, 'markdown');
    assert.equal(card.config.width_mode, 'default');
    assert.equal(images(card).length, index ? 0 : 1);
    assert.ok(Buffer.byteLength(JSON.stringify({ msg_type: 'interactive', content: JSON.stringify(card) })) <= 28 * 1024);
  }
});

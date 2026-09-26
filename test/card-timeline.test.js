import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTick } from 'node:timers/promises';
import { createResponse } from '../src/messages/response.js';
import { generateAnswer } from '../src/agent/answer.js';

const msg = text => ({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }] });
async function fixture(controls) {
  const cards = new Map(), edits = [];
  const response = await createResponse({
    sendCardReply: async (_, card) => { const id = `card-${cards.size}`; cards.set(id, card); return id; },
    editCard: async (id, card) => { edits.push(id); cards.set(id, card); },
  }, () => {}, () => 'card', controls)({ id: 'message' });
  return { response, cards, edits };
}
const body = card => card.body.elements[0].content;
const flush = async t => { t.mock.timers.tick(1200); await nextTick(); };

test('card streams commentary and tools in order, then retains them with the real generateAnswer aggregate', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { response, cards } = await fixture();
  let listener;
  const session = { messages: [], subscribe: fn => { listener = fn; return () => {}; }, async prompt() {
    listener({ type: 'agent_start' });
    for (const [index, text] of ['我会先检查。', '参数已配置。', '最终答复：测试通过。'].entries()) {
      listener({ type: 'message_start', message: { role: 'assistant', content: [] } });
      listener({ type: 'message_update', message: msg(text), assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: text } });
      await flush(t);
      assert.match(body(cards.get('card-0')), new RegExp(text));
      const complete = msg(text); listener({ type: 'message_end', message: complete }); this.messages.push(complete);
      if (index === 0) {
        listener({ type: 'tool_execution_start', toolCallId: 'a', toolName: 'read', args: { secret: 'HIDDEN' } });
        listener({ type: 'tool_execution_end', toolCallId: 'a', result: 'HIDDEN' });
        await flush(t);
        assert.match(body(cards.get('card-0')), /我会先检查。\n\n✅ read/);
      }
    }
  } };
  const output = await generateAnswer(session, 'hello', event => response.event(event));
  await response.finish(output);
  assert.equal(body(cards.get('card-0')), '我会先检查。\n\n✅ read\n\n参数已配置。\n\n最终答复：测试通过。');
  assert.equal(cards.get('card-0').header.template, 'green');
  response.event({ type: 'message_end', message: msg('late') }); await flush(t);
  assert.doesNotMatch(body(cards.get('card-0')), /HIDDEN|late/);
});

test('oversize live transcript reuses continuation cards, fits request limits and clears all controls on completion', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const control = { id: 'run', attach() {}, close() {} };
  const { response, cards } = await fixture({ create: () => control });
  response.event({ type: 'agent_start' });
  const first = '长😀\\"\n'.repeat(4500);
  response.event({ type: 'message_end', message: msg(first) });
  await flush(t);
  assert.ok(cards.size > 1);
  const ids = [...cards.keys()];
  assert.equal([...cards.values()].map(body).join(''), first);
  assert.equal(cards.get('card-0').body.elements.length, 2);
  for (const card of cards.values()) assert.ok(Buffer.byteLength(JSON.stringify({ msg_type: 'interactive', content: JSON.stringify(card) })) <= 28 * 1024);
  for (const id of ids.slice(1)) assert.equal(cards.get(id).body.elements.length, 1);
  response.event({ type: 'tool_execution_start', toolCallId: 'a', toolName: 'bash' });
  response.event({ type: 'tool_execution_end', toolCallId: 'a' });
  response.event({ type: 'message_end', message: msg('最终答复') });
  await flush(t);
  await response.finish(`${first}\n最终答复`);
  assert.deepEqual([...cards.keys()].slice(0, ids.length), ids);
  assert.equal([...cards.values()].map(body).join(''), `${first}\n\n✅ bash\n\n最终答复`);
  for (const card of cards.values()) {
    assert.equal(card.header.template, 'green'); assert.equal(card.body.elements.length, 1);
    assert.ok(Buffer.byteLength(JSON.stringify({ msg_type: 'interactive', content: JSON.stringify(card) })) <= 28 * 1024);
  }
});
test('shorter canonical text clears obsolete continuation content instead of leaving stale output', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { response, cards } = await fixture();
  response.event({ type: 'agent_start' });
  response.event({ type: 'message_start', message: { role: 'assistant', content: [] } });
  response.event({ type: 'message_update', message: msg('长'.repeat(20000)), assistantMessageEvent: { type: 'text_delta', delta: '长'.repeat(20000) } });
  await flush(t);
  assert.ok(cards.size > 1);
  response.event({ type: 'message_end', message: msg('校正后的输出') });
  await response.finish('校正后的输出');
  assert.equal(body(cards.get('card-0')), '校正后的输出');
  for (const [id, card] of cards) {
    assert.equal(card.header.template, 'green');
    if (id !== 'card-0') assert.equal(body(card), '内容已合并至前面的卡片。');
  }
});
test('full latest operation survives completion and disappears from every card when subsequent text arrives', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { response, cards } = await fixture();
  const command = `printf '%s' '${'长😀\\\\"'.repeat(10000)}'`;
  response.event({ type: 'tool_execution_start', toolCallId: 'long', toolName: 'bash', args: { command } });
  await flush(t);
  assert.ok(cards.size > 1);
  const chunks = [];
  for (const card of cards.values()) {
    assert.ok(Buffer.byteLength(JSON.stringify({ msg_type: 'interactive', content: JSON.stringify(card) })) <= 28 * 1024);
    const match = body(card).match(/```text\n([\s\S]*)\n```\n?$/);
    assert.ok(match, 'each continuation must have an opening and closing code fence');
    chunks.push(match[1]);
  }
  assert.equal(chunks.join(''), command);
  response.event({ type: 'tool_execution_end', toolCallId: 'long' });
  await flush(t);
  assert.ok(body(cards.get('card-0')).startsWith('✅ bash：'));
  assert.match(body(cards.get('card-0')), /printf/);
  assert.ok([...cards.values()].every(card => /```text/.test(body(card))));
  response.event({ type: 'message_end', message: msg('完成') });
  await flush(t);
  for (const card of cards.values()) assert.doesNotMatch(body(card), /printf|长😀|```/);
  await response.finish('完成');
  assert.equal(body(cards.get('card-0')), '✅ bash\n\n完成');
});
for (const stopped of [false, true]) test(`terminal card retains partial history, stopped=${stopped}`,  async () => {
  const control = { id: 'run', stopped, attach() {}, close() {} };
  const { response, cards } = await fixture({ create: () => control });
  response.event({ type: 'agent_start' });
  response.event({ type: 'message_end', message: msg('已经完成第一步。') });
  response.event({ type: 'tool_execution_start', toolCallId: 'a', toolName: 'read' });
  await response.finish('处理失败，请重试。', { error: true });
  const card = cards.get('card-0');
  assert.equal(card.header.template, stopped ? 'orange' : 'red');
  assert.match(body(card), /^已经完成第一步。/);
  assert.match(body(card), /⏹/);
  assert.ok(body(card).endsWith(stopped ? '已停止当前回复。' : '处理失败，请重试。'));
  assert.equal(card.body.elements.length, 1);
});

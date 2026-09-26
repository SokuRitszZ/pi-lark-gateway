import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTick } from 'node:timers/promises';
import { createStreamingCards } from '../src/lark/card-stream.js';
import { createReplies } from '../src/lark/index.js';
import { createCardResponse } from '../src/messages/card-response.js';
import { responseCard } from '../src/messages/card.js';

function fixture() {
  const calls = [], logs = [], entities = new Map(), messages = new Map(), fail = {};
  let time = 0, creates = 0, sends = 0;
  const invoke = kind => async payload => {
    calls.push({ kind, payload, time });
    if (fail[kind] === 'throw') throw new Error('PRIVATE_SDK_ERROR');
    if (fail[kind]) return { code: 999, msg: 'PRIVATE_SDK_ERROR' };
    const id = payload.path?.card_id;
    if (kind === 'create') { const cardId = `entity-${++creates}`; entities.set(cardId, JSON.parse(payload.data.data)); return { code: 0, data: { card_id: cardId } }; }
    if (kind === 'update') entities.set(id, JSON.parse(payload.data.card.data));
    if (kind === 'content') entities.get(id).body.elements[0].content = payload.data.content;
    if (kind === 'settings') Object.assign(entities.get(id).config, JSON.parse(payload.data.settings).config);
    return { code: 0 };
  };
  const client = { cardkit: { v1: { card: { create: invoke('create'), update: invoke('update'), settings: invoke('settings') }, cardElement: { content: invoke('content') } } } };
  const send = async (card, options) => {
    calls.push({ kind: 'send', card, options });
    if (fail.send && card.type === 'card') throw Object.assign(new Error('send_failed'), { cardSendRejected: fail.send === 'rejected' });
    const id = `message-${++sends}`; messages.set(id, structuredClone(card)); return id;
  };
  const edit = async (id, card) => {
    calls.push({ kind: 'legacy', id, card });
    if (fail.legacy) throw new Error('legacy_failed');
    messages.set(id, structuredClone(card));
  };
  const transport = createStreamingCards({ client, send, edit, log: value => logs.push(value), now: () => time, sleep: async ms => { time += ms; } });
  const displayed = id => { const card = messages.get(id); return card.type === 'card' ? entities.get(card.data.card_id) : card; };
  return { transport, client, calls, logs, fail, displayed, advance: ms => { time += ms; } };
}
const card = (text, state = 'thinking', title = '标题') => responseCard(title, text, state, 'run');

test('native append uses cumulative text, stable element id, shared increasing sequence and rate spacing', async () => {
  const f = fixture(), id = await f.transport.send(card('hello'));
  await f.transport.edit(id, card('hello world'));
  const content = f.calls.find(call => call.kind === 'content').payload;
  assert.equal(content.path.element_id, 'response_text'); assert.equal(content.data.content, 'hello world');
  await f.transport.edit(id, card('hello world!', 'thinking', '新标题'));
  await f.transport.edit(id, card('hello world!', 'success', '新标题'));
  const writes = f.calls.filter(call => call.payload?.data.sequence);
  assert.deepEqual(writes.map(call => call.payload.data.sequence), writes.map((_, index) => index + 1));
  for (let index = 1; index < writes.length; index++) assert.ok(writes[index].time - writes[index - 1].time >= 150);
  assert.equal(f.displayed(id).config.streaming_mode, false);
  assert.equal(f.displayed(id).header.template, 'green');
  assert.equal(f.displayed(id).body.elements.length, 1);
  assert.equal(f.calls.filter(call => call.kind === 'send').length, 1);
  await f.transport.close();
});
test('tool-only append snapshots bypass typewriter animation and expose full details immediately', async () => {
  const f = fixture(), id = await f.transport.send(card('text'));
  await f.transport.edit(id, card('text\n⏳ bash：\n```text\necho hello\n```'), { animate: false });
  assert.equal(f.calls.filter(call => call.kind === 'content').length, 0);
  assert.match(f.displayed(id).body.elements[0].content, /echo hello/);
  await f.transport.close();
});
test('tool rewrites update directly, while expired streaming windows are refreshed', async () => {
  const f = fixture(), id = await f.transport.send(card('⏳ bash：command'));
  await f.transport.edit(id, card('✅ bash'));
  assert.equal(f.calls.filter(call => call.kind === 'content').length, 0);
  assert.equal(f.displayed(id).body.elements[0].content, '✅ bash');
  f.advance(10 * 60 * 1000);
  await f.transport.edit(id, card('✅ bash\n后续文本'));
  assert.ok(f.calls.some(call => call.kind === 'settings' && JSON.parse(call.payload.data.settings).config.streaming_mode));
  await f.transport.close();
});
for (const failure of [true, 'throw']) test(`creation failure transparently uses legacy cards, failure=${failure}`, async () => {
  const f = fixture(); f.fail.create = failure;
  const id = await f.transport.send(card('first'));
  await f.transport.edit(id, card('complete', 'success'));
  await f.transport.send(card('continuation', 'success'));
  assert.equal(f.displayed(id).body.elements[0].content, 'complete');
  assert.equal(f.calls.filter(call => call.kind === 'create').length, 1);
  assert.equal(f.calls.filter(call => call.kind === 'send').length, 2);
  assert.deepEqual(f.logs, ['card_stream_fallback']);
  await f.transport.close();
});
for (const kind of ['content', 'update', 'settings']) test(`${kind} failure preserves full latest card on the same message and disables native retries`, async () => {
  const f = fixture(), id = await f.transport.send(card('first'));
  f.fail[kind] = 'throw';
  const next = kind === 'content' ? card('first and more') : kind === 'update' ? card('replacement') : card('first', 'success');
  await f.transport.edit(id, next);
  assert.equal(f.displayed(id).body.elements[0].content, next.body.elements[0].content);
  assert.equal(f.displayed(id).config.streaming_mode, false);
  const nativeCalls = f.calls.filter(call => call.payload).length;
  await f.transport.edit(id, card('latest complete', 'success'));
  assert.equal(f.calls.filter(call => call.payload).length, nativeCalls);
  assert.equal(f.calls.filter(call => call.kind === 'send').length, 1);
  assert.ok(f.logs.includes('card_stream_fallback')); assert.doesNotMatch(f.logs.join(), /PRIVATE/);
  await f.transport.close();
});
test('explicit send rejection falls back once, ambiguous send failure does not blindly resend', async () => {
  const f = fixture(); f.fail.send = 'rejected';
  const id = await f.transport.send(card('hello'));
  const sends = f.calls.filter(call => call.kind === 'send');
  assert.equal(sends.length, 2); assert.equal(sends[0].options.uuid, sends[1].options.uuid);
  assert.equal(f.displayed(id).schema, '2.0'); await f.transport.close();
  const ambiguous = fixture(); ambiguous.fail.send = 'timeout';
  await assert.rejects(ambiguous.transport.send(card('hello')));
  assert.equal(ambiguous.calls.filter(call => call.kind === 'send').length, 1);
  await ambiguous.transport.close();
});
test('fallback failure propagates, allowing the existing response error path to handle delivery', async () => {
  const f = fixture(), id = await f.transport.send(card('hello'));
  f.fail.content = true; f.fail.legacy = true;
  await assert.rejects(f.transport.edit(id, card('hello world')), /legacy_failed/);
  f.fail.legacy = false; await f.transport.edit(id, card('complete', 'success'));
  assert.equal(f.displayed(id).body.elements[0].content, 'complete'); await f.transport.close();
});
test('all continuation entities close safely, and legacy clients need no CardKit capability', async () => {
  const f = fixture();
  const ids = [await f.transport.send(card('one')), await f.transport.send(card('two'))];
  await f.transport.close(); await f.transport.close();
  for (const id of ids) assert.equal(f.displayed(id).config.streaming_mode, false);
  const sent = [], edited = [];
  const legacy = createStreamingCards({ client: {}, send: async value => { sent.push(value); return 'old'; }, edit: async (_, value) => edited.push(value) });
  const id = await legacy.send(card('old')); await legacy.edit(id, card('new', 'success')); await legacy.close();
  assert.equal(sent.length, 1); assert.equal(edited[0].body.elements[0].content, 'new');
});
for (const fails of [false, true]) test(`real card response lifecycle preserves controls and output, fallback=${fails}`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); let attached, retired = false;
  const response = await createCardResponse({}, { createCardStream: () => f.transport }, () => {}, { create: () => ({ id: 'run', attach: id => { attached = id; }, close: () => { retired = true; } }) });
  const update = text => response.event({ type: 'message_update', message: { role: 'assistant', content: [{ type: 'text', text }] }, assistantMessageEvent: { type: 'text_delta', delta: text } });
  response.event({ type: 'agent_start' }); update('Hello');
  t.mock.timers.tick(1200); await nextTick();
  assert.equal(f.displayed(attached).body.elements.length, 2);
  if (fails) f.fail.content = true;
  update('Hello world'); t.mock.timers.tick(1200); await nextTick();
  await response.finish('Hello world'); await response.stop();
  const final = f.displayed(attached);
  assert.ok(f.calls.some(call => call.kind === 'content' && call.payload.data.content === 'Hello world'));
  assert.equal(final.header.template, 'green'); assert.equal(final.body.elements[0].content, 'Hello world');
  assert.equal(final.body.elements.length, 1); assert.equal(final.config.streaming_mode, false); assert.equal(retired, true);
  assert.equal(f.calls.filter(call => call.kind === 'send').length, 1);
});
for (const stopped of [false, true]) test(`native terminal response closes streaming while retaining partial history, stopped=${stopped}`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); let id;
  const response = await createCardResponse({}, { createCardStream: () => f.transport }, () => {}, {
    create: () => ({ id: 'run', stopped, attach: value => { id = value; }, close() {} }),
  });
  response.event({ type: 'agent_start' });
  response.event({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '部分结果' }] } });
  t.mock.timers.tick(1200); await nextTick();
  await response.finish('执行失败', { error: true });
  const final = f.displayed(id);
  assert.equal(final.header.template, stopped ? 'orange' : 'red');
  assert.equal(final.config.streaming_mode, false); assert.equal(final.body.elements.length, 1);
  assert.match(final.body.elements[0].content, /部分结果/);
  assert.ok(final.body.elements[0].content.endsWith(stopped ? '已停止当前回复。' : '执行失败'));
});
test('SDK reply adapter sends entity references with thread routing and idempotency ids', async () => {
  const f = fixture(), roots = new Map(); let request, saved = 0;
  f.client.im = { v1: { message: { reply: async payload => { request = payload; return { code: 0, data: { message_id: 'message', thread_id: 'thread' } }; }, patch: async () => ({ code: 0 }) } } };
  const replies = createReplies(f.client, { roots, save: async () => saved++ }, () => {});
  const stream = replies.createCardStream({ id: 'parent', isGroup: true, chatId: 'chat', root: 'root' });
  assert.equal(await stream.send(card('hello')), 'message');
  assert.equal(request.data.reply_in_thread, true); assert.ok(request.data.uuid);
  assert.equal(JSON.parse(request.data.content).type, 'card'); assert.equal(roots.get('chat:thread'), 'root'); assert.equal(saved, 1);
  await stream.close();
});

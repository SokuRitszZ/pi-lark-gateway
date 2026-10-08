import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createNextSteps, validateSuggestions } from '../src/core/next-steps/index.js';
import { createMessageDispatcher } from '../src/core/messages/index.js';
const options = [{ title: '检查测试', detail: '运行测试并说明失败原因。', hidden: 'NEVER_EXECUTE' }, { title: '解释实现', detail: '解释实现，不修改文件。' }];
const message = { id: 'native-id', userId: 'u', key: 'same-session', chatId: 'c', text: '问题', attachments: [{ kind: 'image' }], mentions: [{}] };
function fixture(overrides = {}) {
  const views = [], runs = [], logs = []; let id;
  const present = async view => { views.push(view); id = view.id; return 'card-id'; };
  const service = createNextSteps({ suggest: async () => options, canSelect: () => true, dispatch: m => runs.push(m), log: x => logs.push(x), ...overrides });
  return { service, views, runs, logs, offer: () => service.offer(message, '回答', present),
    event: (extra = {}) => ({ actorId: 'u', messageId: 'card-id', value: { kind: 'next_step', id, index: 0 }, ...extra }) };
}
test('next steps validate a bounded visible-only action schema', () => {
  assert.deepEqual(validateSuggestions(options)[0], { title: options[0].title, detail: options[0].detail });
  for (const bad of [{}, [...options, ...options, options[0]], [{ title: 'x' }], [{ title: 'x', detail: 'a'.repeat(501) }]]) assert.throws(() => validateSuggestions(bad));
});
test('next steps enforce actor, exact response, index and one-time consumption, preserve session', async () => {
  const f = fixture(); await f.offer();
  assert.equal(f.service.handle(f.event({ actorId: 'other' })).type, 'error');
  assert.equal(f.service.handle(f.event({ messageId: 'other' })).type, 'error');
  const invalid = f.event(); invalid.value.index = 9; assert.equal(f.service.handle(invalid).type, 'error');
  assert.equal(f.service.handle(f.event()).type, 'info');
  assert.equal(f.service.handle(f.event()).type, 'error'); await tick();
  assert.equal(f.runs.length, 1); const m = f.runs[0];
  assert.equal(m.key, message.key); assert.equal(m.id, message.id); assert.match(m.dispatchId, /^next:/);
  assert.equal(m.userId, message.userId); assert.deepEqual(m.attachments, []); assert.deepEqual(m.mentions, []);
  assert.match(m.text, /运行测试/); assert.doesNotMatch(m.text, /NEVER_EXECUTE/);
  assert.equal(f.views[1].selectedIndex, 0); await f.service.close();
});
test('next steps wait for the old-card update and recheck authorization before dispatch', async () => {
  let release, allowed = true; const views = [], runs = [];
  const f = fixture({ canSelect: () => allowed, dispatch: m => runs.push(m) });
  let id;
  await f.service.offer(message, 'answer', async view => { views.push(view); id = view.id;
    if (view.selectedIndex !== undefined && !view.unavailable) await new Promise(r => { release = r; }); return 'card-id'; });
  f.service.handle({ actorId: 'u', messageId: 'card-id', value: { kind: 'next_step', id, index: 0 } });
  assert.equal(f.service.isIdle(), false); assert.equal(runs.length, 0);
  allowed = false; release(); await tick();
  assert.equal(runs.length, 0); assert.equal(views.at(-1).unavailable, true); await f.service.close();
});
test('failed updates, expired choices, evicted choices and shutdown never trigger a new turn', async () => {
  let now = 0; const f = fixture({ now: () => now, ttl: 10, capacity: 1 }); await f.offer(); const old = f.event();
  await f.offer(); assert.equal(f.service.handle(old).type, 'error');
  now = 11; assert.equal(f.service.handle(f.event()).type, 'error');
  await f.offer(); await f.service.close(); assert.equal(f.service.handle(f.event()).type, 'error');
  const g = fixture(); let id;
  await g.service.offer(message, 'answer', async view => { id = view.id; if (view.selectedIndex !== undefined) throw new Error('PRIVATE'); return 'card-id'; });
  g.service.handle({ actorId: 'u', messageId: 'card-id', value: { kind: 'next_step', id, index: 0 } }); await tick();
  assert.equal(g.runs.length, 0); assert.deepEqual(g.logs, ['next_steps_selection_failed']); await g.service.close();
});
test('optional analysis errors and absent presentation never replace the completed answer', async () => {
  let calls = 0; const f = fixture({ suggest: async () => { calls++; throw new Error('PRIVATE'); } });
  await f.service.offer(message, 'answer'); assert.equal(calls, 0);
  await f.offer(); assert.equal(calls, 1); assert.deepEqual(f.logs, ['next_steps_generation_failed']); assert.equal(f.views.length, 0);
});
test('dispatcher offers only after successful final send and queues a fresh logical turn in the same session', async () => {
  const order = []; let offered = false;
  const dispatcher = createMessageDispatcher({ log() {}, answer: async () => { order.push('answer'); return 'result'; }, reply: async () => {},
    beginResponse: async () => ({ nextSteps() {}, async finish() { order.push('finish'); }, async stop() {} }),
    nextSteps: { async offer(m) { order.push('offer'); if (!offered) { offered = true; dispatcher.accept({ ...m, dispatchId: 'logical-next' }); } } },
  });
  dispatcher.accept(message); await tick(); await dispatcher.drain();
  assert.deepEqual(order, ['answer', 'finish', 'offer', 'answer', 'finish', 'offer']);
});

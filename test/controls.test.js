import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createControls, canControlResponse } from '../src/controls/index.js';
import { responseCard } from '../src/messages/card.js';
import { createCardResponse } from '../src/messages/card-response.js';
import { makeConfig } from '../src/config/index.js';

const callback = (id, action, extra = {}) => ({ operator: { open_id: 'owner' }, context: { open_message_id: 'card' }, action: { value: { kind: 'response_control', id, action }, form_value: { instruction: '新指令' } }, ...extra });
test('controls bound to exact card/run; operator validation, empty input, dedup and stale protection', async () => {
  const calls = [];
  const controls = createControls({ canControl: (_, user) => user === 'owner' });
  const run = controls.create({}); run.attach('card');
  assert.equal(controls.handle(callback(run.id, 'stop')).toast.type, 'error');
  run.bind({ abort: async () => calls.push('abort'), steer: async text => calls.push(text) });
  assert.equal(controls.handle(callback(run.id, 'stop', { operator: { open_id: 'stranger' } })).toast.type, 'error');
  assert.equal(controls.handle(callback(run.id, 'stop', { context: { open_message_id: 'other' } })).toast.type, 'error');
  const e = callback(run.id, 'steer', { token: 'once' });
  e.action.form_value.instruction = ' '; assert.equal(controls.handle(e).toast.type, 'error');
  e.action.form_value.instruction = '新指令'; controls.handle(e); controls.handle(e);
  assert.deepEqual(calls, ['新指令']);
  controls.handle(callback(run.id, 'stop')); controls.handle(callback(run.id, 'stop'));
  assert.equal(run.stopped, true); assert.deepEqual(calls, ['新指令', 'abort']);
  run.close();
  const next = controls.create({}); next.attach('card'); next.bind({ abort: () => calls.push('wrong') });
  assert.equal(controls.handle(callback(run.id, 'stop')).toast.type, 'error');
  assert.deepEqual(calls, ['新指令', 'abort']); next.close();
});
test('steering after model idle cannot leak into next queued turn', () => {
  const controls = createControls({ canControl: () => true });
  const run = controls.create({}); run.attach('card');
  run.bind({ canSteer: () => false, steer: () => assert.fail('must not steer') });
  assert.equal(controls.handle(callback(run.id, 'steer')).toast.type, 'error'); run.close();
});
test('only blue cards carry stop and input submit controls', () => {
  const blue = responseCard('title', 'text', 'thinking', 'run');
  assert.equal(blue.schema, '2.0');
  assert.equal(blue.body.elements.length, 2);
  const row = blue.body.elements[1].elements[0];
  assert.equal(row.tag, 'column_set');
  assert.equal(row.flex_mode, 'none');
  assert.equal(row.columns.length, 3);
  for (const [index, action] of [[0, 'stop'], [2, 'steer']]) {
    const button = row.columns[index].elements[0];
    assert.equal(button.form_action_type, 'submit');
    assert.equal(button.action_type, undefined);
    assert.equal(button.value, undefined);
    assert.deepEqual(button.behaviors, [{ type: 'callback', value: { kind: 'response_control', id: 'run', action } }]);
  }
  assert.equal(row.columns[1].elements[0].name, 'instruction');
  assert.equal(row.columns[1].elements[0].width, 'fill');
  assert.equal(row.columns[1].width, 'weighted');
  for (const state of ['waiting', 'success', 'error', 'stopped']) assert.equal(responseCard('title', 'text', state, 'run').body.elements.length, 1);
});
test('stopped card is terminal, not generic failure, callbacks retired', async () => {
  const cards = []; const controls = createControls({ canControl: () => true });
  const response = await createCardResponse({}, { sendCardReply: async () => 'card', editCard: async (_, c) => cards.push(c) }, () => {}, controls);
  response.onSession({ abort: async () => {} }); response.event({ type: 'agent_start' });
  // Let the blue card render to obtain its per-run capability.
  await new Promise(resolve => setTimeout(resolve, 1300));
  const id = cards.at(-1).body.elements[1].elements[0].columns[0].elements[0].behaviors[0].value.id;
  controls.handle(callback(id, 'stop'));
  await response.finish('model failed', { error: true });
  assert.equal(cards.at(-1).header.template, 'orange');
  assert.equal(cards.at(-1).body.elements[0].content, '已停止当前回复。');
  assert.equal(cards.at(-1).body.elements.length, 1);
  assert.equal(controls.handle(callback(id, 'steer')).toast.type, 'error');
});
test('control permissions respect requester, admin, grants, blocks and disabled policy', () => {
  const config = makeConfig({ ownerOpenId: 'owner' }); config.bot.openId = 'bot';
  const state = { config, groups: {} }, m = { userId: 'visitor', chatId: 'chat', isGroup: true };
  let grant = false, blocked = false;
  const approvals = { hasGrant: () => grant, isBlocked: () => blocked };
  assert.equal(canControlResponse(m, 'owner', state, approvals), true);
  assert.equal(canControlResponse(m, 'visitor', state, approvals), false);
  grant = true; assert.equal(canControlResponse(m, 'visitor', state, approvals), true);
  assert.equal(canControlResponse(m, 'other', state, approvals), false);
  blocked = true; assert.equal(canControlResponse(m, 'visitor', state, approvals), false);
  blocked = false; config.access.groups.enabled = false;
  assert.equal(canControlResponse(m, 'owner', state, approvals), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/core/routing/index.js';
import { createControls } from '../src/core/controls/index.js';
const state = { config: { access: { owner: 'owner', admins: [], private: { enabled: true, users: 'all' } } }, groups: {} };
test('core routing authorizes before materializing the message, denying blocked input', () => {
  let blocked = true, parsed = 0, accepted = 0;
  const route = createRouter({ getState: () => state, log() {},
    approvals: { isBlocked: () => blocked, hasGrant: () => false },
    accept: m => { assert.equal(m.id, 'm'); accepted++; } });
  const packet = { access: { chatId: 'room', userId: 'user', isGroup: false },
    get message() { parsed++; return { id: 'm' }; } };
  route(packet); assert.equal(parsed, 0);
  blocked = false; route(packet); assert.equal(parsed, 1); assert.equal(accepted, 1);
  route({ access: null }); assert.equal(accepted, 1);
});
test('core controls bind authorized actions to exact response and retire capabilities', () => {
  let stops = 0;
  const controls = createControls({ canControl: (_, actor) => actor === 'owner' });
  const run = controls.create({ id: 'm' }); run.attach('reply'); run.bind({ abort: () => { stops++; } });
  const action = { value: { kind: 'response_control', id: run.id, action: 'stop' }, actorId: 'owner', messageId: 'wrong' };
  assert.equal(controls.handle(action).type, 'error');
  action.messageId = 'reply'; action.actorId = 'other'; assert.equal(controls.handle(action).type, 'error');
  action.actorId = 'owner'; controls.handle(action); assert.equal(stops, 1);
  controls.handle(action); assert.equal(stops, 1);
  run.close(); assert.equal(controls.handle(action).type, 'error');
});

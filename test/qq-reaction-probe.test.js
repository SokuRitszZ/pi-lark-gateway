import test from 'node:test';
import assert from 'node:assert/strict';
import { createChannelReactionProbe } from '../src/adapters/qq/reaction-probe.js';

test('channel-route experiment is bounded per scope and logs only safe results', async () => {
  const calls = [], logs = [];
  const probe = createChannelReactionProbe({ api: { getToken: async () => 'fake-only' }, apiClient: {
    request: async (...args) => { calls.push(args); throw Object.assign(new Error('private raw response'), { httpStatus: 404 }); },
  } }, code => logs.push(code));
  for (const scope of ['c2c', 'group']) {
    await probe({ scope, targetId: 'native/id', msgId: 'message/id' });
    await probe({ scope, targetId: 'native/id', msgId: 'another' });
  }
  assert.equal(calls.length, 2);
  assert.equal(calls[0][2], '/channels/native%2Fid/messages/message%2Fid/reactions/1/4');
  assert.deepEqual(calls[0][4], { timeoutMs: 3000 });
  assert.deepEqual(logs, ['qq_reaction_probe_c2c_http_404', 'qq_reaction_probe_group_http_404']);
});
test('accepted experiment is reported as HTTP acceptance, not proven feature support', async () => {
  const logs = [];
  const probe = createChannelReactionProbe({ api: { getToken: async () => 'fake' }, apiClient: { request: async () => ({}) } }, code => logs.push(code));
  await probe({ scope: 'group', targetId: 'g' });
  assert.equal(logs.length, 0);
  await probe({ scope: 'group', targetId: 'g', msgId: 'm' });
  assert.deepEqual(logs, ['qq_reaction_probe_group_accepted']);
});

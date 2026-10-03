import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '../src/core/agent/index.js';
import { createMessageHandler, createRouter, startIngress } from '../src/adapters/lark/index.js';
import { createGatewayIdentityResolver, promptPolicy } from '../src/adapters/lark/identity/index.js';

const state = { config: { bot: { openId: 'ou_bot' }, access: { owner: 'ou_owner', admins: [],
  groups: { enabled: true, users: 'all', trigger: 'mention' } } }, groups: {} };
const event = (id, user) => ({ sender: { sender_type: 'user', sender_id: { open_id: user } }, message: {
  message_id: id, chat_id: 'oc_room', chat_type: 'group', root_id: 'root', thread_id: 'topic',
  message_type: 'text', content: JSON.stringify({ text: '@bot hello' }),
  mentions: [{ key: '@bot', name: 'Bot', id: { open_id: 'ou_bot' } }],
} });

test('production layered ingress runs normalized routing and PIGateway agent turns without a live SDK connection', async () => {
  const observed = [], replies = [], roots = new Map();
  let senderHeader, handlers;
  const agent = await createAgent('/unused', undefined, { promptPolicy,
    resolveIdentity: createGatewayIdentityResolver(),
    createPool: async (_base, _model, options) => {
      senderHeader = options.getSenderHeader;
      return { run: (_key, _tools, work) => work({ messages: [], clearQueue() {}, subscribe: () => () => {},
        async prompt(text) {
          observed.push({ text, identity: JSON.parse(senderHeader().split('<gateway_sender_identity>\n')[1].split('\n</gateway_sender_identity>')[0]) });
          this.messages.push({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'ok' }] });
        },
      }) };
    },
  });
  const handler = createMessageHandler({ threadRoots: roots, answer: agent.answer, reply: async (m, text) => replies.push([m.key, text]) });
  const approvals = { isBlocked: () => false, hasGrant: () => false, requestMessage: () => assert.fail('unexpected approval') };
  const route = createRouter({ getState: () => state, approvals, handler, threads: { roots, save: async () => {} }, log() {} });
  await startIngress({ start: async events => { handlers = events; } }, { route, approvals, controls: {} });
  handlers['im.message.receive_v1'](event('one', 'ou_a'));
  handlers['im.message.receive_v1'](event('one', 'ou_a'));
  handlers['im.message.receive_v1'](event('two', 'ou_b'));
  await handler.drain();
  assert.equal(observed.length, 2);
  assert.equal(observed[0].identity.Lark.sender.open_id, 'ou_a');
  assert.equal(observed[1].identity.Lark.sender.open_id, 'ou_b');
  assert.match(observed[0].text, /mentions/);
  assert.deepEqual(replies, [['oc_room:topic:root', 'ok'], ['oc_room:topic:root', 'ok']]);
  assert.equal(senderHeader(), undefined);
  handlers['im.message.receive_v1']({ ...event('late', 'ou_c'), message: { ...event('late', 'ou_c').message, thread_id: 'late-thread' } });
  assert.equal(roots.has('oc_room:late-thread'), false);
});

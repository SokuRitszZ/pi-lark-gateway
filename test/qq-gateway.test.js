import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startGateway } from '../src/qq-gateway/index.js';
import { createAgent } from '../src/core/agent/index.js';
import { exampleConfig, validateConfig, initConfig } from '../src/qq-gateway/config.js';
import { publicError } from '../src/qq-gateway/errors.js';
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
const raw = id => ({ kind: 'c2c', rawEventType: 'C2C_MESSAGE_CREATE', messageId: id, senderId: 'user', content: 'hello' });
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-qq-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'config.json');
  const config = { ...exampleConfig, appId: 'app', model: { provider: 'test', id: 'fake' }, access: { c2cUsers: ['user'], groups: {} } };
  await fs.writeFile(configPath, JSON.stringify(config));
  return { root, configPath, config };
}
test('configuration fails closed and init never overwrites an existing file', async t => {
  const { root, config } = await fixture(t);
  assert.throws(() => validateConfig({ ...config, access: { c2cUsers: [], groups: {} } }), /empty_allowlist/);
  assert.throws(() => validateConfig({ ...config, tools: 'anything' }), /tools/);
  assert.throws(() => validateConfig({ ...config, replyFormat: 'card' }), /replyFormat/);
  assert.doesNotThrow(() => validateConfig({ ...config, replyFormat: 'text' }));
  assert.doesNotThrow(() => validateConfig({ ...config, replyFormat: undefined }));
  assert.throws(() => validateConfig({ ...config, webhook: { ...config.webhook, host: '0.0.0.0' } }), /webhook/);
  const file = path.join(root, 'init.json'); await initConfig(file);
  await assert.rejects(initConfig(file), { code: 'EEXIST' });
  assert.equal(publicError(new Error('secret string')), 'gateway_operation_failed: check configuration, model auth, QQ permissions and network; raw details withheld');
});
test('gateway deduplicates, denies unknown senders, uses QQ identity and releases the account lock', async t => {
  const { root, configPath } = await fixture(t);
  let receive, disposed = 0; const sent = [], prompts = [];
  const options = { configPath, dataRoot: root, env: { QQBOT_APP_SECRET: 'test-only' },
    createAgentImpl: async () => ({ answer: async (_key, _text, _event, options) => { prompts.push(options.message.identity); return 'reply'; }, abort() {}, dispose: async () => { disposed++; } }),
    createTransportImpl: () => ({ onMessage: fn => { receive = fn; }, start: async () => {}, close: async () => {}, sendText: async (target, text) => sent.push([target, text]) }),
  };
  const gateway = await startGateway(options);
  await assert.rejects(startGateway(options), /qq_account_locked/);
  receive(raw('a')); await tick(); receive(raw('a')); receive({ ...raw('denied'), senderId: 'other' });
  receive(raw('b')); await tick();
  assert.equal(sent.length, 2); assert.equal(prompts[0].QQ.sender.user_openid, 'user');
  assert.equal(sent[0][0].msgId, 'a');
  await gateway.close(); await gateway.close(); assert.equal(disposed, 1);
  const second = await startGateway(options); await second.close();
});
test('ambiguous send failures are attempted once, not replied to with another error send', async t => {
  const { root, configPath } = await fixture(t); let receive, attempts = 0;
  const gateway = await startGateway({ configPath, dataRoot: root, env: { QQBOT_APP_SECRET: 'test-only' },
    createAgentImpl: async () => ({ answer: async () => 'ok', abort() {}, dispose: async () => {} }),
    createTransportImpl: () => ({ onMessage: fn => { receive = fn; }, start: async () => {}, close: async () => {}, sendText: async () => { attempts++; throw new Error('network unknown'); } }),
  });
  receive(raw('a')); await tick(); assert.equal(attempts, 1); await gateway.close();
});
test('discovery starts no model and sends no response', async t => {
  const { root, configPath } = await fixture(t); let receive; const identities = [];
  const gateway = await startGateway({ configPath, dataRoot: root, discover: true, env: { QQBOT_APP_SECRET: 'test-only' },
    createAgentImpl: () => assert.fail('discovery must not start model'), onIdentity: x => identities.push(x),
    createTransportImpl: () => ({ onMessage: fn => { receive = fn; }, start: async () => {}, close: async () => {}, sendText: () => assert.fail('must not send') }),
  });
  receive(raw('a')); assert.equal(identities.length, 1); await gateway.close();
});
test('QQ production normalization reaches shared core with a trusted QQ identity header', async t => {
  const { root, configPath } = await fixture(t); let receive, getHeader, header;
  const gateway = await startGateway({ configPath, dataRoot: root, env: { QQBOT_APP_SECRET: 'test-only' },
    createAgentImpl: (base, model, options) => createAgent(base, model, { ...options,
      createPool: async (_base, _model, setup) => {
        getHeader = setup.getSenderHeader;
        return { abort() {}, dispose: async () => {}, run: (_key, _tools, work) => work({
          messages: [], clearQueue() {}, subscribe: () => () => {},
          async prompt() { header = getHeader(); this.messages.push({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'ok' }] }); },
        }) };
      },
    }),
    createTransportImpl: () => ({ onMessage: fn => { receive = fn; }, start: async () => {}, close: async () => {}, sendText: async () => {} }),
  });
  receive(raw('a')); await tick();
  assert.match(header, /"QQ":/); assert.match(header, /"user_openid":"user"/); assert.equal(getHeader(), undefined);
  await gateway.close();
});

test('QQ final-only response tolerates real agent progress events without UNKNOWN failures', async t => {
  const { root, configPath } = await fixture(t); let receive;
  const sent = [], logs = [];
  const gateway = await startGateway({ configPath, dataRoot: root, env: { QQBOT_APP_SECRET: 'test-only' }, log: code => logs.push(code),
    createAgentImpl: async () => ({ answer: async (_key, _text, onEvent) => {
      onEvent({ type: 'agent_start' });
      onEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'ok' } });
      onEvent({ type: 'agent_end', messages: [] });
      return 'ok';
    }, abort() {}, dispose: async () => {} }),
    createTransportImpl: () => ({ onMessage: fn => { receive = fn; }, start: async () => {}, close: async () => {}, sendText: async (_target, text) => sent.push(text) }),
  });
  receive(raw('progress')); await tick(); await gateway.close();
  assert.deepEqual(sent, ['ok']); assert.ok(!logs.includes('message_failed'));
});

test('feedback is opt-in, only follows admitted messages, and failure does not block answers', async t => {
  for (const mode of ['off', 'native', 'probe']) {
    const { root, configPath, config } = await fixture(t);
    config.processingFeedback = mode === 'native'; config.experimentalChannelReactions = mode === 'probe';
    await fs.writeFile(configPath, JSON.stringify(config));
    let receive; const notices = [], sent = [], logs = [];
    const gateway = await startGateway({ configPath, dataRoot: root, env: { QQBOT_APP_SECRET: 'fake' }, log: code => logs.push(code),
      createAgentImpl: async () => ({ answer: async () => 'ok', abort() {}, dispose: async () => {} }),
      createTransportImpl: () => ({ onMessage: fn => { receive = fn; }, start: async () => {}, close: async () => {},
        notifyProcessing: async () => { notices.push('native'); throw new Error('private detail'); },
        probeChannelReaction: async () => { notices.push('probe'); throw new Error('private detail'); },
        sendText: async (_target, text) => sent.push(text),
      }),
    });
    receive({ ...raw('denied'), senderId: 'other' }); receive(raw('ok')); receive(raw('ok'));
    await tick(); await gateway.close();
    assert.deepEqual(sent, ['ok']); assert.deepEqual(notices, mode === 'probe' ? ['probe'] : []); // C2C streams instead of sending a receipt.
    assert.ok(!logs.join(' ').includes('private detail'));
  }
});

test('group receipt precedes generation and final reply by default, without duplicate receipts', async t => {
  const { root, configPath, config } = await fixture(t);
  config.access.groups = { group: ['user'] }; delete config.processingFeedback;
  await fs.writeFile(configPath, JSON.stringify(config));
  const order = []; let receive;
  const gateway = await startGateway({ configPath, dataRoot: root, env: { QQBOT_APP_SECRET: 'fake' },
    createAgentImpl: async () => ({ answer: async () => { order.push('answer'); return 'done'; }, abort() {}, dispose: async () => {} }),
    createTransportImpl: () => ({ onMessage: fn => { receive = fn; }, start: async () => {}, close: async () => {},
      notifyProcessing: async target => { assert.equal(target.scope, 'group'); order.push('receipt'); },
      openStream: () => assert.fail('groups must not open a stream'), sendText: async () => order.push('final'),
    }),
  });
  const event = { ...raw('group-event'), kind: 'group', groupOpenid: 'group', rawEventType: 'GROUP_AT_MESSAGE_CREATE' };
  receive(event); receive(event); await tick(); await gateway.close();
  assert.deepEqual(order, ['receipt', 'answer', 'final']);
});

test('failed transport startup disposes the agent and unlocks account', async t => {
  const { root, configPath } = await fixture(t); let disposed = 0;
  const options = { configPath, dataRoot: root, env: { QQBOT_APP_SECRET: 'test-only' },
    createAgentImpl: async () => ({ abort() {}, dispose: async () => { disposed++; } }),
    createTransportImpl: () => ({ onMessage() {}, start: async () => { throw new Error('failed'); }, close: async () => {} }),
  };
  await assert.rejects(startGateway(options)); await assert.rejects(startGateway(options)); assert.equal(disposed, 2);
});

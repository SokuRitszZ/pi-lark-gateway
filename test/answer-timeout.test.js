import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateAnswer } from '../src/agent/answer.js';
import { makeConfig, validateConfig } from '../src/config/index.js';

function fakeSession() {
  return { messages: [], aborted: false, unsubscribed: false,
    subscribe() { return () => { this.unsubscribed = true; }; },
    async abort() { this.aborted = true; this.messages.push({ role: 'assistant', stopReason: 'aborted', content: [] }); this.resolve?.(); },
    async prompt() { this.messages.push({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'ok' }] }); },
  };
}
test('default answer has no timer even after two minutes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const session = fakeSession();
  session.prompt = async () => {
    t.mock.timers.tick(600000);
    session.messages.push({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'ok' }] });
  };
  assert.equal(await generateAnswer(session, 'hello', () => {}), 'ok');
  assert.equal(session.aborted, false);
  assert.equal(session.unsubscribed, true);
});
test('configured timeout aborts and reports distinct error', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const session = fakeSession();
  session.prompt = () => new Promise(resolve => { session.resolve = resolve; });
  const answer = generateAnswer(session, 'hello', () => {}, 100);
  const check = assert.rejects(answer, { code: 'ANSWER_TIMEOUT' });
  t.mock.timers.tick(100);
  await check;
  assert.equal(session.aborted, true);
  assert.equal(session.unsubscribed, true);
});
test('completed answers clear timer and abort differs from model error', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const session = fakeSession();
  await generateAnswer(session, 'hello', () => {}, 100);
  t.mock.timers.tick(1000);
  assert.equal(session.aborted, false);
  for (const [stopReason, code] of [['aborted', 'ANSWER_ABORTED'], ['error', 'MODEL_FAILED']]) {
    const s = fakeSession();
    s.prompt = async () => { s.messages.push({ role: 'assistant', stopReason, content: [] }); };
    await assert.rejects(generateAnswer(s, 'hello', () => {}), { code });
  }
});
test('timeout config defaults to disabled and rejects unsafe timer values', () => {
  const config = makeConfig({ appId: 'cli_test', domain: 'feishu', ownerOpenId: 'owner' });
  for (const value of [undefined, null, 0, 300000]) {
    config.answerTimeoutMs = value;
    assert.doesNotThrow(() => validateConfig(config));
  }
  for (const value of [-1, 1.5, '300', 2147483648]) {
    config.answerTimeoutMs = value;
    assert.throws(() => validateConfig(config), /answerTimeoutMs/);
  }
});

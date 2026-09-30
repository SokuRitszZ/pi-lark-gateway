import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failureDiagnostic } from '../src/errors/index.js';
import { generateAnswer } from '../src/agent/answer.js';
import { createMessageHandler } from '../src/messages/index.js';
import { createResponse } from '../src/messages/response.js';

const event = { sender: { sender_type: 'user', sender_id: { open_id: 'user' } }, message: {
  message_id: 'm', chat_id: 'chat', chat_type: 'p2p', message_type: 'text', content: '{"text":"test"}',
} };
const assistant = (stopReason, text = '', errorMessage) => ({ role: 'assistant', stopReason, errorMessage, content: [{ type: 'text', text }] });
function sessionFor(messages) {
  return { messages: [], subscribe: () => () => {}, async prompt() { this.messages.push(...messages); } };
}

test('diagnostics publish fixed strings only, including nested fetch causes', () => {
  for (const raw of ['fetch failed api_key=SECRET https://private/?token=SECRET', '401 Bearer SECRET', '<html>SECRET</html>', '429 request body SECRET']) {
    const value = failureDiagnostic(new Error(raw));
    assert.ok(!JSON.stringify(value).includes('SECRET'));
    assert.ok(!JSON.stringify(value).includes('https://'));
  }
  assert.equal(failureDiagnostic(new Error('fetch failed')).code, 'FETCH_FAILED');
  assert.equal(failureDiagnostic(new Error('fetch failed', { cause: { code: 'ECONNREFUSED' } })).code, 'CONNECTION_REFUSED');
  assert.equal(failureDiagnostic(new Error('unknown secret')).code, 'UNKNOWN');
});

test('failed attempt followed by success does not fail or leak partial failed text', async () => {
  const session = sessionFor([assistant('error', 'failed partial', 'fetch failed'), assistant('stop', 'OK')]);
  assert.equal(await generateAnswer(session, 'test', () => {}), 'OK');
});

test('terminal failed attempt retains diagnostic for safe reporting', async () => {
  const session = sessionFor([assistant('error', '', '401'), assistant('error', '', 'fetch failed')]);
  await assert.rejects(generateAnswer(session, 'test', () => {}), error => {
    assert.equal(error.code, 'MODEL_FAILED');
    assert.equal(failureDiagnostic(error).code, 'FETCH_FAILED');
    return true;
  });
});

for (const thrown of [false, true]) test(`Pi failure reaches a red card with a safe diagnostic (thrown=${thrown})`, async () => {
  const cards = [], logs = [];
  const beginResponse = createResponse({ sendCardReply: async (_, card) => { cards.push(card); return 'card'; },
    editCard: async (_, card) => cards.push(card) }, () => {}, () => 'card');
  const handler = createMessageHandler({ beginResponse, reply: async () => assert.fail('unexpected fallback'), log: value => logs.push(value),
    answer: async () => {
      if (thrown) throw new Error('fetch failed Authorization: Bearer SECRET');
      return generateAnswer(sessionFor([assistant('error', '', 'fetch failed Authorization: Bearer SECRET')]), 'test', () => {});
    },
  });
  handler.accept(event); await handler.drain();
  const card = cards.at(-1);
  assert.equal(card.header.template, 'red');
  assert.match(JSON.stringify(card), /FETCH_FAILED/);
  assert.match(JSON.stringify(card), /fetch failed/);
  assert.ok(!JSON.stringify(cards).includes('SECRET'));
  assert.ok(logs.includes('message_failure_fetch_failed'));
  assert.ok(!JSON.stringify(logs).includes('SECRET'));
});

test('failed card finalization falls back to the same safe error text', async () => {
  let output;
  const handler = createMessageHandler({
    beginResponse: async () => ({ finish: async () => { throw new Error('card failure'); }, stop: async () => {} }),
    answer: async () => { throw new Error('fetch failed SECRET'); }, reply: async (_, text) => { output = text; },
  });
  handler.accept(event); await handler.drain();
  assert.match(output, /fetch failed/);
  assert.ok(!output.includes('SECRET'));
});

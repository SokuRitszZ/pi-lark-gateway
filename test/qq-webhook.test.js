import test from 'node:test';
import assert from 'node:assert/strict';
import { WebhookTransport, signValidationResponse } from '@tencent-connect/qqbot-nodejs/protocol';
import { createWebhookServer } from '../src/adapters/qq/index.js';

test('webhook uses SDK signature validation, fresh timestamps and bounded bodies', async () => {
  const server = createWebhookServer('127.0.0.1', { maxBytes: 2048 });
  let ready; const started = new Promise(resolve => { ready = resolve; });
  const messages = [], secret = 'test-only-secret';
  const transport = new WebhookTransport({ appId: 'app', appSecret: secret, port: 0, path: '/callback', server }, {
    onReady: ready, onMessage: async message => messages.push(message),
  });
  const work = transport.start();
  try {
    await started;
    const url = `http://127.0.0.1:${server.address().port}/callback`;
    const post = (body, headers = {}) => fetch(url, { method: 'POST', headers, body });
    const challenge = await post(JSON.stringify({ op: 13, d: { plain_token: 'test', event_ts: '123' } }));
    assert.equal(challenge.status, 200); assert.equal((await challenge.json()).plain_token, 'test');
    const body = JSON.stringify({ op: 0, t: 'C2C_MESSAGE_CREATE', d: { id: 'm1', author: { user_openid: 'user' }, content: 'hi', timestamp: new Date().toISOString() } });
    const stamp = String(Math.floor(Date.now() / 1000));
    assert.equal((await post(body)).status, 401);
    assert.equal((await post(body, { 'x-signature-timestamp': stamp, 'x-signature-ed25519': 'bad' })).status, 401);
    const signed = signValidationResponse({ plainToken: body, eventTs: stamp, botSecret: secret }).signature;
    assert.equal((await post(body, { 'x-signature-timestamp': stamp, 'x-signature-ed25519': signed })).status, 200);
    assert.equal(messages.length, 1);
    const stale = String(Number(stamp) - 600);
    const staleSignature = signValidationResponse({ plainToken: body, eventTs: stale, botSecret: secret }).signature;
    assert.equal((await post(body, { 'x-signature-timestamp': stale, 'x-signature-ed25519': staleSignature })).status, 401);
    assert.equal((await post('x'.repeat(3000))).status, 413);
    assert.equal(messages.length, 1);
  } finally { transport.stop(); await work; }
});

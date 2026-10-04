import test from 'node:test';
import assert from 'node:assert/strict';
import { startWebhook } from '../src/adapters/telegram/webhook.js';
test('Telegram webhook verifies method, path, secret, payload size and JSON before dispatch', async t => {
  const received = [], secret = 'a-safe-test-secret', logs = [];
  const server = await startWebhook({ host: '127.0.0.1', port: 0, path: '/tg/hook' }, secret, async u => received.push(u), c => logs.push(c));
  t.after(() => server.close()); const url = `http://127.0.0.1:${server.port}/tg/hook`;
  const request = (body, token = secret, suffix = '') => fetch(url + suffix, { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': token }, body });
  assert.equal((await fetch(url)).status, 404);
  assert.equal((await request('{}', secret, '/wrong')).status, 404);
  assert.equal((await request('{"update_id":1}', 'wrong')).status, 403);
  assert.equal((await request('{broken')).status, 400);
  assert.equal((await request('{}')).status, 400);
  assert.equal((await request('{"update_id":1}')).status, 200); assert.equal(received.length, 1);
  assert.equal((await request(' '.repeat(1024 * 1024 + 1))).status, 413); assert.equal(received.length, 1);
});

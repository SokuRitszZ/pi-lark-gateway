import test from 'node:test';
import assert from 'node:assert/strict';
import { registerQQExtension } from '../src/qq-gateway/extension.js';

test('extension factory is inert, serializes starts and disposes on shutdown', async () => {
  let command, shutdown, starts = 0, closes = 0;
  const notices = [];
  registerQQExtension({ registerCommand: (_name, options) => { command = options.handler; }, on: (_name, handler) => { shutdown = handler; } }, async () => {
    starts++; return { status: () => 'running', close: async () => { closes++; } };
  });
  assert.equal(starts, 0);
  const ctx = { hasUI: true, ui: { notify: text => notices.push(text) } };
  await Promise.all([command('start', ctx), command('start', ctx)]); assert.equal(starts, 1);
  await command('status', ctx); assert.match(notices.at(-1), /running/);
  await shutdown(); await shutdown(); assert.equal(closes, 1);
  await command('start', ctx); assert.equal(starts, 1);
});
test('shutdown waits for in-flight startup and does not leave a gateway running', async () => {
  let command, shutdown, release, closed = false;
  const waiting = new Promise(resolve => { release = resolve; });
  registerQQExtension({ registerCommand: (_, options) => { command = options.handler; }, on: (_, handler) => { shutdown = handler; } }, async () => {
    await waiting; return { status: () => 'running', close: async () => { closed = true; } };
  });
  const work = command('start', { hasUI: false });
  await Promise.resolve(); const stopping = shutdown(); release(); await Promise.all([work, stopping]);
  assert.equal(closed, true);
});

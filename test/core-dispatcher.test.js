import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createMessageDispatcher } from '../src/core/messages/index.js';

const message = (id, key = 'fake:conversation') => ({ id, key, text: id,
  chatId: 'conversation', userId: 'actor', isGroup: false, identity: { QQ: { opaque: 'actor' } } });

test('core accepts a fake transport without Lark events, deduplicates and queues', async () => {
  const calls = [];
  const dispatcher = createMessageDispatcher({
    answer: async (key, text) => { calls.push(`answer:${text}`); return text; },
    reply: async (m, text) => calls.push(`reply:${text}`),
  });
  dispatcher.accept(message('one')); dispatcher.accept(message('one')); dispatcher.accept(message('two'));
  await dispatcher.drain();
  assert.deepEqual(calls, ['answer:one', 'reply:one', 'answer:two', 'reply:two']);
  dispatcher.accept(message('closed'));
  assert.equal(dispatcher.isIdle(), true);
  assert.equal(calls.length, 4);
});

test('core command adapter closure never falls back to model', async () => {
  const replies = [];
  const dispatcher = createMessageDispatcher({ answer: () => assert.fail('model must not run'),
    reply: async (_, text) => replies.push(text) });
  dispatcher.accept(message('command'), { commandName: 'restart', executeCommand: async () => undefined });
  await dispatcher.drain();
  assert.deepEqual(replies, ['命令暂不可用，请检查网关状态。']);
});

test('fake response handles model failure and always cleans up', async () => {
  const calls = [];
  const dispatcher = createMessageDispatcher({ answer: async () => { throw new Error('private secret'); },
    reply: () => assert.fail('unexpected fallback'),
    beginResponse: async () => ({ finish: async text => calls.push(text), stop: async () => calls.push('stop') }),
  });
  dispatcher.accept(message('failure')); await dispatcher.drain();
  assert.equal(calls.length, 2); assert.equal(calls[1], 'stop');
  assert.ok(!calls[0].includes('private secret'));
});

test('core dependency graph cannot reach platform SDKs or legacy features', async () => {
  const allowedExternal = new Set(['@earendil-works/pi-coding-agent']);
  const visited = new Set();
  async function visit(url) {
    if (visited.has(url.href)) return;
    visited.add(url.href);
    const source = await readFile(url, 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*\(?\s*)['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (specifier.startsWith('node:')) continue;
      if (!specifier.startsWith('.')) { assert.ok(allowedExternal.has(specifier), specifier); continue; }
      const dependency = new URL(specifier, url);
      assert.match(dependency.pathname, /\/src\/(core|errors)\//, `core leaked to ${specifier}`);
      await visit(dependency);
    }
  }
  async function scan(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) await scan(file);
      else if (entry.name.endsWith('.js')) await visit(file);
    }
  }
  await scan(new URL('../src/core/', import.meta.url));
});

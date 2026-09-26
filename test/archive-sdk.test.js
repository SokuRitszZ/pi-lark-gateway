import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openConversation } from '../src/agent/session-factory.js';
import { summarizeArchive } from '../src/agent/archive-summary.js';

async function fixture(t) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'gateway-archive-sdk-'));
  const agentDir = path.join(cwd, 'isolated-agent');
  await fs.mkdir(agentDir);
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  return { cwd, agentDir };
}

test('new conversation seeds archive as contextual message, not system instruction; tools default off', async t => {
  const { cwd, agentDir } = await fixture(t);
  let options;
  const session = { async bindExtensions() {}, dispose() {} };
  await openConversation({}, undefined, cwd, 'none', '该会话已过期被归档。测试摘要', {
    agentDir, create: async value => { options = value; return { session }; },
  });
  assert.equal(options.noTools, 'all');
  assert.equal(options.resourceLoader.getExtensions().extensions.length, 0);
  assert.equal(options.resourceLoader.getSkills().skills.length, 0);
  const messages = options.sessionManager.buildSessionContext().messages;
  assert.equal(messages.length, 1); assert.equal(messages[0].role, 'custom');
  assert.equal(messages[0].customType, 'gateway_archive');
  assert.match(messages[0].content, /该会话已过期被归档/);
  // Force normal SDK persistence by adding a completed assistant message.
  options.sessionManager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'reply' }], stopReason: 'stop', timestamp: Date.now() });
  await openConversation({}, undefined, cwd, 'none', 'should not duplicate', {
    agentDir, create: async value => { options = value; return { session }; },
  });
  const restored = options.sessionManager.buildSessionContext().messages;
  assert.equal(restored.filter(m => m.customType === 'gateway_archive').length, 1);
  assert.ok(!JSON.stringify(restored).includes('should not duplicate'));
});

test('archive summary processes every chunk with tools/extensions disabled and disposes temporary sessions', async t => {
  const { cwd, agentDir } = await fixture(t);
  const prompts = [];
  let disposed = 0;
  const summary = await summarizeArchive({}, undefined, 'a'.repeat(24000) + 'b'.repeat(24000) + 'LAST CHUNK', cwd, {
    agentDir, create: async options => {
      assert.equal(options.noTools, 'all'); assert.equal(options.sessionManager.getSessionFile(), undefined);
      assert.equal(options.resourceLoader.getExtensions().extensions.length, 0);
      const messages = [];
      return { session: { messages, subscribe: () => () => {}, dispose: () => { disposed++; }, abort: async () => {},
        async prompt(text) {
          prompts.push(text);
          messages.push({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: `summary-${prompts.length}` }] });
        },
      } };
    },
  });
  assert.equal(prompts.length, 3); assert.equal(disposed, 3); assert.equal(summary, 'summary-3');
  assert.match(prompts[1], /summary-1/); assert.match(prompts[2], /summary-2/); assert.match(prompts[2], /LAST CHUNK/);
});

for (const [stopReason, content] of [['error', 'failed'], ['aborted', 'partial'], ['length', 'truncated'], ['stop', '']]) {
  test(`archive rejects incomplete/empty model output: ${stopReason}:${content}`, async t => {
    const { cwd, agentDir } = await fixture(t);
    let disposed = false;
    await assert.rejects(summarizeArchive({}, undefined, 'history', cwd, {
      agentDir, create: async () => {
        const messages = [];
        return { session: { messages, subscribe: () => () => {}, dispose: () => { disposed = true; }, abort: async () => {},
          async prompt() { messages.push({ role: 'assistant', stopReason, content: [{ type: 'text', text: content }] }); },
        } };
      },
    }));
    assert.equal(disposed, true);
  });
}

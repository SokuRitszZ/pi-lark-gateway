import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { createProgress } from '../src/progress/index.js';
import { createMessageHandler } from '../src/messages/index.js';
test('only latest ten tools; no args; final edit is last', async () => {
  const edits = [];
  const progress = createProgress({ interval: 1, edit: async text => { await wait(5); edits.push(text); } });
  for (let i = 0; i < 12; i++) progress.event({ type: 'tool_execution_start', toolCallId: String(i), toolName: `tool-${i}`, args: { secret: 'DO_NOT_SHOW' } });
  progress.event({ type: 'tool_execution_end', toolCallId: '11', isError: false });
  await wait(10);
  await progress.finish('最终回答');
  progress.event({ type: 'tool_execution_start', toolName: 'late' });
  await wait(5);
  assert.equal(edits.at(-1), '最终回答');
  assert.equal(edits[0].split('\n').length, 12);
  assert.ok(!edits[0].includes('tool-0'));
  assert.ok(edits[0].includes('✅ tool-11'));
  assert.ok(!edits.join('').includes('DO_NOT_SHOW'));
});
test('placeholder replaced instead of extra reply and reaction removed', async () => {
  const calls = [];
  const handler = createMessageHandler({
    beginResponse: async () => { calls.push('placeholder'); return { event() {}, finish: async text => calls.push(text), stop: async () => {} }; },
    react: async () => 'reaction', removeReaction: async () => calls.push('remove'),
    answer: async (_, __, event) => { event({ type: 'agent_start' }); return 'final'; },
    reply: async () => calls.push('unexpected reply'),
  });
  handler.accept({ sender: { sender_type: 'user' }, message: { message_id: 'm', chat_id: 'c', chat_type: 'p2p', message_type: 'text', content: '{"text":"hi"}' } });
  await handler.drain();
  assert.deepEqual(calls, ['placeholder', 'final', 'remove']);
});

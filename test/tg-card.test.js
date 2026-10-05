import test from 'node:test';
import assert from 'node:assert/strict';
import { progressCard, frameCard, responseState, approvalTitle } from '../src/adapters/telegram/card.js';
import { formatPages, formatText } from '../src/adapters/telegram/format.js';
import { createResponses } from '../src/adapters/telegram/response.js';
import { createControls } from '../src/core/controls/index.js';
import { setTimeout as sleep } from 'node:timers/promises';

test('Telegram progress card retains its title and bounded latest progress', () => {
  assert.match(progressCard(), /⏳ 正在处理/);
  const card = progressCard('old'.repeat(3000) + '😀'.repeat(1800) + 'LATEST');
  assert.ok(card.startsWith('**⏳ 正在处理**')); assert.ok(card.endsWith('LATEST'));
  assert.ok(card.length < 3500); assert.match(card, /前文略/);
  assert.ok(formatText(card).entities.some(e => e.type === 'bold' && e.offset === 0));
});
test('Telegram terminal card states do not invent success or validation claims', () => {
  assert.equal(responseState('answer'), 'complete');
  assert.equal(responseState('timeout', { error: true }), 'error');
  assert.equal(responseState('当前回复已停止。', { error: true }), 'stopped');
  assert.equal(responseState('partial', undefined, true), 'stopped');
  assert.equal(responseState('当前回复已停止。'), 'complete');
  assert.ok(!frameCard(formatText('answer')).text.includes('测试通过'));
  assert.match(approvalTitle('pending'), /🔐/); assert.match(approvalTitle('blocked'), /已封禁/);
});
test('Telegram continuation cards repeat title, preserve UTF-16 entities and stay under 4096', () => {
  const pages = formatPages('**' + '😀'.repeat(8000) + '**\nFINAL');
  for (let i = 0; i < pages.length; i++) {
    const card = frameCard(pages[i], 'complete', i, pages.length);
    assert.ok(card.text.startsWith(`✅ 回复完成（${i + 1}/${pages.length}）`));
    assert.ok(card.text.length < 4096);
    const offset = card.text.length - pages[i].text.length;
    for (const entity of card.entities) assert.ok(entity.offset + entity.length <= card.text.length);
    for (const entity of pages[i].entities) assert.ok(card.entities.some(e => e.type === entity.type && e.offset === entity.offset + offset && e.length === entity.length));
  }
  assert.ok(frameCard(pages.at(-1)).text.endsWith('FINAL'));
});
test('Telegram cards show safe tool status, replace progress with authoritative final body', async () => {
  const writes = [], finals = [];
  const response = await createResponses({ controls: createControls({ canControl: () => true }), active: new Map(), byMessage: new Map(), interval: 1, log() {},
    transport: {
      async sendText(_target, text) { writes.push(text); return { message_id: 9 }; },
      async editText(_chat, _id, text) { writes.push(text); },
      async finalize(_target, _id, text, options) { finals.push({ text, options }); },
    },
  })({ key: 'a', chatId: '7', target: { chatId: '7', messageId: 1 } });
  response.event({ type: 'tool_execution_start', toolCallId: 't', toolName: 'bash', args: { command: 'PRIVATE_ARGUMENT' } });
  response.event({ type: 'tool_execution_end', toolCallId: 't', result: 'PRIVATE_RESULT', isError: false });
  response.event({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'PRIVATE_REASONING' } });
  await sleep(20);
  assert.match(writes.at(-1), /执行进度/); assert.match(writes.at(-1), /bash/);
  assert.doesNotMatch(writes.join(''), /PRIVATE_/);
  await response.finish('Actual final answer'); await response.stop();
  assert.deepEqual(finals, [{ text: 'Actual final answer', options: { state: 'complete' } }]);
});

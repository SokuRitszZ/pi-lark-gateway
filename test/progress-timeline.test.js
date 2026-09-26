import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTick } from 'node:timers/promises';
import { createTimeline } from '../src/progress/timeline.js';
import { createProgress } from '../src/progress/index.js';

const message = (...texts) => ({ role: 'assistant', content: texts.map(text => ({ type: 'text', text })) });
const end = (timeline, ...texts) => timeline.event({ type: 'message_end', message: message(...texts) });

test('timeline preserves assistant/tool chronology and updates parallel tools in place', () => {
  const timeline = createTimeline();
  end(timeline, '我会检查代码。');
  timeline.event({ type: 'tool_execution_start', toolCallId: 'a', toolName: 'read', args: { secret: 'SECRET_ARGS' } });
  timeline.event({ type: 'tool_execution_start', toolCallId: 'b', toolName: 'bash' });
  timeline.event({ type: 'tool_execution_end', toolCallId: 'b', isError: true, result: 'SECRET_RESULT' });
  timeline.event({ type: 'tool_execution_end', toolCallId: 'a', isError: false });
  end(timeline, '已完成检查。');
  end(timeline, '## 最终结果\n- 测试通过');
  const rendered = timeline.finish('我会检查代码。\n已完成检查。\n## 最终结果\n- 测试通过');
  assert.equal(rendered, '我会检查代码。\n\n(✅ read：完成)\n(❌ bash：失败)\n\n已完成检查。\n\n## 最终结果\n- 测试通过');
  assert.doesNotMatch(rendered, /SECRET/);
});
test('streaming snapshots and canonical message_end do not duplicate deltas or leak non-text content', () => {
  const timeline = createTimeline();
  timeline.event({ type: 'message_start', message: message() });
  timeline.event({ type: 'message_update', message: message('先'), assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '先' } });
  timeline.event({ type: 'message_update', message: message('先检查'), assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '检查' } });
  const final = message('先检查', '再处理');
  final.content.splice(1, 0, { type: 'thinking', thinking: 'SECRET_THINKING' }, { type: 'toolCall', arguments: { secret: 'SECRET_CALL' } });
  timeline.event({ type: 'message_end', message: final });
  timeline.event({ type: 'message_end', message: final });
  for (const role of ['user', 'system', 'toolResult', 'custom']) timeline.event({ type: 'message_end', message: { role, content: [{ type: 'text', text: 'SECRET_OTHER' }] } });
  timeline.event({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'SECRET_THINKING' } });
  timeline.event({ type: 'tool_execution_update', partialResult: 'SECRET_PARTIAL' });
  assert.equal(timeline.finish('先检查\n再处理'), '先检查\n再处理');
});
test('delta-only events and final fallback complete a partial message without repeating previous text', () => {
  const timeline = createTimeline();
  end(timeline, '开始');
  timeline.event({ type: 'tool_execution_start', toolCallId: 'a', toolName: 'read' });
  timeline.event({ type: 'tool_execution_end', toolCallId: 'a' });
  for (const delta of ['完成', '一半']) timeline.event({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta } });
  assert.match(timeline.render(), /完成一半$/);
  assert.equal(timeline.finish('开始\n完成全部'), '开始\n\n(✅ read：完成)\n\n完成全部');
});
test('no events and last-message-only callers have final-answer fallbacks', () => {
  assert.equal(createTimeline().finish('只有最终答复'), '只有最终答复');
  const timeline = createTimeline(); end(timeline, '说明'); end(timeline, '结果');
  assert.equal(timeline.finish('结果'), '说明\n\n结果');
  const missing = createTimeline(); end(missing, '说明');
  assert.equal(missing.finish('说明\n补齐最终结果'), '说明\n\n补齐最终结果');
});
test('card timeline retains more than ten tool entries; unfinished calls are not marked successful', () => {
  const timeline = createTimeline();
  for (let i = 0; i < 12; i++) timeline.event({ type: 'tool_execution_start', toolCallId: String(i), toolName: `tool-${i}` });
  const rendered = timeline.finish('已停止当前回复。', { terminal: true });
  assert.match(rendered, /tool-0/); assert.match(rendered, /tool-11/);
  assert.equal((rendered.match(/未完成/g) || []).length, 12);
  assert.match(rendered, /已停止当前回复。$/);
});
test('terminal error preserves partial assistant output and appends a safe failure notice', () => {
  const timeline = createTimeline(); end(timeline, '已经读取文件');
  assert.equal(timeline.finish('处理失败，请稍后重试。', { terminal: true }), '已经读取文件\n\n处理失败，请稍后重试。');
});
test('timeline progress streams text before completion, serializes edits and ignores late events', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const edits = []; let release;
  const firstEdit = new Promise(resolve => { release = resolve; });
  const progress = createProgress({ retainTranscript: true, interval: 1, edit: async text => {
    if (!edits.length) await firstEdit;
    edits.push(text);
  } });
  progress.event({ type: 'message_end', message: message('中间说明') });
  t.mock.timers.tick(1); await nextTick();
  progress.event({ type: 'tool_execution_start', toolCallId: 'a', toolName: 'read' });
  const finish = progress.finish('中间说明\n最终答复');
  progress.event({ type: 'message_end', message: message('late') });
  release(); await finish;
  t.mock.timers.tick(100); await nextTick();
  assert.equal(edits[0], '中间说明');
  assert.equal(edits.length, 2);
  assert.match(edits.at(-1), /^中间说明\n\n.*read.*\n\n最终答复$/);
  assert.doesNotMatch(edits.join(''), /late/);
});

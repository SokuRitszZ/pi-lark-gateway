import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimeline } from '../src/progress/timeline.js';
import { toolPreview, operationBlock } from '../src/progress/tool-preview.js';

const start = (timeline, id, toolName, args = {}) => timeline.event({ type: 'tool_execution_start', toolCallId: id, toolName, args });
const end = (timeline, id, isError = false) => timeline.event({ type: 'tool_execution_end', toolCallId: id, isError });
const text = (timeline, value) => timeline.event({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: value }] } });

test('adjacent same-kind calls collapse with multiplication count and only newest operation', () => {
  const timeline = createTimeline();
  start(timeline, 'a', 'bash', { command: 'npm test' }); end(timeline, 'a');
  start(timeline, 'b', 'bash', { command: 'npm run check' });
  assert.equal(timeline.render(), '⏳ bash ×2：\n\n```text\nnpm run check\n```');
  end(timeline, 'b');
  assert.equal(timeline.render(), '✅ bash ×2：\n\n```text\nnpm run check\n```');
  assert.equal(timeline.finish('完成'), '✅ bash ×2\n\n完成');
});
test('only the latest invocation globally has a preview, even when older calls finish later', () => {
  const timeline = createTimeline();
  start(timeline, 'a', 'read', { path: 'old.js' });
  start(timeline, 'b', 'bash', { command: 'npm run verify' });
  end(timeline, 'b'); end(timeline, 'a');
  assert.equal(timeline.render(), '✅ read\n✅ bash：\n\n```text\nnpm run verify\n```');
  start(timeline, 'c', 'read', { path: 'new.js' });
  assert.equal(timeline.render(), '✅ read\n✅ bash\n⏳ read：\n\n```text\nnew.js\n```');
});
test('visible assistant text separates groups, but empty assistant tool messages do not', () => {
  const timeline = createTimeline();
  start(timeline, 'a', 'read', { path: 'a.js' }); end(timeline, 'a');
  text(timeline, ''); start(timeline, 'b', 'read', { path: 'b.js' }); end(timeline, 'b');
  text(timeline, '中间说明'); start(timeline, 'c', 'read', { path: 'c.js' }); end(timeline, 'c');
  assert.equal(timeline.render(), '✅ read ×2\n\n中间说明\n\n✅ read：\n\n```text\nc.js\n```');
});
test('group status preserves pending, failures and unfinished calls without changing latest preview', () => {
  const timeline = createTimeline();
  start(timeline, 'a', 'bash', { command: 'first' });
  start(timeline, 'b', 'bash', { command: 'last' });
  start(timeline, 'b', 'bash', { command: 'duplicate' });
  end(timeline, 'a', true);
  assert.equal(timeline.render(), '⏳ bash ×2：\n\n```text\nlast\n```');
  end(timeline, 'b'); assert.equal(timeline.render(), '❌ bash ×2：\n\n```text\nlast\n```');
  const stopped = createTimeline(); start(stopped, 'a', 'read', { path: 'file.js' });
  assert.equal(stopped.finish('已停止', { terminal: true }), '⏹ read\n\n已停止');
});
test('completed details remain until actual subsequent text is visible, not an empty message event', () => {
  const timeline = createTimeline();
  start(timeline, 'a', 'bash', { command: 'npm test' }); end(timeline, 'a');
  timeline.event({ type: 'message_start', message: { role: 'assistant', content: [] } });
  assert.match(timeline.render(), /npm test/);
  timeline.event({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '检查完成' } });
  assert.equal(timeline.render(), '✅ bash\n\n检查完成');
  end(timeline, 'a'); assert.doesNotMatch(timeline.render(), /npm test/);
});
test('a turn with no subsequent text retains the last operation even after completion', () => {
  const timeline = createTimeline();
  start(timeline, 'a', 'read', { path: 'file.js' }); end(timeline, 'a', true);
  assert.equal(timeline.finish(''), '❌ read：\n\n```text\nfile.js\n```');
});
test('operation preview is complete and preserves newlines, indentation and tabs', () => {
  assert.equal(toolPreview('bash', { command: 'x'.repeat(15000) }), 'x'.repeat(15000));
  assert.equal(toolPreview('functions.bash', { command: '😀'.repeat(110) }), '😀'.repeat(110));
  assert.equal(toolPreview('bash', { command: 'npm test\n npm run check\t' }), 'npm test\n npm run check\t');
  assert.equal(toolPreview('bash', { command: 'echo\r\nhi\x1b' }), 'echo\nhi\\x1b');
});
test('only whitelisted operation fields are used, never file contents or arbitrary args', () => {
  assert.equal(toolPreview('write', { path: 'src/app.js', content: 'PRIVATE_CONTENT' }), 'src/app.js');
  assert.equal(toolPreview('edit', { path: 'src/app.js', edits: [{ newText: 'PRIVATE' }] }), 'src/app.js');
  assert.equal(toolPreview('grep', { pattern: 'createProgress', path: 'src' }), 'createProgress src');
  assert.equal(toolPreview('web_search', { query: 'npm version' }), 'npm version');
  assert.equal(toolPreview('memory_add', { content: 'PRIVATE_MEMORY' }), '');
  assert.equal(toolPreview('unknown', { command: 'PRIVATE' }), '');
});
test('credential-bearing operations are suppressed regardless of length', () => {
  for (const command of ['TOKEN=do-not-show npm publish', 'curl -H "Authorization: Bearer abc" https://example.test',
    'curl https://name:password@example.test', 'echo sk-abcdefghijklmnopqrstuvwxyz',
    'x'.repeat(120) + ' --api-key=do-not-show', 'echo -----BEGIN PRIVATE KEY-----']) {
    assert.equal(toolPreview('bash', { command }), '敏感操作已隐藏');
  }
});
test('preview markup stays literal inside a collision-safe fenced code block', () => {
  const command = 'echo <at id=all>everyone</at> [click](https://example.test)\n```\n~~~';
  const block = operationBlock(command);
  assert.equal(block, '````text\n' + command + '\n````');
  const timeline = createTimeline(); start(timeline, 'a', 'bash', { command });
  assert.equal(timeline.render(), '⏳ bash：\n\n' + block);
});
test('a finished latest tool never falls back to showing an older running operation', () => {
  const timeline = createTimeline();
  start(timeline, 'a', 'bash', { command: 'old running command' });
  start(timeline, 'b', 'bash', { command: 'new command' }); end(timeline, 'b');
  assert.equal(timeline.render(), '⏳ bash ×2：\n\n```text\nnew command\n```');
  assert.equal(timeline.finish('done'), '⏹ bash ×2\n\ndone');
});

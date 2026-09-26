import test from 'node:test';
import assert from 'node:assert/strict';
import { cardPages } from '../src/messages/card-pages.js';
import { markdownSlices } from '../src/messages/markdown-slices.js';
import { operationBlock } from '../src/progress/tool-preview.js';

const body = card => card.body.elements[0].content;
const bounded = card => assert.ok(Buffer.byteLength(JSON.stringify({ msg_type: 'interactive', content: JSON.stringify(card) })) <= 28 * 1024);

test('fence lines are indivisible and reopened on code-only continuation slices', () => {
  const source = '说明\n```text\nabcdef\n```\n尾部';
  const layout = markdownSlices(source), chars = Array.from(source);
  const open = chars.indexOf('`'), content = open + '```text\n'.length;
  assert.equal(layout.safeEnd(open + 2), open);
  assert.equal(layout.slice(0, content + 3), '说明\n```text\nabc\n```\n');
  assert.equal(layout.slice(content + 3, chars.length), '```text\ndef\n```\n尾部');
});
test('page boundaries near opening/closing fences stay balanced and within byte budget', () => {
  for (const size of [27000, 28000, 28200, 28300, 28400, 28500, 28600, 29000]) {
    const source = 'a'.repeat(size) + '\n```text\n' + '😀'.repeat(2000) + '\n```\n尾部';
    const pages = cardPages('标题', source, 'running', 'control');
    for (const card of pages) {
      bounded(card);
      assert.equal((body(card).match(/^```(?:text)?$/gm) || []).length % 2, 0);
    }
    assert.equal(pages.map(body).join('').match(/😀/gu).length, 2000);
    assert.ok(body(pages.at(-1)).endsWith('尾部'));
  }
});
test('variable-length and tilde fences survive pagination without losing literal inner fences', () => {
  for (const command of ['```\n~~~\n' + 'x'.repeat(40000), '```\n' + 'x'.repeat(40000)]) {
    const block = operationBlock(command), marker = block.split('\n')[0].slice(0, -4);
    const pages = cardPages('标题', block, 'running');
    assert.ok(pages.length > 1);
    for (const card of pages) {
      bounded(card); assert.ok(body(card).startsWith(marker + 'text\n'));
      assert.ok(body(card).trimEnd().endsWith(marker));
    }
    const restored = pages.map(card => body(card).slice((marker + 'text\n').length).replace(new RegExp('\\n' + marker + '\\n?$'), '')).join('');
    assert.equal(restored, command);
  }
});
test('unclosed assistant code fences are balanced without affecting plain text pagination', () => {
  const pages = cardPages('标题', '```js\n' + 'x'.repeat(40000), 'running');
  for (const card of pages) { bounded(card); assert.ok(body(card).startsWith('```js\n')); assert.ok(body(card).endsWith('\n```\n')); }
  const plain = '文本😀\\"'.repeat(8000);
  assert.equal(cardPages('标题', plain, 'running').map(body).join(''), plain);
});

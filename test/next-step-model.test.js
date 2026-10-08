import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSuggestions } from '../src/core/agent/suggestions.js';
function fixture({ pending = false } = {}) {
  const calls = {}; let aborts = 0, disposed = 0;
  class Loader { constructor(options) { calls.loader = options; } async reload() {} }
  const session = { messages: [{ role: 'assistant', content: [{ type: 'text', text: '[{"title":"检查","detail":"检查测试。"}]' }] }],
    prompt(text, options) { calls.input = JSON.parse(text); calls.prompt = options; return pending ? new Promise(() => {}) : Promise.resolve(); },
    abort() { aborts++; }, dispose() { disposed++; } };
  const create = async options => { calls.session = options; return { session }; };
  return { Loader, create, calls, counts: () => ({ aborts, disposed }) };
}
test('next-step analysis is isolated, bounded input, tool-free and does not load user extensions/context', async () => {
  const f = fixture(), signal = new AbortController().signal;
  const result = await generateSuggestions({}, null, 'q'.repeat(12000), 'a'.repeat(20000), '/tmp', signal, f);
  assert.equal(result.length, 1); assert.equal(f.calls.input.question.length, 8000); assert.equal(f.calls.input.answer.length, 16000);
  assert.equal(f.calls.session.noTools, 'all'); assert.equal(f.calls.session.thinkingLevel, 'off');
  for (const key of ['noExtensions', 'noSkills', 'noContextFiles', 'noPromptTemplates']) assert.equal(f.calls.loader[key], true);
  assert.equal(f.calls.prompt.expandPromptTemplates, false); assert.equal(f.counts().disposed, 1);
});
test('next-step analysis times out independently of a provider that ignores abort', async () => {
  const f = fixture({ pending: true });
  await assert.rejects(generateSuggestions({}, null, 'q', 'a', '/tmp', new AbortController().signal, { ...f, timeoutMs: 5 }), /next_steps_cancelled/);
  assert.equal(f.counts().disposed, 1); assert.equal(f.counts().aborts, 1);
});

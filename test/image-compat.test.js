import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { runtimeImage, runtimeMessages, enableImageCompatibility } from '../src/agent/image-compat.js';
import { openConversation } from '../src/agent/session-factory.js';
import { generateAnswer } from '../src/agent/answer.js';
import { createMedia } from '../src/media/index.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5RkAAAAASUVORK5CYII=', 'base64');
const legacy = () => ({ type: 'image', source: { type: 'base64', mediaType: 'image/png', data: png.toString('base64') } });
const flat = () => ({ type: 'image', mimeType: 'image/png', data: png.toString('base64') });
const model = { id: 'fixture', name: 'fixture', provider: 'openai-codex', api: 'openai-codex-responses', input: ['text', 'image'],
  contextWindow: 100000, maxTokens: 4096, reasoning: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };

// Intentionally inspect the installed bundle, not a mocked/reimplemented converter.
// Its chunk hash can change. Fail loudly if a future SDK moves this contract.
const converters = (async () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), 'bundle/chunks');
  const matches = [];
  for (const file of await fs.readdir(dir)) {
    if (!file.endsWith('.js')) continue;
    const source = await fs.readFile(path.join(dir, file), 'utf8');
    if (/export\s*\{[^}]*\bconvertResponsesMessages\b[^}]*\}/.test(source)) matches.push(path.join(dir, file));
  }
  assert.equal(matches.length, 1, 'Re-audit the installed SDK provider conversion contract');
  return import(pathToFileURL(matches[0]).href);
})();
async function convert(messages) {
  const { convertResponsesMessages } = await converters;
  return convertResponsesMessages(model, { messages }, new Set(['openai-codex']));
}
function imageUrls(payload) {
  return payload.flatMap(message => Array.isArray(message.content) ? message.content.filter(block => block.type === 'input_image').map(block => block.image_url) : []);
}
async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gateway-image-compat-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('installed provider reproduces the old undefined MIME bug and accepts canonical images', async () => {
  const bad = await convert([{ role: 'user', content: [legacy()], timestamp: 1 }]);
  assert.deepEqual(imageUrls(bad), ['data:undefined;base64,undefined']);
  const good = await convert([{ role: 'user', content: [runtimeImage(legacy())], timestamp: 1 }]);
  assert.deepEqual(imageUrls(good), [`data:image/png;base64,${png.toString('base64')}`]);
  assert.deepEqual(Buffer.from(imageUrls(good)[0].split(',')[1], 'base64'), png);
});
test('new gateway downloads survive the actual installed provider serialization', async t => {
  const base = await temporary(t);
  const media = createMedia({ base, getDirectory: () => path.join(base, 'a'.repeat(64)), transport: { download: async () => png } });
  const prepared = await media.prepare({ key: 'fixture', id: 'om_fixture', text: '看看图片', attachments: [{ kind: 'image', key: 'img_fixture' }] });
  const payload = await convert([{ role: 'user', content: [{ type: 'text', text: prepared.text }, ...prepared.images], timestamp: 1 }]);
  assert.deepEqual(imageUrls(payload), [`data:image/png;base64,${png.toString('base64')}`]);
  assert.ok(!JSON.stringify(payload).includes('undefined'));
});
test('compatibility is immutable/idempotent and preserves text, metadata, flat images and tool images', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'keep me' }, legacy(), flat()], timestamp: 1 },
    { role: 'toolResult', toolCallId: 'call', toolName: 'read', content: [legacy()], timestamp: 2 },
    { role: 'user', content: 'plain string', timestamp: 3 },
  ];
  const before = structuredClone(messages), result = runtimeMessages(messages);
  assert.deepEqual(messages, before); assert.notEqual(result, messages);
  assert.equal(result[0].content[0], messages[0].content[0]); assert.equal(result[0].content[2], messages[0].content[2]);
  assert.deepEqual(result[1].content[0], flat()); assert.equal(result[2], messages[2]);
  assert.equal(runtimeMessages(result), result);
  assert.throws(() => runtimeImage({ type: 'image', source: { type: 'base64', mediaType: 'image/png' } }), { code: 'IMAGE_INPUT_INVALID' });
});
test('legacy JSONL remains intact while every replay and branch rebuild is normalized', async t => {
  const dir = await temporary(t), manager = SessionManager.create(dir, dir);
  const oldId = manager.appendMessage({ role: 'user', content: [{ type: 'text', text: 'original' }, legacy()], timestamp: 1 });
  manager.appendMessage({ role: 'assistant', ...model, model: model.id, content: [], stopReason: 'error', errorMessage: 'old failure', timestamp: 2 });
  const file = manager.getSessionFile(), original = await fs.readFile(file);
  const restored = enableImageCompatibility(SessionManager.open(file));
  assert.equal(enableImageCompatibility(restored), restored);
  const replay = restored.buildSessionContext();
  assert.deepEqual(imageUrls(await convert(replay.messages)), [`data:image/png;base64,${png.toString('base64')}`]);
  assert.deepEqual(restored.getEntry(oldId).message.content[1], legacy(), 'raw entries must not be mutated');
  assert.deepEqual(await fs.readFile(file), original, 'read compatibility must not rewrite or delete historical JSONL');
  restored.branch(oldId);
  assert.deepEqual(imageUrls(await convert(restored.buildSessionContext().messages)), [`data:image/png;base64,${png.toString('base64')}`]);
  assert.deepEqual(await fs.readFile(file), original);
});
test('real SDK resume via the production factory repairs old pictures even for a later text-only turn', async t => {
  const dir = await temporary(t), agentDir = path.join(dir, 'isolated-agent'); await fs.mkdir(agentDir);
  const manager = SessionManager.create(dir, dir);
  manager.appendMessage({ role: 'user', content: [legacy()], timestamp: 1 });
  manager.appendMessage({ role: 'assistant', api: model.api, provider: model.provider, model: model.id, content: [], stopReason: 'error', errorMessage: 'old failure', timestamp: 2 });
  manager.appendMessage({ role: 'user', content: [{ type: 'text', text: 'try again' }], timestamp: 3 });
  const file = manager.getSessionFile(), original = await fs.readFile(file);
  const modelRuntime = await ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json'), modelsPath: path.join(agentDir, 'models.json'), modelsStorePath: path.join(agentDir, 'models-store.json') });
  const session = await openConversation(modelRuntime, model, dir, 'none', '', { agentDir });
  try {
    const payload = await convert(session.messages);
    assert.deepEqual(imageUrls(payload), [`data:image/png;base64,${png.toString('base64')}`]);
    assert.ok(JSON.stringify(payload).includes('try again'));
    const current = await fs.readFile(file);
    assert.deepEqual(current.subarray(0, original.length), original, 'SDK may append setup entries but must preserve original records');
  } finally { session.dispose(); }
});
test('prompt boundary accepts legacy callers but supplies the installed SDK flat shape', async () => {
  let input;
  const session = { model, messages: [], subscribe: () => () => {}, async prompt(_text, options) {
    input = options.images;
    this.messages.push({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'ok' }] });
  } };
  await generateAnswer(session, 'look', () => {}, 0, [legacy()]);
  assert.deepEqual(input, [flat()]);
  assert.deepEqual(imageUrls(await convert([{ role: 'user', content: input, timestamp: 1 }])), [`data:image/png;base64,${png.toString('base64')}`]);
});

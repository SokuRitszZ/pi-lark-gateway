import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { createMediaTool } from '../src/media/index.js';

test('installed SDK registers standalone send tool with plain JSON Schema, without user credentials or extensions', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gateway-media-sdk-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const modelRuntime = await ModelRuntime.create({ authPath: path.join(dir, 'auth.json'), modelsPath: path.join(dir, 'models.json'), modelsStorePath: path.join(dir, 'models-store.json') });
  const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime, resourceLoader: loader,
    sessionManager: SessionManager.inMemory(dir), settingsManager: SettingsManager.inMemory({}),
    tools: ['gateway_send_file'], customTools: [createMediaTool(dir, () => null, () => {})],
  });
  try {
    assert.deepEqual(session.agent.state.tools.map(tool => tool.name), ['gateway_send_file']);
    const schema = session.agent.state.tools[0].parameters;
    assert.equal(schema.type, 'object'); assert.deepEqual(schema.required, ['path']);
    assert.equal(schema.additionalProperties, false); assert.equal(schema.properties.chatId, undefined);
  } finally { session.dispose(); }
});

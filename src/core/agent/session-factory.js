import path from 'node:path';
import os from 'node:os';
import { createAgentSession, DefaultResourceLoader, SessionManager } from '@earendil-works/pi-coding-agent';
import { enableImageCompatibility } from './image-compat.js';
import { senderIdentityExtension } from '../identity/index.js';

export async function openConversation(modelRuntime, model, dir, tools, summary = '', {
  create = createAgentSession, agentDir = path.join(os.homedir(), '.pi/agent'), customTools = [], getSenderHeader, promptPolicy = {}, 
} = {}) {
  const full = tools === 'all';
  const loader = new DefaultResourceLoader({ cwd: dir, agentDir,
    extensionFactories: getSenderHeader ? [senderIdentityExtension(getSenderHeader)] : [],
    noExtensions: !full, noSkills: !full, noContextFiles: !full, noPromptTemplates: true, noThemes: true,
    ...(full ? { appendSystemPromptOverride: current => [...current,
      promptPolicy.full || '根据实际工具结果报告操作，不要泄露凭据。工具运行在宿主机器上，不是沙箱。群聊内容对成员可见。破坏性操作和对外发送前确认。'] }
      : { systemPromptOverride: () => promptPolicy.restricted || '用用户的语言简洁回答。没有文件、终端或其他工具。不要声称已执行操作。' }) });
  await loader.reload();
  const manager = enableImageCompatibility(SessionManager.continueRecent(dir, dir));
  if (summary && manager.getEntries().length === 0) {
    manager.appendCustomMessageEntry('gateway_archive', summary, false);
  }
  const { session } = await create({ cwd: dir, agentDir, modelRuntime,
    resourceLoader: loader, ...(full ? { customTools } : { noTools: 'all' }),
    ...(model ? { model } : {}), sessionManager: manager });
  try { await session.bindExtensions({ mode: 'print', onError: () => console.error('extension_error') }); }
  catch (error) { session.dispose(); throw error; }
  return session;
}

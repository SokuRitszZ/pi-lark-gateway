import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { defaultConfigPath, migrateConfig, loadConfig, watchConfig } from '../config/index.js';
import { createThreadStore, createResponse } from '../messages/index.js';
import { createMessageHandler, normalizeAction, actionResponse } from '../adapters/lark/index.js';
import { createApprovals } from '../adapters/lark/approvals/index.js';
import { createAgent, sessionDirectory } from '../core/agent/index.js';
import { createMedia, createMediaTool } from '../media/index.js';
import { createGatewayIdentityResolver, promptPolicy } from '../adapters/lark/identity/index.js';
import { createUserProfiles, createConnection, createMetadata, createCards, createReplies, createReactions, createResources } from '../lark/index.js';
import { createRouter } from './route.js';
import { createControls, canControlResponse } from '../core/controls/index.js';
import { createRestartControl, createRestartCommand } from '../restart/index.js';

// Composition root only: concrete feature implementations live in their own directories.
export async function startGateway({ configPath = process.env.PI_LARK_CONFIG || defaultConfigPath(), log, onRestart } = {}) {
  await migrateConfig(configPath);
  const initial = await loadConfig(configPath);
  const config = initial.config;
  const base = path.join(os.homedir(), '.local/share/pi-lark-gateway', config.bot.appId);
  await fs.mkdir(base, { recursive: true, mode: 0o700 });
  const connection = createConnection(initial, log);
  const metadata = createMetadata(connection.client, log);
  const botInfo = await metadata.probeBot(base);
  const settings = watchConfig(configPath, initial, log);
  const getState = () => {
    const snapshot = settings.get();
    return { ...snapshot, config: { ...snapshot.config,
      bot: { ...snapshot.config.bot, openId: snapshot.config.bot.openId || botInfo.openId } } };
  };
  const threads = await createThreadStore(base);
  const replies = createReplies(connection.client, threads, log);
  const getTools = message => {
    const state = settings.get();
    return (message.isGroup ? state.groups[message.chatId] || state.config.access.groups : state.config.access.private).tools;
  };
  const media = createMedia({ base, getDirectory: key => sessionDirectory(base, key),
    transport: createResources(connection.client, replies.sendResourceReply),
    canSend: message => getTools(message) === 'all' && canControlResponse(message, message.userId, getState(), approvals),
  });
  const agent = await createAgent(base, config.model, {
    log, prepareInput: media.prepare,
    resolveIdentity: createGatewayIdentityResolver({ getUser: createUserProfiles(connection.client) }), promptPolicy,
    getCustomTools: (dir, getTurn) => [createMediaTool(dir, getTurn, media.send)],
    getAnswerTimeoutMs: () => settings.get().config.answerTimeoutMs ?? 0,
  });
  const controls = createControls({ log, canControl: (message, user) => canControlResponse(message, user, getState(), approvals) });
  let restartControl, ready = false;
  const handler = createMessageHandler({
    command: createRestartCommand({ getState,
      canRestart: (message, state) => canControlResponse(message, message.userId, state, approvals),
      schedule: () => { if (!restartControl) throw new Error('restart_unavailable'); return restartControl.schedule(); }, log,
    }),
    log, threadRoots: threads.roots, reply: replies.reply,
    getTools,
    beginResponse: createResponse(replies, log, message => {
      const state = settings.get();
      const policy = message.isGroup ? (state.groups[message.chatId] || state.config.access.groups) : state.config.access.private;
      return policy.replyMode || 'normal';
    }, controls), answer: agent.answer,
    ...createReactions(connection.client, log),
  });
  const approvals = await createApprovals({ file: path.join(base, 'access-approvals.json'), getState, log,
    getChatInfo: metadata.getChatInfo, ...createCards(connection.client),
  });
  const route = createRouter({ getState, approvals, handler, threads, reply: replies.reply, log });
  try {
    if (onRestart) restartControl = await createRestartControl({ base, isIdle: () => ready && handler.isIdle(), restart: onRestart, log });
    await connection.start({
      'im.message.receive_v1': route,
      'card.action.trigger': event => event?.action?.value?.kind === 'response_control'
        ? actionResponse(controls.handle(normalizeAction(event))) : approvals.handle(event),
    });
  } catch {
    settings.close(); agent.abort();
    await Promise.allSettled([restartControl?.close(), connection.close(), handler.drain(), approvals.drain(), agent.dispose()]);
    throw new Error('gateway_start_failed');
  }
  log('gateway_started_configured_access');
  ready = true;
  return {
    async close() {
      // Close message admission synchronously before any shutdown await.
      const drained = handler.drain();
      settings.close(); agent.abort();
      await restartControl?.close();
      await connection.close();
      await drained;
      await approvals.drain();
      await agent.dispose();
    },
  };
}

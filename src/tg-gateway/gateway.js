import path from 'node:path';
import { watchPolicy } from './watch.js';
import { acquireAccountLock } from './lock.js';
import { loadConfig, loadCredentials, dataDirectory, defaultConfigPath } from './config/index.js';
import { createTransport, normalizeMessage, createHandler, createResponses } from '../adapters/telegram/index.js';
import { createAgent, sessionDirectory } from '../core/agent/index.js';
import { createMessageDispatcher } from '../core/messages/index.js';
import { admitMessage, withGrant } from '../core/access/index.js';
import { createApprovals } from '../core/approvals/index.js';
import { createControls, canControlResponse } from '../core/controls/index.js';
import { createMedia, createMediaTool, mediaErrorText } from '../core/media/index.js';
import { createRestartCommand } from '../core/commands/index.js';
import { createRestartControl } from '../restart/index.js';
import { createNextSteps } from '../core/next-steps/index.js';

export async function startGateway({ configPath = defaultConfigPath(), env = process.env, discover = false, onIdentity = () => {}, onRestart,
  log = () => {}, createAgentImpl = createAgent, createTransportImpl = createTransport, dataRoot } = {}) {
  const config = await loadConfig(configPath, { discover }), secret = await loadCredentials(config, configPath, env);
  const base = dataRoot ? path.join(dataRoot, config.botId) : dataDirectory(config.botId);
  const releaseLock = await acquireAccountLock(base);
  let state = { config, groups: config.groups }, agent, transport, dispatcher, approvals, restart, nextSteps, watcher, closing, closed = false, ready = false;
  let resolveDone; const done = new Promise(resolve => { resolveDone = resolve; });
  const active = new Map(), byMessage = new Map(), tasks = new Set();
  const getState = () => state;
  const effective = m => approvals.hasGrant(m.chatId, m.userId) ? withGrant(state, m.chatId, m.userId, m.isGroup ? 'group' : 'p2p') : state;
  const allowed = m => !approvals.isBlocked(m.chatId, m.userId) && admitMessage(m, effective(m));
  const tools = m => (m.isGroup ? state.groups[m.chatId] || state.config.access.groups : state.config.access.private).tools;
  const track = task => { tasks.add(task); void task.catch(() => log('tg_ingress_failed')).finally(() => tasks.delete(task)); };
  const close = () => {
    if (closing) return closing;
    closed = true; watcher?.();
    closing = (async () => {
      const choices = nextSteps?.close(), drain = dispatcher?.drain(); agent?.abort();
      try {
        await restart?.close(); await choices; await transport?.close(); await Promise.allSettled([...tasks]);
        await drain; await approvals?.drain(); await agent?.dispose();
      } finally { try { await releaseLock(); } finally { resolveDone(); } }
    })();
    return closing;
  };
  try {
    transport = createTransportImpl(config, secret, { log, onFailure: () => { log('tg_transport_stopped'); void close().catch(() => log('tg_close_failed')); } });
    if (!discover) {
      approvals = await createApprovals({ file: path.join(base, 'access-approvals.json'), getState, log,
        publish: transport.publishApproval, refresh: transport.refreshApproval, getChatInfo: transport.getChatInfo });
      const controls = createControls({ log, canControl: (message, user) => canControlResponse(message, user, state, approvals) });
      const media = createMedia({ base, getDirectory: key => sessionDirectory(base, key), transport,
        canSend: message => tools(message) === 'all' && canControlResponse(message, message.userId, state, approvals) });
      agent = await createAgentImpl(base, config.model, { log, prepareInput: media.prepare,
        getCustomTools: (dir, getTurn) => [createMediaTool(dir, getTurn, media.send)], getAnswerTimeoutMs: () => state.config.answerTimeoutMs,
        promptPolicy: {
          full: '你通过 Telegram 回复。支持引用、富文本、原地更新和附件。工具运行在宿主机，不是沙箱；群聊所有成员可见，禁止泄露凭据或私人记录。附件仅标记 vision=true 的图片已传给视觉模型，其他文件尚未解析。发文件必须经用户明确请求或确认，写入本会话 attachments/outbox 后使用 gateway_send_file，不能只给本地路径声称已发送。破坏性操作前确认。',
          restricted: '你通过 Telegram 回复。没有宿主机工具，不能声称已执行本机操作。可理解附上的视觉图片，其余附件尚未解析。群回复可见，勿公开敏感数据。',
        },
      });
      const restartCommand = createRestartCommand({ getState, log, canRestart: m => canControlResponse(m, m.userId, state, approvals),
        schedule: () => { if (!restart) throw new Error('tg_restart_unavailable'); return restart.schedule(); } });
      let ingress;
      nextSteps = createNextSteps({ suggest: agent.suggest, log,
        canSelect: (m, user) => !closed && allowed(m) && canControlResponse(m, user, state, approvals),
        dispatch: m => ingress.accept(m) });
      dispatcher = createMessageDispatcher({ log, nextSteps, answer: (...args) => {
        if (!allowed(args[3].message)) throw new Error('tg_access_revoked');
        return agent.answer(...args);
      }, onSettled: m => ingress.settled(m), getTools: tools, mediaErrorText,
        beginResponse: createResponses({ transport, controls, active, byMessage, log }),
        reply: (message, text) => transport.sendText(message.target, text), react: transport.react, removeReaction: transport.removeReaction });
      ingress = createHandler({ getState, isClosed: () => closed, allowed, tools, approvals, controls, dispatcher,
        transport, active, byMessage, track, restartCommand, nextSteps, log });
      transport.onUpdate(ingress.handle);
      if (onRestart) restart = await createRestartControl({ base, isIdle: () => ready && !closed && dispatcher.isIdle() && tasks.size === 0 && nextSteps.isIdle(), restart: onRestart, log });
      watcher = await watchPolicy({ file: configPath, config, apply: next => { state = next; }, isClosed: () => closed, log });
    } else transport.onUpdate((update, bot) => { const message = normalizeMessage(update, bot); if (message && !closed) onIdentity(message.identity); });
    await transport.start(); ready = true; log(discover ? 'tg_discovery_ready' : 'tg_gateway_ready');
    return { close, done, status: () => closed ? 'stopped' : 'running' };
  } catch (error) { await close(); throw error; }
}

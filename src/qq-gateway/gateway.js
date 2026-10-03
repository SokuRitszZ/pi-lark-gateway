import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createAgent } from '../core/agent/index.js';
import { createMessageDispatcher } from '../core/messages/index.js';
import { loadConfig, credentials } from './config.js';
import { createTransport } from '../adapters/qq/index.js';
import { normalizeMessage, isAllowed, replyText } from '../adapters/qq/index.js';

export async function startGateway({ configPath, discover = false, log = () => {}, onIdentity = () => {},
  createAgentImpl = createAgent, createTransportImpl = createTransport, env = process.env, dataRoot } = {}) {
  const config = await loadConfig(configPath, { discover });
  const secret = credentials(env);
  const base = path.join(dataRoot || path.join(os.homedir(), '.local/share/pi-qq-gateway'), config.appId);
  await fs.mkdir(base, { recursive: true, mode: 0o700 });
  const lockPath = path.join(base, 'runtime.lock');
  const lock = await fs.open(lockPath, 'wx', 0o600).catch(() => { throw new Error('qq_account_locked'); });
  try { await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: Date.now() })); }
  catch (error) { await lock.close(); await fs.unlink(lockPath).catch(() => {}); throw error; }
  await lock.close();
  let agent, dispatcher, transport, closed = false, closing;
  let resolveDone; const done = new Promise(resolve => { resolveDone = resolve; });
  const pending = new Set(), seen = new Set(); let count = 0, windowStart = Date.now();
  const close = () => {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      const drained = dispatcher?.drain();
      try {
        agent?.abort();
        await Promise.allSettled([Promise.resolve().then(() => transport?.close()), drained]);
        await agent?.dispose();
      } finally { await fs.unlink(lockPath).catch(() => {}); resolveDone(); }
    })();
    return closing;
  };
  try {
    if (!discover) agent = await createAgentImpl(base, config.model, {
      log, getAnswerTimeoutMs: () => config.answerTimeoutMs,
      promptPolicy: {
        full: '你通过 QQ 与用户对话。当前只支持文本回复，附件尚未解析，不能发送文件或图片。工具运行于宿主机，不是沙箱。群回复所有成员可见，不公开凭据和私人数据。破坏性操作、对外发送前确认。基于工具结果报告操作。',
        restricted: '你是通过 QQ 对话的助手。用用户语言简洁回答，没有工具，不要声称已操作宿主机或解析附件。群回复所有成员可见。',
      },
    });
    transport = createTransportImpl(config, secret, { log, onFailure: () => { log('qq_transport_stopped'); void close().catch(() => log('qq_close_failed')); } });
    if (!discover) dispatcher = createMessageDispatcher({ log,
      getTools: () => config.tools,
      answer: (...args) => { if (closed) throw new Error('gateway_closed'); return agent.answer(...args); },
      reply: async () => {},
      beginResponse: async message => {
        let attempted = false;
        return {
          async finish(text) {
            // One final send only: never resend an ambiguous network failure.
            if (attempted || closed) return;
            attempted = true;
            if (Date.now() - message.receivedAt > 120000) { log('qq_reply_expired'); return; }
            await transport.sendText(message.target, replyText(text));
          },
          async stop() { pending.delete(message.key); },
        };
      },
    });
    transport.onMessage(raw => {
      if (closed) return;
      const message = normalizeMessage(raw, config.appId);
      if (!message) return;
      if (Date.now() - windowStart > 60000) { count = 0; windowStart = Date.now(); }
      if (++count > 30) { log('qq_rate_limited'); return; }
      if (discover) { onIdentity(message.identity); return; }
      if (!isAllowed(message, config)) { log('qq_access_denied'); return; }
      if (seen.has(message.id)) return;
      if (pending.has(message.key) || pending.size >= 10) { log('qq_busy'); return; }
      seen.add(message.id); if (seen.size > 10000) seen.delete(seen.values().next().value);
      pending.add(message.key);
      dispatcher.accept(message);
    });
    await transport.start();
    log(discover ? 'qq_discovery_ready' : 'qq_gateway_ready');
    return { close, done, status: () => closed ? 'stopped' : 'running' };
  } catch (error) { await close(); throw error; }
}

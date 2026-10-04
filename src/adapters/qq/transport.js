import { QQBot } from '@tencent-connect/qqbot-nodejs';
import { createChannelReactionProbe } from './reaction-probe.js';
import { createWebhookServer } from './webhook-server.js';
export function createTransport(config, secret, { log = () => {}, onFailure = () => {}, Bot = QQBot } = {}) {
  const server = createWebhookServer(config.webhook?.host);
  const safeLogger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map(level => [level, () => {
    if (level === 'error' || level === 'warn') log(`qq_sdk_${level}`);
  }]));
  const bot = new Bot({ appId: config.appId, appSecret: secret, accountId: config.appId,
    baseUrl: 'https://api.bot.qq.com',
    transport: config.transport, markdownSupport: false, logger: safeLogger,
    ...(config.transport === 'webhook' ? { webhook: { ...config.webhook, server } } : {}),
  });
  let work, closed = false, ready = false;
  return {
    probeChannelReaction: createChannelReactionProbe(bot, log),
    onMessage(handler) { bot.on('message', (_context, raw) => handler(raw)); },
    async start() {
      let resolveReady, rejectReady;
      const readiness = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      bot.on('ready', () => { ready = true; resolveReady(); });
      bot.on('error', () => log('qq_transport_error'));
      work = Promise.resolve().then(() => bot.start()).then(() => {
        if (!closed) { rejectReady(new Error('qq_transport_ended')); if (ready) onFailure(); }
      }, () => {
        // Token prefetch may finish after an earlier stop; clean refreshers again.
        server.close(); bot.stop();
        rejectReady(new Error('qq_transport_failed')); if (ready && !closed) onFailure();
      });
      const timer = setTimeout(() => rejectReady(new Error('qq_start_timeout')), 30000);
      try { await readiness; } catch (error) { closed = true; server.close(); bot.stop(); throw error; }
      finally { clearTimeout(timer); }
    },
    notifyProcessing(target) {
      if (target.scope === 'c2c') return bot.sendTyping(target, 30);
      if (target.scope === 'group') return bot.sendText(target, '⏳ 正在处理，请稍候…');
    },
    sendText(target, text) {
      // Explicit format; keep a plain-text escape hatch for accounts with restrictions.
      // Never retry a rejected/ambiguous send as text: it could duplicate a reply.
      return config.replyFormat === 'text' ? bot.sendText(target, text) : bot.sendMarkdown(target, text);
    },
    async close() { if (!closed) { closed = true; server.close(); bot.stop(); } },
  };
}

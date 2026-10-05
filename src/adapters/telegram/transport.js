import { Bot, InputFile } from 'grammy';
import fetch from 'node-fetch';
import http from 'node:http';
import https from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import proxyEnv from 'proxy-from-env';
import { setTimeout as delay } from 'node:timers/promises';
import { formatText, formatPages } from './format.js';
import { startWebhook } from './webhook.js';
import { messageKey } from './messages.js';
import { createPacer } from './pace.js';
import { frameCard, approvalTitle, cardDivider } from './card.js';

export function createTransport(config, secret, { log = () => {}, onFailure = () => {}, BotImpl = Bot, fetchImpl = fetch, paceOptions } = {}) {
  const agents = new Map(), pacer = createPacer(paceOptions), controller = new AbortController();
  const agent = url => {
    const href = url.href || String(url), proxy = proxyEnv.getProxyForUrl(href);
    if (proxy && !/^https?:\/\//i.test(proxy)) throw new Error('tg_proxy_protocol_unsupported');
    const key = proxy || new URL(href).protocol;
    if (!agents.has(key)) agents.set(key, proxy ? new HttpsProxyAgent(proxy) : key === 'https:' ? new https.Agent({ keepAlive: true }) : new http.Agent({ keepAlive: true }));
    return agents.get(key);
  };
  const bot = new BotImpl(secret.token, { client: { timeoutSeconds: 20, baseFetchConfig: { agent } } });
  bot.catch(() => log('tg_update_handler_failed'));
  let webhook, work, closed = false, ready = false;
  const call = async fn => {
    if (closed) throw new Error('tg_transport_closed');
    try { return await fn(); } catch (error) {
      const seconds = error?.parameters?.retry_after;
      if (error?.error_code === 429) log('tg_rate_limited');
      if (error?.error_code === 429 && Number.isInteger(seconds) && seconds >= 0 && seconds <= 5 && !closed) {
        await delay(seconds * 1000, undefined, { signal: controller.signal }); if (!closed) return fn();
      }
      throw error;
    }
  };
  const replyOptions = target => ({ reply_parameters: { message_id: target.messageId, allow_sending_without_reply: false }, ...(target.threadId ? { message_thread_id: target.threadId } : {}) });
  const api = {
    onUpdate(handler) { bot.use(ctx => { if (!closed) return handler(ctx.update, bot.botInfo); }); },
    async probe() { await bot.init(AbortSignal.any([controller.signal, AbortSignal.timeout(20000)])); if (String(bot.botInfo.id) !== config.botId) throw new Error('tg_bot_id_mismatch'); return bot.botInfo; },
    async registerWebhook() { await api.probe(); if (config.transport !== 'webhook') throw new Error('tg_webhook_config_required'); const hook = await bot.api.getWebhookInfo(); if (hook.url && hook.url !== config.webhook.url) throw new Error('tg_webhook_exists'); return bot.api.setWebhook(config.webhook.url, { secret_token: secret.webhookSecret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false }); },
    async start() {
      const info = await api.probe(), hook = await bot.api.getWebhookInfo();
      if (config.transport === 'webhook') {
        if (hook.url !== config.webhook.url) throw new Error('tg_webhook_not_registered');
        webhook = await startWebhook(config.webhook, secret.webhookSecret, update => bot.handleUpdate(update), log);
      } else {
        if (hook.url) throw new Error('tg_webhook_exists');
        let resolve, reject;
        const readiness = new Promise((yes, no) => { resolve = yes; reject = no; });
        work = bot.start({ timeout: 15, allowed_updates: ['message', 'callback_query'], onStart: () => resolve() }).then(() => {
          if (!closed) { reject(new Error('tg_polling_ended')); if (ready) onFailure(); }
        }, () => { reject(new Error('tg_polling_failed')); if (ready && !closed) onFailure(); });
        const timer = setTimeout(() => reject(new Error('tg_start_timeout')), 30000);
        try { await readiness; } finally { clearTimeout(timer); }
      }
      ready = true; return info;
    },
    sendText(target, text, keyboard) { return api.sendFormatted(target, formatText(text), keyboard); },
    sendFormatted(target, formatted, keyboard) {
      return pacer.run(target.chatId, () => call(() => bot.api.sendMessage(target.chatId, formatted.text, { ...replyOptions(target), entities: formatted.entities,
        link_preview_options: { is_disabled: true }, ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}) }, controller.signal)));
    },
    editText(chatId, messageId, text, keyboard = []) { return api.editFormatted(chatId, messageId, formatText(text.length > 3500 ? `…前文略\n${text.slice(-3500).replace(/^[\uDC00-\uDFFF]/, '')}` : text), keyboard); },
    async finalize(target, messageId, text, { state = 'complete' } = {}) {
      const body = formatPages(text);
      const pages = body.map((page, index) => frameCard(page, state, index, body.length));
      await api.editFormatted(target.chatId, messageId, pages[0]);
      for (const page of pages.slice(1)) await api.sendFormatted(target, page);
    },
    async editFormatted(chatId, messageId, formatted, keyboard = []) {
      try { return await pacer.run(chatId, () => call(() => bot.api.editMessageText(chatId, Number(messageId), formatted.text, { entities: formatted.entities,
        link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: keyboard } }, controller.signal))); }
      catch (error) { if (error?.error_code === 400 && /message is not modified/i.test(error.description || '')) return; throw error; }
    },
    async react(message) { await call(() => bot.api.setMessageReaction(message.chatId, message.target.messageId, [{ type: 'emoji', emoji: '👀' }], undefined, controller.signal)); return message; },
    removeReaction(message) { return call(() => bot.api.setMessageReaction(message.chatId, message.target.messageId, [], undefined, controller.signal)); },
    answerCallback(id, text) { return bot.api.answerCallbackQuery(id, { text: String(text).slice(0, 180) }, controller.signal); },
    async getChatInfo(chatId) {
      const chat = await call(() => bot.api.getChat(chatId, controller.signal));
      return { name: typeof chat.title === 'string' ? chat.title.slice(0, 200) : '',
        ...(typeof chat.username === 'string' && /^[A-Za-z0-9_]{5,32}$/.test(chat.username) ? { url: `https://t.me/${chat.username}` } : {}) };
    },
    async publishApproval(request) {
      const sent = await pacer.run(request.owner, () => call(() => bot.api.sendMessage(request.owner, approvalText(request), { reply_markup: { inline_keyboard: approvalButtons(request, 'pending') } }, controller.signal)));
      return messageKey(request.owner, sent.message_id);
    },
    async refreshApproval(request, decision) {
      const messageId = request.messageId.split(':').at(-1);
      await api.editText(request.owner, messageId, approvalText(request, decision), approvalButtons(request, decision));
    },
    async download(_message, attachment, { signal, maxBytes }) {
      signal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      maxBytes = Math.min(maxBytes, 20 * 1024 * 1024);
      if (attachment.size && attachment.size > maxBytes) throw Object.assign(new Error('media_limit'), { code: 'MEDIA_TOO_LARGE' });
      const file = await bot.api.getFile(attachment.fileId, signal);
      if (!file.file_path || !/^[A-Za-z0-9_./-]+$/.test(file.file_path) || file.file_path.split('/').includes('..')) throw new Error('tg_file_path_invalid');
      const url = `https://api.telegram.org/file/bot${secret.token}/${file.file_path}`;
      const response = await fetchImpl(url, { agent, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
      if (!response.ok) { response.body?.destroy(); throw new Error('tg_download_failed'); }
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > maxBytes) { response.body.destroy(); throw Object.assign(new Error('media_limit'), { code: 'MEDIA_TOO_LARGE' }); } chunks.push(chunk); }
      return Buffer.concat(chunks);
    },
    async deliver(message, resource, { signal, allowed }) {
      signal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      if (!allowed()) throw Object.assign(new Error('media_denied'), { code: 'MEDIA_SEND_DENIED' });
      const animation = resource.image && /^GIF8[79]a/.test(resource.bytes.subarray(0, 6).toString('ascii'));
      if (resource.image && !animation && resource.bytes.length > 10 * 1024 * 1024) throw Object.assign(new Error('media_limit'), { code: 'MEDIA_TOO_LARGE' });
      const input = new InputFile(resource.bytes, resource.name), options = replyOptions(message.target);
      const sent = await pacer.run(message.chatId, () => { if (!allowed()) throw Object.assign(new Error('media_denied'), { code: 'MEDIA_SEND_DENIED' });
        return animation ? bot.api.sendAnimation(message.chatId, input, options, signal) : resource.image ? bot.api.sendPhoto(message.chatId, input, options, signal) : bot.api.sendDocument(message.chatId, input, options, signal); });
      return { messageId: String(sent.message_id), kind: resource.image ? 'image' : 'file' };
    },
    async close() {
      if (closed) return; closed = true; controller.abort(); pacer.close();
      if (bot.isRunning()) await bot.stop();
      await webhook?.close(); await work;
      for (const value of agents.values()) value.destroy();
    },
  };
  return api;
}
function approvalText(r, status = 'pending') { return `${approvalTitle(status)}\n${cardDivider}\n${r.debugLabel ? '[模拟测试] ' + r.debugLabel + '\n' : ''}\n申请信息\n用户：${r.user}\n会话：${r.chat}\n类型：${r.chatType}${r.chatName ? '\n会话名（仅资料）：' + JSON.stringify(r.chatName) : ''}\n批准只授予会话访问权，不自动开启工具。`; }
function approvalButtons(r, status) {
  const choices = status === 'pending' ? [['批准', 'approved'], ['拒绝', 'denied'], ['封禁', 'blocked']]
    : status === 'approved' ? [['撤销', 'revoked'], ['封禁', 'blocked']]
      : status === 'blocked' ? [['解除封禁', 'unblocked']] : [['封禁', 'blocked']];
  const rows = [choices.map(([text, decision]) => ({ text, callback_data: `a:${r.id}:${decision}` }))];
  const links = [];
  if (r.chatType === 'p2p' && /^[1-9]\d{0,15}$/.test(r.user)) links.push({ text: '查看用户资料', url: `tg://user?id=${r.user}` });
  if (/^https:\/\/t\.me\/[A-Za-z0-9_]{5,32}$/.test(r.chatUrl || '')) links.push({ text: '查看公开群', url: r.chatUrl });
  if (links.length) rows.push(links);
  return rows;
}

import { isAdmin } from '../../core/access/index.js';
import { transformDebugMessage } from './debug.js';
import { normalizeMessage, normalizeCallback } from './messages.js';
export function createHandler({ getState, isClosed, allowed, tools, approvals, controls, dispatcher, transport, active, byMessage, track, restartCommand, nextSteps, log }) {
  const pending = new Map(), seen = new Set();
  let count = 0, windowAt = Date.now();
  const accept = (m, options) => {
    const id = m.dispatchId || m.id;
    if (isClosed() || !allowed(m) || seen.has(id)) return false;
    if (pending.size >= 10 || [...pending.values()].filter(key => key === m.key).length >= 3) { log('tg_busy'); return false; }
    seen.add(id); if (seen.size > 10000) seen.delete(seen.values().next().value);
    pending.set(id, m.key); dispatcher.accept(m, options); return true;
  };
  return {
    accept,
    settled: m => pending.delete(m.dispatchId || m.id),
    handle(update, bot) {
      if (isClosed()) return;
      const { config } = getState();
      if (Date.now() - windowAt > 60000) { windowAt = Date.now(); count = 0; }
      const actor = update.callback_query?.from?.id ?? update.message?.from?.id;
      const privileged = Number.isSafeInteger(actor) && isAdmin(config, String(actor));
      if (++count > 100 && !privileged) { log('tg_rate_limited'); return; }
      const callback = normalizeCallback(update);
      if (callback) {
        const result = callback.value.kind === 'next_step' ? nextSteps.handle(callback)
          : callback.value.kind === 'access_approval' ? approvals.handle(callback) : controls.handle(callback);
        track(transport.answerCallback(callback.id, result.content)); return;
      }
      let m = normalizeMessage(update, bot); if (!m) return;
      const debug = transformDebugMessage(m, config.access.owner);
      if (debug.denied) { log('tg_debug_denied'); return; }
      if (debug.error) { if (allowed(m)) track(transport.sendText(m.target, debug.error)); return; }
      m = debug.message;
      if (!allowed(m)) { log('tg_access_denied'); track(approvals.request(m, m.debugLabel)); return; }
      if (['stop', 'steer'].includes(m.command)) {
        const run = m.replyMessageId ? byMessage.get(m.replyMessageId) : active.get(m.key);
        const result = controls.handle({ actorId: m.userId, messageId: run?.cardId, eventId: m.id, instruction: m.instruction,
          value: { kind: 'response_control', id: run?.id, action: m.command } });
        track(transport.sendText(m.target, result.content)); return;
      }
      if (m.command === 'restart') accept(m, { commandName: 'restart', executeCommand: () => restartCommand(m) });
      else if (['start', 'help', 'status'].includes(m.command)) accept(m, { commandName: m.command,
        executeCommand: () => `Telegram 网关运行中。当前工具：${tools(m)}。\n/ask 问题 · /stop 停止 · /steer 指令 插话 · /restart 管理员延迟重启\n群中可使用 /ask@${bot.username || 'bot'}，或回复机器人的消息。` });
      else accept(m);
    },
  };
}

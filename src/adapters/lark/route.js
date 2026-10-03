import { createRouter as createCoreRouter } from '../../core/routing/index.js';
import { transformDebugEvent } from '../../debug/index.js';
import { isRestartCommand } from '../../restart/index.js';
import { accessMessage } from './access.js';
import { normalizeEvent } from './normalize.js';

export function createRouter({ getState, approvals, handler, threads, reply, log }) {
  return raw => {
    const initial = getState();
    const commandName = isRestartCommand(raw, initial.config.bot.openId) ? 'restart' : undefined;
    const transformed = commandName ? { event: raw } : transformDebugEvent(raw, initial.config.access.owner);
    if (transformed.denied) { log('debug_denied'); return; }
    if (transformed.error) {
      void reply({ id: raw.message.message_id, chatId: raw.message.chat_id,
        isGroup: raw.message.chat_type === 'group', root: raw.message.root_id || raw.message.message_id }, transformed.error).catch(() => log('debug_help_failed'));
      return;
    }
    if (transformed.debugLabel) log('debug_identity_assumed');
    const event = transformed.event;
    // A per-event bridge keeps raw transport objects out of the core.
    const route = createCoreRouter({ getState, log, saveThreads: () => threads.save(),
      approvals: { isBlocked: approvals.isBlocked, hasGrant: approvals.hasGrant,
        request: (access, label) => approvals.requestMessage ? approvals.requestMessage(access, label) : approvals.request(event, label) },
      accept: (message, options) => handler.acceptMessage ? handler.acceptMessage(message, options) : handler.accept(event, { commandName }),
    });
    const access = accessMessage(event, getState().config.bot.openId);
    route({ access: access ? { ...access, id: event.message?.message_id } : null,
      get message() { return normalizeEvent(event, threads.roots); }, commandName,
      executeCommand: handler.commandFor?.(event), debugLabel: transformed.debugLabel });
  };
}

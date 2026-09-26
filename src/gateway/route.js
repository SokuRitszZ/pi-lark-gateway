import { admit, withGrant } from '../config/index.js';
import { transformDebugEvent } from '../debug/index.js';

export function createRouter({ getState, approvals, handler, threads, reply, log }) {
  return data => {
    const transformed = transformDebugEvent(data, getState().config.access.owner);
    if (transformed.denied) { log('debug_denied'); return; }
    if (transformed.error) {
      void reply({ id: data.message.message_id, chatId: data.message.chat_id,
        isGroup: data.message.chat_type === 'group', root: data.message.root_id || data.message.message_id }, transformed.error).catch(() => log('debug_help_failed'));
      return;
    }
    if (transformed.debugLabel) log('debug_identity_assumed');
    data = transformed.event;
    let effective = getState();
    const chat = data.message?.chat_id, user = data.sender?.sender_id?.open_id;
    if (approvals.isBlocked(chat, user)) { log('message_blocked'); return; }
    if (approvals.hasGrant(chat, user)) effective = withGrant(effective, chat, user, data.message?.chat_type);
    if (!admit(data, effective)) {
      log('message_denied_by_policy');
      void approvals.request(data, transformed.debugLabel).catch(() => log('approval_request_failed'));
      return;
    }
    handler.accept(data);
    void threads.save().catch(() => log('thread_mapping_save_failed'));
  };
}

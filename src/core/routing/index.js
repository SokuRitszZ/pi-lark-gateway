import { admitMessage, withGrant } from '../access/index.js';

// Only normalized messages/commands cross this boundary; no transport events.
export function createRouter({ getState, approvals, accept, saveThreads = async () => {}, log = () => {} }) {
  return packet => {
    const { access, commandName, executeCommand, debugLabel } = packet;
    if (!access) return;
    const chat = access.chatId, user = access.userId;
    let effective = getState();
    if (approvals.isBlocked(chat, user)) { log('message_blocked'); return; }
    if (approvals.hasGrant(chat, user)) effective = withGrant(effective, chat, user, access.isGroup ? 'group' : 'p2p');
    if (!admitMessage(access, effective)) {
      log('message_denied_by_policy');
      void approvals.request(access, debugLabel).catch(() => log('approval_request_failed'));
      return;
    }
    accept(packet.message, { commandName, executeCommand });
    void saveThreads().catch(() => log('thread_mapping_save_failed'));
  };
}

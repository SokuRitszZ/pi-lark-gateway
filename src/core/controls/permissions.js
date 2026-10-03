import { admitMessage, isAdmin, withGrant } from '../access/index.js';
export function canControlResponse(message, user, state, approvals) {
  if (user !== message.userId && !isAdmin(state.config, user)) return false;
  if (approvals.isBlocked(message.chatId, user)) return false;
  const effective = approvals.hasGrant(message.chatId, user)
    ? withGrant(state, message.chatId, user, message.isGroup ? 'group' : 'p2p') : state;
  return admitMessage({ chatId: message.chatId, userId: user, isGroup: message.isGroup,
    text: '', mentioned: true }, effective);
}

import { admit, isAdmin, withGrant } from '../config/index.js';

export function canControlResponse(message, user, state, approvals) {
  if (user !== message.userId && !isAdmin(state.config, user)) return false;
  if (approvals.isBlocked(message.chatId, user)) return false;
  const chatType = message.isGroup ? 'group' : 'p2p';
  const effective = approvals.hasGrant(message.chatId, user)
    ? withGrant(state, message.chatId, user, chatType) : state;
  // Clicking an explicit card control is an intentional bot interaction (equivalent to @).
  return admit({ sender: { sender_type: 'user', sender_id: { open_id: user } }, message: {
    chat_id: message.chatId, chat_type: chatType,
    mentions: [{ id: { open_id: state.config.bot.openId } }],
  } }, effective);
}

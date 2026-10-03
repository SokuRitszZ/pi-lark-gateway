import { admitMessage, isAdmin } from '../access/index.js';
export function needsApproval(message, state) {
  if (!message?.userId || !state.config.access.owner) return false;
  const { isGroup, chatId, userId } = message;
  const policy = isGroup ? (state.groups[chatId] || state.config.access.groups) : state.config.access.private;
  if (!policy.enabled || policy.users !== 'allowlist' || policy.onUnknown === 'deny'
    || isAdmin(state.config, userId) || policy.allowedUsers.includes(userId)) return false;
  return admitMessage(message, isGroup
    ? { ...state, groups: { ...state.groups, [chatId]: { ...policy, users: 'all' } } }
    : { ...state, config: { ...state.config, access: { ...state.config.access, private: { ...policy, users: 'all' } } } });
}

// Produce an effective policy snapshot without mutating user configuration.
export function withGrant(state, chat, user, chatType) {
  if (chatType === 'group') {
    const policy = state.groups[chat] || state.config.access.groups;
    return { ...state, groups: { ...state.groups, [chat]: { ...policy, allowedUsers: [...policy.allowedUsers, user] } } };
  }
  if (chatType === 'p2p') {
    const policy = state.config.access.private;
    return { ...state, config: { ...state.config, access: { ...state.config.access,
      private: { ...policy, allowedUsers: [...policy.allowedUsers, user] } } } };
  }
  return state;
}

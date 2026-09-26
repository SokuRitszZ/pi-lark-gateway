import { admit, isAdmin } from '../config/index.js';

export function needsApproval(event, state) {
  const m = event?.message, user = event?.sender?.sender_id?.open_id;
  if (!['group', 'p2p'].includes(m?.chat_type) || event.sender?.sender_type !== 'user' || !user || !state.config.access.owner) return false;
  const group = m.chat_type === 'group';
  const p = group ? (state.groups[m.chat_id] || state.config.access.groups) : state.config.access.private;
  if (!p.enabled || p.users !== 'allowlist' || p.onUnknown === 'deny' || isAdmin(state.config, user) || p.allowedUsers.includes(user)) return false;
  // Check trigger rules independently of the membership check.
  return admit(event, group
    ? { ...state, groups: { ...state.groups, [m.chat_id]: { ...p, users: 'all' } } }
    : { ...state, config: { ...state.config, access: { ...state.config.access, private: { ...p, users: 'all' } } } });
}

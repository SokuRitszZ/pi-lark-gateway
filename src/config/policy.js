import { messageText, matchesText } from './text-rules.js';

export function isAdmin(config, user) {
  return !!user && (user === config.access.owner || config.access.admins.includes(user));
}
export function admit(event, { config, groups }) {
  const m = event?.message, sender = event?.sender;
  if (!m || sender?.sender_type !== 'user') return false;
  const group = m.chat_type === 'group';
  if (!group && m.chat_type !== 'p2p') return false;
  const p = group ? (groups[m.chat_id] || config.access.groups) : config.access.private;
  const user = sender.sender_id?.open_id;
  if (!p.enabled) return false;
  if (p.users === 'allowlist' && !isAdmin(config, user) && !p.allowedUsers.includes(user)) return false;
  // Deny rules win over mentions and allow rules, including in existing threads.
  if (group) {
    const text = messageText(m);
    if (matchesText(p.denyTextPatterns, text)) return false;
    const mentioned = config.bot.openId && (m.mentions || []).some(x => x.id?.open_id === config.bot.openId);
    if (p.trigger === 'mention' && !mentioned && !matchesText(p.allowTextPatterns, text)) return false;
  }
  return true;
}

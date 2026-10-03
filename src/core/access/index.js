export { withGrant } from './grants.js';

export function isAdmin(config, user) {
  return !!user && (user === config.access.owner || config.access.admins.includes(user));
}

export function matchesText(patterns, text) {
  return (patterns || []).some(pattern => new RegExp(pattern, 'u').test(text));
}

/** Policy state is scoped to one gateway account by the composition root. */
export function admitMessage(message, { config, groups }) {
  if (!message) return false;
  const { chatId, userId, isGroup, text, mentioned } = message;
  const policy = isGroup ? (groups[chatId] || config.access.groups) : config.access.private;
  if (!policy.enabled) return false;
  if (policy.users === 'allowlist' && !isAdmin(config, userId) && !policy.allowedUsers.includes(userId)) return false;
  if (isGroup) {
    // Deny rules take precedence over mentions and explicit allow patterns.
    if (matchesText(policy.denyTextPatterns, text)) return false;
    if (policy.trigger === 'mention' && !mentioned && !matchesText(policy.allowTextPatterns, text)) return false;
  }
  return true;
}

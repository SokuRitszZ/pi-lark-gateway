export const assert = (ok, field) => { if (!ok) throw new Error(`invalid_config:${field}`); };
const ids = value => Array.isArray(value) && value.every(v => typeof v === 'string' && v.length > 0);
export function validatePolicy(p) {
  assert(p && typeof p.enabled === 'boolean', 'enabled');
  assert(['all', 'allowlist'].includes(p.users), 'users');
  assert(ids(p.allowedUsers), 'allowedUsers');
  assert(['all', 'mention'].includes(p.trigger), 'trigger');
  for (const field of ['allowTextPatterns', 'denyTextPatterns']) {
    if (p[field] === undefined) continue;
    assert(Array.isArray(p[field]) && p[field].length <= 50, field);
    for (const pattern of p[field]) {
      assert(typeof pattern === 'string' && pattern.length > 0 && pattern.length <= 1000, field);
      try { new RegExp(pattern, 'u'); } catch { assert(false, field); }
    }
  }
  assert(['none', 'all'].includes(p.tools), 'tools');
  assert(p.replyMode === undefined || ['normal', 'card'].includes(p.replyMode), 'replyMode');
  assert(p.onUnknown === undefined || ['ask_owner', 'deny'].includes(p.onUnknown), 'onUnknown');
  return p;
}
export function validateConfig(c) {
  assert(c?.version === 2, 'version');
  assert(c.answerTimeoutMs === undefined || c.answerTimeoutMs === null ||
    (Number.isSafeInteger(c.answerTimeoutMs) && c.answerTimeoutMs >= 0 && c.answerTimeoutMs <= 2147483647), 'answerTimeoutMs');
  assert(c.bot?.domain === 'feishu', 'bot.domain_only_feishu_supported');
  assert(typeof c.bot.appId === 'string' && c.bot.appId.length > 0, 'bot.appId');
  assert(typeof c.bot.credentialsFile === 'string' && !!c.bot.credentialsFile, 'bot.credentialsFile');
  assert(c.bot.connectionMode === 'websocket', 'bot.connectionMode');
  assert(c.bot.name === null || typeof c.bot.name === 'string', 'bot.name');
  assert(c.bot.openId === null || typeof c.bot.openId === 'string', 'bot.openId');
  assert(c.access && (c.access.owner === null || typeof c.access.owner === 'string'), 'access.owner');
  assert(ids(c.access.admins), 'access.admins');
  validatePolicy(c.access.private); validatePolicy(c.access.groups);
  assert(c.session?.private === 'chat' && c.session?.group === 'thread', 'session');
  assert(c.model === null || (typeof c.model?.provider === 'string' && typeof c.model?.id === 'string'), 'model');
  return c;
}

import { createHash } from 'node:crypto';
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value) ? value : null;
export function normalizeMessage(raw, appId) {
  if (raw?.senderIsBot || !['c2c', 'group'].includes(raw?.kind)) return null;
  if (raw.kind === 'group' && raw.rawEventType !== 'GROUP_AT_MESSAGE_CREATE') return null;
  if (raw.kind === 'c2c' && raw.rawEventType !== 'C2C_MESSAGE_CREATE') return null;
  const user = id(raw.senderId);
  const messageId = typeof raw.messageId === 'string' && raw.messageId.length > 0 && raw.messageId.length <= 512 && !/[\s\x00-\x1f\x7f]/u.test(raw.messageId) ? raw.messageId : null;
  const group = raw.kind === 'group' ? id(raw.groupOpenid) : null;
  if (!user || !messageId || (raw.kind === 'group' && !group)) return null;
  const scope = raw.kind, targetId = group || user;
  // Never use user content or a caller-supplied replyTarget to choose a recipient.
  const sourceId = JSON.stringify([appId, scope, targetId, messageId]);
  const identity = { QQ: { source: 'qq_gateway', app_id: appId, message_id: messageId,
    chat_type: scope, group_openid: group,
    sender: scope === 'c2c' ? { user_openid: user } : { member_openid: user } } };
  let text = typeof raw.content === 'string' ? raw.content.trim() : '';
  const mentions = (Array.isArray(raw.mentions) ? raw.mentions : []).slice(0, 50).map(value => ({
    id: id(value?.id), user_openid: id(value?.user_openid), member_openid: id(value?.member_openid),
    is_you: value?.is_you === true, scope: value?.scope === 'all' ? 'all' : 'single',
    name: typeof (value?.nickname ?? value?.username) === 'string'
      ? (value.nickname ?? value.username).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 128) : null,
  }));
  if (Array.from(text).length > 16000) text = Array.from(text).slice(0, 16000).join('') + '\n[输入过长，已截断]';
  if (raw.attachments?.length) text += '\n[当前版本未解析附件，不能声称已查看图片、音视频或文件。]';
  return { id: createHash('sha256').update(sourceId).digest('hex'), chatId: targetId, userId: user,
    isGroup: !!group, key: JSON.stringify(['qq', appId, scope, targetId, user]),
    text, type: 'text', identity, mentions, receivedAt: Date.now(),
    target: { scope, targetId, msgId: messageId } };
}
export function isAllowed(message, config) {
  if (!message) return false;
  const users = message.isGroup ? (Object.hasOwn(config.access.groups, message.chatId) ? config.access.groups[message.chatId] : []) : config.access.c2cUsers;
  return users.includes(message.userId);
}
export function replyText(text, maxBytes = 3500) {
  const suffix = '\n[回复过长，已截断；请要求分段继续。]';
  if (Buffer.byteLength(text) <= maxBytes) return text;
  let result = '', bytes = 0;
  const limit = maxBytes - Buffer.byteLength(suffix);
  for (const char of text) { const n = Buffer.byteLength(char); if (bytes + n > limit) break; result += char; bytes += n; }
  return result + suffix;
}

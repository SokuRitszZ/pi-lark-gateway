import { createHash } from 'node:crypto';
const id = n => Number.isSafeInteger(n) && n !== 0 ? String(n) : null;
export const messageKey = (chatId, messageId) => `${chatId}:${messageId}`;
export function normalizeMessage(update, bot) {
  const m = update?.message, user = m?.from;
  if (!m || !user || user.is_bot || m.sender_chat || !['private', 'group', 'supergroup'].includes(m.chat?.type)) return null;
  const userId = id(user.id), chatId = id(m.chat.id), messageId = id(m.message_id), botId = id(bot.id);
  if (!userId || !chatId || !messageId || !botId || user.id <= 0 || m.message_id <= 0) return null;
  if (m.message_thread_id !== undefined && (!Number.isSafeInteger(m.message_thread_id) || m.message_thread_id <= 0)) return null;
  const threadId = m.message_thread_id === undefined ? null : String(m.message_thread_id);
  let text = typeof m.text === 'string' ? m.text : typeof m.caption === 'string' ? m.caption : '';
  const rawEntities = m.text ? m.entities : m.caption_entities;
  const entities = Array.isArray(rawEntities) ? rawEntities : [];
  const name = String(bot.username || '').toLowerCase();
  const mentions = entities.filter(e => ['mention', 'text_mention'].includes(e.type) && Number.isInteger(e.offset) && e.offset >= 0 && Number.isInteger(e.length) && e.length > 0 && e.offset + e.length <= text.length).slice(0, 20).map(e => {
    const label = text.slice(e.offset, e.offset + e.length).slice(0, 200);
    const nativeId = e.type === 'text_mention' ? id(e.user?.id) : null;
    return { platform: 'telegram', user_id: nativeId, username: e.type === 'mention' ? label.slice(1) : null, label,
      isBot: nativeId === botId || (e.type === 'mention' && label.toLowerCase() === `@${name}`) };
  });
  const mentioned = mentions.some(e => e.isBot) || String(m.reply_to_message?.from?.id) === botId;
  const command = text.match(/^\/(\w+)(?:@([A-Za-z0-9_]+))?(?:\s|$)/);
  if (command?.[2] && command[2].toLowerCase() !== name) return null;
  const isGroup = m.chat.type !== 'private';
  const addressed = mentioned || !!command;
  if (command?.[1] === 'ask') text = text.slice(command[0].length).trim();
  const attachments = [];
  const photo = Array.isArray(m.photo) ? m.photo.at(-1) : null;
  if (photo?.file_id) attachments.push({ kind: 'image', fileId: photo.file_id, name: 'photo.jpg', size: photo.file_size });
  for (const [field, kind] of [['document', 'file'], ['video', 'video'], ['animation', 'video'], ['audio', 'audio'], ['voice', 'audio'], ['sticker', 'image']]) {
    const a = m[field];
    if (a?.file_id) attachments.push({ kind, fileId: a.file_id, name: a.file_name || `${field}.${field === 'sticker' ? 'webp' : 'bin'}`, size: a.file_size });
  }
  if (!text.trim() && !attachments.length) return null;
  const target = { chatId, messageId: Number(messageId), ...(threadId ? { threadId: Number(threadId) } : {}) };
  return { id: createHash('sha256').update(JSON.stringify([botId, chatId, messageId])).digest('hex'),
    key: JSON.stringify(['tg', botId, chatId, threadId, userId]), chatId, userId, isGroup, mentioned: addressed,
    text: text.slice(0, 16000), attachments, mentions, target, receivedAt: Date.now(),
    command: command?.[1], instruction: command ? text.replace(/^\/\w+(?:@[A-Za-z0-9_]+)?\s*/, '') : '',
    replyMessageId: m.reply_to_message?.message_id ? messageKey(chatId, m.reply_to_message.message_id) : null,
    identity: { Telegram: { source: 'telegram_gateway', bot_id: botId, chat_id: chatId, message_id: messageId,
      message_thread_id: threadId, chat_type: m.chat.type, sender: { user_id: userId, username: typeof user.username === 'string' ? user.username : null } } },
  };
}
export function normalizeCallback(update) {
  const q = update?.callback_query, m = q?.message;
  if (!q || !m?.chat || typeof q.id !== 'string' || q.id.length > 512 || q.from?.is_bot || !id(q.from?.id) || q.from.id <= 0 || !id(m.message_id) || m.message_id <= 0 || !id(m.chat.id) || typeof q.data !== 'string' || q.data.length > 64) return null;
  const parts = q.data.split(':'), [kind, requestId, action] = parts;
  if (!/^[a-f0-9-]{36}$/.test(requestId || '')) return null;
  if (kind === 'n' && parts.length === 3 && /^[0-3]$/.test(action)) return { id: q.id, actorId: String(q.from.id),
    messageId: messageKey(m.chat.id, m.message_id), eventId: q.id, value: { kind: 'next_step', id: requestId, index: Number(action) } };
  if (kind === 's' && action === undefined) return { id: q.id, actorId: String(q.from.id), messageId: messageKey(m.chat.id, m.message_id), eventId: q.id,
    value: { kind: 'response_control', id: requestId, action: 'stop' } };
  if (kind === 'a' && parts.length === 3 && ['approved', 'denied', 'revoked', 'blocked', 'unblocked'].includes(action)) return { id: q.id, actorId: String(q.from.id),
    messageId: messageKey(m.chat.id, m.message_id), eventId: q.id, value: { kind: 'access_approval', id: requestId, decision: action } };
  return null;
}

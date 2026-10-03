import { extractAttachments } from './media/index.js';
import { extractMentionText } from './mentions.js';

// Lark ingress normalization. Policy admission remains outside this parser.
export function normalizeEvent(event, threadRoots = new Map()) {
  const { message, sender } = event || {};
  if (!message?.message_id || !message.chat_id || sender?.sender_type !== 'user') return null;
  let body;
  try { body = JSON.parse(message.content); } catch { return null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const attachments = extractAttachments(message.message_type, body);
  const { text, mentions } = extractMentionText(message, body);
  const isGroup = message.chat_type === 'group';
  const alias = `${message.chat_id}:${message.thread_id}`;
  const root = threadRoots.get(alias) || message.root_id || message.thread_id || message.message_id;
  if (isGroup && message.thread_id) threadRoots.set(alias, root);
  const debugSleepMs = Number.isSafeInteger(event.debug?.sleepMs) ? event.debug.sleepMs : undefined;
  return { id: message.message_id, chatId: message.chat_id, userId: sender.sender_id?.open_id, isGroup, root,
    senderIds: Object.freeze({ userId: sender.sender_id?.user_id, unionId: sender.sender_id?.union_id, tenantKey: sender.tenant_key }),
    key: isGroup ? `${message.chat_id}:topic:${root}` : `${message.chat_id}:private`,
    text: text.trim(), type: message.message_type, ...(mentions.length ? { mentions } : {}), ...(attachments.length ? { attachments } : {}), ...(debugSleepMs === undefined ? {} : { debugSleepMs }) };
}

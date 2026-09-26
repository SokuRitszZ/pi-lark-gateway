// Transport-independent routing. No sender allowlist or mention requirement.
export function normalizeEvent(event, threadRoots = new Map()) {
  const { message, sender } = event || {};
  if (!message?.message_id || !message.chat_id || sender?.sender_type !== 'user') return null;
  let body;
  try { body = JSON.parse(message.content); } catch { return null; }
  let text = '';
  if (message.message_type === 'text') text = body.text || '';
  if (message.message_type === 'post') {
    const post = body.content ? body : body.zh_cn || body.en_us;
    text = [post?.title, ...(post?.content || []).map(row => row.map(item => item.text || '').join(''))].filter(Boolean).join('\n');
  }
  for (const mention of message.mentions || []) text = text.replaceAll(mention.key, mention.name || '');
  const isGroup = message.chat_type === 'group';
  const alias = `${message.chat_id}:${message.thread_id}`;
  const root = threadRoots.get(alias) || message.root_id || message.thread_id || message.message_id;
  if (isGroup && message.thread_id) threadRoots.set(alias, root);
  const debugSleepMs = Number.isSafeInteger(event.debug?.sleepMs) ? event.debug.sleepMs : undefined;
  return { id: message.message_id, chatId: message.chat_id, userId: sender.sender_id?.open_id, isGroup, root,
    key: isGroup ? `${message.chat_id}:topic:${root}` : `${message.chat_id}:private`,
    text: text.trim(), type: message.message_type, ...(debugSleepMs === undefined ? {} : { debugSleepMs }) };
}

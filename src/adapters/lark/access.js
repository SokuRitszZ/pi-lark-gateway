// Match user-visible text, never JSON metadata, mention IDs or attachment keys.
export function messageText(message) {
  try {
    const content = JSON.parse(message.content);
    let text = '';
    if (message.message_type === 'text') text = typeof content.text === 'string' ? content.text : '';
    else if (message.message_type === 'post') {
      const post = content.content ? content : content.zh_cn || content.en_us;
      text = [post?.title, ...(post?.content || []).map(row => row
        .filter(item => ['text', 'a'].includes(item.tag))
        .map(item => item.text || '').join(''))].filter(Boolean).join('\n');
    }
    for (const mention of message.mentions || []) {
      if (typeof mention.key === 'string' && mention.key) text = text.replaceAll(mention.key, '');
    }
    return text.trim();
  } catch { return ''; }
}

// Admission text intentionally excludes @ labels and rich-text metadata.
// Do not reuse model-input normalization: that preserves mention placeholders.
export function accessMessage(event, botId) {
  const m = event?.message, sender = event?.sender;
  if (!m || sender?.sender_type !== 'user') return null;
  if (!['group', 'p2p'].includes(m.chat_type)) return null;
  return {
    chatId: m.chat_id,
    userId: sender.sender_id?.open_id,
    isGroup: m.chat_type === 'group',
    text: messageText(m),
    mentioned: !!botId && (m.mentions || []).some(x => x.id?.open_id === botId),
  };
}

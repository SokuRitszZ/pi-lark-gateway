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

export function matchesText(patterns, text) {
  return (patterns || []).some(pattern => new RegExp(pattern, 'u').test(text));
}

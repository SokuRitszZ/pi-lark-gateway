const textParts = message => message.content.map(block => block.type === 'text' && typeof block.text === 'string' ? block.text : undefined);
const parts = entry => entry.parts.filter(part => typeof part === 'string');
const toolName = name => String(name || 'tool').replace(/[^\p{L}\p{N}_.:-]/gu, '_').slice(0, 100).replaceAll('_', '\\_');

// Per-response public transcript only: never retain reasoning, args or results.
export function createTimeline() {
  const entries = [], tools = new Map(), known = new WeakMap();
  let active;
  function messageEntry(message, start = false) {
    let entry = message && known.get(message);
    if (!entry) {
      entry = !start && active;
      if (!entry) { entry = { type: 'text', parts: [] }; entries.push(entry); }
      if (message) known.set(message, entry);
    }
    active = entry;
    return entry;
  }
  function render() {
    let result = '', previous;
    for (const entry of entries) {
      const text = entry.type === 'text' ? parts(entry).join('\n') : `(${entry.status} ${entry.name}：${entry.label})`;
      if (!text) continue;
      result += (result ? previous === 'tool' && entry.type === 'tool' ? '\n' : '\n\n' : '') + text;
      previous = entry.type;
    }
    return result;
  }
  return {
    render,
    event(event) {
      if (event.type === 'message_start' || event.type === 'message_end') {
        if (event.message?.role !== 'assistant' || !Array.isArray(event.message.content)) return false;
        const entry = messageEntry(event.message, event.type === 'message_start');
        entry.parts = textParts(event.message);
        if (event.type === 'message_end') active = undefined;
        return true;
      }
      if (event.type === 'message_update') {
        const update = event.assistantMessageEvent;
        if (!['text_start', 'text_delta', 'text_end'].includes(update?.type)) return false;
        const message = event.message || update.partial;
        if (message && message.role !== 'assistant') return false;
        const entry = messageEntry(message);
        if (Array.isArray(message?.content)) entry.parts = textParts(message);
        else {
          const index = Number.isSafeInteger(update.contentIndex) && update.contentIndex >= 0 && update.contentIndex < 10000 ? update.contentIndex : 0;
          if (update.type === 'text_delta' && typeof update.delta === 'string') entry.parts[index] = (entry.parts[index] || '') + update.delta;
          if (update.type === 'text_end' && typeof update.content === 'string') entry.parts[index] = update.content;
        }
        return true;
      }
      if (event.type === 'tool_execution_start') {
        active = undefined;
        if (event.toolCallId && tools.has(event.toolCallId)) return false;
        const entry = { type: 'tool', name: toolName(event.toolName), status: '⏳', label: '执行中' };
        entries.push(entry);
        if (event.toolCallId) tools.set(event.toolCallId, entry);
        return true;
      }
      if (event.type === 'tool_execution_end') {
        const entry = tools.get(event.toolCallId);
        if (!entry) return false;
        entry.status = event.isError ? '❌' : '✅'; entry.label = event.isError ? '失败' : '完成';
        return true;
      }
      return ['agent_start', 'intent_title'].includes(event.type);
    },
    finish(text, { terminal = false } = {}) {
      const messages = entries.filter(entry => entry.type === 'text');
      const aggregate = messages.flatMap(parts).join('\n');
      const last = messages.at(-1);
      // generateAnswer returns ALL assistant text joined by newline, not only
      // the last message. Do not append that aggregate to an already streamed turn.
      if (terminal || (text !== aggregate && text !== (last && parts(last).join('\n')))) {
        const prior = (active ? messages.slice(0, -1) : messages).flatMap(parts).join('\n');
        const prefix = prior ? `${prior}\n` : '';
        if (!terminal && text.startsWith(prefix) && (active || prefix)) {
          const remainder = text.slice(prefix.length);
          if (active) active.parts = [remainder];
          else if (remainder) entries.push({ type: 'text', parts: [remainder] });
        } else if (text) entries.push({ type: 'text', parts: [text] });
      }
      for (const entry of entries) if (entry.type === 'tool' && entry.status === '⏳') { entry.status = '⏹'; entry.label = '未完成'; }
      return render();
    },
  };
}

import { randomUUID } from 'node:crypto';
export function validateSuggestions(value) {
  if (!Array.isArray(value) || value.length > 4) throw new Error('invalid_next_steps');
  return value.map(option => {
    if (!option || typeof option.title !== 'string' || typeof option.detail !== 'string') throw new Error('invalid_next_steps');
    const title = option.title.trim(), detail = option.detail.trim();
    if (!title || title.length > 40 || /[\x00-\x1f]/.test(title) || !detail || detail.length > 500 || /[\x00-\x08\x0b-\x1f]/.test(detail)) throw new Error('invalid_next_steps');
    // No hidden action/prompt: only the visible title/detail become the user's request.
    return { title, detail };
  });
}
export function createNextSteps({ suggest, canSelect, dispatch, log = () => {}, now = Date.now, ttl = 30 * 60000, capacity = 200 }) {
  const records = new Map(), tasks = new Set(); let closed = false;
  const prune = () => { for (const [id, r] of records) if (r.expires <= now()) records.delete(id); };
  const toast = (content, type = 'info') => ({ content, type });
  return {
    async offer(message, answer, present) {
      if (closed || typeof suggest !== 'function' || typeof present !== 'function') return;
      try {
        if (!canSelect(message, message.userId)) return;
        const options = validateSuggestions(await suggest(message.text, answer));
        if (closed || !options.length || !canSelect(message, message.userId)) return;
        prune(); if (records.size >= capacity) records.delete(records.keys().next().value);
        const id = randomUUID(), r = { id, message, options, present, state: 'publishing', expires: now() + ttl };
        records.set(id, r);
        try { r.messageId = await present({ id, options }); if (!r.messageId) throw new Error('next_steps_missing_message'); r.state = 'ready'; }
        catch { records.delete(id); log('next_steps_present_failed'); }
      } catch { log('next_steps_generation_failed'); }
    },
    handle(event) {
      prune(); const value = event?.value, r = records.get(value?.id), index = value?.index;
      if (closed || value?.kind !== 'next_step' || !r || r.state !== 'ready' || r.messageId !== event.messageId
        || !Number.isInteger(index) || index < 0 || index >= r.options.length) return toast('选项已处理、过期或不可用。', 'error');
      const option = r.options[index];
      const next = { ...r.message, dispatchId: `next:${r.id}`, text: `用户选择的下一步：\n${option.title}\n${option.detail}`,
        attachments: [], mentions: [], mentioned: true, command: undefined, instruction: undefined, debugSleepMs: undefined,
        nextStep: { id: r.id, index, sourceMessageId: r.messageId }, receivedAt: now() };
      // Only the original sender may turn a suggestion into their own user request.
      if (typeof event.actorId !== 'string' || !event.actorId || event.actorId !== r.message.userId || !canSelect(next, event.actorId)) return toast('无权选择此建议，或当前策略不允许该请求。', 'error');
      r.state = 'consumed';
      const task = (async () => {
        try {
          await r.present({ id: r.id, options: r.options, selectedIndex: index });
          if (closed) return;
          if (!canSelect(next, event.actorId) || await dispatch(next) === false) {
            log('next_steps_dispatch_denied');
            await r.present({ id: r.id, options: r.options, selectedIndex: index, unavailable: true });
          }
        } catch { log('next_steps_selection_failed'); }
      })();
      tasks.add(task); void task.finally(() => tasks.delete(task));
      return toast('已选择，正在更新原回复并继续。');
    },
    isIdle: () => tasks.size === 0,
    async close() { closed = true; records.clear(); await Promise.allSettled([...tasks]); },
  };
}

import { createProgress } from '../progress/index.js';
import { responseCard } from './card.js';
import { cardPages } from './card-pages.js';

export async function createCardResponse(message, replies, log, controls) {
  let title = '正在整理意图…', state = 'waiting', closed = false;
  const initial = responseCard(title, '已收到，等待处理…', state);
  const channel = replies.createCardStream?.(message);
  const send = card => channel ? channel.send(card) : replies.sendCardReply(message, card);
  const edit = (id, card, options) => channel ? channel.edit(id, card, options) : replies.editCard(id, card);
  let id;
  try { id = await send(initial); }
  catch (error) { await channel?.close(); throw error; }
  const ids = [id], rendered = [JSON.stringify(initial)];
  const control = controls?.create(message);
  control?.attach(id);
  const progress = createProgress({ log, retainTranscript: true, async edit(text, options) {
    const pages = cardPages(title, text, state, control?.id);
    // Reuse continuation cards during streaming instead of sending them again.
    for (let i = 0; i < Math.max(ids.length, pages.length); i++) {
      const card = pages[i] || responseCard(title + '（续）', '内容已合并至前面的卡片。', state);
      const serialized = JSON.stringify(card);
      if (i >= ids.length) ids.push(await send(card));
      else if (rendered[i] !== serialized) await edit(ids[i], card, options);
      rendered[i] = serialized;
    }
  } });
  return {
    summarizeIntent: true,
    onSession: session => control?.bind(session),
    event(event) {
      if (closed) return;
      if (event.type === 'intent_title') title = event.title;
      if (event.type === 'agent_start') state = 'thinking';
      progress.event(event);
    },
    async finish(text, { error = false } = {}) {
      closed = true;
      control?.close();
      // Finish in-flight progress before changing terminal state.
      await progress.stop();
      state = control?.stopped ? 'stopped' : error ? 'error' : 'success';
      if (control?.stopped) text = '已停止当前回复。';
      if (title === '正在整理意图…') title = '对话回复';
      try { await progress.finish(text, { terminal: error || control?.stopped === true }); }
      finally { await channel?.close(); }
    },
    async stop() { closed = true; control?.close(); await progress.stop(); await channel?.close(); },
  };
}

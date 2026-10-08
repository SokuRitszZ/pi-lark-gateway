import { createProgress } from '../progress/index.js';
import { responseCard } from './card.js';
import { cardPages } from './card-pages.js';
import { nextStepsText } from '../../../presentation/next-steps/index.js';

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
  const images = [];
  let currentText = '已收到，等待处理…', mutations = Promise.resolve();
  let finalCard, finalId, finalEdit, suggestionBase, suggestionId, suggestionEdit;
  function serialize(work) {
    const pending = mutations.then(work);
    mutations = pending.catch(() => {});
    return pending;
  }
  async function render(options) {
    const pages = cardPages(title, currentText, state, control?.id, images);
    // Reuse continuation cards during streaming instead of sending them again.
    for (let i = 0; i < Math.max(ids.length, pages.length); i++) {
      const card = pages[i] || responseCard(title + '（续）', '内容已合并至前面的卡片。', state);
      const serialized = JSON.stringify(card);
      if (i >= ids.length) ids.push(await send(card));
      else if (rendered[i] !== serialized) await edit(ids[i], card, options);
      rendered[i] = serialized;
    }
  }
  const progress = createProgress({ log, retainTranscript: true, edit: (text, options) => serialize(async () => {
    currentText = text;
    await render(options);
  }) });
  return {
    summarizeIntent: true,
    get canSuggest() { return state === 'success' && !String(message.userId).startsWith('debug_'); },
    async nextSteps(view) {
      if (!finalCard || state !== 'success') throw new Error('next_steps_response_not_finished');
      const decorate = base => ({ ...base, body: { ...base.body, elements: [...base.body.elements,
        { tag: 'hr' }, { tag: 'markdown', content: nextStepsText(view) },
        ...(view.selectedIndex === undefined ? view.options.map((option, index) => ({ tag: 'button', type: 'default',
          text: { tag: 'plain_text', content: option.title }, behaviors: [{ type: 'callback', value: { kind: 'next_step', id: view.id, index } }] })) : []),
      ] } });
      if (!suggestionBase) {
        if (view.selectedIndex !== undefined) throw new Error('next_steps_missing_message');
        suggestionBase = finalCard; suggestionId = finalId; suggestionEdit = finalEdit;
        if (Buffer.byteLength(JSON.stringify({ content: JSON.stringify(decorate(finalCard)) })) > 27 * 1024) {
          suggestionBase = responseCard(title + '（下一步）', '', 'success'); suggestionBase.body.elements = [];
          suggestionId = await replies.sendCardReply(message, decorate(suggestionBase));
          suggestionEdit = card => replies.editCard(suggestionId, card);
          return suggestionId;
        }
      }
      await suggestionEdit(decorate(suggestionBase));
      return suggestionId;
    },
    async appendImage(image, { isActive = () => true } = {}) {
      return serialize(async () => {
        if (closed || control?.stopped || !isActive()) throw Object.assign(new Error('card_image_turn_closed'), { code: 'MEDIA_SEND_DENIED' });
        if (!/^[A-Za-z0-9_-]{1,256}$/.test(image?.key || '')) throw new Error('invalid_card_image');
        if (!images.some(existing => existing.key === image.key)) {
          if (images.length >= 4) throw Object.assign(new Error('card_image_limit'), { code: 'MEDIA_SEND_LIMIT' });
          images.push({ key: image.key, name: String(image.name || '图片').slice(0, 160) });
        }
        // Keep the image even on ambiguous edit failure: later snapshots update
        // the same card idempotently, never resend a standalone image message.
        await render({ animate: false });
        return id;
      });
    },
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
      await mutations;
      state = control?.stopped ? 'stopped' : error ? 'error' : 'success';
      if (control?.stopped) text = '已停止当前回复。';
      if (title === '正在整理意图…') title = '对话回复';
      try {
        await progress.finish(text, { terminal: error || control?.stopped === true });
        const pages = cardPages(title, currentText, state, control?.id, images);
        finalCard = pages.at(-1); finalId = ids[pages.length - 1];
        finalEdit = channel?.finalEditor?.(finalId) || (card => replies.editCard(finalId, card));
      }
      finally { await channel?.close(); }
    },
    async stop() { closed = true; control?.close(); await progress.stop(); await mutations; await channel?.close(); },
  };
}

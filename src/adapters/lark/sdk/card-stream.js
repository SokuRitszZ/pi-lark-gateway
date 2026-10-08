import { randomUUID } from 'node:crypto';

const elementId = 'response_text';
const terminal = card => ['green', 'red', 'orange'].includes(card.header?.template);
const textOf = card => card.body.elements[0].content;
const config = {
  print_frequency_ms: { default: 30 }, print_step: { default: 2 }, print_strategy: 'fast',
};
function nativeCard(card, streaming, text = textOf(card)) {
  const value = structuredClone(card);
  value.config = { ...value.config, streaming_mode: streaming, streaming_config: config };
  value.body.elements[0] = { ...value.body.elements[0], element_id: elementId, content: text };
  return value;
}
const structure = card => JSON.stringify(nativeCard(card, true, ''));
const legacyCard = card => ({ ...card, config: { ...card.config, streaming_mode: false } });

// One transport per response: no global message/card registry or retained text.
// The caller serializes edits. Failed native operations consume their sequence
// numbers too, since a timed-out operation may have been applied server-side.
export function createStreamingCards({ client, send, edit, log = () => {}, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const api = client.cardkit?.v1, entries = new Map();
  let native = !!(api?.card?.create && api?.card?.update && api?.card?.settings && api?.cardElement?.content);
  let closed = false, warned = false;
  function fallback() {
    native = false;
    if (!warned) { warned = true; log('card_stream_fallback'); }
  }
  async function call(entry, fn, data) {
    const wait = Math.max(0, entry.nextAt - now());
    if (wait) await sleep(wait);
    entry.nextAt = now() + 150; // Below the per-card 10 requests/second limit.
    const result = await fn({ path: { card_id: entry.cardId }, data: { ...data, sequence: ++entry.sequence, uuid: randomUUID() } });
    if (result?.code !== 0) throw new Error('card_stream_operation_failed');
  }
  async function settings(entry, enabled) {
    await call(entry, payload => api.card.settings(payload), {
      settings: JSON.stringify({ config: { streaming_mode: enabled, ...(enabled ? { streaming_config: config } : {}) } }),
    });
    entry.streaming = enabled;
    if (enabled) entry.openedAt = now();
  }
  async function whole(entry, card, streaming, text) {
    await call(entry, payload => api.card.update(payload), {
      card: { type: 'card_json', data: JSON.stringify(nativeCard(card, streaming, text)) },
    });
    entry.text = text ?? textOf(card); entry.structure = structure(card);
    entry.placeholder = ['已收到，等待处理…', '正在思考…'].includes(entry.text);
  }
  async function content(entry, text) {
    await call(entry, payload => api.cardElement.content({ ...payload, path: { ...payload.path, element_id: elementId } }), { content: text });
    entry.text = text;
  }
  async function downgrade(entry, id, card) {
    fallback();
    if (entry?.streaming) {
      try { await settings(entry, false); } catch { log('card_stream_close_failed'); }
    }
    await edit(id, legacyCard(card));
    // Full legacy JSON includes streaming_mode:false even if settings failed.
    entries.delete(id);
  }
  return {
    async send(card) {
      if (closed) throw new Error('card_stream_closed');
      if (!native) return send(card);
      let cardId;
      try {
        const result = await api.card.create({ data: { type: 'card_json', data: JSON.stringify(nativeCard(card, !terminal(card))) } });
        if (result?.code !== 0 || !result.data?.card_id) throw new Error('card_stream_create_failed');
        cardId = result.data.card_id;
      } catch { fallback(); return send(card); }
      const uuid = randomUUID();
      let id;
      try { id = await send({ type: 'card', data: { card_id: cardId } }, { uuid }); }
      catch (error) {
        // Retry with legacy JSON only after an explicit API rejection. Never
        // blindly send another card after an ambiguous network/send timeout.
        if (!error?.cardSendRejected) throw error;
        fallback(); return send(card, { uuid });
      }
      entries.set(id, { cardId, sequence: 0, text: textOf(card), structure: structure(card),
        streaming: !terminal(card), placeholder: card.header?.template === 'grey', openedAt: now(), nextAt: now() + 150 });
      return id;
    },
    async edit(id, card, { animate = true } = {}) {
      const entry = entries.get(id);
      if (!entry) return edit(id, legacyCard(card));
      if (!native || closed) return downgrade(entry, id, card);
      try {
        const text = textOf(card), append = text.startsWith(entry.text);
        if (!terminal(card) && (!entry.streaming || now() - entry.openedAt >= 9 * 60 * 1000)) await settings(entry, true);
        if (animate && entry.streaming && entry.placeholder && !append && text.length) {
          // Remove placeholder text before the first real output so even the
          // first model chunk can animate as an append to an empty element.
          await whole(entry, card, true, '');
          await content(entry, text);
          entry.placeholder = false;
        } else if (animate && entry.streaming && append && text !== entry.text && text.length) {
          if (structure(card) !== entry.structure && !terminal(card)) await whole(entry, card, true, entry.text);
          await content(entry, text);
        } else if (!terminal(card) && (text !== entry.text || structure(card) !== entry.structure)) {
          // Replacing tool status/details or canonical text is not an append:
          // apply the full snapshot immediately rather than animate stale text.
          await whole(entry, card, true);
        }
        if (terminal(card)) {
          if (entry.streaming) await settings(entry, false);
          await whole(entry, card, false);
        }
      } catch { await downgrade(entry, id, card); }
    },
    finalEditor(id) {
      // Retain only this terminal card's identity/sequence after stream cleanup.
      const entry = entries.get(id);
      return async card => {
        if (!entry || !native) return edit(id, legacyCard(card));
        try { await whole(entry, card, false); }
        catch { await downgrade(entry, id, card); }
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const entry of entries.values()) if (entry.streaming) {
        try { await settings(entry, false); } catch { log('card_stream_close_failed'); }
      }
      entries.clear();
    },
  };
}

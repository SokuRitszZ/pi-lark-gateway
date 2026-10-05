import { createTimeline } from '../../core/progress/index.js';
import { messageKey } from './messages.js';
import { progressCard, responseState } from './card.js';
// At most one progress request in flight; replace pending snapshots instead of queueing them.
export function createResponses({ transport, controls, active, byMessage, log, interval = 1200 }) {
  return async message => {
    const handle = controls.create(message), timeline = createTimeline();
    const keyboard = [[{ text: '停止', callback_data: `s:${handle.id}` }]];
    let sent;
    try { sent = await transport.sendText(message.target, progressCard(), keyboard); }
    catch (error) { handle.close(); throw error; }
    const cardId = messageKey(message.chatId, sent.message_id);
    handle.attach(cardId);
    const run = { id: handle.id, cardId, message };
    byMessage.set(cardId, run);
    let final = false, closed = false, busy = false, dirty = false, timer, inFlight = Promise.resolve();
    const schedule = () => {
      if (closed || busy || timer || !dirty) return;
      timer = setTimeout(() => {
        timer = undefined; dirty = false; busy = true;
        inFlight = Promise.resolve().then(() => transport.editText(message.chatId, sent.message_id, progressCard(timeline.render()), keyboard))
          .catch(() => log('tg_progress_failed')).finally(() => { busy = false; schedule(); });
      }, interval);
    };
    return {
      event(event) {
        // Only names/statuses for tools, never operation arguments or raw results.
        const visible = event.type === 'tool_execution_start'
          ? { type: event.type, toolCallId: event.toolCallId, toolName: event.toolName }
          : event;
        if (!closed && timeline.event(visible)) { dirty = true; schedule(); }
      },
      onSession(session) {
        handle.bind(session);
        if (session) active.set(message.key, run);
        else if (active.get(message.key) === run) active.delete(message.key);
      },
      async finish(text, options) {
        if (final) return;
        final = true; closed = true; clearTimeout(timer);
        await inFlight;
        // Known first message plus bounded continuation pages. Never blindly resend after failure.
        await transport.finalize(message.target, sent.message_id, text, { state: responseState(text, options, handle.stopped) });
      },
      async stop() {
        closed = true; clearTimeout(timer); await inFlight; handle.close();
        if (active.get(message.key) === run) active.delete(message.key);
        byMessage.delete(cardId);
      },
    };
  };
}

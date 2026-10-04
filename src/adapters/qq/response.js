import { replyText } from './messages.js';

export function createQQResponse({ message, config, transport, log, isClosed, onStop, flushIntervalMs = 400 }) {
  const streaming = message.target.scope === 'c2c' && config.streaming !== false && config.replyFormat !== 'text' && transport.openStream;
  let stream = null;
  if (streaming) {
    try { stream = transport.openStream(message.target); }
    catch { log('qq_stream_init_failed'); } // Constructor sent nothing; final-only is safe here.
  }
  let active = '', committed = '', pending = '', last = '', timer, inFlight = Promise.resolve();
  let busy = false, finishing = false, attempted = false, failure, stopped = false;
  const expired = () => Date.now() - message.receivedAt > 120000;
  const clear = () => { clearTimeout(timer); timer = undefined; };
  const fail = error => { failure = error; stream?.cancel(); log('qq_stream_failed'); };
  const schedule = () => {
    if (!stream || !pending || timer || busy || finishing || failure || stopped || isClosed() || expired() || pending === last) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!pending) return;
      busy = true; const text = pending;
      inFlight = Promise.resolve().then(() => {
        if (stopped || isClosed() || expired()) return;
        return stream.update(text);
      }).then(() => { last = text; }, fail).finally(() => { busy = false; schedule(); });
    }, flushIntervalMs);
  };
  return {
    event(event) {
      if (!stream || finishing || stopped || failure) return;
      if (event.type === 'message_start' && event.message?.role === 'assistant') active = '';
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') active += event.assistantMessageEvent.delta || '';
      if (event.type === 'message_end' && event.message?.role === 'assistant') {
        if (!['error', 'aborted'].includes(event.message.stopReason)) {
          const text = (event.message.content || []).filter(part => part.type === 'text').map(part => part.text).join('');
          if (text) committed += (committed ? '\n' : '') + text;
        }
        active = '';
      }
      pending = replyText([committed, active].filter(Boolean).join('\n'));
      if (pending) schedule();
    },
    async finish(text) {
      if (attempted || stopped || isClosed()) return;
      attempted = true; finishing = true; clear(); await inFlight;
      if (isClosed() || expired()) { stream?.cancel(); log('qq_reply_expired'); return; }
      if (failure) throw failure;
      // The authoritative final answer replaces transient partial/retry content.
      if (stream) {
        try { await stream.update(replyText(text)); await stream.complete(); }
        catch (error) { fail(error); throw error; }
      } else await transport.sendText(message.target, replyText(text));
    },
    async stop() {
      stopped = true; finishing = true; clear(); stream?.cancel();
      try { await inFlight; } finally { onStop(); }
    },
  };
}

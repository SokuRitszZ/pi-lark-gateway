import { setTimeout as delay } from 'node:timers/promises';
// Shared across all responses in a chat. Each response separately coalesces progress.
export function createPacer({ now = Date.now, pause = delay } = {}) {
  const states = new Map(), controller = new AbortController();
  return {
    run(chatId, fn) {
      if (controller.signal.aborted) return Promise.reject(new Error('tg_transport_closed'));
      const gap = String(chatId).startsWith('-') ? 3100 : 1100;
      let state = states.get(chatId);
      if (!state) { state = { chain: Promise.resolve(), last: -Infinity, pending: 0 }; states.set(chatId, state); }
      clearTimeout(state.timer); state.pending++;
      const work = state.chain.then(async () => {
        if (controller.signal.aborted) throw new Error('tg_transport_closed');
        const wait = gap - (now() - state.last);
        if (wait > 0) await pause(wait, undefined, { signal: controller.signal });
        if (controller.signal.aborted) throw new Error('tg_transport_closed');
        state.last = now(); return fn();
      });
      state.chain = work.catch(() => {});
      void work.finally(() => {
        state.pending--;
        if (!state.pending && !controller.signal.aborted) { state.timer = setTimeout(() => { if (states.get(chatId) === state && !state.pending) states.delete(chatId); }, gap); state.timer.unref(); }
      }).catch(() => {});
      return work;
    },
    close() { controller.abort(); for (const state of states.values()) clearTimeout(state.timer); states.clear(); },
  };
}

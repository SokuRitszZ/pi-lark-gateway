// A control capability belongs to one turn, never to the next use of its session.
export function createRunControl(session) {
  let closed = false, stopped = false, signalStop;
  const pending = new Set();
  const interrupted = new Promise(resolve => { signalStop = resolve; });
  return {
    interrupted,
    abort() {
      if (closed || stopped) return Promise.resolve();
      stopped = true; signalStop(); session.clearQueue();
      return session.abort();
    },
    canSteer: () => !closed && !stopped && !session.isIdle,
    steer(text) {
      if (closed || stopped || session.isIdle) return Promise.reject(new Error('turn_not_active'));
      const work = Promise.resolve(session.steer(text));
      pending.add(work);
      void work.then(() => pending.delete(work), () => pending.delete(work));
      return work;
    },
    async close() {
      closed = true;
      // Input hooks may be async: settle them before reusing this session.
      await Promise.allSettled([...pending]);
      session.clearQueue();
    },
  };
}

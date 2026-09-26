// FIFO semaphore shared by foreground sessions and background archiving.
export function createLimiter(limit = 10) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('invalid_concurrency');
  let active = 0;
  const waiting = [];
  return {
    async run(work) {
      if (active >= limit) await new Promise(resolve => waiting.push(resolve));
      else active++;
      try { return await work(); }
      finally {
        const next = waiting.shift();
        if (next) next(); else active--;
      }
    },
  };
}

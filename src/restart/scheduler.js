import { randomUUID } from 'node:crypto';

export function createRestartScheduler({ isIdle, restart, log = () => {}, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout, pollMs = 100 }) {
  let job, timer, idleSince, closed = false;
  const arm = () => { timer = setTimer(check, pollMs); timer?.unref?.(); };
  function check() {
    timer = undefined;
    if (closed || !job) return;
    if (!isIdle()) { idleSince = undefined; job.state = 'waiting'; }
    else {
      idleSince ??= now();
      job.state = 'scheduled';
      if (now() - idleSince >= job.delayMs) {
        job.state = 'restarting';
        closed = true;
        log('restart_after_output_ready');
        // The callback must synchronously close message admission before awaiting I/O.
        try { Promise.resolve(restart()).catch(() => log('restart_failed')); }
        catch { log('restart_failed'); }
        return;
      }
    }
    arm();
  }
  return {
    schedule(delayMs = 1000) {
      if (!Number.isSafeInteger(delayMs) || delayMs < 250 || delayMs > 60000) throw new Error('invalid_restart_delay');
      if (closed) throw new Error('restart_closed');
      if (!job) {
        job = { id: randomUUID(), state: 'waiting', delayMs };
        log('restart_after_output_requested');
        arm();
      }
      return { ...job };
    },
    close() { closed = true; if (timer !== undefined) clearTimer(timer); },
  };
}

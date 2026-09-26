import { randomUUID } from 'node:crypto';
export { canControlResponse } from './permissions.js';

const toast = (content, type = 'info') => ({ toast: { type, content } });

// Ephemeral, per-response capabilities. Never look up a live session by thread in a callback.
export function createControls({ canControl, log = () => {} }) {
  const runs = new Map();
  return {
    create(message) {
      const id = randomUUID();
      const run = { id, message, cardId: null, session: null, stopped: false, seen: new Set() };
      runs.set(id, run);
      return {
        id,
        get stopped() { return run.stopped; },
        attach(cardId) { run.cardId = cardId; },
        bind(session) { run.session = session; },
        close() { run.session = null; runs.delete(id); },
      };
    },
    handle(event) {
      const value = event?.action?.value;
      const run = runs.get(value?.id);
      if (value?.kind !== 'response_control' || !run?.session || run.stopped
        || (event.context?.open_message_id || event.open_message_id) !== run.cardId) {
        return toast('这一轮已结束或尚未开始。', 'error');
      }
      const user = event.operator?.open_id;
      if (!user || !canControl(run.message, user)) return toast('无权操作此回复。', 'error');
      const token = event.token || event.event_id;
      if (token && run.seen.has(token)) return toast('已处理此操作。');
      if (value.action === 'stop') {
        if (token) run.seen.add(token);
        run.stopped = true;
        void Promise.resolve(run.session.abort()).catch(() => log('response_abort_failed'));
        return toast('正在停止当前回复。');
      }
      if (value.action === 'steer') {
        if (run.session.canSteer && !run.session.canSteer()) return toast('生成已结束，请发送新消息。', 'error');
        const text = event.action.form_value?.instruction;
        if (typeof text !== 'string' || !text.trim()) return toast('请先输入打断指令。', 'error');
        if (text.length > 4000) return toast('指令不能超过 4000 字符。', 'error');
        if (token) run.seen.add(token);
        void Promise.resolve(run.session.steer(text.trim())).catch(() => log('response_steer_failed'));
        return toast('已插入指令，将在下一个执行边界处理。');
      }
      return toast('未知操作。', 'error');
    },
  };
}

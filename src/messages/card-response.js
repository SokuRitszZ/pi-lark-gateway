import { createProgress } from '../progress/index.js';
import { responseCard } from './card.js';

export async function createCardResponse(message, replies, log, controls) {
  let title = '正在整理意图…', state = 'waiting';
  const id = await replies.sendCardReply(message, responseCard(title, '已收到，等待处理…', state));
  const control = controls?.create(message);
  control?.attach(id);
  const progress = createProgress({ log, edit: text => replies.editCard(id, responseCard(title, text, state, control?.id)) });
  return {
    summarizeIntent: true,
    onSession: session => control?.bind(session),
    event(event) {
      if (event.type === 'intent_title') title = event.title;
      if (event.type === 'agent_start') state = 'thinking';
      progress.event(event);
    },
    async finish(text, { error = false } = {}) {
      control?.close();
      // Finish in-flight progress before changing terminal state.
      await progress.stop();
      state = control?.stopped ? 'stopped' : error ? 'error' : 'success';
      if (control?.stopped) text = '已停止当前回复。';
      if (title === '正在整理意图…') title = '对话回复';
      // Feishu limits card requests to 30 KB, not 4000 characters.
      // Account for the serialized content string and reserve room for request metadata.
      const payload = { msg_type: 'interactive', content: JSON.stringify(responseCard(title, text, state)) };
      if (Buffer.byteLength(JSON.stringify(payload), 'utf8') <= 28 * 1024) {
        await progress.finish(text);
        return;
      }
      const chars = Array.from(text);
      await progress.finish(chars.slice(0, 4000).join(''));
      for (let i = 4000; i < chars.length; i += 4000) {
        await replies.sendCardReply(message, responseCard(title + '（续）', chars.slice(i, i + 4000).join(''), state));
      }
    },
    async stop() { control?.close(); await progress.stop(); },
  };
}

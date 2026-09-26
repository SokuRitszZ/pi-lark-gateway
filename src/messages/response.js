import { createProgress } from '../progress/index.js';
import { createCardResponse } from './card-response.js';

// Orchestrates placeholder, throttled updates, and final-answer continuation.
export function createResponse(replies, log, getMode = () => 'normal', controls) {
  return async message => {
    if (getMode(message) === 'card') return createCardResponse(message, replies, log, controls);
    const id = await replies.sendReply(message, '正在思考…\n暂无工具调用（如有前序任务，会先等待其完成）');
    return createProgress({ log, async edit(text) {
      const chars = Array.from(text);
      await replies.edit(id, chars.slice(0, 1500).join(''));
      if (chars.length > 1500) await replies.reply(message, chars.slice(1500).join(''));
    } });
  };
}

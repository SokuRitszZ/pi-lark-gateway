import { createMessageDispatcher } from '../../core/messages/index.js';
import { mediaErrorText } from '../../media/index.js';
import { normalizeEvent } from './normalize.js';

export const REACTION_EMOJIS = ['SMILE', 'THUMBSUP', 'OK', 'HEART', 'CLAP'];

// Compatibility boundary: legacy callers still submit raw Lark events.
export function createMessageHandler({ threadRoots = new Map(), random = Math.random,
  react = async () => {}, command = () => undefined, ...options }) {
  const dispatcher = createMessageDispatcher({ ...options, mediaErrorText,
    unsupportedText: '未找到可处理的文字或附件。暂不支持表情包、卡片内资源及合并转发附件，请直接发送图片或文件。',
    react: message => react(message, REACTION_EMOJIS[Math.floor(random() * REACTION_EMOJIS.length)]),
  });
  let closed = false;
  return {
    accept(event, { commandName } = {}) {
      // Avoid thread-map changes after admission has closed.
      if (closed) return;
      dispatcher.accept(normalizeEvent(event, threadRoots), {
        commandName, executeCommand: message => command(message, event),
      });
    },
    acceptMessage: dispatcher.accept,
    commandFor: event => message => command(message, event),
    isIdle: dispatcher.isIdle,
    drain() { closed = true; return dispatcher.drain(); },
  };
}

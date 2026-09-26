import { normalizeEvent } from './normalize.js';

export const REACTION_EMOJIS = ['SMILE', 'THUMBSUP', 'OK', 'HEART', 'CLAP'];
const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function createMessageHandler({ answer, reply, beginResponse, react = async () => {}, removeReaction = async () => {}, random = Math.random, log = () => {}, getTools = () => 'none', threadRoots = new Map(), sleep = defaultSleep }) {
  const seen = new Map();
  const queues = new Map();
  let closed = false;
  return {
    accept(event) {
      if (closed) return;
      const m = normalizeEvent(event, threadRoots);
      if (!m || seen.has(m.id)) return;
      seen.set(m.id, Date.now());
      if (seen.size > 10000) seen.delete(seen.keys().next().value);
      log('message_received');
      const emoji = REACTION_EMOJIS[Math.floor(random() * REACTION_EMOJIS.length)];
      const reaction = Promise.resolve().then(() => react(m, emoji)).catch(() => log('reaction_failed'));
      // Start placeholder immediately, including messages waiting in the session queue.
      const response = beginResponse ? Promise.resolve().then(() => beginResponse(m)).catch(() => { log('placeholder_failed'); return null; }) : Promise.resolve(null);
      const job = (queues.get(m.key) || Promise.resolve()).catch(() => {}).then(async () => {
        const progress = await response;
        try {
          let output;
          if (m.debugSleepMs !== undefined) {
            log('debug_sleep_started');
            await sleep(m.debugSleepMs);
            output = `debug sleep ${m.debugSleepMs}ms done`;
          } else {
            output = m.text ? await answer(m.key, m.text, event => progress?.event(event), { summarizeIntent: progress?.summarizeIntent === true, tools: getTools(m), onSession: progress?.onSession }) : '目前支持文字和富文本消息，图片、语音和文件解析还未接入。';
          }
          if (progress) await progress.finish(output);
          else await reply(m, output);
          log('message_replied');
        } catch (error) {
          const reason = error?.code;
          log(reason === 'ANSWER_TIMEOUT' ? 'message_timed_out' : reason === 'ANSWER_ABORTED' ? 'message_aborted' : 'message_failed');
          const errorText = reason === 'ANSWER_TIMEOUT' ? '本次回复已达到配置的超时时长，已停止。'
            : reason === 'ANSWER_ABORTED' ? '当前回复已停止。'
            : reason === 'MODEL_FAILED' ? '模型生成失败，请稍后再试。'
            : '暂时处理失败，请稍后再试。';
          if (progress) await progress.finish(errorText, { error: true }).catch(() => reply(m, errorText).catch(() => {}));
          else await reply(m, errorText).catch(() => {});
        } finally {
          await progress?.stop().catch(() => log('progress_cleanup_failed'));
          const reactionId = await reaction;
          if (reactionId) {
            try { await removeReaction(m, reactionId); }
            catch { log('reaction_remove_failed'); }
          }
        }
      });
      queues.set(m.key, job);
      void job.finally(() => { if (queues.get(m.key) === job) queues.delete(m.key); });
      // Return immediately: platform expects event acknowledgement within 3 seconds.
    },
    async drain() { closed = true; await Promise.all(queues.values()); },
  };
}

import { failureDiagnostic } from '../../errors/index.js';
const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Accepts normalized messages only. Platform parsing and presentation are injected.
export function createMessageDispatcher({ answer, reply, beginResponse, command = () => undefined, react = async () => {}, removeReaction = async () => {}, log = () => {}, getTools = () => 'none', sleep = defaultSleep, mediaErrorText = () => undefined, unsupportedText = '未找到可处理的文字或附件。' }) {
  const seen = new Map();
  const queues = new Map();
  let closed = false;
  return {
    /** @param {import('../contracts/index.js').GatewayMessage | null} m */
    accept(m, { commandName, executeCommand } = {}) {
      if (closed) return;
      if (!m || seen.has(m.id)) return;
      seen.set(m.id, Date.now());
      if (seen.size > 10000) seen.delete(seen.keys().next().value);
      log('message_received');
      const reaction = Promise.resolve().then(() => react(m)).catch(() => log('reaction_failed'));
      // Start placeholder immediately, including messages waiting in the session queue.
      const response = beginResponse ? Promise.resolve().then(() => beginResponse(m)).catch(() => { log('placeholder_failed'); return null; }) : Promise.resolve(null);
      const job = (queues.get(m.key) || Promise.resolve()).catch(() => {}).then(async () => {
        const progress = await response;
        try {
          // Commands share the same queue/final-send/cleanup lifetime as answers.
          let output;
          if (commandName) {
            output = await (executeCommand || command)(m);
            // An ingress-classified command must NEVER fall back to the model.
            if (typeof output !== 'string') output = '命令暂不可用，请检查网关状态。';
          } else {
            if (m.debugSleepMs !== undefined) {
              log('debug_sleep_started');
              await sleep(m.debugSleepMs);
              output = `debug sleep ${m.debugSleepMs}ms done`;
            } else {
              output = m.text || m.attachments?.length ? await answer(m.key, m.text, event => progress?.event(event), { message: m, appendImage: progress?.appendImage, summarizeIntent: progress?.summarizeIntent === true, tools: getTools(m), onSession: progress?.onSession }) : unsupportedText;
            }
          }
          if (progress) await progress.finish(output);
          else await reply(m, output);
          log('message_replied');
        } catch (error) {
          const reason = error?.code;
          log(reason === 'ANSWER_TIMEOUT' ? 'message_timed_out' : reason === 'ANSWER_ABORTED' ? 'message_aborted' : 'message_failed');
          const diagnostic = failureDiagnostic(error);
          const errorText = mediaErrorText(reason) || (reason === 'ANSWER_TIMEOUT' ? '本次回复已达到配置的超时时长，已停止。'
            : reason === 'ANSWER_ABORTED' ? '当前回复已停止。'
            : `${reason === 'MODEL_FAILED' ? '模型生成失败' : '暂时处理失败'}（${diagnostic.code}）。\n${diagnostic.text}`);
          if (!mediaErrorText(reason) && !['ANSWER_TIMEOUT', 'ANSWER_ABORTED'].includes(reason)) log(`message_failure_${diagnostic.code.toLowerCase()}`);
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
      // Admission is synchronous; the adapter owns its acknowledgement deadline.
    },
    isIdle() { return queues.size === 0; },
    async drain() { closed = true; await Promise.all(queues.values()); },
  };
}

import { runtimeImage } from './image-compat.js';

export async function generateAnswer(session, text, onEvent, timeoutMs = 0, images = []) {
  if (images.length && !session.model?.input?.includes('image')) throw Object.assign(new Error('vision_unsupported'), { code: 'VISION_UNSUPPORTED' });
  images = images.map(runtimeImage);
  const unsubscribe = session.subscribe(onEvent);
  const start = session.messages.length;
  let timedOut = false;
  const timer = timeoutMs > 0 ? setTimeout(() => {
    timedOut = true;
    void Promise.resolve().then(() => session.abort()).catch(() => {});
  }, timeoutMs) : null;
  try {
    await session.prompt(text, { expandPromptTemplates: false, ...(images.length ? { images } : {}) });
    const messages = session.messages.slice(start).filter(m => m.role === 'assistant');
    if (timedOut) throw Object.assign(new Error('answer_timeout'), { code: 'ANSWER_TIMEOUT' });
    if (messages.some(m => m.stopReason === 'aborted')) throw Object.assign(new Error('answer_aborted'), { code: 'ANSWER_ABORTED' });
    if (messages.some(m => m.stopReason === 'error')) throw Object.assign(new Error('model_failed'), { code: 'MODEL_FAILED' });
    return messages.flatMap(m => m.content.filter(c => c.type === 'text').map(c => c.text)).join('\n') || '没有生成文本回复，请再试一次。';
  } catch (error) {
    if (timedOut) throw Object.assign(new Error('answer_timeout'), { code: 'ANSWER_TIMEOUT' });
    throw error;
  } finally { if (timer !== null) clearTimeout(timer); unsubscribe(); }
}

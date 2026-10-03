import { AsyncLocalStorage } from 'node:async_hooks';
import { withMentionHeader, identityHeader } from '../identity/index.js';
import { createSessionPool } from './sessions.js';
import { generateAnswer } from './answer.js';
import { summarizeIntent } from './title.js';
import { createRunControl } from './run-control.js';

export { sessionDirectory } from './session-lifecycle.js';

export async function createAgent(base, model, { getAnswerTimeoutMs = () => 0, log = () => {}, pool: injectedPool, createPool = createSessionPool, prepareInput, resolveIdentity = async message => message?.identity || {}, formatIdentity = identityHeader, promptPolicy, getCustomTools = () => [] } = {}) {
  const turns = new AsyncLocalStorage();
  const pool = injectedPool || await createPool(base, model, { log, promptPolicy, getCustomTools: dir => getCustomTools(dir, () => turns.getStore()),
    getSenderHeader: () => turns.getStore()?.active ? turns.getStore().senderHeader : undefined });
  return {
    async answer(key, text, onEvent, { summarizeIntent: summarize = false, tools = 'none', onSession = () => {}, message, appendImage } = {}) {
      const turn = { active: true, message, tools, appendImage };
      return pool.run(key, tools, session => turns.run(turn, async () => {
        const control = createRunControl(session), inputController = new AbortController();
        onSession({ ...control, abort() { inputController.abort(); return control.abort(); } });
        try {
          turn.senderHeader = formatIdentity(await resolveIdentity(message, { signal: inputController.signal }));
          inputController.signal.throwIfAborted();
          // Download only after admission/dedup and inside the global session limiter.
          const input = message && prepareInput ? await prepareInput(message, { tools, signal: inputController.signal }) : { text, images: [] };
          inputController.signal.throwIfAborted();
          const title = summarize
            ? summarizeIntent(pool.modelRuntime, session.model, withMentionHeader(text, message), base)
              .catch(() => '对话回复').then(title => onEvent({ type: 'intent_title', title }))
            : Promise.resolve();
          const output = await generateAnswer(session, withMentionHeader(input.text, message), onEvent, getAnswerTimeoutMs(), input.images);
          await Promise.race([title, control.interrupted]);
          return output;
        } catch (error) {
          if (inputController.signal.aborted) throw Object.assign(new Error('answer_aborted'), { code: 'ANSWER_ABORTED' });
          throw error;
        } finally {
          turn.active = false;
          turn.senderHeader = undefined;
          inputController.abort();
          await turn.mediaQueue;
          onSession(null);
          await control.close();
        }
      }));
    },
    abort: pool.abort,
    dispose: pool.dispose,
  };
}

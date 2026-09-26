import { createSessionPool } from './sessions.js';
import { generateAnswer } from './answer.js';
import { summarizeIntent } from './title.js';
import { createRunControl } from './run-control.js';

export async function createAgent(base, model, { getAnswerTimeoutMs = () => 0, log = () => {}, pool: injectedPool } = {}) {
  const pool = injectedPool || await createSessionPool(base, model, { log });
  return {
    async answer(key, text, onEvent, { summarizeIntent: summarize = false, tools = 'none', onSession = () => {} } = {}) {
      return pool.run(key, tools, async session => {
        const title = summarize
          ? summarizeIntent(pool.modelRuntime, session.model, text, base)
            .catch(() => '对话回复').then(title => onEvent({ type: 'intent_title', title }))
          : Promise.resolve();
        const control = createRunControl(session);
        onSession(control);
        try {
          const output = await generateAnswer(session, text, onEvent, getAnswerTimeoutMs());
          await Promise.race([title, control.interrupted]);
          return output;
        } finally {
          onSession(null);
          await control.close();
        }
      });
    },
    abort: pool.abort,
    dispose: pool.dispose,
  };
}

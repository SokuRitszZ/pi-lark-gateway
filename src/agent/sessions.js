import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { openConversation } from './session-factory.js';
import { createSessionLifecycle } from './session-lifecycle.js';
import { summarizeArchive } from './archive-summary.js';

export async function createSessionPool(base, model, options = {}) {
  const modelRuntime = await ModelRuntime.create();
  const resolvedModel = model ? modelRuntime.getModel(model.provider, model.id) : undefined;
  if (model && !resolvedModel) throw new Error('configured_model_not_found');
  const lifecycle = createSessionLifecycle(base, {
    ...options,
    createSession: (dir, tools, summary) => openConversation(modelRuntime, resolvedModel, dir, tools, summary, {
      customTools: tools === 'all' ? options.getCustomTools?.(dir) || [] : [],
      getSenderHeader: options.getSenderHeader,
    }),
    summarize: (text, dir) => summarizeArchive(modelRuntime, resolvedModel, text, dir),
  });
  // Also discover expired on-disk sessions that have not been opened since restart.
  void lifecycle.sweep();
  return { modelRuntime, ...lifecycle };
}

import { openConversation as openCoreConversation } from '../core/agent/session-factory.js';
import { promptPolicy, identityHeader } from '../adapters/lark/identity/index.js';
export function openConversation(runtime, model, dir, tools, summary, options = {}) {
  return openCoreConversation(runtime, model, dir, tools, summary, { promptPolicy, ...options,
    ...(options.getSenderHeader ? { getSenderHeader: () => options.getSenderHeader() || identityHeader() } : {}),
  });
}

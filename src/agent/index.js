import { createAgent as createCoreAgent } from '../core/agent/index.js';
import { createIdentityResolver, identityHeader, promptPolicy } from '../adapters/lark/identity/index.js';
export { sessionDirectory } from '../core/agent/index.js';
export function createAgent(base, model, options = {}) {
  return createCoreAgent(base, model, { resolveIdentity: createIdentityResolver(), formatIdentity: identityHeader, promptPolicy, ...options });
}

import { admitMessage } from '../core/access/index.js';
import { accessMessage } from '../adapters/lark/index.js';

export { isAdmin } from '../core/access/index.js';

// Legacy raw-event API for router, approvals and control permission checks.
export function admit(event, state) {
  return admitMessage(accessMessage(event, state.config.bot.openId), state);
}

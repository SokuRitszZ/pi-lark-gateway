import { createControls as createCoreControls } from '../core/controls/index.js';
import { normalizeAction, actionResponse } from '../adapters/lark/index.js';
export { canControlResponse } from '../core/controls/index.js';
export function createControls(options) {
  const controls = createCoreControls(options);
  return { ...controls, handle: event => actionResponse(controls.handle(normalizeAction(event))) };
}

import { normalizeAction, actionResponse } from './actions.js';
export function startIngress(connection, { route, controls, approvals, nextSteps }) {
  return connection.start({
    'im.message.receive_v1': route,
    'card.action.trigger': event => event?.action?.value?.kind === 'next_step'
      ? actionResponse(nextSteps.handle(normalizeAction(event))) : event?.action?.value?.kind === 'response_control'
      ? actionResponse(controls.handle(normalizeAction(event))) : approvals.handle(event),
  });
}

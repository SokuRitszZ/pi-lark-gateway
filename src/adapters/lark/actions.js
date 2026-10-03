export function normalizeAction(event) {
  return { value: event?.action?.value,
    actorId: event?.operator?.open_id,
    messageId: event?.context?.open_message_id || event?.open_message_id,
    eventId: event?.token || event?.event_id,
    instruction: event?.action?.form_value?.instruction };
}
export const actionResponse = result => ({ toast: result });

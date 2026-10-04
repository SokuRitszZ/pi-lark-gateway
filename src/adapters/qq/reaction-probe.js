// Experimental hypothesis only: the documented route accepts a *channel_id*,
// not a group/user openid. Never advertise this as native group/C2C support.
// One attempt per scope per runtime, only on an admitted inbound message.
export function createChannelReactionProbe(bot, log) {
  const attempted = new Set();
  return async target => {
    if (!['c2c', 'group'].includes(target.scope) || !target.msgId || attempted.has(target.scope)) return;
    attempted.add(target.scope);
    const prefix = `qq_reaction_probe_${target.scope}`;
    try {
      const token = await bot.api.getToken();
      const route = `/channels/${encodeURIComponent(target.targetId)}/messages/${encodeURIComponent(target.msgId)}/reactions/1/4`;
      await bot.apiClient.request(token, 'PUT', route, undefined, { timeoutMs: 3000 });
      log(`${prefix}_accepted`); // HTTP acceptance is not proof of visible rendering.
    } catch (error) {
      const status = Number.isInteger(error?.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599 ? `http_${error.httpStatus}` : 'failed';
      log(`${prefix}_${status}`);
    }
  };
}

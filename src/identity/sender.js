const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
const text = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, 256) || null : null;

// Only transport metadata is accepted here, never message text, mentions or history.
export function eventIdentity(message = {}) {
  return {
    source: typeof message.userId === 'string' && message.userId.startsWith('debug_') ? 'gateway_simulation' : 'feishu_gateway', message_id: id(message.id), chat_id: id(message.chatId),
    chat_type: message.isGroup ? 'group' : 'private',
    sender: { open_id: id(message.userId)?.startsWith('ou_') ? id(message.userId) : null, user_id: id(message.senderIds?.userId),
      union_id: id(message.senderIds?.unionId), tenant_key: id(message.senderIds?.tenantKey) },
    profile_status: 'unavailable', profile: { name: null, en_name: null, email: null },
  };
}

export function createIdentityResolver({ getUser, timeoutMs = 2000 } = {}) {
  return async (message, { signal } = {}) => {
    signal?.throwIfAborted();
    const identity = eventIdentity(message);
    if (!identity.sender.open_id || !getUser) return identity;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, timeoutMs);
    let onAbort;
    try {
      const expired = new Promise((_, reject) => {
        onAbort = () => reject(new Error('identity_lookup_cancelled'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      const user = await Promise.race([Promise.resolve().then(() => getUser(identity.sender.open_id, { signal: controller.signal })), expired]);
      // A mismatched record must never be attributed to the event's sender.
      if (user?.open_id !== identity.sender.open_id) return identity;
      identity.profile = { name: text(user.name), en_name: text(user.en_name), email: text(user.email) };
      identity.profile_status = 'available';
      return identity;
    } catch {
      signal?.throwIfAborted();
      return identity; // Missing permissions, timeout or API failure: no guesses or stale cache.
    } finally {
      clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort);
      signal?.removeEventListener('abort', cancel); controller.abort();
    }
  };
}

import { withResourceSignal } from './resource-context.js';

export function createUserProfiles(client) {
  return async (openId, { signal } = {}) => withResourceSignal(signal, async () => {
    signal?.throwIfAborted();
    const result = await client.contact.v3.user.get({ path: { user_id: openId }, params: { user_id_type: 'open_id' } });
    if (result?.code !== 0) throw new Error('sender_profile_unavailable');
    return result.data?.user;
  });
}

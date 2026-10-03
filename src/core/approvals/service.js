import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { writeJson } from '../storage/index.js';
import { needsApproval } from './eligibility.js';

export async function createApprovals({ file, getState, publish, refresh, getChatInfo = async () => ({}), log = () => {}, now = Date.now, acknowledgementText = '正在保存授权结果。授权后请用户重新发送消息。' }) {
  let store = { version: 1, requests: {}, grants: {} };
  try {
    store = JSON.parse(await readFile(file, 'utf8'));
    if (store.version !== 1 || !store.requests || !store.grants) throw new Error('invalid_approval_store');
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  store.blocked ??= {};
  let chain = Promise.resolve();
  const serial = fn => { const work = chain.then(fn); chain = work.catch(() => {}); return work; };
  const key = (chat, user) => `${chat}:${user}`;
  async function commit(next) { await writeJson(file, next); store = next; }
  function canDecide(r, decision) {
    if (!r) return false;
    if (['approved', 'denied'].includes(decision)) return r.status === 'pending' && r.expires > now();
    if (decision === 'revoked') return r.status === 'approved' && store.grants[key(r.chat, r.user)] === true;
    if (decision === 'blocked') return ['pending', 'approved', 'denied', 'revoked', 'unblocked'].includes(r.status) && (r.status !== 'pending' || r.expires > now());
    if (decision === 'unblocked') return r.status === 'blocked' && store.blocked[key(r.chat, r.user)] === true;
    return false;
  }
  const api = {
    isBlocked(chat, user) { return store.blocked[key(chat, user)] === true; },
    hasGrant(chat, user) { return store.grants[key(chat, user)] === true; },
    request(event, debugLabel) { return serial(async () => {
      const state = getState();
      if (!needsApproval(event, state)) return;
      const user = event.userId, chat = event.chatId;
      if (store.blocked[key(chat, user)]) return 'blocked';
      if (store.grants[key(chat, user)]) return 'already_approved';
      const existing = Object.values(store.requests).find(r => r.chat === chat && r.user === user && r.expires > now() && r.owner === state.config.access.owner && (['pending', 'delivery_failed'].includes(r.status) || r.sourceMessageId === event.id));
      if (existing) return existing.status;
      const next = structuredClone(store);
      for (const [id, r] of Object.entries(next.requests)) {
        if (r.expires <= now() && !['approved', 'blocked'].includes(r.status)) delete next.requests[id];
        else if (r.chat === chat && r.user === user) r.status = 'superseded';
      }
      if (Object.keys(next.requests).length >= 1000) { log('approval_capacity_reached'); return; }
      const request = { id: randomUUID(), user, chat, chatType: (event.isGroup ? 'group' : 'p2p'), owner: state.config.access.owner, expires: now() + 86400000, status: 'pending', sourceMessageId: event.id, ...(debugLabel ? { debugLabel } : {}) };
      if (request.chatType === 'group') {
        try {
          const info = await getChatInfo(chat);
          if (typeof info.name === 'string' && info.name) request.chatName = info.name;
          if (typeof info.url === 'string') {
            request.chatUrl = info.url; // Adapter supplies a validated platform URL.
          }
        } catch { log('approval_chat_metadata_unavailable'); }
      }
      next.requests[request.id] = request;
      await commit(next);
      try {
        const messageId = await publish(request);
        const sent = structuredClone(store); sent.requests[request.id].messageId = messageId; await commit(sent);
        log('approval_requested');
        return 'sent';
      } catch {
        const failed = structuredClone(store); failed.requests[request.id].status = 'delivery_failed';
        failed.requests[request.id].expires = now() + 60000;
        await commit(failed); log('approval_delivery_failed');
        return 'delivery_failed';
      }
    }); },
    handle(event) {
      const value = event?.value;
      const r = store.requests[value?.id];
      const state = getState();
      const valid = value?.kind === 'access_approval' && canDecide(r, value.decision)
        && event.actorId === state.config.access.owner && event.actorId === r.owner
        && r.messageId && event.messageId === r.messageId;
      if (!valid) return { type: 'error', content: '无权操作，或该请求已处理/过期。' };
      // ACK promptly; persistence and card edit happen on our serial task queue.
      void serial(async () => {
        const current = store.requests[r.id];
        if (!canDecide(current, value.decision) || current.status !== r.status || getState().config.access.owner !== r.owner) return;
        const next = structuredClone(store);
        next.requests[r.id].status = value.decision;
        if (value.decision === 'denied') next.requests[r.id].expires = now() + 86400000;
        const identity = key(r.chat, r.user);
        if (value.decision === 'approved') next.grants[identity] = true;
        if (['revoked', 'blocked', 'unblocked'].includes(value.decision)) delete next.grants[identity];
        if (value.decision === 'blocked') next.blocked[identity] = true;
        if (value.decision === 'unblocked') delete next.blocked[identity];
        await commit(next);
        await refresh(r, value.decision);
        log(`approval_${value.decision}`);
      }).catch(() => log('approval_decision_or_card_update_failed'));
      return { type: 'info', content: acknowledgementText };
    },
    async drain() { await chain; },
  };
  return api;
}

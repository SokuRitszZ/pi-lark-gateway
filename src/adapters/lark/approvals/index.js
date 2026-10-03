import { createApprovals as createCoreApprovals, needsApproval as needsCoreApproval } from '../../../core/approvals/index.js';
import { accessMessage } from '../access.js';
import { normalizeAction, actionResponse } from '../actions.js';
import { approvalCard } from './card.js';
export { approvalCard } from './card.js';

export function needsApproval(event, state) {
  return needsCoreApproval(accessMessage(event, state.config.bot.openId), state);
}

export async function createApprovals({ sendCard, updateCard, getChatInfo = async () => ({}), ...options }) {
  const core = await createCoreApprovals({ ...options,
    acknowledgementText: '正在保存，处理结果将显示在卡片上。授权后请用户重新发送消息。',
    publish: request => sendCard(request.owner, approvalCard(request)),
    refresh: (request, status) => updateCard(request.messageId, approvalCard(request, status)),
    getChatInfo: async chat => {
      const info = await getChatInfo(chat);
      const result = { name: info.name };
      try { const url = new URL(info.url); if (url.protocol === 'https:' && url.hostname === 'applink.feishu.cn') result.url = url.href; } catch {}
      return result;
    },
  });
  return { ...core,
    requestMessage: core.request,
    handleAction: core.handle,
    request: (event, label) => core.request({ ...accessMessage(event, options.getState().config.bot.openId), id: event?.message?.message_id }, label),
    handle: event => actionResponse(core.handle(normalizeAction(event))),
  };
}

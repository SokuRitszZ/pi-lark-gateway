export function approvalCard(request, status = request.status) {
  const pending = status === 'pending';
  const scope = request.chatType === 'p2p' ? '私聊' : '群聊';
  const approved = status === 'approved';
  const titles = { approved: '✅ 授权成功 · 已授权', denied: '❌ 授权拒绝 · 未授权', revoked: '已收回权限 · 未授权', blocked: '⛔ 已拉黑', unblocked: '已解除拉黑 · 未授权' };
  const descriptions = {
    approved: '✅ 已授权该用户在此会话中与机器人对话。可随时收回权限或拉黑。',
    denied: '❌ 已拒绝，未授予权限。用户再次发送新消息可重新申请。',
    revoked: '已收回审批授予的权限。白名单模式下需重新申请；不修改本地显式白名单。',
    blocked: '⛔ 此用户在此会话已被拉黑。不回应、不再问询 owner。',
    unblocked: '已解除拉黑，未恢复授权。用户可按当前策略重新申请。',
  };
  const resultText = pending ? '请求 24 小时有效。' : descriptions[status] || '该申请已被后续申请取代。';
  const button = (label, decision, type = 'default') => ({ tag: 'button', text: { tag: 'plain_text', content: label }, type,
    value: { kind: 'access_approval', id: request.id, decision } });
  const actions = pending ? [button('授权', 'approved', 'primary'), button('拒绝', 'denied', 'danger'), button('拉黑', 'blocked', 'danger')]
    : approved ? [button('收回权限', 'revoked', 'danger'), button('拉黑', 'blocked', 'danger')]
    : status === 'blocked' ? [button('解除拉黑', 'unblocked')]
    : ['denied', 'revoked', 'unblocked'].includes(status) ? [button('拉黑', 'blocked', 'danger')] : [];
  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: { title: { tag: 'plain_text', content: (request.debugLabel ? '[模拟测试] ' : '') + (pending ? `${scope}访问授权请求` : titles[status] || '申请已失效') }, template: pending ? 'orange' : approved ? 'green' : 'red' },
    elements: [
      { tag: 'div', text: { tag: 'plain_text', content: `用户：${request.debugLabel || request.user}\n会话：${request.chatName || (request.chatType === 'p2p' ? '私聊' : request.chat)}\n${request.debugLabel ? '虚拟身份测试，不查询通讯录、不授予真实用户权限。' : '授权此用户使用本会话；可用工具取决于会话配置。'}\n${resultText}` } },
      ...(actions.length || request.chatUrl ? [{ tag: 'action', actions: [
        ...actions,
        ...(request.chatUrl ? [{ tag: 'button', type: 'default',
          text: { tag: 'plain_text', content: '打开群聊' }, url: request.chatUrl }] : []),
      ] }] : []),
    ],
  };
}

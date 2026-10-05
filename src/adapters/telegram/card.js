import { formatText } from './format.js';
const divider = '────────────';
const states = {
  working: ['⏳ 正在处理', '执行进度'],
  complete: ['✅ 回复完成', '结果'],
  error: ['⚠️ 本次执行未完成', '状态说明'],
  stopped: ['⏹ 当前回复已停止', '状态说明'],
};
export function responseState(text, options, stopped = false) {
  if (stopped || (options?.error && text === '当前回复已停止。')) return 'stopped';
  return options?.error ? 'error' : 'complete';
}
export function progressCard(body = '') {
  let text = String(body).trim();
  if (!text) text = '已收到请求，正在准备回复。';
  if (text.length > 3200) text = '…前文略\n' + text.slice(-3200).replace(/^[\uDC00-\uDFFF]/, '');
  return `**${states.working[0]}**\n${divider}\n\n**${states.working[1]}**\n${text}`;
}
// Frame already-parsed pages so Markdown fences/entities survive page boundaries.
export function frameCard(page, state = 'complete', index = 0, total = 1) {
  const [title, section] = states[state] || states.complete;
  const header = formatText(`**${title}${total > 1 ? `（${index + 1}/${total}）` : ''}**\n${divider}\n\n**${section}**`);
  const prefix = header.text + '\n';
  return { text: prefix + page.text, entities: [...header.entities,
    ...page.entities.map(entity => ({ ...entity, offset: entity.offset + prefix.length }))] };
}
export function approvalTitle(status) {
  return ({ pending: '🔐 等待访问授权', approved: '✅ 已授予访问权限', denied: '⏹ 访问申请已拒绝',
    revoked: '⏹ 访问权限已撤销', blocked: '⛔ 已封禁', unblocked: '✅ 已解除封禁' })[status] || '🔐 访问授权';
}
export const cardDivider = divider;

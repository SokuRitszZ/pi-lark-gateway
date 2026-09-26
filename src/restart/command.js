import { isAdmin } from '../config/index.js';

export function isRestartCommand(event, botOpenId) {
  if (event?.sender?.sender_type !== 'user') return false;
  let text;
  try {
    const body = JSON.parse(event.message.content);
    if (event.message.message_type === 'text') text = body.text;
    else if (event.message.message_type === 'post') {
      const post = body.content ? body : body.zh_cn || body.en_us;
      const rows = (post.content || []).map(row => row.map(item => {
        if (item.tag === 'text' && typeof item.text === 'string') return item.text;
        if (item.tag === 'at' && botOpenId && item.user_id === botOpenId) return '';
        throw new Error('not_a_plain_command');
      }).join(''));
      text = [post.title || '', ...rows].filter(Boolean).join('\n');
    }
  } catch { return false; }
  if (typeof text !== 'string') return false;
  text = text.trim();
  // Strip only actual leading mentions of this bot, never display names or
  // arbitrary mention-like text embedded in a normal message.
  const keys = (event.message.mentions || []).filter(m => botOpenId && m.id?.open_id === botOpenId && typeof m.key === 'string' && m.key).map(m => m.key);
  for (;;) {
    const key = keys.find(value => text.startsWith(value));
    if (!key) break;
    text = text.slice(key.length).trimStart();
  }
  return /^\/restart(?:\s|$)/u.test(text);
}

export function createRestartCommand({ getState, canRestart, schedule, log = () => {} }) {
  return (message, event) => {
    const state = getState();
    if (!isRestartCommand(event, state.config.bot.openId)) return undefined;
    if (!isAdmin(state.config, message.userId) || !canRestart(message, state)) return '无权重启网关：仅当前 owner 或管理员可执行 /restart。';
    try {
      const job = schedule();
      return `已登记重启任务。等本条确认及所有已接收回复、收尾操作完成后，空闲延迟 ${job.delayMs}ms 再重启。`;
    } catch {
      log('restart_command_failed');
      return '重启任务登记失败，当前服务未被强制重启，请检查服务版本和运行状态。';
    }
  };
}

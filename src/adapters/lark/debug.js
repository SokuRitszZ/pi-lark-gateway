import { createHash } from 'node:crypto';

const DURATION_UNITS = new Map([
  ['ms', 1], ['毫秒', 1],
  ['s', 1000], ['sec', 1000], ['secs', 1000], ['second', 1000], ['seconds', 1000], ['秒', 1000],
  ['m', 60000], ['min', 60000], ['mins', 60000], ['minute', 60000], ['minutes', 60000], ['分', 60000], ['分钟', 60000],
  ['h', 3600000], ['hr', 3600000], ['hrs', 3600000], ['hour', 3600000], ['hours', 3600000], ['小时', 3600000],
]);
const MAX_DEBUG_SLEEP_MS = 10 * 60 * 1000;

export function parseDebugDuration(input) {
  const match = String(input || '').trim().match(/^(\d+(?:\.\d+)?)[ \t]*(ms|毫秒|s|sec|secs|second|seconds|秒|m|min|mins|minute|minutes|分|分钟|h|hr|hrs|hour|hours|小时)?$/i);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  const multiplier = DURATION_UNITS.get(unit);
  const ms = Math.round(value * multiplier);
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > MAX_DEBUG_SLEEP_MS) return null;
  return ms;
}

// Transform one owner's message; never persist an assumed identity across messages.
export function transformDebugEvent(event, owner) {
  if (!['text', 'post'].includes(event?.message?.message_type)) return { event };
  let text;
  try {
    const content = JSON.parse(event.message.content);
    if (event.message.message_type === 'text') text = content.text;
    else {
      const post = content.content ? content : content.zh_cn || content.en_us;
      text = [post?.title, ...(post?.content || []).map(row => row.map(item => item.tag === 'at' ? '' : item.text || '').join(''))].filter(Boolean).join('\n');
    }
  } catch { return { event }; }
  if (typeof text !== 'string') return { event };
  for (const mention of event.message.mentions || []) text = text.replaceAll(mention.key, '');
  text = text.trim();
  if (!/^[ \t]*\/debug(?:[ \t]|$)/m.test(text)) return { event };
  if (!owner || event.sender?.sender_type !== 'user' || event.sender?.sender_id?.open_id !== owner) return { denied: true };
  const commands = [...text.matchAll(/^[ \t]*\/debug[^\r\n]*/gm)];
  if (commands.length !== 1) return { error: '用法：/debug assume <用户名或邮箱> 或 /debug sleep <时长>。仅 owner 可用。' };
  const directive = commands[0][0].trim();
  const assume = directive.match(/^\/debug[ \t]+assume[ \t]+(.+)$/);
  if (assume) {
    const label = assume[1].trim();
    const body = text.replace(commands[0][0], '').trim();
    if (!label || label.length > 200 || /[\x00-\x1f]/.test(label) || !body) {
      return { error: '用法：首行 /debug assume <用户名或邮箱>，换行后填写正常问题。仅本条消息模拟身份。' };
    }
    const user = 'debug_' + createHash('sha256').update(label.toLowerCase()).digest('hex');
    return { event: { ...event,
      sender: { sender_type: 'user', sender_id: { open_id: user } },
      message: { ...event.message, message_type: 'text', content: JSON.stringify({ text: body }) },
    }, debugLabel: label };
  }
  const sleep = directive.match(/^\/debug[ \t]+sleep[ \t]+(.+)$/);
  if (sleep && text.replace(commands[0][0], '').trim() === '') {
    const sleepMs = parseDebugDuration(sleep[1]);
    if (sleepMs === null) return { error: '用法：/debug sleep <时长>，例如 500ms、3s、2m；最大 10m。' };
    return { event: { ...event, debug: { ...(event.debug || {}), sleepMs },
      message: { ...event.message, message_type: 'text', content: JSON.stringify({ text: `debug sleep ${sleepMs}ms` }) },
    }, debugSleepMs: sleepMs };
  }
  return { error: '用法：/debug assume <用户名或邮箱> 或 /debug sleep <时长>。仅 owner 可用。' };
}

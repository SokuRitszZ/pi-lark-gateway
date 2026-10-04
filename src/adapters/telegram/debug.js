import { createHash } from 'node:crypto';
import { parseDebugDuration } from '../../core/commands/index.js';
export function transformDebugMessage(message, owner) {
  if (message.command !== 'debug') return { message };
  if (!owner || message.userId !== owner) return { denied: true };
  const input = message.instruction, usage = '仅 owner：/debug sleep 500ms（最大 10m）；或首行 /debug assume 标签，换行后写问题。只模拟权限主体，不伪造 Telegram 用户身份。';
  const sleep = input.match(/^sleep[ \t]+([^\r\n]+)$/);
  if (sleep) {
    const duration = parseDebugDuration(sleep[1]);
    return duration === null ? { error: usage } : { message: { ...message, command: undefined, debugSleepMs: duration, text: `debug sleep ${duration}ms` } };
  }
  const assume = input.match(/^assume[ \t]+([^\r\n]+)[\r\n]+([\s\S]+)$/);
  if (!assume) return { error: usage };
  const label = assume[1].trim(), text = assume[2].trim();
  if (!label || label.length > 200 || /[\x00-\x1f]/.test(label) || !text || /^[ \t]*\/debug(?:[ \t]|$)/m.test(text)) return { error: usage };
  const subject = 'debug_' + createHash('sha256').update(label.toLowerCase()).digest('hex');
  const key = JSON.parse(message.key); key[key.length - 1] = subject;
  const identity = structuredClone(message.identity);
  identity.Telegram.simulation = { label, policy_subject_id: subject };
  // Real Telegram sender IDs remain untouched. The synthetic subject is policy/session-only.
  return { message: { ...message, userId: subject, key: JSON.stringify(key), identity, command: undefined, text, debugLabel: label } };
}

const DURATION_UNITS = new Map([
  ['ms', 1], ['毫秒', 1],
  ['s', 1000], ['sec', 1000], ['secs', 1000], ['second', 1000], ['seconds', 1000], ['秒', 1000],
  ['m', 60000], ['min', 60000], ['mins', 60000], ['minute', 60000], ['minutes', 60000], ['分', 60000], ['分钟', 60000],
  ['h', 3600000], ['hr', 3600000], ['hrs', 3600000], ['hour', 3600000], ['hours', 3600000], ['小时', 3600000],
]);
export function parseDebugDuration(input) {
  const match = String(input || '').trim().match(/^(\d+(?:\.\d+)?)[ \t]*(ms|毫秒|s|sec|secs|second|seconds|秒|m|min|mins|minute|minutes|分|分钟|h|hr|hrs|hour|hours|小时)?$/i);
  if (!match) return null;
  const ms = Math.round(Number(match[1]) * DURATION_UNITS.get((match[2] || 's').toLowerCase()));
  return Number.isSafeInteger(ms) && ms >= 0 && ms <= 10 * 60 * 1000 ? ms : null;
}

// Whitelist operation fields; never serialize argument objects or tool results.
const fields = {
  bash: ['command'], powershell: ['command'],
  read: ['path'], write: ['path'], edit: ['path'], ls: ['path'],
  grep: ['pattern', 'path'], find: ['pattern', 'path'],
  web_search: ['query'],
};
const sensitive = /\b(?:[\w-]*(?:token|secret|password|passwd|credential|api[_-]?key|private[_-]?key)[\w-]*|authorization|cookie|bearer|basic)\b|(?:^|\s)(?:-u|--user|--username)(?:=|\s)|(?:gh[pousr]_|github_pat_|sk-)[A-Za-z0-9_-]{8,}|https?:\/\/[^\s/]*@|-----BEGIN/i;

export function toolPreview(name, args) {
  if (!args || typeof args !== 'object') return '';
  const keys = fields[String(name).split('.').at(-1)] || [];
  const text = keys.map(key => typeof args[key] === 'string' ? args[key] : '').filter(Boolean).join(' ');
  // Keep the full operation and its formatting, but suppress credential-bearing
  // operations and render control bytes visibly instead of executing them.
  if (sensitive.test(text)) return '敏感操作已隐藏';
  return text.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,
    char => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

export function operationBlock(text) {
  let ticks = 2, tildes = 2;
  for (const match of text.matchAll(/`+|~+/g)) {
    if (match[0][0] === '`') ticks = Math.max(ticks, match[0].length);
    else tildes = Math.max(tildes, match[0].length);
  }
  const fence = ticks <= tildes ? '`'.repeat(ticks + 1) : '~'.repeat(tildes + 1);
  return `${fence}text\n${text}\n${fence}`;
}

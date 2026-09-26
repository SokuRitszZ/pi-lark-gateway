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
  // Suppress the entire operation when it looks credential-bearing. Do this
  // BEFORE truncation so a sensitive flag after character 100 still protects it.
  const normalized = text.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/gu, ' ').trim();
  if (sensitive.test(normalized)) return '敏感操作已隐藏';
  return Array.from(normalized).slice(0, 100).join('');
}

export const escapePreview = text => text.replace(/[\\`*_{}\[\]()<>!#|]/g, '\\$&');

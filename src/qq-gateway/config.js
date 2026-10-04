import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const defaultConfigPath = () => process.env.PI_QQ_CONFIG || path.join(os.homedir(), '.config/pi-qq-gateway/config.json');
export const exampleConfig = {
  appId: 'REPLACE_APP_ID', transport: 'webhook',
  webhook: { host: '127.0.0.1', port: 8080, path: '/qq/callback' },
  model: { provider: 'REPLACE_PROVIDER', id: 'REPLACE_MODEL_ID' },
  tools: 'none', replyFormat: 'markdown', answerTimeoutMs: 90000,
  access: { c2cUsers: [], groups: {} },
};
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function validateConfig(value, { discover = false } = {}) {
  const fail = field => { throw new Error(`invalid_config:${field}`); };
  if (!value || !validId(value.appId) || value.appId.startsWith('REPLACE')) fail('appId');
  if (!['webhook', 'websocket'].includes(value.transport)) fail('transport');
  if (!['none', 'all'].includes(value.tools)) fail('tools');
  if (value.replyFormat !== undefined && !['markdown', 'text'].includes(value.replyFormat)) fail('replyFormat');
  if (!Number.isSafeInteger(value.answerTimeoutMs) || value.answerTimeoutMs < 1000 || value.answerTimeoutMs > 120000) fail('answerTimeoutMs');
  if (!discover && (!value.model || typeof value.model.provider !== 'string' || !value.model.provider || typeof value.model.id !== 'string' || !value.model.id || Object.values(value.model).some(v => String(v).startsWith('REPLACE')))) fail('model');
  const access = value.access;
  if (!access || !Array.isArray(access.c2cUsers) || !access.c2cUsers.every(validId) || !access.groups || Array.isArray(access.groups) || typeof access.groups !== 'object') fail('access');
  for (const [group, users] of Object.entries(access.groups)) {
    if (!validId(group) || !Array.isArray(users) || !users.every(validId)) fail('access.groups');
  }
  if (!discover && !access.c2cUsers.length && !Object.values(access.groups).some(users => users.length)) fail('empty_allowlist');
  if (value.transport === 'webhook') {
    const w = value.webhook;
    if (!w || !['127.0.0.1', '::1'].includes(w.host) || !Number.isInteger(w.port) || w.port < 1 || w.port > 65535 || typeof w.path !== 'string' || !/^\/[A-Za-z0-9/_-]+$/.test(w.path)) fail('webhook');
  }
  return structuredClone(value);
}
export async function loadConfig(file = defaultConfigPath(), options) {
  return validateConfig(JSON.parse(await fs.readFile(file, 'utf8')), options);
}
export async function initConfig(file = defaultConfigPath()) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, JSON.stringify(exampleConfig, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
export async function loadCredentials(config, file = defaultConfigPath(), env = process.env) {
  if (env.QQBOT_APP_SECRET) return credentials(env);
  const name = config.credentialsFile;
  if (typeof name !== 'string' || !/^credentials-[A-Za-z0-9-]+\.json$/.test(name)) throw new Error('missing_QQBOT_APP_SECRET');
  const target = path.join(path.dirname(file), name);
  const stat = await fs.lstat(target);
  if (!stat.isFile() || (stat.mode & 0o077)) throw new Error('invalid_config:credentials_permissions');
  const value = JSON.parse(await fs.readFile(target, 'utf8'));
  return credentials({ QQBOT_APP_SECRET: value.appSecret });
}

export function credentials(env = process.env) {
  const secret = env.QQBOT_APP_SECRET;
  if (typeof secret !== 'string' || !secret.trim()) throw new Error('missing_QQBOT_APP_SECRET');
  return secret;
}

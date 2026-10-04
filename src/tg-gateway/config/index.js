import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { validatePolicy } from '../../config/index.js';
export const defaultConfigPath = () => process.env.PI_TG_CONFIG || path.join(os.homedir(), '.config/pi-tg-gateway/config.json');
export const dataDirectory = botId => path.join(os.homedir(), '.local/share/pi-tg-gateway', botId);
const userId = value => typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value);
export const exampleConfig = {
  version: 1, botId: 'REPLACE_BOT_ID', transport: 'polling', model: null, answerTimeoutMs: 120000,
  access: { owner: null, admins: [],
    private: { enabled: true, users: 'allowlist', allowedUsers: [], trigger: 'all', tools: 'none', onUnknown: 'ask_owner' },
    groups: { enabled: true, users: 'allowlist', allowedUsers: [], trigger: 'mention', tools: 'none', onUnknown: 'ask_owner' },
  }, groups: {},
};
export function validateConfig(c, { discover = false } = {}) {
  const check = (ok, field) => { if (!ok) throw new Error(`invalid_config:${field}`); };
  check(c?.version === 1 && userId(c.botId), 'botId');
  check(['polling', 'webhook'].includes(c.transport), 'transport');
  check(c.model === null || (typeof c.model?.provider === 'string' && !!c.model.provider && typeof c.model?.id === 'string' && !!c.model.id), 'model');
  check(Number.isSafeInteger(c.answerTimeoutMs) && c.answerTimeoutMs >= 1000 && c.answerTimeoutMs <= 2147483647, 'answerTimeoutMs');
  check(c.access && (userId(c.access.owner) || (discover && c.access.owner === null)), 'owner');
  check(Array.isArray(c.access.admins) && c.access.admins.every(userId), 'admins');
  const policy = p => { validatePolicy(p); check(p.allowedUsers.every(userId), 'allowedUsers'); };
  policy(c.access.private); policy(c.access.groups);
  check(c.groups && typeof c.groups === 'object' && !Array.isArray(c.groups), 'groups');
  for (const [id, p] of Object.entries(c.groups)) { check(/^-?[1-9]\d{0,15}$/.test(id), 'groupId'); policy(p); }
  if (c.transport === 'webhook') {
    const w = c.webhook;
    check(w && ['127.0.0.1', '::1'].includes(w.host) && Number.isInteger(w.port) && w.port > 0 && w.port < 65536, 'webhook');
    check(typeof w.path === 'string' && /^\/[A-Za-z0-9/_-]+$/.test(w.path), 'webhookPath');
    check(typeof w.url === 'string' && (() => { try { const u = new URL(w.url); return u.protocol === 'https:' && !u.username && !u.password && !u.hash && !u.search && u.pathname === w.path; } catch { return false; } })(), 'webhookURL');
  }
  return c;
}
export async function loadConfig(file = defaultConfigPath(), options) { return validateConfig(JSON.parse(await fs.readFile(file, 'utf8')), options); }
export async function loadCredentials(config, file = defaultConfigPath(), env = process.env) {
  let saved = {};
  if (config.credentialsFile && (!env.TELEGRAM_BOT_TOKEN || (config.transport === 'webhook' && !env.TELEGRAM_WEBHOOK_SECRET))) {
    if (!/^credentials-[A-Za-z0-9-]+\.json$/.test(config.credentialsFile)) throw new Error('invalid_config:credentialsFile');
    const name = path.join(path.dirname(file), config.credentialsFile), stat = await fs.lstat(name);
    if (!stat.isFile() || (stat.mode & 0o077)) throw new Error('tg_credentials_permissions');
    saved = JSON.parse(await fs.readFile(name, 'utf8'));
  }
  const token = env.TELEGRAM_BOT_TOKEN || saved.token, webhookSecret = env.TELEGRAM_WEBHOOK_SECRET || saved.webhookSecret;
  if (typeof token !== 'string' || !/^[1-9]\d{0,15}:[A-Za-z0-9_-]{20,200}$/.test(token) || token.split(':')[0] !== config.botId) throw new Error('tg_credentials_invalid');
  if (config.transport === 'webhook' && (typeof webhookSecret !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(webhookSecret))) throw new Error('tg_webhook_secret_missing');
  return { token, webhookSecret };
}
export function publicError(error) {
  const text = error?.message || '';
  if (/^(invalid_config:[A-Za-z_]+|tg_[a-z_]+|configured_model_not_found)$/.test(text)) return text;
  if (error?.code === 'EEXIST') return 'tg_config_exists: existing file was not overwritten';
  if (error?.code === 'ENOENT') return 'tg_config_missing: run pi-gateway tg setup';
  return 'tg_operation_failed: check config, credentials, proxy and Bot API permissions; raw details withheld';
}

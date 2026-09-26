import { assert, validateConfig, validatePolicy } from './schema.js';
import { writeJson } from '../storage/index.js';
import { unlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

export const defaultConfigPath = () => path.join(os.homedir(), '.config/pi-lark-gateway/config.json');
export const openPolicy = () => ({ enabled: true, users: 'all', allowedUsers: [], trigger: 'all', tools: 'none' });
export function makeConfig(credentials, credentialsFile = 'credentials.json') {
  return {
    version: 2,
    bot: { appId: credentials.appId, domain: credentials.domain, name: null, openId: null,
      credentialsFile, connectionMode: 'websocket' },
    access: { owner: credentials.ownerOpenId || null, admins: [], private: { ...openPolicy(), users: 'allowlist', onUnknown: 'ask_owner' },
      groups: { ...openPolicy(), users: 'allowlist', trigger: 'mention', onUnknown: 'ask_owner' } },
    session: { private: 'chat', group: 'thread' }, model: null,
  };
}
export async function saveConfig(file, credentials) {
  // Unique credential reference makes multi-profile configuration safe.
  const name = `credentials-${randomUUID()}.json`;
  const secretPath = path.join(path.dirname(file), name);
  await writeJson(secretPath, { appId: credentials.appId, appSecret: credentials.appSecret }, { exclusive: true });
  try { await writeJson(file, makeConfig(credentials, name), { exclusive: true }); }
  catch (error) { await unlink(secretPath); throw error; }
}
export async function migrateConfig(file) {
  const old = JSON.parse(await readFile(file, 'utf8'));
  if (old.version === 2) return validateConfig(old);
  assert(old.version === 1 && old.lark?.appId && old.lark?.appSecret, 'legacy');
  const name = `credentials-${randomUUID()}.json`;
  const c = makeConfig({ ...old.lark, ownerOpenId: old.access?.allowedUsers?.[0] }, name);
  validateConfig(c);
  // v1 runtime intentionally ignored the stored legacy access fields: preserve actual open access.
  c.access.private = openPolicy(); c.access.groups = openPolicy();
  await writeJson(path.join(path.dirname(file), name), { appId: old.lark.appId, appSecret: old.lark.appSecret }, { exclusive: true });
  await writeJson(file, c);
  return c;
}
export async function loadConfig(file = defaultConfigPath()) {
  const config = validateConfig(JSON.parse(await readFile(file, 'utf8')));
  const secret = JSON.parse(await readFile(path.resolve(path.dirname(file), config.bot.credentialsFile), 'utf8'));
  assert(secret.appId === config.bot.appId && typeof secret.appSecret === 'string' && secret.appSecret.length > 0, 'credentials');
  let groups = {};
  try {
    const data = JSON.parse(await readFile(path.join(path.dirname(file), 'groups.json'), 'utf8'));
    assert(data.version === 1 && data.groups && typeof data.groups === 'object' && !Array.isArray(data.groups), 'groups');
    groups = data.groups;
    for (const p of Object.values(groups)) validatePolicy(p);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { config, secret, groups };
}

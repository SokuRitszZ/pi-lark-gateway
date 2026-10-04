import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, randomBytes } from 'node:crypto';
import { createUI } from '../cli/index.js';
import { createTransport } from '../adapters/telegram/index.js';
import { defaultConfigPath, dataDirectory, exampleConfig, validateConfig, loadConfig, loadCredentials } from './config/index.js';
import { startGateway } from './gateway.js';
async function save(file, config) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); await fs.rename(temp, file); }
  finally { await fs.unlink(temp).catch(() => {}); }
}
async function ensureStopped(botId) {
  try { await fs.lstat(path.join(dataDirectory(botId), 'runtime.lock')); throw new Error('tg_account_locked'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
export async function collectIdentities({ file, ask, say = console.log, start = startGateway, progress = (_label, task) => task() }) {
  const config = await loadConfig(file, { discover: true }), original = await fs.readFile(file, 'utf8');
  const seen = new Map(); let gateway;
  try {
    gateway = await progress('连接 Telegram，等待身份识别入口就绪', () => start({ configPath: file, discover: true, onIdentity: identity => {
      const data = identity.Telegram, key = JSON.stringify([data.chat_id, data.sender.user_id]);
      if (seen.size < 20) seen.set(key, data);
    } }));
    say('请私聊机器人发送 /start；要添加群成员，也可在群发送 /ask@机器人用户名。不会调用模型或回复。');
    await ask('发送后按 Enter，查看已收到的身份');
  } finally { await gateway?.close(); }
  const entries = [...seen.values()];
  if (!entries.length) { say('未收到身份，未修改授权。检查 BotFather 隐私模式、代理或 webhook。'); return false; }
  if (!config.access.owner) {
    const candidates = entries.filter(e => e.chat_type === 'private');
    if (!candidates.length) { say('首次 owner 必须先私聊机器人 /start。'); return false; }
    const choice = await ask('选择你自己的私聊身份作为 owner', false, { kind: 'select', options: candidates.map((e, i) => ({ value: String(i), label: e.sender.user_id })) });
    const selected = candidates[Number(choice)]; if (!selected) throw new Error('invalid_config:selection');
    if ((await ask('确认该身份为 owner？可审批其他用户访问', false, { kind: 'confirm' })) !== 'y') return false;
    config.access.owner = selected.sender.user_id;
  } else {
    const choice = await ask('选择明确授权的私聊用户/群成员', false, { kind: 'multiselect', options: entries.map((e, i) => ({ value: String(i), label: `${e.chat_type} · ${e.chat_id} · ${e.sender.user_id}` })) });
    if (!choice) return false;
    const selected = choice.split(',').map(n => entries[Number(n)]);
    if (selected.some(e => !e)) throw new Error('invalid_config:selection');
    if ((await ask('确认授权？群覆盖策略保持工具关闭', false, { kind: 'confirm' })) !== 'y') return false;
    for (const e of selected) {
      if (e.chat_type === 'private') config.access.private.allowedUsers = [...new Set([...config.access.private.allowedUsers, e.sender.user_id])];
      else {
        const prior = config.groups[e.chat_id] || config.access.groups;
        config.groups[e.chat_id] = { ...prior, enabled: true, users: 'allowlist', tools: 'none', allowedUsers: [...new Set([...prior.allowedUsers, e.sender.user_id])] };
      }
    }
  }
  await ensureStopped(config.botId);
  if (await fs.readFile(file, 'utf8') !== original) throw new Error('tg_config_changed');
  validateConfig(config); await save(file, config); return true;
}
export async function setupTelegram({ file = defaultConfigPath(), ask, say = console.log, probe = createTransport, start = startGateway, progress = (_label, task) => task() } = {}) {
  let previous;
  try { previous = JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('invalid_config:existing'); }
  if (previous && await ask('配置已存在，确认重新配置？不会自动覆盖运行中的账号', false, { kind: 'confirm' }) !== 'y') return false;
  const token = (await ask('BotFather Bot Token（仅保存在本机私有文件）', true, { validate: value => /^[1-9]\d{0,15}:[A-Za-z0-9_-]{20,200}$/.test(value || '') ? undefined : '请输入 BotFather 提供的完整 token' })).trim();
  if (!/^[1-9]\d{0,15}:[A-Za-z0-9_-]{20,200}$/.test(token)) throw new Error('tg_credentials_invalid');
  const config = structuredClone(exampleConfig); config.botId = token.split(':')[0];
  await ensureStopped(config.botId); if (previous?.botId) await ensureStopped(previous.botId);
  config.transport = await ask('连接方式', false, { kind: 'select', initialValue: 'polling', options: [
    { value: 'polling', label: 'Long polling', hint: '推荐：无需公网回调' }, { value: 'webhook', label: 'Webhook', hint: '需公网 HTTPS，额外注册回调' },
  ] });
  let model = previous?.model;
  if (!model) try { const settings = JSON.parse(await fs.readFile(path.join(os.homedir(), '.pi/agent/settings.json'), 'utf8')); if (settings.defaultProvider && settings.defaultModel) model = { provider: settings.defaultProvider, id: settings.defaultModel }; } catch {}
  const provider = (await ask('模型 Provider（留空使用 Pi 默认）', false, { defaultValue: model?.provider })).trim();
  const modelId = provider ? (await ask('模型 ID', false, { defaultValue: model?.id, validate: value => value?.trim() || model?.id ? undefined : '请输入模型 ID' })).trim() : '';
  config.model = provider ? { provider, id: modelId } : null;
  if (previous?.botId === config.botId) { config.access = previous.access; config.groups = previous.groups; }
  const secret = { token, webhookSecret: randomBytes(24).toString('base64url') };
  if (config.transport === 'webhook') {
    const url = (await ask('公网 HTTPS 回调 URL，例如 https://example.com/tg/callback')).trim();
    let parsed; try { parsed = new URL(url); } catch { throw new Error('invalid_config:webhookURL'); }
    const port = Number(await ask('本地回调端口', false, { defaultValue: '8081' }));
    config.webhook = { host: '127.0.0.1', port, path: parsed.pathname, url };
  }
  validateConfig(config, { discover: true });
  const transport = probe(config, secret);
  try { await progress('验证 Telegram bot 凭据', () => transport.probe(), '凭据检查完成，尚未启动网关'); } finally { await transport.close(); }
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  config.credentialsFile = `credentials-${randomUUID()}.json`;
  await fs.writeFile(path.join(path.dirname(file), config.credentialsFile), JSON.stringify(secret) + '\n', { flag: 'wx', mode: 0o600 });
  await save(file, config);
  say('基础配置已保存。凭据文件是 0600 本地明文，不是加密；模型授权使用本机 Pi。环境变量可覆盖凭据。');
  if (config.transport === 'webhook') { say('先完成 HTTPS 转发，再运行 pi-gateway tg webhook-register；owner 尚未确认时，随后 authorize。'); return false; }
  if (await ask('现在通过消息识别 owner / 补充白名单？', false, { kind: 'confirm', initialValue: true }) === 'y') return collectIdentities({ file, ask, say, start, progress });
  return !!config.access.owner;
}
export async function promptSetupTelegram(file, authorizeOnly = false) {
  const ui = createUI(); ui.intro(authorizeOnly ? 'Pi Gateway · Telegram 授权' : 'Pi Gateway · Telegram 初始化');
  ui.note('创建 BotFather 机器人 → token → 模型 → 发送 /start → 确认 owner\n默认工具关闭；不会自动批准第一个陌生人。', '接入步骤');
  const options = { file, ask: ui.ask, say: ui.info, progress: ui.progress };
  const ready = await (authorizeOnly ? collectIdentities(options) : setupTelegram(options));
  ui.outro(ready ? '配置已保存 · pi-gateway tg check / start（自定义配置沿用 --config）' : '仍需按上方提示完成注册/授权，或本次未新增授权；网关尚未启动。');
}

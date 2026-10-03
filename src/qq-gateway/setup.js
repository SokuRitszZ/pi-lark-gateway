import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createUI } from '../cli/index.js';
import { defaultConfigPath, exampleConfig, validateConfig, loadConfig } from './config.js';
import { startGateway } from './gateway.js';

async function saveConfig(file, config) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, file); }
  finally { await fs.unlink(temporary).catch(() => {}); }
}

function setupStatus(config) {
  try { validateConfig(config); return { ready: true }; }
  catch { return { ready: false }; }
}

export async function setupQQ({ file = defaultConfigPath(), ask, say = console.log, start = startGateway, modelDefaults = {}, progress = async (_label, task) => task() } = {}) {
  let existing;
  try { existing = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('invalid_config:existing'); }
  if (existing && (await ask('重新配置？同一 AppID 的白名单会保留', false, { kind: 'confirm', initialValue: false })).trim().toLowerCase() !== 'y') return;
  say('在 https://q.qq.com 创建机器人；不要把 AppSecret 发到聊天中。');
  const appId = (await ask('机器人 AppID', false, { defaultValue: existing?.appId,
    validate: value => /^[A-Za-z0-9_-]{1,128}$/.test(value?.trim() || existing?.appId || '') && !(value?.trim() || existing?.appId || '').startsWith('REPLACE') ? undefined : '请输入后台提供的 AppID' })).trim() || existing?.appId;
  const secret = (await ask('AppSecret · 仅保存到本地私有文件', true, { validate: value => value?.trim() && !/\s/.test(value.trim()) ? undefined : '密钥不可为空或包含空白' })).trim();
  if (!secret || /\s/.test(secret)) throw new Error('invalid_config:secret');
  const transport = (await ask('连接方式', false, { kind: 'select', initialValue: '2', options: [
    { value: '2', label: 'Webhook', hint: '需公网 HTTPS 回调，默认推荐' },
    { value: '1', label: 'WebSocket', hint: '免公网回调；须确认后台开放此能力' },
  ] })).trim();
  if (!['', '1', '2'].includes(transport)) throw new Error('invalid_config:transport');
  const defaultProvider = existing?.model?.provider || modelDefaults.provider;
  const defaultModel = existing?.model?.id || modelDefaults.id;
  const provider = (await ask('模型 Provider', false, { defaultValue: defaultProvider, validate: value => (value?.trim() || defaultProvider) && !(value?.trim() || defaultProvider).startsWith('REPLACE') ? undefined : '请输入已在 Pi 授权的 Provider' })).trim() || defaultProvider;
  const modelId = (await ask('模型 ID', false, { defaultValue: defaultModel, validate: value => (value?.trim() || defaultModel) && !(value?.trim() || defaultModel).startsWith('REPLACE') ? undefined : '请输入模型 ID' })).trim() || defaultModel;
  if (!provider || !modelId || provider.startsWith('REPLACE') || modelId.startsWith('REPLACE')) throw new Error('invalid_config:model');
  const config = { ...structuredClone(exampleConfig), appId, transport: transport === '1' ? 'websocket' : 'webhook',
    model: { provider, id: modelId }, access: structuredClone(existing?.appId === appId ? existing.access : exampleConfig.access) };
  if (config.transport === 'webhook') {
    const port = (await ask('本地回调端口', false, { defaultValue: '8080', validate: value => {
      const port = Number(value || 8080); return Number.isInteger(port) && port >= 1 && port <= 65535 ? undefined : '端口范围为 1–65535';
    } })).trim();
    config.webhook.port = port ? Number(port) : 8080;
    say(`将公网 HTTPS /qq/callback 转发到 http://127.0.0.1:${config.webhook.port}/qq/callback，保留原始请求体和签名头。`);
  }
  validateConfig(config, { discover: true });
  try {
    await fs.lstat(path.join(os.homedir(), '.local/share/pi-qq-gateway', config.appId, 'runtime.lock'));
    throw new Error('qq_account_locked');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const credentialsFile = `credentials-${randomUUID()}.json`;
  await fs.writeFile(path.join(path.dirname(file), credentialsFile), JSON.stringify({ appSecret: secret }) + '\n', { flag: 'wx', mode: 0o600 });
  config.credentialsFile = credentialsFile;
  const save = () => saveConfig(file, config);
  await save();
  say(`配置已保存：${file}。工具默认关闭。模型授权复用当前系统用户的 Pi 配置。`);
  say('启动时若存在 QQBOT_APP_SECRET 环境变量，将优先于本地凭据文件。');
  if ((await ask('现在连接 QQ，采集测试账号身份？', false, { kind: 'confirm', initialValue: true })).trim().toLowerCase() === 'n') return setupStatus(config);
  return collectAccess({ file, config, ask, say, start, progress, save, env: {} });
}

export async function authorizeQQ({ file = defaultConfigPath(), ask, say = console.log, start = startGateway,
  progress = async (_label, task) => task(), env = process.env } = {}) {
  const config = await loadConfig(file, { discover: true });
  say('复用现有配置与凭据；只补充你明确确认的白名单，不重填密钥。');
  if (config.transport === 'webhook') say(`请确认公网 HTTPS 回调转发至本地端口 ${config.webhook.port}；随后从 QQ 发送测试消息。`);
  return collectAccess({ file, config, ask, say, start, progress, env, save: () => saveConfig(file, config) });
}

async function collectAccess({ file, config, ask, say, start, progress, save, env }) {
  const candidates = new Map();
  let gateway;
  try {
    gateway = await progress('启动 QQ 接入，等待就绪', () => start({ configPath: file, discover: true, env, onIdentity: identity => {
      const qq = identity.QQ, key = JSON.stringify([qq.chat_type, qq.group_openid, qq.sender]);
      if (!candidates.has(key) && candidates.size < 20) {
        candidates.set(key, qq);
        // Keep asynchronous ingress quiet while the terminal prompt is active.
      }
    } }));
    say('请从自己的 QQ 私聊机器人，或在测试群 @。Webhook 可在此时去后台校验回调。此模式不调用模型、不回复。');
    await ask('发送测试消息后按 Enter，查看收到的身份', false, { placeholder: '不调用模型、不自动授权' });
  } finally { await gateway?.close(); }
  const entries = [...candidates.values()];
  if (!entries.length) { say('未收到事件，未增加授权。请检查平台权限/回调，再运行 pi-gateway qq authorize。'); return setupStatus(config); }
  const choice = (await ask('选择你确认要授权的身份（空格勾选，回车继续）', false, { kind: 'multiselect', options: entries.map((qq, i) => ({
    value: String(i + 1), label: `${qq.chat_type === 'c2c' ? '私聊' : '群聊'} · ${qq.sender.user_openid || qq.sender.member_openid}`,
    hint: qq.group_openid ? `群 ${qq.group_openid}` : '仅此私聊账号',
  })) })).trim();
  if (!choice) return setupStatus(config);
  const indexes = choice.split(',').map(s => Number(s.trim()));
  if (!indexes.every(n => Number.isInteger(n) && n >= 1 && n <= entries.length)) throw new Error('invalid_config:selection');
  const warning = config.tools === 'all' ? '当前工具为 all，授权者将可使用宿主机工具（非沙箱）' : '工具保持关闭';
  if ((await ask(`确认授权选中的身份？${warning}`, false, { kind: 'confirm', initialValue: false })).trim().toLowerCase() !== 'y') return setupStatus(config);
  for (const i of indexes) {
    const qq = entries[i - 1];
    if (qq.chat_type === 'c2c') config.access.c2cUsers = [...new Set([...config.access.c2cUsers, qq.sender.user_openid])];
    else {
      const prior = Object.hasOwn(config.access.groups, qq.group_openid) ? config.access.groups[qq.group_openid] : [];
      Object.defineProperty(config.access.groups, qq.group_openid, { value: [...new Set([...prior, qq.sender.member_openid])], enumerable: true, configurable: true, writable: true });
    }
  }
  validateConfig(config); await save();
  say('白名单已保存。运行 pi-gateway qq start，或在本机 Pi 中 /qq start。');
  return setupStatus(config);
}

export async function promptSetupQQ(file, { authorizeOnly = false } = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('invalid_config:interactive_terminal_required');
  const ui = createUI();
  ui.intro(authorizeOnly ? 'Pi Gateway · QQ 初始化白名单' : 'Pi Gateway · QQ 初始化配置');
  ui.note('凭据 → 连接与模型 → 测试身份 → 确认授权\n默认关闭工具；按 Ctrl+C 或 Esc 取消。', '接入流程');
  let modelDefaults = {};
  try {
    const settings = JSON.parse(await fs.readFile(path.join(os.homedir(), '.pi/agent/settings.json'), 'utf8'));
    modelDefaults = { provider: typeof settings.defaultProvider === 'string' ? settings.defaultProvider : undefined,
      id: typeof settings.defaultModel === 'string' ? settings.defaultModel : undefined };
  } catch {}
  const result = await (authorizeOnly ? authorizeQQ : setupQQ)({ file, modelDefaults, ask: ui.ask, say: ui.info, progress: ui.progress });
  if (!result) ui.outro('未重新配置；已有文件未改变。');
  else if (result.ready) ui.outro('本地配置与白名单已就绪 · 下一步：pi-gateway qq start（自定义配置沿用 --config）');
  else ui.outro('初始化尚未完成，暂不能启动 · 运行 pi-gateway qq authorize 完成白名单（自定义配置沿用 --config）');
}

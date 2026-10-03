import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { defaultConfigPath, exampleConfig, validateConfig } from './config.js';
import { startGateway } from './gateway.js';

export async function setupQQ({ file = defaultConfigPath(), ask, say = console.log, start = startGateway, modelDefaults = {} } = {}) {
  let existing;
  try { existing = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('invalid_config:existing'); }
  if (existing && (await ask('配置已存在。要重新配置并保留原白名单吗？[y/N] ')).trim().toLowerCase() !== 'y') return;
  say('在 https://q.qq.com 创建机器人；不要把 AppSecret 发到聊天中。');
  const appId = (await ask(`AppID${existing?.appId ? ` [${existing.appId}]` : ''}：`)).trim() || existing?.appId;
  const secret = (await ask('AppSecret（不回显，将保存在本地 0600 凭据文件）：', true)).trim();
  if (!secret || /\s/.test(secret)) throw new Error('invalid_config:secret');
  const transport = (await ask('连接方式：1 WebSocket（后台须支持，免公网） / 2 Webhook（需 HTTPS 回调）[2]：')).trim();
  if (!['', '1', '2'].includes(transport)) throw new Error('invalid_config:transport');
  const defaultProvider = existing?.model?.provider || modelDefaults.provider;
  const defaultModel = existing?.model?.id || modelDefaults.id;
  const provider = (await ask(`模型 provider [${defaultProvider || ''}]：`)).trim() || defaultProvider;
  const modelId = (await ask(`模型 ID [${defaultModel || ''}]：`)).trim() || defaultModel;
  if (!provider || !modelId || provider.startsWith('REPLACE') || modelId.startsWith('REPLACE')) throw new Error('invalid_config:model');
  const config = { ...structuredClone(exampleConfig), appId, transport: transport === '1' ? 'websocket' : 'webhook',
    model: { provider, id: modelId }, access: structuredClone(existing?.appId === appId ? existing.access : exampleConfig.access) };
  if (config.transport === 'webhook') {
    const port = (await ask('本地回调端口 [8080]：')).trim();
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
  const save = async () => {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, file); }
    finally { await fs.unlink(temporary).catch(() => {}); }
  };
  await save();
  say(`配置已保存：${file}。工具默认关闭。模型授权复用当前系统用户的 Pi 配置。`);
  say('启动时若存在 QQBOT_APP_SECRET 环境变量，将优先于本地凭据文件。');
  if ((await ask('现在连接 QQ 并采集白名单吗？[Y/n] ')).trim().toLowerCase() === 'n') return;
  const candidates = new Map();
  let gateway;
  try {
    gateway = await start({ configPath: file, discover: true, env: {}, onIdentity: identity => {
      const qq = identity.QQ, key = JSON.stringify([qq.chat_type, qq.group_openid, qq.sender]);
      if (!candidates.has(key) && candidates.size < 20) {
        candidates.set(key, qq);
        say(`候选 ${candidates.size}：${qq.chat_type} / ${qq.group_openid || '私聊'} / ${qq.sender.user_openid || qq.sender.member_openid}`);
      }
    } });
    say('请从自己的 QQ 私聊机器人，或在测试群 @。Webhook 可在此时去后台校验回调。此模式不调用模型、不回复。');
    await ask('看到候选身份后按回车继续（不要选择陌生人）：');
  } finally { await gateway?.close(); }
  const entries = [...candidates.values()];
  if (!entries.length) { say('未收到事件。配置已保存，请检查平台权限/回调后再次 setup，或运行 discover。'); return; }
  const choice = (await ask('输入要授权的候选序号，多个用逗号分隔；留空不授权：')).trim();
  if (!choice) return;
  const indexes = choice.split(',').map(s => Number(s.trim()));
  if (!indexes.every(n => Number.isInteger(n) && n >= 1 && n <= entries.length)) throw new Error('invalid_config:selection');
  if ((await ask('确认授权上述身份使用机器人（工具保持关闭）？[y/N] ')).trim().toLowerCase() !== 'y') return;
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
}

export async function promptSetupQQ(file) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('invalid_config:interactive_terminal_required');
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const rl = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
  const controller = new AbortController(); rl.on('SIGINT', () => controller.abort());
  let modelDefaults = {};
  try {
    const settings = JSON.parse(await fs.readFile(path.join(os.homedir(), '.pi/agent/settings.json'), 'utf8'));
    modelDefaults = { provider: typeof settings.defaultProvider === 'string' ? settings.defaultProvider : undefined,
      id: typeof settings.defaultModel === 'string' ? settings.defaultModel : undefined };
  } catch {}
  try {
    await setupQQ({ file, modelDefaults, ask: async (label, secret = false) => {
      process.stdout.write(label); muted = secret;
      try { return await rl.question('', { signal: controller.signal }); }
      finally { muted = false; if (secret) process.stdout.write('\n'); }
    } });
  } finally { rl.close(); }
}

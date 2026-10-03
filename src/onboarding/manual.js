import { createUI } from '../cli/index.js';
import { RegistrationError } from './registration.js';

export async function collectCredentials(ask) {
  const appId = (await ask('App ID', false, { validate: value => /^cli_[A-Za-z0-9]+$/.test(value?.trim() || '') ? undefined : '请输入 cli_ 开头的应用 ID' })).trim();
  if (!/^cli_[A-Za-z0-9]+$/.test(appId)) throw new RegistrationError('App ID 格式无效。');
  const appSecret = (await ask('App Secret', true, { validate: value => value?.trim() && !/\s/.test(value.trim()) ? undefined : '密钥不可为空或包含空白' })).trim();
  if (!appSecret || /\s/.test(appSecret)) throw new RegistrationError('App Secret 不可为空或含空白字符。');
  const ownerOpenId = (await ask('Owner open_id（此应用对应的 ou_ 开头 ID）', false, { validate: value => /^ou_[A-Za-z0-9_-]+$/.test(value?.trim() || '') ? undefined : '请输入 ou_ 开头的 owner ID' })).trim();
  if (!/^ou_[A-Za-z0-9_-]+$/.test(ownerOpenId)) throw new RegistrationError('Owner open_id 格式无效；请使用此应用对应的用户 open_id。');
  return { appId, appSecret, ownerOpenId, domain: 'feishu' };
}

export async function promptCredentials(signal) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new RegistrationError('手动配置需在交互式终端运行；请勿把密钥放入命令行参数。');
  const ui = createUI(undefined, true, signal);
  ui.intro('Pi Gateway · 飞书手动接入');
  const credentials = await collectCredentials(ui.ask);
  ui.outro('凭据已收集，继续验证并保存配置');
  return credentials;
}

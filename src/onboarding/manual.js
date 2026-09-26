import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { RegistrationError } from './registration.js';

export async function collectCredentials(ask) {
  const appId = (await ask('App ID：')).trim();
  if (!/^cli_[A-Za-z0-9]+$/.test(appId)) throw new RegistrationError('App ID 格式无效。');
  const appSecret = (await ask('App Secret（不回显）：', true)).trim();
  if (!appSecret || /\s/.test(appSecret)) throw new RegistrationError('App Secret 不可为空或含空白字符。');
  const ownerOpenId = (await ask('Owner open_id（ou_ 开头）：')).trim();
  if (!/^ou_[A-Za-z0-9_-]+$/.test(ownerOpenId)) throw new RegistrationError('Owner open_id 格式无效；请使用此应用对应的用户 open_id。');
  return { appId, appSecret, ownerOpenId, domain: 'feishu' };
}

export async function promptCredentials(signal) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new RegistrationError('手动配置需在交互式终端运行；请勿把密钥放入命令行参数。');
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk, encoding);
    callback();
  } });
  const rl = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
  const controller = new AbortController();
  rl.on('SIGINT', () => controller.abort());
  try {
    return await collectCredentials(async (label, secret = false) => {
      process.stdout.write(label);
      muted = secret;
      try { return await rl.question('', { signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal }); }
      finally { muted = false; if (secret) process.stdout.write('\n'); }
    });
  } finally { rl.close(); }
}

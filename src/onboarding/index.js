import { parseArgs } from 'node:util';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import { createRegistration, RegistrationError } from './registration.js';
import { defaultConfigPath, saveConfig } from '../config/index.js';
import { promptCredentials } from './manual.js';

const setupCommand = process.env.PI_LARK_CLI === '1' ? 'pi-lark-gateway setup' : 'npm run setup --';
const startCommand = process.env.PI_LARK_CLI === '1' ? 'pi-lark-gateway start' : 'npm start';

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    domain: { type: 'string', default: 'feishu' }, config: { type: 'string' },
    timeout: { type: 'string', default: '600' }, 'no-qr': { type: 'boolean' }, manual: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help || positionals.length === 0) {
    console.log(`用法：${setupCommand} [--manual] [--config 路径] [--timeout 秒] [--no-qr]`);
    console.log('仅支持国内飞书。--manual 安全录入已有应用凭据（密钥不回显）。');
    console.log('默认白名单审批：owner 直接使用，其他用户需 owner 审批；群聊需 @，工具默认关闭。');
    return;
  }
  if (positionals.length !== 1 || positionals[0] !== 'setup') throw new RegistrationError('目前只支持 setup 命令。');
  if (values.domain !== 'feishu') throw new RegistrationError('目前仅支持国内飞书（feishu）。');
  const timeoutSeconds = Number(values.timeout);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) throw new RegistrationError('--timeout 必须为正数。');
  const configPath = path.resolve(values.config || defaultConfigPath());
  try { await lstat(configPath); throw new RegistrationError('配置已存在，不会覆盖。请用 --config 指定新路径。'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  let credentials;
  try {
    if (values.manual) {
      credentials = await promptCredentials(controller.signal);
    } else {
      console.log('正在连接飞书注册服务…');
      const registration = createRegistration();
      const ticket = await registration.begin({ domain: values.domain, signal: controller.signal });
      console.log('\n请用飞书扫码，或打开链接，按页面提示创建并关联机器人。');
      console.log('这不是对已有应用的 OAuth 登录。关联链接请勿转发。\n');
      if (!values['no-qr']) {
        try { console.log(await QRCode.toString(ticket.url, { type: 'terminal', small: true })); }
        catch { console.log('二维码生成失败，请使用下方链接。'); }
      }
      console.log(ticket.url);
      if (ticket.userCode) console.log(`确认码：${ticket.userCode}`);
      console.log(`\n等待确认，最多 ${Math.min(timeoutSeconds, ticket.expiresIn)} 秒。Ctrl+C 取消。`);
      credentials = await registration.poll(ticket, { signal: controller.signal, timeoutSeconds });
    }
    await saveConfig(configPath, credentials);
    console.log(`\n关联完成。App ID：${credentials.appId}\n配置已保存：${configPath}（权限 600）`);
    if (!credentials.ownerOpenId) console.log('未取得用户 open_id，请在本地配置 access.owner。');
    console.log(`密钥已独立保存。默认白名单审批：owner 直接使用，其他用户需 owner 审批；群聊需 @，工具默认关闭。运行 ${startCommand} 启动网关。`);
  } catch (error) {
    if (controller.signal.aborted || error.name === 'AbortError') { console.error('\n已取消。'); process.exitCode = 130; return; }
    if (credentials) console.error('已取得应用凭据，但本地保存失败。请在开放平台保管凭据；不会打印 App Secret。');
    else if (!values.manual) console.error(`扫码失败可使用 ${setupCommand} --manual 接入已有飞书应用。`);
    throw error;
  } finally {
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
  }
}
main().catch(error => {
  // Do not dump HTTP response bodies, credentials, or request URLs on failure.
  console.error(error instanceof RegistrationError ? error.message : `初始化失败（${error.code || 'unexpected_error'}），请检查参数、网络和配置目录。`);
  process.exitCode = 1;
});

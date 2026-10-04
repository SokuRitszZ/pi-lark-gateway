#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { startGateway, defaultConfigPath, dataDirectory, loadConfig, loadCredentials, exampleConfig, publicError } from '../src/tg-gateway/index.js';
import { configureEnvironmentProxy } from '../src/runtime/network.js';
import { requestRestart, RESTART_EXIT_CODE } from '../src/restart/index.js';
configureEnvironmentProxy();
const args = process.argv.slice(2), command = args.shift();
const help = '用法：pi-gateway tg setup|authorize|init|check|discover|start|restart|status|stop|logs|webhook-register|backup [--config 路径]\nbackup 还需 --service-stopped --output /安全路径/backup.tar.gz\n统一 start 默认后台；旧 pi-tg-gateway start 为前台。Token 使用向导私有文件或 TELEGRAM_BOT_TOKEN。';
const send = value => { if (process.connected) process.send(value, () => {}); };
const log = code => { if (/^[a-z][a-z0-9_]{0,100}$/.test(code)) { console.log(new Date().toISOString(), code); send({ type: 'gateway_log', code }); } };
async function main() {
  if (!command || ['--help', '-h', 'help'].includes(command) || args.some(a => ['--help', '-h'].includes(a))) { console.log(help); return; }
  if (command === 'backup') {
    const { values } = parseArgs({ args, options: { config: { type: 'string' }, output: { type: 'string' }, 'service-stopped': { type: 'boolean' } } });
    const { backupTelegram } = await import('../src/tg-gateway/index.js');
    await backupTelegram(values.config || defaultConfigPath(), values.output, { serviceStopped: values['service-stopped'] === true });
    console.log('本地私有备份已完成，包含应用凭据与会话；不要发到聊天或公开上传。'); return;
  }
  let configPath = defaultConfigPath();
  if (args.length) { if (args.length !== 2 || args[0] !== '--config') throw new Error('invalid_config:arguments'); configPath = path.resolve(args[1]); }
  if (['setup', 'authorize'].includes(command)) { const { promptSetupTelegram } = await import('../src/tg-gateway/index.js'); await promptSetupTelegram(configPath, command === 'authorize'); return; }
  if (command === 'init') { await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 }); await fs.writeFile(configPath, JSON.stringify(exampleConfig, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); console.log('已生成模板；运行 pi-gateway tg setup 完成初始化。'); return; }
  if (['status', 'stop', 'logs'].includes(command)) { const { runServicePlan } = await import('../src/cli/service.js'); await runServicePlan({ platform: 'tg', args: [command, '--config', configPath] }); return; }
  if (command === 'check') { const config = await loadConfig(configPath); await loadCredentials(config, configPath); console.log('本地配置与凭据格式有效；不代表代理、平台或模型已连通。'); return; }
  if (command === 'restart') { const config = await loadConfig(configPath); await requestRestart(dataDirectory(config.botId)); console.log('已登记 Telegram 延迟重启；等待回复与收尾完成，尚未重启。'); return; }
  if (command === 'webhook-register') {
    const config = await loadConfig(configPath, { discover: true }), secret = await loadCredentials(config, configPath);
    const { createTransport } = await import('../src/adapters/telegram/index.js'); const transport = createTransport(config, secret);
    try { await transport.registerWebhook(); console.log('Webhook 已注册；还需启动本地网关与 HTTPS 转发。'); } finally { await transport.close(); }
    return;
  }
  if (!['start', 'discover'].includes(command)) throw new Error('invalid_config:command');
  let gateway, stopping = false, restartRequested = false;
  const stop = () => { stopping = true; void gateway?.close().catch(() => log('tg_close_failed')); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    gateway = await startGateway({ configPath, discover: command === 'discover', log,
      onIdentity: identity => console.log(JSON.stringify(identity)),
      ...(process.connected && command === 'start' ? { onRestart: () => { restartRequested = true; stop(); } } : {}),
    });
    if (stopping) await gateway.close(); else send({ type: 'gateway_ready' });
    await gateway.done;
    if (restartRequested) process.exitCode = RESTART_EXIT_CODE;
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
main().catch(async error => {
  if (error?.code === 'CLI_CANCELLED') { const { createUI } = await import('../src/cli/index.js'); createUI().cancel(); process.exitCode = 130; }
  else { const diagnostic = publicError(error); console.error(diagnostic); send({ type: 'gateway_failed', diagnostic }); process.exitCode = 1; }
});

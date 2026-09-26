import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { defaultConfigPath, loadConfig } from '../src/config/index.js';
import { requestRestart } from '../src/restart/index.js';

async function main() {
  const { values } = parseArgs({ options: { config: { type: 'string' }, 'delay-ms': { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) {
    console.log('用法：pi-lark-gateway restart [--config 路径] [--delay-ms 1000]\n登记延迟重启任务并立即返回；等待已接收回复全部发送、收尾完成和空闲延迟后，由服务管理器重新拉起。支持 macOS/Linux；不会直接 kill 或强制中断回复。');
    return;
  }
  const delayMs = values['delay-ms'] === undefined ? 1000 : Number(values['delay-ms']);
  if (!Number.isSafeInteger(delayMs) || delayMs < 250 || delayMs > 60000) throw new Error('invalid_restart_delay');
  const { config } = await loadConfig(path.resolve(values.config || process.env.PI_LARK_CONFIG || defaultConfigPath()));
  const base = path.join(os.homedir(), '.local/share/pi-lark-gateway', config.bot.appId);
  const job = await requestRestart(base, delayMs);
  console.log(`重启任务已登记（${job.id}）；等待所有已接收回复和收尾完成，空闲延迟 ${job.delayMs}ms 后重启。当前尚未重启。`);
}
main().catch(() => {
  console.error('restart_request_failed: 确认新版本网关已启动、配置正确且延迟为 250–60000ms；旧版本需先在对话结束后由服务管理器完成一次升级重启。本命令不会退回强制重启。');
  process.exitCode = 1;
});

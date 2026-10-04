import path from 'node:path';
import { defaultConfigPath as larkConfig } from '../config/index.js';
import { defaultConfigPath as qqConfig } from '../qq-gateway/config.js';
import { servicePaths, startService, restartService, serviceStatus, serviceRequest, readServiceLog } from '../runtime/service.js';

export async function runServicePlan(plan) {
  const [command, ...originalArgs] = plan.args;
  const foreground = command === 'start' && originalArgs.includes('--foreground');
  const args = foreground ? originalArgs.filter(a => a !== '--foreground') : originalArgs;
  if (plan.platform === 'lark' && command === 'restart') return false; // Existing idle/deferred restart protocol.
  if (!['start', 'restart', 'status', 'stop', 'logs'].includes(command) || args.some(a => ['--help', '-h'].includes(a))) return false;
  try {
    let configPath = plan.platform === 'qq' ? qqConfig() : process.env.PI_LARK_CONFIG || larkConfig();
    if (args.length) {
      if (args.length !== 2 || args[0] !== '--config' || !args[1]) throw new Error('用法：start|restart|status|stop|logs [--config 路径]；前台调试用 start --foreground');
      configPath = args[1];
    }
    configPath = path.resolve(configPath);
    if (foreground) {
      plan.args = plan.platform === 'qq' ? ['start', ...args] : ['start'];
      if (plan.platform === 'lark') plan.env = { PI_LARK_CONFIG: configPath };
      return false;
    }
    const paths = servicePaths(plan.platform, configPath);
    if (command === 'logs') console.log(await readServiceLog(paths));
    else if (command === 'start' || command === 'restart') {
      const result = await (command === 'restart' ? restartService : startService)({ platform: plan.platform, configPath, paths });
      console.log(`${result.alreadyRunning ? '已有后台服务' : command === 'restart' ? '后台重启完成' : '后台启动完成'}：${result.status} · PID ${result.pid}\n日志：${paths.log}\n管理：pi-gateway ${plan.platform} status / restart / stop / logs（自定义配置沿用 --config）`);
    } else {
      const status = await serviceStatus(paths);
      if (command === 'stop' && status.status !== 'stopped') {
        await serviceRequest(paths.socket, 'stop'); console.log('已请求后台服务安全停止；使用 status 确认退出。');
      } else console.log(JSON.stringify(status));
      if (status.status === 'stopped') console.log('仅查询本 CLI 管理的后台服务；前台进程、Pi 扩展或 launchd 服务不在此列表，不会自动停止它们。');
    }
    return true;
  } catch (error) { error.gatewayService = true; throw error; }
}

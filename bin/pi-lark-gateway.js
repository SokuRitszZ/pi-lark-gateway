#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { superviseCommand } from '../src/runtime/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [command = '--help', ...args] = process.argv.slice(2);
const commands = { start: 'src/index.js', setup: 'src/onboarding/index.js', doctor: 'scripts/doctor.js', backup: 'scripts/backup.js', restart: 'scripts/restart.js' };
const help = () => console.log('用法：pi-lark-gateway <start|setup|doctor|backup|restart> [参数]\n  setup [--manual]  配置国内飞书；默认白名单审批、工具关闭\n  start             启动网关（单实例）\n  doctor            本地诊断，不联网\n  backup            停服务后的私有备份\n  restart           登记任务，等回复发送完成后延迟重启\n  --version         显示版本');
if (['--help', '-h', 'help'].includes(command)) help();
else if (['--version', '-v'].includes(command)) console.log(JSON.parse(await fs.readFile(path.join(root, 'package.json'))).version);
else if (!Object.hasOwn(commands, command)) { help(); process.exitCode = 1; }
else if (command === 'start' && args.length) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) help();
  else { console.error('start 不接受参数；自定义配置请设置 PI_LARK_CONFIG。'); process.exitCode = 1; }
} else {
  // Spawn with the supported Node proxy flag; npm bin shebangs cannot portably set it.
  superviseCommand({
    spawnChild: () => spawn(process.execPath, ['--use-env-proxy', path.join(root, commands[command]), ...(command === 'setup' ? ['setup'] : []), ...args], { stdio: 'inherit', env: { ...process.env, PI_LARK_CLI: '1' } }),
    restartable: command === 'start',
    onError: () => console.error('gateway_command_failed'),
    onExit: code => { process.exitCode = code; },
  });
}

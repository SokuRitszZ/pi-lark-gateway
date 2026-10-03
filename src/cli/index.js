export const HELP = `用法：pi-gateway [lark|qq] [命令] [参数]
  无参数             交互选择平台和操作
  pi-gateway setup   选择平台并运行接入向导
  pi-gateway lark setup|start|doctor|backup|restart
  pi-gateway qq setup|start|check|discover|init [--config 路径]
  QQ setup 包含密钥安全保存、连接配置和白名单采集。
  旧 pi-lark-gateway / pi-qq-gateway 命令继续兼容。
  --help / --version`;

export async function resolveCommand(argv, ask) {
  const args = [...argv];
  let platform;
  if (['lark', 'qq'].includes(args[0])) platform = args.shift();
  else if (args[0] && args[0] !== 'setup') throw new Error('invalid_command');
  if (!platform) {
    const choice = (await ask('选择平台：1 飞书/Lark  2 QQ：')).trim().toLowerCase();
    platform = ({ '1': 'lark', lark: 'lark', '2': 'qq', qq: 'qq' })[choice];
    if (!platform) throw new Error('invalid_platform');
  }
  let command = args.shift();
  if (!command) {
    const choice = (await ask('选择操作：1 接入向导  2 启动  3 本地检查 [1]：')).trim();
    command = ({ '': 'setup', '1': 'setup', '2': 'start', '3': platform === 'lark' ? 'doctor' : 'check' })[choice];
  }
  const allowed = platform === 'lark' ? ['setup', 'start', 'doctor', 'backup', 'restart', '--help', '-h'] : ['setup', 'start', 'check', 'discover', 'init', '--help', '-h'];
  if (!allowed.includes(command)) throw new Error('invalid_command');
  return { platform, script: `bin/pi-${platform === 'lark' ? 'lark' : 'qq'}-gateway.js`, args: [command, ...args] };
}

export { createUI, UserCancelled } from './ui.js';
export async function resolveCommand(argv, ask, select) {
  const args = [...argv];
  let platform;
  if (['lark', 'qq'].includes(args[0])) platform = args.shift();
  else if (args[0] && args[0] !== 'setup') throw new Error('invalid_command');
  if (!platform) {
    const choice = select ? await select({ message: '选择消息平台', options: [
      { value: 'lark', label: '飞书 / Lark', hint: '扫码接入 · 卡片回复 · 已有功能' },
      { value: 'qq', label: 'QQ', hint: '官方机器人 · 私聊 / 群 @ · 文本首版' },
    ] }) : (await ask('选择平台：1 飞书/Lark  2 QQ：')).trim().toLowerCase();
    platform = ({ '1': 'lark', lark: 'lark', '2': 'qq', qq: 'qq' })[choice];
    if (!platform) throw new Error('invalid_platform');
  }
  let command = args.shift();
  if (!command) {
    const choice = select ? await select({ message: `${platform === 'lark' ? '飞书' : 'QQ'} · 选择操作`, options: [
      { value: '1', label: '初始化配置 / 接入向导', hint: '第一次使用或重新配置' },
      { value: '2', label: '启动网关', hint: '使用已保存的配置' },
      { value: '3', label: '本地检查', hint: '不启动连接' },
      ...(platform === 'qq' ? [{ value: '4', label: '初始化 / 补充白名单', hint: '修复 empty_allowlist · 不重填密钥' }] : []),
    ] }) : (await ask('选择操作：1 接入向导  2 启动  3 本地检查 [1]：')).trim();
    command = ({ '': 'setup', '1': 'setup', '2': 'start', '3': platform === 'lark' ? 'doctor' : 'check', '4': platform === 'qq' ? 'authorize' : undefined })[choice];
  }
  const allowed = platform === 'lark' ? ['setup', 'start', 'doctor', 'backup', 'restart', '--help', '-h'] : ['setup', 'authorize', 'start', 'check', 'discover', 'init', '--help', '-h'];
  if (!allowed.includes(command)) throw new Error('invalid_command');
  return { platform, script: `bin/pi-${platform === 'lark' ? 'lark' : 'qq'}-gateway.js`, args: [command, ...args] };
}

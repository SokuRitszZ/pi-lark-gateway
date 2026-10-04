export { createUI, UserCancelled } from './ui.js';
export async function resolveCommand(argv, ask, select) {
  const args = [...argv];
  let platform;
  if (['lark', 'qq', 'tg'].includes(args[0])) platform = args.shift();
  else if (args[0] && args[0] !== 'setup') throw new Error('invalid_command');
  if (!platform) {
    const choice = select ? await select({ message: '选择消息平台', options: [
      { value: 'lark', label: '飞书 / Lark', hint: '扫码接入 · 卡片回复 · 已有功能' },
      { value: 'qq', label: 'QQ', hint: '私聊流式 · 群聊回复' },
      { value: 'tg', label: 'Telegram', hint: 'grammY · 引用/编辑/表情 · 按钮/媒体' },
    ] }) : (await ask('选择平台：1 飞书/Lark  2 QQ  3 Telegram：')).trim().toLowerCase();
    platform = ({ '1': 'lark', lark: 'lark', '2': 'qq', qq: 'qq', '3': 'tg', tg: 'tg' })[choice];
    if (!platform) throw new Error('invalid_platform');
  }
  let command = args.shift();
  if (!command) {
    const choice = select ? await select({ message: `${platform === 'lark' ? '飞书' : platform === 'tg' ? 'Telegram' : 'QQ'} · 选择操作`, options: [
      { value: '1', label: '初始化配置 / 接入向导', hint: '第一次使用或重新配置' },
      { value: '2', label: '后台启动网关', hint: '启动后返回终端，不占用当前窗口' },
      { value: '3', label: '本地检查', hint: '不启动连接' },
      ...(platform !== 'lark' ? [{ value: '4', label: '初始化 / 补充白名单', hint: '复用配置，通过消息确认身份' }] : []),
      { value: '5', label: '后台状态', hint: '仅本 CLI 管理的服务' },
      { value: '6', label: '停止后台服务', hint: '安全关闭连接和会话' },
      { value: '7', label: '查看后台日志', hint: '最近 50 条安全诊断码' },
      { value: '8', label: '重启网关', hint: platform === 'qq' ? '安全停止旧后台，再启动' : '登记任务，空闲后延迟重启' },
    ] }) : (await ask('选择操作：1 接入向导  2 启动  3 本地检查 [1]：')).trim();
    command = ({ '': 'setup', '1': 'setup', '2': 'start', '3': platform === 'lark' ? 'doctor' : 'check', '4': platform !== 'lark' ? 'authorize' : undefined, '5': 'status', '6': 'stop', '7': 'logs', '8': 'restart' })[choice];
  }
  const allowed = platform === 'lark' ? ['setup', 'start', 'doctor', 'backup', 'restart', '--help', '-h'] : ['setup', 'authorize', 'start', 'check', 'discover', 'init', '--help', '-h'];
  allowed.push('status', 'stop', 'logs', 'restart');
  if (platform === 'tg') allowed.push('webhook-register', 'backup');
  if (!allowed.includes(command)) throw new Error('invalid_command');
  return { platform, script: `bin/pi-${platform}-gateway.js`, args: [command, ...args] };
}

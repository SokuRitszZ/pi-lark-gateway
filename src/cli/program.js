import { Command } from 'commander';
import { resolveCommand } from './index.js';

export function buildProgram({ version, ui, run }) {
  const program = new Command();
  program.name('pi-gateway').description('一个入口连接 Pi 与飞书 / QQ')
    .version(version, '-v, --version', '显示版本').helpOption('-h, --help', '显示帮助')
    .addHelpCommand('help [command]', '显示命令帮助').enablePositionalOptions().showHelpAfterError('(运行 pi-gateway --help 查看用法)')
    .exitOverride();
  const dispatch = async args => {
    const interactive = !args.length || args[0] === 'setup' || (['lark', 'qq'].includes(args[0]) && args.length === 1);
    if (interactive) ui.intro(`Pi Gateway · ${version}`);
    const plan = await resolveCommand(args, ui.ask, ui.select);
    if (interactive) ui.outro(`继续：${plan.platform === 'qq' ? 'QQ' : '飞书'} · ${plan.args[0]}`);
    return run(plan);
  };
  program.action(() => dispatch([]));
  for (const platform of ['lark', 'qq']) {
    program.command(platform).description(platform === 'lark' ? '飞书：setup / start / doctor / backup / restart' : 'QQ：setup / start / check / discover / init')
      .argument('[command]', '平台命令；省略则显示菜单').argument('[args...]', '传递给平台命令的参数')
      .allowUnknownOption().passThroughOptions()
      .action((command, args) => dispatch([platform, ...(command ? [command] : []), ...args]));
  }
  program.command('setup').description('启动交互式接入向导').argument('[args...]', '[lark|qq] 及平台配置参数')
    .allowUnknownOption().passThroughOptions()
    .action(args => {
      if (args[0] && !args[0].startsWith('-') && !['lark', 'qq'].includes(args[0])) throw new Error('invalid_platform');
      return dispatch(['lark', 'qq'].includes(args[0]) ? [args[0], 'setup', ...args.slice(1)] : ['setup', ...args]);
    });
  program.addHelpText('after', `\n示例：\n  pi-gateway                  方向键选择平台和操作\n  pi-gateway setup            选择平台并接入\n  pi-gateway qq setup          QQ 接入向导\n  pi-gateway qq start          使用已有配置启动\n  pi-gateway lark setup --manual\n\n自动化请显式指定平台和命令；旧命令仍可使用。`);
  return program;
}

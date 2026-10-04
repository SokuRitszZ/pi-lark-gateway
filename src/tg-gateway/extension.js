import { startGateway } from './gateway.js';
import { publicError } from './config/index.js';
export function registerTelegramExtension(pi, start = startGateway) {
  let gateway, chain = Promise.resolve(), shuttingDown = false;
  const enqueue = task => { const work = chain.then(task); chain = work.catch(() => {}); return work; };
  const stop = async () => { const current = gateway; gateway = undefined; await current?.close(); };
  pi.registerCommand('tg', { description: 'Telegram gateway: /tg start | stop | status (local interactive operator)',
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return; // Do not turn remote SDK prompts into local service commands.
      return enqueue(async () => {
        if (shuttingDown) return;
        let text;
        try {
          if (args.trim() === 'start') { if (!gateway || gateway.status() === 'stopped') gateway = await start(); text = 'Telegram 网关运行中；模型与配置独立于当前 Pi 会话。'; }
          else if (args.trim() === 'stop') { await stop(); text = 'Telegram 网关已停止。'; }
          else if (args.trim() === 'status') text = `Telegram: ${gateway?.status() || 'stopped'}`;
          else text = '用法：/tg start | stop | status';
        } catch (error) { text = publicError(error); }
        if (!shuttingDown) ctx.ui.notify(text, 'info');
      });
    },
  });
  pi.on('session_shutdown', () => { shuttingDown = true; return enqueue(stop); });
}
export default registerTelegramExtension;

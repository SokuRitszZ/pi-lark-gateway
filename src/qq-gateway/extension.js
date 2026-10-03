import { startGateway } from './gateway.js';
import { publicError } from './errors.js';

export function registerQQExtension(pi, start = startGateway) {
  let gateway, chain = Promise.resolve(), shuttingDown = false;
  const enqueue = task => { const work = chain.then(task); chain = work.catch(() => {}); return work; };
  const stop = async () => { const current = gateway; gateway = undefined; await current?.close(); };
  // No connections, timers or credentials are accessed from the factory.
  pi.registerCommand('qq', {
    description: 'QQ gateway: /qq start | stop | status (local operator only)',
    handler: async (args, ctx) => enqueue(async () => {
      if (shuttingDown) return;
      let text;
      try {
        switch (args.trim()) {
          case 'start':
            if (!gateway || gateway.status() === 'stopped') gateway = await start();
            text = 'QQ gateway running; configuration/model are independent of this Pi chat.'; break;
          case 'stop': await stop(); text = 'QQ gateway stopped.'; break;
          case 'status': text = `QQ gateway: ${gateway?.status() || 'stopped'}`; break;
          default: text = 'Usage: /qq start | stop | status';
        }
      } catch (error) { text = publicError(error); }
      if (ctx.hasUI && !shuttingDown) ctx.ui.notify(text, 'info');
    }),
  });
  pi.on('session_shutdown', () => { shuttingDown = true; return enqueue(stop); });
}
export default registerQQExtension;

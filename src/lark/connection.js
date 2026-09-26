import * as Lark from '@larksuiteoapi/node-sdk';

export function createConnection({ config, secret }, log) {
  const logger = { trace() {}, debug() {}, info() {}, warn() { log('lark_warning'); }, error() { log('lark_error'); } };
  const options = { appId: config.bot.appId, appSecret: secret.appSecret,
    domain: Lark.Domain.Feishu, logger };
  const client = new Lark.Client(options);
  const ws = new Lark.WSClient(options);
  let timer;
  return {
    client,
    async start(events) {
      await ws.start({ eventDispatcher: new Lark.EventDispatcher({ logger }).register(events) });
      let lastState;
      timer = setInterval(() => {
        const state = ws.getConnectionStatus().state;
        if (state !== lastState) { log(`websocket_${state}`); lastState = state; }
      }, 2000);
      timer.unref();
    },
    async close() { clearInterval(timer); await ws.close(); },
  };
}

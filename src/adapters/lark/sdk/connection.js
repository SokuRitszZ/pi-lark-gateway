import * as Lark from '@larksuiteoapi/node-sdk';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { resourceHttpInstance } from './resource-context.js';

export function createConnection({ config, secret }, log) {
  const logger = { trace() {}, debug() {}, info() {}, warn() { log('lark_warning'); }, error() { log('lark_error'); } };
  const options = { appId: config.bot.appId, appSecret: secret.appSecret,
    domain: Lark.Domain.Feishu, logger };
  const client = new Lark.Client({ ...options, httpInstance: resourceHttpInstance(Lark.defaultHttpInstance) });
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  const ws = new Lark.WSClient({ ...options,
    ...(proxy ? { agent: new HttpsProxyAgent(proxy) } : {}), handshakeTimeoutMs: 15000,
  });
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

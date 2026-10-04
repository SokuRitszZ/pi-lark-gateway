import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
export async function startWebhook(config, secret, handle, log) {
  const expected = Buffer.from(secret);
  const server = http.createServer(async (req, res) => {
    const end = status => { if (!res.writableEnded) { res.writeHead(status); res.end(); } };
    const token = req.headers['x-telegram-bot-api-secret-token'];
    const received = Buffer.from(typeof token === 'string' ? token : '');
    if (req.method !== 'POST' || req.url !== config.path) { end(404); req.resume(); return; }
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) { end(403); req.resume(); return; }
    let size = 0; const chunks = [];
    const timer = setTimeout(() => { end(408); req.destroy(); }, 10000);
    try {
      for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) { end(413); req.destroy(); return; } chunks.push(chunk); }
      let update; try { update = JSON.parse(Buffer.concat(chunks).toString()); } catch { end(400); return; }
      if (!Number.isSafeInteger(update?.update_id)) { end(400); return; }
      try { await handle(update); end(200); } catch { log('tg_webhook_update_failed'); end(500); }
    } catch { end(400); } finally { clearTimeout(timer); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, config.host, resolve); });
  return { close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }), port: server.address().port };
}

import http from 'node:http';

// QQ SDK still performs Ed25519 verification. This adds bounded I/O and replay age.
export function createWebhookServer(host = '127.0.0.1', { maxBytes = 1024 * 1024, now = Date.now } = {}) {
  let server, closed = false;
  return {
    async listen(port, callbackPath, handler) {
      if (closed) throw new Error('webhook_closed');
      server = http.createServer(async (req, res) => {
        const respond = (status, text = '') => { if (!res.writableEnded) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(text); } };
        if (req.method !== 'POST' || req.url !== callbackPath) return respond(404);
        if (Number(req.headers['content-length']) > maxBytes) { respond(413); req.resume(); return; }
        try {
          const chunks = []; let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > maxBytes) { respond(413); return; }
            chunks.push(chunk);
          }
          const body = Buffer.concat(chunks), payload = JSON.parse(body.toString('utf8'));
          if (payload?.op !== 13) {
            const stamp = req.headers['x-signature-timestamp'];
            if (typeof stamp !== 'string' || !/^\d{10}$/.test(stamp) || Math.abs(now() - Number(stamp) * 1000) > 300000) return respond(401);
          }
          const result = await handler({ body, headers: req.headers });
          respond(result.status, result.body);
        } catch { respond(400); }
      });
      server.requestTimeout = 10000; server.headersTimeout = 10000; server.timeout = 10000;
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
    },
    close() { closed = true; server?.close(); server?.closeAllConnections(); },
    address() { return server?.address(); },
  };
}

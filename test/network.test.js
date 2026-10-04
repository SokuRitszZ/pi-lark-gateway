import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs/promises';
import { getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { configureEnvironmentProxy } from '../src/runtime/network.js';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
test('shared network initialization routes fetch via env proxy and respects NO_PROXY', async () => {
  const keys = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalDispatcher = getGlobalDispatcher();
  const sockets = new Set(), dispatchers = [];
  let connects = 0;
  const target = http.createServer((_req, res) => res.end('ok'));
  const proxy = http.createServer((_req, res) => { connects++; res.end('ok'); });
  for (const server of [target, proxy]) server.on('connection', socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
  });
  await listen(target); await listen(proxy);
  proxy.on('connect', (_req, socket, head) => {
    connects++;
    const upstream = net.connect(target.address().port, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream); upstream.pipe(socket);
    });
    sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream));
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
  });
  try {
    for (const key of keys) delete process.env[key];
    process.env.HTTP_PROXY = process.env.HTTPS_PROXY = `http://127.0.0.1:${proxy.address().port}`;
    process.env.NO_PROXY = '';
    dispatchers.push(configureEnvironmentProxy());
    const response = await fetch('http://gateway-network-test.invalid/probe', { signal: AbortSignal.timeout(3000) });
    assert.equal(await response.text(), 'ok'); assert.equal(connects, 1);
    process.env.NO_PROXY = '127.0.0.1';
    dispatchers.push(configureEnvironmentProxy());
    const direct = await fetch(`http://127.0.0.1:${target.address().port}`, { signal: AbortSignal.timeout(3000) });
    assert.equal(await direct.text(), 'ok'); assert.equal(connects, 1);
  } finally {
    setGlobalDispatcher(originalDispatcher);
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    await Promise.all(dispatchers.map(dispatcher => dispatcher.destroy()));
    for (const socket of sockets) socket.destroy();
    await Promise.all([target, proxy].map(server => new Promise(resolve => server.close(resolve))));
  }
});
test('both standalone runtimes apply shared network initialization', async () => {
  for (const file of ['../src/index.js', '../bin/pi-qq-gateway.js']) {
    const source = await fs.readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /configureEnvironmentProxy\(\)/);
  }
});

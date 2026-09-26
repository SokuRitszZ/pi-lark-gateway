import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRestartScheduler } from './scheduler.js';

// Unix socket paths are capped around 104 bytes on macOS. Keep the endpoint
// short even with long HOME paths, outside persistent/backup state.
export const restartSocketPath = base => path.join('/tmp', `pi-lark-gateway-${process.getuid()}`,
  `${createHash('sha256').update(path.resolve(base)).digest('hex').slice(0, 32)}.sock`);
const limit = 4096;
async function checkDirectory(file, create = false) {
  const directory = path.dirname(file);
  if (create) await fs.mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error('unsafe_restart_directory');
}

async function removeStaleSocket(file) {
  let original;
  try { original = await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!original.isSocket() || original.uid !== process.getuid()) throw new Error('unsafe_restart_socket');
  const code = await new Promise(resolve => {
    const socket = net.createConnection(file);
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve('ACTIVE'); });
    socket.once('timeout', () => { socket.destroy(); resolve('TIMEOUT'); });
    socket.once('error', error => resolve(error.code));
  });
  if (!['ECONNREFUSED', 'ENOENT'].includes(code)) throw new Error('restart_socket_in_use');
  const current = await fs.lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (!current) return;
  if (current.ino !== original.ino || current.dev !== original.dev) throw new Error('restart_socket_changed');
  await fs.unlink(file);
}

export async function createRestartControl({ base, isIdle, restart, log = () => {} }) {
  const file = restartSocketPath(base);
  await checkDirectory(file, true);
  await removeStaleSocket(file);
  const scheduler = createRestartScheduler({ isIdle, restart, log });
  const clients = new Set();
  const server = net.createServer(socket => {
    clients.add(socket);
    socket.setTimeout(2000, () => socket.destroy());
    socket.on('error', () => {});
    socket.once('close', () => clients.delete(socket));
    let input = '', bytes = 0, handled = false;
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      if (handled) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > limit) { handled = true; socket.destroy(); return; }
      input += chunk;
      const newline = input.indexOf('\n');
      if (newline < 0) return;
      handled = true;
      try {
        const request = JSON.parse(input.slice(0, newline));
        if (request?.action !== 'restart') throw new Error('invalid_request');
        const job = scheduler.schedule(request.delayMs);
        socket.end(JSON.stringify({ ok: true, job }) + '\n');
      } catch { socket.end(JSON.stringify({ ok: false, error: 'restart_request_rejected' }) + '\n'); }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(file, () => { server.off('error', reject); resolve(); });
  });
  server.on('error', () => log('restart_control_failed'));
  try { await fs.chmod(file, 0o600); }
  catch (error) { await new Promise(resolve => server.close(resolve)); throw error; }
  return {
    async close() {
      scheduler.close();
      for (const client of clients) client.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

export async function requestRestart(base, delayMs = 1000) {
  const file = restartSocketPath(base);
  await checkDirectory(file);
  const stat = await fs.lstat(file);
  if (!stat.isSocket() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error('unsafe_restart_socket');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(file);
    const timer = setTimeout(() => done(new Error('restart_request_timeout')), 3000);
    let input = '', bytes = 0, settled = false;
    function done(error, value) {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.destroy();
      if (error) reject(error); else resolve(value);
    }
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(JSON.stringify({ action: 'restart', delayMs }) + '\n'));
    socket.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > limit) return done(new Error('invalid_restart_response'));
      input += chunk;
      const newline = input.indexOf('\n');
      if (newline < 0) return;
      try {
        const response = JSON.parse(input.slice(0, newline));
        const job = response.job;
        if (response.ok !== true || !/^[0-9a-f-]{36}$/.test(job?.id || '') || !['waiting', 'scheduled'].includes(job?.state)
          || !Number.isSafeInteger(job?.delayMs) || job.delayMs < 250 || job.delayMs > 60000) throw new Error('restart_request_rejected');
        done(null, response.job);
      } catch { done(new Error('restart_request_rejected')); }
    });
    socket.once('error', () => done(new Error('restart_control_unavailable')));
    socket.once('end', () => done(new Error('restart_control_closed')));
  });
}

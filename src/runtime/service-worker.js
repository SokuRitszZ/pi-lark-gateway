import fs from 'node:fs/promises';
import net from 'node:net';
import { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { superviseCommand } from './supervise.js';

export async function runServiceWorker({ socketPath, logPath, runtimeFile, runtimeArgs = [], env = process.env, restartable = false }) {
  process.umask(0o077);
  let state = 'starting', child, shuttingDown = false, shutdownTimer, startupTimer, queue = Promise.resolve(), diagnostic;
  const signals = new EventEmitter();
  const send = value => { if (process.connected) process.send(value, () => {}); };
  const log = code => {
    if (!/^[a-z][a-z0-9_]{0,100}$/.test(code || '')) return;
    queue = queue.then(async () => {
      const stat = await fs.stat(logPath).catch(() => null);
      if (stat?.size > 1024 * 1024) await fs.rename(logPath, `${logPath}.1`);
      await fs.appendFile(logPath, `${new Date().toISOString()} ${code}\n`, { mode: 0o600 });
    }).catch(() => {});
  };
  const stop = () => {
    if (shuttingDown) return; shuttingDown = true; state = 'stopping';
    signals.emit('SIGTERM');
    shutdownTimer = setTimeout(() => child?.kill('SIGKILL'), 15000);
    shutdownTimer.unref();
  };
  const server = net.createServer({ allowHalfOpen: true }, socket => {
    let data = ''; socket.setTimeout(2000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', chunk => {
      data += chunk;
      if (data.length > 1024) { socket.destroy(); return; }
      if (!data.includes('\n')) return;
      try {
        const { command } = JSON.parse(data);
        if (!['status', 'stop'].includes(command)) { socket.end('{"status":"invalid_command"}'); return; }
        if (command === 'stop') stop();
        socket.end(JSON.stringify({ status: state, pid: process.pid, ...(diagnostic ? { diagnostic } : {}) }));
      } catch { socket.destroy(); }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  await fs.chmod(socketPath, 0o600);
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  process.on('message', message => { if (message?.type === 'cancel') stop(); });
  process.on('disconnect', () => { if (state === 'starting') stop(); });
  superviseCommand({ signals, restartable,
    spawnChild() {
      if (!shuttingDown) state = 'starting';
      clearTimeout(startupTimer);
      startupTimer = setTimeout(() => { log('service_start_timeout'); stop(); }, 45000);
      child = fork(runtimeFile, runtimeArgs, { env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: ['--use-env-proxy'] });
      child.on('message', message => {
        if (message?.type === 'gateway_log') log(message.code);
        if (message?.type === 'gateway_failed') {
          diagnostic = typeof message.diagnostic === 'string' ? message.diagnostic.slice(0, 500) : 'gateway_start_failed';
          log('gateway_start_failed');
          const code = diagnostic.split(/[\s—]/)[0].replaceAll(':', '_');
          log(`startup_${code}`); send({ type: 'failed', diagnostic });
        }
        if (message?.type === 'gateway_ready' && !shuttingDown) {
          state = 'running'; clearTimeout(startupTimer); log('service_ready'); send({ type: 'ready' });
        }
      });
      if (shuttingDown) queueMicrotask(() => signals.emit('SIGTERM'));
      return child;
    },
    onError: () => log('service_runtime_spawn_failed'),
    onExit: () => {
      clearTimeout(startupTimer); clearTimeout(shutdownTimer); state = 'stopping'; log('service_stopped');
      void queue.then(() => server.close(() => {
        // Node removes the socket it bound. A later unlink could remove a new worker's socket.
        state = 'stopped';
        if (process.connected) process.disconnect();
      }));
    },
  });
}

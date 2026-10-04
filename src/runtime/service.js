import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export function servicePaths(platform, configPath, root = path.join(os.homedir(), '.local/share/pi-gateway/services')) {
  const key = createHash('sha256').update(`${platform}:${path.resolve(configPath)}`).digest('hex').slice(0, 20);
  return { root, socket: path.join(root, `${key}.sock`), log: path.join(root, `${key}.log`) };
}
export function serviceRequest(socketPath, command = 'status') {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath); let data = '';
    socket.setTimeout(2000, () => socket.destroy(new Error('service_control_timeout')));
    socket.on('connect', () => socket.end(`${JSON.stringify({ command })}\n`));
    socket.on('data', chunk => { data += chunk; if (data.length > 8192) socket.destroy(new Error('service_response_invalid')); });
    socket.on('error', reject);
    socket.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('service_response_invalid')); } });
  });
}
export async function serviceStatus(paths) {
  try { return await serviceRequest(paths.socket); }
  catch (error) {
    if (['ENOENT', 'ECONNREFUSED'].includes(error.code)) return { status: 'stopped', staleSocket: error.code === 'ECONNREFUSED' };
    throw error;
  }
}
export async function startService({ platform, configPath, paths = servicePaths(platform, configPath),
  workerFile = fileURLToPath(new URL('../../bin/pi-gateway-service.js', import.meta.url)), timeoutMs = 45000 }) {
  if (process.platform === 'win32') throw new Error('background_unavailable_use_foreground');
  await fs.mkdir(paths.root, { recursive: true, mode: 0o700 });
  const status = await serviceStatus(paths);
  if (status.status !== 'stopped') return { ...status, alreadyRunning: true, log: paths.log };
  // Never delete a stale socket or signal a PID we cannot prove we own.
  if (status.staleSocket) throw new Error('service_stale_socket: verify the old service has stopped before removing its socket');
  return new Promise((resolve, reject) => {
    const child = fork(workerFile, [platform, path.resolve(configPath), paths.socket, paths.log], {
      detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: ['--use-env-proxy'],
    });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (child.connected) child.disconnect(); child.unref();
      error ? reject(error) : resolve(result);
    };
    // A timeout is not readiness. Ask this exact worker to shut down, never kill a saved PID.
    const timer = setTimeout(() => {
      if (child.connected) child.send({ type: 'cancel' }, () => {});
      finish(new Error('service_start_timeout: check status/logs before retrying'));
    }, timeoutMs);
    child.once('error', () => finish(new Error('service_spawn_failed')));
    child.once('exit', () => finish(new Error('service_start_failed: check gateway logs')));
    child.on('message', message => {
      if (message?.type === 'ready') finish(null, { status: 'running', pid: child.pid, log: paths.log });
      if (message?.type === 'failed') finish(new Error(message.diagnostic || 'service_start_failed'));
    });
  });
}
export async function restartService(options, { status = serviceStatus, request = serviceRequest, start = startService,
  wait = delay, stopTimeoutMs = 20000 } = {}) {
  const paths = options.paths || servicePaths(options.platform, options.configPath);
  const previous = await status(paths);
  if (previous.status !== 'stopped') {
    await request(paths.socket, 'stop');
    const deadline = Date.now() + stopTimeoutMs;
    while (true) {
      const current = await status(paths);
      if (current.status === 'stopped') break;
      if (previous.pid && current.pid && previous.pid !== current.pid) throw new Error('service_changed_during_restart: check status before retrying');
      if (Date.now() >= deadline) throw new Error('service_stop_timeout: old instance has not stopped; no new instance started');
      await wait(200);
    }
  }
  // startService still enforces readiness, stale-socket and account-lock checks.
  return start({ ...options, paths });
}
export async function readServiceLog(paths) {
  let file;
  try {
    file = await fs.open(paths.log, 'r'); const stat = await file.stat();
    const buffer = Buffer.alloc(Math.min(stat.size, 16384));
    await file.read(buffer, 0, buffer.length, Math.max(0, stat.size - buffer.length));
    return buffer.toString().split('\n').filter(Boolean).slice(-50).join('\n');
  } catch (error) { if (error.code === 'ENOENT') return '暂无后台日志。'; throw error; }
  finally { await file?.close(); }
}

#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { runServiceWorker } from '../src/runtime/service-worker.js';
const [platform, configPath, socketPath, logPath] = process.argv.slice(2);
try {
  if (!['lark', 'qq'].includes(platform) || !configPath || !socketPath || !logPath) throw new Error('invalid_service_arguments');
  await runServiceWorker({ socketPath, logPath,
    runtimeFile: fileURLToPath(new URL(platform === 'qq' ? './pi-qq-gateway.js' : '../src/index.js', import.meta.url)),
    runtimeArgs: platform === 'qq' ? ['start', '--config', configPath] : [],
    env: { ...process.env, ...(platform === 'lark' ? { PI_LARK_CONFIG: configPath } : {}) },
    restartable: platform === 'lark',
  });
} catch {
  if (process.connected) process.send({ type: 'failed', diagnostic: 'service_worker_failed: check service socket and configuration' }, () => process.disconnect());
  process.exitCode = 1;
}

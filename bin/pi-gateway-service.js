#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { runServiceWorker } from '../src/runtime/service-worker.js';
const [platform, configPath, socketPath, logPath] = process.argv.slice(2);
try {
  if (!['lark', 'qq', 'tg'].includes(platform) || !configPath || !socketPath || !logPath) throw new Error('invalid_service_arguments');
  await runServiceWorker({ socketPath, logPath,
    runtimeFile: fileURLToPath(new URL(platform === 'lark' ? '../src/index.js' : `./pi-${platform}-gateway.js`, import.meta.url)),
    runtimeArgs: platform === 'lark' ? [] : ['start', '--config', configPath],
    env: { ...process.env, ...(platform === 'lark' ? { PI_LARK_CONFIG: configPath } : {}) },
    restartable: platform !== 'qq',
  });
} catch {
  if (process.connected) process.send({ type: 'failed', diagnostic: 'service_worker_failed: check service socket and configuration' }, () => process.disconnect());
  process.exitCode = 1;
}

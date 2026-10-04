import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { servicePaths, startService, restartService, serviceStatus, serviceRequest, readServiceLog } from '../src/runtime/service.js';

async function fixture(t, runtimeSource) {
  const root = await fs.mkdtemp('/tmp/pi-svc-');
  const configPath = path.join(root, 'config.json'), paths = servicePaths('qq', configPath, root);
  const runtimeFile = path.join(root, 'runtime.mjs'), workerFile = path.join(root, 'worker.mjs');
  await fs.writeFile(runtimeFile, runtimeSource);
  await fs.writeFile(workerFile, `import {runServiceWorker} from ${JSON.stringify(new URL('../src/runtime/service-worker.js', import.meta.url).href)};
const [, , platform, config, socketPath, logPath] = process.argv;
await runServiceWorker({socketPath,logPath,runtimeFile:${JSON.stringify(runtimeFile)}});`);
  t.after(async () => {
    try { await serviceRequest(paths.socket, 'stop'); } catch {}
    for (let n = 0; n < 100 && (await serviceStatus(paths)).status !== 'stopped'; n++) await delay(25);
    await fs.rm(root, { recursive: true, force: true });
  });
  return { platform: 'qq', configPath, paths, workerFile, timeoutMs: 5000 };
}
test('background start waits for readiness, supports status/stop and writes only safe codes', async t => {
  const options = await fixture(t, `
process.send({type:'gateway_log',code:'message_failure_network'});
process.send({type:'gateway_log',code:'private token should not be logged'});
setTimeout(()=>process.send({type:'gateway_ready'}),150);
process.on('SIGTERM',()=>process.exit(0)); setInterval(()=>{},1000);`);
  const result = await startService(options);
  assert.equal(result.status, 'running');
  assert.equal((await serviceStatus(options.paths)).status, 'running');
  assert.equal((await startService(options)).alreadyRunning, true);
  const text = await readServiceLog(options.paths);
  assert.match(text, /message_failure_network/); assert.doesNotMatch(text, /private token/);
  assert.equal((await fs.stat(options.paths.socket)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(options.paths.log)).mode & 0o777, 0o600);
  assert.equal((await serviceRequest(options.paths.socket, 'stop')).status, 'stopping');
});
test('startup error is never reported as a running service', async t => {
  const options = await fixture(t, `process.send({type:'gateway_failed',diagnostic:'invalid_config:empty_allowlist'},()=>process.exit(1));`);
  await assert.rejects(startService(options), /empty_allowlist|service_start_failed/);
});
test('startup timeout requests cleanup rather than claiming readiness', async t => {
  const options = await fixture(t, `process.on('SIGTERM',()=>process.exit(0)); setInterval(()=>{},1000);`);
  await assert.rejects(startService({ ...options, timeoutMs: 250 }), /service_start_timeout/);
  for (let i = 0; i < 100 && (await serviceStatus(options.paths)).status !== 'stopped'; i++) await delay(25);
  assert.equal((await serviceStatus(options.paths)).status, 'stopped');
});
test('restart waits for old worker exit and starts a new ready worker', async t => {
  const options = await fixture(t, `process.send({type:'gateway_ready'}); process.on('SIGTERM',()=>process.exit(0)); setInterval(()=>{},1000);`);
  const old = await startService(options);
  const next = await restartService(options);
  assert.equal(next.status, 'running'); assert.notEqual(next.pid, old.pid);
});
test('restart stop timeout never launches a replacement', async () => {
  let stop = false;
  await assert.rejects(restartService({ platform: 'qq', configPath: '/tmp/example' }, {
    status: async () => ({ status: 'running', pid: 123 }), request: async () => { stop = true; },
    start: () => assert.fail('must not overlap old process'), stopTimeoutMs: 0,
  }), /service_stop_timeout/);
  assert.equal(stop, true);
});
test('service control is scoped to platform and configuration path, not saved PIDs', () => {
  assert.notEqual(servicePaths('qq', '/tmp/a').socket, servicePaths('qq', '/tmp/b').socket);
  assert.notEqual(servicePaths('qq', '/tmp/a').socket, servicePaths('lark', '/tmp/a').socket);
});

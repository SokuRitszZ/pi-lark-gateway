import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { EventEmitter, once } from 'node:events';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { saveConfig } from '../src/config/index.js';
import { createRestartScheduler, createRestartControl, requestRestart, restartSocketPath } from '../src/restart/index.js';
import { createMessageHandler } from '../src/messages/index.js';
import { superviseCommand } from '../src/runtime/index.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const event = id => ({ sender: { sender_type: 'user', sender_id: { open_id: 'owner' } }, message: { message_id: id, chat_id: 'chat', chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text: id }) } });
function clock() {
  let time = 0, callback;
  return { now: () => time, setTimer: fn => { callback = fn; return 1; }, clearTimer: () => { callback = undefined; },
    tick(ms = 100) { time += ms; const fn = callback; callback = undefined; fn?.(); } };
}

test('restart is a coalesced delayed task, never a timeout that aborts busy output', () => {
  const time = clock(); let idle = false, restarted = 0;
  const scheduler = createRestartScheduler({ ...time, isIdle: () => idle, restart: () => restarted++ });
  const first = scheduler.schedule(1000);
  assert.equal(scheduler.schedule(2000).id, first.id);
  time.tick(600000); assert.equal(restarted, 0);
  idle = true; time.tick(); time.tick(900); assert.equal(restarted, 0);
  idle = false; time.tick(); idle = true; time.tick(); time.tick(999); assert.equal(restarted, 0);
  time.tick(1); assert.equal(restarted, 1);
  time.tick(10000); assert.equal(restarted, 1);
  assert.throws(() => scheduler.schedule(), /closed/);
});
test('invalid delay rejects and shutdown cancels the pending timer', () => {
  const time = clock(); let restarted = false;
  const scheduler = createRestartScheduler({ ...time, isIdle: () => true, restart: () => { restarted = true; } });
  for (const value of [-1, 0, 249, 60001, NaN, '1000']) assert.throws(() => scheduler.schedule(value));
  scheduler.schedule(); time.tick(); scheduler.close(); time.tick(10000);
  assert.equal(restarted, false);
});
for (const fails of [false, true]) test(`restart waits for final send, progress stop and reaction cleanup, error=${fails}`, async () => {
  const answer = deferred(), final = deferred(), stop = deferred(), reaction = deferred();
  let phase = 'answer', restarted = 0;
  const handler = createMessageHandler({
    answer: async () => { await answer.promise; if (fails) throw new Error('model failed'); return 'final'; },
    beginResponse: async () => ({ event() {}, finish: async () => { phase = 'final'; await final.promise; }, stop: async () => { phase = 'stop'; await stop.promise; } }),
    react: async () => 'reaction', removeReaction: async () => { phase = 'reaction'; await reaction.promise; }, reply: async () => {},
  });
  const time = clock(); const scheduler = createRestartScheduler({ ...time, isIdle: handler.isIdle, restart: () => { restarted++; void handler.drain(); } });
  handler.accept(event('first')); handler.accept(event('queued'));
  scheduler.schedule(250); time.tick(10000); assert.equal(restarted, 0);
  answer.resolve(); await flush(); assert.equal(phase, 'final'); time.tick(10000); assert.equal(restarted, 0);
  final.resolve(); await flush(); assert.equal(phase, 'stop'); time.tick(10000); assert.equal(restarted, 0);
  stop.resolve(); await flush(); assert.equal(phase, 'reaction'); time.tick(10000); assert.equal(restarted, 0);
  reaction.resolve(); await flush(); assert.equal(handler.isIdle(), true);
  time.tick(); time.tick(250); assert.equal(restarted, 1);
  handler.accept(event('too-late')); assert.equal(handler.isIdle(), true);
});
test('normal reply mode is busy until every output chunk promise settles', async () => {
  const sending = deferred();
  const handler = createMessageHandler({ answer: async () => 'answer', reply: () => sending.promise });
  handler.accept(event('first')); await flush(); assert.equal(handler.isIdle(), false);
  sending.resolve(); await flush(); assert.equal(handler.isIdle(), true); await handler.drain();
});
test('local control acknowledges immediately while busy, coalesces and validates requests', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'restart-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  let restarted = 0;
  const control = await createRestartControl({ base, isIdle: () => false, restart: () => restarted++ });
  t.after(() => control.close());
  assert.equal((await fs.stat(restartSocketPath(base))).mode & 0o777, 0o600);
  const first = await requestRestart(base, 250);
  assert.equal(first.state, 'waiting');
  assert.equal((await requestRestart(base, 500)).id, first.id);
  await assert.rejects(requestRestart(base, 0), /rejected/);
  await assert.rejects(createRestartControl({ base, isIdle: () => true, restart: () => restarted++ }), /in_use/);
  assert.equal(restarted, 0);
});
test('control refuses non-socket paths and unsafe socket permissions', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'restart-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const file = restartSocketPath(base);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, 'keep');
  await assert.rejects(createRestartControl({ base, isIdle: () => true, restart() {} }), /unsafe/);
  assert.equal(await fs.readFile(file, 'utf8'), 'keep');
  await fs.unlink(file);
  const control = await createRestartControl({ base, isIdle: () => false, restart() {} });
  t.after(() => control.close());
  await fs.chmod(file, 0o666); await assert.rejects(requestRestart(base), /unsafe/);
});
test('bounded control protocol rejects malformed and oversized requests without scheduling', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'restart-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const logs = [];
  const control = await createRestartControl({ base, isIdle: () => true, restart() {}, log: value => logs.push(value) });
  t.after(() => control.close());
  async function exchange(data) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(restartSocketPath(base)); let output = '';
      socket.once('connect', () => socket.write(data)); socket.on('data', chunk => { output += chunk; });
      socket.once('error', error => { if (error.code !== 'ECONNRESET') reject(error); }); socket.once('close', () => resolve(output));
    });
  }
  assert.equal(JSON.parse(await exchange('not-json\n')).ok, false);
  assert.equal(JSON.parse(await exchange('{"action":"kill"}\n')).ok, false);
  await exchange('x'.repeat(5000));
  assert.ok(!logs.includes('restart_after_output_requested'));
});
test('a crashed fixture leaves a stale socket that the next instance safely replaces', { timeout: 10000 }, async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'restart-stale-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const file = restartSocketPath(base);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import net from 'node:net'; net.createServer().listen(${JSON.stringify(file)}, () => console.log('ready'));`], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const exited = once(child, 'close'); await once(child.stdout, 'data');
  child.kill('SIGKILL'); await exited;
  assert.equal((await fs.lstat(file)).isSocket(), true);
  const control = await createRestartControl({ base, isIdle: () => false, restart() {} });
  t.after(() => control.close());
  assert.equal((await requestRestart(base)).state, 'waiting');
});
test('real CLI schedules busy fixture, returns before output, then exits only after final send', { timeout: 10000 }, async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'restart-cli-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const config = path.join(home, 'config.json'), base = path.join(home, '.local/share/pi-lark-gateway/cli_fixture');
  await saveConfig(config, { appId: 'cli_fixture', appSecret: 'fixture-only', ownerOpenId: 'ou_owner', domain: 'feishu' });
  const program = `
    import { createRestartControl } from ${JSON.stringify(new URL('../src/restart/index.js', import.meta.url).href)};
    import { createMessageHandler } from ${JSON.stringify(new URL('../src/messages/index.js', import.meta.url).href)};
    let release;
    const output = new Promise(resolve => { release = resolve; });
    const handler = createMessageHandler({ answer: async () => { await output; return 'done'; }, reply: async () => { console.log('final_sent'); } });
    handler.accept(${JSON.stringify(event('fixture'))});
    const control = await createRestartControl({ base: ${JSON.stringify(base)}, isIdle: handler.isIdle,
      restart: async () => { const drained = handler.drain(); await control.close(); await drained; process.stdout.write('restart_ready\\n', () => process.exit(75)); } });
    process.stdin.once('data', release);
    console.log('ready');
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const exited = once(child, 'close'); let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  await once(child.stdout, 'data'); assert.match(output, /ready/);
  const cli = new URL('../bin/pi-lark-gateway.js', import.meta.url);
  const result = await promisify(execFile)(process.execPath, [cli.pathname, 'restart', '--config', config, '--delay-ms', '250'], { env: { ...process.env, HOME: home }, timeout: 5000 });
  assert.match(result.stdout, /当前尚未重启/); assert.equal(child.exitCode, null); assert.doesNotMatch(output, /final_sent/);
  child.stdin.end('complete');
  assert.equal((await exited)[0], 75);
  assert.ok(output.indexOf('final_sent') < output.indexOf('restart_ready'));
  await assert.rejects(fs.lstat(restartSocketPath(base)), { code: 'ENOENT' });
});
test('CLI supervisor respawns only intentional restart exit and respects stop signals', () => {
  const signals = new EventEmitter(), children = [], exits = [];
  const spawnChild = () => { const child = new EventEmitter(); child.kill = signal => { child.killed = true; child.signal = signal; }; children.push(child); return child; };
  superviseCommand({ spawnChild, signals, restartable: true, onExit: code => exits.push(code) });
  children[0].emit('close', 75); assert.equal(children.length, 2); assert.deepEqual(exits, []);
  signals.emit('SIGTERM'); assert.equal(children[1].signal, 'SIGTERM');
  children[1].emit('close', 75); assert.equal(children.length, 2); assert.deepEqual(exits, [75]);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});
test('CLI supervisor does not loop on startup failures or non-start commands', () => {
  for (const [restartable, code] of [[true, 1], [false, 75], [true, 0]]) {
    const signals = new EventEmitter(), child = new EventEmitter(), exits = []; let launches = 0;
    superviseCommand({ spawnChild: () => { launches++; return child; }, signals, restartable, onExit: value => exits.push(value) });
    child.emit('close', code); assert.equal(launches, 1); assert.deepEqual(exits, [code]);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProgram } from '../src/cli/program.js';
import { createUI, UserCancelled } from '../src/cli/index.js';

const cli = choices => {
  const plans = [], output = [];
  const ui = { intro() {}, outro() {}, ask: () => assert.fail('use selection menus'), select: async () => choices.shift() };
  const program = buildProgram({ version: '1.2.3', ui, run: plan => plans.push(plan) });
  for (const command of [program, ...program.commands]) command.configureOutput({ writeOut: text => output.push(text), writeErr: text => output.push(text) });
  return { program, plans, output, parse: args => program.parseAsync(args, { from: 'user' }) };
};
test('Commander preserves delegated flags and paths without prompting', async () => {
  const app = cli([]); await app.parse(['qq', 'start', '--config', '/tmp/a b/config.json']);
  assert.deepEqual(app.plans[0].args, ['start', '--config', '/tmp/a b/config.json']);
});
test('Commander setup supports explicit platform or interactive selection with flags', async () => {
  const explicit = cli([]); await explicit.parse(['setup', 'lark', '--manual']);
  assert.deepEqual(explicit.plans[0].args, ['setup', '--manual']);
  const interactive = cli(['qq']); await interactive.parse(['setup', '--config', '/tmp/custom.json']);
  assert.deepEqual(interactive.plans[0].args, ['setup', '--config', '/tmp/custom.json']);
});
test('Clack platform/action selection replaces numeric typed menus', async () => {
  const app = cli(['qq', '2']); await app.parse([]);
  assert.equal(app.plans[0].platform, 'qq'); assert.deepEqual(app.plans[0].args, ['start']);
});
test('help and legacy short version exit successfully without starting resources', async () => {
  for (const args of [['--help'], ['qq', '--help'], ['help', 'qq'], ['-v']]) {
    const app = cli([]);
    await assert.rejects(app.parse(args), error => error.exitCode === 0);
    assert.equal(app.plans.length, 0); assert.ok(app.output.length);
  }
});
test('UI routes secrets only through password and keeps confirmation defaults closed', async () => {
  const calls = [];
  const ui = createUI({ isCancel: () => false,
    password: async options => { calls.push(['password', options]); return 'test-secret'; },
    text: () => assert.fail('secret must not use plain text'),
    confirm: async options => { calls.push(['confirm', options]); return false; },
    multiselect: async () => ['2', '4'],
  }, true);
  assert.equal(await ui.ask('Secret', true), 'test-secret');
  assert.equal(calls[0][1].mask, '•');
  assert.equal(await ui.ask('Authorize?', false, { kind: 'confirm' }), 'n');
  assert.equal(calls[1][1].initialValue, false);
  assert.equal(await ui.ask('Identities', false, { kind: 'multiselect', options: [] }), '2,4');
});
test('cancel and non-TTY never fall through to a default selection', async () => {
  const cancel = Symbol('cancel');
  const ui = createUI({ isCancel: value => value === cancel, select: async () => cancel }, true);
  await assert.rejects(ui.select({}), UserCancelled);
  await assert.rejects(createUI({}, false).ask('input'), /interactive_terminal_required/);
});
test('cancelling progress closes late-started resources before propagating cancellation', async () => {
  let onCancel, closed = false;
  const ui = createUI({ spinner: options => { onCancel = options.onCancel; return { start() {}, stop() {}, error() {} }; } }, true);
  await assert.rejects(ui.progress('connect', async () => { onCancel(); return { close: async () => { closed = true; } }; }), UserCancelled);
  assert.equal(closed, true);
});

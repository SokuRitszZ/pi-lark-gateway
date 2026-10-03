import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCommand } from '../src/cli/index.js';
const ask = values => async () => values.shift();
test('unified CLI dispatches explicit platforms without prompting', async () => {
  const plan = await resolveCommand(['qq', 'start', '--config', '/tmp/config.json'], () => assert.fail('no prompt'));
  assert.deepEqual(plan, { platform: 'qq', script: 'bin/pi-qq-gateway.js', args: ['start', '--config', '/tmp/config.json'] });
});
test('interactive menu selects platform and setup, or doctor', async () => {
  assert.deepEqual((await resolveCommand([], ask(['2', '']))).args, ['setup']);
  assert.deepEqual((await resolveCommand([], ask(['1', '3']))).args, ['doctor']);
  assert.deepEqual((await resolveCommand(['setup'], ask(['qq']))).args, ['setup']);
  await assert.rejects(resolveCommand(['qq', 'restart'], ask([])), /invalid_command/);
  await assert.rejects(resolveCommand([], ask(['bad'])), /invalid_platform/);
});

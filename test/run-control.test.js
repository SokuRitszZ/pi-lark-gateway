import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRunControl } from '../src/agent/run-control.js';

test('stop is idempotent and closed handles cannot abort a reused session', async () => {
  let aborts = 0, clears = 0;
  const control = createRunControl({ isIdle: false, clearQueue: () => clears++, abort: async () => aborts++ });
  await control.abort(); await control.interrupted; await control.abort();
  assert.equal(aborts, 1); assert.equal(control.canSteer(), false);
  await control.close(); await control.abort(); assert.equal(aborts, 1); assert.equal(clears, 2);
});
test('settle delayed steering before clearing queue and handing session to next turn', async () => {
  let resolve, cleared = false;
  const pending = new Promise(r => { resolve = r; });
  const control = createRunControl({ isIdle: false, steer: () => pending, clearQueue: () => { cleared = true; } });
  const steering = control.steer('new direction');
  const closed = control.close();
  assert.equal(cleared, false); assert.equal(control.canSteer(), false);
  resolve(); await steering; await closed; assert.equal(cleared, true);
  await assert.rejects(control.steer('too late'));
});

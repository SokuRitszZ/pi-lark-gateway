import { spawn } from 'node:child_process';

// AC-only assertion: displays may sleep; battery operation is not kept awake.
export function keepAwakeOnPower(log) {
  if (process.platform !== 'darwin' || process.env.PI_LARK_KEEP_AWAKE !== 'ac') return () => {};
  const child = spawn('/usr/bin/caffeinate', ['-s', '-w', String(process.pid)], { stdio: 'ignore' });
  child.once('error', () => log('keep_awake_failed'));
  child.once('spawn', () => log('keep_awake_ac_enabled'));
  return () => child.kill('SIGTERM');
}

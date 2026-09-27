import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { copySmokeSource } from './smoke-fixture.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gateway-clean-install-'));
try {
  const cwd = path.join(temp, 'source'), home = path.join(temp, 'home');
  await fs.mkdir(home);
  await copySmokeSource(root, cwd);
  // Deliberately do not inherit model/app credentials, host Pi settings or npm auth.
  const env = { HOME: home, USERPROFILE: home, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`,
    TMPDIR: os.tmpdir(), PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1',
    PI_LARK_CONFIG: path.join(home, 'missing-config.json'),
    npm_config_cache: path.join(temp, 'npm-cache'), npm_config_userconfig: path.join(home, '.npmrc'),
    npm_config_globalconfig: path.join(home, 'global.npmrc') };
  for (const key of ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  function run(command, args) {
    const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', timeout: 600000 });
    if (result.error || result.status !== 0) throw new Error('clean_install_command_failed');
  }
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  run('npm', ['run', 'verify']);
  const startup = spawnSync(process.execPath, ['--use-env-proxy', 'src/index.js'], { cwd, env, encoding: 'utf8', timeout: 30000 });
  if (startup.status !== 1 || !startup.stdout.includes('startup_failed_check_configuration_and_network')) throw new Error('missing_config_not_fail_closed');
  console.log(`Clean-home installation, tests and missing-config startup passed (${process.version}). No live model or Feishu calls made.`);
} catch {
  console.error('clean_install_smoke_failed'); process.exitCode = 1;
} finally { await fs.rm(temp, { recursive: true, force: true }); }

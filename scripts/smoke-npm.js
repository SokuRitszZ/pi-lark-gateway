import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { packSmokeFixture, checkPackageContents } from './smoke-fixture.js';

const { values } = parseArgs({ options: { artifact: { type: 'string' }, 'expected-version': { type: 'string' } } });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gateway-npm-smoke-'));
try {
  const home = path.join(temp, 'home'), prefix = path.join(temp, 'prefix'); await fs.mkdir(home);
  const env = { HOME: home, USERPROFILE: home, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`,
    TMPDIR: os.tmpdir(), PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1',
    PI_LARK_CONFIG: path.join(home, 'missing-config.json'), npm_config_cache: path.join(temp, 'cache'),
    npm_config_userconfig: path.join(home, '.npmrc'), npm_config_globalconfig: path.join(home, 'global.npmrc'), npm_config_registry: 'https://registry.npmjs.org/' };
  for (const key of ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy']) if (process.env[key]) env[key] = process.env[key];
  const artifact = values.artifact
    ? { file: path.resolve(values.artifact), version: values['expected-version'] || JSON.parse(await fs.readFile(path.join(root, 'package.json'))).version }
    : await packSmokeFixture({ root, directory: path.join(temp, 'fixture'), env });
  // Check consumer-specific contents even when testing the Action's exact tgz.
  checkPackageContents(artifact.file);
  const install = spawnSync('npm', ['install', '--global', '--prefix', prefix, artifact.file, '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: home, env, stdio: 'inherit', timeout: 600000 });
  if (install.error || install.status !== 0) throw new Error('npm_install_failed');
  const cli = path.join(prefix, 'bin/pi-lark-gateway');
  function check(args, status, pattern) {
    const result = spawnSync(cli, args, { cwd: home, env, encoding: 'utf8', timeout: 30000 });
    if (result.status !== status || !pattern.test(result.stdout + result.stderr)) throw new Error('npm_cli_failed');
    return result;
  }
  if (check(['--version'], 0, /./).stdout.trim() !== artifact.version) throw new Error('npm_cli_version_mismatch');
  check(['--help'], 0, /start\|setup\|doctor\|backup/);
  check(['setup', '--help'], 0, /默认白名单审批/);
  check(['setup', '--permissions'], 0, /im.message.receive_v1/);
  const permissions = JSON.parse(check(['setup', '--permissions-json'], 0, /cardkit:card:write/).stdout);
  if (permissions.scopes.tenant.length !== 8 || permissions.scopes.user.length || permissions.scopes.tenant.includes('im:message.group_msg')) throw new Error('npm_permissions_manifest_invalid');
  check(['doctor', '--help'], 0, /不联网/);
  check(['backup', '--help'], 0, /必须先停服务/);
  check(['restart', '--help'], 0, /登记延迟重启任务/);
  check(['restart'], 1, /restart_request_failed/);
  check(['setup', '--domain', 'lark'], 1, /仅支持国内飞书/);
  check(['start'], 1, /startup_failed_check_configuration_and_network/);
  console.log(`npm tarball install and CLI smoke passed (${process.version}); no npm publication, live model or Feishu calls.`);
} catch { console.error('npm_smoke_failed'); process.exitCode = 1; }
finally { await fs.rm(temp, { recursive: true, force: true }); }

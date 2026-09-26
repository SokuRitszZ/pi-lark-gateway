import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { defaultConfigPath, loadConfig } from '../src/config/index.js';

async function main() {
  const { values } = parseArgs({ options: { config: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) { console.log(`用法：${process.env.PI_LARK_CLI === '1' ? 'pi-lark-gateway doctor' : 'npm run doctor --'} [--config 路径]\n只检查本地运行时、配置和文件权限；不联网、不发送消息，不证明模型/长连接在线。`); return; }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 21)) throw new Error('unsupported_node');
  console.log(`OK Node ${process.version}`);
  await import('@earendil-works/pi-coding-agent');
  await import('@larksuiteoapi/node-sdk');
  console.log('OK SDK imports');
  const file = path.resolve(values.config || process.env.PI_LARK_CONFIG || defaultConfigPath());
  const { config, groups } = await loadConfig(file);
  console.log('OK Feishu config and credential structure');
  for (const target of [file, path.resolve(path.dirname(file), config.bot.credentialsFile)]) {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || (stat.mode & 0o077)) throw new Error('unsafe_config_permissions');
  }
  console.log('OK private config/credential permissions');
  if (!config.access.owner) throw new Error('owner_not_configured');
  console.log('OK owner configured');
  if ([config.access.private, config.access.groups, ...Object.values(groups)].some(policy => policy.tools === 'all')) console.log('WARN tools enabled: trusted users can access host resources');
  console.log('模型授权/额度、飞书权限和 WebSocket 在线状态未探测；见 docs/INSTALL.md 与 docs/OPERATIONS.md。');
}
main().catch(() => {
  console.error('doctor_failed: check Node >=22.21.0, installed dependencies, v2 Feishu config, owner and private file permissions. No credentials printed.');
  process.exitCode = 1;
});

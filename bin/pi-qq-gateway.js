#!/usr/bin/env node
import { startGateway, defaultConfigPath, initConfig, loadConfig, loadCredentials, publicError } from '../src/qq-gateway/index.js';

import { configureEnvironmentProxy } from '../src/runtime/network.js';

configureEnvironmentProxy();
const args = process.argv.slice(2), command = args.shift();
const help = 'Usage: pi-qq-gateway setup|authorize|init|check|discover|start [--config /absolute/config.json]\nSecret: saved by setup (0600 file), or QQBOT_APP_SECRET environment override. Pi extension: /qq start|stop|status.';
async function main() {
  if (!command || ['--help', '-h', 'help'].includes(command) || (args.length === 1 && ['--help', '-h'].includes(args[0]))) { console.log(help); return; }
  let configPath = defaultConfigPath();
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--config' || !args[1]) throw new Error('invalid_config:arguments');
    configPath = args[1];
  }
  if (['setup', 'authorize'].includes(command)) { const { promptSetupQQ } = await import('../src/qq-gateway/setup.js'); await promptSetupQQ(configPath, { authorizeOnly: command === 'authorize' }); return; }
  if (command === 'init') { await initConfig(configPath); console.log(`Created template ${configPath}; not ready to start. Run pi-gateway qq setup (keep --config if customized) to configure credentials and authorize identities.`); return; }
  if (command === 'check') { const config = await loadConfig(configPath); await loadCredentials(config, configPath); console.log('Local configuration valid; QQ/model connectivity not tested.'); return; }
  if (!['start', 'discover'].includes(command)) throw new Error('invalid_config:command');
  let gateway, stopping = false;
  const stop = () => { stopping = true; void gateway?.close().catch(() => console.error('gateway_close_failed')); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    gateway = await startGateway({ configPath, discover: command === 'discover',
      log: code => { console.log(code); if (process.connected && /^[a-z][a-z0-9_]{0,100}$/.test(code)) process.send({ type: 'gateway_log', code }, () => {}); }, onIdentity: identity => console.log(JSON.stringify(identity)),
    });
    if (stopping) await gateway.close();
    else if (process.connected) process.send({ type: 'gateway_ready' }, () => {});
    await gateway.done;
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
main().catch(async error => {
  if (error.code === 'CLI_CANCELLED') {
    const { createUI } = await import('../src/cli/index.js'); createUI().cancel(); process.exitCode = 130;
  } else {
    const diagnostic = publicError(error); console.error(diagnostic);
    if (process.connected) process.send({ type: 'gateway_failed', diagnostic }, () => {});
    process.exitCode = 1;
  }
});

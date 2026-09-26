import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { startGateway } from './gateway/index.js';
import { keepAwakeOnPower } from './runtime/index.js';
import { RESTART_EXIT_CODE } from './restart/index.js';

setGlobalDispatcher(new EnvHttpProxyAgent());
process.umask(0o077);
const log = event => console.log(new Date().toISOString(), event);

let requestRestart;
startGateway({ log, onRestart: () => requestRestart() }).then(gateway => {
  const releaseAwake = keepAwakeOnPower(log);
  let stopping = false;
  const stop = async (exitCode = 0) => {
    if (stopping) return;
    stopping = true;
    log('stopping');
    releaseAwake();
    const deadline = setTimeout(() => process.exit(1), 15000);
    try { await gateway.close(); clearTimeout(deadline); process.exit(exitCode); }
    catch { log('shutdown_failed'); process.exit(1); }
  };
  requestRestart = () => { void stop(RESTART_EXIT_CODE); };
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
}).catch(() => { log('startup_failed_check_configuration_and_network'); process.exitCode = 1; });

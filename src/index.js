import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { startGateway } from './gateway/index.js';
import { keepAwakeOnPower } from './runtime/index.js';

setGlobalDispatcher(new EnvHttpProxyAgent());
process.umask(0o077);
const log = event => console.log(new Date().toISOString(), event);

startGateway({ log }).then(gateway => {
  const releaseAwake = keepAwakeOnPower(log);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    log('stopping');
    releaseAwake();
    const deadline = setTimeout(() => process.exit(1), 15000);
    try { await gateway.close(); clearTimeout(deadline); process.exit(0); }
    catch { log('shutdown_failed'); process.exit(1); }
  };
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
}).catch(() => { log('startup_failed_check_configuration_and_network'); process.exitCode = 1; });

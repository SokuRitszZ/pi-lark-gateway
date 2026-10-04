import { startGateway } from './gateway/index.js';
import { keepAwakeOnPower } from './runtime/index.js';
import { configureEnvironmentProxy } from './runtime/network.js';
import { RESTART_EXIT_CODE } from './restart/index.js';

configureEnvironmentProxy();
process.umask(0o077);
const log = event => {
  console.log(new Date().toISOString(), event);
  if (process.connected && /^[a-z][a-z0-9_]{0,100}$/.test(event)) process.send({ type: 'gateway_log', code: event }, () => {});
};

let requestRestart, requestStop, stopRequested = false;
const signalStop = () => { stopRequested = true; void requestStop?.(); };
process.once('SIGINT', signalStop); process.once('SIGTERM', signalStop);
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
  requestStop = stop;
  if (stopRequested) { void stop(); return; }
  if (process.connected) process.send({ type: 'gateway_ready' }, () => {});
}).catch(() => { log('startup_failed_check_configuration_and_network'); process.exitCode = 1; });

import { loadConfig } from './store.js';

const fingerprint = value => JSON.stringify([value.config.bot.appId, value.config.bot.domain,
  value.config.bot.connectionMode, value.secret, value.config.model]);

export function watchConfig(file, initial, log, interval = 3000) {
  let snapshot = initial, reloading = false;
  const initialConnection = fingerprint(initial);
  const timer = setInterval(async () => {
    if (reloading) return;
    reloading = true;
    try {
      const next = await loadConfig(file);
      if (fingerprint(next) !== initialConnection) { log('config_connection_or_model_change_requires_restart'); return; }
      if (JSON.stringify(next) !== JSON.stringify(snapshot)) { snapshot = next; log('access_config_reloaded'); }
    } catch { log('config_reload_rejected_using_last_valid_config'); }
    finally { reloading = false; }
  }, interval);
  timer.unref();
  return { get: () => snapshot, close: () => clearInterval(timer) };
}

import fs from 'node:fs/promises';
import { validateConfig } from './config/index.js';
export async function watchPolicy({ file, config, apply, isClosed, log, interval = 2000 }) {
  let reading = false, lastText;
  const refresh = async initial => {
    const text = await fs.readFile(file, 'utf8');
    if (text === lastText) return;
    const next = validateConfig(JSON.parse(text));
    if (next.botId !== config.botId) throw new Error('tg_account_changed');
    if (!isClosed()) apply({ config: { ...config, access: next.access, answerTimeoutMs: next.answerTimeoutMs }, groups: next.groups });
    lastText = text;
    if (!initial) log('tg_policy_reloaded');
  };
  // Read again before accepting updates so setup-time edits cannot leave a stale ACL.
  await refresh(true);
  const timer = setInterval(async () => {
    if (reading || isClosed()) return; reading = true;
    try { await refresh(false); } catch { log('tg_policy_reload_failed'); } finally { reading = false; }
  }, interval);
  timer.unref(); return () => clearInterval(timer);
}

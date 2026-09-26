import { setTimeout as sleep } from 'node:timers/promises';

const HOSTS = { feishu: 'https://accounts.feishu.cn' };
export class RegistrationError extends Error {}
const positive = (v, fallback) => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback;

// Same registration protocol used by Hermes. Not a documented SDK API:
// keep this transport isolated so upstream changes do not affect the gateway.
export function createRegistration({ fetchImpl = fetch, now = () => performance.now(), wait = sleep } = {}) {
  async function post(domain, fields, signal, timeout = 10000) {
    if (domain !== 'feishu') throw new RegistrationError('目前仅支持国内飞书（feishu）。');
    const deadlineSignal = AbortSignal.timeout(Math.max(1, Math.ceil(timeout)));
    let response;
    try {
      response = await fetchImpl(`${HOSTS[domain]}/oauth/v1/app/registration`, {
        method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
        signal: signal ? AbortSignal.any([signal, deadlineSignal]) : deadlineSignal,
      });
    } catch {
      signal?.throwIfAborted();
      throw new RegistrationError('无法连接飞书注册服务，请检查网络或 HTTPS_PROXY。');
    }
    // authorization_pending can be returned with HTTP 400.
    if (response.status !== 400 && !response.ok) throw new RegistrationError(`注册服务 HTTP ${response.status}。`);
    let data;
    try { data = await response.json(); } catch { throw new RegistrationError('注册服务返回了非 JSON 响应。'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new RegistrationError('注册服务响应格式异常。');
    return data;
  }
  async function begin({ domain = 'feishu', signal } = {}) {
    const init = await post(domain, { action: 'init' }, signal);
    if (!Array.isArray(init.supported_auth_methods) || !init.supported_auth_methods.includes('client_secret')) {
      throw new RegistrationError('该租户/环境不支持扫码注册，请使用开放平台手动创建应用。');
    }
    const data = await post(domain, {
      action: 'begin', archetype: 'PersonalAgent', auth_method: 'client_secret', request_user_info: 'open_id',
    }, signal);
    if (typeof data.device_code !== 'string' || !data.device_code) throw new RegistrationError('注册服务未返回 device_code。');
    let url;
    try { url = new URL(data.verification_uri_complete); } catch { throw new RegistrationError('注册服务未返回有效关联链接。'); }
    if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname === 'feishu.cn' || url.hostname.endsWith('.feishu.cn'))) {
      throw new RegistrationError('拒绝非国内飞书官方域名的关联链接。');
    }
    return { domain, deviceCode: data.device_code, url: url.href,
      userCode: typeof data.user_code === 'string' ? data.user_code : '',
      interval: positive(data.interval, 5), expiresIn: positive(data.expire_in, 600), startedAt: now() };
  }
  async function poll(ticket, { signal, timeoutSeconds = 600 } = {}) {
    const deadline = ticket.startedAt + Math.min(ticket.expiresIn, timeoutSeconds) * 1000;
    const domain = ticket.domain;
    let interval = ticket.interval;
    while (now() < deadline) {
      signal?.throwIfAborted();
      const data = await post(domain, { action: 'poll', device_code: ticket.deviceCode, tp: 'ob_app' }, signal, Math.min(10000, deadline - now()));
      if (now() >= deadline) break;
      if (data.user_info?.tenant_brand === 'lark') throw new RegistrationError('目前仅支持国内飞书，不支持国际版租户。');
      if (typeof data.client_id === 'string' && data.client_id && typeof data.client_secret === 'string' && data.client_secret) {
        return { appId: data.client_id, appSecret: data.client_secret, domain,
          ownerOpenId: typeof data.user_info?.open_id === 'string' ? data.user_info.open_id : null };
      }
      if (data.error === 'access_denied') throw new RegistrationError('用户拒绝了关联。');
      if (data.error === 'expired_token') throw new RegistrationError('关联链接已过期，请重新运行 setup。');
      if (data.error === 'slow_down') interval += 5;
      else if (data.error && data.error !== 'authorization_pending') throw new RegistrationError('注册服务拒绝请求，请重新运行 setup 或使用手动配置。');
      await wait(Math.min(interval * 1000, Math.max(0, deadline - now())), undefined, { signal });
    }
    throw new RegistrationError('等待关联超时，请重新运行 setup。');
  }
  return { begin, poll };
}

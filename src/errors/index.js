// Provider errors can contain credentials, request bodies or HTML. Only publish
// fixed, allowlisted diagnostics, never the original message or stack.
const diagnostics = [
  ['FETCH_FAILED', /\bfetch failed\b/i, 'fetch failed：模型请求网络连接失败，请检查代理、DNS、TLS 和上游服务。'],
  ['CONNECTION_RESET', /\bECONNRESET\b|socket hang up/i, 'ECONNRESET：上游连接被重置。'],
  ['CONNECTION_REFUSED', /\bECONNREFUSED\b/i, 'ECONNREFUSED：连接被拒绝，请检查代理或服务是否运行。'],
  ['DNS_FAILED', /\bENOTFOUND\b|\bEAI_AGAIN\b/i, 'DNS 解析失败，请检查网络或代理。'],
  ['NETWORK_TIMEOUT', /\bETIMEDOUT\b|\bUND_ERR_CONNECT_TIMEOUT\b|\btimed?\s*out\b/i, '网络请求超时，请检查代理和上游服务。'],
  ['TLS_FAILED', /\bCERT_HAS_EXPIRED\b|\bUNABLE_TO_VERIFY_LEAF_SIGNATURE\b|\bSELF_SIGNED_CERT_IN_CHAIN\b/i, 'TLS 证书校验失败，请检查证书及代理配置。'],
  ['RATE_LIMITED', /\brate.?limit|\b429\b/i, '上游限流（429），请稍后重试或检查额度。'],
  ['AUTH_FAILED', /\b401\b|\bunauthorized\b|invalid.api.key|No API key/i, '模型认证失败，请检查凭据或重新登录。'],
  ['FORBIDDEN', /\b403\b|\bforbidden\b/i, '上游拒绝访问（403），请检查权限或网络出口。'],
  ['UPSTREAM_UNAVAILABLE', /\b50[0234]\b|\boverloaded\b|\bservice unavailable\b/i, '模型上游服务暂不可用，请稍后重试。'],
  ['CONTEXT_TOO_LONG', /context.{0,24}(length|window|limit)|too many tokens/i, '上下文超过模型限制，请新建会话或压缩上下文。'],
];

export function failureDiagnostic(error) {
  const parts = [];
  let current = error;
  for (let depth = 0; current && depth < 3; depth++, current = current.cause) {
    for (const value of [current.code, current.message, current.errorMessage]) {
      if (typeof value === 'string') parts.push(value.slice(0, 8192));
    }
  }
  // Prefer a specific nested network cause over the generic fetch wrapper.
  const text = parts.join('\n');
  const match = diagnostics.slice(1).find(([, pattern]) => pattern.test(text))
    || (diagnostics[0][1].test(text) ? diagnostics[0] : undefined);
  return match ? { code: match[0], text: match[2] } : { code: 'UNKNOWN', text: '未识别的调用错误，原始详情因可能包含敏感信息未公开。' };
}

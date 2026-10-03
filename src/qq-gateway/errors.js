export function publicError(error) {
  if (error?.message === 'invalid_config:empty_allowlist') return 'invalid_config:empty_allowlist — 基础配置已有，但尚未授权 QQ 身份。运行 pi-gateway qq authorize，发送测试消息、勾选身份并确认；自定义配置请沿用 --config。';
  if (/^invalid_config:[A-Za-z._]+$/.test(error?.message || '')) return error.message;
  const known = new Set(['missing_QQBOT_APP_SECRET', 'qq_account_locked', 'qq_start_timeout', 'qq_transport_failed', 'qq_transport_ended']);
  if (known.has(error?.message)) return error.message;
  if (error?.code === 'EEXIST') return 'config_exists: existing file was not overwritten';
  if (error?.code === 'ENOENT') return 'config_missing: 请先运行 pi-gateway qq setup 初始化配置与白名单；自定义配置请沿用 --config';
  return 'gateway_operation_failed: check configuration, model auth, QQ permissions and network; raw details withheld';
}

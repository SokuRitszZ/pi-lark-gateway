export function publicError(error) {
  if (/^invalid_config:[A-Za-z._]+$/.test(error?.message || '')) return error.message;
  const known = new Set(['missing_QQBOT_APP_SECRET', 'qq_account_locked', 'qq_start_timeout', 'qq_transport_failed', 'qq_transport_ended']);
  if (known.has(error?.message)) return error.message;
  if (error?.code === 'EEXIST') return 'config_exists: existing file was not overwritten';
  if (error?.code === 'ENOENT') return 'config_missing: run init first';
  return 'gateway_operation_failed: check configuration, model auth, QQ permissions and network; raw details withheld';
}

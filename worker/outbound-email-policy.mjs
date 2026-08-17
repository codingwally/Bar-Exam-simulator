const EMAIL_MODES = new Set(['enabled', 'suppressed']);

export function outboundEmailMode(env = {}) {
  if (typeof env?.OUTBOUND_EMAIL_MODE === 'undefined') return 'suppressed';
  const mode = String(env.OUTBOUND_EMAIL_MODE ?? '').trim().toLowerCase();
  return mode === 'enabled' ? 'enabled' : 'suppressed';
}

export function outboundEmailSuppressed(env = {}) {
  return outboundEmailMode(env) === 'suppressed';
}

export function resolvedEmailMode(env, configuredMode) {
  if (outboundEmailSuppressed(env)) return 'suppressed';
  const mode = String(configuredMode ?? '').trim().toLowerCase();
  return EMAIL_MODES.has(mode) ? mode : 'not_configured';
}

const allowedSuiteLocation = /(?:^|[\\/])(test-(?:complete-beta|duediligence-2026|examinations)-staging\.mjs):(\d+):(\d+)/i;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactUrl(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '[url]';
  }
}

export function sanitizeStagingDiagnostic(value, secret = '') {
  let text = String(value || '');
  if (secret) text = text.replace(new RegExp(escapeRegExp(secret), 'g'), '[credential]');
  text = text
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [credential]')
    .replace(/\b(?:sb_(?:secret|publishable)_|sbp_)[A-Za-z0-9._-]+\b/g, '[credential]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[credential]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[record-id]')
    .replace(/https?:\/\/[^\s'"<>]+/gi, redactUrl)
    .replace(/(?:file:\/\/\/)?[A-Za-z]:[\\/][^\r\n]*?[\\/](scripts[\\/])/gi, '$1')
    .replace(/\/home\/runner\/work\/[^\r\n]*?\/(scripts\/)/gi, '$1')
    .replace(/\b(?:authorization|apikey|api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[credential]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 320 ? `${text.slice(0, 317)}...` : text;
}

export function buildStagingFailureDiagnostic(output, exitCode, secret = '') {
  const source = String(output || '');
  const assertion = source.match(/AssertionError(?: \[[^\]]+\])?:\s*([^\r\n]+)/i);
  const runtime = source.match(/(?:TypeError|RangeError|ReferenceError|SyntaxError|Error):\s*([^\r\n]+)/i);
  const rawMessage = assertion?.[1] || runtime?.[1] || 'The suite exited without a safe diagnostic message.';
  const location = source.match(allowedSuiteLocation);
  let category = assertion ? 'assertion' : 'runtime';
  if (/timeout|timed out|aborterror/i.test(source)) category = 'timeout';
  else if (/\b(?:request|response|http|status)\b/i.test(rawMessage)) category = 'request';
  else if (/configuration|credential|environment|project ref/i.test(rawMessage)) category = 'configuration';

  return Object.freeze({
    category,
    message: sanitizeStagingDiagnostic(rawMessage, secret),
    location: location ? `${location[1]}:${location[2]}:${location[3]}` : null,
    exitCode: Number.isInteger(exitCode) ? exitCode : 1,
  });
}

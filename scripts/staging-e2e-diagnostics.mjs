const allowedSuiteLocation = /(?:^|[\\/])((?:test-(?:complete-beta|commercial-launch|duediligence-2026|examinations)-staging|test-examinations-staging-ui|verify-examinations-staging-ui|run-staging-e2e-suite|staging-commercial-user)\.mjs):(\d+):(\d+)/i;

function safeAssertionPrimitive(source, label, secret = '') {
  const pattern = new RegExp(
    `^\\s*${label}:\\s*(true|false|null|-?\\d+(?:\\.\\d+)?|'[^'\\r\\n]{0,80}')\\s*,?\\s*$`,
    'im',
  );
  const value = source.match(pattern)?.[1];
  return value ? sanitizeStagingDiagnostic(value, secret) : null;
}

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

  const diagnostic = {
    category,
    message: sanitizeStagingDiagnostic(rawMessage, secret),
    location: location ? `${location[1]}:${location[2]}:${location[3]}` : null,
    exitCode: Number.isInteger(exitCode) ? exitCode : 1,
  };
  const actual = safeAssertionPrimitive(source, 'actual', secret);
  const expected = safeAssertionPrimitive(source, 'expected', secret);
  if (actual !== null) diagnostic.actual = actual;
  if (expected !== null) diagnostic.expected = expected;
  return Object.freeze(diagnostic);
}

const diagnosticScripts = new Set([
  'test-complete-beta-staging.mjs', 'test-commercial-launch-staging.mjs',
  'test-duediligence-2026-staging.mjs', 'test-examinations-staging.mjs',
  'test-examinations-staging-ui.mjs',
]);
const safeErrorCodes = new Set([
  'ERR_ASSERTION', 'ENOENT', 'EACCES', 'ECONNRESET', 'ETIMEDOUT',
  'EXAM_PREMIUM_REQUIRED', 'EXAM_SECOND_TAB_BLOCKED', 'EXAM_RESPONSE_CONFLICT',
  'EXAM_ATTEMPT_NOT_FOUND', 'EXAM_ACCESS_DENIED', 'AUTHENTICATION_REQUIRED',
  'EXAMINER_NOT_CONFIGURED', 'AI_GRADING_CAPACITY', 'UNSUPPORTED_MODEL',
  'REVIEW_CONFIRMATION_REQUIRED', 'BAR_FORECAST_SUBSCRIPTION_REQUIRED',
]);

// Public diagnostics deliberately do not echo free-form exception messages,
// quoted assertion operands, URLs, source excerpts, or customer answer text.
// The existing text sanitizer remains available for the private UI wrapper.
export function buildPublishableStagingFailureDiagnostic(output, exitCode, secret = '') {
  const source = String(output || '');
  const original = buildStagingFailureDiagnostic(source, exitCode, secret);
  const errorClass = source.match(/\b(AssertionError|AggregateError|TypeError|RangeError|ReferenceError|SyntaxError|TimeoutError|AbortError|Error)(?:\s+\[[A-Z_]+\])?:/)?.[1] || 'Error';
  const assertion = errorClass === 'AssertionError';
  const httpStatus = Number(source.match(/\breturned ([1-5][0-9]{2}):/)?.[1]) || null;
  const category = httpStatus ? 'request' : assertion ? 'assertion'
    : ['TimeoutError','AbortError'].includes(errorClass) ? 'timeout'
      : original.category === 'configuration' ? 'configuration' : 'runtime';
  const messages = {
    request: 'The staging HTTP response did not match the expected status.',
    assertion: 'A staging assertion failed. Review the script location and safe scalar comparison.',
    timeout: 'The staging operation timed out. Review the script location.',
    configuration: 'The staging configuration check failed. Review the script location.',
    runtime: 'The staging child process failed. Free-form details are withheld.',
  };
  const rawCode = source.match(/\bcode:\s*['"]([A-Z][A-Z0-9_]{2,64})['"]/)?.[1]
    || source.match(/\b(?:AssertionError|Error)\s+\[([A-Z][A-Z0-9_]{2,64})\]/)?.[1];
  const result = { category, errorClass, errorCode: safeErrorCodes.has(rawCode) ? rawCode : null,
    message: messages[category], location: original.location, exitCode: original.exitCode };
  if (httpStatus) result.httpStatus = httpStatus;
  for (const key of ['actual','expected']) {
    if (/^(?:true|false|null)$/.test(String(original[key] ?? ''))
      || (/^-?[0-9]{1,6}(?:\.[0-9]{1,8})?$/.test(String(original[key] ?? ''))
        && Math.abs(Number(original[key]))<=100000))
      result[key] = original[key];
  }
  const operator = source.match(/\boperator:\s*['"]([A-Za-z]+)['"]/)?.[1];
  if (['strictEqual','deepStrictEqual','equal','deepEqual','ok','match','doesNotMatch','fail'].includes(operator))
    result.assertionOperator = operator;
  return Object.freeze(result);
}

export function buildStagingChildEvidence(script, result, secret = '') {
  const name = String(script || '').split(/[\\/]/).at(-1);
  if (!diagnosticScripts.has(name)) throw new Error('Unsupported staging diagnostic script.');
  if (!result) return Object.freeze({ script: name, status: 'NOT_RUN', exitCode: null,
    cleanup: 'not-run', failureReason: 'previous-child-failed', failure: null });
  const output = String(result.output || '');
  const cleanupMarker = name === 'test-examinations-staging-ui.mjs' ? 'EXAMINATIONS_UI_STAGING'
    : name === 'test-examinations-staging.mjs' ? 'EXAMINATIONS_STAGING'
      : name === 'test-duediligence-2026-staging.mjs' ? 'DD2026_STAGING' : 'STAGING_GATE';
  const cleanup = new RegExp(`(?:^|\\n)${cleanupMarker}: synthetic_cleanup=true\\b`).test(output);
  const secretEcho = Boolean(secret) && output.includes(secret);
  const passed = result.code === 0 && cleanup && !secretEcho;
  return Object.freeze({ script: name, status: passed ? 'PASS' : 'FAIL',
    exitCode: Number.isInteger(result.code) ? result.code : 1,
    cleanup: cleanup ? 'completed' : 'not-confirmed',
    failureReason: passed ? null : secretEcho ? 'credential-output-detected'
      : result.code !== 0 ? 'child-exit' : 'cleanup-unconfirmed',
    failure: passed ? null : buildPublishableStagingFailureDiagnostic(output,result.code,secret) });
}

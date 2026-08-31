import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const JOURNEY_COUNT = 30;
const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 2;
// Forecast normally performs five administrator requests per journey (including
// the deliberate pre-consent rejection), with at most one duplicate status check.
// Sixty seconds keeps that sixth request plus two boundary-crossing journeys below the
// Worker's dedicated 90-request/10-minute Forecast IP window, while keeping
// browser/RAM pressure to at most two active contexts.
const MINIMUM_START_INTERVAL_MS = 60_000;
const DEFAULT_JOURNEY_TIMEOUT_MS = 8 * 60_000;
const CONSENT_VERSION = '2026-09-01';
const FORECAST_PATH = '/admin/dd2026/bar-forecast';
const SYNTHETIC_CONTENT = /(?:^synthetic-ui-|synthetic interface-test question|\bmock permit\s+\d+\b|deterministic mock output for visual)/iu;
const TOKEN_PATTERN = /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/gu;
const SUPABASE_PRIVILEGED_KEY_PATTERN = /^(?:sb_secret_[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})$/u;
const DIAGNOSTIC_STAGES = new Set([
  'browser_launch',
  'public_root',
  'non_admin_create',
  'non_admin_denial',
  'admin_create',
  'classification',
  'journeys',
  'cleanup',
  'evidence',
]);

const SUBJECTS = Object.freeze([
  'Political and Public International Law',
  'Commercial and Taxation Laws',
  'Civil Law and Land Titles and Deeds',
  'Labor Law and Social Legislation',
  'Criminal Law',
  'Remedial Law, Legal and Judicial Ethics, with Practical Exercises',
]);

const TARGETS = Object.freeze({
  staging: Object.freeze({
    siteUrl: 'https://duediligence-examinations-staging.wallyesteban1993.workers.dev',
    workerUrl: 'https://duediligence-examinations-staging.wallyesteban1993.workers.dev',
    supabaseUrl: 'https://hlzqmreeoghbldnhlybr.supabase.co',
    confirmation: 'staging:hlzqmreeoghbldnhlybr:30',
  }),
  production: Object.freeze({
    siteUrl: 'https://duediligence.ph',
    workerUrl: 'https://duediligence-api.wallyesteban1993.workers.dev',
    supabaseUrl: 'https://hbllomlijfznnuudpdvr.supabase.co',
    confirmation: 'production:hbllomlijfznnuudpdvr:30',
  }),
});

function parseCommandLine(input) {
  const parsed = { environment: '', help: false, preflight: false };
  for (let index = 0; index < input.length; index += 1) {
    const argument = input[index];
    if (argument === '--help') parsed.help = true;
    else if (argument === '--preflight') parsed.preflight = true;
    else if (argument === '--environment') {
      assert.ok(!parsed.environment, '--environment may be provided only once.');
      parsed.environment = String(input[index + 1] || '').trim().toLowerCase();
      index += 1;
    } else if (argument.startsWith('--environment=')) {
      assert.ok(!parsed.environment, '--environment may be provided only once.');
      parsed.environment = argument.slice('--environment='.length).trim().toLowerCase();
    } else {
      assert.fail(`Unsupported argument: ${argument}`);
    }
  }
  return Object.freeze(parsed);
}

const commandLine = parseCommandLine(process.argv.slice(2));

function usage() {
  return `Usage:
  node scripts/run-bar-forecast-live-journeys.mjs --environment staging --preflight
  node scripts/run-bar-forecast-live-journeys.mjs --environment staging

Required environment:
  BAR_FORECAST_E2E_CONFIRM=<exact target confirmation>
  BAR_FORECAST_E2E_RELEASE_SHA=<40-hex candidate SHA>
  BAR_FORECAST_E2E_GITHUB_RUN_ID=<numeric workflow run ID>
  BAR_FORECAST_E2E_SUPABASE_SECRET_KEY=<temporary secret key or approved legacy service-role JWT>

Production additionally requires:
  BAR_FORECAST_E2E_APPROVAL_REFERENCE=<reviewed change or approval reference>
  BAR_FORECAST_E2E_AWAIT_CLASSIFICATION=true

Optional bounded settings:
  BAR_FORECAST_E2E_CONCURRENCY=1|2         (default 2)
  BAR_FORECAST_E2E_START_INTERVAL_MS>=60000
  BAR_FORECAST_E2E_JOURNEY_TIMEOUT_MS=300000..900000
  BAR_FORECAST_E2E_BROWSER_CHANNEL=chrome|bundled`;
}

if (commandLine.help) {
  process.stdout.write(`${usage()}\n`);
  process.exit(0);
}

function integerSetting(name, fallback, minimum, maximum) {
  const raw = String(process.env[name] || '').trim();
  const value = raw ? Number(raw) : fallback;
  assert.ok(Number.isInteger(value) && value >= minimum && value <= maximum,
    `${name} must be an integer from ${minimum} through ${maximum}.`);
  return value;
}

function configuration({ requireSecret = true } = {}) {
  const targetName = commandLine.environment;
  const target = TARGETS[targetName];
  assert.ok(target, '--environment must be staging or production.');
  assert.equal(
    String(process.env.BAR_FORECAST_E2E_CONFIRM || '').trim(),
    target.confirmation,
    `BAR_FORECAST_E2E_CONFIRM must exactly equal ${target.confirmation}.`,
  );
  assert.equal(
    String(process.env.BAR_FORECAST_E2E_SITE_URL || target.siteUrl).replace(/\/+$/u, ''),
    target.siteUrl,
    'The site URL must be the exact reviewed target.',
  );
  assert.equal(
    String(process.env.BAR_FORECAST_E2E_SUPABASE_URL || target.supabaseUrl).replace(/\/+$/u, ''),
    target.supabaseUrl,
    'The Supabase URL must be the exact reviewed target.',
  );
  if (targetName === 'production') {
    assert.ok(
      String(process.env.BAR_FORECAST_E2E_APPROVAL_REFERENCE || '').trim().length >= 8,
      'A reviewed production approval reference is required.',
    );
    assert.equal(
      String(process.env.BAR_FORECAST_E2E_AWAIT_CLASSIFICATION || '').trim().toLowerCase(),
      'true',
      'Production requires the internal-test classification checkpoint.',
    );
  }
  const releaseSha = String(process.env.BAR_FORECAST_E2E_RELEASE_SHA || '').trim().toLowerCase();
  assert.match(releaseSha, /^[0-9a-f]{40}$/u, 'BAR_FORECAST_E2E_RELEASE_SHA must be a 40-hex commit SHA.');
  const githubRunId = String(process.env.BAR_FORECAST_E2E_GITHUB_RUN_ID || '').trim();
  assert.match(githubRunId, /^\d{1,20}$/u, 'BAR_FORECAST_E2E_GITHUB_RUN_ID must be numeric.');
  const secretKey = String(process.env.BAR_FORECAST_E2E_SUPABASE_SECRET_KEY || '').trim();
  if (requireSecret && !SUPABASE_PRIVILEGED_KEY_PATTERN.test(secretKey)) {
    throw new Error('A Supabase secret key or legacy service-role JWT is required.');
  }
  const concurrency = integerSetting(
    'BAR_FORECAST_E2E_CONCURRENCY',
    DEFAULT_CONCURRENCY,
    1,
    MAX_CONCURRENCY,
  );
  const startIntervalMs = integerSetting(
    'BAR_FORECAST_E2E_START_INTERVAL_MS',
    MINIMUM_START_INTERVAL_MS,
    MINIMUM_START_INTERVAL_MS,
    120_000,
  );
  const journeyTimeoutMs = integerSetting(
    'BAR_FORECAST_E2E_JOURNEY_TIMEOUT_MS',
    DEFAULT_JOURNEY_TIMEOUT_MS,
    300_000,
    900_000,
  );
  const browserChannel = String(process.env.BAR_FORECAST_E2E_BROWSER_CHANNEL || 'chrome').trim();
  assert.ok(['chrome', 'bundled'].includes(browserChannel),
    'BAR_FORECAST_E2E_BROWSER_CHANNEL must be chrome or bundled.');
  return Object.freeze({
    targetName,
    ...target,
    releaseSha,
    githubRunId,
    secretKey,
    concurrency,
    startIntervalMs,
    journeyTimeoutMs,
    browserChannel,
    awaitClassification: targetName === 'production',
  });
}

const config = configuration({ requireSecret: !commandLine.preflight });
if (commandLine.preflight) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: 'preflight',
    target: config.targetName,
    releaseSha: config.releaseSha,
    githubRunId: config.githubRunId,
    journeys: JOURNEY_COUNT,
    concurrency: config.concurrency,
    maximumConcurrency: MAX_CONCURRENCY,
    startIntervalMs: config.startIntervalMs,
    disposableAdministrators: config.concurrency,
    disposableNonAdministrators: 1,
    disposableAccountsTotal: config.concurrency + 1,
    classificationCheckpoint: config.awaitClassification,
    secretLoaded: false,
  }, null, 2)}\n`);
  process.exit(0);
}

const runId = `f30-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
const modernSecretKey = config.secretKey.startsWith('sb_secret_');
const serviceHeaders = Object.freeze({
  apikey: config.secretKey,
  // Modern Supabase secret keys are opaque API keys, not JWTs. Legacy
  // service-role keys remain bearer JWTs for backward-compatible staging.
  ...(modernSecretKey ? {} : { Authorization: `Bearer ${config.secretKey}` }),
});
const sensitiveValues = new Set([config.secretKey]);
const createdAccounts = [];
const activeContexts = new Set();
const completedJourneys = [];
const stopController = new AbortController();
let stopSignal = '';
let maximumActiveContexts = 0;
let diagnosticStage = 'browser_launch';
let cleanupFailed = false;

function setDiagnosticStage(stage) {
  assert.ok(DIAGNOSTIC_STAGES.has(stage), 'Unsupported Forecast E2E diagnostic stage.');
  diagnosticStage = stage;
}

function requestStop(signal) {
  if (!stopSignal) {
    stopSignal = signal;
    stopController.abort(new Error(`Forecast E2E interrupted by ${signal}.`));
    process.stderr.write(`Forecast E2E received ${signal}; closing active browser contexts and cleaning disposable users.\n`);
    for (const context of activeContexts) void context.close().catch(() => {});
  }
}

process.on('SIGINT', () => requestStop('SIGINT'));
process.on('SIGTERM', () => requestStop('SIGTERM'));

function safeText(value) {
  let output = String(value ?? '');
  for (const sensitive of sensitiveValues) {
    if (sensitive) output = output.replaceAll(sensitive, '[redacted]');
  }
  return output
    .replace(TOKEN_PATTERN, '[token]')
    .replace(/dd-forecast-e2e-[a-z0-9-]+@example\.com/giu, '[disposable-email]')
    .slice(0, 800);
}

function errorSummary(error) {
  const rawCode = String(error?.code || '').trim().toUpperCase();
  return Object.freeze({
    name: safeText(error?.name || 'Error'),
    code: /^[A-Z0-9_]{3,64}$/u.test(rawCode) ? rawCode : 'FORECAST_E2E_FAILED',
    details: 'Failure detail is intentionally suppressed so protected Forecast content cannot enter logs.',
  });
}

function phaseFailure(error, phase) {
  const existingCode = String(error?.code || '').trim().toUpperCase();
  if (/^FORECAST_E2E_[A-Z0-9_]{3,64}$/u.test(existingCode)) return error;
  const safePhase = String(phase || 'UNKNOWN')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 48) || 'UNKNOWN';
  const wrapped = new Error('The Forecast live journey failed during a protected phase.', {
    cause: error,
  });
  wrapped.name = safeText(error?.name || 'Error');
  wrapped.code = `FORECAST_E2E_${safePhase}`;
  return wrapped;
}

function timeoutSignal(milliseconds, honorStop = true) {
  const timeout = AbortSignal.timeout(milliseconds);
  return honorStop ? AbortSignal.any([timeout, stopController.signal]) : timeout;
}

async function responsePayload(response) {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function serviceRequest(pathname, options = {}, expected = [200], { honorStop = true } = {}) {
  const response = await fetch(`${config.supabaseUrl}${pathname}`, {
    ...options,
    headers: {
      ...serviceHeaders,
      ...(options.body == null ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {}),
    },
    signal: options.signal || timeoutSignal(60_000, honorStop),
  });
  const body = await responsePayload(response);
  if (!expected.includes(response.status)) {
    const code = body?.error?.code || body?.code || `HTTP_${response.status}`;
    throw new Error(`${options.method || 'GET'} ${pathname.split('?')[0]} failed (${safeText(code)}).`);
  }
  return Object.freeze({ status: response.status, body });
}

async function serviceRows(table, query, { honorStop = true, ...options } = {}) {
  const result = await serviceRequest(`/rest/v1/${table}?${query}`, options, [200], {
    honorStop,
  });
  assert.ok(Array.isArray(result.body), `${table} did not return rows.`);
  return result.body;
}

async function resetForecastConsent(userId, { honorStop = true } = {}) {
  const query = `user_id=eq.${encodeURIComponent(userId)}&consent_version=eq.${CONSENT_VERSION}`;
  await serviceRequest(`/rest/v1/dd2026_bar_forecast_consents?${query}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  }, [200, 204], { honorStop });
  const remaining = await serviceRows(
    'dd2026_bar_forecast_consents',
    `${query}&select=user_id`,
    { honorStop },
  );
  assert.equal(remaining.length, 0, 'Disposable Forecast consent was not reset.');
}

async function createDisposableAccount(label, kind) {
  const email = `dd-forecast-e2e-${runId}-${label}@example.com`;
  const password = `Dd!${randomBytes(30).toString('base64url')}9z`;
  sensitiveValues.add(email);
  sensitiveValues.add(password);
  const result = await serviceRequest('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `Forecast E2E ${runId} ${label}` },
    }),
  }, [200, 201]);
  const userId = String(result.body?.id || '');
  assert.match(userId, /^[0-9a-f-]{36}$/iu, 'Disposable account creation failed.');
  const account = {
    label,
    kind,
    userId,
    email,
    password,
    deleted: false,
    usageResidueVerified: false,
  };
  createdAccounts.push(account);
  return account;
}

async function createDisposableAdministrator(slot) {
  const account = await createDisposableAccount(`admin-${slot}`, 'administrator');

  await serviceRequest(`/rest/v1/user_roles?user_id=eq.${encodeURIComponent(account.userId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      role: 'admin',
      assigned_by: account.userId,
      updated_at: new Date().toISOString(),
    }),
  }, [200, 204]);
  const roles = await serviceRows(
    'user_roles',
    `user_id=eq.${encodeURIComponent(account.userId)}&select=role`,
  );
  assert.deepEqual(roles, [{ role: 'admin' }], 'Disposable account did not receive the least-privileged Forecast role.');
  await resetForecastConsent(account.userId);
  return account;
}

async function createDisposableNonAdministrator() {
  const account = await createDisposableAccount('non-admin', 'non-administrator');
  const roles = await serviceRows(
    'user_roles',
    `user_id=eq.${encodeURIComponent(account.userId)}&select=role`,
  );
  assert.equal(
    roles.some(({ role }) => ['admin', 'founder_admin', 'super_admin'].includes(String(role).toLowerCase())),
    false,
    'The denial-probe account unexpectedly has a Forecast administrator role.',
  );
  await resetForecastConsent(account.userId);
  return account;
}

async function awaitInternalTestClassification(accounts) {
  if (!config.awaitClassification) return;
  assert.equal(config.targetName, 'production');
  assert.equal(accounts.length, config.concurrency + 1);
  const request = {
    event: 'classification_required',
    runId,
    accounts: accounts.map(({ userId, kind }) => ({ userId, kind })),
  };
  // UUIDs are synthetic release-fixture identifiers. Credentials, emails,
  // protected content, and the service key never leave process memory.
  process.stderr.write(`FORECAST_E2E_CLASSIFICATION ${JSON.stringify(request)}\n`);
  const input = createInterface({ input: process.stdin, terminal: false });
  try {
    const response = await input.question('', {
      signal: AbortSignal.timeout(10 * 60_000),
    });
    assert.equal(
      response.trim(),
      `CONTINUE ${runId}`,
      'Production classification acknowledgement did not match this exact run.',
    );
  } finally {
    input.close();
  }
  process.stderr.write('Forecast E2E internal-test classification acknowledged.\n');
}

async function deleteAndVerifyDisposableUsage(account) {
  const userFilter = `user_id=eq.${encodeURIComponent(account.userId)}`;
  account.usageResidueVerified = false;
  // Events must be removed before their parent sessions. Both deletions are
  // scoped to the exact disposable user id; broad or prefix deletion is never
  // permitted here.
  for (const table of ['usage_events', 'usage_sessions']) {
    await serviceRequest(`/rest/v1/${table}?${userFilter}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    }, [200, 204], { honorStop: false });
  }
  for (const table of ['usage_events', 'usage_sessions']) {
    const rows = await serviceRows(table, `${userFilter}&select=id`, { honorStop: false });
    assert.equal(rows.length, 0, `${table} cleanup is incomplete.`);
  }
  account.usageResidueVerified = true;
}

async function cleanupDisposableAdministrator(account) {
  const errors = [];
  await resetForecastConsent(account.userId, { honorStop: false }).catch((error) => errors.push(error));
  // Revoke the role before deleting Auth so even a failed user deletion leaves
  // no administrator authorization behind.
  await serviceRequest(`/rest/v1/user_roles?user_id=eq.${encodeURIComponent(account.userId)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  }, [200, 204], { honorStop: false }).catch((error) => errors.push(error));

  let deleted = false;
  for (let attempt = 1; attempt <= 2 && !deleted; attempt += 1) {
    try {
      await deleteAndVerifyDisposableUsage(account);
      await serviceRequest(`/auth/v1/admin/users/${encodeURIComponent(account.userId)}`, {
        method: 'DELETE',
      }, [200, 204], { honorStop: false });
      deleted = true;
    } catch (error) {
      if (attempt === 2) errors.push(error);
      else await delay(1_000);
    }
  }
  account.deleted = deleted;
  if (deleted) {
    await serviceRequest(`/auth/v1/admin/users/${encodeURIComponent(account.userId)}`, {
      method: 'GET',
    }, [404], { honorStop: false }).catch((error) => errors.push(error));
    await deleteAndVerifyDisposableUsage(account).catch((error) => errors.push(error));
  }

  for (const [table, query] of [
    ['dd2026_bar_forecast_consents', `user_id=eq.${encodeURIComponent(account.userId)}&select=user_id`],
    ['user_roles', `user_id=eq.${encodeURIComponent(account.userId)}&select=user_id`],
  ]) {
    await serviceRows(table, query, { honorStop: false })
      .then((rows) => assert.equal(rows.length, 0, `${table} cleanup is incomplete.`))
      .catch((error) => errors.push(error));
  }
  if (errors.length) throw new AggregateError(errors, 'Disposable Forecast administrator cleanup failed.');
}

function answerFor(marker, number) {
  return `${marker}-Q${number}. Yes. Applying the controlling rule to the stated facts, notice, authority, procedure, fairness, and the requested conclusion are addressed directly.`;
}

function answerWordCount(answer) {
  return String(answer).trim().split(/\s+/u).filter(Boolean).length;
}

async function selectText(page, selector, maximumCharacters, dispatchMouseUp = false) {
  return page.evaluate(({ selector: requestedSelector, maximum, notify }) => {
    const root = document.querySelector(requestedSelector);
    if (!root) return false;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !String(node.nodeValue || '').trim()) node = walker.nextNode();
    if (!node) return false;
    const length = Math.min(maximum, String(node.nodeValue || '').length);
    if (length < 1) return false;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    root.focus({ preventScroll: true });
    if (notify) root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return !selection.isCollapsed;
  }, { selector, maximum: maximumCharacters, notify: dispatchMouseUp });
}

async function globallySignOut(page) {
  if (page.isClosed()) return false;
  return page.evaluate(async () => {
    const configuration = window.DueDiligencePhase2Config?.supabase;
    if (!configuration?.url || !configuration?.publishableKey || !window.supabase?.createClient) return false;
    const client = window.supabase.createClient(configuration.url, configuration.publishableKey, {
      auth: {
        persistSession: true,
        storage: window.DueDiligenceAuthSessionStorage?.prepare?.(configuration.url)
          || window.localStorage
          || window.sessionStorage,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const { error } = await client.auth.signOut({ scope: 'global' });
    return !error;
  }).catch(() => false);
}

async function authenticate(page, account) {
  let phase = 'AUTH_NAVIGATE';
  try {
    await page.goto(`${config.siteUrl}/?forecast-e2e=${encodeURIComponent(runId)}#bar-forecast-2026`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    phase = 'AUTH_SDK_READY';
    await page.waitForFunction(
      () => Boolean(window.supabase?.createClient && window.DueDiligencePhase2Config?.supabase),
      null,
      { timeout: 30_000 },
    );
    const publicConfiguration = await page.evaluate(() => ({
      supabaseUrl: window.DueDiligencePhase2Config.supabase.url,
      workerUrl: window.DueDiligencePhase2Config.workerUrl,
      publishable: /^sb_publishable_[A-Za-z0-9_-]{20,}$/u.test(
        window.DueDiligencePhase2Config.supabase.publishableKey,
      ),
      title: document.title,
      syntheticHarness: /Synthetic UI QA Harness|local-preview-token|Mock Permit/u.test(document.documentElement.innerHTML),
    }));
    assert.deepEqual(publicConfiguration, {
      supabaseUrl: config.supabaseUrl,
      workerUrl: config.workerUrl,
      publishable: true,
      title: 'Due Diligence — Philippine Bar Exam Simulator',
      syntheticHarness: false,
    });

    phase = 'AUTH_SIGN_IN';
    const authentication = await page.evaluate(async (credentials) => {
      const configuration = window.DueDiligencePhase2Config.supabase;
      const client = window.supabase.createClient(configuration.url, configuration.publishableKey, {
        auth: {
          persistSession: true,
          storage: window.DueDiligenceAuthSessionStorage?.prepare?.(configuration.url)
            || window.localStorage
            || window.sessionStorage,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      });
      const { data, error } = await client.auth.signInWithPassword(credentials);
      return {
        ok: Boolean(data?.session?.access_token),
        userId: data?.user?.id || '',
        error: error ? 'AUTHENTICATION_FAILED' : null,
      };
    }, { email: account.email, password: account.password });
    assert.equal(authentication.error, null);
    assert.equal(authentication.ok, true);
    assert.equal(authentication.userId, account.userId);

    phase = 'AUTH_SESSION_RELOAD';
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    phase = 'AUTH_SESSION_READY';
    await page.waitForFunction(
      () => Boolean(
        window.DueDiligencePhase4?.getSession?.()?.access_token
        && window.DueDiligencePhase2?.getSession?.()?.access_token,
      ),
      null,
      { timeout: 45_000 },
    );
    phase = 'AUTH_FORECAST_VISIBLE';
    await page.locator('#bf26-root:not([hidden])').waitFor({ state: 'visible', timeout: 45_000 });
  } catch (error) {
    throw phaseFailure(error, phase);
  }
}

async function assertServerConsentGate(page, subject) {
  const result = await page.evaluate(async ({ path, subject: selectedSubject }) => {
    const session = window.DueDiligencePhase4?.getSession?.();
    const response = await fetch(`${window.DueDiligencePhase2Config.workerUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.access_token || ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ operation: 'start', subject: selectedSubject }),
    });
    const body = await response.json().catch(() => null);
    return {
      status: response.status,
      code: body?.error?.code || '',
      questionCount: Array.isArray(body?.questions) ? body.questions.length : 0,
    };
  }, { path: FORECAST_PATH, subject });
  assert.deepEqual(result, {
    status: 409,
    code: 'BAR_FORECAST_CONSENT_REQUIRED',
    questionCount: 0,
  });
}

async function exerciseFirstQuestionTools(page, answer) {
  const flag = page.locator('.bf26-flag-button');
  await flag.click();
  assert.equal(await flag.getAttribute('aria-pressed'), 'true');

  assert.equal(await selectText(page, '.bf26-prompt', 18, true), true);
  await page.getByRole('button', { name: 'Highlight selected question text yellow' }).click();
  const highlight = page.locator('.bf26-prompt mark[data-color="yellow"]');
  await highlight.waitFor({ state: 'visible' });
  assert.ok((await highlight.textContent() || '').length > 0);

  const editor = page.locator('#bf26-current-answer');
  await editor.fill(answer);
  assert.equal(await selectText(page, '#bf26-current-answer', 12), true);
  await page.locator('[data-answer-command="bold"]').click();
  assert.equal(await editor.evaluate((node) => Boolean(node.querySelector('b, strong'))), true);
  await page.locator('.bf26-size-select').selectOption('18');
  assert.equal(await editor.evaluate((node) => node.style.fontSize), '18px');
}

async function fillAllAnswers(page, marker) {
  for (let number = 1; number <= 20; number += 1) {
    const answer = answerFor(marker, number);
    assert.ok(answerWordCount(answer) >= 10);
    const questionLabel = page.locator('.bf26-question-label');
    await page.waitForFunction(
      (expected) => document.querySelector('.bf26-question-label')?.textContent === `Question ${expected}`,
      number,
    );
    assert.equal(await questionLabel.textContent(), `Question ${number}`);
    const prompt = await page.locator('.bf26-prompt').textContent();
    assert.ok(String(prompt || '').trim().length >= 20, `Question ${number} prompt is empty.`);
    assert.doesNotMatch(String(prompt), SYNTHETIC_CONTENT, `Question ${number} contains QA fixture text.`);

    if (number === 1) await exerciseFirstQuestionTools(page, answer);
    else await page.locator('#bf26-current-answer').fill(answer);

    await page.waitForFunction(
      (minimum) => {
        const text = document.querySelector('.bf26-word-count')?.textContent || '';
        const match = text.match(/·\s+(\d+)\s+words/u);
        return Number(match?.[1] || 0) >= minimum;
      },
      10,
    );
    if (number < 20) await page.locator('.bf26-exam-footer').getByRole('button', { name: 'Next' }).click();
  }

  const completedLabels = await page.locator('.bf26-question-jump').evaluateAll(
    (buttons) => buttons.map((button) => button.getAttribute('aria-label') || ''),
  );
  assert.equal(completedLabels.length, 20);
  assert.equal(completedLabels.every((label) => label.includes('minimum reached')), true);
  assert.equal(
    await page.locator('.bf26-status').textContent(),
    'All answers are ready for final submission.',
  );

  // Return to question 1 and prove all three transient UI tools persisted in
  // this isolated browser attempt, then return to the true final question.
  await page.getByRole('button', { name: /^Go to question 1,/u }).click();
  assert.equal(await page.locator('.bf26-flag-button').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.bf26-prompt mark[data-color="yellow"]').count(), 1);
  assert.equal(
    await page.locator('#bf26-current-answer').evaluate((node) => Boolean(node.querySelector('b, strong'))),
    true,
  );
  await page.locator('.bf26-filter').selectOption('flagged');
  const visibleQuestions = await page.locator('.bf26-question-jump').evaluateAll(
    (buttons) => buttons.filter((button) => !button.hidden).length,
  );
  assert.equal(visibleQuestions, 1);
  await page.locator('.bf26-filter').selectOption('all');
  await page.getByRole('button', { name: /^Go to question 20,/u }).click();
}

async function resultProof(page, marker) {
  await page.locator('.bf26-results').waitFor({ state: 'visible', timeout: config.journeyTimeoutMs });
  const gradeText = String(await page.locator('.bf26-grade strong').textContent() || '').trim();
  const gradeMatch = gradeText.match(/^(\d+(?:\.\d+)?)\s+\/\s+100$/u);
  assert.ok(gradeMatch, 'Total Forecast grade is missing or malformed.');
  const totalScore = Number(gradeMatch[1]);
  assert.ok(Number.isFinite(totalScore) && totalScore >= 0 && totalScore <= 100);

  const results = await page.locator('.bf26-result').evaluateAll((items) => items.map((item) => {
    const sections = new Map([...item.querySelectorAll('.bf26-result-section')].map((section) => [
      section.querySelector('h4')?.textContent?.trim() || '',
      section.querySelector('p')?.textContent?.trim() || '',
    ]));
    return {
      userAnswer: sections.get('Your answer') || '',
      feedbackLength: (sections.get('Feedback') || '').length,
      suggestedAnswerLength: (sections.get('Suggested answer') || '').length,
      explanationLength: (sections.get('Explanation') || '').length,
    };
  }));
  assert.equal(results.length, 20);
  results.forEach((result, index) => {
    const expectedMarker = `${marker}-Q${index + 1}`;
    assert.ok(result.userAnswer.includes(expectedMarker), `Result ${index + 1} belongs to another attempt.`);
    const observedMarkers = result.userAnswer.match(/F30-[A-Z0-9-]+-J\d+-Q\d+/giu) || [];
    assert.deepEqual(observedMarkers, [expectedMarker], `Result ${index + 1} mixed attempt markers.`);
    assert.ok(result.feedbackLength > 0, `Result ${index + 1} is missing feedback.`);
    assert.ok(result.suggestedAnswerLength > 0, `Result ${index + 1} is missing a suggested answer.`);
    assert.ok(result.explanationLength > 0, `Result ${index + 1} is missing an explanation.`);
  });
  return Object.freeze({ totalScore, results: results.length });
}

function assertForecastNetwork(events) {
  const statuses = (operation) => events
    .filter((event) => event.operation === operation)
    .map((event) => event.status);
  assert.ok(statuses('status').includes(200), 'The live status request did not succeed.');
  assert.ok(statuses('accept').includes(200), 'The live consent request did not succeed.');
  assert.ok(statuses('start').includes(409), 'The pre-consent start request was not rejected.');
  assert.ok(statuses('start').includes(200), 'The post-consent start request did not succeed.');
  assert.ok(statuses('submit').includes(200), 'The live submission request did not succeed.');
  assert.equal(events.some((event) => event.failed), false, 'A live Forecast request failed at the network layer.');
  assert.equal(
    events.every((event) => Number.isInteger(event.status)),
    true,
    'Every live Forecast request must have a completed HTTP response.',
  );
  const apiOperations = events.map((event) => `${event.operation}:${event.status}`);
  const required = Object.freeze({
    'accept:200': 1,
    'start:409': 1,
    'start:200': 1,
    'submit:200': 1,
  });
  for (const [operation, count] of Object.entries(required)) {
    assert.equal(
      apiOperations.filter((value) => value === operation).length,
      count,
      `The live journey must issue exactly ${count} ${operation} request.`,
    );
  }
  const statusCount = apiOperations.filter((value) => value === 'status:200').length;
  assert.ok(
    statusCount === 1 || statusCount === 2,
    'The live journey may issue only one required and one optional duplicate status request.',
  );
  assert.equal(
    apiOperations.length,
    4 + statusCount,
    'The live journey issued an unapproved or extra Forecast request.',
  );
  assert.deepEqual(apiOperations, [
    ...Array.from({ length: statusCount }, () => 'status:200'),
    'start:409',
    'accept:200',
    'start:200',
    'submit:200',
  ], 'The live Forecast operations occurred out of the approved order.');
  return Object.freeze(apiOperations);
}

async function runJourney(browser, account, ordinal, startOffsetMs) {
  const startedAt = Date.now();
  const subject = SUBJECTS[(ordinal - 1) % SUBJECTS.length];
  const marker = `${runId.toUpperCase()}-J${ordinal}`;
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: false,
  });
  activeContexts.add(context);
  maximumActiveContexts = Math.max(maximumActiveContexts, activeContexts.size);
  assert.ok(maximumActiveContexts <= config.concurrency && maximumActiveContexts <= MAX_CONCURRENCY);
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  const events = [];
  const eventByRequest = new WeakMap();
  let pageErrors = 0;
  let consoleErrors = 0;
  page.on('pageerror', () => { pageErrors += 1; });
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors += 1; });
  page.on('request', (request) => {
    let url;
    try { url = new URL(request.url()); } catch { return; }
    if (url.pathname !== FORECAST_PATH) return;
    let operation = '';
    try { operation = String(request.postDataJSON()?.operation || ''); } catch { operation = ''; }
    const event = { operation, status: null, failed: false };
    events.push(event);
    eventByRequest.set(request, event);
  });
  page.on('response', (response) => {
    const event = eventByRequest.get(response.request());
    if (event) event.status = response.status();
  });
  page.on('requestfailed', (request) => {
    const event = eventByRequest.get(request);
    if (event) event.failed = true;
  });

  let primaryError = null;
  let signOutCompleted = false;
  let journeyPhase = 'AUTHENTICATE';
  try {
    await authenticate(page, account);
    journeyPhase = 'NOTICE';
    await page.getByRole('heading', { name: 'Notice & Disclaimer' }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-subject]').count(), 0, 'Subject selection appeared before consent.');
    journeyPhase = 'CONSENT_GATE';
    await assertServerConsentGate(page, subject);

    journeyPhase = 'CONSENT_ACCEPT';
    await page.getByRole('button', { name: 'I Understand & Agree' }).click();
    await page.getByRole('heading', { name: 'Choose a 2026 Bar subject.' }).waitFor({ state: 'visible' });
    const offeredSubjects = await page.locator('[data-subject]').evaluateAll(
      (buttons) => buttons.map((button) => button.dataset.subject),
    );
    assert.deepEqual(offeredSubjects, SUBJECTS);
    journeyPhase = 'SUBJECT_START';
    await page.locator('[data-subject]').nth(SUBJECTS.indexOf(subject)).click();
    await page.locator('.bf26-exam').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.bf26-question-jump').count(), 20);

    journeyPhase = 'ANSWERS';
    await fillAllAnswers(page, marker);
    page.once('dialog', (dialog) => dialog.accept());
    const submit = page.locator('.bf26-exam-footer').getByRole('button', { name: 'Submit all answers' });
    assert.equal(await submit.isEnabled(), true);
    journeyPhase = 'SUBMIT';
    await submit.click();
    journeyPhase = 'RESULTS';
    const proof = await resultProof(page, marker);
    journeyPhase = 'NETWORK';
    const apiOperations = assertForecastNetwork(events);
    assert.equal(pageErrors, 0, 'The Forecast page emitted an uncaught browser error.');

    journeyPhase = 'CONSENT_PERSISTENCE';
    const consentRows = await serviceRows(
      'dd2026_bar_forecast_consents',
      `user_id=eq.${encodeURIComponent(account.userId)}&consent_version=eq.${CONSENT_VERSION}&select=user_id`,
    );
    assert.equal(consentRows.length, 1, 'The accepted Forecast consent row is missing.');
    return Object.freeze({
      ordinal,
      subject,
      passed: true,
      totalScore: proof.totalScore,
      resultCount: proof.results,
      consentGate: true,
      flag: true,
      highlight: true,
      formatting: true,
      uniqueAttempt: true,
      apiOperations,
      startOffsetMs,
      pageErrors,
      consoleErrors,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    primaryError = phaseFailure(error, `JOURNEY_${journeyPhase}`);
    throw primaryError;
  } finally {
    signOutCompleted = await globallySignOut(page);
    await context.close().catch(() => {});
    activeContexts.delete(context);
    if (!signOutCompleted && !primaryError) {
      throw new Error('The disposable Forecast browser session was not globally signed out.');
    }
  }
}

function startGate() {
  let chain = Promise.resolve();
  let lastStart = 0;
  let firstStart = 0;
  return async () => {
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const previous = chain;
    chain = current;
    await previous;
    try {
      const remaining = Math.max(0, config.startIntervalMs - (Date.now() - lastStart));
      if (remaining) await delay(remaining, undefined, { signal: stopController.signal });
      if (stopSignal) throw new Error(`Forecast E2E interrupted by ${stopSignal}.`);
      lastStart = Date.now();
      if (!firstStart) firstStart = lastStart;
      return lastStart - firstStart;
    } finally {
      release();
    }
  };
}

async function loadChromium() {
  try {
    return require('playwright').chromium;
  } catch {
    throw new Error('Playwright 1.54.2 is required. Install it without saving before this controlled run.');
  }
}

async function verifyUnauthenticatedProductRoot(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto(`${config.siteUrl}/?forecast-e2e-preflight=${encodeURIComponent(runId)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    const proof = await page.evaluate(async (releaseSha) => {
      const releaseResponse = await fetch(`/.well-known/duediligence-release.txt?release=${releaseSha}`, {
        cache: 'no-store',
      });
      return {
        title: document.title,
        synthetic: /Synthetic UI QA Harness|local-preview-token|Mock Permit/u.test(document.documentElement.innerHTML),
        releaseStatus: releaseResponse.status,
        releaseSha: (await releaseResponse.text()).trim().toLowerCase(),
      };
    }, config.releaseSha);
    assert.deepEqual(proof, {
      title: 'Due Diligence — Philippine Bar Exam Simulator',
      synthetic: false,
      releaseStatus: 200,
      releaseSha: config.releaseSha,
    });
  } finally {
    await context.close();
  }
}

async function proveNonAdministratorDenied(browser, account) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  activeContexts.add(context);
  maximumActiveContexts = Math.max(maximumActiveContexts, activeContexts.size);
  assert.ok(maximumActiveContexts <= MAX_CONCURRENCY);
  const page = await context.newPage();
  let signOutCompleted = false;
  try {
    await page.goto(`${config.siteUrl}/?forecast-e2e-denial=${encodeURIComponent(runId)}#bar-forecast-2026`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForFunction(
      () => Boolean(window.supabase?.createClient && window.DueDiligencePhase2Config?.supabase),
      null,
      { timeout: 30_000 },
    );
    const result = await page.evaluate(async ({ credentials, expectedPath, subject }) => {
      const configuration = window.DueDiligencePhase2Config;
      const client = window.supabase.createClient(
        configuration.supabase.url,
        configuration.supabase.publishableKey,
        {
          auth: {
            persistSession: true,
            storage: window.DueDiligenceAuthSessionStorage?.prepare?.(configuration.supabase.url)
              || window.localStorage
              || window.sessionStorage,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        },
      );
      const { data, error } = await client.auth.signInWithPassword(credentials);
      if (error || !data?.session?.access_token) {
        return { authenticated: false, userId: '', status: 0, code: '', questionCount: 0 };
      }
      const response = await fetch(`${configuration.workerUrl}${expectedPath}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ operation: 'start', subject }),
      });
      const body = await response.json().catch(() => null);
      return {
        authenticated: true,
        userId: data.user?.id || '',
        status: response.status,
        code: body?.error?.code || '',
        questionCount: Array.isArray(body?.questions) ? body.questions.length : 0,
      };
    }, {
      credentials: { email: account.email, password: account.password },
      expectedPath: FORECAST_PATH,
      subject: SUBJECTS[0],
    });
    assert.deepEqual(result, {
      authenticated: true,
      userId: account.userId,
      status: 403,
      code: 'BAR_FORECAST_ADMIN_FORBIDDEN',
      questionCount: 0,
    });
    return Object.freeze({ authenticated: true, denied: true, status: 403 });
  } finally {
    signOutCompleted = await globallySignOut(page);
    await context.close().catch(() => {});
    activeContexts.delete(context);
    if (!signOutCompleted) {
      throw new Error('The denial-probe browser session was not globally signed out.');
    }
  }
}

async function main() {
  setDiagnosticStage('browser_launch');
  const chromium = await loadChromium();
  const launchOptions = {
    headless: true,
    ...(config.browserChannel === 'bundled' ? {} : { channel: config.browserChannel }),
  };
  const browser = await chromium.launch(launchOptions);
  const cleanupErrors = [];
  const administratorAccounts = [];
  let primaryError = null;
  let primaryFailureStage = '';
  let nonAdministratorDenial = null;
  try {
    setDiagnosticStage('public_root');
    await verifyUnauthenticatedProductRoot(browser);
    setDiagnosticStage('non_admin_create');
    const nonAdministrator = await createDisposableNonAdministrator();
    setDiagnosticStage('admin_create');
    for (let slot = 1; slot <= config.concurrency; slot += 1) {
      administratorAccounts.push(await createDisposableAdministrator(slot));
    }
    setDiagnosticStage('classification');
    await awaitInternalTestClassification([nonAdministrator, ...administratorAccounts]);
    setDiagnosticStage('non_admin_denial');
    nonAdministratorDenial = await proveNonAdministratorDenied(browser, nonAdministrator);

    setDiagnosticStage('journeys');
    let nextOrdinal = 1;
    let firstFailure = null;
    const waitForStart = startGate();
    const worker = async (account) => {
      while (!firstFailure && !stopSignal) {
        const ordinal = nextOrdinal;
        if (ordinal > JOURNEY_COUNT) return;
        nextOrdinal += 1;
        try {
          await resetForecastConsent(account.userId);
          const startOffsetMs = await waitForStart();
          const result = await runJourney(browser, account, ordinal, startOffsetMs);
          completedJourneys.push(result);
          process.stderr.write(`Forecast E2E journey ${ordinal}/${JOURNEY_COUNT} passed (${result.subject}).\n`);
        } catch (error) {
          firstFailure ||= error;
        }
      }
    };
    await Promise.all(administratorAccounts.map(worker));
    if (firstFailure) throw firstFailure;
    if (stopSignal) throw new Error(`Forecast E2E interrupted by ${stopSignal}.`);
    assert.equal(completedJourneys.length, JOURNEY_COUNT, 'The harness did not complete exactly 30 journeys.');
  } catch (error) {
    primaryError = error;
    primaryFailureStage = diagnosticStage;
  } finally {
    setDiagnosticStage('cleanup');
    for (const context of activeContexts) await context.close().catch(() => {});
    await browser.close().catch((error) => cleanupErrors.push(error));
    for (const account of [...createdAccounts].reverse()) {
      await cleanupDisposableAdministrator(account).catch((error) => cleanupErrors.push(error));
    }
    cleanupFailed = cleanupErrors.length > 0;
  }

  if (cleanupErrors.length) {
    diagnosticStage = primaryFailureStage || 'cleanup';
    throw new AggregateError(
      primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors,
      'Forecast E2E failed to complete exact cleanup.',
    );
  }
  if (primaryError) {
    diagnosticStage = primaryFailureStage;
    throw primaryError;
  }

  setDiagnosticStage('evidence');
  completedJourneys.sort((left, right) => left.ordinal - right.ordinal);
  const subjectCounts = Object.fromEntries(SUBJECTS.map((subject) => [
    subject,
    completedJourneys.filter((result) => result.subject === subject).length,
  ]));
  assert.deepEqual(
    Object.values(subjectCounts),
    SUBJECTS.map(() => JOURNEY_COUNT / SUBJECTS.length),
    'The exact 30-journey subject rotation is incomplete.',
  );
  assert.equal(new Set(completedJourneys.map((result) => result.ordinal)).size, JOURNEY_COUNT);
  const startOffsets = completedJourneys
    .map((result) => result.startOffsetMs)
    .sort((left, right) => left - right);
  assert.equal(startOffsets[0], 0, 'Observed journey timing must begin at a zero offset.');
  const observedStartGaps = startOffsets.slice(1).map((offset, index) => (
    offset - startOffsets[index]
  ));
  const observedMinimumStartIntervalMs = Math.min(...observedStartGaps);
  assert.ok(
    observedMinimumStartIntervalMs >= config.startIntervalMs,
    'Observed journey starts violated the configured release-gate spacing.',
  );
  const scores = completedJourneys.map((result) => result.totalScore);
  const summary = {
    ok: true,
    target: config.targetName,
    releaseSha: config.releaseSha,
    githubRunId: config.githubRunId,
    runId,
    journeysRequested: JOURNEY_COUNT,
    journeysPassed: completedJourneys.length,
    concurrency: config.concurrency,
    maximumActiveContexts,
    startIntervalMs: config.startIntervalMs,
    observedMinimumStartIntervalMs,
    subjects: subjectCounts,
    proof: {
      realForecastHttpJourneys: completedJourneys.length,
      nonAdministratorDenied: nonAdministratorDenial?.denied === true,
      consentGateRejections: completedJourneys.filter((result) => result.consentGate).length,
      twentyAnswerSubmissions: completedJourneys.filter((result) => result.resultCount === 20).length,
      flags: completedJourneys.filter((result) => result.flag).length,
      highlights: completedJourneys.filter((result) => result.highlight).length,
      editorFormatting: completedJourneys.filter((result) => result.formatting).length,
      totalGrades: scores.length,
      suggestedAnswerAndExplanationSets: completedJourneys.filter((result) => result.resultCount === 20).length,
      uniqueAttemptIsolation: completedJourneys.filter((result) => result.uniqueAttempt).length,
    },
    grades: {
      minimum: Math.min(...scores),
      maximum: Math.max(...scores),
      average: Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2)),
    },
    cleanup: {
      disposableAccountsCreated: createdAccounts.length,
      disposableAccountsDeleted: createdAccounts.filter((account) => account.deleted).length,
      usageResidueAccountsVerified: createdAccounts.filter(
        (account) => account.usageResidueVerified,
      ).length,
      disposableAdministratorsCreated: createdAccounts.filter((account) => account.kind === 'administrator').length,
      disposableAdministratorsDeleted: createdAccounts.filter(
        (account) => account.kind === 'administrator' && account.deleted,
      ).length,
      browserContextsOpen: activeContexts.size,
      complete: createdAccounts.every(
        (account) => account.deleted && account.usageResidueVerified,
      ) && activeContexts.size === 0,
    },
    secretsLogged: false,
    journeys: completedJourneys,
  };
  const serialized = JSON.stringify(summary, null, 2);
  for (const sensitive of sensitiveValues) assert.equal(serialized.includes(sensitive), false);
  process.stdout.write(`${serialized}\n`);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    target: config.targetName,
    releaseSha: config.releaseSha,
    githubRunId: config.githubRunId,
    runId,
    error: errorSummary(error),
    diagnostic: {
      stage: diagnosticStage,
      cleanupFailed,
      journeysPassed: completedJourneys.length,
    },
    cleanup: {
      disposableAccountsCreated: createdAccounts.length,
      disposableAccountsDeleted: createdAccounts.filter((account) => account.deleted).length,
      usageResidueAccountsVerified: createdAccounts.filter(
        (account) => account.usageResidueVerified,
      ).length,
      disposableAdministratorsCreated: createdAccounts.filter((account) => account.kind === 'administrator').length,
      disposableAdministratorsDeleted: createdAccounts.filter(
        (account) => account.kind === 'administrator' && account.deleted,
      ).length,
      browserContextsOpen: activeContexts.size,
      complete: createdAccounts.every(
        (account) => account.deleted && account.usageResidueVerified,
      ) && activeContexts.size === 0,
    },
    secretsLogged: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
});

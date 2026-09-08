import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { analyticsFixture, OWNER, OTHER, SCOPE_ID } from './forecast-analytics-test-fixture.mjs';
import { validateForecastAnalyticsScope, buildForecastAnalyticsEmail, assertForecastAnalyticsPdfSize } from './forecast-analytics-core.mjs';
import { createForecastAnalyticsExporter, FORECAST_ANALYTICS_RPC_NAMES } from './forecast-analytics-export.mjs';
import { normalizeBarForecastRequest } from './bar-forecast-core.mjs';
import { createBarForecastHandlers } from './bar-forecast-routes.mjs';
import { sendForecastResultEmail } from './forecast-email-adapter.mjs';

const data = await analyticsFixture(2);
const USER = { id: OWNER, email: 'synthetic-owner@example.test', email_confirmed_at: '2026-09-07T00:00:00Z' };
const HASH = 'a'.repeat(64);
function fixture(options = {}) {
  const calls = []; const sends = []; let accepted = false;
  const rpc = async (_env, name, args) => {
    calls.push({ name, args });
    if (options.rpc) return options.rpc(name, args);
    if (name === 'dd2026_forecast_analytics_get' || name === 'dd2026_forecast_analytics_snapshot') return { ok: true, scope: data.scope };
    if (name === 'dd2026_forecast_analytics_attempt') return { ok: true, scopeId: SCOPE_ID,
      scopeHash: data.scope.scopeHash, resultHash: data.scope.manifest[0].resultHash, attempt: data.attempts[0] };
    if (name === 'dd2026_forecast_analytics_browser_prepared') return { ok: true, recorded: true, clientReported: true };
    if (name === 'dd2026_forecast_analytics_email_claim') return accepted ? { ok: true, claimed: false, email: { status: 'provider_accepted' } }
      : { ok: true, claimed: true, leaseToken: OTHER, idempotencyKey: `forecast-analytics/${SCOPE_ID}/v1` };
    if (name === 'dd2026_forecast_analytics_email_settle') { accepted = args.p_status === 'provider_accepted'; return { ok: true, email: { status: args.p_status } }; }
    assert.fail('Unexpected inert RPC');
  };
  const exporter = createForecastAnalyticsExporter({ rpc,
    resolveVerifiedUser: options.resolveVerifiedUser || (async () => USER),
    assertEmailAvailable: options.assertEmailAvailable || (() => {}),
    sendEmail: async (_env, message) => { sends.push(message); return options.send ? options.send(message) : { accepted: true, providerMessageId: 'inert-accepted' }; } });
  return { exporter, calls, sends };
}

test('scope normalization is exact, complete-only and never accepts owners, recipients or PDF bytes', () => {
  const valid = [
    { operation: 'analytics_snapshot', requestId: OTHER },
    { operation: 'analytics_report', scopeId: SCOPE_ID },
    { operation: 'analytics_attempt', scopeId: SCOPE_ID, attemptId: data.attempts[0].id },
    { operation: 'analytics_email', scopeId: SCOPE_ID },
    { operation: 'analytics_pdf_prepared', scopeId: SCOPE_ID, scopeHash: HASH, pdfVersion: 'forecast-analytics-pdf-v1', byteCount: 120 },
  ];
  for (const body of valid) {
    assert.equal(normalizeBarForecastRequest(body).operation, body.operation);
    for (const extra of [{ ownerId: OTHER }, { recipient: 'different@example.test' }, { bytes: 'PDF' }]) {
      assert.throws(() => normalizeBarForecastRequest({ ...body, ...extra }));
    }
  }
  assert.throws(() => normalizeBarForecastRequest({ operation: 'analytics_pdf', scopeId: SCOPE_ID }), { code: 'BAR_FORECAST_OPERATION_INVALID' });
  for (const extra of [{ completeOnly: false }, { limit: 20 }, { before: OTHER }]) assert.throws(() => normalizeBarForecastRequest({ ...valid[0], ...extra }));
  for (const value of [0, -1, 10485761, 1.2, '120']) assert.throws(() => normalizeBarForecastRequest({ ...valid[4], byteCount: value }));
  assert.throws(() => normalizeBarForecastRequest({ ...valid[4], scopeHash: 'wrong' }));
  assert.equal(normalizeBarForecastRequest({ operation: 'history', includeClassifications: true }).includeClassifications, true);
  assert.throws(() => normalizeBarForecastRequest({ operation: 'history', includeClassifications: 'true' }));
});

test('canonical scope validation rejects foreign owner, duplicate/missing members and score drift', () => {
  const before = JSON.stringify(data);
  validateForecastAnalyticsScope(data.scope, OWNER, data.attempts);
  assert.throws(() => validateForecastAnalyticsScope(data.scope, OTHER));
  assert.throws(() => validateForecastAnalyticsScope({ ...data.scope, manifest: [data.scope.manifest[0], data.scope.manifest[0]] }, OWNER));
  assert.throws(() => validateForecastAnalyticsScope(data.scope, OWNER, data.attempts.slice(0, 1)));
  const changed = structuredClone(data.attempts); changed[0].result.totalScore = 1;
  assert.throws(() => validateForecastAnalyticsScope(data.scope, OWNER, changed));
  assert.equal(JSON.stringify(data), before);
});

test('scope email remains bounded at1000 members and contains only saved summary/private scope link', () => {
  const scope = structuredClone(data.scope);
  scope.manifest = Array.from({ length: 1000 }, (_, i) => ({ ...scope.manifest[0], attemptId: `77777777-7777-4777-8777-${String(i).padStart(12, '0')}` }));
  scope.analytics.completedAttempts = 1000; scope.analytics.bySubject[0].completedAttempts = 1000;
  const message = buildForecastAnalyticsEmail(scope, OWNER);
  assert.ok(message.text.length < 32000); assert.ok(message.html.length < 64000);
  assert.match(message.text, /1000 complete valid attempts \| Average 0%/u);
  assert.match(message.text, new RegExp(`https://duediligence.ph/\\?forecastAnalytics=${SCOPE_ID}#verdict`, 'u'));
  assert.doesNotMatch(message.text, /77777777|forecastAttempt|complete PDF is attached/u);
  assert.match(message.html, /No PDF is attached/u);
  assert.equal(message.attachment, undefined);
  assert.throws(() => assertForecastAnalyticsPdfSize(scope), { code: 'BAR_FORECAST_ANALYTICS_SIZE_LIMIT' });
  assert.doesNotThrow(() => assertForecastAnalyticsPdfSize({ manifest: Array(19) }));
  assert.throws(() => assertForecastAnalyticsPdfSize({ manifest: Array(20) }));
});

test('metadata and one member are owner-bound RPC reads with no hydration flag or grading call', async () => {
  const f = fixture(); await f.exporter.get({}, USER, SCOPE_ID);
  await f.exporter.attempt({}, USER, SCOPE_ID, data.attempts[0].id);
  assert.deepEqual(f.calls.map(row => row.name), ['dd2026_forecast_analytics_get', 'dd2026_forecast_analytics_attempt']);
  assert.equal(f.calls.every(row => row.args.p_actor_user_id === OWNER && row.args.p_scope_id === SCOPE_ID), true);
  assert.equal(f.calls.some(row => Object.hasOwn(row.args, 'p_with_answers')), false);
  assert.equal(f.sends.length, 0);
  const mismatched = fixture({ rpc: () => ({ ok: true, scopeId: OTHER, scopeHash: HASH, resultHash: HASH, attempt: data.attempts[0] }) });
  await assert.rejects(mismatched.exporter.attempt({}, USER, SCOPE_ID, data.attempts[0].id), { code: 'BAR_FORECAST_ANALYTICS_INVALID' });
});

test('browser prepared observation is typed and makes no server PDF verification claim', async () => {
  const f = fixture(); const response = await f.exporter.prepared({}, USER, { scopeId: SCOPE_ID, scopeHash: HASH, pdfVersion: 'forecast-analytics-pdf-v1', byteCount: 321 });
  assert.equal(response.clientReported, true); assert.equal(f.sends.length, 0);
  assert.deepEqual(Object.keys(f.calls[0].args).sort(), ['p_actor_user_id', 'p_byte_count', 'p_pdf_version', 'p_scope_hash', 'p_scope_id']);
  assert.equal(FORECAST_ANALYTICS_RPC_NAMES.includes('dd2026_forecast_analytics_pdf_record'), false);
  const source = await readFile(new URL('./forecast-analytics-export.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /buildForecast.*Pdf|PDFDocument|renderPdf|attachment\s*:/u);
});

test('summary email preserves immutable hash/template/key and accepted replay never re-sends', async () => {
  const f = fixture(); const before = JSON.stringify(data.scope);
  assert.equal((await f.exporter.email({}, USER, SCOPE_ID)).email.status, 'provider_accepted');
  assert.equal((await f.exporter.email({}, USER, SCOPE_ID)).email.status, 'provider_accepted');
  assert.equal(f.sends.length, 1); const message = f.sends[0];
  assert.equal(message.deliveryKind, 'summary_link'); assert.equal(message.attachment, undefined);
  assert.equal(message.to, USER.email); assert.equal(message.idempotencyKey, `forecast-analytics/${SCOPE_ID}/v1`);
  const claim = f.calls.find(row => row.name.endsWith('_email_claim')).args;
  assert.equal(claim.p_scope_hash, data.scope.scopeHash); assert.equal(claim.p_template_version, 'forecast-analytics-email-summary-v1');
  assert.equal(claim.p_payload_hash, createHash('sha256').update(JSON.stringify([
    'forecast-analytics-email-summary-v1', '', message.subject, message.text, message.html])).digest('hex'));
  assert.equal(JSON.stringify(data.scope), before);
});

test('changing the configured sender conflicts with the same immutable scope key before another provider send', async () => {
  let claimedHash; let accepted = false;
  const f = fixture({ rpc: (name, args) => {
    if (name.endsWith('_get')) return { ok: true, scope: data.scope };
    if (name.endsWith('_claim')) {
      if (claimedHash && claimedHash !== args.p_payload_hash) return { ok: false,
        error: { code: 'BAR_FORECAST_EXPORT_CONFLICT', status: 409, message: 'Saved email content changed.' } };
      claimedHash = args.p_payload_hash;
      return accepted ? { ok: true, claimed: false, email: { status: 'provider_accepted' } }
        : { ok: true, claimed: true, leaseToken: OTHER, idempotencyKey: `forecast-analytics/${SCOPE_ID}/v1` };
    }
    if (name.endsWith('_settle')) { accepted = true; return { ok: true, email: { status: args.p_status } }; }
    assert.fail('Unexpected inert RPC');
  } });
  const env = { FORECAST_RESULTS_EMAIL_FROM: 'Due Diligence <support@duediligence.ph>' };
  assert.equal((await f.exporter.email(env, USER, SCOPE_ID)).email.status, 'provider_accepted');
  const message = f.sends[0];
  assert.equal(claimedHash, createHash('sha256').update(JSON.stringify([
    'forecast-analytics-email-summary-v1', env.FORECAST_RESULTS_EMAIL_FROM,
    message.subject, message.text, message.html])).digest('hex'));
  assert.equal((await f.exporter.email(env, USER, SCOPE_ID)).email.status, 'provider_accepted');
  await assert.rejects(f.exporter.email({ ...env, FORECAST_RESULTS_EMAIL_FROM: 'Changed <support@duediligence.ph>' }, USER, SCOPE_ID),
    { code: 'BAR_FORECAST_EXPORT_CONFLICT', status: 409 });
  assert.equal(f.sends.length, 1);
  assert.equal(f.calls.filter(row => row.name.endsWith('_settle')).length, 1);
});

test('unverified or changed authenticated recipient cannot claim or send a scope email', async () => {
  for (const user of [{ ...USER, email_confirmed_at: null }, { ...USER, id: OTHER }]) {
    const f = fixture({ resolveVerifiedUser: async () => user });
    await assert.rejects(f.exporter.email({}, USER, SCOPE_ID), { code: 'BAR_FORECAST_VERIFIED_EMAIL_REQUIRED' });
    assert.equal(f.sends.length, 0); assert.equal(f.calls.length, 0);
  }
  const f = fixture({ assertEmailAvailable: () => { throw new Error('LOCAL_DISABLED'); } });
  await assert.rejects(f.exporter.email({}, USER, SCOPE_ID)); assert.equal(f.calls.length, 0);
  const asynchronous = fixture({ assertEmailAvailable: async () => { throw new Error('LOCAL_DISABLED'); } });
  await assert.rejects(asynchronous.exporter.email({}, USER, SCOPE_ID)); assert.equal(asynchronous.calls.length, 0);
  assert.equal(asynchronous.sends.length, 0);
});

test('provider uncertainty remains uncertain and settlement recovery never sends twice', async () => {
  const f = fixture({ send: () => { throw new Error('LOCAL_UNCERTAIN'); } });
  assert.equal((await f.exporter.email({}, USER, SCOPE_ID)).email.status, 'uncertain'); assert.equal(f.sends.length, 1);
  let settlements = 0;
  const g = fixture({ rpc: (name) => {
    if (name.endsWith('_get')) return { ok: true, scope: data.scope };
    if (name.endsWith('_claim')) return { ok: true, claimed: true, leaseToken: OTHER, idempotencyKey: `forecast-analytics/${SCOPE_ID}/v1` };
    if (name.endsWith('_settle')) { settlements++; throw new Error('LOCAL_LOST_ACK'); }
    assert.fail('Unexpected inert RPC');
  } });
  assert.equal((await g.exporter.email({}, USER, SCOPE_ID)).email.status, 'uncertain');
  assert.equal(settlements, 2); assert.equal(g.sends.length, 1);
});

test('all five scope operations require real route owner/entitlement/consent boundaries before handling', async () => {
  let consent = true, signedIn = true, allowed = true; const seen = [];
  const handlers = createBarForecastHandlers({ enforceBarForecastRateLimit: async () => {}, parseBoundedJson: request => request.json(),
    requireAuthenticatedUser: async () => { if (!signedIn) throw Object.assign(new Error('Sign in'), { status: 401 }); return USER; },
    authorizeAdministrator: async () => ({ authorized: allowed, role: allowed ? 'super_admin' : 'member' }),
    requiredSetupAccess: async () => ({ allowed, role: allowed ? 'super_admin' : 'member', basis: allowed ? 'super_admin' : 'payment_required',
      termsRequired: false, reauthenticationRequired: false, profileCompleted: true, tokenAcknowledgementRequired: false }),
    jsonResponse: (body, status) => Response.json(body, { status }),
    barForecastRpc: async (_env, name) => { assert.equal(name, 'dd2026_bar_forecast_consent_status'); return { consentAccepted: consent }; },
    structuredGemini: () => assert.fail('Scope actions cannot grade'),
    analyticsExporter: Object.fromEntries(['snapshot', 'get', 'attempt', 'prepared', 'email'].map(key => [key, async (_env, user) => { seen.push({ key, user }); return { ok: true }; }])),
  });
  for (const [operation, key, extra] of [['analytics_snapshot', 'snapshot', { requestId: OTHER }],
    ['analytics_report', 'get', { scopeId: SCOPE_ID }], ['analytics_attempt', 'attempt', { scopeId: SCOPE_ID, attemptId: OTHER }],
    ['analytics_email', 'email', { scopeId: SCOPE_ID }], ['analytics_pdf_prepared', 'prepared', { scopeId: SCOPE_ID, scopeHash: HASH, pdfVersion: 'forecast-analytics-pdf-v1', byteCount: 100 }]]) {
    const request = () => new Request('https://local.example.test/admin/dd2026/bar-forecast', { method: 'POST', body: JSON.stringify({ operation, ...extra }) });
    const response = await handlers.handle(request(), {}); assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control'), /private, no-store/u);
    assert.equal(seen.at(-1).key, key); assert.equal(seen.at(-1).user.id, OWNER); const count = seen.length;
    consent = false; await assert.rejects(handlers.handle(request(), {}), { code: 'BAR_FORECAST_CONSENT_REQUIRED' }); consent = true;
    signedIn = false; await assert.rejects(handlers.handle(request(), {}), { status: 401 }); signedIn = true;
    allowed = false; await assert.rejects(handlers.handle(request(), {}), { code: 'BAR_FORECAST_ACCESS_REQUIRED' }); allowed = true;
    assert.equal(seen.length, count);
  }
});

test('unchanged current provider adapter accepts the exact summary-only scope delivery', async () => {
  const f = fixture(); await f.exporter.email({}, USER, SCOPE_ID); let calls = 0;
  const env = { FORECAST_RESULTS_EMAIL_MODE: 'enabled', RESEND_API_KEY: 'inert', FORECAST_RESULTS_EMAIL_FROM: 'Due Diligence <support@duediligence.ph>' };
  const result = await sendForecastResultEmail(env, f.sends[0], async (_url, options) => {
    calls++; const body = JSON.parse(options.body); assert.equal(body.attachments, undefined);
    assert.equal(options.headers['Idempotency-Key'], `forecast-analytics/${SCOPE_ID}/v1`); return Response.json({ id: 'inert-provider-id' });
  });
  assert.equal(result.accepted, true); assert.equal(calls, 1);
});

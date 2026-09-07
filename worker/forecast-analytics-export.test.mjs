import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import { fixture, OWNER, OTHER, USER, MIGRATION } from './forecast-analytics-test-fixture.mjs';
import { buildForecastAnalyticsPdf, buildForecastAnalyticsEmail, createForecastAnalyticsExporter, forecastAnalyticsFileName, validateForecastAnalyticsScope } from './forecast-analytics-export.mjs';
import { normalizeBarForecastRequest, BAR_FORECAST_SUBJECTS } from './bar-forecast-core.mjs';
import { createBarForecastHandlers } from './bar-forecast-routes.mjs';
import { sendForecastResultEmail } from './forecast-email-adapter.mjs';

const HASH = 'a'.repeat(64);
const PDF = new TextEncoder().encode('%PDF-local-journal-fixture');
const errorCode = (value, code) => { assert.equal(value.ok, false); assert.equal(value.error.code, code); };

test('scope operations reject caller identities, recipients, scores, cursors and unzoned filters', () => {
  for (const operation of ['analytics_report', 'analytics_pdf', 'analytics_email']) {
    assert.deepEqual(normalizeBarForecastRequest({ operation, scopeId: OWNER }), { operation, scopeId: OWNER });
    for (const extra of [{ ownerId: OTHER }, { recipient: 'other@example.test' }, { percentage: 100 }, { attemptId: OTHER }]) {
      assert.throws(() => normalizeBarForecastRequest({ operation, scopeId: OWNER, ...extra }));
    }
  }
  const request = { operation: 'analytics_snapshot', requestId: OWNER };
  assert.equal(normalizeBarForecastRequest(request).subject, null);
  for (const extra of [{ before: OWNER }, { limit: 20 }, { completeOnly: false }, { from: '2026-09-01' }, { subject: 'Unknown' }, { from: '2026-09-02T00:00:00Z', to: '2026-09-01T00:00:00Z' }]) {
    assert.throws(() => normalizeBarForecastRequest({ ...request, ...extra }));
  }
});

test('the forward migration preserves every selected-report claim guard except the shared quota source', async () => {
  const old = await readFile(new URL('../supabase/migrations/20260907064532_astra_forecast_result_exports.sql', import.meta.url), 'utf8');
  const next = await readFile(new URL(`../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8');
  const body = (source) => source.match(/function public\.dd2026_forecast_result_email_claim\([\s\S]+?as \$\$([\s\S]+?)\$\$;/u)[1].replace(/--[^\n]*/gu, '').replace(/\s+/gu, ' ').trim();
  assert.equal(body(next), body(old).replace(/\(select count\(\*\) from public\.dd2026_forecast_result_exports where owner_id=p_actor_user_id and email_requested_at>v_now-interval '24 hours'\)/u, 'public.dd2026_forecast_email_quota_used(p_actor_user_id)'));
  assert.doesNotMatch(next, /security definer/iu);
});

test('real local PostgreSQL scopes, classification, canonical PDF, immutable journals and shared quotas', async (t) => {
  const f = await fixture(); // Missing PGlite is a test failure, never a skip.
  try {
    const attempts = [];
    for (let i = 0; i < 21; i++) attempts.push(await f.complete({ score: i === 20 ? 0 : 4, long: i === 20 }));
    const pending = await f.accept();
    const failed = await f.accept();
    await f.db.query("update public.dd2026_forecast_attempts set status='failed' where id=$1", [failed.id]);
    const foreign = await f.complete({ ownerId: OTHER, score: 5 });
    const key = crypto.randomUUID(); const first = await f.snapshot({ p_request_id: key });
    assert.equal(first.ok, true);
    const full = first.scope;
    const last = attempts.at(-1);
    const one = (await f.snapshot({ p_from: last.completedAt })).scope;
    const call = (suffix, scope = one, args = {}) => f.rpc({}, `dd2026_forecast_analytics_${suffix}`, { p_actor_user_id: OWNER, p_scope_id: scope.id, ...args });
    const record = (scope = one, args = {}) => call('pdf_record', scope, { p_pdf_hash: HASH, p_file_name: forecastAnalyticsFileName(scope.id), p_byte_count: PDF.length, p_download: false, ...args });
    const claim = (scope = one, args = {}) => call('email_claim', scope, { p_recipient_email: USER.email, p_pdf_hash: HASH, ...args });

    await t.test('full 21-row scope exceeds the history page but keeps all complete attempts and excludes pending/failed/other-owner', async () => {
      assert.equal(full.manifest.length, 21); assert.equal(full.analytics.completedAttempts, 21);
      assert.equal(full.analytics.averagePercentage, 76.2); // 20 x 80, one real zero.
      assert.equal(full.analytics.pendingAttempts, 1); assert.equal(full.analytics.failedAttempts, 1);
      assert.equal(full.manifest.some((row) => [pending.id, failed.id, foreign.id].includes(row.attemptId)), false);
      const history = await f.store.history({}, OWNER, { limit: 20, completeOnly: true, includeClassifications: true });
      assert.equal(history.attempts.length, 20); assert.equal(history.analytics.completedAttempts, 21);
      assert.deepEqual(full.analytics, history.analytics);
      assert.equal(one.manifest.length, 1); assert.equal(one.analytics.averagePercentage, 0);
      assert.equal(one.manifest[0].attemptId, last.id);
    });
    await t.test('saved immutable unit/topic metadata has exact graded-question samples, attempt samples and separate unknown bucket', async () => {
      assert.deepEqual(full.analytics.classificationCoverage, { questionSamples: 420, completedAttempts: 21,
        unitClassifiedQuestions: 378, unitUnknownQuestions: 42, topicClassifiedQuestions: 378, topicUnknownQuestions: 42 });
      assert.equal(full.analytics.byUnit.length, 2); assert.equal(full.analytics.byTopic.length, 4);
      assert.equal(full.analytics.byUnit[0].questionSamples, 189); assert.equal(full.analytics.byUnit[0].completedAttempts, 21);
      assert.equal(full.analytics.byUnit[0].averageScore, 3.8);
      for (const malformed of ['not-json', '{}', JSON.stringify({ syllabus_unit_id: '../bad', syllabus_unit: 'Invalid' })]) {
        const result = await f.rpc({}, 'dd2026_forecast_analytics_saved_classification', { p_payload: malformed });
        assert.equal(result, null);
      }
      const unknown = await f.complete({ ownerId: OTHER, classified: false });
      const value = await f.snapshot({ p_actor_user_id: OTHER, p_from: unknown.completedAt });
      assert.equal(value.scope.analytics.byUnit.length, 0); assert.equal(value.scope.analytics.classificationCoverage.unitUnknownQuestions, 20);
    });
    await t.test('request replay is immutable across new results; identical content deduplicates; changed filters conflict', async () => {
      assert.equal((await f.snapshot()).scope.id, full.id);
      const newAttempt = await f.complete({ subject: BAR_FORECAST_SUBJECTS[1], score: 5 }); attempts.push(newAttempt);
      const replay = await f.snapshot({ p_request_id: key }); assert.deepEqual(replay.scope, full);
      errorCode(await f.snapshot({ p_request_id: key, p_subject: BAR_FORECAST_SUBJECTS[1] }), 'BAR_FORECAST_ANALYTICS_REQUEST_CONFLICT');
      const fresh = await f.snapshot(); assert.notEqual(fresh.scope.id, full.id); assert.equal(fresh.scope.manifest.length, 22);
      const scope = await f.snapshot({ p_subject: BAR_FORECAST_SUBJECTS[1] }); assert.equal(scope.scope.manifest.length, 1);
      errorCode(await f.snapshot({ p_subject: 'Invalid' }), 'BAR_FORECAST_HISTORY_INVALID');
      errorCode(await f.snapshot({ p_from: '2030-01-01T00:00:00Z' }), 'BAR_FORECAST_ANALYTICS_EMPTY');
      errorCode(await f.snapshot({ p_from: '2026-09-02T00:00:00Z', p_to: '2026-09-01T00:00:00Z' }), 'BAR_FORECAST_HISTORY_INVALID');
    });
    await t.test('time-zone-equivalent exact filters have the same frozen scope identity', async () => {
      const a = await f.snapshot({ p_from: '2020-01-01T00:00:00Z', p_to: '2030-01-01T00:00:00Z' });
      const b = await f.snapshot({ p_from: '2020-01-01T08:00:00+08:00', p_to: '2030-01-01T08:00:00+08:00' });
      assert.equal(a.scope.id, b.scope.id);
    });
    await t.test('ownership, access, service-only ACL and immutable scope/PDF fingerprints fail closed', async () => {
      errorCode(await call('get', one, { p_actor_user_id: OTHER }), 'BAR_FORECAST_ANALYTICS_NOT_FOUND');
      await f.db.query('update public.scope_fixture_access set allowed=false where owner_id=$1', [OWNER]);
      errorCode(await call('get'), 'BAR_FORECAST_ACCESS_REQUIRED'); errorCode(await f.snapshot(), 'BAR_FORECAST_ACCESS_REQUIRED');
      await f.db.query('update public.scope_fixture_access set allowed=true where owner_id=$1', [OWNER]);
      await assert.rejects(f.db.query("update public.dd2026_forecast_analytics_exports set analytics='{}' where id=$1", [one.id]), /immutable/u);
      for (const role of ['anon', 'authenticated']) {
        const permissions = (await f.db.query("select has_table_privilege($1,'public.dd2026_forecast_analytics_exports','SELECT') t,has_function_privilege($1,'public.dd2026_forecast_analytics_get(uuid,uuid,boolean)','EXECUTE') f", [role])).rows[0];
        assert.deepEqual(permissions, { t: false, f: false });
      }
      assert.equal((await f.db.query("select has_table_privilege('service_role','auth.users','SELECT') allowed")).rows[0].allowed, false);
      assert.equal((await record()).ok, true);
      errorCode(await record(one, { p_pdf_hash: 'b'.repeat(64) }), 'BAR_FORECAST_EXPORT_CONFLICT');
      errorCode(await record(one, { p_file_name: '../bad.pdf' }), 'BAR_FORECAST_EXPORT_INVALID');
    });
    await t.test('full canonical PDF has all answers, long Unicode text, frozen metadata, deterministic bytes and size refusal without truncation', async () => {
      const saved = await call('get', one, { p_with_answers: true });
      const bytes = await buildForecastAnalyticsPdf({ scope: one, ownerId: OWNER, attempts: saved.attempts });
      const again = await buildForecastAnalyticsPdf({ scope: one, ownerId: OWNER, attempts: saved.attempts });
      assert.deepEqual(bytes, again); const pdf = await PDFDocument.load(bytes); assert.ok(pdf.getPageCount() >= 22);
      assert.equal(pdf.getCreationDate().getTime(), Math.floor(Date.parse(one.createdAt) / 1000) * 1000); // PDF date precision is seconds.
      const email = buildForecastAnalyticsEmail(one, OWNER); assert.match(email.text, /0%/u); assert.match(email.html, /forecastAnalytics=/u);
      assert.doesNotMatch(email.html, /scope-owner@example|Answer 1:/u);
      const all = await call('get', full, { p_with_answers: true });
      await assert.rejects(buildForecastAnalyticsPdf({ scope: full, ownerId: OWNER, attempts: all.attempts }), { code: 'BAR_FORECAST_ANALYTICS_SIZE_LIMIT' });
      assert.throws(() => validateForecastAnalyticsScope(one, OTHER), { code: 'BAR_FORECAST_ANALYTICS_INVALID' });
      assert.throws(() => validateForecastAnalyticsScope(one, OWNER, []), { code: 'BAR_FORECAST_ANALYTICS_INVALID' });
      if (process.env.ASTRA_ANALYTICS_PDF_OUTPUT) {
        const path = process.env.ASTRA_ANALYTICS_PDF_OUTPUT; await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes);
        const python = process.env.ASTRA_PDF_PYTHON || 'python';
        const extracted = execFileSync(python, ['-c', 'import sys;from pypdf import PdfReader;print("\\n".join(p.extract_text() or "" for p in PdfReader(sys.argv[1]).pages))', path], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }).replace(/\s+/gu, ' ');
        assert.match(extracted, /End of long first answer/u); assert.match(extracted, /Final answer twenty: ₱149, Señor Niño, café/u);
        for (let i = 1; i <= 20; i++) assert.match(extracted, new RegExp(`Question ${i}:`, 'u'));
        assert.match(extracted, /Unknown unit classification: 2 answers/u); assert.match(extracted, /Scope page 1 \/ /u);
      }
    });
    await t.test('scope email has verified-self identity, exact claim replay and accepted settlement idempotency', async () => {
      errorCode(await claim(one, { p_recipient_email: 'other@example.test' }), 'BAR_FORECAST_VERIFIED_EMAIL_REQUIRED');
      const firstClaim = await claim(); assert.equal(firstClaim.claimed, true);
      assert.equal(firstClaim.idempotencyKey, `forecast-analytics/${one.id}/v1`);
      assert.equal((await claim()).claimed, false);
      const args = { p_lease_token: firstClaim.leaseToken, p_status: 'provider_accepted', p_provider_id: 'local-synthetic-provider' };
      assert.equal((await call('email_settle', one, args)).email.status, 'provider_accepted');
      assert.equal((await call('email_settle', one, args)).email.status, 'provider_accepted');
      assert.equal((await claim()).claimed, false);
      await assert.rejects(f.db.query("update public.dd2026_forecast_analytics_exports set email_status='failed' where id=$1", [one.id]), /immutable/u);
      await f.db.query('update auth.users set email=$2 where id=$1', [OWNER, 'changed@example.test']);
      errorCode(await claim(one, { p_recipient_email: 'changed@example.test' }), 'BAR_FORECAST_EMAIL_RECIPIENT_CHANGED');
      await f.db.query('update auth.users set email=$2 where id=$1', [OWNER, USER.email]);
    });
    await t.test('individual and scope requests share one five-per-day quota in both directions', async () => {
      const individualClaim = async (attempt) => {
        const args = { p_actor_user_id: OWNER, p_attempt_id: attempt.id, p_result_revision: 1, p_pdf_hash: HASH };
        const recorded = await f.rpc({}, 'dd2026_forecast_result_pdf_record', { ...args, p_file_name: `duediligence-forecast-${attempt.id}-r1.pdf`, p_byte_count: PDF.length, p_download: false });
        assert.equal(recorded.ok, true);
        return f.rpc({}, 'dd2026_forecast_result_email_claim', { ...args, p_recipient_email: USER.email });
      };
      // One scope is already counted; four individual requests fill the same quota.
      for (const attempt of attempts.slice(0, 4)) assert.equal((await individualClaim(attempt)).claimed, true);
      errorCode(await individualClaim(attempts[4]), 'BAR_FORECAST_EMAIL_RATE_LIMIT');
      await record(full); errorCode(await claim(full), 'BAR_FORECAST_EMAIL_RATE_LIMIT');
      assert.equal(Number(await f.rpc({}, 'dd2026_forecast_email_quota_used', { p_actor_user_id: OWNER })), 5);
      assert.equal((await claim(one)).claimed, false); // Accepted replay is not another quota unit.
    });
    await t.test('uncertain provider settlement never resends within a lease and uses the same provider key after bounded recovery', async () => {
      const scope = (await f.snapshot({ p_actor_user_id: OTHER, p_from: foreign.completedAt, p_to: new Date(Date.parse(foreign.completedAt) + 1).toISOString() })).scope;
      assert.ok(scope);
      let sends = 0; const keys = []; const otherUser = { ...USER, id: OTHER, email: 'other@example.test' };
      const exporter = createForecastAnalyticsExporter({ rpc: f.rpc, renderPdf: async () => PDF, sendEmail: async (_env, message) => { sends++; keys.push(message.idempotencyKey); assert.equal(message.to, otherUser.email); return { accepted: false }; } });
      const first = await exporter.email({}, otherUser, scope.id); assert.equal(first.email.status, 'uncertain'); assert.equal(sends, 1);
      await exporter.email({}, otherUser, scope.id); assert.equal(sends, 1);
      for (let execution = 2; execution <= 3; execution++) {
        await f.db.query("update public.dd2026_forecast_analytics_exports set email_retry_at=statement_timestamp()-interval '1 second' where id=$1", [scope.id]);
        await exporter.email({}, otherUser, scope.id); assert.equal(sends, execution);
      }
      await assert.rejects(exporter.email({}, otherUser, scope.id), { code: 'BAR_FORECAST_EMAIL_RETRY_LIMIT' });
      assert.equal(new Set(keys).size, 1);
      await assert.rejects(exporter.email({}, { ...otherUser, email_confirmed_at: null }, scope.id), { code: 'BAR_FORECAST_VERIFIED_EMAIL_REQUIRED' });
      const before = sends;
      await assert.rejects(createForecastAnalyticsExporter({ rpc: f.rpc, renderPdf: async () => PDF, sendEmail: () => sends++, resolveVerifiedUser: async () => USER }).email({}, otherUser, scope.id), { code: 'BAR_FORECAST_VERIFIED_EMAIL_REQUIRED' });
      assert.equal(sends, before);
    });
    await t.test('expired email leases advertise a finite same-key recovery; aged requests stop after 23 hours', async () => {
      const fresh = (await f.snapshot({ p_actor_user_id: OTHER, p_to: '2029-01-01T00:00:00Z' })).scope;
      const args = { p_actor_user_id: OTHER, p_recipient_email: 'other@example.test', p_pdf_hash: HASH };
      await record(fresh, { p_actor_user_id: OTHER });
      const firstClaim = await claim(fresh, args); assert.equal(firstClaim.claimed, true);
      await f.db.query("update public.dd2026_forecast_analytics_exports set email_lease_expires_at=statement_timestamp()-interval '1 second' where id=$1", [fresh.id]);
      const status = await call('get', fresh, { p_actor_user_id: OTHER }); assert.equal(status.email.status, 'uncertain'); assert.equal(status.email.retryAllowed, true);
      const next = await claim(fresh, args); assert.equal(next.claimed, true); assert.notEqual(next.leaseToken, firstClaim.leaseToken); assert.equal(next.idempotencyKey, firstClaim.idempotencyKey);
      errorCode(await call('email_settle', fresh, { p_actor_user_id: OTHER, p_lease_token: firstClaim.leaseToken, p_status: 'provider_accepted', p_provider_id: 'stale' }), 'BAR_FORECAST_EMAIL_LEASE_LOST');
      const aged = (await f.snapshot({ p_actor_user_id: OTHER, p_to: '2028-01-01T00:00:00Z' })).scope;
      await record(aged, { p_actor_user_id: OTHER });
      await f.db.query("update public.dd2026_forecast_analytics_exports set email_status='uncertain',email_requested_at=statement_timestamp()-interval '24 hours',email_retry_at=statement_timestamp()-interval '1 hour',email_executions=1 where id=$1", [aged.id]);
      errorCode(await claim(aged, args), 'BAR_FORECAST_EMAIL_RETRY_LIMIT');
      assert.equal((await call('get', aged, { p_actor_user_id: OTHER })).email.retryAllowed, false);
    });
    await t.test('lost committed acceptance acknowledgement settles idempotently without a second provider call', async () => {
      const scope = (await f.snapshot({ p_actor_user_id: OTHER, p_to: '2027-01-01T00:00:00Z' })).scope;
      let sends = 0, lost = true;
      const rpc = async (...args) => { const value = await f.rpc(...args); if (args[1] === 'dd2026_forecast_analytics_email_settle' && lost) { lost = false; throw new Error('Local lost committed response'); } return value; };
      const exporter = createForecastAnalyticsExporter({ rpc, renderPdf: async () => PDF, sendEmail: async () => { sends++; return { accepted: true, providerMessageId: 'local-accepted' }; } });
      const user = { ...USER, id: OTHER, email: 'other@example.test' };
      assert.equal((await exporter.email({}, user, scope.id)).email.status, 'provider_accepted');
      assert.equal((await exporter.email({}, user, scope.id)).email.status, 'provider_accepted'); assert.equal(sends, 1);
    });
    await t.test('oversized whole scopes are refused before hydrating private answers or calling a provider', async () => {
      let hydrated = false;
      const exporter = createForecastAnalyticsExporter({ rpc: async (...args) => { if (args[2].p_with_answers) hydrated = true; return f.rpc(...args); }, sendEmail: () => assert.fail('oversize reached provider') });
      await assert.rejects(exporter.pdf({}, USER, full.id), { code: 'BAR_FORECAST_ANALYTICS_SIZE_LIMIT' }); assert.equal(hydrated, false);
    });
    await t.test('missing canonical reports invalidate an old scope instead of silently omitting the report', async () => {
      await f.db.query('delete from public.dd2026_forecast_attempts where id=$1', [last.id]);
      errorCode(await call('get'), 'BAR_FORECAST_ANALYTICS_CHANGED');
    });
  } finally { await f.close(); }
});

test('all four routes authorize and require consent before exact-owner export without any grading call', async () => {
  let consent = true, signedIn = true, allowed = true; const seen = [];
  const handlers = createBarForecastHandlers({
    enforceBarForecastRateLimit: async () => {}, parseBoundedJson: (request) => request.json(),
    requireAuthenticatedUser: async () => { if (!signedIn) throw Object.assign(new Error('Sign in'), { status: 401 }); return USER; },
    authorizeAdministrator: async () => ({ authorized: allowed, role: allowed ? 'super_admin' : 'member' }),
    requiredSetupAccess: async () => ({ allowed, role: allowed ? 'super_admin' : 'member', basis: allowed ? 'super_admin' : 'payment_required', termsRequired: false, reauthenticationRequired: false, profileCompleted: true, tokenAcknowledgementRequired: false }),
    jsonResponse: (body, status) => Response.json(body, { status }),
    barForecastRpc: async (_env, name) => { assert.equal(name, 'dd2026_bar_forecast_consent_status'); return { consentAccepted: consent }; },
    structuredGemini: () => assert.fail('Exports cannot grade'),
    analyticsExporter: Object.fromEntries(['snapshot', 'get', 'pdf', 'email'].map((key) => [key, async (_env, user, input) => {
      seen.push({ key, user, input }); return key === 'pdf' ? { bytes: PDF, fileName: forecastAnalyticsFileName(OTHER) } : { ok: true, scope: { id: OTHER } };
    }])),
  });
  for (const [operation, key] of [['analytics_snapshot', 'snapshot'], ['analytics_report', 'get'], ['analytics_pdf', 'pdf'], ['analytics_email', 'email']]) {
    const body = { operation, ...(key === 'snapshot' ? { requestId: OTHER } : { scopeId: OTHER }) };
    const request = () => new Request('https://local.example.test/admin/dd2026/bar-forecast', { method: 'POST', body: JSON.stringify(body) });
    const response = await handlers.handle(request(), {}); assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control'), /private, no-store/u);
    assert.equal(seen.at(-1).key, key); assert.equal(seen.at(-1).user.id, OWNER);
    if (key === 'pdf') { assert.equal(response.headers.get('Content-Type'), 'application/pdf'); assert.match(response.headers.get('Content-Disposition'), /analytics-/u); }
    const count = seen.length;
    consent = false; await assert.rejects(handlers.handle(request(), {}), { code: 'BAR_FORECAST_CONSENT_REQUIRED' }); consent = true;
    signedIn = false; await assert.rejects(handlers.handle(request(), {}), { status: 401 }); signedIn = true;
    allowed = false; await assert.rejects(handlers.handle(request(), {}), { code: 'BAR_FORECAST_ACCESS_REQUIRED' }); allowed = true;
    assert.equal(seen.length, count);
  }
});

test('existing provider adapter accepts only the exact new attachment pattern and stable key', async () => {
  const env = { FORECAST_RESULTS_EMAIL_MODE: 'enabled', RESEND_API_KEY: 'local-only', FORECAST_RESULTS_EMAIL_FROM: 'Due Diligence <support@duediligence.ph>' };
  const message = { to: USER.email, subject: 'Saved analytics', text: 'Local test', html: '<p>Local test</p>', idempotencyKey: `forecast-analytics/${OWNER}/v1`, attachment: { filename: forecastAnalyticsFileName(OWNER), bytes: PDF, contentType: 'application/pdf' } };
  let calls = 0;
  assert.equal((await sendForecastResultEmail(env, message, async (_url, options) => { calls++; assert.equal(options.headers['Idempotency-Key'], message.idempotencyKey); return Response.json({ id: 'local-provider-id' }); })).accepted, true);
  assert.deepEqual(await sendForecastResultEmail(env, { ...message, attachment: { ...message.attachment, filename: '../analytics.pdf' } }, () => assert.fail('invalid file reached provider')), { definitelyNotAccepted: true });
  assert.equal(calls, 1);
});

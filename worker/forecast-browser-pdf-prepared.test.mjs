import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { normalizeBarForecastRequest, BarForecastError, BAR_FORECAST_SUBJECTS, forecastSetId } from './bar-forecast-core.mjs';
import { createForecastAttemptStore, FORECAST_ATTEMPT_RPC_NAMES } from './forecast-attempt-store.mjs';
import { createBarForecastHandlers } from './bar-forecast-routes.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ATTEMPT = '33333333-3333-4333-8333-333333333333';
const RPC = 'dd2026_forecast_browser_pdf_prepared';
const input = { operation: 'result_pdf_prepared', attemptId: ATTEMPT, resultRevision: 1, pdfVersion: 'forecast-pdf-v1' };

test('normalize prepared note accepts only bounded metadata, never content or client identity', () => {
  assert.deepEqual(normalizeBarForecastRequest(input), { ...input, byteCount: null, pageCount: null });
  assert.equal(normalizeBarForecastRequest({ ...input, byteCount: 10485760, pageCount: 1000 }).pageCount, 1000);
  for (const delta of [
    { ownerId: OTHER }, { answers: [] }, { pdf: 'bytes' }, { pdfHash: 'a'.repeat(64) },
    { resultRevision: 0 }, { resultRevision: 2 }, { resultRevision: '1' }, { pdfVersion: 'unreviewed-renderer' },
    { byteCount: 0 }, { byteCount: 10485761 }, { byteCount: 2.5 }, { byteCount: '10' },
    { pageCount: 0 }, { pageCount: 1001 }, { pageCount: true }, { attemptId: 'not-a-uuid' },
  ]) assert.throws(() => normalizeBarForecastRequest({ ...input, ...delta }), BarForecastError);
});

function routeHarness({ actor = OWNER, access = true, consent = true, noteError = null } = {}) {
  const calls = [];
  const result = { ok: true, preparedNote: { evidence: 'client_reported', serverVerifiedPdf: false, resultRevision: 1 } };
  const handlers = createBarForecastHandlers({
    enforceBarForecastRateLimit: async () => {},
    requireAuthenticatedUser: async (request) => {
      if (!request.headers.has('Authorization')) throw new BarForecastError('AUTHENTICATION_REQUIRED', 'Sign in.', 401);
      return { id: actor };
    },
    authorizeAdministrator: async () => ({ authorized: false }),
    requiredSetupAccess: async () => ({ allowed: access, unlimited: access, role: 'student', basis: access ? 'paid_subscription' : 'introductory_tokens', profileCompleted: true,
      termsRequired: false, reauthenticationRequired: false, tokenAcknowledgementRequired: false,
      ...(access ? { subscription: { status: 'active', source: 'manual_payment' } } : {}) }),
    parseBoundedJson: async (request) => request.json(),
    jsonResponse: (body, status) => Response.json(body, { status }),
    barForecastRpc: async (_env, name, args) => {
      calls.push({ name, args });
      if (name === 'dd2026_bar_forecast_consent_status') return { consentAccepted: consent };
      assert.equal(name, RPC, 'No content, provider, export, storage or email RPC');
      if (noteError) return { ok: false, error: noteError };
      return result;
    },
    structuredGemini: () => assert.fail('No model call'),
    resultExporter: { pdf: () => assert.fail('No server PDF rendering'), email: () => assert.fail('No email') },
  });
  return { calls, result, request: (body = input, signed = true) => handlers.handle(new Request('https://example.test/admin/dd2026/bar-forecast', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(signed ? { Authorization: 'Bearer synthetic-only' } : {}) },
    body: JSON.stringify(body),
  }), {}, 'https://example.test', 'https://example.test') };
}

test('route records authorized owner metadata only with private no-store response', async () => {
  const h = routeHarness(); const response = await h.request();
  assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.deepEqual(await response.json(), h.result);
  assert.deepEqual(h.calls.map((call) => call.name), ['dd2026_bar_forecast_consent_status', RPC]);
  assert.deepEqual(h.calls[1].args, { p_actor_user_id: OWNER, p_attempt_id: ATTEMPT,
    p_result_revision: 1, p_pdf_version: 'forecast-pdf-v1', p_byte_count: null, p_page_count: null });
  assert.ok(FORECAST_ATTEMPT_RPC_NAMES.includes(RPC), 'Existing index RPC whitelist includes the store name array');
});

test('route preserves unsigned401, unpaid403, consent409 and other-owner404 without extra operations', async () => {
  const unsigned = routeHarness();
  await assert.rejects(unsigned.request(input, false), { status: 401 }); assert.equal(unsigned.calls.length, 0);
  const unpaid = routeHarness({ access: false });
  await assert.rejects(unpaid.request(), { code: 'BAR_FORECAST_ACCESS_REQUIRED', status: 403 }); assert.equal(unpaid.calls.length, 0);
  const noConsent = routeHarness({ consent: false });
  await assert.rejects(noConsent.request(), { code: 'BAR_FORECAST_CONSENT_REQUIRED', status: 409 }); assert.equal(noConsent.calls.length, 1);
  const other = routeHarness({ actor: OTHER, noteError: { code: 'BAR_FORECAST_ATTEMPT_NOT_FOUND', message: 'Unavailable', status: 404 } });
  await assert.rejects(other.request(), { code: 'BAR_FORECAST_ATTEMPT_NOT_FOUND', status: 404 });
  assert.equal(other.calls[1].args.p_actor_user_id, OTHER);
});

test('store propagates unavailable note as a note failure, without retries or export calls', async () => {
  let calls = 0;
  const store = createForecastAttemptStore({ rpc: async () => { calls++; throw new Error('Synthetic uncertain transport'); } });
  await assert.rejects(store.noteBrowserPdfPrepared({}, OWNER, input), { code: 'BAR_FORECAST_PERSISTENCE_UNAVAILABLE' });
  assert.equal(calls, 1);
});

test('SQL client-reported note is service-only, deduplicated and preserves the complete canonical lifecycle', async () => {
  const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
    ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite');
  const db = new PGlite();
  const attemptsSql = await readFile(new URL('../supabase/migrations/20260907060650_astra_forecast_attempts.sql', import.meta.url), 'utf8');
  const noteSql = await readFile(new URL('../supabase/migrations/20260907173112_astra_browser_pdf_prepared_note.sql', import.meta.url), 'utf8');
  const rows = Array.from({ length: 20 }, (_, index) => ({ id: `local-prepared-note-${index + 1}`, number: index + 1,
    subject: BAR_FORECAST_SUBJECTS[0], title: `Synthetic question ${index + 1}`, checksum: String(index + 1).padStart(64, '0'),
    payloadCanonical: JSON.stringify({ number: index + 1 }), prompt: `Synthetic question ${index + 1}: Apply the rule to these material facts.`,
    suggestedAnswer: 'The controlling rule applies to each necessary element and the material facts support the conclusion.',
    legalBasis: 'Local synthetic authority used only for a database lifecycle test.',
    controllingDoctrine: 'Apply each legal element to the supplied material facts.', jurisprudence: 'Synthetic local source', citation: 'Local reference only',
    userAnswer: 'The rule applies because the material facts satisfy every necessary element, supporting the requested conclusion.' }));
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      insert into auth.users values('${OWNER}'),('${OTHER}');
      create table public.dd2026_bar_forecast_consents(user_id uuid,consent_version text);
      insert into public.dd2026_bar_forecast_consents values('${OWNER}','2026-09-01');
      create table public.local_note_access(user_id uuid primary key,allowed boolean);
      insert into public.local_note_access values('${OWNER}',true),('${OTHER}',true);
      create function public.dd2026_bar_forecast_access_allowed(uuid) returns boolean language sql stable
        as 'select allowed from public.local_note_access where user_id=$1';
      grant usage on schema public,auth to service_role;
      grant select on public.dd2026_bar_forecast_consents,public.local_note_access to service_role;`);
    await db.exec(attemptsSql); await db.exec(noteSql);
    const rpc = async (_env, name, args) => {
      assert.ok(FORECAST_ATTEMPT_RPC_NAMES.includes(name));
      const entries = Object.entries(args);
      await db.exec('set role service_role');
      try {
        return (await db.query(`select public.${name}(${entries.map(([key], i) => `${key}=>$${i + 1}`).join(',')}) value`, entries.map(([, value]) => value))).rows[0].value;
      } finally { await db.exec('reset role'); }
    };
    const store = createForecastAttemptStore({ rpc });
    const accepted = await store.accept({}, { ownerId: OWNER, clientAttemptId: crypto.randomUUID(), subject: rows[0].subject,
      setId: await forecastSetId(rows), rowsWithAnswers: rows });
    const noteInput = { ...input, attemptId: accepted.attempt.id };
    await assert.rejects(store.noteBrowserPdfPrepared({}, OWNER, noteInput), { code: 'BAR_FORECAST_EXPORT_NOT_READY', status: 409 });
    for (let index = 0; index < 5; index++) {
      const claim = await store.claim({}, { attemptId: accepted.attempt.id });
      await store.checkpoint({}, claim, { results: claim.rows.map((row) => ({ questionId: row.id, score: 3,
        grammar: { score: 3, corrections: [] }, issueSpotting: { score: 3, identified: [], missed: [] } })) });
    }
    await store.finalize({}, accepted.attempt.id);
    const before = await store.getOwned({}, OWNER, accepted.attempt.id);
    const beforeBatches = (await db.query('select jsonb_agg(to_jsonb(b) order by batch_index) rows from public.dd2026_forecast_batches b')).rows[0].rows;
    await assert.rejects(store.noteBrowserPdfPrepared({}, OTHER, noteInput), { code: 'BAR_FORECAST_ATTEMPT_NOT_FOUND', status: 404 });
    const first = await store.noteBrowserPdfPrepared({}, OWNER, { ...noteInput, byteCount: 123456, pageCount: 25 });
    assert.equal(first.preparedNote.evidence, 'client_reported'); assert.equal(first.preparedNote.serverVerifiedPdf, false);
    assert.equal(first.preparedNote.replayed, false);
    const replay = await store.noteBrowserPdfPrepared({}, OWNER, { ...noteInput, byteCount: 200000, pageCount: 30 });
    assert.deepEqual(replay, { ...first, preparedNote: { ...first.preparedNote, replayed: true } }, 'First observation remains unchanged on retries');
    assert.equal((await db.query("select count(*)::int n from public.dd2026_forecast_attempt_events where event_type='browser_pdf_prepared_client_reported'")).rows[0].n, 1);
    const stored = (await db.query("select details from public.dd2026_forecast_attempt_events where event_type='browser_pdf_prepared_client_reported'")).rows[0].details;
    assert.deepEqual(Object.keys(stored).sort(), ['evidence','serverVerifiedPdf','resultRevision','pdfVersion','byteCount','pageCount'].sort());
    assert.deepEqual(await store.getOwned({}, OWNER, accepted.attempt.id), before);
    assert.deepEqual((await db.query('select jsonb_agg(to_jsonb(b) order by batch_index) rows from public.dd2026_forecast_batches b')).rows[0].rows, beforeBatches);
    await db.query('update public.local_note_access set allowed=false where user_id=$1', [OWNER]);
    await assert.rejects(store.noteBrowserPdfPrepared({}, OWNER, noteInput), { code: 'BAR_FORECAST_ACCESS_REQUIRED', status: 403 });
    await db.query('update public.local_note_access set allowed=true where user_id=$1', [OWNER]);
    await db.query('delete from public.dd2026_bar_forecast_consents where user_id=$1', [OWNER]);
    await assert.rejects(store.noteBrowserPdfPrepared({}, OWNER, noteInput), { code: 'BAR_FORECAST_CONSENT_REQUIRED', status: 409 });
    for (const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      try { await assert.rejects(db.query(`select public.${RPC}($1,$2,1,'forecast-pdf-v1')`, [OWNER, accepted.attempt.id]), /permission denied/u); }
      finally { await db.exec('reset role'); }
    }
    assert.doesNotMatch(noteSql, /security definer|update public\.dd2026_forecast_attempts|forecast_result_exports|pdf_hash|storage\.|send_email/iu);
  } finally { await db.close(); }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createForecastAttemptStore } from './forecast-attempt-store.mjs';
import { createForecastResultExporter, buildForecastResultEmail } from './forecast-result-export.mjs';
import { sendForecastResultEmail } from './forecast-email-adapter.mjs';
import { BAR_FORECAST_SUBJECTS, forecastSetId } from './bar-forecast-core.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const USER = { id: OWNER, email: 'verified@example.test', email_confirmed_at: '2026-09-01T00:00:00Z' };
const SQL_NAMES = ['20260907060650_astra_forecast_attempts.sql', '20260907064532_astra_forecast_result_exports.sql', '20260907172508_astra_forecast_summary_email.sql'];
const SQL = await Promise.all(SQL_NAMES.map((name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')));
const LEGACY_CLAIM = SQL[1].match(/create function public\.dd2026_forecast_result_email_claim\([\s\S]+?\n\$\$;/u)[0].replace('create function ', 'create or replace function ');
const N11_CLAIM = await readFile(new URL('./fixtures/forecast-analytics-email-claim.sql', import.meta.url), 'utf8');
const ROWS = Array.from({ length: 20 }, (_, index) => ({ id: `summary-fixture-${index + 1}`, number: index + 1,
  subject: BAR_FORECAST_SUBJECTS[0], title: `Synthetic question ${index + 1}`, checksum: String(index + 1).padStart(64, '0'),
  payloadCanonical: JSON.stringify({ number: index + 1 }), prompt: `Synthetic question ${index + 1}: apply the rule.`,
  suggestedAnswer: 'The rule applies to these facts.', legalBasis: 'Synthetic fixture authority.', controllingDoctrine: 'Synthetic doctrine.',
  jurisprudence: 'Synthetic authority.', citation: 'Synthetic citation.', userAnswer: 'The controlling rule applies because the stated material facts meet all its legal elements.' }));
const SET_ID = await forecastSetId(ROWS);
const HASH = 'a'.repeat(64);

// No skip: a missing local SQL runtime must fail this required contract test.
const modulePath = process.env.ASTRA_PGLITE_MODULE || process.env.PGLITE_MODULE_PATH;
const { PGlite } = await import(modulePath ? pathToFileURL(modulePath.replace(/[/\\]$/u, '') + (modulePath.endsWith('.js') ? '' : '/dist/index.js')).href : '@electric-sql/pglite');

test('summary/link adapter makes one explicit bounded request without an attachment; legacy payload stays supported', async () => {
  const env = { FORECAST_RESULTS_EMAIL_MODE: 'enabled', RESEND_API_KEY: 'local-only', FORECAST_RESULTS_EMAIL_FROM: 'Results <results@example.test>' };
  const message = { to: USER.email, subject: 'Saved result', text: 'Saved summary and authenticated link.', html: '<p>Saved summary.</p>',
    deliveryKind: 'summary_link', idempotencyKey: `forecast-result/${OWNER}/r1` };
  let count = 0;
  assert.deepEqual(await sendForecastResultEmail(env, message, async (_url, options) => {
    count += 1;
    const body = JSON.parse(options.body);
    assert.equal(Object.hasOwn(body, 'attachments'), false);
    assert.deepEqual(body.to, [USER.email]);
    assert.equal(options.headers['Idempotency-Key'], message.idempotencyKey);
    return Response.json({ id: 'synthetic-provider' });
  }), { accepted: true, providerMessageId: 'synthetic-provider' });
  assert.equal(count, 1);
  for (const changed of [{ deliveryKind: 'unknown' }, { deliveryKind: undefined }, { attachment: {} }, { subject: 'Header\nInjection' }]) {
    assert.deepEqual(await sendForecastResultEmail(env, { ...message, ...changed }, () => assert.fail('invalid delivery reached transport')), { definitelyNotAccepted: true });
  }
});

test('actual migrated SQL preserves legacy mail and atomically claims canonical lightweight summary emails', async (t) => {
  const db = new PGlite();
  // Explicit fixture stubs: Auth schema, positive nonnull-owner entitlement and
  // consent. Actual attempt intake/checkpoints/finalizer/export RPCs run unchanged.
  // No models, mail, browser, real Auth grant, clock replacement or PDF renderer.
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    insert into auth.users values('${OWNER}','${USER.email}','${USER.email_confirmed_at}'),('${OTHER}','other@example.test','2026-09-01');
    create table public.dd2026_bar_forecast_consents(user_id uuid,consent_version text);
    insert into public.dd2026_bar_forecast_consents select id,'2026-09-01' from auth.users;
    create function public.dd2026_bar_forecast_access_allowed(uuid) returns boolean language sql stable as 'select $1 is not null';
    grant usage on schema public,auth to service_role; grant select on public.dd2026_bar_forecast_consents to service_role;
    revoke all on auth.users from public,anon,authenticated,service_role;`);
  try {
    await db.exec(SQL[0]); await db.exec(SQL[1]);
    const rpc = async (_env, name, args) => {
      assert.match(name, /^dd2026_forecast_[a-z_]+$/u);
      const entries = Object.entries(args);
      await db.exec('set role service_role');
      try { return (await db.query(`select public.${name}(${entries.map(([key], i) => `${key}=>$${i + 1}`).join(',')}) value`, entries.map(([, value]) => value))).rows[0].value; }
      finally { await db.exec('reset role'); }
    };
    const store = createForecastAttemptStore({ rpc });
    async function complete(ownerId = OWNER) {
      const accepted = await store.accept({}, { ownerId, clientAttemptId: crypto.randomUUID(), subject: ROWS[0].subject, setId: SET_ID, rowsWithAnswers: ROWS });
      for (let batch = 0; batch < 5; batch += 1) {
        const claim = await store.claim({}, { attemptId: accepted.attempt.id });
        await store.checkpoint({}, claim, { results: claim.rows.map((row) => ({ questionId: row.id, score: 4,
          grammar: { score: 3, corrections: [] }, issueSpotting: { score: 4.5, identified: [], missed: [] } })) });
      }
      return (await store.finalize({}, accepted.attempt.id)).attempt;
    }
    const pdfArgs = (attempt, hash = HASH) => ({ p_actor_user_id: OWNER, p_attempt_id: attempt.id, p_result_revision: 1,
      p_pdf_hash: hash, p_file_name: `duediligence-forecast-${attempt.id}-r1.pdf`, p_byte_count: 123, p_download: true });
    const oldArgs = (attempt, hash = HASH) => ({ p_actor_user_id: OWNER, p_attempt_id: attempt.id, p_result_revision: 1, p_recipient_email: USER.email, p_pdf_hash: hash });
    const args = (attempt) => ({ p_actor_user_id: OWNER, p_attempt_id: attempt.id, p_result_revision: 1, p_recipient_email: USER.email,
      p_result: attempt.result, p_completed_at: attempt.completedAt, p_template_version: 'forecast-summary-link-v1', p_payload_hash: HASH });
    const row = async (attempt) => (await db.query('select to_jsonb(e) value from public.dd2026_forecast_result_exports e where attempt_id=$1', [attempt.id])).rows[0]?.value;
    const settle = async (attempt, claim, status = 'uncertain') => rpc({}, 'dd2026_forecast_result_email_settle', {
      p_actor_user_id: OWNER, p_attempt_id: attempt.id, p_result_revision: 1, p_lease_token: claim.leaseToken,
      p_status: status, p_provider_id: status === 'provider_accepted' ? 'synthetic-provider' : null });
    const summary = (attempt, extra = {}) => rpc({}, 'dd2026_forecast_result_summary_email_claim', { ...args(attempt), ...extra });
    const prior = await complete();
    await rpc({}, 'dd2026_forecast_result_pdf_record', pdfArgs(prior));
    const priorClaim = await rpc({}, 'dd2026_forecast_result_email_claim', oldArgs(prior));
    await settle(prior, priorClaim);
    const beforeMigration = await row(prior);
    await db.exec(SQL[2]);

    await t.test('migration retains all old PDF fingerprints, requested body identity and existing status', async () => {
      const after = await row(prior);
      for (const key of Object.keys(beforeMigration)) assert.deepEqual(after[key], beforeMigration[key], key);
      assert.equal(after.delivery_kind, 'pdf_attachment');
      assert.equal(after.canonical_result_hash, null);
      assert.equal((await summary(prior)).error.code, 'BAR_FORECAST_EMAIL_FORMAT_CONFLICT');
      assert.deepEqual(await row(prior), after);
    });

    const attempt = await complete();
    let message; let sends = 0; let lostSettlement = true;
    const exporter = createForecastResultExporter({ attemptStore: store,
      renderPdf: () => assert.fail('summary email must never render a PDF'),
      rpc: async (env, name, input) => {
        const value = await rpc(env, name, input);
        if (name === 'dd2026_forecast_result_email_settle' && lostSettlement) { lostSettlement = false; throw new Error('Synthetic lost response'); }
        return value;
      }, sendEmail: async (_env, input) => { sends += 1; message = input; return { accepted: true, providerMessageId: 'synthetic-provider' }; } });
    await t.test('exact canonical summary is sent once without PDF; accepted settlement replay does not resend', async () => {
      const before = (await db.query('select to_jsonb(a) value from public.dd2026_forecast_attempts a where id=$1', [attempt.id])).rows[0].value;
      assert.equal((await exporter.email({}, USER, attempt.id)).email.status, 'provider_accepted');
      assert.equal((await exporter.email({}, USER, attempt.id)).email.status, 'provider_accepted');
      assert.equal(sends, 1); assert.equal(message.attachment, undefined); assert.equal(message.deliveryKind, 'summary_link');
      assert.match(message.text, /80 \/ 100/u); assert.match(message.text, /Grammar: 3 \/ 5/u);
      assert.match(message.text, /Issue spotting: 4\.5 \/ 5/u); assert.doesNotMatch(message.text + message.html, /PDF is attached/u);
      assert.match(message.text, new RegExp(`https://duediligence.ph/\\?forecastAttempt=${attempt.id}#bar-forecast-2026`, 'u'));
      assert.equal(message.text.includes(ROWS[0].userAnswer), false);
      const saved = await row(attempt);
      assert.equal(saved.delivery_kind, 'summary_link'); assert.equal(saved.pdf_hash, null); assert.equal(saved.byte_count, null); assert.equal(saved.file_name, null);
      const actualHash = (await db.query("select encode(sha256(convert_to(result::text,'UTF8')),'hex') hash from public.dd2026_forecast_attempts where id=$1", [attempt.id])).rows[0].hash;
      assert.equal(saved.canonical_result_hash, actualHash);
      assert.equal(saved.email_payload_hash, createHash('sha256').update(JSON.stringify(['forecast-summary-link-v1', '', message.subject, message.text, message.html])).digest('hex'));
      assert.equal(saved.email_executions, 1);
      assert.deepEqual((await db.query('select to_jsonb(a) value from public.dd2026_forecast_attempts a where id=$1', [attempt.id])).rows[0].value, before);
    });

    await t.test('missing RPC, storage denial, wrong verified owner, or invalid saved result never renders or sends', async () => {
      for (const fault of ['missing_rpc', 'stored_error', 'wrong_verified_owner', 'invalid_report']) {
        let rpcCalls = 0;
        const unavailable = createForecastResultExporter({
          attemptStore: { getOwned: async () => ({ attempt: fault === 'invalid_report' ? { ...attempt, status: 'processing' } : attempt }) },
          rpc: async () => { rpcCalls += 1; if (fault === 'missing_rpc') throw new Error('PGRST202 synthetic missing migration');
            return { ok: false, error: { code: 'BAR_FORECAST_EXPORT_NOT_READY', message: 'Synthetic denial', status: 409 } }; },
          resolveVerifiedUser: async () => fault === 'wrong_verified_owner' ? { ...USER, id: OTHER } : USER,
          renderPdf: () => assert.fail('no CPU fallback'), sendEmail: () => assert.fail('no provider request'),
        });
        await assert.rejects(unavailable.email({}, USER, attempt.id), {
          code: fault === 'missing_rpc' ? 'BAR_FORECAST_EXPORT_STORAGE_UNAVAILABLE'
            : fault === 'wrong_verified_owner' ? 'BAR_FORECAST_VERIFIED_EMAIL_REQUIRED' : 'BAR_FORECAST_EXPORT_NOT_READY',
        });
        assert.equal(rpcCalls, ['missing_rpc', 'stored_error'].includes(fault) ? 1 : 0);
      }
    });

    await t.test('a sender configuration change cannot reuse an uncertain summary key with a different provider body', async () => {
      await db.exec('begin');
      try {
        const owned = await complete(); const messages = [];
        const uncertain = createForecastResultExporter({ attemptStore: store, rpc,
          renderPdf: () => assert.fail('sender retry must not render'),
          sendEmail: async (env, input) => { messages.push({ from: env.FORECAST_RESULTS_EMAIL_FROM, ...input }); return { accepted: false }; } });
        const env = { FORECAST_RESULTS_EMAIL_FROM: 'Original Results <results@example.test>' };
        assert.equal((await uncertain.email(env, USER, owned.id)).email.status, 'uncertain');
        await db.query('update public.dd2026_forecast_result_exports set email_retry_at=statement_timestamp() where attempt_id=$1', [owned.id]);
        const before = await row(owned);
        await assert.rejects(uncertain.email({ ...env, FORECAST_RESULTS_EMAIL_FROM: 'Changed Results <changed@example.test>' }, USER, owned.id), { code: 'BAR_FORECAST_EMAIL_FORMAT_CONFLICT' });
        assert.deepEqual(await row(owned), before); assert.equal(messages.length, 1);
        assert.equal((await uncertain.email(env, USER, owned.id)).email.status, 'uncertain');
        assert.equal(messages.length, 2); assert.deepEqual(messages[1], messages[0]);
      } finally { await db.exec('rollback'); }
    });

    await t.test('complete owner, exact canonical revision, timestamp, verified current recipient and payload are enforced', async () => {
      for (const extra of [{ p_actor_user_id: OTHER, p_recipient_email: 'other@example.test' }, { p_result_revision: 2 },
        { p_result: { ...attempt.result, totalScore: 99 } }, { p_completed_at: '2000-01-01T00:00:00Z' }]) {
        assert.equal((await summary(attempt, extra)).error.code, 'BAR_FORECAST_EXPORT_NOT_READY');
      }
      assert.equal((await summary(attempt, { p_recipient_email: 'forged@example.test' })).error.code, 'BAR_FORECAST_VERIFIED_EMAIL_REQUIRED');
      assert.equal((await summary(attempt, { p_payload_hash: 'f'.repeat(64) })).error.code, 'BAR_FORECAST_EMAIL_FORMAT_CONFLICT');
      await db.query('update auth.users set email=$1 where id=$2', ['changed@example.test', OWNER]);
      assert.equal((await summary(attempt, { p_recipient_email: 'changed@example.test' })).error.code, 'BAR_FORECAST_EMAIL_RECIPIENT_CHANGED');
      await db.query('update auth.users set email=$1 where id=$2', [USER.email, OWNER]);
      assert.equal(sends, 1);
    });

    await t.test('summary gets a real PDF once without inventing metadata or unlocking cached attachment delivery', async () => {
      assert.equal((await rpc({}, 'dd2026_forecast_result_pdf_record', pdfArgs(attempt))).ok, true);
      assert.equal((await row(attempt)).delivery_kind, 'summary_link');
      assert.equal((await row(attempt)).pdf_hash, HASH);
      assert.equal((await rpc({}, 'dd2026_forecast_result_pdf_record', pdfArgs(attempt, 'f'.repeat(64)))).error.code, 'BAR_FORECAST_EXPORT_CONFLICT');
      assert.equal((await rpc({}, 'dd2026_forecast_result_email_claim', oldArgs(attempt))).error.code, 'BAR_FORECAST_EMAIL_FORMAT_CONFLICT');
    });

    const pending = await complete();
    await rpc({}, 'dd2026_forecast_result_pdf_record', pdfArgs(pending));
    let first;
    await t.test('a download-only journal reserves summary format atomically and retains its genuine PDF metadata', async () => {
      first = await summary(pending); assert.equal(first.claimed, true);
      assert.equal((await summary(pending)).claimed, false);
      assert.equal((await row(pending)).pdf_hash, HASH);
      assert.equal((await row(pending)).delivery_kind, 'summary_link');
      assert.equal((await db.query("select current_setting('astra.forecast_summary_claim',true) marker")).rows[0].marker, '');
      await settle(pending, first);
      assert.equal((await summary(pending)).claimed, false, '30 second cooldown');
    });

    await t.test('stale claim cannot settle; three executions retain the exact idempotency key and finite retry cap', async () => {
      await db.query('update public.dd2026_forecast_result_exports set email_retry_at=statement_timestamp() where attempt_id=$1', [pending.id]);
      const second = await summary(pending); assert.equal(second.claimed, true); assert.equal(second.idempotencyKey, first.idempotencyKey);
      assert.notEqual(second.leaseToken, first.leaseToken);
      assert.equal((await settle(pending, first, 'provider_accepted')).error.code, 'BAR_FORECAST_EMAIL_LEASE_LOST');
      await settle(pending, second, 'failed');
      await db.query('update public.dd2026_forecast_result_exports set email_retry_at=statement_timestamp() where attempt_id=$1', [pending.id]);
      const third = await summary(pending); assert.equal(third.claimed, true); assert.equal(third.idempotencyKey, first.idempotencyKey);
      await settle(pending, third);
      assert.equal((await summary(pending)).error.code, 'BAR_FORECAST_EMAIL_RETRY_LIMIT');
    });

    await t.test('even replacement by the original unguarded claim cannot change summary retry payload', async () => {
      // Exact legacy function is what N11 starts from. The independent table
      // guard must survive any later quota-only replacement of that function.
      await db.exec(LEGACY_CLAIM);
      const next = await complete(); await rpc({}, 'dd2026_forecast_result_pdf_record', pdfArgs(next));
      const claim = await summary(next); await settle(next, claim);
      await db.query('update public.dd2026_forecast_result_exports set email_retry_at=statement_timestamp() where attempt_id=$1', [next.id]);
      const before = await row(next);
      await assert.rejects(rpc({}, 'dd2026_forecast_result_email_claim', oldArgs(next)), /Summary email requires its exact atomic claim/u);
      assert.deepEqual(await row(next), before);
      assert.equal((await summary(next)).claimed, true, 'new wrapper still reuses the replaced engine');
    });

    await t.test('same selected-report journal shares one five-email quota across legacy and summary requests', async () => {
      const fifth = await complete(); assert.equal((await summary(fifth)).claimed, true);
      const sixth = await complete(); assert.equal((await summary(sixth)).error.code, 'BAR_FORECAST_EMAIL_RATE_LIMIT');
      assert.equal((await row(sixth)).email_requested_at, null);
      assert.equal((await db.query('select count(*)::int n from public.dd2026_forecast_result_exports where email_requested_at is not null')).rows[0].n, 5);
    });

    await t.test('new RPC and table remain service-only; Auth-table access is not broadened', async () => {
      assert.equal((await db.query("select has_table_privilege('service_role','auth.users','SELECT') allowed")).rows[0].allowed, false);
      for (const role of ['anon', 'authenticated']) {
        assert.equal((await db.query("select has_function_privilege($1,'public.dd2026_forecast_result_summary_email_claim(uuid,uuid,integer,text,jsonb,timestamptz,text,text)','EXECUTE') allowed", [role])).rows[0].allowed, false);
        await db.exec(`set role ${role}`);
        try { await assert.rejects(db.query('select * from public.dd2026_forecast_result_exports'), /permission denied/u); }
        finally { await db.exec('reset role'); }
      }
      await assert.rejects(db.query("update public.dd2026_forecast_result_exports set delivery_kind='pdf_attachment' where attempt_id=$1", [pending.id]), /immutable/u);
      await assert.rejects(db.query("update public.dd2026_forecast_result_exports set email_payload_hash=$2 where attempt_id=$1", [pending.id, 'f'.repeat(64)]), /immutable/u);
    });

    await t.test('current entitlement and unfinished reports are denied before creating an export', async () => {
      const unfinished = await store.accept({}, { ownerId: OWNER, clientAttemptId: crypto.randomUUID(), subject: ROWS[0].subject, setId: SET_ID, rowsWithAnswers: ROWS });
      assert.equal((await summary({ ...attempt, id: unfinished.attempt.id })).error.code, 'BAR_FORECAST_EXPORT_NOT_READY');
      assert.equal(await row(unfinished.attempt), undefined);
      await db.exec('begin');
      try {
        await db.exec("create or replace function public.dd2026_bar_forecast_access_allowed(uuid) returns boolean language sql stable as 'select false'");
        assert.equal((await summary(attempt)).error.code, 'BAR_FORECAST_ACCESS_REQUIRED');
      } finally { await db.exec('rollback'); }
    });

    await t.test('23-hour provider-retention limit is unchanged and expired processing leases stay fenced', async () => {
      // Deliberately old synthetic history inside rollback, not a replaced clock
      // or permitted product rewrite. Other guards and actual claim run normally.
      await db.exec('begin');
      try {
        await db.exec('alter table public.dd2026_forecast_result_exports disable trigger dd2026_forecast_result_export_immutable');
        await db.query("update public.dd2026_forecast_result_exports set email_requested_at=statement_timestamp()-interval '23 hours',email_retry_at=statement_timestamp(),email_executions=1 where attempt_id=$1", [pending.id]);
        assert.equal((await summary(pending)).error.code, 'BAR_FORECAST_EMAIL_RETRY_LIMIT');
      } finally { await db.exec('rollback'); }
      await db.exec('begin');
      try {
        const fifth = (await db.query("select attempt_id from public.dd2026_forecast_result_exports where email_status='processing' order by created_at desc limit 1")).rows[0];
        const completeFifth = (await store.getOwned({}, OWNER, fifth.attempt_id)).attempt;
        const expiredLease = (await row(completeFifth)).email_lease;
        await db.query("update public.dd2026_forecast_result_exports set email_lease_expires_at=statement_timestamp()-interval '1 second' where attempt_id=$1", [completeFifth.id]);
        const next = await summary(completeFifth); assert.equal(next.claimed, true); assert.notEqual(next.leaseToken, expiredLease);
        assert.equal((await settle(completeFifth, { leaseToken: expiredLease }, 'provider_accepted')).error.code, 'BAR_FORECAST_EMAIL_LEASE_LOST');
      } finally { await db.exec('rollback'); }
    });

    await t.test('legacy processing/accepted/failed/uncertain records keep their original payload and request identity', async () => {
      for (const status of ['processing', 'provider_accepted', 'failed', 'uncertain']) {
        await db.exec('begin');
        try {
          // Original request was uncertain; simulate its possible downstream
          // outcomes without changing its immutable requested/body identity.
          await db.query(`update public.dd2026_forecast_result_exports set email_status=$2,
            email_lease=case when $2='processing' then gen_random_uuid() else null end,
            email_lease_expires_at=case when $2='processing' then statement_timestamp()+interval '60 seconds' else null end,
            provider_id=case when $2='provider_accepted' then 'synthetic-provider' else null end where attempt_id=$1`, [prior.id, status]);
          const before = await row(prior); const result = await summary(prior);
          if (['processing', 'provider_accepted'].includes(status)) { assert.equal(result.claimed, false); assert.equal(result.email.status, status); }
          else assert.equal(result.error.code, 'BAR_FORECAST_EMAIL_FORMAT_CONFLICT');
          assert.deepEqual(await row(prior), before);
        } finally { await db.exec('rollback'); }
      }
    });

    await t.test('exact N11 quota/claim definitions still count summaries and cannot bypass the format guard', async () => {
      // Exact two function definitions from the unapplied Analytics migration.
      // Its scope table is only a synthetic quota fixture, not full Analytics.
      await db.exec('begin');
      try {
        await db.exec(`create table public.dd2026_forecast_analytics_exports(owner_id uuid,email_requested_at timestamptz);
          grant select on public.dd2026_forecast_analytics_exports to service_role;`);
        await db.exec(N11_CLAIM);
        await db.exec('revoke all on function public.dd2026_forecast_email_quota_used(uuid) from public,anon,authenticated; grant execute on function public.dd2026_forecast_email_quota_used(uuid) to service_role');
        // Existing summary retry is still denied even though replacement removes
        // the friendly format check. Table-level fencing rolls back its mutation.
        await db.query('update public.dd2026_forecast_result_exports set email_executions=1,email_retry_at=statement_timestamp() where attempt_id=$1', [pending.id]);
        const before = await row(pending);
        await db.exec('set role service_role; savepoint old_claim_rejection');
        await assert.rejects(db.query('select public.dd2026_forecast_result_email_claim($1,$2,1,$3,$4)', [OWNER, pending.id, USER.email, HASH]), /Summary email requires its exact atomic claim/u);
        await db.exec('rollback to savepoint old_claim_rejection; reset role');
        assert.deepEqual(await row(pending), before);
        assert.equal((await summary(pending)).claimed, true);
        assert.equal((await db.query('select public.dd2026_forecast_email_quota_used($1)::int n', [OWNER])).rows[0].n, 5);
        await db.query('insert into public.dd2026_forecast_analytics_exports values($1,statement_timestamp()),($1,statement_timestamp())', [OTHER]);
        assert.equal((await db.query('select public.dd2026_forecast_email_quota_used($1)::int n', [OTHER])).rows[0].n, 2);
        for (let index = 0; index < 3; index += 1) {
          const owned = await complete(OTHER);
          assert.equal((await summary(owned, { p_actor_user_id: OTHER, p_recipient_email: 'other@example.test' })).claimed, true);
        }
        assert.equal((await db.query('select public.dd2026_forecast_email_quota_used($1)::int n', [OTHER])).rows[0].n, 5);
        const sixthOther = await complete(OTHER);
        assert.equal((await summary(sixthOther, { p_actor_user_id: OTHER, p_recipient_email: 'other@example.test' })).error.code, 'BAR_FORECAST_EMAIL_RATE_LIMIT');
        const sixth = await complete(); assert.equal((await summary(sixth)).error.code, 'BAR_FORECAST_EMAIL_RATE_LIMIT');
        for (const role of ['anon', 'authenticated']) {
          for (const name of ['dd2026_forecast_result_email_claim(uuid,uuid,integer,text,text)', 'dd2026_forecast_result_summary_email_claim(uuid,uuid,integer,text,jsonb,timestamptz,text,text)']) {
            assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, `public.${name}`])).rows[0].allowed, false);
          }
        }
      } finally { await db.exec('rollback'); }
    });

    await t.test('legacy template bytes still describe the existing attachment, summary copy makes no attachment claim', () => {
      const legacy = buildForecastResultEmail(attempt, OWNER);
      const modern = buildForecastResultEmail(attempt, OWNER, { deliveryKind: 'summary_link' });
      assert.match(legacy.text, /Your complete PDF is attached/u);
      assert.match(legacy.html, /Your complete PDF is attached/u);
      assert.doesNotMatch(modern.text + modern.html, /PDF is attached/u);
    });
  } finally { await db.close(); }
});

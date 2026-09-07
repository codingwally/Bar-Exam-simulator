import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { buildForecastResultPdf, createForecastResultExporter, verifiedForecastEmail, FORECAST_RESULT_EXPORT_RPC_NAMES } from './forecast-result-export.mjs';
import { createForecastAttemptStore, FORECAST_ATTEMPT_RPC_NAMES } from './forecast-attempt-store.mjs';
import { BAR_FORECAST_SUBJECTS, forecastSetId } from './bar-forecast-core.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const USER = { id: OWNER, email: 'verified@example.test', email_confirmed_at: '2026-09-01T00:00:00Z' };
const ROWS = Array.from({ length: 20 }, (_, index) => ({
  id: `export-fixture-${index + 1}`, number: index + 1, subject: BAR_FORECAST_SUBJECTS[0],
  title: `Verification fixture ${index + 1}`, checksum: String(index + 1).padStart(64, '0'),
  payloadCanonical: JSON.stringify({ number: index + 1 }),
  prompt: `Question ${index + 1}: Apply the controlling rule to the decisive material facts.`,
  suggestedAnswer: `Suggested answer ${index + 1}: The controlling rule applies because every legal element is supported by the material facts.`,
  legalBasis: 'Curated authority used only for local PDF and journal verification.',
  controllingDoctrine: 'A complete answer applies the controlling rule to the decisive facts.',
  jurisprudence: 'Local verification source only', citation: 'Local verification reference',
  userAnswer: index === 0 ? `${'The material facts establish every element of the controlling rule, so the requested conclusion follows. '.repeat(50)}End of long answer one.`
    : `Answer ${index + 1}: The controlling rule applies because every legal element is supported by the material facts. ${index === 19 ? 'Final answer twenty: ₱149, Señor Niño, café.' : ''}`,
}));
const SET_ID = await forecastSetId(ROWS);
const migration = await readFile(new URL('../supabase/migrations/20260907060650_astra_forecast_attempts.sql', import.meta.url), 'utf8');
const exportMigration = await readFile(new URL('../supabase/migrations/20260907064532_astra_forecast_result_exports.sql', import.meta.url), 'utf8');
const summaryMigration = await readFile(new URL('../supabase/migrations/20260907172508_astra_forecast_summary_email.sql', import.meta.url), 'utf8');

test('verified recipient ignores user-editable metadata and phone-only confirmation', () => {
  assert.equal(verifiedForecastEmail(USER), USER.email);
  for (const user of [
    { id: OWNER, email: USER.email, user_metadata: { email_verified: true } },
    { id: OWNER, email: USER.email, confirmed_at: USER.email_confirmed_at },
    { ...USER, email: 'attacker@example.test\r\nBcc: another@example.test' },
  ]) assert.throws(() => verifiedForecastEmail(user), { code: 'BAR_FORECAST_VERIFIED_EMAIL_REQUIRED' });
});

test('export journal remains service-only and finite', () => {
  assert.match(exportMigration, /enable row level security/u);
  assert.match(exportMigration, /force row level security/u);
  assert.equal((exportMigration.match(/security definer/giu) || []).length, 1);
  assert.match(exportMigration, /create function private\.dd2026_forecast_verified_owner_email[\s\S]+returns boolean language sql stable security definer set search_path=''/u);
  assert.match(exportMigration, /revoke all on function private\.dd2026_forecast_verified_owner_email\(uuid,text\) from public,anon,authenticated/u);
  assert.match(exportMigration, /grant execute on function private\.dd2026_forecast_verified_owner_email\(uuid,text\) to service_role/u);
  assert.doesNotMatch(exportMigration, /grant\s+select[^;]*auth\.users/iu);
  assert.match(exportMigration, /revoke all on function %s from public,anon,authenticated/u);
  assert.match(exportMigration, /interval '23 hours'/u);
  assert.match(exportMigration, /email_executions>=3/u);
  assert.match(exportMigration, /interval '24 hours'\)>=5/u);
});

let PGlite;
try {
  ({ PGlite } = await import(process.env.PGLITE_MODULE_PATH ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite'));
} catch (error) { if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error; }

test('saved PDF and self-email use canonical reports with real isolated PostgreSQL journals', {
  skip: !PGlite && 'Install @electric-sql/pglite or set PGLITE_MODULE_PATH to verify SQL exports.',
}, async (t) => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    insert into auth.users values('${OWNER}','${USER.email}','${USER.email_confirmed_at}'),('${OTHER}','other@example.test','2026-09-01T00:00:00Z');
    create table public.dd2026_bar_forecast_consents(user_id uuid,consent_version text);
    insert into public.dd2026_bar_forecast_consents select id,'2026-09-01' from auth.users;
    create function public.dd2026_bar_forecast_access_allowed(uuid) returns boolean language sql stable as 'select $1 is not null';
    grant usage on schema public,auth to service_role;
    grant select on public.dd2026_bar_forecast_consents to service_role;
    revoke all on auth.users from public,anon,authenticated,service_role;`);
  try {
    await db.exec(migration); await db.exec(exportMigration); await db.exec(summaryMigration);
    let settlementUncertain = false;
    const rpc = async (_env, name, args) => {
      assert.ok([...FORECAST_ATTEMPT_RPC_NAMES, ...FORECAST_RESULT_EXPORT_RPC_NAMES].includes(name));
      const entries = Object.entries(args);
      // Match real Supabase: RPC invoker is service_role, NOT the migration
      // owner, and service_role has no direct SELECT on auth.users.
      let result;
      await db.exec('set role service_role');
      try {
        result = await db.query(`select public.${name}(${entries.map(([key], i) => `${key}=>$${i + 1}`).join(',')}) value`, entries.map(([, value]) => value));
      } finally { await db.exec('reset role'); }
      if (name === 'dd2026_forecast_result_email_settle' && settlementUncertain) {
        settlementUncertain = false; throw new Error('Fixture lost committed settlement response.');
      }
      return result.rows[0].value;
    };
    const store = createForecastAttemptStore({ rpc });
    await t.test('service-only verified-email helper works without Auth-table SELECT and returns only exact confirmed identity', async () => {
      const privilege = (await db.query("select has_table_privilege('service_role','auth.users','SELECT') allowed")).rows[0];
      assert.equal(privilege.allowed, false);
      await db.exec('set role service_role');
      try {
        await assert.rejects(db.query('select * from auth.users'), /permission denied/u);
        for (const [id, email, expected] of [
          [OWNER, USER.email, true], [OTHER, USER.email, false],
          [OWNER, USER.email.toUpperCase(), false], [OWNER, ` ${USER.email}`, false],
          [null, USER.email, false], [OWNER, null, false],
        ]) {
          const value = (await db.query('select private.dd2026_forecast_verified_owner_email($1,$2) verified', [id, email])).rows[0];
          assert.deepEqual(value, { verified: expected });
        }
      } finally { await db.exec('reset role'); }
      await db.query('update auth.users set email_confirmed_at=null where id=$1', [OTHER]);
      await db.exec('set role service_role');
      try {
        assert.equal((await db.query('select private.dd2026_forecast_verified_owner_email($1,$2) verified', [OTHER, 'other@example.test'])).rows[0].verified, false);
      } finally { await db.exec('reset role'); }
      for (const role of ['anon', 'authenticated']) {
        const permissions = (await db.query("select has_function_privilege($1,'private.dd2026_forecast_verified_owner_email(uuid,text)','EXECUTE') allowed", [role])).rows[0];
        assert.equal(permissions.allowed, false);
        await db.exec(`set role ${role}`);
        try {
          await assert.rejects(db.query('select private.dd2026_forecast_verified_owner_email($1,$2)', [OWNER, USER.email]), /permission denied/u);
        } finally { await db.exec('reset role'); }
      }
    });
    async function completedAttempt() {
      const accepted = await store.accept({}, { ownerId: OWNER, clientAttemptId: crypto.randomUUID(), subject: ROWS[0].subject, setId: SET_ID, rowsWithAnswers: ROWS });
      for (let batch = 0; batch < 5; batch += 1) {
        const claim = await store.claim({}, { attemptId: accepted.attempt.id });
        await store.checkpoint({}, claim, { results: claim.rows.map((row) => ({ questionId: row.id, score: 4,
          grammar: { score: 3, corrections: [] }, issueSpotting: { score: 4.5, identified: [], missed: [] },
        })) });
      }
      return (await store.finalize({}, accepted.attempt.id)).attempt;
    }
    const attempt = await completedAttempt();
    let bytes;
    await t.test('selectable Unicode PDF includes20 questions and paginates a long answer without changing the report', async () => {
      bytes = await buildForecastResultPdf({ attempt, ownerId: OWNER });
      const parsed = await PDFDocument.load(bytes);
      assert.equal(parsed.getTitle(), 'Due Diligence - Saved Forecast Report');
      assert.ok(parsed.getPageCount() > 21, 'long first answer must continue on another page');
      assert.ok(bytes.length < 10 * 1024 * 1024);
      assert.deepEqual(await buildForecastResultPdf({ attempt, ownerId: OWNER }), bytes, 'same revision must produce identical attachment bytes');
      if (process.env.FORECAST_EXPORT_SAMPLE) {
        await mkdir(dirname(process.env.FORECAST_EXPORT_SAMPLE), { recursive: true });
        await writeFile(process.env.FORECAST_EXPORT_SAMPLE, bytes);
        if (process.env.PDF_PYTHON) {
          const extracted = execFileSync(process.env.PDF_PYTHON, ['-c', 'import sys; from pypdf import PdfReader; print("\\n".join(p.extract_text() for p in PdfReader(sys.argv[1]).pages))', process.env.FORECAST_EXPORT_SAMPLE], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
          assert.ok(extracted.includes('Final answer twenty: ₱149, Señor Niño, café.'));
          assert.ok(extracted.replace(/\s+/gu, ' ').includes('End of long answer one.'));
          for (let number = 1; number <= 20; number += 1) assert.ok(extracted.includes(`QUESTION ${number} /`));
          assert.ok(extracted.includes('80 / 100'));
        }
      }
    });

    await t.test('incomplete, wrong-owner, corrupt-score, or unsupported-glyph export fails without truncating content', async () => {
      await assert.rejects(buildForecastResultPdf({ attempt: { ...attempt, status: 'processing' }, ownerId: OWNER }), { code: 'BAR_FORECAST_EXPORT_NOT_READY' });
      await assert.rejects(buildForecastResultPdf({ attempt, ownerId: OTHER }), { code: 'BAR_FORECAST_EXPORT_NOT_READY' });
      const bad = structuredClone(attempt); bad.result.totalScore = 99;
      await assert.rejects(buildForecastResultPdf({ attempt: bad, ownerId: OWNER }), { code: 'BAR_FORECAST_EXPORT_INVALID' });
      const glyph = structuredClone(attempt); glyph.result.results[0].question += ' 🧑‍🚀'; glyph.questions[0].prompt = glyph.result.results[0].question;
      await assert.rejects(buildForecastResultPdf({ attempt: glyph, ownerId: OWNER }), { code: 'BAR_FORECAST_PDF_CHARACTER_UNAVAILABLE' });
    });

    let sent = 0; let message;
    const exporter = createForecastResultExporter({ attemptStore: store, rpc, sendEmail: async (_env, input) => {
      sent += 1; message = input; return { accepted: true, providerMessageId: 'local-provider-fixture' };
    } });
    await t.test('download retains its exact PDF while summary email sends no attachment or duplicate delivery', async () => {
      const download = await exporter.pdf({}, USER, attempt.id);
      assert.deepEqual(download.bytes, bytes);
      settlementUncertain = true;
      const first = await exporter.email({}, USER, attempt.id);
      assert.equal(first.email.status, 'provider_accepted');
      assert.equal(first.email.deliveryConfirmed, false);
      assert.match(first.message, /Delivery is not yet confirmed/u);
      assert.equal(message.to, USER.email);
      assert.equal(message.attachment, undefined);
      assert.equal(message.deliveryKind, 'summary_link');
      assert.equal(message.idempotencyKey, `forecast-result/${attempt.id}/r1`);
      await exporter.email({}, USER, attempt.id);
      assert.equal(sent, 1, 'repeated click and settlement-response retry must not send again');
      assert.equal((await rpc({}, 'dd2026_forecast_result_pdf_record', { p_actor_user_id: OWNER, p_attempt_id: attempt.id,
        p_result_revision: 1, p_pdf_hash: 'f'.repeat(64), p_file_name: download.fileName, p_byte_count: bytes.length, p_download: true })).error.code, 'BAR_FORECAST_EXPORT_CONFLICT');
    });

    await t.test('unverified or changed verified recipient cannot bypass current Auth or reuse a previous email identity', async () => {
      await assert.rejects(exporter.email({}, { ...USER, email_confirmed_at: null }, attempt.id), { code: 'BAR_FORECAST_VERIFIED_EMAIL_REQUIRED' });
      await assert.rejects(exporter.email({}, { ...USER, email: 'another@example.test' }, attempt.id), { code: 'BAR_FORECAST_VERIFIED_EMAIL_REQUIRED' });
      await db.query('update auth.users set email=$1 where id=$2', ['changed@example.test', OWNER]);
      await assert.rejects(exporter.email({}, { ...USER, email: 'changed@example.test' }, attempt.id), { code: 'BAR_FORECAST_EMAIL_RECIPIENT_CHANGED' });
      await db.query('update auth.users set email=$1 where id=$2', [USER.email, OWNER]);
      assert.equal(sent, 1);
    });

    await t.test('uncertain provider outcome retries only by explicit request within the same finite idempotency window', async () => {
      const pending = await completedAttempt();
      const keys = [];
      const uncertain = createForecastResultExporter({ attemptStore: store, rpc, renderPdf: async () => bytes,
        sendEmail: async (_env, input) => { keys.push(input.idempotencyKey); throw new Error('Fixture timeout; acceptance unknown.'); } });
      for (let execution = 0; execution < 3; execution += 1) {
        if (execution) await db.query('update public.dd2026_forecast_result_exports set email_retry_at=statement_timestamp() where attempt_id=$1', [pending.id]);
        const result = await uncertain.email({}, USER, pending.id);
        assert.equal(result.email.status, 'uncertain');
        assert.equal(result.email.deliveryConfirmed, false);
        await uncertain.email({}, USER, pending.id).catch((error) => assert.equal(error.code, 'BAR_FORECAST_EMAIL_RETRY_LIMIT'));
        assert.equal(keys.length, execution + 1);
      }
      assert.equal(new Set(keys).size, 1);
      await assert.rejects(uncertain.email({}, USER, pending.id), { code: 'BAR_FORECAST_EMAIL_RETRY_LIMIT' });
    });

    await t.test('expired claims are fenced, safe recovery uses the same key, and provider retention is never exceeded', async () => {
      const pending = await completedAttempt();
      const fast = createForecastResultExporter({ attemptStore: store, rpc, renderPdf: async () => bytes });
      const pdf = await fast.pdf({}, USER, pending.id);
      const args = { p_actor_user_id: OWNER, p_attempt_id: pending.id, p_result_revision: 1, p_recipient_email: USER.email, p_pdf_hash: pdf.hash };
      const first = await rpc({}, 'dd2026_forecast_result_email_claim', args);
      assert.equal((await rpc({}, 'dd2026_forecast_result_email_claim', args)).claimed, false);
      await db.query("update public.dd2026_forecast_result_exports set email_lease_expires_at=statement_timestamp()-interval '1 second' where attempt_id=$1", [pending.id]);
      const second = await rpc({}, 'dd2026_forecast_result_email_claim', args);
      assert.equal(second.idempotencyKey, first.idempotencyKey);
      assert.notEqual(second.leaseToken, first.leaseToken);
      const old = await rpc({}, 'dd2026_forecast_result_email_settle', { p_actor_user_id: OWNER, p_attempt_id: pending.id, p_result_revision: 1,
        p_lease_token: first.leaseToken, p_status: 'provider_accepted', p_provider_id: 'stale' });
      assert.equal(old.error.code, 'BAR_FORECAST_EMAIL_LEASE_LOST');
      // Transaction timestamp controls the expiry test without rewriting immutable history.
      await db.exec('begin');
      try {
        await db.exec('alter table public.dd2026_forecast_result_exports disable trigger dd2026_forecast_result_export_immutable');
        await db.query("update public.dd2026_forecast_result_exports set email_requested_at=statement_timestamp()-interval '24 hours',email_lease_expires_at=statement_timestamp()-interval '1 second' where attempt_id=$1", [pending.id]);
        assert.equal((await rpc({}, 'dd2026_forecast_result_email_claim', args)).error.code, 'BAR_FORECAST_EMAIL_RETRY_LIMIT');
      } finally { await db.exec('rollback'); }
    });

    await t.test('five-report daily limit and browser-role denials are enforced in SQL', async () => {
      for (let index = 0; index < 2; index += 1) {
        const next = await completedAttempt();
        const fast = createForecastResultExporter({ attemptStore: store, rpc, renderPdf: async () => bytes,
          sendEmail: async () => ({ definitelyNotAccepted: true }) });
        assert.equal((await fast.email({}, USER, next.id)).email.status, 'failed');
      }
      const sixth = await completedAttempt();
      const fast = createForecastResultExporter({ attemptStore: store, rpc, renderPdf: async () => bytes, sendEmail: async () => { assert.fail('daily limit must precede send'); } });
      await assert.rejects(fast.email({}, USER, sixth.id), { code: 'BAR_FORECAST_EMAIL_RATE_LIMIT', status: 429 });
      for (const role of ['anon', 'authenticated']) {
        await db.exec(`set role ${role}`);
        try {
          await assert.rejects(db.query('select * from public.dd2026_forecast_result_exports'), /permission denied/u);
          await assert.rejects(db.query('select public.dd2026_forecast_result_email_public($1,1)', [attempt.id]), /permission denied/u);
        } finally { await db.exec('reset role'); }
      }
    });
  } finally { await db.close(); }
});

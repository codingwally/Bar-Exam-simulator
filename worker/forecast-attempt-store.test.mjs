import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import {
  createForecastAttemptStore,
  FORECAST_ATTEMPT_POLICY,
  FORECAST_ATTEMPT_RPC_NAMES,
} from './forecast-attempt-store.mjs';
import { forecastSetId, BAR_FORECAST_SUBJECTS } from './bar-forecast-core.mjs';

const migration = await readFile(new URL('../supabase/migrations/20260907060650_astra_forecast_attempts.sql', import.meta.url), 'utf8');
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SUBJECT = BAR_FORECAST_SUBJECTS[0];
const clientId = () => crypto.randomUUID();

function rows() {
  return Array.from({ length: 20 }, (_, index) => ({
    id: `forecast-fixture-${index + 1}`, number: index + 1, subject: SUBJECT,
    title: `Curated fixture ${index + 1}`, checksum: String(index + 1).padStart(64, '0'),
    payloadCanonical: JSON.stringify({ fixture: index + 1 }),
    prompt: `Question ${index + 1}: Apply the curated legal rule to the stated material facts.`,
    suggestedAnswer: `Suggested answer ${index + 1} explains the curated rule and its application to the material facts.`,
    legalBasis: 'Curated legal authority is retained in the private question snapshot.',
    controllingDoctrine: 'Private controlling-doctrine snapshot.',
    jurisprudence: 'Curated authority fixture', citation: 'Fixture source reference',
    userAnswer: `Answer ${index + 1}: The controlling rule applies because the material facts satisfy its conditions, so the stated conclusion follows.`,
  }));
}

const ROWS = rows();
const SET_ID = await forecastSetId(ROWS);
const intake = (overrides = {}) => ({
  ownerId: OWNER, clientAttemptId: clientId(), subject: SUBJECT,
  setId: SET_ID, rowsWithAnswers: structuredClone(ROWS), ...overrides,
});
function grade(claim, score = 4) {
  return { results: claim.rows.map((row) => ({
    questionId: row.id, score,
    grammar: { score: 1, corrections: [] },
    issueSpotting: { score: 5, identified: [], missed: [] },
  })) };
}

test('accept validates identity, complete answers, and frozen content before any persistence', async () => {
  let called = 0;
  const store = createForecastAttemptStore({ rpc: async () => { called += 1; return { ok: true }; } });
  await assert.rejects(store.accept({}, intake({ clientAttemptId: 'bad' })), { code: 'BAR_FORECAST_ATTEMPT_INVALID' });
  await assert.rejects(store.accept({}, intake({ rowsWithAnswers: ROWS.slice(0, 19) })), { code: 'BAR_FORECAST_ANSWERS_INCOMPLETE' });
  const changed = structuredClone(ROWS);
  changed[19].prompt += ' Unapproved change.';
  await assert.rejects(store.accept({}, intake({ rowsWithAnswers: changed })), { code: 'BAR_FORECAST_SET_CHANGED' });
  assert.equal(called, 0);
});

test('new tables and every privileged function remain service-only with pinned search paths', () => {
  for (const table of ['dd2026_forecast_attempts', 'dd2026_forecast_batches', 'dd2026_forecast_attempt_events']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'u'));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, 'u'));
  }
  assert.doesNotMatch(migration, /security definer/iu);
  assert.match(migration, /revoke all on function %s from public,anon,authenticated/u);
  assert.match(migration, /grant execute on function %s to service_role/u);
  for (const name of FORECAST_ATTEMPT_RPC_NAMES) assert.ok(migration.includes(`create function public.${name}(`));
  assert.equal(FORECAST_ATTEMPT_POLICY.leaseSeconds, 600);
});

test('storage transport errors never echo private answers, database details, or credentials', async () => {
  const store = createForecastAttemptStore({ rpc: async () => { throw new Error('PRIVATE fixture answer and database credential'); } });
  await assert.rejects(store.getOwned({}, OWNER, clientId()), (error) => {
    assert.equal(error.code, 'BAR_FORECAST_PERSISTENCE_UNAVAILABLE');
    assert.equal(error.status, 503);
    assert.doesNotMatch(error.message, /PRIVATE|credential|fixture/u);
    return true;
  });
});

let PGlite;
try {
  const moduleName = process.env.PGLITE_MODULE_PATH
    ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite';
  ({ PGlite } = await import(moduleName));
} catch (error) {
  if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error;
}

test('actual migration and store lifecycle in isolated in-memory PostgreSQL', {
  skip: !PGlite && 'Install @electric-sql/pglite or set PGLITE_MODULE_PATH to execute SQL lifecycle tests.',
}, async (t) => {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${OWNER}'),('${OTHER}');
    create table public.dd2026_bar_forecast_consents(user_id uuid, consent_version text);
    insert into public.dd2026_bar_forecast_consents values('${OWNER}','2026-09-01'),('${OTHER}','2026-09-01');
    create function public.dd2026_bar_forecast_access_allowed(uuid) returns boolean language sql stable as 'select $1 is not null';
    grant usage on schema public,auth to service_role;
    grant select on public.dd2026_bar_forecast_consents,auth.users to service_role;
  `);
  try {
    await db.exec(migration);
    const rpc = async (_env, name, args) => {
      assert.ok(FORECAST_ATTEMPT_RPC_NAMES.includes(name));
      const entries = Object.entries(args);
      const result = await db.query(`select public.${name}(${entries.map(([key], index) => `${key}=>$${index + 1}`).join(',')}) as value`, entries.map(([, value]) => value));
      return result.rows[0]?.value;
    };
    const store = createForecastAttemptStore({ rpc });
    let accepted;
    let intakePayload;

    await t.test('atomic intake reuses one immutable identity and rejects changed twentieth answer', async () => {
      intakePayload = intake();
      const first = await store.accept({}, intakePayload);
      accepted = first.attempt;
      assert.equal(first.alreadyAccepted, false);
      assert.equal(accepted.answers.length, 20);
      assert.equal(accepted.answers[19].answer, ROWS[19].userAnswer);
      const second = await store.accept({}, intakePayload);
      assert.equal(second.alreadyAccepted, true);
      assert.equal(second.attempt.id, accepted.id);
      const modified = structuredClone(intakePayload);
      modified.rowsWithAnswers[19].userAnswer += ' Different final answer.';
      await assert.rejects(store.accept({}, modified), { code: 'BAR_FORECAST_ATTEMPT_CONFLICT', status: 409 });
      const counts = (await db.query('select (select count(*) from public.dd2026_forecast_attempts)::int attempts,(select count(*) from public.dd2026_forecast_batches)::int batches')).rows[0];
      assert.deepEqual(counts, { attempts: 1, batches: 5 });
      await assert.rejects(db.query("update public.dd2026_forecast_attempts set subject='Changed' where id=$1", [accepted.id]), /immutable/u);
    });

    await t.test('owner retrieval never exposes another owner or a pre-completion key', async () => {
      await assert.rejects(store.getOwned({}, OTHER, accepted.id), { code: 'BAR_FORECAST_ATTEMPT_NOT_FOUND', status: 404 });
      const restored = await store.getOwned({}, OWNER, accepted.id);
      assert.equal(restored.attempt.id, accepted.id);
      assert.equal(restored.attempt.result, null);
      assert.equal(restored.attempt.summary, null);
      assert.equal(restored.attempt.completedQuestionCount, 0);
      for (const key of ['suggestedAnswer', 'legalBasis', 'controllingDoctrine', 'payloadCanonical', 'snapshot']) {
        assert.equal(JSON.stringify(restored).includes(`"${key}"`), false, `${key} must remain private`);
      }
      const history = await store.history({}, OTHER);
      assert.equal(history.attempts.length, 0);
    });

    await t.test('an active claim excludes duplicate processing; expired lease is fenced and audited', async () => {
      const old = await store.claim({}, { attemptId: accepted.id });
      assert.equal(old.claimed, true);
      assert.equal(old.batchIndex, 0);
      assert.equal(old.rows.length, 4);
      assert.equal((await store.claim({}, { attemptId: accepted.id })).claimed, false);
      await db.query("update public.dd2026_forecast_batches set lease_expires_at=statement_timestamp()-interval '1 second' where attempt_id=$1 and batch_index=0", [accepted.id]);
      const current = await store.claim({}, { attemptId: accepted.id });
      assert.notEqual(current.leaseToken, old.leaseToken);
      assert.equal(current.execution, 2);
      await assert.rejects(store.checkpoint({}, old, grade(old)), { code: 'BAR_FORECAST_LEASE_LOST' });
      await assert.rejects(store.fail({}, old, { code: 'COACH_TIMEOUT' }), { code: 'BAR_FORECAST_LEASE_LOST' });
      const saved = await store.checkpoint({}, current, grade(current));
      assert.equal(saved.completedQuestionCount, 4);
      assert.equal((await store.checkpoint({}, current, grade(current))).alreadySaved, true);
      const events = await db.query("select count(*)::int n from public.dd2026_forecast_attempt_events where attempt_id=$1 and event_type='lease_expired_uncertain'", [accepted.id]);
      assert.equal(events.rows[0].n, 1);
    });

    await t.test('partial and malformed grading cannot become a student zero or a completed result', async () => {
      await assert.rejects(store.finalize({}, accepted.id), { code: 'BAR_FORECAST_RESULT_INCOMPLETE' });
      const claim = await store.claim({}, { attemptId: accepted.id });
      await assert.rejects(store.checkpoint({}, claim, { results: [] }), { code: 'BAR_FORECAST_GRADING_INVALID' });
      const invalid = await rpc({}, 'dd2026_forecast_attempt_checkpoint', {
        p_attempt_id: claim.attemptId, p_batch_index: claim.batchIndex, p_lease_token: claim.leaseToken, p_result: { results: [] },
      });
      assert.equal(invalid.error.code, 'BAR_FORECAST_GRADING_INVALID');
      const snapshot = (await store.getOwned({}, OWNER, accepted.id)).attempt;
      assert.equal(snapshot.completedQuestionCount, 4);
      assert.equal(snapshot.result, null);
      assert.equal(snapshot.summary, null);
      await store.checkpoint({}, claim, grade(claim));
    });

    await t.test('five durable ordered checkpoints produce one immutable canonical 80/100 report', async () => {
      for (let index = 2; index < 5; index += 1) {
        const claim = await store.claim({}, { attemptId: accepted.id });
        assert.equal(claim.batchIndex, index);
        const checkpoint = await store.checkpoint({}, claim, grade(claim));
        assert.equal(checkpoint.readyToFinalize, index === 4);
      }
      assert.equal((await store.claim({}, { attemptId: accepted.id })).readyToFinalize, true);
      const probingStore = createForecastAttemptStore({ rpc: async (env, name, args) => {
        if (name === 'dd2026_forecast_attempt_finalize') {
          for (const mutate of [
            (result) => { result.totalScore = 99; },
            (result) => { result.analytics.grammarAverage = 5; },
            (result) => { result.results[19].userAnswer = 'Another attempt answer'; },
            (result) => { result.results[0].citation = 'Unapproved authority'; },
          ]) {
            const corrupted = structuredClone(args);
            mutate(corrupted.p_result);
            await db.exec('begin');
            try {
              assert.equal((await rpc(env, name, corrupted)).error.code, 'BAR_FORECAST_GRADING_INVALID');
              assert.equal((await store.getOwned({}, OWNER, accepted.id)).attempt.status, 'failed');
            } finally { await db.exec('rollback'); }
          }
        }
        return rpc(env, name, args);
      } });
      const finished = (await probingStore.finalize({}, accepted.id)).attempt;
      assert.equal(finished.status, 'complete');
      assert.equal(finished.result.totalScore, 80);
      assert.equal(finished.summary.percentage, 80);
      assert.equal(finished.result.analytics.grammarAverage, 1);
      assert.equal(finished.result.analytics.issueSpottingAverage, 5);
      assert.equal(finished.result.results.length, 20);
      assert.deepEqual(finished.result.results.map((row) => row.userAnswer), ROWS.map((row) => row.userAnswer));
      assert.deepEqual((await store.finalize({}, accepted.id)).attempt, finished);
      assert.equal((await store.claim({}, { attemptId: accepted.id })).claimed, false);
      const altered = structuredClone(finished.result);
      altered.totalScore = 90;
      const conflict = await rpc({}, 'dd2026_forecast_attempt_finalize', { p_attempt_id: accepted.id, p_result: altered });
      assert.equal(conflict.error.code, 'BAR_FORECAST_RESULT_CONFLICT');
      await assert.rejects(db.query("update public.dd2026_forecast_attempts set result='{}'::jsonb where id=$1", [accepted.id]), /immutable/u);
    });

    await t.test('capacity retry uses persisted delay, finite automatic budget, and two idempotent manual retries', async () => {
      const id = (await store.accept({}, intake())).attempt.id;
      for (let execution = 1; execution <= 6; execution += 1) {
        const claim = await store.claim({}, { attemptId: id });
        assert.equal(claim.execution, execution);
        const failure = await store.fail({}, claim, { code: 'BAR_FORECAST_GRADING_CAPACITY' });
        assert.equal(failure.status, execution < 4 ? 'retryable_failed' : 'failed');
        assert.equal((await store.claim({}, { attemptId: id })).claimed, false, 'retry_at must prevent immediate model loop');
        if (execution < 4) {
          await db.query('update public.dd2026_forecast_batches set retry_at=statement_timestamp() where attempt_id=$1 and batch_index=0', [id]);
        } else if (execution < 6) {
          await store.retry({}, OWNER, id);
          assert.equal((await store.retry({}, OWNER, id)).alreadyScheduled, true);
        }
      }
      await assert.rejects(store.retry({}, OWNER, id), { code: 'BAR_FORECAST_RETRY_LIMIT' });
      const counts = (await db.query('select manual_retries from public.dd2026_forecast_attempts where id=$1', [id])).rows[0];
      assert.equal(counts.manual_retries, 2);
      assert.equal((await store.getOwned({}, OWNER, id)).attempt.answers.length, 20);
    });

    await t.test('history complete filter precedes pagination and global claims rotate across waiting owners', async () => {
      const first = (await store.accept({}, intake())).attempt.id;
      const second = (await store.accept({}, intake({ ownerId: OTHER }))).attempt.id;
      const firstClaim = await store.claim({});
      assert.equal(firstClaim.attemptId, first);
      await store.checkpoint({}, firstClaim, grade(firstClaim));
      const secondClaim = await store.claim({});
      assert.equal(secondClaim.attemptId, second);
      const page = await store.history({}, OWNER, { limit: 1, completeOnly: true });
      assert.equal(page.attempts.length, 1);
      assert.equal(page.attempts[0].id, accepted.id);
      assert.equal(page.attempts[0].questions, null);
      assert.equal(page.attempts[0].result, null);
    });

    await t.test('anonymous and browser roles cannot read tables or invoke private processing RPCs', async () => {
      for (const role of ['anon', 'authenticated']) {
        await db.exec(`set role ${role}`);
        try {
          await assert.rejects(db.query('select * from public.dd2026_forecast_attempts'), /permission denied/u);
          await assert.rejects(db.query('select public.dd2026_forecast_attempt_internal($1)', [accepted.id]), /permission denied/u);
          await assert.rejects(db.query('select public.dd2026_forecast_attempt_get($1,$2)', [OWNER, accepted.id]), /permission denied/u);
        } finally { await db.exec('reset role'); }
      }
      await db.exec('set role service_role');
      try {
        const authorized = await store.getOwned({}, OWNER, accepted.id);
        assert.equal(authorized.attempt.id, accepted.id);
        const writable = await store.accept({}, intake());
        assert.equal(writable.attempt.status, 'pending');
      } finally { await db.exec('reset role'); }
    });

    await t.test('history cursor does not lose attempts accepted at the identical timestamp', async () => {
      const snapshot = (await rpc({}, 'dd2026_forecast_attempt_internal', { p_attempt_id: accepted.id })).snapshot;
      const tied = await db.query(`select public.dd2026_forecast_attempt_accept($1,$2,$4) one,
        public.dd2026_forecast_attempt_accept($1,$3,$4) two`, [OTHER, clientId(), clientId(), snapshot]);
      assert.equal(tied.rows[0].one.attempt.acceptedAt, tied.rows[0].two.attempt.acceptedAt);
      const first = await store.history({}, OTHER, { limit: 1 });
      const second = await store.history({}, OTHER, { limit: 1, before: first.nextCursor });
      assert.equal(second.attempts.length, 1);
      assert.notEqual(second.attempts[0].id, first.attempts[0].id);
      assert.equal(second.attempts[0].acceptedAt, first.attempts[0].acceptedAt);
    });
  } finally {
    await db.close();
  }
});

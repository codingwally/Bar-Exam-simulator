// Real isolated SQL + production store/drain; no external provider or customer data.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import { aggregateBarForecastScores, BAR_FORECAST_SUBJECTS, forecastSetId } from './bar-forecast-core.mjs';
import { createForecastAttemptStore, FORECAST_ATTEMPT_RPC_NAMES } from './forecast-attempt-store.mjs';
import { createBarForecastHandlers } from './bar-forecast-routes.mjs';
import { validateSavedForecastForExport } from './forecast-result-export.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const rows = Array.from({ length: 20 }, (_, i) => ({
  id: `rounding-${i + 1}`, number: i + 1, subject: BAR_FORECAST_SUBJECTS[0], title: `Fixture ${i + 1}`,
  checksum: String(i + 1).padStart(64, '0'), payloadCanonical: JSON.stringify({ fixture: i + 1 }),
  prompt: 'Apply the controlling rule to the stated material facts.',
  suggestedAnswer: 'The controlling rule applies because the facts establish each required legal element.',
  legalBasis: 'The curated legal authority controls the material facts.', controllingDoctrine: 'Each element must be established.',
  jurisprudence: 'Local fixture only', citation: 'Local fixture reference',
  userAnswer: 'The controlling rule applies because the material facts establish each legal element, so the requested conclusion follows.',
}));
const setId = await forecastSetId(rows);
const source = await readFile(new URL('../assets/bar-forecast.js', import.meta.url), 'utf8');
const start = source.indexOf('  function normalizeResults(');
const normalizer = source.slice(start, source.indexOf('\n  async function submitForecast(', start));
assert.ok(start > 0 && normalizer.includes('return Object.freeze'));
const normalize = (attempt) => {
  const context = vm.createContext({ payload: attempt.result, REQUIRED_QUESTION_COUNT: 20,
    GRAMMAR_CORRECTION_GUIDANCE: {}, state: { questions: attempt.questions,
      answers: new Map(attempt.answers.map((row) => [row.questionId, row.answer])) } });
  return vm.runInContext(`${normalizer}\nnormalizeResults(payload)`, context);
};
const half = (base, count) => Array.from({ length: count }, (_, i) => (base + (i % 2)) / 10);
let PGlite;
try {
  ({ PGlite } = await import(process.env.PGLITE_MODULE_PATH ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite'));
} catch (error) { if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error; }

test('integer tenths round all fifty positive half boundaries for four- and twenty-question sets', () => {
  for (const count of [4, 20]) for (let base = 0; base < 50; base += 1) {
    const actual = aggregateBarForecastScores(half(base, count));
    assert.equal(actual.average, (base + 1) / 10, `${count} scores at ${(base + 0.5) / 10}`);
    assert.equal(actual.total, count * (2 * base + 1) / 20);
  }
  assert.deepEqual(aggregateBarForecastScores([2, 2, 2, ...Array(17).fill(1)]), { total: 23, average: 1.2 });
});

test('finalization rounding and terminal failure under actual service-role PostgreSQL', {
  skip: !PGlite && 'PGLITE_MODULE_PATH is required for the release SQL gate.',
}, async (t) => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${OWNER}');
    create table public.dd2026_bar_forecast_consents(user_id uuid,consent_version text);
    insert into public.dd2026_bar_forecast_consents values('${OWNER}','2026-09-01');
    create function public.dd2026_bar_forecast_access_allowed(uuid) returns boolean language sql stable as 'select $1 is not null';
    grant usage on schema public to service_role; grant select on public.dd2026_bar_forecast_consents to service_role;`);
  try {
    await db.exec(await readFile(new URL('../supabase/migrations/20260907060650_astra_forecast_attempts.sql', import.meta.url), 'utf8'));
    const rpc = async (_env, name, args) => {
      assert.ok(FORECAST_ATTEMPT_RPC_NAMES.includes(name));
      const entries = Object.entries(args);
      await db.exec('set role service_role');
      try { return (await db.query(`select public.${name}(${entries.map(([key], i) => `${key}=>$${i + 1}`).join(',')}) value`, entries.map(([, value]) => value))).rows[0].value; }
      finally { await db.exec('reset role'); }
    };
    const store = createForecastAttemptStore({ rpc });
    const intake = async () => (await store.accept({}, { ownerId: OWNER, clientAttemptId: crypto.randomUUID(),
      subject: rows[0].subject, setId, rowsWithAnswers: rows })).attempt.id;
    const checkpointAll = async (scores = half(11, 20)) => {
      const id = await intake();
      for (let batch = 0; batch < 5; batch += 1) {
        const claim = await store.claim({}, { attemptId: id });
        assert.equal(claim.batchIndex, batch);
        await store.checkpoint({}, claim, { results: claim.rows.map((row) => ({ questionId: row.id, score: scores[row.number - 1],
          grammar: { score: scores[row.number - 1], corrections: [] },
          issueSpotting: { score: scores[row.number - 1], identified: [], missed: [] } })) });
      }
      return id;
    };
    const counts = async (id) => (await db.query(`select count(*)::int batches,sum(executions)::int executions,
      sum(jsonb_array_length(result->'results'))::int assessments from public.dd2026_forecast_batches where attempt_id=$1 and status='complete'`, [id])).rows[0];
    const drainFor = (activeStore, onProvider = () => assert.fail('Completed checkpoints must never be regraded')) => createBarForecastHandlers({
      attemptStore: activeStore, barForecastRpc: rpc, structuredGemini: onProvider,
    });

    await t.test('all half boundaries agree with SQL numeric averages for counts four and twenty', async () => {
      for (const count of [4, 20]) for (let base = 0; base < 50; base += 1) {
        const scores = half(base, count);
        const sql = (await db.query('select round(avg(v),1)::text average from unnest($1::numeric[]) v', [scores])).rows[0];
        assert.equal(aggregateBarForecastScores(scores).average, Number(sql.average));
      }
    });

    await t.test('SQL canonical, frontend and PDF agree at 1.15, 2.05, 2.55, 4.65 and nonuniform 1.15', async () => {
      for (const scores of [half(11, 20), half(20, 20), half(25, 20), half(46, 20), [2, 2, 2, ...Array(17).fill(1)]]) {
        const id = await checkpointAll(scores);
        const attempt = (await store.finalize({}, id)).attempt;
        const expected = aggregateBarForecastScores(scores);
        assert.equal(attempt.status, 'complete');
        assert.equal(attempt.result.totalScore, expected.total);
        for (const key of ['averageScore', 'grammarAverage', 'issueSpottingAverage']) {
          assert.equal(attempt.result.analytics[key], expected.average);
          assert.equal(normalize(attempt).analytics[key], expected.average);
          assert.equal(validateSavedForecastForExport(attempt, OWNER).analytics[key], expected.average);
        }
        const wrong = structuredClone(attempt); wrong.result.analytics.grammarAverage -= 0.1;
        assert.throws(() => normalize(wrong), /analytics failed/);
        assert.throws(() => validateSavedForecastForExport(wrong, OWNER), { code: 'BAR_FORECAST_EXPORT_INVALID' });
        assert.deepEqual(await counts(id), { batches: 5, executions: 5, assessments: 20 });
      }
    });

    await t.test('invalid finalization stops scheduled drain, retains twenty checkpoints and exhausts only two manual retries', async () => {
      const id = await checkpointAll(); let finalizations = 0;
      const corruptStore = createForecastAttemptStore({ rpc: async (env, name, args) => {
        if (name === 'dd2026_forecast_attempt_finalize') {
          finalizations += 1; args = structuredClone(args); args.p_result.analytics.grammarAverage = 0;
        }
        return rpc(env, name, args);
      } });
      const handlers = drainFor(corruptStore);
      for (let cycle = 0; cycle < 3; cycle += 1) {
        const result = await handlers.drain({}, { attemptId: id, maxBatches: 5 });
        assert.equal(result.failed, 1); assert.equal(result.claimed, 0);
        const attempt = (await store.getOwned({}, OWNER, id)).attempt;
        assert.equal(attempt.status, 'failed'); assert.equal(attempt.retryAllowed, cycle < 2);
        assert.equal(attempt.completedQuestionCount, 20); assert.equal(attempt.answers.length, 20);
        assert.equal(attempt.result, null); assert.equal(attempt.summary, null);
        for (let tick = 0; tick < 4; tick += 1) {
          const idle = await handlers.drain({}, { attemptId: id, maxBatches: 5 });
          assert.equal(idle.failed, 0); assert.equal(idle.claimed, 0);
        }
        assert.equal(finalizations, cycle + 1);
        assert.deepEqual(await counts(id), { batches: 5, executions: 5, assessments: 20 });
        if (cycle < 2) {
          await store.retry({}, OWNER, id);
          assert.equal((await store.retry({}, OWNER, id)).alreadyScheduled, true);
          assert.equal((await store.claim({}, { attemptId: id })).readyToFinalize, true);
        }
      }
      await assert.rejects(store.retry({}, OWNER, id), { code: 'BAR_FORECAST_RETRY_LIMIT' });
      const events = (await db.query("select details from public.dd2026_forecast_attempt_events where attempt_id=$1 and event_type='finalization_failed'", [id])).rows;
      assert.equal(events.length, 3);
      for (const event of events) assert.deepEqual(event.details, { code: 'BAR_FORECAST_GRADING_INVALID' });
      for (const role of ['anon', 'authenticated']) {
        await db.exec(`set role ${role}`);
        try { await assert.rejects(db.query('select public.dd2026_forecast_attempt_finalization_error($1)', [id]), /permission denied/); }
        finally { await db.exec('reset role'); }
      }
    });

    await t.test('deterministic local assembly failure is terminal and a manual retry finalizes without regrading', async () => {
      const id = await checkpointAll();
      const brokenRead = createForecastAttemptStore({ rpc: async (env, name, args) => {
        const value = await rpc(env, name, args);
        if (name === 'dd2026_forecast_attempt_internal') value.batches[4].result = { results: [] };
        return value;
      } });
      await assert.rejects(brokenRead.finalize({}, id), { code: 'BAR_FORECAST_GRADING_INVALID' });
      assert.equal((await store.getOwned({}, OWNER, id)).attempt.status, 'failed');
      await assert.rejects(store.finalize({}, id), { code: 'BAR_FORECAST_GRADING_INVALID' });
      await store.retry({}, OWNER, id);
      assert.equal((await drainFor(store).drain({}, { attemptId: id })).completed, 1);
      assert.deepEqual(await counts(id), { batches: 5, executions: 5, assessments: 20 });
    });

    await t.test('incomplete assessments and uncertain RPC commits remain safely recoverable', async () => {
      const incompleteId = await intake();
      assert.equal((await rpc({}, 'dd2026_forecast_attempt_finalization_error', { p_attempt_id: incompleteId })).error.code, 'BAR_FORECAST_RESULT_INCOMPLETE');
      assert.equal((await store.getOwned({}, OWNER, incompleteId)).attempt.status, 'pending');
      for (const committed of [false, true]) {
        const id = await checkpointAll(); let lost = true;
        const uncertainStore = createForecastAttemptStore({ rpc: async (env, name, args) => {
          if (name === 'dd2026_forecast_attempt_finalize' && lost) {
            lost = false;
            if (committed) await rpc(env, name, args);
            throw new Error('Private fixture: uncertain transport');
          }
          return rpc(env, name, args);
        } });
        await assert.rejects(uncertainStore.finalize({}, id), { code: 'BAR_FORECAST_PERSISTENCE_UNAVAILABLE' });
        const prior = (await store.getOwned({}, OWNER, id)).attempt;
        assert.equal(prior.status, committed ? 'complete' : 'processing');
        const recovered = (await uncertainStore.finalize({}, id)).attempt;
        assert.equal(recovered.status, 'complete');
        assert.deepEqual(await counts(id), { batches: 5, executions: 5, assessments: 20 });
        assert.equal((await db.query("select count(*)::int n from public.dd2026_forecast_attempt_events where attempt_id=$1 and event_type='completed'", [id])).rows[0].n, 1);
        assert.equal((await rpc({}, 'dd2026_forecast_attempt_finalize', { p_attempt_id: id, p_result: null })).error.code, 'BAR_FORECAST_RESULT_CONFLICT');
      }
    });
  } finally { await db.close(); }
});

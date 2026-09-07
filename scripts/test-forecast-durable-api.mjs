// Isolated integration: real migration + default production store + real routes.
// Provider responses below are explicit fixtures, not production grading evidence.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createBarForecastHandlers } from '../worker/bar-forecast-routes.mjs';
import { FORECAST_ATTEMPT_RPC_NAMES } from '../worker/forecast-attempt-store.mjs';
import {
  BAR_FORECAST_CONTENT_TYPE, BAR_FORECAST_SOURCE_VERSION, BAR_FORECAST_SUBJECTS,
  forecastSetId, validatedForecastRows,
} from '../worker/bar-forecast-core.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const THIRD = '33333333-3333-4333-8333-333333333333';
const SUBJECT = BAR_FORECAST_SUBJECTS[0];
const SECOND = BAR_FORECAST_SUBJECTS[1];
const migration = await readFile(new URL('../supabase/migrations/20260907060650_astra_forecast_attempts.sql', import.meta.url), 'utf8');

function content(subject) {
  return Array.from({ length: 20 }, (_, index) => {
    const number = index + 1;
    const id = `durable-${subject === SUBJECT ? 'pol' : 'com'}-${number}`;
    return {
      id, subject, contentType: BAR_FORECAST_CONTENT_TYPE, version: BAR_FORECAST_SOURCE_VERSION,
      title: `CASE-${number} — Approved case ${number}`, checksum: String(number).padStart(64, '0'),
      payload: {
        id, subject, version: BAR_FORECAST_SOURCE_VERSION, editorial_ref: `CASE-${number}`,
        title: `Approved case ${number}`, rank_within_subject: number,
        prompt: `Question ${number}: Explain whether the controlling legal rule applies to the material facts.`,
        suggested_answer: `Suggested answer ${number}: The controlling rule applies because all its elements are satisfied by the material facts.`,
        legal_basis: 'The curated legal basis controls the outcome under the stated material facts.',
        controlling_doctrine: 'The controlling doctrine requires each legal element to be established.',
        jurisprudence: `Curated case ${number}`, citation: `Curated reference ${number}`,
      },
    };
  });
}
const sources = { [SUBJECT]: content(SUBJECT), [SECOND]: content(SECOND) };
const approvedSetIds = Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([subject, rows]) => [subject, await forecastSetId(validatedForecastRows(rows, subject))])));
function submission(subject = SUBJECT, operation = 'submit_attempt') {
  return {
    operation, subject, setId: approvedSetIds[subject],
    ...(operation === 'submit_attempt' ? { clientAttemptId: crypto.randomUUID() } : {}),
    answers: sources[subject].map((row, index) => ({ questionId: row.id,
      answer: `Answer ${index + 1}: The controlling rule applies because the material facts establish every element, and the requested conclusion follows.` })),
  };
}
function request(body, owner = OWNER) {
  return new Request('https://api.example.test/admin/dd2026/bar-forecast', {
    method: 'POST', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

let PGlite;
try {
  ({ PGlite } = await import(process.env.PGLITE_MODULE_PATH ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite'));
} catch (error) {
  if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error;
}

test('durable Forecast HTTP lifecycle with actual PostgreSQL and no external provider', {
  skip: !PGlite && 'Install @electric-sql/pglite or set PGLITE_MODULE_PATH; SQL/API integration must run before release.',
}, async (t) => {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values('${OWNER}'),('${OTHER}'),('${THIRD}');
    create table public.dd2026_bar_forecast_consents(user_id uuid,consent_version text);
    insert into public.dd2026_bar_forecast_consents select id,'2026-09-01' from auth.users;
    create function public.dd2026_bar_forecast_access_allowed(uuid) returns boolean language sql stable as 'select $1 is not null';
    grant usage on schema public,auth to service_role;
    grant select on public.dd2026_bar_forecast_consents,auth.users to service_role;
  `);
  try {
    await db.exec(migration);
    let providerCalls = 0;
    let contentCalls = 0;
    let contentChanged = false;
    let malformed = false;
    let capacity = false;
    let checkpointUncertain = false;
    let providerPause = null;
    let lastOptions;
    const waits = [];
    const rpc = async (_env, name, args) => {
      if (name === 'dd2026_bar_forecast_consent_status') return { consentAccepted: true };
      if (name === 'dd2026_bar_forecast_admin_list') {
        contentCalls += 1;
        if (contentChanged) throw new Error('The published question set is now different.');
        return { items: sources[args.p_subject] };
      }
      assert.ok(FORECAST_ATTEMPT_RPC_NAMES.includes(name), name);
      const entries = Object.entries(args);
      const result = await db.query(`select public.${name}(${entries.map(([key], i) => `${key}=>$${i + 1}`).join(',')}) value`, entries.map(([, value]) => value));
      if (name === 'dd2026_forecast_attempt_checkpoint' && checkpointUncertain && [1, 4].includes(args.p_batch_index)) {
        if (args.p_batch_index === 4) checkpointUncertain = false;
        else if (result.rows[0]?.value.alreadySaved) return result.rows[0].value;
        throw new Error('Fixture: transport broke after committed checkpoint.');
      }
      return result.rows[0]?.value;
    };
    const dependencies = {
      barForecastRpc: rpc, approvedSetIds,
      // No attemptStore override: exercise the real default production store.
      authorizeAdministrator: async () => ({ authorized: true, role: 'super_admin' }),
      requiredSetupAccess: async () => ({ allowed: true, role: 'super_admin', basis: 'super_admin', termsRequired: false,
        reauthenticationRequired: false, profileCompleted: true, tokenAcknowledgementRequired: false }),
      requireAuthenticatedUser: async (incoming) => {
        const id = incoming.headers.get('Authorization')?.replace('Bearer ', '');
        if (![OWNER, OTHER, THIRD].includes(id)) throw Object.assign(new Error('Sign in required.'), { code: 'AUTHENTICATION_REQUIRED', status: 401 });
        return { id };
      },
      enforceBarForecastRateLimit: async () => {},
      parseBoundedJson: async (incoming) => incoming.json(),
      jsonResponse: (body, status) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
      wait: async (milliseconds) => { waits.push(milliseconds); },
      structuredGemini: async (_env, prompt, _schema, validate, options) => {
        providerCalls += 1;
        lastOptions = options;
        if (providerPause) await providerPause;
        if (capacity) throw Object.assign(new Error('Fixture provider capacity.'), { code: 'COACH_CAPACITY' });
        if (malformed) return { result: validate({ results: [] }) };
        const records = JSON.parse(prompt.match(/CURATED FORECAST RECORDS AND UNTRUSTED ANSWERS\n([^\n]+)\n\nReturn only/u)[1]);
        const second = records[0].questionId.startsWith('durable-com');
        return { result: validate({ results: records.map((row) => ({ questionId: row.questionId,
          score: second ? 3 : 4, grammar: { score: second ? 4 : 2, corrections: [] },
          issueSpotting: { score: second ? 5 : 3, identified: [], missed: [] },
        })) }) };
      },
    };
    let handlers = createBarForecastHandlers(dependencies);
    const send = async (body, owner = OWNER) => {
      const response = await handlers.handle(request(body, owner), {}, 'https://example.test', 'https://example.test');
      assert.match(response.headers.get('Cache-Control'), /no-store/u);
      return { status: response.status, body: await response.json() };
    };
    const payload = submission();
    let primaryId;

    await t.test('202 acknowledges all twenty immutable answers before any model call, including the final editor answer', async () => {
      payload.answers[19].answer += ' The twentieth answer was captured immediately before submit.';
      const accepted = await send(payload);
      primaryId = accepted.body.attempt.id;
      assert.equal(accepted.status, 202);
      assert.equal(accepted.body.attempt.status, 'pending');
      assert.equal(accepted.body.attempt.answers.length, 20);
      assert.equal(accepted.body.attempt.answers[19].answer, payload.answers[19].answer);
      assert.equal(accepted.body.attempt.result, null);
      assert.equal(providerCalls, 0);
      assert.equal((await send(payload)).body.attempt.id, primaryId);
      const changed = structuredClone(payload);
      changed.answers[19].answer += ' Changed after acceptance.';
      await assert.rejects(send(changed), { code: 'BAR_FORECAST_ATTEMPT_CONFLICT', status: 409 });
      assert.equal(providerCalls, 0);
      assert.equal((await db.query('select count(*)::int n from public.dd2026_forecast_attempts')).rows[0].n, 1);
    });

    await t.test('handler restart resumes saved answers and a single project lease prevents overlapping provider requests', async () => {
      handlers = createBarForecastHandlers(dependencies);
      assert.equal((await send({ operation: 'attempt', attemptId: primaryId })).body.attempt.answers.length, 20);
      let release;
      providerPause = new Promise((resolve) => { release = resolve; });
      const first = handlers.drain({}, { attemptId: primaryId, maxBatches: 1 });
      // PGlite is async; wait only for the observable provider entry, not a clock.
      for (let count = 0; providerCalls === 0 && count < 100; count += 1) await new Promise((resolve) => setImmediate(resolve));
      assert.equal(providerCalls, 1);
      const duplicate = await createBarForecastHandlers(dependencies).drain({}, { maxBatches: 1 });
      assert.equal(duplicate.claimed, 0);
      assert.equal(providerCalls, 1);
      release(); providerPause = null;
      assert.equal((await first).checkpointed, 1);
      const partial = (await send({ operation: 'attempt', attemptId: primaryId })).body.attempt;
      assert.equal(partial.completedQuestionCount, 4);
      assert.equal(partial.summary, null);
      assert.equal(partial.result, null);
      assert.equal(JSON.stringify(partial).includes('suggestedAnswer'), false);
    });

    await t.test('post-commit checkpoint uncertainty retries persistence, never the provider, and saves one complete canonical result', async () => {
      checkpointUncertain = true;
      const summary = await handlers.drain({}, { attemptId: primaryId, maxBatches: 4 });
      assert.equal(summary.checkpointed, 4);
      assert.equal(summary.completed, 1);
      assert.equal(providerCalls, 5);
      assert.equal(lastOptions.preferredModel, 'gemini-3.6-flash');
      assert.equal(lastOptions.temperature, 0);
      assert.equal(lastOptions.requestTimeoutMs, 45000);
      const report = (await send({ operation: 'attempt', attemptId: primaryId })).body.attempt.result;
      assert.equal(report.complete, true);
      assert.equal(report.totalScore, 80);
      assert.equal(report.results.length, 20);
      assert.equal(report.results[19].userAnswer, payload.answers[19].answer);
      assert.equal(report.results[19].question, sources[SUBJECT][19].payload.prompt);
      assert.equal(report.resultRevision, 1);
      const beforeReads = providerCalls;
      contentChanged = true;
      for (let index = 0; index < 2; index += 1) {
        assert.deepEqual((await send({ operation: 'attempt', attemptId: primaryId })).body.attempt.result, report);
        assert.deepEqual((await send(payload)).body.attempt.result, report);
        assert.equal((await send({ operation: 'history', completeOnly: true })).body.attempts[0].id, primaryId);
      }
      contentChanged = false;
      assert.equal(providerCalls, beforeReads);
    });

    await t.test('legacy submit retains the original response shape and stable replay survives a later content publication', async () => {
      const legacy = submission(SECOND, 'submit');
      const response = await send(legacy);
      assert.equal(response.status, 200);
      assert.equal(response.body.totalScore, 60);
      assert.equal(response.body.results.length, 20);
      const beforeCalls = providerCalls;
      const beforeContent = contentCalls;
      contentChanged = true;
      assert.deepEqual((await send({ ...legacy, answers: [...legacy.answers].reverse() })).body, response.body);
      contentChanged = false;
      assert.equal(providerCalls, beforeCalls);
      assert.equal(contentCalls, beforeContent);
    });

    await t.test('malformed grading stays failed with saved answers, never a completed zero, and explicit retry is bounded', async () => {
      const id = (await send(submission())).body.attempt.id;
      malformed = true;
      const bad = await handlers.drain({}, { attemptId: id });
      assert.deepEqual(bad.errors, ['BAR_FORECAST_GRADING_INVALID']);
      let snapshot = (await send({ operation: 'attempt', attemptId: id })).body.attempt;
      assert.equal(snapshot.status, 'failed');
      assert.equal(snapshot.result, null);
      assert.equal(snapshot.answers.length, 20);
      assert.equal(snapshot.retryAllowed, true);
      const before = providerCalls;
      await handlers.drain({}, { attemptId: id });
      assert.equal(providerCalls, before);
      for (let retry = 0; retry < 2; retry += 1) {
        assert.equal((await send({ operation: 'retry_attempt', attemptId: id })).status, 202);
        assert.equal((await send({ operation: 'retry_attempt', attemptId: id })).body.alreadyScheduled, true);
        await handlers.drain({}, { attemptId: id });
      }
      await assert.rejects(send({ operation: 'retry_attempt', attemptId: id }), { code: 'BAR_FORECAST_RETRY_LIMIT' });
      snapshot = (await send({ operation: 'attempt', attemptId: id })).body.attempt;
      assert.equal(snapshot.retryAllowed, false);
      malformed = false;
    });

    await t.test('capacity failures persist backoff and do not restart the same batch on every polling or drain request', async () => {
      const id = (await send(submission())).body.attempt.id;
      capacity = true;
      waits.length = 0;
      const before = providerCalls;
      assert.equal((await handlers.drain({}, { attemptId: id })).failed, 1);
      assert.deepEqual(waits, [5000, 20000, 45000]);
      assert.equal(providerCalls - before, 4);
      const saved = (await send({ operation: 'attempt', attemptId: id })).body.attempt;
      assert.equal(saved.status, 'retryable_failed');
      assert.ok(Date.parse(saved.retryAt) > Date.now());
      await handlers.drain({}, { attemptId: id });
      assert.equal(providerCalls - before, 4);
      capacity = false;
      await db.query('update public.dd2026_forecast_batches set retry_at=statement_timestamp() where attempt_id=$1 and batch_index=0', [id]);
      assert.equal((await handlers.drain({}, { attemptId: id, maxBatches: 5 })).completed, 1);
    });

    await t.test('full-history analytics are independent of pagination and exclude pending or failed assessments', async () => {
      await send(submission());
      const page = (await send({ operation: 'history', limit: 1, completeOnly: true })).body;
      assert.equal(page.attempts.length, 1);
      assert.equal(page.analytics.completedAttempts, 3);
      assert.equal(page.analytics.pendingAttempts, 1);
      assert.equal(page.analytics.failedAttempts, 1);
      assert.equal(page.analytics.averagePercentage, 73.3);
      assert.equal(page.analytics.averageGrammarScore, 2.7);
      assert.equal(page.analytics.averageIssueSpottingScore, 3.7);
      assert.equal(page.analytics.bySubject.length, 2);
      assert.equal(page.analytics.trend.length, 3);
      const next = (await send({ operation: 'history', limit: 1, completeOnly: true, before: page.nextCursor })).body;
      assert.deepEqual(next.analytics, page.analytics);
      assert.notEqual(next.attempts[0].id, page.attempts[0].id);
      const filtered = (await send({ operation: 'history', subject: SECOND })).body.analytics;
      assert.equal(filtered.completedAttempts, 1);
      assert.equal(filtered.averagePercentage, 60);
      const future = (await send({ operation: 'history', from: '2099-01-01T00:00:00+08:00' })).body.analytics;
      assert.equal(future.completedAttempts, 0);
      assert.equal(future.averagePercentage, null);
      assert.deepEqual(future.trend, []);
    });

    await t.test('ownership, authentication, strict shapes, and queue quotas fail before any model call', async () => {
      const before = providerCalls;
      await assert.rejects(send({ operation: 'attempt', attemptId: primaryId }, OTHER), { code: 'BAR_FORECAST_ATTEMPT_NOT_FOUND', status: 404 });
      await assert.rejects(send({ operation: 'retry_attempt', attemptId: primaryId }, OTHER), { code: 'BAR_FORECAST_ATTEMPT_NOT_FOUND', status: 404 });
      await assert.rejects(send({ operation: 'attempt', attemptId: primaryId }, 'unauthenticated'), { status: 401 });
      await assert.rejects(send({ operation: 'attempt', attemptId: primaryId, ownerId: OTHER }), { code: 'BAR_FORECAST_REQUEST_SHAPE_INVALID' });
      await assert.rejects(send({ operation: 'history', from: '2026-09-07' }), { code: 'BAR_FORECAST_HISTORY_INVALID' });
      await assert.rejects(send({ operation: 'history', from: '2026-09-07T00:00:00Z', to: '2026-09-06T00:00:00Z' }), { code: 'BAR_FORECAST_HISTORY_INVALID' });
      assert.equal((await send({ operation: 'history' }, OTHER)).body.analytics.completedAttempts, 0);
      await send(submission()); await send(submission());
      await assert.rejects(send(submission()), { code: 'BAR_FORECAST_QUEUE_BUSY', status: 429 });
      assert.equal((await send(payload)).body.attempt.id, primaryId, 'existing replay still works when intake is full');
      await db.exec('begin');
      try {
        // Fixture-only queue saturation; no provider and no customer database.
        await db.query(`insert into public.dd2026_forecast_attempts(owner_id,client_attempt_id,snapshot,payload_hash,subject,set_id)
          select $1,gen_random_uuid(),a.snapshot,a.payload_hash,a.subject,a.set_id
          from public.dd2026_forecast_attempts a cross join generate_series(1,247) where a.id=$2`, [OTHER, primaryId]);
        await assert.rejects(send(submission(), THIRD), { code: 'BAR_FORECAST_QUEUE_BUSY', status: 503 });
      } finally { await db.exec('rollback'); }
      assert.equal(providerCalls, before);
    });
  } finally { await db.close(); }
});

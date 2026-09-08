import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EXAMINATION_FIXTURE_TARGET } from './staging-examination-fixtures.mjs';
import { DEFAULT_MODEL, RUBRIC_VERSION, modelAnswerSectionsForQuestion, resolveQuestionDemand } from '../worker/examiner-core.mjs';
import { runSyllabusCoachingStaging, syllabusStagingConfig, syllabusStagingModelPolicy, SYNTHETIC_ANSWER } from './verify-syllabus-coaching-staging.mjs';

const IDS = { admin: '10000000-0000-4000-8000-000000000001', student: '10000000-0000-4000-8000-000000000002',
  attempt: '10000000-0000-4000-8000-000000000003', question: '10000000-0000-4000-8000-000000000004',
  version: '10000000-0000-4000-8000-000000000005', job: '10000000-0000-4000-8000-000000000006', assessment: '10000000-0000-4000-8000-000000000007' };
const SHA = 'a'.repeat(40);
const RUN = 'mtrra0ty-abcdef12';
const SECRET = `sb_secret_${'s'.repeat(30)}`;
const PUBLISHABLE = `sb_publishable_${'p'.repeat(30)}`;
const CLOCK = Date.parse('2026-09-09T12:00:00.000Z');
const TIME = new Date(CLOCK).toISOString();
const token = id => `owned-inert-session-${id}`;
const env = () => ({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'codingwally/Bar-Exam-simulator', SYLLABUS_RELEASE_SHA: SHA,
  GITHUB_SHA: SHA, GITHUB_RUN_ID: '123456789', GITHUB_RUN_ATTEMPT: '2', STAGING_SUPABASE_URL: EXAMINATION_FIXTURE_TARGET.supabaseUrl,
  STAGING_EXAMINATION_WORKER_URL: EXAMINATION_FIXTURE_TARGET.workerUrl, STAGING_SUPABASE_SERVICE_ROLE_KEY: SECRET,
  STAGING_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE });
const digest = value => createHash('sha256').update(value).digest('hex');
const bytes = value => `${JSON.stringify(value, null, 2)}\n`;
const response = (body, status = 200, headers = {}) => new Response(status === 204 ? null : JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', ...headers } });

function harness(options = {}) {
  const calls = [], artifacts = new Map(), lifecycle = [], passwords = [];
  const users = new Map(), grants = new Map(), acceptedTerms = new Set();
  let role = 'student', submission = null, revealAt = null, answer = null, graded = false;
  let authNumber = 0;
  const prompt = options.prompt || 'May an accused unilaterally demand plea bargaining? Explain.';
  const demand = resolveQuestionDemand({ question: prompt, authority: 'curated-approved-examination-snapshot' });
  const assessment = () => {
    const value = { score: 2.5, maxScore: 5, rationale: 'Controlled synthetic response assessment.', errors: ['The governing rule is incomplete.'],
      improvements: ['Identify the controlling rule.'], rubricVersion: RUBRIC_VERSION,
      rubricBreakdown: { responsiveness: 2, legalBasis: 2, application: 2, conclusion: 2, ...demand },
      modelAnswerALAC: { answer: 'Synthetic direct answer.', legalBasis: 'Synthetic supplied rule.', application: 'Synthetic explanation.', conclusion: 'Synthetic conclusion.' } };
    value.modelAnswerSections = modelAnswerSectionsForQuestion(value, { question: prompt, authority: 'curated-approved-examination-snapshot' });
    return value;
  };
  const latest = () => artifacts.get('artifacts/syllabus-coaching/cleanup-manifest.json');
  const latestFixture = id => lifecycle.at(-1)?.fixtures.find(fixture => fixture.id === id);
  const assertIntent = (operation, details = {}) => {
    const entry = latest().intents.at(-1);
    assert.equal(entry.operation, operation); assert.equal(entry.state, 'requested');
    for (const [key, value] of Object.entries(details)) assert.equal(entry[key], value);
  };
  const checkEmpty = data => {
    const value = JSON.stringify(data);
    for (const secret of [SECRET, PUBLISHABLE, token(IDS.admin), token(IDS.student), ...passwords]) assert.equal(value.includes(secret), false);
    assert.doesNotMatch(value, /@example\.com|access_token|refresh_token|apikey|authorization|"password"/iu);
  };
  const dependencies = {
    now: () => CLOCK, runId: RUN,
    persist: async (name, value) => { checkEmpty(value); artifacts.set(name, structuredClone(value)); },
    lifecyclePersist: async value => { checkEmpty(value); lifecycle.push(structuredClone(value)); },
    lifecycleBytes: async () => options.missingLifecycle ? null : bytes(lifecycle.at(-1)),
    request: async (url, init) => {
      const parsed = new URL(url), route = parsed.pathname, method = init.method || 'GET';
      const payload = init.body ? JSON.parse(init.body) : null;
      assert.equal(init.redirect, 'error'); assert.ok(init.signal instanceof AbortSignal);
      assert.ok([EXAMINATION_FIXTURE_TARGET.supabaseUrl, EXAMINATION_FIXTURE_TARGET.workerUrl].includes(parsed.origin));
      calls.push({ route, method, operation: payload?.operation || null, userId: payload?.userId || null });
      if (route === '/rest/v1/rpc/astra_register_staging_examination_fixture') {
        assert.equal(parsed.origin, EXAMINATION_FIXTURE_TARGET.supabaseUrl);
        if (payload.p_user_id === null) return options.badPreflight ? response({ error: 'unavailable' }, 404)
          : response({ code: 'P0001', message: 'Staging examination fixture identity is invalid' }, 400);
        const record = latestFixture(payload.p_user_id);
        assert.equal(record.registrationState, 'requested'); assert.equal(payload.p_suite, 'examinations-api');
        assert.equal(payload.p_run_id, RUN); assert.ok(['admin', 'student-a'].includes(payload.p_label));
        if (options.badRegistration) return response({ registered: false });
        return response({ registered: true, fixtureUserId: payload.p_user_id, dataScope: 'internal_test',
          registrationVersion: 'astra-staging-examination-v1', replayed: false });
      }
      if (route === '/auth/v1/admin/users') {
        const label = authNumber++ === 0 ? 'admin' : 'student-a';
        assert.equal(lifecycle.at(-1).fixtures.at(-1).creationState, 'requested');
        assert.equal(payload.email, `dd-exam-${label}-${RUN}@example.com`);
        assert.deepEqual(payload.app_metadata, { astra_staging_examination_fixture: { version: 1, suite: 'examinations-api', runId: RUN, label } });
        assert.equal(payload.user_metadata.full_name, `Synthetic ${label}`);
        passwords.push(payload.password);
        const id = label === 'admin' ? IDS.admin : IDS.student;
        users.set(id, { id, email: payload.email, app_metadata: { ...payload.app_metadata, provider: 'email', providers: ['email'] },
          user_metadata: payload.user_metadata, last_sign_in_at: null });
        if (options.uncertainCreate) throw Error(`${SECRET} ${payload.password}`);
        return response({ id }, 201);
      }
      if (route === '/auth/v1/token') {
        assert.equal(parsed.searchParams.get('grant_type'), 'password');
        const user = [...users.values()].find(value => value.email === payload.email);
        assert.equal(latestFixture(user.id).registrationState, 'confirmed');
        assert.equal(latestFixture(user.id).signInState, 'requested');
        user.last_sign_in_at = TIME;
        if (options.uncertainSignIn) throw Error(`${SECRET} ${token(user.id)}`);
        return response({ user: { id: user.id }, access_token: token(user.id), refresh_token: 'never-persist-this-refresh-token' });
      }
      if (route.startsWith('/auth/v1/admin/users/')) {
        const id = route.split('/').at(-1), user = users.get(id);
        assert.ok([IDS.admin, IDS.student].includes(id));
        if (method === 'DELETE') {
          assert.equal(latestFixture(id).auditCaptureState, 'captured-before-auth-delete');
          assert.equal(latestFixture(id).cleanupState, 'delete_requested');
          if (latestFixture(id).signInState !== 'not_requested') assert.equal(latestFixture(id).signOutState, 'confirmed');
          assert.equal(grants.size, 0, 'Access grants must be removed before Auth deletion');
          if (!options.authDeleteUnconfirmed) users.delete(id);
          return response(null, 204);
        }
        return user ? response(options.wrongCleanupIdentity ? { ...user, email: 'unowned@example.invalid' } : user) : response({ code: 'user_not_found' }, 404);
      }
      if (route === '/auth/v1/logout') {
        assert.equal(method, 'POST'); assert.equal(parsed.search, '?scope=global');
        assert.ok([`Bearer ${token(IDS.admin)}`, `Bearer ${token(IDS.student)}`].includes(init.headers.Authorization));
        return response(null, options.logoutFailure ? 401 : 204);
      }
      if (route === '/rest/v1/examination_audit_log') {
        assert.equal(method, 'GET'); assert.equal(parsed.searchParams.get('select'), 'id'); assert.equal(parsed.searchParams.get('limit'), '501');
        assert.ok([`eq.${IDS.admin}`, `eq.${IDS.student}`].includes(parsed.searchParams.get('actor_user_id')));
        return response([{ id: 41 }], 200, options.incompleteAudit ? {} : { 'content-range': '0-0/1' });
      }
      if (route === '/rest/v1/platform_access_settings') return response([{ current_terms_version: 'terms-version-20260909', current_privacy_version: 'privacy-version-20260909' }]);
      if (route === '/rest/v1/rpc/accept_terms') {
        const id = init.headers.Authorization === `Bearer ${token(IDS.admin)}` ? IDS.admin : IDS.student;
        assert.equal(latestFixture(id).signInState, 'confirmed');
        assert.equal(payload.p_terms_version, 'terms-version-20260909'); assert.equal(payload.p_privacy_version, 'privacy-version-20260909');
        acceptedTerms.add(id); return response(null, 204);
      }
      if (route === '/rest/v1/rpc/complete_commercial_profile_onboarding_v2') {
        const id = init.headers.Authorization === `Bearer ${token(IDS.admin)}` ? IDS.admin : IDS.student;
        assert.equal(latestFixture(id).signInState, 'confirmed');
        assert.equal(acceptedTerms.has(id), true, 'Current terms must be accepted before profile onboarding');
        assert.equal(payload.p_trial_acknowledged, true); return response({ ok: true });
      }
      if (route === '/rest/v1/user_roles') {
        assert.equal(parsed.searchParams.get('user_id'), `eq.${IDS.admin}`);
        if (method === 'PATCH') {
          assert.equal(latestFixture(IDS.admin).promotionIntent, 'super_admin');
          assert.equal(latestFixture(IDS.admin).registrationState, 'confirmed');
          assert.equal(payload.assigned_by, IDS.admin); role = payload.role; return response(null, 204);
        }
        return response([{ role }]);
      }
      if (route === '/rest/v1/free_beta_access' || route === '/rest/v1/examination_beta_access') {
        const table = route.split('/').at(-1);
        if (method === 'POST') {
          assert.equal(table, 'free_beta_access'); assert.equal(parsed.search, '', 'Never upsert a fixture grant');
          assertIntent('grant-owned-founding-beta', { userId: IDS.student, actorUserId: IDS.admin });
          assert.equal(latest().grants.at(-1).state, 'requested');
          assert.equal(payload.user_id, IDS.student); assert.equal(payload.created_by, IDS.admin); assert.equal(payload.updated_by, IDS.admin);
          assert.equal(payload.access_program, 'founding_beta_2026'); assert.ok(Date.parse(payload.expires_at) - CLOCK <= 3_600_000);
          grants.set(table, structuredClone(payload));
          if (options.uncertainGrant) throw Error(SECRET);
          return response([{ ...payload, ...(options.wrongGrantOwner ? { created_by: IDS.student } : {}) }], 201);
        }
        assert.equal(parsed.searchParams.get('user_id'), `eq.${IDS.student}`);
        if (method === 'DELETE') {
          const grant = grants.get(table); assert.ok(grant);
          assert.equal(parsed.searchParams.get('expires_at'), `eq.${grant.expires_at}`);
          assert.equal(parsed.searchParams.get('reason'), `eq.${grant.reason}`);
          assert.equal(parsed.searchParams.get('enabled'), 'eq.true');
          if (table === 'free_beta_access') {
            assert.equal(parsed.searchParams.get('created_by'), `eq.${IDS.admin}`); assert.equal(parsed.searchParams.get('updated_by'), `eq.${IDS.admin}`);
            assert.equal(parsed.searchParams.get('access_program'), 'eq.founding_beta_2026');
          } else assert.equal(parsed.searchParams.get('granted_by'), `eq.${IDS.admin}`);
          assert.equal(latest().grants.find(item => item.table === table).cleanupState, 'delete_requested');
          if (!options.uncertainGrantDelete) grants.delete(table);
          if (options.uncertainGrantDelete) throw Error(SECRET);
          return response(null, 204);
        }
        if (options.existingGrant && latest().grants.length === 0) return response([{ user_id: IDS.student }]);
        const row = grants.get(table); return response(row ? [row] : []);
      }
      if (route === '/access') {
        const admin = init.headers.Authorization === `Bearer ${token(IDS.admin)}`;
        return response({ ok: true, access: { tokenDisclosureVersion: 'token-disclosure-20260909', allowed: true, unlimited: !admin && grants.size === 2,
          basis: options.wrongAccess ? 'provisional_payment' : !admin && grants.size === 2 ? 'founding_beta' : 'introductory' } });
      }
      if (route === '/admin/examinations') {
        assert.equal(payload.operation, 'set_beta_access'); assert.equal(payload.userId, IDS.student);
        assert.equal(init.headers.Authorization, `Bearer ${token(IDS.admin)}`); assert.equal(role, 'super_admin');
        assertIntent('set_beta_access', { userId: IDS.student, requestKey: payload.requestKey });
        grants.set('examination_beta_access', { user_id: IDS.student, granted_by: IDS.admin, enabled: payload.enabled, expires_at: payload.expiresAt, reason: payload.reason });
        return response({ ok: true, data: { enabled: true } });
      }
      if (route === '/rest/v1/examination_ai_assessments') {
        assert.equal(method, 'GET'); assert.equal(parsed.searchParams.get('attempt_id'), `eq.${IDS.attempt}`);
        assert.equal(parsed.searchParams.get('question_id'), `eq.${IDS.question}`); assert.equal(parsed.searchParams.get('select'), 'id,grader_model,score');
        return response([{ id: IDS.assessment, grader_model: options.wrongModel ? 'unknown-model' : options.model || 'gemini-3.5-flash-lite', score: 2.5 }]);
      }
      if (route === '/examinations/query' || route === '/examinations/command') {
        assert.equal(init.headers.Authorization, `Bearer ${token(IDS.student)}`);
        const operation = payload.operation;
        let data;
        if (operation === 'subject_catalog') data = { items: [{ subject: 'Criminal Law I', yearLevel: 1, term: 1 }] };
        else if (operation === 'subject_next') { assertIntent(operation); data = { setup: { versionId: IDS.version, allowedTimerModes: ['strict', 'selfPaced', 'none'] } }; }
        else if (operation === 'setup') data = { versionId: IDS.version, questionCount: options.multipleItems ? 2 : 1 };
        else if (operation === 'start_attempt') {
          assertIntent(operation, { versionId: IDS.version, requestKey: payload.requestKey });
          data = { examination: { track: 'per_subject' }, attempt: { attemptId: IDS.attempt, assisted: false, reviewMaterialRevealedAt: null },
            questions: [{ questionId: IDS.question, prompt }] };
        } else if (operation === 'save_response') {
          assertIntent(operation, { attemptId: IDS.attempt, questionId: IDS.question });
          assert.equal(payload.expectedRevision, 0); answer = payload.answerText; data = { revision: 1 };
        } else if (operation === 'submit_attempt') {
          assertIntent(operation, { attemptId: IDS.attempt, requestKey: payload.requestKey });
          assert.equal(answer, SYNTHETIC_ANSWER); assert.equal(payload.confirmed, true); submission = TIME;
          if (options.uncertainSubmit) throw Error(`${SECRET} ${token(IDS.student)}`);
          data = { status: 'submitted', submittedAt: submission };
        } else if (operation === 'request_ai_grading') {
          assertIntent(operation, { attemptId: IDS.attempt, requestKey: payload.requestKey }); assert.ok(submission);
          assert.equal(graded, false, 'Grading must never be repeated'); graded = true;
          if (options.uncertainGrading) throw Error(`${SECRET} ${token(IDS.student)}`);
          if (options.httpFailure) return response({ error: { code: options.maliciousErrorCode ? SECRET : 'MALFORMED_MODEL_RESPONSE', message: `${SECRET} ${token(IDS.student)}` } }, 503);
          data = { jobId: IDS.job, attemptId: IDS.attempt, status: options.partialGrading ? 'pending' : 'completed', questionCount: 1, completedQuestions: 1 };
        } else if (operation === 'verdict') {
          assert.equal(payload.attemptId, IDS.attempt); assert.ok(graded);
          const ai = assessment();
          if (!revealAt && !options.leakedReview) { delete ai.modelAnswerALAC; delete ai.modelAnswerSections; }
          if (options.wrongType) ai.rubricBreakdown.questionType = demand.questionType === 'problem' ? 'explanation' : 'problem';
          if (revealAt && options.wrongSections) ai.modelAnswerSections.applicationRequired = !demand.applicationRequired;
          else if (revealAt) ai.modelAnswerSections = { sections: ai.modelAnswerSections.sections.map(({ text, label }) => ({ text, label })),
            applicationRequired: ai.modelAnswerSections.applicationRequired, questionType: ai.modelAnswerSections.questionType };
          data = { attempt: { attemptId: IDS.attempt, assisted: false, assistanceKnown: true, submittedAt: submission, reviewMaterialRevealedAt: revealAt },
            released: Boolean(revealAt), results: [{ questionId: IDS.question, prompt, answerText: answer,
              aiScore: options.outOfBoundsGrade ? 9 : 2.5, aiAssessment: ai, modelAnswer: revealAt ? 'Synthetic curated answer.' : null,
              legalBasis: revealAt ? 'Synthetic rule.' : null, sources: [] }] };
        } else if (operation === 'subject_reveal_review') {
          assertIntent(operation, { attemptId: IDS.attempt });
          assert.equal(artifacts.get('artifacts/syllabus-coaching/summary.json').coachingBeforeReveal, true, 'Must observe coaching before explicit Reveal');
          assert.equal(revealAt, null, 'Never repeat Reveal'); revealAt = TIME;
          data = { attemptId: IDS.attempt, questionId: IDS.question, status: 'available', assisted: options.assistedReveal || false,
            assistanceKnown: true, classification: options.assistedReveal ? 'assisted' : 'unassisted', reviewMaterialRevealedAt: revealAt };
        } else throw Error(`Unexpected mock syllabus operation ${operation}`);
        return response({ ok: true, data }, operation === 'start_attempt' ? 201 : 200);
      }
      throw Error(`Unexpected inert transport ${method} ${route}`);
    },
  };
  return { calls, artifacts, lifecycle, users, grants, dependencies, run: () => runSyllabusCoachingStaging(syllabusStagingConfig(env(), SHA), dependencies) };
}

test('target and source/run provenance fail before any hosted action', () => {
  for (const delta of [{ GITHUB_ACTIONS: 'false' }, { GITHUB_REPOSITORY: 'other/repo' }, { GITHUB_SHA: 'b'.repeat(40) },
    { SYLLABUS_RELEASE_SHA: 'HEAD' }, { GITHUB_RUN_ID: '' }, { GITHUB_RUN_ATTEMPT: '0' },
    { STAGING_SUPABASE_URL: 'https://production.supabase.co' }, { STAGING_EXAMINATION_WORKER_URL: 'https://production.workers.dev' },
    { STAGING_SUPABASE_SERVICE_ROLE_KEY: 'wrong' }, { STAGING_SUPABASE_PUBLISHABLE_KEY: 'wrong' }]) {
    assert.throws(() => syllabusStagingConfig({ ...env(), ...delta }, SHA));
  }
  assert.throws(() => syllabusStagingConfig(env(), 'b'.repeat(40)));
});

for (const prompt of ['May an accused unilaterally demand plea bargaining? Explain.',
  'The accused submitted a proposal. The prosecutor refused it but the judge approved it despite that refusal. Was the approval proper?']) {
  test(`one real-flow mock retains demand and unassisted coaching/reveal: ${prompt.slice(0, 45)}`, async () => {
    const h = harness({ prompt }); const { summary, cleanupManifest } = await h.run();
    assert.equal(summary.passed, true, `Unexpected failure: ${summary.failureStage} ${cleanupManifest.cleanupFailures}`);
    assert.equal(summary.legalScoreAccuracyVerified, false); assert.equal(summary.boundedItems, 1);
    assert.equal(summary.coachingBeforeReveal, true); assert.equal(summary.explicitReveal, true);
    assert.equal(summary.assistedBeforeReveal, false); assert.equal(summary.assistedAfterReveal, false);
    assert.equal(summary.result.applicationRequired, resolveQuestionDemand({ question: prompt }).applicationRequired);
    assert.equal(summary.result.model, 'gemini-3.5-flash-lite');
    assert.equal(summary.gradingModelPolicy.configuredModel, 'gemini-3.5-flash-lite');
    assert.ok(summary.gradingModelPolicy.allowedModels.includes(DEFAULT_MODEL));
    assert.equal(summary.cleanup.supportedApiComplete, true); assert.equal(summary.cleanup.independentDatabaseReadbackRequired, true);
    assert.equal(cleanupManifest.databaseReadback.status, 'required-separate-root-readback');
    assert.equal(summary.cleanupManifestSha256, digest(bytes(cleanupManifest)));
    assert.equal(summary.cleanup.lifecycleManifestSha256, digest(bytes(h.lifecycle.at(-1))));
    assert.equal(cleanupManifest.lifecycleManifestPath, `artifacts/staging-e2e/examinations-api-${RUN}-cleanup-manifest.json`);
    assert.equal(h.lifecycle.at(-1).sourceSha, SHA); assert.equal(h.lifecycle.at(-1).cleanupComplete, true);
    assert.deepEqual(cleanupManifest.fixtures.map(item => item.label), ['admin', 'student-a']);
    assert.equal(cleanupManifest.attempts[0].attemptId, IDS.attempt); assert.equal(cleanupManifest.attempts[0].gradingJobId, IDS.job);
    assert.equal(cleanupManifest.attempts[0].assessmentId, IDS.assessment); assert.equal(cleanupManifest.attempts[0].promptSha256, digest(prompt));
    assert.equal(h.users.size, 0); assert.equal(h.grants.size, 0);
    assert.deepEqual(h.calls.filter(call => call.operation).map(call => call.operation), [
      'set_beta_access', 'subject_catalog', 'subject_next', 'setup', 'start_attempt', 'save_response', 'submit_attempt', 'request_ai_grading', 'verdict', 'subject_reveal_review', 'verdict']);
    assert.deepEqual(h.calls.filter(call => call.method === 'DELETE' && call.route.startsWith('/auth/')).map(call => call.route),
      [`/auth/v1/admin/users/${IDS.student}`, `/auth/v1/admin/users/${IDS.admin}`]);
  });
}

test('existing staging Gemini configuration and fallback are verified without a provider change', async () => {
  const source = await readFile(new URL('../worker/wrangler.staging.toml', import.meta.url), 'utf8');
  const policy = syllabusStagingModelPolicy(source);
  assert.equal(policy.configuredModel, 'gemini-3.5-flash-lite'); assert.equal(policy.sourceSha256, digest(source));
  const h = harness({ model: DEFAULT_MODEL }); const { summary } = await h.run();
  assert.equal(summary.passed, true); assert.equal(summary.result.model, DEFAULT_MODEL);
  assert.throws(() => syllabusStagingModelPolicy(source.replace('gemini-3.5-flash-lite', 'gemini-unreviewed')));
  assert.throws(() => syllabusStagingModelPolicy(source.replace('GEMINI_MODEL =', 'REMOVED_MODEL =')));
});

test('failure diagnostics retain only numeric HTTP status and explicitly allowed codes', async () => {
  for (const maliciousErrorCode of [false, true]) {
    const h = harness({ httpFailure: true, maliciousErrorCode }); const { summary } = await h.run();
    assert.equal(summary.passed, false); assert.equal(summary.failureStage, 'request_ai_grading');
    assert.deepEqual(summary.failureDiagnostic, { kind: 'http', httpStatus: 503,
      code: maliciousErrorCode ? 'REMOTE_ERROR' : 'MALFORMED_MODEL_RESPONSE' });
  }
});

for (const [scenario, expectedStage] of [
  ['badPreflight', 'fixture-preflight'], ['badRegistration', 'create-admin'], ['uncertainCreate', 'create-admin'], ['uncertainSignIn', 'create-admin'],
  ['existingGrant', 'promote-owned-admin'], ['uncertainGrant', 'grant-owned-founding-beta'], ['wrongGrantOwner', 'grant-owned-founding-beta'],
  ['wrongAccess', 'set_beta_access'], ['multipleItems', 'subject_next'], ['uncertainSubmit', 'submit_attempt'],
  ['uncertainGrading', 'request_ai_grading'], ['partialGrading', 'request_ai_grading'], ['outOfBoundsGrade', 'coaching-before-reveal'],
  ['wrongType', 'coaching-before-reveal'], ['leakedReview', 'coaching-before-reveal'], ['wrongModel', 'coaching-before-reveal'],
  ['assistedReveal', 'subject_reveal_review'], ['wrongSections', 'adaptive-sections-after-reveal'],
]) {
  test(`${scenario} fails closed, retains evidence and never repeats uncertain writes`, async () => {
    const h = harness({ [scenario]: true }); const { summary, cleanupManifest } = await h.run();
    assert.equal(summary.passed, false); assert.equal(summary.failureStage, expectedStage);
    assert.ok(h.artifacts.has('artifacts/syllabus-coaching/summary.json')); assert.ok(h.lifecycle.length);
    assert.equal(summary.cleanupManifestSha256, digest(bytes(cleanupManifest)));
    for (const operation of ['start_attempt', 'submit_attempt', 'request_ai_grading', 'subject_reveal_review']) {
      assert.ok(h.calls.filter(call => call.operation === operation).length <= 1);
    }
    assert.ok(h.calls.filter(call => call.route === '/auth/v1/admin/users').length <= 2);
    if (['uncertainCreate', 'uncertainSignIn', 'uncertainGrant', 'wrongGrantOwner'].includes(scenario)) {
      assert.equal(summary.cleanup.supportedApiComplete, false);
    }
    if (['outOfBoundsGrade', 'wrongType', 'leakedReview', 'wrongModel', 'partialGrading'].includes(scenario)) {
      assert.equal(h.calls.some(call => call.operation === 'subject_reveal_review'), false);
    }
  });
}

for (const scenario of ['wrongCleanupIdentity', 'logoutFailure', 'incompleteAudit', 'authDeleteUnconfirmed', 'uncertainGrantDelete', 'missingLifecycle']) {
  test(`cleanup ${scenario} cannot produce passing release evidence`, async () => {
    const h = harness({ [scenario]: true }); const { summary, cleanupManifest } = await h.run();
    assert.equal(summary.passed, false); assert.equal(summary.cleanup.supportedApiComplete, false);
    assert.ok(cleanupManifest.cleanupFailures.length);
    if (['wrongCleanupIdentity', 'logoutFailure', 'incompleteAudit', 'uncertainGrantDelete'].includes(scenario)) {
      assert.equal(h.calls.some(call => call.method === 'DELETE' && call.route.startsWith('/auth/')), false);
    }
    assert.equal(h.calls.some(call => call.method === 'DELETE' && call.route.includes('audit')), false);
  });
}

test('CLI requires explicit execute flag; import has no hosted side effects', async () => {
  const filename = fileURLToPath(new URL('./verify-syllabus-coaching-staging.mjs', import.meta.url));
  const child = spawnSync(process.execPath, [filename], { encoding: 'utf8', env: { ...process.env,
    STAGING_SUPABASE_SERVICE_ROLE_KEY: 'must-not-be-printed' } });
  assert.equal(child.status, 1); assert.doesNotMatch(child.stdout + child.stderr, /must-not-be-printed/);
  assert.match(child.stderr, /preflight or artifact failure/);
  const source = await readFile(filename, 'utf8');
  assert.doesNotMatch(source, /create_exam|create_version|set_questions|publish_version|subject_skip_question|resolution=merge-duplicates/u);
  assert.doesNotMatch(source, /\/auth\/v1\/(?:signup|invite)|examination-room-v1|examination_definitions\?/u);
  assert.match(source, /createExaminationFixtureLifecycle/);
  assert.match(source, /independentDatabaseReadbackRequired: true/);
  assert.match(source, /'wx'/);
});

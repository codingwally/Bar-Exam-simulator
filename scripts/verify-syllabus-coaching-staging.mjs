import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createExaminationFixtureLifecycle, EXAMINATION_FIXTURE_TARGET } from './staging-examination-fixtures.mjs';
import { DEFAULT_MODEL, MODEL_FALLBACKS, RUBRIC_VERSION, modelAnswerSectionsForQuestion, resolveQuestionDemand, withSyllabusGradingPolicy } from '../worker/examiner-core.mjs';

// Importing this file is inert. Only the explicit CLI flag enables hosted work.
// The one-item synthetic answer proves transport/presentation, not legal accuracy.
export const SYLLABUS_STAGING_PURPOSE = 'syllabus-coaching-staging';
export const SYNTHETIC_ANSWER = 'This is a controlled synthetic staging response. The governing legal rule must be identified and its requirements explained. The requested conclusion must follow from that rule and any material facts stated in the question. This response is used only to verify the assessment flow and makes no claim of legal correctness.';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA = /^[a-f0-9]{40}$/u;
const SAFE_REMOTE_CODES = new Set(['P0001', 'PGRST202', '42501', 'MALFORMED_MODEL_RESPONSE',
  'EXAMINER_NOT_CONFIGURED', 'EXAMINER_UNAVAILABLE', 'EXAM_ATTEMPT_NOT_FOUND', 'EXAM_ACCESS_REQUIRED',
  'EXAM_BETA_ACCESS_REQUIRED', 'EXAM_NOT_AVAILABLE', 'EXAM_VERSION_NOT_FOUND', 'EXAM_SECOND_TAB_BLOCKED',
  'EXAM_RESPONSE_CONFLICT', 'EXAM_SUBMISSION_CONFLICT', 'EXAM_GRADING_JOB_NOT_FOUND', 'EXAM_GRADING_JOB_CLOSED',
  'EXAM_SUBJECT_REVIEW_MATERIAL_UNAVAILABLE', 'SYLLABUS_REVIEW_SUBSCRIPTION_REQUIRED', 'SYLLABUS_REVIEW_RELEASE_INTEGRITY']);
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const uuid = value => { assert.equal(typeof value, 'string'); assert.ok(UUID.test(value), 'Invalid fixture resource identity'); return value; };
const iso = value => { assert.equal(typeof value, 'string'); assert.ok(Number.isFinite(Date.parse(value)), 'Invalid fixture timestamp'); return new Date(value).toISOString(); };
const diagnostic = error => error?.syllabusDiagnostic || { kind: error?.code === 'ERR_ASSERTION' ? 'assertion' : 'local-or-lifecycle',
  httpStatus: null, code: error?.code === 'ERR_ASSERTION' ? 'ASSERTION_FAILED' : 'OPERATION_UNCONFIRMED' };

export function syllabusStagingConfig(env, head) {
  assert.equal(env.GITHUB_ACTIONS, 'true', 'Use the dedicated staging workflow');
  assert.equal(env.GITHUB_REPOSITORY, 'codingwally/Bar-Exam-simulator', 'Unexpected repository');
  for (const value of [env.SYLLABUS_RELEASE_SHA, env.GITHUB_SHA, head]) assert.ok(typeof value === 'string' && SHA.test(value), 'Exact source SHA required');
  assert.equal(env.SYLLABUS_RELEASE_SHA === env.GITHUB_SHA && env.GITHUB_SHA === head, true, 'Source provenance mismatch');
  for (const value of [env.GITHUB_RUN_ID, env.GITHUB_RUN_ATTEMPT]) assert.ok(typeof value === 'string' && /^[1-9][0-9]{0,19}$/u.test(value), 'GitHub run provenance required');
  assert.equal(env.STAGING_SUPABASE_URL, EXAMINATION_FIXTURE_TARGET.supabaseUrl, 'Wrong staging project');
  assert.equal(env.STAGING_EXAMINATION_WORKER_URL, EXAMINATION_FIXTURE_TARGET.workerUrl, 'Wrong staging Worker');
  assert.ok(/^sb_secret_[A-Za-z0-9_-]{20,}$/u.test(env.STAGING_SUPABASE_SERVICE_ROLE_KEY || ''), 'Dedicated staging secret required');
  assert.ok(/^sb_publishable_[A-Za-z0-9_-]{20,}$/u.test(env.STAGING_SUPABASE_PUBLISHABLE_KEY || ''), 'Dedicated staging publishable key required');
  return Object.freeze({ releaseSha: head, githubRunId: env.GITHUB_RUN_ID, githubRunAttempt: env.GITHUB_RUN_ATTEMPT,
    repository: env.GITHUB_REPOSITORY, supabaseUrl: env.STAGING_SUPABASE_URL, workerUrl: env.STAGING_EXAMINATION_WORKER_URL,
    serviceRoleKey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY, publishableKey: env.STAGING_SUPABASE_PUBLISHABLE_KEY });
}

export function syllabusStagingModelPolicy(source) {
  // Match the reviewed Worker callGemini -> orderedModels policy, without changing it.
  const vars = /^\[vars\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/mu.exec(source)?.[1];
  assert.ok(vars, 'Staging model configuration missing');
  const matches = [...vars.matchAll(/^GEMINI_MODEL\s*=\s*"(gemini-[A-Za-z0-9.-]+)"\s*$/gmu)];
  assert.equal(matches.length, 1, 'Staging Gemini model must be explicit and unique');
  const configuredModel = matches[0][1];
  assert.ok(MODEL_FALLBACKS.includes(configuredModel), 'Configured staging model requires review');
  return { configuredModel, allowedModels: [...new Set([configuredModel || DEFAULT_MODEL, ...MODEL_FALLBACKS])],
    sourcePath: 'worker/wrangler.staging.toml', sourceSha256: hash(source) };
}

function assertNoProtectedReview(result) {
  for (const key of ['modelAnswer', 'legalBasis', 'application', 'conclusion', 'suggestedAnswer']) assert.ok(result[key] == null || result[key] === '', 'Protected review appeared before explicit Reveal');
  assert.ok(!result.sources || (Array.isArray(result.sources) && result.sources.length === 0), 'Protected sources appeared before explicit Reveal');
  for (const key of ['modelAnswerSections', 'modelAnswerALAC', 'modelAnswer', 'suggestedAnswer', 'legalReview', 'whyThisAnswerIsCorrect']) assert.ok(result.aiAssessment?.[key] == null, 'Protected assessment appeared before explicit Reveal');
}

export function validateSyllabusCoaching(verdict, { attemptId, questionId, prompt, answerText, revealed = false }) {
  assert.equal(verdict?.attempt?.attemptId, attemptId, 'Wrong verdict owner resource');
  assert.equal(verdict.attempt.assisted, false, 'Submission classification changed');
  assert.equal(verdict.attempt.assistanceKnown, true, 'Submission classification unknown');
  assert.ok(verdict.attempt.submittedAt, 'No submitted receipt');
  assert.equal(verdict.results?.length, 1, 'Expected exactly one syllabus result');
  const result = verdict.results[0];
  assert.equal(result.questionId === questionId && result.prompt === prompt && result.answerText === answerText, true, 'Question or saved response changed');
  assert.ok(Number.isFinite(result.aiScore) && result.aiScore >= 0 && result.aiScore <= 5, 'Grade outside 0..5');
  assert.ok(Math.abs(result.aiScore * 10 - Math.round(result.aiScore * 10)) < 1e-9, 'Grade precision changed');
  const assessment = result.aiAssessment;
  assert.ok(assessment && typeof assessment.rationale === 'string' && assessment.rationale.trim(), 'Coaching is missing');
  for (const key of ['errors', 'improvements']) assert.ok(Array.isArray(assessment[key]), 'Coaching lists missing');
  // This harness starts an owned per_subject attempt through the real API; no
  // returned question field or client-supplied track selects the expected policy.
  const context = withSyllabusGradingPolicy({ question: prompt, authority: 'curated-approved-examination-snapshot' }, 'per_subject');
  const demand = resolveQuestionDemand(context);
  assert.equal(assessment.rubricBreakdown?.questionType, demand.questionType, 'Question type differs from exact prompt');
  assert.equal(assessment.rubricBreakdown?.applicationRequired, demand.applicationRequired, 'Application demand differs from exact prompt');
  assert.equal(assessment.rubricVersion, RUBRIC_VERSION, 'Unexpected rubric version');
  if (!revealed) {
    assert.equal(verdict.released, false, 'Review automatically released');
    assert.equal(verdict.attempt.reviewMaterialRevealedAt, null, 'Review was opened before coaching');
    assertNoProtectedReview(result);
  } else {
    assert.equal(verdict.released, true, 'Explicit release missing');
    iso(verdict.attempt.reviewMaterialRevealedAt);
    const expected = modelAnswerSectionsForQuestion(assessment, context);
    assert.equal(isDeepStrictEqual(assessment.modelAnswerSections, expected), true, 'Adaptive model sections do not match exact question demand');
    assert.equal(expected.sections.length, 4, 'Incomplete adaptive model sections');
  }
  return { score: result.aiScore, questionType: demand.questionType, applicationRequired: demand.applicationRequired, rubricVersion: RUBRIC_VERSION };
}

function artifactWriter() {
  const initialized = new Set();
  return async (relative, value) => {
    assert.ok(relative === 'artifacts/syllabus-coaching/summary.json' || relative === 'artifacts/syllabus-coaching/cleanup-manifest.json');
    const filename = path.join(ROOT, relative);
    await mkdir(path.dirname(filename), { recursive: true });
    if (!initialized.has(relative)) {
      await writeFile(filename, json(value), { flag: 'wx', mode: 0o600 }); initialized.add(relative);
    } else {
      await writeFile(`${filename}.tmp`, json(value), { flag: 'wx', mode: 0o600 });
      await rename(`${filename}.tmp`, filename);
    }
  };
}

export async function runSyllabusCoachingStaging(config, dependencies = {}) {
  // Revalidate even for callers importing this function; only mocks are injected by tests.
  syllabusStagingConfig({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: config.repository,
    SYLLABUS_RELEASE_SHA: config.releaseSha, GITHUB_SHA: config.releaseSha, GITHUB_RUN_ID: config.githubRunId,
    GITHUB_RUN_ATTEMPT: config.githubRunAttempt, STAGING_SUPABASE_URL: config.supabaseUrl,
    STAGING_EXAMINATION_WORKER_URL: config.workerUrl, STAGING_SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
    STAGING_SUPABASE_PUBLISHABLE_KEY: config.publishableKey }, config.releaseSha);
  const request = dependencies.request || fetch;
  const persist = dependencies.persist || artifactWriter();
  const modelPolicy = syllabusStagingModelPolicy(await readFile(path.join(ROOT, 'worker/wrangler.staging.toml'), 'utf8'));
  const now = dependencies.now || Date.now;
  const runId = dependencies.runId || `${now().toString(36)}-${randomBytes(4).toString('hex')}`;
  const provenance = { schemaVersion: 1, purpose: SYLLABUS_STAGING_PURPOSE, releaseSha: config.releaseSha,
    githubRunId: config.githubRunId, githubRunAttempt: config.githubRunAttempt, repository: config.repository,
    runId, projectRef: EXAMINATION_FIXTURE_TARGET.projectRef, workerUrl: config.workerUrl };
  const lifecycle = createExaminationFixtureLifecycle({ suite: 'examinations-api', runId,
    supabaseUrl: config.supabaseUrl, workerUrl: config.workerUrl, serviceRoleKey: config.serviceRoleKey,
    publishableKey: config.publishableKey, sourceSha: config.releaseSha, request, persist: dependencies.lifecyclePersist || null });
  const lifecyclePath = `artifacts/staging-e2e/examinations-api-${runId}-cleanup-manifest.json`;
  const manifest = { ...provenance, supportedApiComplete: false, independentDatabaseReadbackRequired: true,
    lifecycleManifestPath: lifecyclePath, lifecycleManifestSha256: null, fixtures: [], intents: [], grants: [], attempts: [],
    databaseReadback: { status: 'required-separate-root-readback', scope: 'exact-fixture-users-and-recorded-resources-including-auth-sessions',
      retainedAuditPolicy: 'retain-internal-test-examination-and-pulse-events' }, cleanupFailures: [] };
  const summary = { ...provenance, passed: false, boundedItems: 1, answerBasis: 'controlled-synthetic-flow-only', legalScoreAccuracyVerified: false,
    coachingBeforeReveal: false, explicitReveal: false, assistedBeforeReveal: null, assistedAfterReveal: null,
    result: null, gradingModelPolicy: modelPolicy, failureStage: null, failureDiagnostic: null, cleanupManifestSha256: null,
    cleanup: { supportedApiComplete: false, independentDatabaseReadbackRequired: true,
      lifecycleManifestPath: lifecyclePath, lifecycleManifestSha256: null } };
  const saveManifest = () => persist('artifacts/syllabus-coaching/cleanup-manifest.json', manifest);
  let stage = 'initialization'; let flowPassed = false;
  const users = new Map();
  const makeKey = prefix => `${prefix}_${randomUUID().replaceAll('-', '')}`;
  async function intent(operation, details = {}) {
    stage = operation;
    const entry = { ordinal: manifest.intents.length + 1, operation, ...details, state: 'requested' };
    manifest.intents.push(entry); await saveManifest(); return entry;
  }
  async function confirm(entry) { entry.state = 'confirmed'; await saveManifest(); }
  async function transport(origin, route, options = {}, expected = [200]) {
    assert.ok(origin === config.supabaseUrl || origin === config.workerUrl, 'Unapproved transport target');
    let response;
    try { response = await request(`${origin}${route}`, { ...options, redirect: 'error', signal: AbortSignal.timeout(180_000) }); }
    catch {
      const error = new Error('Staging transport outcome unconfirmed');
      error.syllabusDiagnostic = { kind: 'transport', httpStatus: null, code: 'TRANSPORT_OUTCOME_UNCONFIRMED' }; throw error;
    }
    const body = await response.json().catch(() => null);
    if (!expected.includes(response.status)) {
      const code = body?.error?.code || body?.code;
      const error = new Error('Staging request failed; no automatic retry');
      error.syllabusDiagnostic = { kind: 'http', httpStatus: response.status, code: SAFE_REMOTE_CODES.has(code) ? code : 'REMOTE_ERROR' }; throw error;
    }
    return body;
  }
  const service = (route, options = {}, expected) => transport(config.supabaseUrl, `/rest/v1/${route}`, {
    ...options, headers: { apikey: config.serviceRoleKey, 'Content-Type': 'application/json', ...options.headers } }, expected);
  const worker = async (user, route, body, expected) => {
    const data = await transport(config.workerUrl, route, { method: 'POST', headers: { Origin: config.workerUrl,
      Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, expected);
    assert.equal(data?.ok, true, 'Staging Worker rejected request'); return route === '/access' ? data.access : data.data;
  };
  const query = (user, operation, payload = {}) => worker(user, '/examinations/query', { operation, ...payload });
  async function command(user, operation, payload = {}, expected) {
    const details = {};
    for (const key of ['attemptId', 'questionId', 'versionId', 'requestKey']) if (payload[key]) details[key] = payload[key];
    const entry = await intent(operation, details);
    const value = await worker(user, '/examinations/command', { operation, ...payload }, expected);
    if (operation === 'start_attempt') {
      const record = { attemptId: uuid(value?.attempt?.attemptId), userId: user.id, versionId: uuid(payload.versionId), questionId: null, gradingJobId: null, assessmentId: null };
      manifest.attempts.push(record); await saveManifest();
      assert.equal(value.questions?.length, 1, 'The selector must return exactly one question');
      record.questionId = uuid(value.questions[0].questionId); await saveManifest();
    }
    if (operation === 'request_ai_grading' && value?.jobId) {
      manifest.attempts[0].gradingJobId = uuid(value.jobId); await saveManifest();
    }
    await confirm(entry); return value;
  }
  async function createUser(label) {
    stage = `create-${label}`;
    const identity = await lifecycle.beforeCreate(label);
    const password = `Dd!${randomBytes(24).toString('base64url')}9z`;
    const created = await transport(config.supabaseUrl, '/auth/v1/admin/users', { method: 'POST',
      headers: { apikey: config.serviceRoleKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: identity.email, password, email_confirm: true, app_metadata: identity.appMetadata,
        user_metadata: { full_name: identity.fullName } }) }, [200, 201]);
    const id = uuid(created?.id);
    await lifecycle.recordCreated(label, id);
    manifest.fixtures.push({ label, id }); await saveManifest();
    await lifecycle.register(id); await lifecycle.beforeSignIn(id);
    const session = await transport(config.supabaseUrl, '/auth/v1/token?grant_type=password', { method: 'POST',
      headers: { apikey: config.publishableKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: identity.email, password }) });
    await lifecycle.rememberSession(id, session);
    const user = { id, token: session.access_token }; users.set(label, user);
    const settings = await service('platform_access_settings?singleton=eq.true&select=current_terms_version,current_privacy_version');
    assert.equal(settings?.length, 1, 'Missing current legal versions');
    const terms = settings[0];
    const termsIntent = await intent(`accept-terms-${label}`, { userId: id });
    await transport(config.supabaseUrl, '/rest/v1/rpc/accept_terms', { method: 'POST',
      headers: { apikey: config.publishableKey, Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_terms_version: terms.current_terms_version, p_privacy_version: terms.current_privacy_version,
        p_acceptance_source: 'protected_staging_e2e' }) }, [200, 204]);
    await confirm(termsIntent);
    const accessBefore = await worker(user, '/access', {});
    assert.ok(typeof accessBefore?.tokenDisclosureVersion === 'string' && accessBefore.tokenDisclosureVersion.length > 8, 'Missing disclosure version');
    const entry = await intent(`onboard-${label}`, { userId: id });
    await transport(config.supabaseUrl, '/rest/v1/rpc/complete_commercial_profile_onboarding_v2', { method: 'POST',
      headers: { apikey: config.publishableKey, Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_display_name: identity.fullName, p_law_school_id: 'other', p_law_school_other: 'Synthetic Staging Law School',
        p_category: 'review', p_professor_license_number: null, p_terms_version: terms.current_terms_version,
        p_privacy_version: terms.current_privacy_version, p_trial_disclosure_version: accessBefore.tokenDisclosureVersion, p_trial_acknowledged: true }) });
    await confirm(entry); return user;
  }
  async function prepareAccess(admin, student) {
    stage = 'promote-owned-admin';
    await lifecycle.beforePromotion(admin.id);
    await service(`user_roles?user_id=eq.${admin.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ role: 'super_admin', assigned_by: admin.id, updated_at: new Date(now()).toISOString() }) }, [200, 204]);
    const roles = await service(`user_roles?user_id=eq.${admin.id}&select=role`);
    assert.equal(roles?.length === 1 && roles[0].role === 'super_admin', true, 'Owned admin promotion not confirmed');
    const expiresAt = new Date(now() + 3_600_000).toISOString();
    const reason = `Syllabus coaching staging verification ${runId}`;
    for (const table of ['free_beta_access', 'examination_beta_access']) {
      const previous = await service(`${table}?user_id=eq.${student.id}&select=user_id`);
      assert.equal(Array.isArray(previous) && previous.length === 0, true, 'Unexpected existing fixture access');
    }
    const grant = { table: 'free_beta_access', userId: student.id, actorUserId: admin.id, program: 'founding_beta_2026', enabled: true,
      expiresAt, reason, state: 'requested', cleanupState: 'pending' };
    manifest.grants.push(grant); await saveManifest();
    const entry = await intent('grant-owned-founding-beta', { userId: student.id, actorUserId: admin.id });
    const rows = await service('free_beta_access', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
      user_id: student.id, enabled: true, expires_at: expiresAt, reason, created_by: admin.id, updated_by: admin.id, access_program: grant.program }) }, [200, 201]);
    assert.equal(rows?.length, 1, 'Grant outcome unresolved');
    const row = rows[0];
    assert.equal(row.user_id === student.id && row.created_by === admin.id && row.updated_by === admin.id && row.access_program === grant.program && row.enabled === true && row.reason === reason, true, 'Grant ownership mismatch');
    assert.equal(iso(row.expires_at), expiresAt, 'Grant expiry changed');
    grant.state = 'confirmed'; if (row.id != null) grant.id = uuid(row.id); await confirm(entry);
    const beta = { table: 'examination_beta_access', userId: student.id, actorUserId: admin.id, enabled: true, expiresAt, reason, state: 'requested', cleanupState: 'pending' };
    manifest.grants.push(beta); await saveManifest();
    const requestKey = makeKey('beta');
    const betaIntent = await intent('set_beta_access', { userId: student.id, actorUserId: admin.id, requestKey });
    const granted = await worker(admin, '/admin/examinations', { operation: 'set_beta_access', userId: student.id, enabled: true, expiresAt, reason, requestKey });
    assert.equal(granted?.enabled, true, 'Admin beta grant not confirmed');
    const betaRows = await service(`examination_beta_access?user_id=eq.${student.id}&select=user_id,granted_by,enabled,expires_at,reason`);
    assert.equal(betaRows?.length === 1 && betaRows[0].user_id === student.id && betaRows[0].granted_by === admin.id && betaRows[0].enabled === true && betaRows[0].reason === reason, true, 'Admin beta grant ownership mismatch');
    assert.equal(iso(betaRows[0].expires_at), expiresAt, 'Admin beta expiry changed');
    beta.state = 'confirmed'; await confirm(betaIntent);
    const access = await worker(student, '/access', {});
    assert.equal(access?.allowed === true && access.unlimited === true && access.basis === 'founding_beta', true, 'Owned student access mismatch');
  }
  await saveManifest(); await persist('artifacts/syllabus-coaching/summary.json', summary);
  try {
    stage = 'fixture-preflight'; await lifecycle.preflight();
    const admin = await createUser('admin');
    const student = await createUser('student-a');
    await prepareAccess(admin, student);
    stage = 'subject_catalog';
    const catalog = await query(student, 'subject_catalog');
    const subject = catalog?.items?.find(item => item.subject === 'Criminal Law I' && item.yearLevel === 1 && item.term === 1);
    assert.ok(subject, 'Required bounded syllabus subject unavailable');
    // subject_next may allocate a private selection, so its intent is durable too.
    const nextIntent = await intent('subject_next', { userId: student.id });
    const selected = await query(student, 'subject_next', { subject: subject.subject, yearLevel: subject.yearLevel, term: subject.term });
    const versionId = uuid(selected?.setup?.versionId); nextIntent.versionId = versionId; await confirm(nextIntent);
    assert.ok(selected.setup.allowedTimerModes?.includes('none'), 'Expected syllabus timer mode unavailable');
    const setup = await query(student, 'setup', { versionId });
    assert.equal(setup?.versionId === versionId && setup.questionCount === 1, true, 'Selection exceeds one-item bound');
    const tabToken = randomBytes(32).toString('hex');
    const started = await command(student, 'start_attempt', { versionId, timerMode: 'none', requestKey: makeKey('start'), tabToken }, [201]);
    assert.equal(started.examination?.track, 'per_subject', 'Non-syllabus track selected');
    assert.equal(started.attempt.assisted, false, 'Unexpected assisted start');
    assert.equal(started.attempt.reviewMaterialRevealedAt, null, 'Unexpected prior reveal');
    const attemptId = manifest.attempts[0].attemptId;
    const questionId = manifest.attempts[0].questionId;
    const prompt = started.questions[0].prompt;
    assert.ok(typeof prompt === 'string' && prompt.trim(), 'Question prompt missing');
    assertNoProtectedReview(started.questions[0]);
    manifest.attempts[0].promptSha256 = hash(prompt); await saveManifest();
    const saved = await command(student, 'save_response', { attemptId, questionId, tabToken, answerText: SYNTHETIC_ANSWER, expectedRevision: 0, flagged: false });
    assert.equal(saved.revision, 1, 'Saved revision mismatch');
    const submitted = await command(student, 'submit_attempt', { attemptId, tabToken, requestKey: makeKey('submit'), confirmed: true });
    assert.equal(submitted.status, 'submitted', 'Submission outcome unresolved');
    // One invocation only. A timeout or a partial/uncertain result is operator review, never a blind retry.
    const grading = await command(student, 'request_ai_grading', { attemptId, requestKey: makeKey('grade') });
    assert.equal(grading.status === 'completed' && grading.questionCount === 1 && grading.completedQuestions === 1, true, 'Bounded grading did not complete');
    stage = 'coaching-before-reveal';
    const coaching = await query(student, 'verdict', { attemptId });
    const input = { attemptId, questionId, prompt, answerText: SYNTHETIC_ANSWER };
    summary.result = validateSyllabusCoaching(coaching, input);
    summary.coachingBeforeReveal = true; summary.assistedBeforeReveal = coaching.attempt.assisted;
    const aiRows = await service(`examination_ai_assessments?attempt_id=eq.${attemptId}&question_id=eq.${questionId}&select=id,grader_model,score`);
    assert.equal(aiRows?.length, 1, 'Exact assessment provenance missing');
    manifest.attempts[0].assessmentId = uuid(aiRows[0].id); await saveManifest();
    assert.ok(modelPolicy.allowedModels.includes(aiRows[0].grader_model), 'Unexpected grading provider model');
    assert.equal(Number(aiRows[0].score), summary.result.score, 'Stored grade differs');
    summary.result.model = aiRows[0].grader_model;
    await persist('artifacts/syllabus-coaching/summary.json', summary);
    const review = await command(student, 'subject_reveal_review', { attemptId });
    assert.equal(review.attemptId === attemptId && review.questionId === questionId && review.status === 'available', true, 'Wrong explicit review resource');
    assert.equal(review.assisted === false && review.assistanceKnown === true && review.classification === 'unassisted', true, 'Post-submission Reveal changed classification');
    iso(review.reviewMaterialRevealedAt);
    summary.explicitReveal = true; summary.assistedAfterReveal = review.assisted;
    stage = 'adaptive-sections-after-reveal';
    const after = await query(student, 'verdict', { attemptId });
    const finalResult = validateSyllabusCoaching(after, { ...input, revealed: true });
    assert.equal(finalResult.score, summary.result.score, 'Reveal changed the grade');
    assert.equal(after.attempt.reviewMaterialRevealedAt, review.reviewMaterialRevealedAt, 'Release timestamps differ');
    flowPassed = true;
  } catch (error) {
    summary.failureStage = stage; // Never persist provider bodies, assertion details, passwords, keys or tokens.
    summary.failureDiagnostic = diagnostic(error);
  } finally {
    stage = 'cleanup';
    const owned = lifecycle.snapshot().fixtures.filter(record => record.id);
    const verified = new Set();
    for (const fixture of owned) {
      try { if (await lifecycle.verifyCleanupIdentity(fixture.id)) verified.add(fixture.id); }
      catch { manifest.cleanupFailures.push(`identity-${fixture.label}`); }
    }
    for (const grant of [...manifest.grants].reverse()) {
      try {
        assert.ok(verified.has(grant.userId) && verified.has(grant.actorUserId), 'Cleanup fixture ownership unconfirmed');
        // Any uncertain grant write needs separate outcome recovery, not inferred deletion.
        assert.equal(grant.state, 'confirmed', 'Grant write outcome unresolved');
        const conditions = new URLSearchParams({ user_id: `eq.${grant.userId}`, enabled: 'eq.true', expires_at: `eq.${grant.expiresAt}`, reason: `eq.${grant.reason}` });
        if (grant.table === 'free_beta_access') {
          conditions.set('created_by', `eq.${grant.actorUserId}`); conditions.set('updated_by', `eq.${grant.actorUserId}`);
          conditions.set('access_program', `eq.${grant.program}`);
        } else conditions.set('granted_by', `eq.${grant.actorUserId}`);
        const before = await service(`${grant.table}?${conditions}&select=user_id`);
        assert.equal(before?.length === 1 && before[0].user_id === grant.userId, true, 'Exact grant changed before cleanup');
        grant.cleanupState = 'delete_requested'; await saveManifest();
        await service(`${grant.table}?${conditions}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, [200, 204]);
        const after = await service(`${grant.table}?user_id=eq.${grant.userId}&select=user_id`);
        assert.equal(Array.isArray(after) && after.length === 0, true, 'Grant deletion not confirmed');
        grant.cleanupState = 'deleted'; await saveManifest();
      } catch { manifest.cleanupFailures.push(`grant-${grant.table}`); }
    }
    // Retain accounts when access cleanup is uncertain. Student deletion precedes its admin grantor.
    if (manifest.cleanupFailures.length === 0) {
      for (const fixture of [...owned].reverse()) {
        try { await lifecycle.deleteUser(fixture.id); }
        catch { manifest.cleanupFailures.push(`auth-${fixture.label}`); }
      }
    }
    try { await lifecycle.finishCleanup(manifest.cleanupFailures.length === 0); }
    catch { manifest.cleanupFailures.push('lifecycle-unresolved'); }
    manifest.supportedApiComplete = lifecycle.snapshot().cleanupComplete === true && manifest.cleanupFailures.length === 0;
    const lifecycleBytes = dependencies.lifecycleBytes ? await dependencies.lifecycleBytes() : await readFile(lifecycle.manifestPath).catch(() => null);
    if (lifecycleBytes) manifest.lifecycleManifestSha256 = hash(lifecycleBytes);
    else { manifest.supportedApiComplete = false; manifest.cleanupFailures.push('lifecycle-artifact-missing'); }
    await saveManifest();
    summary.cleanup = { supportedApiComplete: manifest.supportedApiComplete, independentDatabaseReadbackRequired: true,
      lifecycleManifestPath: lifecyclePath, lifecycleManifestSha256: manifest.lifecycleManifestSha256 };
    summary.cleanupManifestSha256 = hash(json(manifest));
    summary.passed = flowPassed && manifest.supportedApiComplete;
    await persist('artifacts/syllabus-coaching/summary.json', summary);
  }
  return { summary, cleanupManifest: manifest };
}

async function main() {
  assert.deepEqual(process.argv.slice(2), ['--execute-staging'], 'Hosted verification requires --execute-staging');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const config = syllabusStagingConfig(process.env, head);
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT, encoding: 'utf8' }).trim(), '', 'Tracked worktree must match exact source SHA');
  const { summary } = await runSyllabusCoachingStaging(config);
  if (!summary.passed) { process.exitCode = 1; console.error('SYLLABUS_COACHING_STAGING: failed; inspect retained sanitized artifacts.'); return; }
  console.log(`SYLLABUS_COACHING_STAGING: passed=true source_sha=${summary.releaseSha} github_run_id=${summary.githubRunId} github_run_attempt=${summary.githubRunAttempt} supported_api_cleanup=true independent_database_readback_required=true`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.exitCode = 1; console.error('SYLLABUS_COACHING_STAGING: preflight or artifact failure; no automatic retry.'); });
}

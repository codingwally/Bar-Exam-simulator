import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { provisionMandatoryCommercialChoice } from './staging-commercial-user.mjs';

const SUPABASE_URL = String(process.env.STAGING_SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_ROLE_KEY = String(process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '');
const PUBLISHABLE_KEY = String(process.env.STAGING_SUPABASE_PUBLISHABLE_KEY || '');
const WORKER_URL = String(process.env.STAGING_EXAMINATION_WORKER_URL || '').replace(/\/+$/, '');
const ORIGIN = WORKER_URL;

assert.equal(SUPABASE_URL, 'https://hlzqmreeoghbldnhlybr.supabase.co');
assert.equal(
  WORKER_URL,
  'https://duediligence-examinations-staging.wallyesteban1993.workers.dev',
);
assert.ok(
  /^sb_secret_[A-Za-z0-9_-]{20,}$/.test(SERVICE_ROLE_KEY),
  'A dedicated staging secret key is required.',
);
assert.match(PUBLISHABLE_KEY, /^sb_publishable_[A-Za-z0-9_-]{20,}$/);

const runId = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
const createdUsers = [];
const createdEntryIds = [];

const serviceHeaders = {
  apikey: SERVICE_ROLE_KEY,
  'Content-Type': 'application/json',
};

function requestKey(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function tabToken() {
  return randomBytes(32).toString('hex');
}

async function jsonRequest(url, options = {}, expected = [200]) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(180_000),
  });
  const body = await response.json().catch(() => null);
  if (!expected.includes(response.status)) {
    throw new Error(
      `${options.method || 'GET'} ${new URL(url).pathname} returned ${response.status}: `
      + `${body?.error?.code || body?.error?.message || body?.message || 'invalid JSON'}`,
    );
  }
  return { response, body };
}

async function serviceGet(path) {
  const { body } = await jsonRequest(`${SUPABASE_URL}${path}`, {
    headers: serviceHeaders,
  });
  return body;
}

async function acceptCurrentTerms(user) {
  const settings = await serviceGet(
    '/rest/v1/platform_access_settings?singleton=eq.true&select=current_terms_version,current_privacy_version',
  );
  assert.equal(settings.length, 1);
  await jsonRequest(`${SUPABASE_URL}/rest/v1/rpc/accept_terms`, {
    method: 'POST',
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${user.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_terms_version: settings[0].current_terms_version,
      p_privacy_version: settings[0].current_privacy_version,
      p_acceptance_source: 'protected_staging_e2e',
    }),
  }, [200, 204]);
  return settings[0];
}

async function serviceRpc(name, payload) {
  const { body } = await jsonRequest(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify(payload),
  }, [200, 204]);
  return body;
}

async function createUser(label) {
  const email = `dd-complete-beta-${label}-${runId}@duediligence.ph`;
  const password = `Dd!${randomBytes(24).toString('base64url')}9z`;
  const { body: user } = await jsonRequest(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: `Release ${label}` },
    }),
  }, [200, 201]);
  createdUsers.push(user.id);

  const { body: session } = await jsonRequest(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        apikey: PUBLISHABLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    },
  );
  assert.ok(session.access_token);
  const created = { id: user.id, token: session.access_token };
  const legalVersions = await acceptCurrentTerms(created);
  await provisionMandatoryCommercialChoice({
    supabaseUrl: SUPABASE_URL,
    publishableKey: PUBLISHABLE_KEY,
    workerUrl: WORKER_URL,
    token: created.token,
    displayName: `Release ${label}`,
    termsVersion: legalVersions.current_terms_version,
    privacyVersion: legalVersions.current_privacy_version,
  });
  return created;
}

async function workerPost(path, payload, token, expected = [200]) {
  const { body, response } = await jsonRequest(`${WORKER_URL}${path}`, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  }, expected);
  return { body, response };
}

async function examinationQuery(user, operation, payload = {}, expected = [200]) {
  try {
    return await workerPost(
      '/examinations/query',
      { operation, ...payload },
      user?.token || null,
      expected,
    );
  } catch (error) {
    throw new Error(`Examination query ${operation} failed: ${error.message}`, { cause: error });
  }
}

async function examinationCommand(user, operation, payload = {}, expected = [200]) {
  return workerPost(
    '/examinations/command',
    { operation, ...payload },
    user?.token || null,
    expected,
  );
}

async function quorumQuery(user, operation, payload = {}, expected = [200]) {
  return workerPost(
    '/quorum/query',
    { operation, payload },
    user.token,
    expected,
  );
}

async function quorumCommand(user, operation, payload = {}, expected = [200]) {
  return workerPost(
    '/quorum/command',
    { operation, payload },
    user.token,
    expected,
  );
}

async function grantBetaAccess(actorUserId, targetUserId) {
  const result = await serviceRpc('examination_admin', {
    p_actor_user_id: actorUserId,
    p_operation: 'set_beta_access',
    p_payload: {
      operation: 'set_beta_access',
      userId: targetUserId,
      enabled: true,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      reason: `Complete beta staging verification ${runId}`,
      requestKey: requestKey('beta_access'),
    },
  });
  assert.equal(result.enabled, true);
}

async function grantFoundingBetaAccess(actorUserId, targetUser) {
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  const { body } = await jsonRequest(
    `${SUPABASE_URL}/rest/v1/free_beta_access?on_conflict=user_id`,
    {
      method: 'POST',
      headers: {
        ...serviceHeaders,
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify({
        user_id: targetUser.id,
        enabled: true,
        expires_at: expiresAt,
        reason: `Protected staging review verification ${runId}`,
        created_by: actorUserId,
        updated_by: actorUserId,
        access_program: 'founding_beta_2026',
      }),
    },
    [200, 201],
  );
  assert.equal(body.length, 1);
  assert.equal(body[0].enabled, true);
  assert.equal(body[0].access_program, 'founding_beta_2026');

  const access = await workerPost('/access', {}, targetUser.token);
  assert.equal(access.body.access?.allowed, true);
  assert.equal(access.body.access?.unlimited, true);
  assert.equal(access.body.access?.basis, 'founding_beta');
}

function alacAnswer() {
  return [
    'I. ANSWER: The legal result depends on whether every statutory element is established by the facts given.',
    'II. LEGAL BASIS: The governing Philippine statute and the controlling Supreme Court doctrine identified in the curated legal basis supply the rule; a conclusion alone does not establish entitlement to relief.',
    'III. APPLICATION: The examiner must compare each material fact in the problem with every element of that rule, including the parties’ legal relationship, the challenged act, and the consequence expressly stated in the question.',
    'IV. CONCLUSION: Therefore, relief should issue only if those elements are proven; otherwise, the claim must fail.',
  ].join('\n\n');
}

async function deleteSyntheticEntry(entryId) {
  await jsonRequest(
    `${SUPABASE_URL}/rest/v1/forum_posts?public_id=eq.${encodeURIComponent(entryId)}`,
    {
      method: 'DELETE',
      headers: {
        ...serviceHeaders,
        Prefer: 'return=minimal',
      },
    },
    [200, 204],
  );
}

async function deleteUser(userId) {
  await jsonRequest(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: serviceHeaders,
  }, [200, 204]);
}

let outcome;
try {
  console.log('STAGING_GATE: creating isolated users');
  const administrators = await serviceGet(
    '/rest/v1/user_roles?role=eq.super_admin&select=user_id&order=created_at.asc&limit=1',
  );
  assert.equal(administrators.length, 1);
  const actorUserId = administrators[0].user_id;
  const student = await createUser('student');
  const peer = await createUser('peer');
  await grantBetaAccess(actorUserId, student.id);
  await grantBetaAccess(actorUserId, peer.id);
  await grantFoundingBetaAccess(actorUserId, student);
  await grantFoundingBetaAccess(actorUserId, peer);

  console.log('STAGING_GATE: validating the 1,890-placement Subject Matter catalog');
  const catalog = await examinationQuery(student, 'subject_catalog');
  assert.equal(catalog.body.ok, true);
  assert.equal(catalog.body.data.items.length, 42);
  assert.equal(
    catalog.body.data.items.every((item) => !('questionCount' in item)),
    true,
    'Public Subject Matter discovery must not disclose inventory counts.',
  );

  const criminalLaw = catalog.body.data.items.find(
    (item) => item.subject === 'Criminal Law I'
      && item.yearLevel === 1
      && item.term === 1,
  );
  assert.ok(criminalLaw, 'Criminal Law I must remain available in Subject Matter discovery.');

  const first = await examinationQuery(student, 'subject_next', {
    subject: criminalLaw.subject,
    yearLevel: criminalLaw.yearLevel,
    term: criminalLaw.term,
  });
  const repeated = await examinationQuery(student, 'subject_next', {
    subject: criminalLaw.subject,
    yearLevel: criminalLaw.yearLevel,
    term: criminalLaw.term,
  });
  assert.equal(first.body.data.setup.versionId, repeated.body.data.setup.versionId);
  assert.deepEqual(first.body.data.setup.allowedTimerModes, ['strict', 'selfPaced', 'none']);

  const setup = await examinationQuery(student, 'setup', {
    versionId: first.body.data.setup.versionId,
  });
  assert.equal(setup.body.data.questionCount, 1);
  assert.deepEqual(setup.body.data.allowedTimerModes, ['strict', 'selfPaced', 'none']);

  const activeTab = tabToken();
  const started = await examinationCommand(student, 'start_attempt', {
    versionId: setup.body.data.versionId,
    timerMode: 'none',
    requestKey: requestKey('start'),
    tabToken: activeTab,
  }, [201]);
  assert.equal(started.body.data.questions.length, 1);
  const attemptId = started.body.data.attempt.attemptId;
  const questionId = started.body.data.questions[0].questionId;

  console.log('STAGING_GATE: revealing exact owner-bound Subject Matter complete review');
  const reviewMaterial = await examinationCommand(student, 'subject_reveal_review', { attemptId });
  assert.deepEqual(
    Object.keys(reviewMaterial.body.data).sort(),
    [
      'access', 'assistanceKnown', 'assisted', 'attemptId', 'citation', 'classification', 'doctrine', 'explanationSource',
      'governingProvision', 'jurisprudence', 'legalBasis', 'legalReview', 'questionId',
      'reviewMaterialRevealedAt', 'sources', 'status', 'suggestedAnswer', 'teachingModel',
      'whyThisAnswerIsCorrect',
    ].sort(),
  );
  assert.equal(reviewMaterial.body.data.status, 'available');
  assert.equal(reviewMaterial.body.data.attemptId, attemptId);
  assert.equal(reviewMaterial.body.data.questionId, questionId);
  assert.equal(reviewMaterial.body.data.assisted, true);
  assert.equal(reviewMaterial.body.data.assistanceKnown, true);
  assert.equal(reviewMaterial.body.data.classification, 'assisted');
  assert.equal(reviewMaterial.body.data.access.allowed, true);
  assert.equal(reviewMaterial.body.data.access.unlimited, true);
  assert.equal(reviewMaterial.body.data.access.basis, 'founding_beta');
  assert.ok(Number.isFinite(Date.parse(reviewMaterial.body.data.reviewMaterialRevealedAt)));
  assert.ok(reviewMaterial.body.data.suggestedAnswer.trim().length >= 20);
  assert.ok(reviewMaterial.body.data.legalBasis.trim().length >= 20);
  assert.ok(reviewMaterial.body.data.doctrine.trim().length > 0);
  assert.deepEqual(
    Object.keys(reviewMaterial.body.data.whyThisAnswerIsCorrect).sort(),
    [
      'applicationToFacts', 'controllingLawAndElements', 'directAnswer',
      'finalConclusion', 'materialExceptionsOrLimits',
    ].sort(),
  );
  assert.deepEqual(
    Object.keys(reviewMaterial.body.data.legalReview).sort(),
    [
      'applicationToFacts', 'authorityReferences', 'controllingLawAndDoctrine',
      'finalConclusion', 'jurisprudence', 'materialExceptionsOrLimits',
    ].sort(),
  );
  assert.ok(reviewMaterial.body.data.legalReview.controllingLawAndDoctrine.trim().length >= 20);
  assert.ok(reviewMaterial.body.data.legalReview.applicationToFacts.trim().length >= 20);
  assert.ok(reviewMaterial.body.data.sources.every((source) => /^https:\/\//.test(source)));
  const repeatedReview = await examinationCommand(student, 'subject_reveal_review', { attemptId });
  assert.equal(
    repeatedReview.body.data.reviewMaterialRevealedAt,
    reviewMaterial.body.data.reviewMaterialRevealedAt,
    'Repeated reveal must preserve the original assisted-classification timestamp.',
  );
  const peerReview = await examinationCommand(peer, 'subject_reveal_review', { attemptId }, [404]);
  assert.equal(peerReview.body.error.code, 'EXAM_SUBJECT_REVIEW_MATERIAL_UNAVAILABLE');

  await examinationCommand(student, 'save_response', {
    attemptId,
    questionId,
    tabToken: activeTab,
    answerText: alacAnswer(),
    expectedRevision: 0,
    flagged: false,
  });
  await examinationCommand(student, 'submit_attempt', {
    attemptId,
    tabToken: activeTab,
    requestKey: requestKey('submit'),
    confirmed: true,
  });

  console.log('STAGING_GATE: requesting one live Gemini assessment');
  let grading;
  for (let index = 0; index < 4; index += 1) {
    grading = await examinationCommand(student, 'request_ai_grading', {
      attemptId,
      requestKey: requestKey(`grade_${index}`),
    });
    if (grading.body.data.status === 'completed') break;
  }
  assert.equal(grading.body.data.status, 'completed');

  console.log('STAGING_GATE: validating verdict, no-repeat selection, and isolation');
  const verdict = await examinationQuery(student, 'verdict', { attemptId });
  assert.equal(verdict.body.data.released, true);
  assert.equal(verdict.body.data.results.length, 1);
  const assessment = verdict.body.data.results[0];
  assert.ok(Number.isFinite(assessment.aiScore));
  assert.ok(assessment.aiScore >= 0 && assessment.aiScore <= 5);
  assert.ok(Math.abs(assessment.aiScore * 10 - Math.round(assessment.aiScore * 10)) < 1e-9);
  assert.match(assessment.modelAnswer, /ANSWER/i);
  assert.match(assessment.modelAnswer, /LEGAL BASIS/i);
  assert.match(assessment.modelAnswer, /APPLICATION/i);
  assert.match(assessment.modelAnswer, /CONCLUSION/i);

  const isolated = await examinationQuery(peer, 'resume', { attemptId }, [404]);
  assert.equal(isolated.body.error.code, 'EXAM_ATTEMPT_NOT_FOUND');

  const next = await examinationQuery(student, 'subject_next', {
    subject: criminalLaw.subject,
    yearLevel: criminalLaw.yearLevel,
    term: criminalLaw.term,
  });
  assert.notEqual(next.body.data.setup.versionId, first.body.data.setup.versionId);
  for (const confidentialCount of [
    'completedCount',
    'attemptedCount',
    'completedQuestions',
    'attemptedQuestions',
    'cycleComplete',
  ]) {
    assert.equal(confidentialCount in next.body.data, false);
  }

  console.log('STAGING_GATE: proving post-submission reveal remains unassisted');
  const secondTab = tabToken();
  const secondStarted = await examinationCommand(student, 'start_attempt', {
    versionId: next.body.data.setup.versionId,
    timerMode: 'none',
    requestKey: requestKey('start_unassisted'),
    tabToken: secondTab,
  }, [201]);
  const secondAttemptId = secondStarted.body.data.attempt.attemptId;
  const secondQuestionId = secondStarted.body.data.questions[0].questionId;
  await examinationCommand(student, 'save_response', {
    attemptId: secondAttemptId,
    questionId: secondQuestionId,
    tabToken: secondTab,
    answerText: alacAnswer(),
    expectedRevision: 0,
    flagged: false,
  });
  await examinationCommand(student, 'submit_attempt', {
    attemptId: secondAttemptId,
    tabToken: secondTab,
    requestKey: requestKey('submit_unassisted'),
    confirmed: true,
  });
  const postSubmissionReview = await examinationCommand(
    student,
    'subject_reveal_review',
    { attemptId: secondAttemptId },
  );
  assert.equal(postSubmissionReview.body.data.assisted, false);
  assert.equal(postSubmissionReview.body.data.assistanceKnown, true);
  assert.equal(postSubmissionReview.body.data.classification, 'unassisted');
  assert.ok(Number.isFinite(Date.parse(postSubmissionReview.body.data.reviewMaterialRevealedAt)));

  const performance = await examinationQuery(student, 'subject_performance', {
    subject: criminalLaw.subject,
    limit: 10,
  });
  assert.ok(performance.body.data.attemptedQuestions >= 1);
  assert.ok(Array.isArray(performance.body.data.recentAttempts));

  const barFeels = await examinationQuery(student, 'catalog', { track: 'bar_feels' });
  const curatedBarFeels = barFeels.body.data.items.filter(
    (item) => item.assessmentKind === 'curated' && item.testOnly === false,
  );
  assert.equal(curatedBarFeels.length, 6);
  assert.ok(curatedBarFeels.every((item) => item.questionCount === 20));
  assert.equal(new Set(curatedBarFeels.map((item) => item.subject)).size, 6);

  console.log('STAGING_GATE: validating Quorum composer and atomic Affirm reactions');
  const marker = `[SYNTHETIC COMPLETE BETA ${runId}]`;
  const created = await quorumCommand(student, 'create_simple_entry', {
    body: `${marker} The floor is open for a controlled staging discussion.`,
    kind: 'discussion',
    subject: 'Labor Law',
    lawSchoolYear: 'Second year',
  }, [200, 201]);
  const entryId = created.body.data.entryId;
  createdEntryIds.push(entryId);
  assert.match(entryId, /^qe_[a-f0-9]{20}$/);

  const heard = await quorumCommand(peer, 'set_affirm', {
    entryId,
    reaction: 'hear',
  });
  assert.equal(heard.body.data.reaction, 'hear');
  const changed = await quorumCommand(peer, 'set_affirm', {
    entryId,
    reaction: 'feel',
  });
  assert.equal(changed.body.data.reaction, 'feel');

  const roster = await quorumQuery(student, 'affirm_roster', {
    entryId,
    limit: 60,
  });
  assert.equal(roster.body.data.total, 1);
  assert.equal(roster.body.data.groups.feel.length, 1);
  assert.equal(roster.body.data.groups.hear.length, 0);

  const removed = await quorumCommand(peer, 'set_affirm', {
    entryId,
    reaction: 'feel',
  });
  assert.equal(removed.body.data.reaction, null);

  const insights = await quorumQuery(student, 'insights');
  assert.ok(Array.isArray(insights.body.data.trending));
  assert.ok(Array.isArray(insights.body.data.questions));

  outcome = {
    ok: true,
    runId,
    subjectMatter: {
      canonicalQuestions: 1490,
      placements: 1890,
      subjects: 42,
      repeatedQuestionStable: true,
      noRepeatAfterSubmission: true,
      timerModes: 3,
      assessmentScore: assessment.aiScore,
      assistedRevealDurable: true,
      postSubmissionRevealUnassisted: true,
    },
    barFeels: {
      destinations: 6,
      questionsPerDestination: 20,
      assignments: 120,
    },
    quorum: {
      simpleComposer: true,
      atomicAffirmReplacement: true,
      sameReactionRemoves: true,
      roster: true,
      insights: true,
    },
    crossUserIsolation: true,
  };
} finally {
  console.log('STAGING_GATE: cleaning isolated test data');
  const cleanupErrors = [];
  for (const entryId of createdEntryIds.reverse()) {
    await deleteSyntheticEntry(entryId).catch((error) => cleanupErrors.push(error));
  }
  for (const userId of createdUsers.reverse()) {
    await deleteUser(userId).catch((error) => cleanupErrors.push(error));
  }
  if (cleanupErrors.length) {
    throw new AggregateError(cleanupErrors, 'Complete beta staging cleanup failed.');
  }
  console.log(`STAGING_GATE: synthetic_cleanup=true run_id=${runId}`);
}

const residue = await serviceGet(
  `/rest/v1/forum_posts?body=like.*${encodeURIComponent(runId)}*&select=public_id`,
);
assert.equal(residue.length, 0, 'Synthetic Quorum data must be removed.');

console.log(JSON.stringify(outcome, null, 2));

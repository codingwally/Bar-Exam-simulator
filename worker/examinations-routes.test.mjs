import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';

const origin = 'https://duediligence.ph';
const supabaseUrl = 'https://staging-test.supabase.co';
const userId = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const attemptId = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';
const tabToken = 'tab_token_that_is_long_enough_for_a_secure_hash';

const env = {
  ALLOWED_ORIGIN: origin,
  SUPABASE_URL: supabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role-key',
  GUEST_USAGE_HMAC_KEY: 'test-only-guest-hmac-key',
};
let requestCounter = 0;

function request(path, body, authorization = true) {
  return new Request(`https://worker.example${path}`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'CF-Connecting-IP': `192.0.2.${++requestCounter}`,
      ...(authorization ? { Authorization: 'Bearer synthetic-user-access-token' } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function withFetchMock(mock, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await callback();
  } finally {
    globalThis.fetch = original;
  }
}

function authResponse(url) {
  if (String(url).endsWith('/auth/v1/user')) {
    return Response.json({ id: userId, email: 'synthetic@example.com' });
  }
  return null;
}

function examinationAssessment() {
  return {
    scoreTenths: 40,
    maxScore: 5,
    percentagePointValue: 4,
    tier: '4.0',
    performanceLabel: 'Strong answer',
    assessmentType: 'question_bank',
    label: 'Question-bank assessment',
    rationale: 'The response states the correct result, identifies the governing rule, and applies the material facts directly.',
    strengths: ['Direct answer', 'Correct governing rule', 'Fact-specific application'],
    errors: [],
    improvements: ['State the final conclusion in one separate sentence.'],
    legalExplanation: 'Article 19 requires every person to act with justice, give everyone their due, and observe honesty and good faith.',
    modelAnswerALAC: {
      answer: 'Yes. The defendant violated the governing duty of conduct.',
      legalBasis: 'Article 19 of the Civil Code requires every person to act with justice, give everyone their due, and observe honesty and good faith.',
      application: 'The deliberate conduct described in the question denied the claimant their due and was inconsistent with honesty and good faith.',
      conclusion: 'Therefore, the defendant is answerable under the stated governing rule.',
    },
    sources: [],
    sourceStatus: 'stored',
    reviewRequired: false,
    rubricVersion: 'SC-2025-BB4-PER-QUESTION-v1',
  };
}

test('authenticated examination catalog reaches only the allowlisted RPC', async () => {
  await withFetchMock(async (url, options) => {
    const auth = authResponse(url);
    if (auth) return auth;
    assert.equal(options.method, 'POST');
    const payload = JSON.parse(options.body);
    if (String(url) === `${supabaseUrl}/rest/v1/rpc/examination_authorize_access`) {
      assert.equal(payload.p_user_id, userId);
      assert.equal(payload.p_track, 'per_subject');
      assert.equal(payload.p_version_id, null);
      assert.equal(payload.p_attempt_id, null);
      assert.equal(payload.p_allow_historical, false);
      return Response.json({ allowed: true, basis: 'standard_access' });
    }
    assert.equal(String(url), `${supabaseUrl}/rest/v1/rpc/examination_query`);
    assert.equal(payload.p_user_id, userId);
    assert.equal(payload.p_operation, 'catalog');
    assert.equal(payload.p_payload.track, 'per_subject');
    return Response.json({ betaAccess: true, items: [] });
  }, async () => {
    const response = await worker.fetch(request('/examinations/query', {
      operation: 'catalog',
      track: 'per_subject',
    }), env);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.data.items, []);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  });
});

test('Subject Matter catalog preserves course metadata but withholds bank inventory', async () => {
  await withFetchMock(async (url, options) => {
    const auth = authResponse(url);
    if (auth) return auth;
    assert.equal(String(url), `${supabaseUrl}/rest/v1/rpc/subject_matter_catalog`);
    assert.deepEqual(JSON.parse(options.body), { p_user_id: userId });
    return Response.json({
      items: [{
        subject: 'Criminal Law I',
        courseCode: 'CRIMLAW1',
        yearLevel: 1,
        term: 1,
        classification: 'Major',
        completedCount: 2,
        questionCount: 50,
        inventory: { totalQuestions: 50 },
      }],
      placementCount: 50,
    });
  }, async () => {
    const response = await worker.fetch(request('/examinations/query', {
      operation: 'subject_catalog',
    }), env);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.items[0].courseCode, 'CRIMLAW1');
    assert.equal('completedCount' in body.data.items[0], false);
    assert.equal('questionCount' in body.data.items[0], false);
    assert.equal('totalQuestions' in body.data.items[0].inventory, false);
    assert.equal('placementCount' in body.data, false);
  });
});

test('Subject Matter random selection uses the dedicated no-repeat RPC', async () => {
  await withFetchMock(async (url, options) => {
    const auth = authResponse(url);
    if (auth) return auth;
    assert.equal(String(url), `${supabaseUrl}/rest/v1/rpc/subject_matter_next_question`);
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload, {
      p_user_id: userId,
      p_subject: 'Criminal Law I',
      p_year_level: 1,
      p_term: 1,
      p_reset_cycle: false,
    });
    return Response.json({
      exhausted: false,
      questionCount: 50,
      remainingQuestions: 49,
      setup: { versionId, questionCount: 1, bankSize: 50 },
    });
  }, async () => {
    const response = await worker.fetch(request('/examinations/query', {
      operation: 'subject_next',
      subject: 'Criminal Law I',
      yearLevel: 1,
      term: 1,
      resetCycle: false,
    }), env);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.exhausted, false);
    assert.equal(body.data.setup.versionId, versionId);
    assert.equal('questionCount' in body.data, false);
    assert.equal('remainingQuestions' in body.data, false);
    assert.equal('questionCount' in body.data.setup, false);
    assert.equal('bankSize' in body.data.setup, false);
  });
});

test('Subject Matter skip is owner-authorized and routed only to the dedicated idempotent RPC', async () => {
  let skipCalls = 0;
  await withFetchMock(async (url, options) => {
    const auth = authResponse(url);
    if (auth) return auth;
    const target = String(url);
    const payload = JSON.parse(options.body);
    if (target === `${supabaseUrl}/rest/v1/rpc/examination_authorize_access`) {
      assert.deepEqual(payload, {
        p_user_id: userId,
        p_track: null,
        p_version_id: null,
        p_attempt_id: attemptId,
        p_allow_historical: false,
      });
      return Response.json({ allowed: true, basis: 'current_owner', track: 'per_subject' });
    }
    assert.equal(target, `${supabaseUrl}/rest/v1/rpc/subject_matter_skip_question`);
    assert.equal(options.headers.Authorization, `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
    assert.deepEqual(payload, {
      p_user_id: userId,
      p_attempt_id: attemptId,
      p_request_key: 'subject_skip_test_0001',
      p_tab_token: tabToken,
    });
    skipCalls += 1;
    return Response.json({
      skipped: true,
      replayed: false,
      attemptId,
      skippedAt: '2026-08-17T11:13:06.000Z',
      flaggedForLater: true,
      cyclePreserved: true,
      setup: {
        versionId,
        track: 'per_subject',
        questionCount: 1,
      },
      questionCount: 50,
    });
  }, async () => {
    const response = await worker.fetch(request('/examinations/command', {
      operation: 'subject_skip_question',
      attemptId,
      requestKey: 'subject_skip_test_0001',
      tabToken,
    }), env);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.skipped, true);
    assert.equal(body.data.flaggedForLater, true);
    assert.equal(body.data.cyclePreserved, true);
    assert.equal(body.data.setup.versionId, versionId);
    assert.equal('questionCount' in body.data, false);
    assert.equal('questionCount' in body.data.setup, false);
    assert.equal(skipCalls, 1);
  });
});

test('Subject Matter complete review uses the owner-bound reveal RPC and curated fallback', async () => {
  await withFetchMock(async (url, options) => {
    const auth = authResponse(url);
    if (auth) return auth;
    assert.equal(String(url), `${supabaseUrl}/rest/v1/rpc/subject_matter_reveal_review`);
    assert.deepEqual(JSON.parse(options.body), {
      p_user_id: userId,
      p_attempt_id: attemptId,
    });
    return Response.json({
      status: 'available',
      attemptId,
      questionId: versionId,
      prompt: 'Did the defendant violate the duty to act with justice and good faith under the stated facts?',
      suggestedAnswer: 'Answer: Yes.\n\nLegal Basis: Article 19 of the Civil Code requires every person to act with justice and good faith.\n\nApplication: The stated conduct violated that duty.\n\nConclusion: The defendant is liable.',
      legalBasis: 'Article 19 of the Civil Code requires every person to act with justice, give everyone his due, and observe honesty and good faith.',
      governingProvision: 'Article 19 of the Civil Code.',
      doctrine: 'The facts directly raise the duty to act with justice and good faith.',
      jurisprudence: [],
      citation: '',
      sources: ['https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/12345'],
      assisted: true,
      assistanceKnown: true,
      reviewMaterialRevealedAt: '2026-08-14T05:00:00.000Z',
      privateNote: 'must never leave the Worker',
    });
  }, async () => {
    const response = await worker.fetch(request('/examinations/command', {
      operation: 'subject_reveal_review',
      attemptId,
    }), env);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.attemptId, attemptId);
    assert.equal(body.data.questionId, versionId);
    assert.equal(body.data.assisted, true);
    assert.equal(body.data.assistanceKnown, true);
    assert.equal(body.data.classification, 'assisted');
    assert.match(body.data.whyThisAnswerIsCorrect.controllingLawAndElements, /Article 19/);
    assert.equal(body.data.explanationSource, 'curated_fallback');
    assert.equal('privateNote' in body.data, false);
  });
});

test('Subject Matter complete review rejects malformed database output without leaking it', async () => {
  await withFetchMock(async (url) => {
    const auth = authResponse(url);
    if (auth) return auth;
    assert.equal(String(url), `${supabaseUrl}/rest/v1/rpc/subject_matter_reveal_review`);
    return Response.json({
      status: 'available',
      attemptId,
      questionId: versionId,
      prompt: 'This prompt is long enough to pass basic validation.',
      suggestedAnswer: 'This suggested answer is long enough to pass basic validation.',
      legalBasis: 'Article 19 of the Civil Code.',
      doctrine: 'Relevant doctrine.',
      jurisprudence: [],
      sources: ['javascript:alert(1)'],
      privateNote: 'database-only detail',
    });
  }, async () => {
    const response = await worker.fetch(request('/examinations/command', {
      operation: 'subject_reveal_review',
      attemptId,
    }), env);
    const body = await response.json();
    assert.equal(response.status, 404);
    assert.equal(body.error.code, 'EXAM_SUBJECT_REVIEW_MATERIAL_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(body), /javascript|database-only/i);
  });
});

test('Subject Matter complete review masks cross-user attempt ownership failures', async () => {
  await withFetchMock(async (url) => {
    const auth = authResponse(url);
    if (auth) return auth;
    assert.equal(String(url), `${supabaseUrl}/rest/v1/rpc/subject_matter_reveal_review`);
    return Response.json(
      { message: 'EXAM_ATTEMPT_NOT_FOUND' },
      { status: 400 },
    );
  }, async () => {
    const response = await worker.fetch(request('/examinations/command', {
      operation: 'subject_reveal_review',
      attemptId,
    }), env);
    const body = await response.json();
    assert.equal(response.status, 404);
    assert.equal(body.error.code, 'EXAM_SUBJECT_REVIEW_MATERIAL_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(body), /ATTEMPT_NOT_FOUND/);
  });
});

for (const track of ['per_subject', 'bar_feels']) {
test(`${track} AI completion suppresses email without calling a provider or failing on audit error`, async () => {
  let providerCalls = 0;
  let deliveryRecorded = null;
  await withFetchMock(async (url, options = {}) => {
    const target = String(url);
    const auth = authResponse(url);
    if (auth) return auth;
    if (target === `${supabaseUrl}/rest/v1/rpc/examination_authorize_access`) {
      assert.deepEqual(JSON.parse(options.body), {
        p_user_id: userId,
        p_track: null,
        p_version_id: null,
        p_attempt_id: attemptId,
        p_allow_historical: true,
      });
      return Response.json({ allowed: true, basis: 'historical_owner', track });
    }
    if (target === `${supabaseUrl}/rest/v1/rpc/examination_command`) {
      return Response.json({
        jobId,
        attemptId,
        status: 'queued',
        questions: [{
          questionId: versionId,
          subject: 'Persons and Family Law',
          prompt: 'Did the defendant violate the duty to act with justice and good faith under the stated facts?',
          studentAnswer: 'Yes. Article 19 requires justice, honesty, and good faith. The deliberate refusal to give the claimant what was due violated that duty, so the defendant is answerable.',
          modelAnswer: 'Answer: Yes.\n\nLegal Basis: Article 19 applies.\n\nApplication: The conduct violated the statutory duty.\n\nConclusion: The defendant is answerable.',
          legalBasis: 'Article 19 of the Civil Code requires justice, honesty, and good faith.',
          application: 'The deliberate conduct denied the claimant what was due.',
          conclusion: 'The defendant is answerable under Article 19.',
          jurisprudence: [],
          citation: 'Civil Code, Article 19',
          sourceUrls: [{
            title: 'Civil Code of the Philippines',
            url: 'https://lawphil.net/statutes/repacts/ra1949/ra_386_1949.html',
          }],
          modelAnswerHash: 'a'.repeat(64),
        }],
      });
    }
    if (target === `${supabaseUrl}/rest/v1/rpc/phase4_reserve_grade_v2`) {
      return Response.json({
        allowed: true,
        basis: 'free',
        accessMode: 'free',
        accountLabel: 'Free',
        unlimited: false,
        dailyLimit: 5,
        completedToday: 0,
        reservedToday: 1,
        remainingToday: 4,
        reservationId: '66666666-6666-4666-8666-666666666666',
      });
    }
    if (target.includes('generativelanguage.googleapis.com')) {
      return Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify(examinationAssessment()) }] } }],
      });
    }
    if (target === `${supabaseUrl}/rest/v1/rpc/examination_store_ai_assessment_commercial`) {
      const payload = JSON.parse(options.body);
      assert.equal(payload.p_reservation_id, '66666666-6666-4666-8666-666666666666');
      return Response.json({
        jobId,
        attemptId,
        status: 'completed',
        completedQuestions: 1,
        questionCount: 1,
        modelsReleased: true,
        access: { allowed: true, accessMode: 'free', remainingToday: 4 },
      });
    }
    if (target === `${supabaseUrl}/rest/v1/rpc/examination_record_delivery`) {
      deliveryRecorded = JSON.parse(options.body);
      if (track === 'bar_feels') {
        return Response.json({ message: 'synthetic audit outage' }, { status: 503 });
      }
      return Response.json({ attemptId, status: deliveryRecorded.p_status });
    }
    if (target === 'https://api.resend.com/emails') {
      providerCalls += 1;
      return Response.json({ id: 'must-not-send' });
    }
    throw new Error(`Unexpected request: ${target}`);
  }, async () => {
    const response = await worker.fetch(request('/examinations/command', {
      operation: 'request_ai_grading',
      attemptId,
      requestKey: 'route_subject_ai_0001',
    }), {
      ...env,
      OUTBOUND_EMAIL_MODE: 'enabled',
      EXAMINATION_EMAIL_MODE: 'enabled',
      EXAMINATION_ROOM_EMAIL_MODE: 'enabled',
      EXAMINATION_EMAIL_FROM: 'Due Diligence <support@duediligence.ph>',
      RESEND_API_KEY: 'test-only-resend-key',
      GEMINI_API_KEY: 'test-only-gemini-key',
      GEMINI_MODEL: 'gemini-test',
      GEMINI_GROUNDING_ENABLED: 'false',
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.status, 'completed');
    assert.equal(body.data.modelAnswerEmailStatus, 'suppressed');
    assert.equal(providerCalls, 0);
    assert.equal(deliveryRecorded.p_target_type, 'model_answers_released');
    assert.equal(deliveryRecorded.p_target_id, attemptId);
    assert.equal(deliveryRecorded.p_status, 'suppressed');
    assert.equal(deliveryRecorded.p_provider_id, null);
  });
});
}

test('Human Examiner assignment returns a manual link without calling an email provider', async () => {
  const assignmentId = '55555555-5555-4555-8555-555555555555';
  const assignmentToken = 'assignment-token-1234567890abcdef1234567890abcdef';
  let providerCalls = 0;
  let deliveryRecorded = null;
  await withFetchMock(async (url, options = {}) => {
    const target = String(url);
    const auth = authResponse(url);
    if (auth) return auth;
    if (target === `${supabaseUrl}/rest/v1/rpc/examination_authorize_access`) {
      assert.deepEqual(JSON.parse(options.body), {
        p_user_id: userId,
        p_track: null,
        p_version_id: null,
        p_attempt_id: attemptId,
        p_allow_historical: false,
      });
      return Response.json({ allowed: true, basis: 'current_owner', track: 'bar_feels' });
    }
    if (target === `${supabaseUrl}/rest/v1/rpc/examination_command`) {
      const payload = JSON.parse(options.body);
      assert.equal(payload.p_operation, 'create_examiner_assignment');
      assert.equal(payload.p_payload.examinerEmail, 'examiner@example.test');
      return Response.json({
        assignmentId,
        expiresAt: '2026-08-18T12:00:00.000Z',
      });
    }
    if (target === `${supabaseUrl}/rest/v1/rpc/examination_record_delivery`) {
      deliveryRecorded = JSON.parse(options.body);
      return Response.json({ message: 'synthetic audit outage' }, { status: 503 });
    }
    if (target === 'https://api.resend.com/emails') {
      providerCalls += 1;
      return Response.json({ id: 'must-not-send' });
    }
    throw new Error(`Unexpected request: ${target}`);
  }, async () => {
    const response = await worker.fetch(request('/examinations/command', {
      operation: 'create_examiner_assignment',
      attemptId,
      examinerEmail: 'examiner@example.test',
      assignmentToken,
      requestKey: 'route_examiner_assignment_0001',
    }), {
      ...env,
      OUTBOUND_EMAIL_MODE: 'enabled',
      EXAMINATION_EMAIL_MODE: 'enabled',
      EXAMINATION_ROOM_EMAIL_MODE: 'enabled',
      EXAMINATION_EMAIL_FROM: 'Due Diligence <support@duediligence.ph>',
      RESEND_API_KEY: 'test-only-resend-key',
    });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.data.invitationStatus, 'suppressed');
    assert.equal(
      body.data.assignmentUrl,
      `${origin}/?assignment=${encodeURIComponent(assignmentToken)}#examiner-review`,
    );
    assert.equal(providerCalls, 0);
    assert.equal(deliveryRecorded.p_target_type, 'examiner_invitation');
    assert.equal(deliveryRecorded.p_target_id, assignmentId);
    assert.equal(deliveryRecorded.p_status, 'suppressed');
    assert.equal(deliveryRecorded.p_provider_id, null);
    assert.equal(deliveryRecorded.p_safe_error_code, 'practice_exam_email_removed');
  });
});

test('examination query rejects a missing authenticated session before database access', async () => {
  await withFetchMock(async (url) => {
    if (String(url).endsWith('/auth/v1/user')) {
      return Response.json({ message: 'invalid token' }, { status: 401 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }, async () => {
    const response = await worker.fetch(request('/examinations/query', {
      operation: 'catalog',
      track: 'per_subject',
    }, false), env);
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'AUTHENTICATION_REQUIRED');
  });
});

test('start attempt preserves server response and returns HTTP 201', async () => {
  await withFetchMock(async (url, options) => {
    const auth = authResponse(url);
    if (auth) return auth;
    const payload = JSON.parse(options.body);
    if (String(url) === `${supabaseUrl}/rest/v1/rpc/examination_authorize_access`) {
      assert.equal(payload.p_user_id, userId);
      assert.equal(payload.p_track, null);
      assert.equal(payload.p_version_id, versionId);
      assert.equal(payload.p_attempt_id, null);
      assert.equal(payload.p_allow_historical, false);
      return Response.json({ allowed: true, basis: 'standard_access' });
    }
    assert.equal(String(url), `${supabaseUrl}/rest/v1/rpc/examination_command`);
    assert.equal(payload.p_operation, 'start_attempt');
    assert.equal(payload.p_payload.versionId, versionId);
    return Response.json({
      attempt: {
        attemptId,
        versionId,
        status: 'in_progress',
        timerMode: 'strict',
        remainingSeconds: 3600,
      },
      examination: { track: 'per_subject', questionCount: 1 },
      questions: [],
      resumed: false,
    });
  }, async () => {
    const response = await worker.fetch(request('/examinations/command', {
      operation: 'start_attempt',
      versionId,
      timerMode: 'strict',
      requestKey: 'start_1234567890abcdef',
      tabToken: 'tab-token-1234567890abcdef1234567890abcdef',
    }), env);
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.data.attempt.attemptId, attemptId);
    assert.equal(body.data.attempt.remainingSeconds, 3600);
  });
});

test('secure examiner assignment query does not require a student bearer token', async () => {
  await withFetchMock(async (url, options) => {
    assert.equal(String(url), `${supabaseUrl}/rest/v1/rpc/examination_query`);
    const payload = JSON.parse(options.body);
    assert.equal(payload.p_user_id, null);
    assert.equal(payload.p_operation, 'assignment');
    return Response.json({
      assignment: { assignmentId: 'ASSIGNMENT-TEST', status: 'pending' },
      questions: [],
    });
  }, async () => {
    const response = await worker.fetch(request('/examinations/query', {
      operation: 'assignment',
      assignmentToken: 'assignment-token-1234567890abcdef1234567890abcdef',
    }, false), env);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.assignment.status, 'pending');
  });
});

test('database access denials return safe HTTP 403 without SQL details', async () => {
  await withFetchMock(async (url) => {
    const auth = authResponse(url);
    if (auth) return auth;
    return Response.json({
      code: 'P0001',
      message: 'EXAM_BETA_ACCESS_REQUIRED: internal table detail must stay private',
    }, { status: 400 });
  }, async () => {
    const response = await worker.fetch(request('/examinations/query', {
      operation: 'catalog',
      track: 'bar_feels',
    }), env);
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.error.code, 'EXAM_BETA_ACCESS_REQUIRED');
    assert.doesNotMatch(body.error.message, /internal table detail/i);
  });
});

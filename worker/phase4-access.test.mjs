import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';
import {
  AccessValidationError,
  PHASE4_SUBJECTS,
  WITHHELD_MOCK_BAR_QUESTION_IDS,
  availableProtectedQuestionInventory,
  isProtectedQuestionWithheld,
  normalizeAccessSnapshot,
  normalizeRequestKey,
  publicQuestionFromRecord,
  protectedQuestionInventory,
  selectProtectedQuestion,
} from './access-core.mjs';
import questionBank from '../content/question-bank/website-upload.json' with { type: 'json' };
import sourceManifest from '../content/question-bank/verbatim-source-manifest.json' with { type: 'json' };

const origin = 'https://duediligence.ph';
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function accessSnapshot(overrides = {}) {
  return {
    allowed: true,
    basis: 'trial',
    termsRequired: false,
    role: 'student',
    trial: {
      startedAt: '2026-07-28T00:00:00Z',
      expiresAt: '2026-07-31T00:00:00Z',
      active: true,
    },
    freeGrades: { limit: 3, used: 0, remaining: 3 },
    freeBeta: { enabled: false, expiresAt: null, active: false },
    subscription: null,
    ...overrides,
  };
}

const env = {
  ALLOWED_ORIGIN: origin,
  PHASE4_ACCESS_ENFORCEMENT: 'true',
  BAR_QUESTION_PRACTICE_RANDOMIZATION_V2_ENABLED: 'true',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
};

test('embedded protected inventory preserves eight subjects and the released distribution', () => {
  const records = new Map(
    questionBank.records.map((row) => [String(row['Question ID']).trim(), row]),
  );
  const inventory = protectedQuestionInventory(records);
  assert.equal(Object.keys(inventory).length, 8);
  assert.deepEqual(
    Object.fromEntries(Object.entries(inventory).map(([subject, questions]) => [subject, questions.length])),
    {
      'Political Law': 100,
      'Labor Law': 100,
      'Civil Law': 100,
      'Taxation Law': 100,
      'Mercantile Law': 100,
      'Criminal Law': 100,
      'Remedial Law': 100,
      'Legal Ethics': 100,
    },
  );
});

test('user-visible inventory permanently excludes the two withheld Tax questions', () => {
  const records = new Map(
    questionBank.records.map((row) => [String(row['Question ID']).trim(), row]),
  );
  const inventory = availableProtectedQuestionInventory(records);
  assert.equal(Object.values(inventory).flat().length, 800,
    'Forecast Q&A projections must never enter the Simulator inventory');
  assert.equal(inventory['Taxation Law'].length, 100);
  const availableIds = new Set(Object.values(inventory).flat().map((question) => question.id));
  const certifiedIds = new Set(
    sourceManifest.records
      .filter((record) => record.status === 'source-certified')
      .map((record) => record.questionId),
  );
  const ownerApprovedOriginalIds = new Set(
    questionBank.records
      .map((record) => String(record['Question ID']).trim())
      .filter((questionId) => questionId.startsWith('DDQB-2026-Q')),
  );
  assert.equal(ownerApprovedOriginalIds.size, 482);
  assert.deepEqual(availableIds, new Set([...certifiedIds, ...ownerApprovedOriginalIds]));
  assert.deepEqual(
    [...WITHHELD_MOCK_BAR_QUESTION_IDS].sort(),
    sourceManifest.records
      .filter((record) => record.status !== 'source-certified')
      .map((record) => record.questionId)
      .sort(),
  );
  assert.equal(isProtectedQuestionWithheld('TAX-2019-Q10A'), true);
  assert.equal(isProtectedQuestionWithheld('TAX-2019-Q10B'), true);
  assert.equal(isProtectedQuestionWithheld('TAX-2019-Q09B'), false);
  for (const questionId of WITHHELD_MOCK_BAR_QUESTION_IDS) {
    assert.throws(
      () => selectProtectedQuestion(records, {
        subject: 'Taxation Law',
        questionId,
      }),
      (error) => error instanceof AccessValidationError && error.code === 'QUESTION_NOT_FOUND',
    );
  }
});

test('protected question response never includes answers, legal bases, or raw records', () => {
  const records = new Map(
    questionBank.records.map((row) => [String(row['Question ID']).trim(), row]),
  );
  const question = selectProtectedQuestion(records, {
    subject: 'Labor Law',
    random: () => 0,
  });
  assert.deepEqual(Object.keys(question).sort(), [
    'barYear', 'difficulty', 'id', 'prompt', 'questionNo', 'subject', 'topic',
  ]);
  assert.doesNotMatch(JSON.stringify(question), /Suggested Answer|Legal Basis|rawRecord/i);
});

test('protected question response preserves the exact source prompt', () => {
  const exactPrompt = 'Paragraph one:  repeated spaces before .45-caliber.\n\nParagraph two keeps punctuation ; and “quotation marks.”';
  const question = publicQuestionFromRecord({
    Subject: 'Criminal Law',
    'Question ID': 'EXACT-PROMPT-001',
    'Essay Question': exactPrompt,
  });
  assert.equal(question.prompt, exactPrompt);
});

test('request IDs and access snapshots are strictly normalized', () => {
  assert.equal(normalizeRequestKey('request_1234567890'), 'request_1234567890');
  assert.throws(() => normalizeRequestKey('short'), AccessValidationError);
  const normalized = normalizeAccessSnapshot(accessSnapshot({
    globalBeta: { enabled: true, eligible: true, active: true, expiresAt: null },
  }));
  assert.equal(normalized.allowed, true);
  assert.equal(normalized.freeGrades.remaining, 3);
  assert.deepEqual(normalized.globalBeta, {
    enabled: true,
    eligible: true,
    active: true,
    expiresAt: null,
  });
});

test('anonymous visitors cannot read a protected examination question', async () => {
  const response = await worker.fetch(new Request('https://worker.example/exam/question', {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'X-Request-ID': 'request_1234567890',
    },
    body: JSON.stringify({
      subject: 'Labor Law',
      requestId: 'request_1234567890',
    }),
  }), env);
  const payload = await response.json();
  assert.equal(response.status, 401);
  assert.equal(payload.error.code, 'AUTHENTICATION_REQUIRED');
});

test('authenticated entitled exam opening never creates an explicit commercial choice', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (target.endsWith('/rest/v1/rpc/phase4_access_snapshot')) {
      const body = JSON.parse(init.body);
      assert.equal(body.p_user_id, userId);
      // The legacy question route retains its historical activation hint. The
      // soft-launch resolver ignores it because introductory tokens are seeded server-side.
      assert.equal(body.p_activate_trial, true);
      assert.equal(body.p_request_key, 'request_1234567890');
      return Response.json(accessSnapshot());
    }
    if (target.endsWith('/rest/v1/rpc/select_feature_question_v2')) {
      const body = JSON.parse(init.body);
      assert.equal(body.p_user_id, userId);
      assert.equal(body.p_feature_key, 'bar_question_practice');
      assert.equal(body.p_subject, 'Labor Law');
      assert.equal(body.p_request_key, 'request_1234567890');
      assert.equal(body.p_candidate_question_ids.length, 100);
      assert.equal(new Set(body.p_candidate_question_ids).size, 100);
      assert.deepEqual(body.p_soft_exclude_question_ids, []);
      return Response.json({
        questionId: body.p_candidate_question_ids[0],
        answeredCount: 0,
        unansweredCount: 100,
        remainingUnissued: 99,
        cycleNumber: 1,
        issuanceId: '11111111-1111-4111-8111-111111111111',
        issuanceExpiresAt: '2026-09-01T00:00:00.000Z',
        exhausted: false,
      });
    }
    throw new Error(`Unexpected request: ${target}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example/exam/question', {
      method: 'POST',
      headers: {
        Origin: origin,
        Authorization: 'Bearer verified-token',
        'Content-Type': 'application/json',
        'X-Request-ID': 'request_1234567890',
      },
      body: JSON.stringify({
        subject: 'Labor Law',
        requestId: 'request_1234567890',
      }),
    }), env);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.question.subject, 'Labor Law');
    assert.equal(typeof payload.question.prompt, 'string');
    assert.ok(payload.question.prompt.length > 50);
    assert.deepEqual(payload.inventory, {
      subjects: 8,
      questionsPerSubject: 100,
      totalQuestions: 800,
      canonicalQuestionsPerSubject: 100,
      canonicalTotalQuestions: 800,
    });
    assert.deepEqual(payload.rotation, {
      feature: 'bar_question_practice',
      answeredCount: 0,
      unansweredCount: 100,
      remainingUnissued: 99,
      cycleNumber: 1,
      issuanceId: '11111111-1111-4111-8111-111111111111',
      issuanceExpiresAt: '2026-09-01T00:00:00.000Z',
    });
    assert.doesNotMatch(JSON.stringify(payload.question), /model|suggested|legalBasis|sourceUrl/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an explicit visible Practice question is issued through the lifetime selector', async () => {
  const questionId = String(
    questionBank.records.find((row) => row.Subject === 'Labor Law')['Question ID'],
  ).trim();
  const issuanceId = '22222222-2222-4222-8222-222222222222';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (target.endsWith('/rest/v1/rpc/phase4_access_snapshot')) {
      return Response.json(accessSnapshot());
    }
    if (target.endsWith('/rest/v1/rpc/select_feature_question_v2')) {
      const body = JSON.parse(init.body);
      assert.deepEqual(body.p_candidate_question_ids, [questionId]);
      assert.deepEqual(body.p_soft_exclude_question_ids, []);
      assert.equal(body.p_feature_key, 'bar_question_practice');
      assert.equal(body.p_user_id, userId);
      return Response.json({
        questionId,
        answeredCount: 0,
        unansweredCount: 1,
        remainingUnissued: 0,
        cycleNumber: 1,
        issuanceId,
        issuanceExpiresAt: '2026-09-01T00:00:00.000Z',
        exhausted: false,
      });
    }
    throw new Error(`Unexpected request: ${target}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example/exam/question', {
      method: 'POST',
      headers: {
        Origin: origin,
        Authorization: 'Bearer verified-token',
        'Content-Type': 'application/json',
        'X-Request-ID': 'request_explicit_new_0001',
      },
      body: JSON.stringify({
        subject: 'Labor Law',
        questionId,
        requestId: 'request_explicit_new_0001',
      }),
    }), env);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.question.id, questionId);
    assert.equal(payload.rotation.issuanceId, issuanceId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an owner-bound unanswered issuance restores without creating a new selection', async () => {
  const questionId = String(
    questionBank.records.find((row) => row.Subject === 'Labor Law')['Question ID'],
  ).trim();
  const issuanceId = '33333333-3333-4333-8333-333333333333';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (target.endsWith('/rest/v1/rpc/phase4_access_snapshot')) {
      return Response.json(accessSnapshot());
    }
    if (target.endsWith('/rest/v1/rpc/feature_question_restore_authorized_v2')) {
      const body = JSON.parse(init.body);
      assert.equal(body.p_user_id, userId);
      assert.equal(body.p_question_id, questionId);
      assert.equal(body.p_issuance_id, issuanceId);
      return Response.json(true);
    }
    if (target.endsWith('/rest/v1/rpc/select_feature_question_v2')) {
      throw new Error('A valid existing issuance must not create a replacement selection.');
    }
    throw new Error(`Unexpected request: ${target}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example/exam/question', {
      method: 'POST',
      headers: {
        Origin: origin,
        Authorization: 'Bearer verified-token',
        'Content-Type': 'application/json',
        'X-Request-ID': 'request_explicit_restore_0001',
      },
      body: JSON.stringify({
        subject: 'Labor Law',
        questionId,
        issuanceId,
        requestId: 'request_explicit_restore_0001',
      }),
    }), env);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.question.id, questionId);
    assert.equal(payload.rotation, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a stale issuance cannot restore a Practice question after its answer is saved', async () => {
  const questionId = String(
    questionBank.records.find((row) => row.Subject === 'Labor Law')['Question ID'],
  ).trim();
  const issuanceId = '44444444-4444-4444-8444-444444444444';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (target.endsWith('/rest/v1/rpc/phase4_access_snapshot')) {
      return Response.json(accessSnapshot());
    }
    if (target.endsWith('/rest/v1/rpc/feature_question_restore_authorized_v2')) {
      const body = JSON.parse(init.body);
      assert.equal(body.p_user_id, userId);
      assert.equal(body.p_question_id, questionId);
      assert.equal(body.p_issuance_id, issuanceId);
      return Response.json(false);
    }
    if (target.endsWith('/rest/v1/rpc/select_feature_question_v2')) {
      const body = JSON.parse(init.body);
      assert.deepEqual(body.p_candidate_question_ids, [questionId]);
      return Response.json({
        questionId: null,
        answeredCount: 1,
        unansweredCount: 0,
        remainingUnissued: 0,
        cycleNumber: 1,
        exhausted: true,
      });
    }
    throw new Error(`Unexpected request: ${target}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example/exam/question', {
      method: 'POST',
      headers: {
        Origin: origin,
        Authorization: 'Bearer verified-token',
        'Content-Type': 'application/json',
        'X-Request-ID': 'request_stale_issuance_0001',
      },
      body: JSON.stringify({
        subject: 'Labor Law',
        questionId,
        issuanceId,
        requestId: 'request_stale_issuance_0001',
      }),
    }), env);
    const payload = await response.json();
    assert.equal(response.status, 409);
    assert.equal(payload.error.code, 'QUESTION_ALREADY_ANSWERED');
    assert.equal(payload.question, undefined);
    assert.doesNotMatch(JSON.stringify(payload), /Essay Question|Suggested Answer|Legal Basis/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an explicit answered Practice question is rejected without leaking its prompt', async () => {
  const questionId = String(
    questionBank.records.find((row) => row.Subject === 'Labor Law')['Question ID'],
  ).trim();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (target.endsWith('/rest/v1/rpc/phase4_access_snapshot')) {
      return Response.json(accessSnapshot());
    }
    if (target.endsWith('/rest/v1/rpc/select_feature_question_v2')) {
      return Response.json({
        questionId: null,
        answeredCount: 1,
        unansweredCount: 0,
        remainingUnissued: 0,
        cycleNumber: 1,
        exhausted: true,
      });
    }
    throw new Error(`Unexpected request: ${target}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example/exam/question', {
      method: 'POST',
      headers: {
        Origin: origin,
        Authorization: 'Bearer verified-token',
        'Content-Type': 'application/json',
        'X-Request-ID': 'request_explicit_answered_0001',
      },
      body: JSON.stringify({
        subject: 'Labor Law',
        questionId,
        requestId: 'request_explicit_answered_0001',
      }),
    }), env);
    const payload = await response.json();
    assert.equal(response.status, 409);
    assert.equal(payload.error.code, 'QUESTION_ALREADY_ANSWERED');
    assert.equal(payload.question, undefined);
    assert.doesNotMatch(JSON.stringify(payload), /Essay Question|Suggested Answer|Legal Basis/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the Bar Question Practice randomizer is a no-op while its rollout flag is off', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (target.endsWith('/rest/v1/rpc/phase4_access_snapshot')) {
      return Response.json(accessSnapshot());
    }
    if (target.includes('/rest/v1/rpc/select_feature_question_')) {
      throw new Error('The disabled rollout must not call a rotation RPC.');
    }
    throw new Error(`Unexpected request: ${target}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example/exam/question', {
      method: 'POST',
      headers: {
        Origin: origin,
        Authorization: 'Bearer verified-token',
        'Content-Type': 'application/json',
        'X-Request-ID': 'request_flag_off_0001',
      },
      body: JSON.stringify({
        subject: 'Labor Law',
        requestId: 'request_flag_off_0001',
      }),
    }), {
      ...env,
      BAR_QUESTION_PRACTICE_RANDOMIZATION_V2_ENABLED: 'false',
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.rotation, undefined);
    assert.deepEqual(payload.inventory, {
      subjects: 8,
      questionsPerSubject: 100,
      totalQuestions: 800,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an exhausted Practice subject returns a terminal response without recycling', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (target.endsWith('/rest/v1/rpc/phase4_access_snapshot')) {
      return Response.json(accessSnapshot());
    }
    if (target.endsWith('/rest/v1/rpc/select_feature_question_v2')) {
      return Response.json({
        questionId: null,
        answeredCount: 96,
        unansweredCount: 0,
        remainingUnissued: 0,
        cycleNumber: 1,
        exhausted: true,
      });
    }
    throw new Error(`Unexpected request: ${target}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example/exam/question', {
      method: 'POST',
      headers: {
        Origin: origin,
        Authorization: 'Bearer verified-token',
        'Content-Type': 'application/json',
        'X-Request-ID': 'request_exhausted_0001',
      },
      body: JSON.stringify({
        subject: 'Labor Law',
        requestId: 'request_exhausted_0001',
      }),
    }), env);
    const payload = await response.json();
    assert.equal(response.status, 409);
    assert.equal(payload.error.code, 'QUESTION_POOL_COMPLETED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('authenticated access endpoint does not start a trial', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (target.endsWith('/rest/v1/rpc/phase4_access_snapshot')) {
      const body = JSON.parse(init.body);
      assert.equal(body.p_user_id, userId);
      assert.equal(body.p_activate_trial, false);
      assert.equal(body.p_request_key, null);
      return Response.json(accessSnapshot());
    }
    if (target.endsWith('/rest/v1/rpc/phase4_user_subscription_status')) {
      const body = JSON.parse(init.body);
      assert.equal(body.p_user_id, userId);
      return Response.json({
        subscription: null,
        pendingPayment: null,
      });
    }
    throw new Error(`Unexpected request: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/access', {
      method: 'POST',
      headers: { Origin: origin, Authorization: 'Bearer verified-token' },
    }), env);
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an authenticated zero-credit user is denied before question-bank, attempt, or Gemini work', async () => {
  const originalFetch = globalThis.fetch;
  let reservationCalls = 0;
  let questionBankCalls = 0;
  let attemptCalls = 0;
  let geminiCalls = 0;

  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (target.endsWith('/rest/v1/rpc/phase4_reserve_grade_v2')) {
      reservationCalls += 1;
      const body = JSON.parse(init.body);
      assert.equal(body.p_user_id, userId);
      assert.equal(body.p_question_bank_id, 'LAB-001');
      return Response.json(accessSnapshot({
        allowed: false,
        basis: 'trial_tokens_exhausted',
        accessMode: 'introductory',
        tokenLimit: 5,
        tokensUsed: 5,
        tokensReserved: 0,
        tokensRemaining: 0,
        trial: {
          startedAt: '2026-08-01T00:00:00Z',
          expiresAt: '2026-09-01T15:59:59Z',
          active: true,
          program: 'commercial_launch_2026',
        },
        freeGrades: { limit: 5, used: 5, remaining: 0 },
      }));
    }
    if (target.includes('/content/question-bank/') || target.includes('output=csv')) {
      questionBankCalls += 1;
    }
    if (target.includes('/rest/v1/rpc/phase4_prepare_exam_attempt_v2')) {
      attemptCalls += 1;
    }
    if (target.includes('generativelanguage.googleapis.com')) {
      geminiCalls += 1;
    }
    throw new Error(`Unexpected request: ${target}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example/', {
      method: 'POST',
      headers: {
        Origin: origin,
        Authorization: 'Bearer verified-token',
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '192.0.2.210',
        'X-Request-ID': 'zero_credit_request_20260731',
      },
      body: JSON.stringify({
        questionId: 'LAB-001',
        studentAnswer: 'No. The claim fails because the governing Labor Code rule is not satisfied by these facts.',
        session: {
          mode: 'selfPaced',
          elapsedSeconds: 90,
          submissionReason: 'manual',
          expired: false,
        },
      }),
    }), {
      ...env,
      PHASE4_ACCESS_ENFORCEMENT: 'true',
      REQUIRE_AUTHENTICATED_SUBMISSIONS: 'true',
      GEMINI_API_KEY: 'test-only-placeholder',
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error.code, 'INTRODUCTORY_TOKENS_EXHAUSTED');
    assert.equal(reservationCalls, 1);
    assert.equal(questionBankCalls, 0);
    assert.equal(attemptCalls, 0);
    assert.equal(geminiCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

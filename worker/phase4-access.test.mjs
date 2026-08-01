import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';
import {
  AccessValidationError,
  normalizeAccessSnapshot,
  normalizeRequestKey,
  publicQuestionFromRecord,
  protectedQuestionInventory,
  selectProtectedQuestion,
} from './access-core.mjs';
import questionBank from '../content/question-bank/website-upload.json' with { type: 'json' };

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
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
};

test('embedded protected inventory preserves eight subjects and forty questions each', () => {
  const records = new Map(
    questionBank.records.map((row) => [String(row['Question ID']).trim(), row]),
  );
  const inventory = protectedQuestionInventory(records);
  assert.equal(Object.keys(inventory).length, 8);
  for (const questions of Object.values(inventory)) assert.equal(questions.length, 40);
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
  const normalized = normalizeAccessSnapshot(accessSnapshot());
  assert.equal(normalized.allowed, true);
  assert.equal(normalized.freeGrades.remaining, 3);
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

test('authenticated exam opening activates access and returns only one protected prompt', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (target.endsWith('/rest/v1/rpc/phase4_access_snapshot')) {
      const body = JSON.parse(init.body);
      assert.equal(body.p_user_id, userId);
      assert.equal(body.p_activate_trial, true);
      assert.equal(body.p_request_key, 'request_1234567890');
      return Response.json(accessSnapshot());
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
      questionsPerSubject: 40,
      totalQuestions: 320,
    });
    assert.doesNotMatch(JSON.stringify(payload.question), /model|suggested|legalBasis|sourceUrl/i);
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
        basis: 'none',
        trial: {
          startedAt: '2026-07-01T00:00:00Z',
          expiresAt: '2026-07-02T00:00:00Z',
          active: false,
        },
        freeGrades: { limit: 3, used: 3, remaining: 0 },
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
    assert.equal(payload.error.code, 'ACCESS_REQUIRED');
    assert.equal(reservationCalls, 1);
    assert.equal(questionBankCalls, 0);
    assert.equal(attemptCalls, 0);
    assert.equal(geminiCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

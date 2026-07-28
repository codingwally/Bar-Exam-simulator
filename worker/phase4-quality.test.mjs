import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';
import {
  modelAnswerQualityIssues,
  questionFromBankRow,
} from './examiner-core.mjs';
import questionBank from '../content/question-bank/website-upload.json' with { type: 'json' };

const origin = 'https://duediligence.ph';
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const reservationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const attemptId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const laborRow = questionBank.records.find((row) => row['Question ID'] === 'LAB-001');
const context = questionFromBankRow(laborRow);

function accessSnapshot() {
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
  };
}

function examinerResult(overrides = {}) {
  return {
    score: 4.2,
    maxScore: 5,
    percentagePointValue: 4.2,
    tier: '4.0',
    performanceLabel: 'Strong answer',
    assessmentType: 'question_bank',
    label: 'Question-bank assessment',
    rationale: 'The answer states the correct result, controlling doctrine, and applies the decisive facts with only minor room for additional nuance.',
    strengths: ['Direct answer', 'Correct doctrine', 'Fact-specific application'],
    errors: [],
    improvements: ['State expressly that the reasonable-person test is objective.'],
    legalExplanation: 'Constructive dismissal protects an employee when the employer makes continued work objectively intolerable.',
    modelAnswerALAC: {
      answer: 'Yes. A was constructively dismissed because the resignation was not genuinely voluntary.',
      legalBasis: 'The Labor Code protects security of tenure. Under Bartolome v. Toyota Quezon Avenue, Inc., constructive dismissal exists when continued employment becomes impossible, unreasonable, or unlikely, or when an employer’s discrimination, insensibility, or disdain becomes unbearable to a reasonable employee.',
      application: 'The company president began repeatedly humiliating A in front of her co-employees only after A accidentally sideswiped his vehicle. That targeted public humiliation, its repetition, and A’s resulting trauma are concrete circumstances showing that a reasonable employee would feel compelled to leave. Her immediate constructive-dismissal complaint further supports that the resignation responded to the intolerable treatment rather than a voluntary desire to end employment.',
      conclusion: 'Therefore, A’s resignation is treated as a constructive dismissal.',
    },
    sources: [],
    sourceStatus: 'stored',
    reviewRequired: false,
    rubricVersion: 'SC-2025-BB4-PER-QUESTION-v1',
    ...overrides,
  };
}

function phase4Env() {
  return {
    ALLOWED_ORIGIN: origin,
    PHASE4_ACCESS_ENFORCEMENT: 'true',
    PHASE4_MODEL_QUALITY_ENFORCEMENT: 'true',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
    GEMINI_API_KEY: 'test-gemini-key',
    GEMINI_MODEL: 'gemini-test',
    GEMINI_GROUNDING_ENABLED: 'false',
  };
}

function gradingRequest(requestId, studentAnswer = laborRow['Suggested Answer']) {
  return new Request('https://worker.example/', {
    method: 'POST',
    headers: {
      Origin: origin,
      Authorization: 'Bearer verified-session',
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
      'CF-Connecting-IP': '192.0.2.44',
    },
    body: JSON.stringify({
      questionId: 'LAB-001',
      studentAnswer,
    }),
  });
}

test('stored bank records expose multiple trusted authorities without accepting arbitrary sources', () => {
  assert.ok(context.sourceUrls.length >= 2);
  assert.ok(context.sourceUrls.some((source) => source.url.includes('sc.judiciary.gov.ph')));
  assert.ok(context.sourceUrls.some((source) => source.url.includes('elibrary.judiciary.gov.ph')));
  assert.ok(context.sourceUrls.some((source) => source.authority === 'Supreme Court E-Library'));
  assert.ok(context.sourceUrls.some((source) => source.reference.includes('G.R. No.')));
  assert.equal(context.sourceUrls.some((source) => source.url.includes('facebook.com')), false);
  assert.equal(context.sourceUrls.some((source) => source.url.includes('studocu.com')), false);
});

test('short and generic ALAC model answers trigger the controlled quality repair gate', () => {
  const issues = modelAnswerQualityIssues({
    modelAnswerALAC: {
      answer: 'Yes.',
      legalBasis: 'The law applies.',
      application: 'Here, the facts satisfy the rule.',
      conclusion: 'Therefore, yes.',
    },
  }, context);
  assert.ok(issues.length >= 4);
  assert.equal(modelAnswerQualityIssues(examinerResult(), context).length, 0);
});

test('Phase 4 grading preserves decimal score, rich ALAC, and trusted sources transactionally', async () => {
  const originalFetch = globalThis.fetch;
  const operations = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (target.endsWith('/rest/v1/rpc/phase4_reserve_grade_v2')) {
      operations.push('reserve');
      return Response.json({
        ...accessSnapshot(),
        reservationId,
        status: 'reserved',
        replayed: false,
      });
    }
    if (target.endsWith('/rest/v1/rpc/phase4_prepare_exam_attempt_v2')) {
      const body = JSON.parse(init.body);
      assert.equal(body.p_answer_text, laborRow['Suggested Answer']);
      operations.push('preserve');
      return Response.json({ attemptId, status: 'grading' });
    }
    if (target.endsWith('/rest/v1/rpc/phase4_finalize_exam_grade')) {
      const body = JSON.parse(init.body);
      assert.equal(body.p_score, 4.2);
      assert.equal(body.p_attempt_id, attemptId);
      operations.push('finalize');
      return Response.json({ completed: true, used: 1, remaining: 2 });
    }
    if (target.includes('generativelanguage.googleapis.com')) {
      operations.push('gemini');
      return Response.json({
        candidates: [{
          content: { parts: [{ text: JSON.stringify(examinerResult()) }] },
        }],
      });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };

  try {
    const response = await worker.fetch(
      gradingRequest('phase4_quality_success_0001'),
      phase4Env(),
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.assessment.score, 4.2);
    assert.equal(payload.assessment.maxScore, 5);
    assert.equal(payload.assessment.sources.length >= 2, true);
    assert.match(payload.assessment.educationalNotice, /not independently verified/i);
    assert.equal(payload.assessment.humanVerified, false);
    assert.deepEqual(operations, ['reserve', 'preserve', 'gemini', 'finalize']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an incomplete model answer receives exactly one controlled repair call', async () => {
  const originalFetch = globalThis.fetch;
  let geminiCalls = 0;
  let finalized = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (target.endsWith('/rest/v1/rpc/phase4_reserve_grade_v2')) {
      return Response.json({
        ...accessSnapshot(),
        reservationId,
        status: 'reserved',
        replayed: false,
      });
    }
    if (target.endsWith('/rest/v1/rpc/phase4_prepare_exam_attempt_v2')) {
      return Response.json({ attemptId, status: 'grading' });
    }
    if (target.endsWith('/rest/v1/rpc/phase4_finalize_exam_grade')) {
      finalized += 1;
      return Response.json({ completed: true, used: 1, remaining: 2 });
    }
    if (target.includes('generativelanguage.googleapis.com')) {
      geminiCalls += 1;
      const result = geminiCalls === 1
        ? examinerResult({
          modelAnswerALAC: {
            answer: 'Yes.',
            legalBasis: 'The law applies.',
            application: 'Here, the facts satisfy the rule.',
            conclusion: 'Therefore, yes.',
          },
        })
        : examinerResult();
      return Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }],
      });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };

  try {
    const response = await worker.fetch(
      gradingRequest(
        'phase4_quality_repair_0003',
        `${laborRow['Suggested Answer']}\nThe objective reasonable-person test confirms the result.`,
      ),
      phase4Env(),
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.assessment.score, 4.2);
    assert.equal(geminiCalls, 2);
    assert.equal(finalized, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider capacity preserves the answer, releases the grade, and returns controlled JSON', async () => {
  const originalFetch = globalThis.fetch;
  const operations = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) return Response.json({ id: userId });
    if (target.endsWith('/rest/v1/rpc/phase4_reserve_grade_v2')) {
      operations.push('reserve');
      return Response.json({
        ...accessSnapshot(),
        reservationId,
        status: 'reserved',
        replayed: false,
      });
    }
    if (target.endsWith('/rest/v1/rpc/phase4_prepare_exam_attempt_v2')) {
      operations.push('preserve');
      return Response.json({ attemptId, status: 'grading' });
    }
    if (target.endsWith('/rest/v1/rpc/phase4_mark_exam_capacity')) {
      const body = JSON.parse(init.body);
      assert.equal(body.p_attempt_id, attemptId);
      assert.equal(body.p_category, 'rate_limit');
      operations.push('capacity');
      return Response.json(null);
    }
    if (target.endsWith('/rest/v1/rpc/phase4_release_grade')) {
      const body = JSON.parse(init.body);
      assert.equal(body.p_reason, 'provider_rate_limit');
      operations.push('release');
      return Response.json(null);
    }
    if (target.includes('generativelanguage.googleapis.com')) {
      return Response.json(
        { error: { status: 'RESOURCE_EXHAUSTED', message: 'quota unavailable' } },
        { status: 429 },
      );
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };

  try {
    const response = await worker.fetch(
      gradingRequest(
        'phase4_quality_capacity_0002',
        `${laborRow['Suggested Answer']}\nAdditional preserved retry text.`,
      ),
      phase4Env(),
    );
    const payload = await response.json();
    assert.equal(response.status, 503);
    assert.equal(payload.error.code, 'AI_GRADING_CAPACITY');
    assert.equal(payload.error.pendingAttemptId, attemptId);
    assert.equal(payload.error.retryAfterHours, 12);
    assert.match(payload.error.message, /no attempt was consumed/i);
    assert.deepEqual(operations, ['reserve', 'preserve', 'capacity', 'release']);
    assert.doesNotMatch(JSON.stringify(payload), /test-service-role|test-gemini-key/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

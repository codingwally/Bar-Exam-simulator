import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';
import {
  RUBRIC_VERSION,
  applyDeterministicScoreCap,
  assessmentPolicy,
  scoreIsValid,
  validateExaminerResult,
} from './examiner-core.mjs';
import {
  CORRECTION_TYPES,
  CorrectionValidationError,
  correctionInsertRecord,
  normalizeCorrectionRequest,
} from './correction-core.mjs';
import {
  GUEST_GRADE_LIMIT,
  deriveGuestHashes,
  normalizeUserAgent,
  requireGuestHeaders,
} from './guest-access-core.mjs';
import {
  SupportValidationError,
  normalizeSupportRequest,
  supportInsertRecord,
} from './support-core.mjs';

const remedialContext = {
  subject: 'Remedial Law',
  question: 'Counsel allowed a nonlawyer employee to prepare an appellate brief, sign counsel’s name, and file it before counsel reviewed it. Was the delegation proper?',
  suggestedAnswer: 'No. The delegation was improper because a lawyer must personally supervise legal work and cannot permit a nonlawyer to exercise professional judgment or sign pleadings in the lawyer’s name.',
  legalBasis: 'Canons II and IV of the Code of Professional Responsibility and Accountability; Rebarter v. Villa.',
  sourceUrl: 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/68904',
  authority: 'legacy_client_context',
};

function modelAssessment(score = 5) {
  return {
    score,
    maxScore: 5,
    percentagePointValue: score,
    tier: '5.0',
    performanceLabel: 'Excellent answer',
    assessmentType: 'question_bank',
    label: 'Question-bank assessment',
    rationale: 'The answer reaches the expected result.',
    strengths: ['Direct conclusion'],
    errors: [],
    improvements: [],
    legalExplanation: 'A lawyer must personally supervise delegated legal work.',
    modelAnswerALAC: {
      answer: 'No. The delegation was improper.',
      legalBasis: 'Canons II and IV of the CPRA require personal supervision of legal work.',
      application: 'Sandro prepared, signed, and filed the brief before Cassandra reviewed it.',
      conclusion: 'Therefore, Cassandra improperly delegated professional legal work.',
    },
    sources: [],
    sourceStatus: 'stored',
    reviewRequired: false,
    rubricVersion: RUBRIC_VERSION,
  };
}

function capped(answer, score = 5) {
  return applyDeterministicScoreCap(modelAssessment(score), answer, remedialContext);
}

test('scores accept 0.0–5.0 with at most one decimal place', () => {
  for (const score of [0, 0.1, 1.2, 2.7, 3.7, 3.8, 4.2, 4.6, 5]) {
    assert.equal(scoreIsValid(score), true, `${score} should be valid`);
  }
  for (const score of [-0.1, 3.75, 5.1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(scoreIsValid(score), false, `${score} should be invalid`);
  }
});

test('model scores with excess precision are safely rounded before return', () => {
  const result = validateExaminerResult(
    modelAssessment(3.75),
    assessmentPolicy(remedialContext),
  );
  assert.equal(result.score, 3.8);
  assert.equal(result.percentagePointValue, 3.8);
});

test('target decimal scores 3.8 and 4.2 are preserved exactly', () => {
  for (const score of [3.8, 4.2]) {
    const result = validateExaminerResult(
      modelAssessment(score),
      assessmentPolicy(remedialContext),
    );
    assert.equal(result.score, score);
    assert.equal(result.percentagePointValue, score);
  }
});

test('REM-2024-Q18 bare no answer cannot exceed 1.0', () => {
  const result = capped('no');
  assert.equal(result.score, 1);
  assert.equal(result.percentagePointValue, 1);
  assert.equal(result.tier, '1.0');
  assert.equal(result.performanceLabel, 'Weak answer');
  assert.match(result.errors.join(' '), /bare conclusion/i);
});

test('an Answer heading does not let a bare conclusion evade the 1.0 cap', () => {
  assert.equal(capped('Answer: No.').score, 1);
});

test('irrelevant or nonsensical content cannot exceed 0.5', () => {
  const irrelevant = capped('Bananas and bicycles float through purple weather.');
  const nonsensical = capped('aaaaaaaaaaaaaaaa');
  assert.equal(irrelevant.score, 0.5);
  assert.equal(nonsensical.score, 0.5);
});

test('correct conclusion without legal basis cannot exceed 1.5', () => {
  const result = capped('No. Cassandra acted improperly by delegating the brief to Sandro.');
  assert.equal(result.score, 1.5);
  assert.match(result.errors.join(' '), /without legal basis or application/i);
});

test('generic legal basis without factual application cannot exceed 2.5', () => {
  const result = capped('No. Under the applicable law and governing rule, the delegation was improper.');
  assert.equal(result.score, 2.5);
  assert.match(result.errors.join(' '), /does not meaningfully apply/i);
});

test('legal basis with some application but incomplete ALAC cannot exceed 3.5', () => {
  const result = capped(
    'No. Under Canons II and IV of the CPRA, a lawyer must supervise delegated legal work. Here, Sandro prepared the appellate brief, signed Cassandra’s name, and filed it before Cassandra reviewed the filing.',
  );
  assert.equal(result.score, 3.5);
});

test('a complete, substantially aligned ALAC answer may retain 4.0–5.0', () => {
  const answer = [
    'Answer: No. The delegation was improper.',
    'Legal Basis: Under Canons II and IV of the CPRA and Rebarter v. Villa, a lawyer must personally supervise legal work and may not allow a nonlawyer to exercise professional judgment or sign counsel’s name.',
    'Application: Sandro prepared the appellate brief, signed Cassandra’s name, and filed it before Cassandra reviewed it. Her intended post-filing review did not provide the required prior supervision.',
    'Conclusion: Cassandra improperly delegated professional legal work.',
  ].join('\n\n');
  assert.equal(capped(answer, 3.8).score, 3.8);
  assert.equal(capped(answer, 4.2).score, 4.2);
  assert.equal(capped(answer, 4.6).score, 4.6);
  assert.equal(capped(answer, 5).score, 5);
});

test('compact single-line ALAC headings may retain decimal scores above 3.5', () => {
  const answer = 'Answer: No. The delegation was improper. Legal Basis: Under Canons II and IV of the CPRA and Rebarter v. Villa, a lawyer must personally supervise legal work and may not allow a nonlawyer to exercise professional judgment or sign counsel’s name. Application: Sandro prepared the appellate brief, signed Cassandra’s name, and filed it before Cassandra reviewed it, so the required prior supervision was absent. Conclusion: Cassandra improperly delegated professional legal work.';
  assert.equal(capped(answer, 3.8).score, 3.8);
  assert.equal(capped(answer, 4.2).score, 4.2);
});

test('Worker applies the cap after Gemini returns a high score', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/rest/v1/rpc/reserve_guest_grade')) {
      return Response.json({
        allowed: true,
        reservation_id: '11111111-1111-4111-8111-111111111111',
        remaining: 2,
        consumed: 0,
      });
    }
    if (target.endsWith('/rest/v1/rpc/finalize_guest_grade')) {
      return Response.json({ allowed: true, remaining: 2, consumed: 1 });
    }
    if (!target.includes('generativelanguage.googleapis.com')) {
      throw new Error(`Unexpected request: ${target}`);
    }
    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: JSON.stringify(modelAssessment(5)) }] },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const request = new Request('https://worker.example/', {
      method: 'POST',
      headers: {
        Origin: 'https://duediligence.ph',
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '192.0.2.91',
        'User-Agent': 'TestBrowser/1.0',
        'X-Guest-Device-ID': 'device_test_1234567890_1234567890',
        'X-Request-ID': 'request_test_1234567890',
      },
      body: JSON.stringify({
        questionId: 'REM-2024-Q18',
        studentAnswer: 'no',
        questionContext: remedialContext,
      }),
    });
    const response = await worker.fetch(request, {
      ALLOWED_ORIGIN: 'https://duediligence.ph',
      GEMINI_API_KEY: 'test-only-placeholder',
      GEMINI_MODEL: 'gemini-3.5-flash-lite',
      GEMINI_GROUNDING_ENABLED: 'false',
      GUEST_USAGE_HMAC_KEY: 'test-only-guest-hmac-key',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.assessment.score, 1);
    assert.equal(body.assessment.percentagePointValue, 1);
    assert.equal(body.assessment.tier, '1.0');
    assert.equal(body.assessment.performanceLabel, 'Weak answer');
    assert.match(body.assessment.errors.join(' '), /bare conclusion/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const reliabilityOrigin = 'https://duediligence.ph';
const reliabilityBankUrl = `${reliabilityOrigin}/content/question-bank/website-upload.json`;
const reliabilityAnswer = [
  'Answer: Yes. The claim succeeds.',
  'Legal Basis: Article 1174 of the Civil Code governs fortuitous events.',
  'Application: The fortuitous event in the question prevented performance and satisfies the governing rule.',
  'Conclusion: Therefore, the claim succeeds.',
].join('\n\n');
let reliabilityRequestCounter = 0;

function reliabilityBankRecord(index) {
  return {
    'Question ID': index === 0 ? 'CIV-2024-Q01' : `TEST-${String(index).padStart(3, '0')}`,
    Subject: 'Civil Law',
    'Essay Question': index === 0
      ? 'Did a fortuitous event prevent performance and allow the claim to succeed?'
      : `Question ${index}`,
    'Suggested Answer': reliabilityAnswer,
    'Legal Basis / Provision': 'Civil Code, Article 1174',
    'Jurisprudence / Case': 'Virginia Real v. Belo',
    'Citation / G.R. No.': 'G.R. No. 146224',
    'Source URL': 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/40783',
  };
}

function reliabilityModelResult() {
  return {
    ...modelAssessment(4),
    tier: '4.0',
    performanceLabel: 'Strong answer',
    rationale: 'The answer states the rule and applies it to the facts.',
    strengths: ['Direct answer'],
    improvements: ['Add more factual detail'],
    legalExplanation: 'Article 1174 governs fortuitous events.',
    modelAnswerALAC: {
      answer: 'Yes.',
      legalBasis: 'Article 1174 of the Civil Code applies.',
      application: 'The stated facts satisfy the rule.',
      conclusion: 'Therefore, the claim succeeds.',
    },
  };
}

function reliabilityGradingRequest() {
  reliabilityRequestCounter += 1;
  return new Request('https://worker.example', {
    method: 'POST',
    headers: {
      Origin: reliabilityOrigin,
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.10',
      'User-Agent': 'TestBrowser/1.0',
      'X-Guest-Device-ID': 'device_reliability_123456789012345',
      'X-Request-ID': `request_reliability_${String(reliabilityRequestCounter).padStart(4, '0')}`,
    },
    body: JSON.stringify({
      questionId: 'CIV-2024-Q01',
      studentAnswer: reliabilityAnswer,
    }),
  });
}

test('transient Gemini failures are retried and do not lock a failed submission', async () => {
  const originalFetch = globalThis.fetch;
  let providerMode = 'fail';
  let providerCalls = 0;

  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/rest/v1/rpc/reserve_guest_grade')) {
      return Response.json({
        allowed: true,
        reservation_id: '22222222-2222-4222-8222-222222222222',
        remaining: 2,
        consumed: 0,
      });
    }
    if (target.endsWith('/rest/v1/rpc/finalize_guest_grade')) {
      return Response.json({ allowed: true, remaining: 2, consumed: 1 });
    }
    if (target.endsWith('/rest/v1/rpc/release_guest_grade')) {
      return Response.json(null);
    }
    if (target === reliabilityBankUrl) {
      return Response.json({
        records: Array.from({ length: 320 }, (_, index) => reliabilityBankRecord(index)),
      });
    }
    if (target.startsWith('https://generativelanguage.googleapis.com/')) {
      providerCalls += 1;
      if (providerMode === 'fail') {
        return Response.json(
          { error: { status: 'UNAVAILABLE', message: 'temporary outage' } },
          { status: 503 },
        );
      }
      return Response.json({
        candidates: [{
          content: {
            parts: [{ text: JSON.stringify(reliabilityModelResult()) }],
          },
        }],
      });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };

  try {
    const env = {
      ALLOWED_ORIGIN: reliabilityOrigin,
      GEMINI_API_KEY: 'test-key',
      GEMINI_MODEL: 'gemini-test',
      GEMINI_GROUNDING_ENABLED: 'false',
      WEBSITE_BANK_URL: reliabilityBankUrl,
      GUEST_USAGE_HMAC_KEY: 'test-only-guest-hmac-key',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
    };

    const failedResponse = await worker.fetch(reliabilityGradingRequest(), env);
    const failedPayload = await failedResponse.json();
    assert.equal(failedResponse.status, 502);
    assert.equal(failedPayload.error.code, 'EXAMINER_UNAVAILABLE');
    assert.ok(providerCalls >= 2, 'the Worker should retry transient provider failures');

    providerMode = 'success';
    const retryResponse = await worker.fetch(reliabilityGradingRequest(), env);
    const retryPayload = await retryResponse.json();
    assert.equal(retryResponse.status, 200);
    assert.equal(retryPayload.ok, true);
    assert.equal(retryPayload.assessment.score, 4);
    assert.equal(retryPayload.assessment.questionAuthority, 'server_question_bank');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('guest identifiers are validated and converted to non-reversible keyed hashes', async () => {
  const request = new Request('https://worker.example', {
    headers: {
      'X-Guest-Device-ID': 'device_privacy_12345678901234567890',
      'X-Request-ID': 'request_privacy_123456',
      'CF-Connecting-IP': '198.51.100.44',
      'User-Agent': 'Mozilla/5.0 Chrome/137.0.1 Windows NT 10.0',
    },
  });
  const identifiers = requireGuestHeaders(request);
  const hashes = await deriveGuestHashes(request, 'unit-test-hmac-secret', identifiers.deviceId);
  assert.match(hashes.deviceHash, /^[0-9a-f]{64}$/);
  assert.match(hashes.recoveryHash, /^[0-9a-f]{64}$/);
  assert.notEqual(hashes.deviceHash, identifiers.deviceId);
  assert.doesNotMatch(JSON.stringify(hashes), /198\.51\.100\.44|mozilla|chrome/i);
  assert.equal(
    normalizeUserAgent('Chrome/137.0.1 Windows NT 10.0'),
    'chrome/major windows nt/major',
  );
  assert.equal(GUEST_GRADE_LIMIT, 3);
});

test('guest-access status reports zero through three successful grades without reserving or grading', async (t) => {
  for (const completed of [0, 1, 2, 3]) {
    await t.test(`${completed} successful grades`, async () => {
      const originalFetch = globalThis.fetch;
      const storageRequests = [];
      let unexpectedCalls = 0;
      globalThis.fetch = async (url, options = {}) => {
        const target = String(url);
        storageRequests.push({ target, method: options.method || 'GET' });
        if (target.includes('/rest/v1/guest_grading_devices')) {
          return Response.json([{ usage_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }]);
        }
        if (target.includes('/rest/v1/guest_grading_usage')) {
          return Response.json([{ successful_grades: completed }]);
        }
        unexpectedCalls += 1;
        throw new Error(`Unexpected guest status request: ${target}`);
      };

      try {
        const rawDeviceId = `device_status_${completed}_123456789012345678901234`;
        const response = await worker.fetch(new Request('https://worker.example/guest-access', {
          method: 'POST',
          headers: {
            Origin: reliabilityOrigin,
            'CF-Connecting-IP': '203.0.113.55',
            'User-Agent': 'StatusBrowser/1.0',
            'X-Guest-Device-ID': rawDeviceId,
          },
        }), {
          ALLOWED_ORIGIN: reliabilityOrigin,
          GUEST_USAGE_HMAC_KEY: 'test-only-guest-hmac-key',
          SUPABASE_URL: 'https://test.supabase.co',
          SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
        });
        const payload = await response.json();
        assert.equal(response.status, 200);
        assert.deepEqual(payload.access, {
          signedIn: false,
          guest: {
            limit: 3,
            remaining: 3 - completed,
            completed,
          },
        });
        assert.equal(unexpectedCalls, 0);
        assert.equal(storageRequests.length, 2);
        assert.ok(storageRequests.every((entry) => entry.method === 'GET'));
        assert.doesNotMatch(
          storageRequests.map((entry) => entry.target).join('\n'),
          /device_status_|203\.0\.113\.55|StatusBrowser/i,
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
});

test('guest-access status treats a new guest as unused without creating storage rows', async () => {
  const originalFetch = globalThis.fetch;
  const storageRequests = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    storageRequests.push({ target, method: options.method || 'GET' });
    if (target.includes('/rest/v1/guest_grading_devices')) return Response.json([]);
    if (target.includes('/rest/v1/guest_grading_usage')) return Response.json([]);
    throw new Error(`Unexpected guest status request: ${target}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example/guest-access', {
      method: 'POST',
      headers: {
        Origin: reliabilityOrigin,
        'CF-Connecting-IP': '203.0.113.56',
        'User-Agent': 'FreshBrowser/1.0',
        'X-Guest-Device-ID': 'fresh_device_1234567890123456789012345678',
      },
    }), {
      ALLOWED_ORIGIN: reliabilityOrigin,
      GUEST_USAGE_HMAC_KEY: 'test-only-guest-hmac-key',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.access.guest, { limit: 3, remaining: 3, completed: 0 });
    assert.ok(storageRequests.every((entry) => entry.method === 'GET'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('guest-access status follows the same single-candidate recovery rule as reservation', async () => {
  const originalFetch = globalThis.fetch;
  let usageReads = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/rest/v1/guest_grading_devices')) return Response.json([]);
    if (target.includes('/rest/v1/guest_grading_usage')) {
      usageReads += 1;
      const parsed = new URL(target);
      assert.match(parsed.searchParams.get('recovery_hash') || '', /^eq\.[0-9a-f]{64}$/);
      assert.match(parsed.searchParams.get('last_seen_at') || '', /^gte\./);
      assert.equal(parsed.searchParams.get('limit'), '2');
      return Response.json([{ successful_grades: 2 }]);
    }
    throw new Error(`Unexpected recovery status request: ${target}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example/guest-access', {
      method: 'POST',
      headers: {
        Origin: reliabilityOrigin,
        'CF-Connecting-IP': '203.0.113.57',
        'User-Agent': 'RecoveryBrowser/1.0',
        'X-Guest-Device-ID': 'recovery_device_1234567890123456789012345',
      },
    }), {
      ALLOWED_ORIGIN: reliabilityOrigin,
      GUEST_USAGE_HMAC_KEY: 'test-only-guest-hmac-key',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.access.guest, { limit: 3, remaining: 1, completed: 2 });
    assert.equal(usageReads, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ambiguous recovery candidates do not merge unrelated guest identities', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/rest/v1/guest_grading_devices')) return Response.json([]);
    if (target.includes('/rest/v1/guest_grading_usage')) {
      return Response.json([
        { successful_grades: 3 },
        { successful_grades: 3 },
      ]);
    }
    throw new Error(`Unexpected ambiguous recovery request: ${target}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example/guest-access', {
      method: 'POST',
      headers: {
        Origin: reliabilityOrigin,
        'CF-Connecting-IP': '203.0.113.58',
        'User-Agent': 'SharedNetworkBrowser/1.0',
        'X-Guest-Device-ID': 'ambiguous_device_123456789012345678901234',
      },
    }), {
      ALLOWED_ORIGIN: reliabilityOrigin,
      GUEST_USAGE_HMAC_KEY: 'test-only-guest-hmac-key',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.access.guest, { limit: 3, remaining: 3, completed: 0 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('guest-access status verifies signed-in users and never reads guest quota', async () => {
  const originalFetch = globalThis.fetch;
  let guestStorageCalls = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      return Response.json({ id: '44444444-4444-4444-8444-444444444444' });
    }
    if (target.includes('guest_grading_')) guestStorageCalls += 1;
    throw new Error(`Unexpected signed-in status request: ${target}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example/guest-access', {
      method: 'POST',
      headers: {
        Origin: reliabilityOrigin,
        Authorization: 'Bearer verified-user-token',
      },
    }), {
      ALLOWED_ORIGIN: reliabilityOrigin,
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.access, { signedIn: true, guest: null });
    assert.equal(guestStorageCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('guest-access status rejects an invalid authenticated session without trusting guest headers', async () => {
  const originalFetch = globalThis.fetch;
  let guestStorageCalls = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      return Response.json({ message: 'expired' }, { status: 401 });
    }
    if (target.includes('guest_grading_')) guestStorageCalls += 1;
    throw new Error(`Unexpected invalid-session status request: ${target}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example/guest-access', {
      method: 'POST',
      headers: {
        Origin: reliabilityOrigin,
        Authorization: 'Bearer expired-user-token',
        'X-Guest-Device-ID': 'fallback_device_1234567890123456789012345',
      },
    }), {
      ALLOWED_ORIGIN: reliabilityOrigin,
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
    });
    const payload = await response.json();
    assert.equal(response.status, 401);
    assert.equal(payload.error.code, 'INVALID_SESSION');
    assert.equal(guestStorageCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the fourth guest grading request is blocked before question-bank or Gemini calls', async () => {
  const originalFetch = globalThis.fetch;
  let geminiCalls = 0;
  let bankCalls = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/rest/v1/rpc/reserve_guest_grade')) {
      return Response.json({
        allowed: false,
        reason: 'limit_reached',
        remaining: 0,
        consumed: 3,
      });
    }
    if (target.includes('generativelanguage.googleapis.com')) geminiCalls += 1;
    if (target.includes('website-upload.json')) bankCalls += 1;
    throw new Error(`Unexpected request after guest limit: ${target}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example', {
      method: 'POST',
      headers: {
        Origin: reliabilityOrigin,
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.30',
        'User-Agent': 'TestBrowser/1.0',
        'X-Guest-Device-ID': 'device_blocked_1234567890123456789',
        'X-Request-ID': 'request_blocked_000004',
      },
      body: JSON.stringify({
        questionId: 'CIV-2024-Q01',
        studentAnswer: reliabilityAnswer,
      }),
    }), {
      ALLOWED_ORIGIN: reliabilityOrigin,
      GEMINI_API_KEY: 'must-not-be-used',
      GUEST_USAGE_HMAC_KEY: 'test-only-guest-hmac-key',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
    });
    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.equal(payload.error.code, 'GUEST_LIMIT_REACHED');
    assert.equal(geminiCalls, 0);
    assert.equal(bankCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('legacy clients are accepted only during the explicit zero-downtime compatibility window', async () => {
  const originalFetch = globalThis.fetch;
  let guestRpcCalls = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/rpc/')) {
      guestRpcCalls += 1;
      throw new Error('Guest RPC must not run for an authorized legacy request');
    }
    if (target === reliabilityBankUrl) {
      return Response.json({
        records: Array.from({ length: 320 }, (_, index) => reliabilityBankRecord(index)),
      });
    }
    if (target.startsWith('https://generativelanguage.googleapis.com/')) {
      return Response.json({
        candidates: [{
          content: { parts: [{ text: JSON.stringify(reliabilityModelResult()) }] },
        }],
      });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example', {
      method: 'POST',
      headers: {
        Origin: reliabilityOrigin,
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.32',
      },
      body: JSON.stringify({
        questionId: 'CIV-2024-Q01',
        studentAnswer: reliabilityAnswer,
      }),
    }), {
      ALLOWED_ORIGIN: reliabilityOrigin,
      ALLOW_LEGACY_GUESTS: 'true',
      GEMINI_API_KEY: 'test-key',
      GEMINI_MODEL: 'gemini-test',
      GEMINI_GROUNDING_ENABLED: 'false',
      WEBSITE_BANK_URL: reliabilityBankUrl,
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.access, { signedIn: false, guest: null });
    assert.equal(guestRpcCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('legacy clients are rejected after the compatibility window closes', async () => {
  const response = await worker.fetch(new Request('https://worker.example', {
    method: 'POST',
    headers: {
      Origin: reliabilityOrigin,
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.33',
    },
    body: JSON.stringify({
      questionId: 'CIV-2024-Q01',
      studentAnswer: reliabilityAnswer,
    }),
  }), {
    ALLOWED_ORIGIN: reliabilityOrigin,
    ALLOW_LEGACY_GUESTS: 'false',
  });
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.error.code, 'GUEST_ID_REQUIRED');
});

test('a verified Supabase session bypasses guest reservation without trusting a client flag', async () => {
  const originalFetch = globalThis.fetch;
  let guestRpcCalls = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      return Response.json({ id: '33333333-3333-4333-8333-333333333333' });
    }
    if (target.includes('/rpc/')) {
      guestRpcCalls += 1;
      throw new Error('Guest RPC must not run for an authenticated user');
    }
    if (target === reliabilityBankUrl) {
      return Response.json({
        records: Array.from({ length: 320 }, (_, index) => reliabilityBankRecord(index)),
      });
    }
    if (target.startsWith('https://generativelanguage.googleapis.com/')) {
      return Response.json({
        candidates: [{
          content: { parts: [{ text: JSON.stringify(reliabilityModelResult()) }] },
        }],
      });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };

  try {
    const response = await worker.fetch(new Request('https://worker.example', {
      method: 'POST',
      headers: {
        Origin: reliabilityOrigin,
        Authorization: 'Bearer verified-user-token',
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.31',
      },
      body: JSON.stringify({
        questionId: 'CIV-2024-Q01',
        studentAnswer: reliabilityAnswer,
      }),
    }), {
      ALLOWED_ORIGIN: reliabilityOrigin,
      GEMINI_API_KEY: 'test-key',
      GEMINI_MODEL: 'gemini-test',
      GEMINI_GROUNDING_ENABLED: 'false',
      WEBSITE_BANK_URL: reliabilityBankUrl,
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.access, { signedIn: true });
    assert.equal(guestRpcCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('support validation rejects exam answers and stores only approved fields', () => {
  const normalized = normalizeSupportRequest({
    category: 'technical',
    message: 'The page remains on the loading state after I submit the form.',
    replyEmail: 'student@example.com',
  });
  assert.deepEqual(supportInsertRecord(normalized), {
    category: 'technical',
    message: 'The page remains on the loading state after I submit the form.',
    reply_email: 'student@example.com',
    status: 'pending',
  });
  assert.throws(() => normalizeSupportRequest({
    category: 'content',
    message: `Answer: Yes.\nLegal Basis: Article 1174.\nApplication: ${'facts '.repeat(120)}\nConclusion: Yes.`,
  }), SupportValidationError);
});

const correctionQuestion = {
  'Question ID': 'CIV-2024-Q01',
  Subject: 'Civil Law',
  'Essay Question': 'Was the contract valid?',
  'Suggested Answer': 'Answer: No. Legal Basis: Article 1409. Application: The facts show absolute simulation. Conclusion: The contract is void.',
};

function validCorrection(overrides = {}) {
  return {
    questionId: 'CIV-2024-Q01',
    subject: 'Civil Law',
    correctionType: 'suggested_answer',
    proposedCorrection: 'The suggested answer should identify absolute simulation.',
    explanation: 'Article 1409 more precisely supports the stated conclusion.',
    sourceUrls: ['https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/12345'],
    ...overrides,
  };
}

test('correction validation accepts every supported correction type', () => {
  for (const correctionType of CORRECTION_TYPES) {
    const normalized = normalizeCorrectionRequest(
      validCorrection({ correctionType }),
      correctionQuestion,
    );
    assert.equal(normalized.correctionType, correctionType);
  }
});

test('correction validation rejects every unsupported correction type shape', () => {
  for (const correctionType of ['', 'Question text', 'answer', 'grade_dispute', null, 7]) {
    assert.throws(
      () => normalizeCorrectionRequest(validCorrection({ correctionType }), correctionQuestion),
      CorrectionValidationError,
    );
  }
});

test('correction validation rejects empty and oversized fields', () => {
  for (const overrides of [
    { proposedCorrection: '' },
    { proposedCorrection: 'x'.repeat(6001) },
    { explanation: '' },
    { explanation: 'x'.repeat(3001) },
    { questionId: '' },
    { subject: '' },
  ]) {
    assert.throws(
      () => normalizeCorrectionRequest(validCorrection(overrides), correctionQuestion),
      CorrectionValidationError,
    );
  }
});

test('correction validation rejects malformed, credentialed, and excessive source URLs', () => {
  for (const sourceUrls of [
    ['not-a-url'],
    ['ftp://example.com/source'],
    ['https://test-user:test-password@example.invalid/source'],
    Array.from({ length: 6 }, (_, index) => `https://example.com/${index}`),
    'https://example.com/not-an-array',
  ]) {
    assert.throws(
      () => normalizeCorrectionRequest(validCorrection({ sourceUrls }), correctionQuestion),
      CorrectionValidationError,
    );
  }
});

test('correction validation rejects unexpected personal, answer, credential, token, key, and IP fields', () => {
  for (const field of [
    'studentAnswer',
    'answerText',
    'email',
    'password',
    'token',
    'apiKey',
    'serviceRoleKey',
    'ip',
    'rawIp',
    'userId',
  ]) {
    assert.throws(
      () => normalizeCorrectionRequest(validCorrection({ [field]: 'must-not-be-stored' }), correctionQuestion),
      CorrectionValidationError,
      `${field} must be rejected`,
    );
  }
});

test('correction insert record contains only approved storage fields', () => {
  const record = correctionInsertRecord(
    normalizeCorrectionRequest(validCorrection(), correctionQuestion),
  );
  assert.deepEqual(Object.keys(record).sort(), [
    'correction_type',
    'explanation',
    'proposed_correction',
    'question_bank_id',
    'source_urls',
    'subject',
    'user_id',
  ]);
  assert.equal(record.user_id, null);
  const serialized = JSON.stringify(record);
  for (const forbidden of [
    'studentAnswer',
    'answerText',
    'email',
    'password',
    'token',
    'apiKey',
    'serviceRoleKey',
    'rawIp',
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, 'i'));
  }
});

test('correction endpoint stores an approved payload without calling Gemini', async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  let storedBody;
  let storedHeaders;

  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target === reliabilityBankUrl) {
      return Response.json({
        records: Array.from({ length: 320 }, (_, index) => reliabilityBankRecord(index)),
      });
    }
    if (target === 'https://staging-project.supabase.co/rest/v1/question_corrections') {
      storedBody = JSON.parse(init.body);
      storedHeaders = init.headers;
      return new Response(null, { status: 201 });
    }
    if (target.startsWith('https://generativelanguage.googleapis.com/')) {
      providerCalls += 1;
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };

  try {
    const request = new Request('https://worker.example/corrections', {
      method: 'POST',
      headers: {
        Origin: reliabilityOrigin,
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.201',
      },
      body: JSON.stringify(validCorrection()),
    });
    const response = await worker.fetch(request, {
      ALLOWED_ORIGIN: reliabilityOrigin,
      WEBSITE_BANK_URL: reliabilityBankUrl,
      SUPABASE_URL: 'https://staging-project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-placeholder',
    });
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.ok, true);
    assert.equal(payload.message, 'Suggest a Correction/Better Answer submitted successfully.');
    assert.equal(providerCalls, 0);
    assert.deepEqual(storedBody, correctionInsertRecord(
      normalizeCorrectionRequest(validCorrection(), correctionQuestion),
    ));
    assert.equal(storedHeaders.apikey, 'test-service-role-placeholder');
    assert.equal(storedHeaders.Authorization, 'Bearer test-service-role-placeholder');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('correction endpoint fails generically when storage configuration is absent', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url) === reliabilityBankUrl) {
      return Response.json({
        records: Array.from({ length: 320 }, (_, index) => reliabilityBankRecord(index)),
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const request = new Request('https://worker.example/corrections', {
      method: 'POST',
      headers: {
        Origin: reliabilityOrigin,
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.202',
      },
      body: JSON.stringify(validCorrection()),
    });
    const response = await worker.fetch(request, {
      ALLOWED_ORIGIN: reliabilityOrigin,
      WEBSITE_BANK_URL: reliabilityBankUrl,
    });
    const payload = await response.json();

    assert.equal(response.status, 503);
    assert.equal(payload.error.code, 'CORRECTIONS_NOT_CONFIGURED');
    assert.equal(payload.error.message, 'Correction submissions are temporarily unavailable.');
    assert.doesNotMatch(JSON.stringify(payload), /service.role|supabase.*key|credential/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

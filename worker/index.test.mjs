import assert from 'node:assert/strict';
import test from 'node:test';
import worker, {
  absoluteSupabaseStorageUrl,
  authenticatedUserTokenCacheSizeForTest,
  outboundEmailMode,
  resetAuthenticatedUserTokenCacheForTest,
  sendSecureNotification,
} from './index.mjs';

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
import {
  PaymentValidationError,
  normalizePartnershipRequest,
  normalizePaymentFields,
  normalizeRefundRequest,
  proofExtension,
  validateProofSignature,
} from './payment-core.mjs';

test('Supabase private object signing paths retain the storage API prefix', () => {
  assert.equal(
    absoluteSupabaseStorageUrl(
      'https://test.supabase.co',
      '/object/sign/payment-proofs/user/proof.jpg?token=opaque',
    ),
    'https://test.supabase.co/storage/v1/object/sign/payment-proofs/user/proof.jpg?token=opaque',
  );
  assert.equal(
    absoluteSupabaseStorageUrl(
      'https://test.supabase.co',
      '/storage/v1/object/sign/payment-proofs/user/proof.jpg?token=opaque',
    ),
    'https://test.supabase.co/storage/v1/object/sign/payment-proofs/user/proof.jpg?token=opaque',
  );
});

test('global outbound policy fails closed for secure notifications', async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return Response.json({ id: 'provider-call-must-not-happen' });
  };
  const invalidPolicy = {
    OUTBOUND_EMAIL_MODE: 'invalid-operator-value',
    WEB3FORMS_ACCESS_KEY: 'test-only-web3forms-secret',
  };
  try {
    assert.equal(outboundEmailMode({}), 'suppressed');
    assert.equal(outboundEmailMode({ OUTBOUND_EMAIL_MODE: 'enabled' }), 'enabled');
    assert.equal(outboundEmailMode({ OUTBOUND_EMAIL_MODE: 'suppressed' }), 'suppressed');
    assert.equal(outboundEmailMode(invalidPolicy), 'suppressed');

    const web3forms = await sendSecureNotification(invalidPolicy, {
      mailbox: 'founders@duediligence.ph',
      subject: 'Never sent',
      adminPath: '/admin/',
    });

    assert.equal(web3forms.status, 'suppressed');
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

function providerModelAssessment(score = 5) {
  const { score: _publicScore, ...assessment } = modelAssessment(score);
  return { ...assessment, scoreTenths: Math.round(score * 10) };
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

test('a materially wrong governing rule cannot inflate an otherwise coherent answer', () => {
  const assessment = modelAssessment(3);
  assessment.rationale = 'The conclusion is correct, but Article 87 is an incorrect and irrelevant legal basis for constructive dismissal.';
  assessment.errors = ['The student affirmatively relied on the wrong legal basis.'];
  const result = applyDeterministicScoreCap(
    assessment,
    [
      'Answer: No. The delegation was improper.',
      'Legal Basis: Article 87 of the Labor Code on overtime pay governs.',
      'Application: Sandro filed the brief, so the overtime-pay rule makes the delegation improper.',
      'Conclusion: Therefore, the delegation was improper.',
    ].join('\n\n'),
    remedialContext,
  );
  assert.equal(result.score, 1.5);
  assert.match(result.errors.join(' '), /materially incorrect or irrelevant governing rule/i);
});

test('a false authority cannot improve a substantively coherent answer', () => {
  const assessment = modelAssessment(4);
  assessment.errors = ['The cited case is nonexistent and is a false authority.'];
  const result = applyDeterministicScoreCap(
    assessment,
    [
      'Answer: No. The delegation was improper.',
      'Legal Basis: A lawyer must supervise legal work, supposedly under the nonexistent Test v. Only case.',
      'Application: Sandro prepared, signed, and filed the brief before Cassandra reviewed it.',
      'Conclusion: Therefore, the delegation was improper.',
    ].join('\n\n'),
    remedialContext,
  );
  assert.equal(result.score, 2.5);
  assert.match(result.errors.join(' '), /false or nonexistent legal authority/i);
});

test('legally sound narrative without ALAC headings may retain 4.0–5.0', () => {
  const answer = 'No. A lawyer must personally supervise delegated legal work and may not allow a nonlawyer to exercise professional judgment or sign counsel’s name. Sandro prepared the appellate brief, signed Cassandra’s name, and filed it before she reviewed it, so Cassandra failed to provide the required prior supervision. The delegation was therefore improper.';
  assert.equal(capped(answer, 3.8).score, 3.8);
  assert.equal(capped(answer, 4.6).score, 4.6);
  assert.equal(capped(answer, 5).score, 5);
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

test('quarantined Tax questions cannot be submitted for grading', async () => {
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => {
    externalCalls += 1;
    throw new Error('A quarantined question must be rejected before any external call.');
  };

  try {
    for (const questionId of ['TAX-2019-Q10A', 'tax-2019-q10b']) {
      const response = await worker.fetch(new Request('https://worker.example/', {
        method: 'POST',
        headers: {
          Origin: 'https://duediligence.ph',
          'Content-Type': 'application/json',
          'CF-Connecting-IP': `192.0.2.${questionId.endsWith('A') ? 101 : 102}`,
          'User-Agent': 'TestBrowser/1.0',
          'X-Guest-Device-ID': `device_quarantine_${questionId.toLowerCase()}_1234567890`,
          'X-Request-ID': `request_quarantine_${questionId.toLowerCase()}_1234567890`,
        },
        body: JSON.stringify({
          questionId,
          studentAnswer: 'Answer: This quarantined question should not be graded.',
        }),
      }), {
        ALLOWED_ORIGIN: 'https://duediligence.ph',
        GUEST_USAGE_HMAC_KEY: 'test-only-guest-hmac-key',
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
      });
      const payload = await response.json();
      assert.equal(response.status, 404);
      assert.equal(payload.error.code, 'QUESTION_NOT_FOUND');
    }
    assert.equal(externalCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Worker requests integer-tenths precision and applies the existing cap', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
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
    const providerRequest = JSON.parse(init.body);
    const providerSchema = providerRequest.generationConfig.responseSchema;
    assert.equal(providerSchema.properties.score, undefined);
    assert.equal(providerSchema.properties.scoreTenths.type, 'integer');
    assert.equal(providerSchema.properties.scoreTenths.minimum, 0);
    assert.equal(providerSchema.properties.scoreTenths.maximum, 50);
    assert.match(providerRequest.contents[0].parts[0].text, /38 means 3\.8\/5\.0/i);
    assert.match(providerRequest.contents[0].parts[0].text, /do not default scoreTenths to multiples of 5/i);
    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: JSON.stringify(providerModelAssessment(5)) }] },
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

function authTestJwt({
  subject = '11111111-1111-4111-8111-111111111111',
  expiresAt = Math.floor(Date.now() / 1000) + 300,
  issuer = 'https://test.supabase.co/auth/v1',
  nonce = subject,
} = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({ sub: subject, exp: expiresAt, iss: issuer, role: 'authenticated' }),
    Buffer.from(`test-signature-${nonce}`).toString('base64url'),
  ].join('.');
}

function authenticatedGuestAccessRequest(token, ip) {
  return new Request('https://worker.example/guest-access', {
    method: 'POST',
    headers: {
      Origin: reliabilityOrigin,
      Authorization: `Bearer ${token}`,
      'CF-Connecting-IP': ip,
    },
  });
}

const authenticationTestEnv = {
  ALLOWED_ORIGIN: reliabilityOrigin,
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
};
const reliabilityAnswer = [
  'Answer: Yes. The claim succeeds.',
  'Legal Basis: Article 1174 of the Civil Code governs fortuitous events.',
  'Application: The fortuitous event in the question prevented performance and satisfies the governing rule.',
  'Conclusion: Therefore, the claim succeeds.',
].join('\n\n');
let reliabilityRequestCounter = 0;

function reliabilityBankRecord(index) {
  const subjects = [
    'Civil Law',
    'Political and Public International Law',
    'Labor Law',
    'Taxation Law',
    'Commercial Law',
    'Criminal Law',
    'Remedial Law',
    'Legal and Judicial Ethics',
  ];
  return {
    'Question ID': index === 0 ? 'CIV-2024-Q01' : `TEST-${String(index).padStart(3, '0')}`,
    Subject: subjects[index % subjects.length],
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
    ...providerModelAssessment(4),
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
    assert.equal(failedResponse.status, 503);
    assert.equal(failedPayload.error.code, 'AI_GRADING_CAPACITY');
    assert.match(failedPayload.error.message, /answer has been preserved and no attempt was consumed/i);
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

test('a successfully verified Supabase JWT is reused across distinct Request objects', async () => {
  const originalFetch = globalThis.fetch;
  const subject = 'a1111111-1111-4111-8111-111111111111';
  const token = authTestJwt({ subject, nonce: 'cross-request-reuse' });
  let authCalls = 0;
  resetAuthenticatedUserTokenCacheForTest();
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      authCalls += 1;
      return Response.json({ id: subject, email: 'cache-test@example.test' });
    }
    throw new Error(`Unexpected JWT cache request: ${target}`);
  };

  try {
    const first = await worker.fetch(
      authenticatedGuestAccessRequest(token, '203.0.113.201'),
      authenticationTestEnv,
    );
    const second = await worker.fetch(
      authenticatedGuestAccessRequest(token, '203.0.113.202'),
      authenticationTestEnv,
    );
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(authCalls, 1);
    assert.equal(authenticatedUserTokenCacheSizeForTest(), 1);
  } finally {
    resetAuthenticatedUserTokenCacheForTest();
    globalThis.fetch = originalFetch;
  }
});

test('a verified JWT cache entry expires after at most 30 seconds', async () => {
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  let now = 1_800_000_000_000;
  const subject = 'a1212121-1212-4212-8212-121212121212';
  const token = authTestJwt({
    subject,
    expiresAt: Math.floor(now / 1000) + 300,
    nonce: 'ttl-expiry',
  });
  let authCalls = 0;
  resetAuthenticatedUserTokenCacheForTest();
  Date.now = () => now;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      authCalls += 1;
      return Response.json({ id: subject });
    }
    throw new Error(`Unexpected JWT TTL request: ${target}`);
  };

  try {
    const first = await worker.fetch(
      authenticatedGuestAccessRequest(token, '203.0.113.203'),
      authenticationTestEnv,
    );
    now += 29_999;
    const withinTtl = await worker.fetch(
      authenticatedGuestAccessRequest(token, '203.0.113.204'),
      authenticationTestEnv,
    );
    now += 2;
    const afterTtl = await worker.fetch(
      authenticatedGuestAccessRequest(token, '203.0.113.205'),
      authenticationTestEnv,
    );

    assert.equal(first.status, 200);
    assert.equal(withinTtl.status, 200);
    assert.equal(afterTtl.status, 200);
    assert.equal(authCalls, 2);
    assert.equal(authenticatedUserTokenCacheSizeForTest(), 1);
  } finally {
    resetAuthenticatedUserTokenCacheForTest();
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
  }
});

test('invalid, expired, wrong-issuer, placeholder, and oversized bearer tokens are never reused', async () => {
  const originalFetch = globalThis.fetch;
  const future = Math.floor(Date.now() / 1000) + 300;
  const oversizedJwtParts = authTestJwt({
    subject: 'a4343434-4343-4343-8343-434343434343',
    expiresAt: future,
    nonce: 'oversized',
  }).split('.');
  const tokens = [
    authTestJwt({ subject: 'not-a-uuid', expiresAt: future, nonce: 'bad-subject' }),
    authTestJwt({
      subject: 'a2222222-2222-4222-8222-222222222222',
      expiresAt: Math.floor(Date.now() / 1000) - 10,
      nonce: 'expired',
    }),
    authTestJwt({
      subject: 'a3333333-3333-4333-8333-333333333333',
      expiresAt: future,
      issuer: 'https://another-project.supabase.co/auth/v1',
      nonce: 'wrong-issuer',
    }),
    'verified-user-token',
    `${oversizedJwtParts[0]}.${oversizedJwtParts[1]}.${'a'.repeat(17_000)}`,
  ];
  const verifiedIds = [
    'a2111111-1111-4111-8111-111111111111',
    'a2222222-2222-4222-8222-222222222222',
    'a3333333-3333-4333-8333-333333333333',
    'a4444444-4444-4444-8444-444444444444',
    'a4343434-4343-4343-8343-434343434343',
  ];
  let authCalls = 0;
  resetAuthenticatedUserTokenCacheForTest();
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      const id = verifiedIds[Math.floor(authCalls / 2)];
      authCalls += 1;
      return Response.json({ id });
    }
    throw new Error(`Unexpected uncacheable JWT request: ${target}`);
  };

  try {
    for (let index = 0; index < tokens.length; index += 1) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await worker.fetch(
          authenticatedGuestAccessRequest(tokens[index], `203.0.114.${index}-${attempt}`),
          authenticationTestEnv,
        );
        assert.equal(response.status, 200);
      }
    }
    assert.equal(authCalls, tokens.length * 2);
    assert.equal(authenticatedUserTokenCacheSizeForTest(), 0);
  } finally {
    resetAuthenticatedUserTokenCacheForTest();
    globalThis.fetch = originalFetch;
  }
});

test('transient Supabase Auth failures return a retryable typed 503 and are not cached', async () => {
  const originalFetch = globalThis.fetch;
  const token429 = authTestJwt({
    subject: 'a5555555-5555-4555-8555-555555555555',
    nonce: 'rate-limited',
  });
  const token500 = authTestJwt({
    subject: 'a6666666-6666-4666-8666-666666666666',
    nonce: 'upstream-error',
  });
  const upstreamResponses = [
    new Response(null, { status: 429, headers: { 'Retry-After': '7' } }),
    new Response(null, { status: 503 }),
    new Response(null, { status: 503 }),
  ];
  let authCalls = 0;
  resetAuthenticatedUserTokenCacheForTest();
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      const response = upstreamResponses[authCalls];
      authCalls += 1;
      return response;
    }
    throw new Error(`Unexpected transient auth request: ${target}`);
  };

  try {
    const rateLimited = await worker.fetch(
      authenticatedGuestAccessRequest(token429, '203.0.113.211'),
      authenticationTestEnv,
    );
    const unavailable = await worker.fetch(
      authenticatedGuestAccessRequest(token500, '203.0.113.212'),
      authenticationTestEnv,
    );
    const rateLimitedPayload = await rateLimited.json();
    const unavailablePayload = await unavailable.json();

    assert.equal(rateLimited.status, 503);
    assert.equal(rateLimitedPayload.error.code, 'AUTH_SESSION_VERIFICATION_UNAVAILABLE');
    assert.equal(rateLimitedPayload.error.retryable, true);
    assert.equal(rateLimitedPayload.error.retryAfterSeconds, 7);
    assert.equal(rateLimited.headers.get('Retry-After'), '7');
    assert.equal(
      rateLimited.headers.get('Access-Control-Expose-Headers'),
      'Retry-After, Content-Disposition, X-Admin-Data-Scope',
    );
    assert.equal(unavailable.status, 503);
    assert.equal(unavailablePayload.error.code, 'AUTH_SESSION_VERIFICATION_UNAVAILABLE');
    assert.equal(unavailablePayload.error.retryable, true);
    assert.equal(unavailablePayload.error.retryAfterSeconds, 5);
    assert.equal(unavailable.headers.get('Retry-After'), '5');
    assert.equal(authenticatedUserTokenCacheSizeForTest(), 0);
    assert.equal(authCalls, 3, '429 should not retry immediately; 5xx should retry once');
  } finally {
    resetAuthenticatedUserTokenCacheForTest();
    globalThis.fetch = originalFetch;
  }
});

test('Supabase Auth verification retries 5xx and preserves only true 401 and 403 session errors', async () => {
  const originalFetch = globalThis.fetch;
  const recoveredSubject = 'a7777777-7777-4777-8777-777777777777';
  const recoveredToken = authTestJwt({ subject: recoveredSubject, nonce: 'recovered' });
  const deniedToken = authTestJwt({
    subject: 'a8888888-8888-4888-8888-888888888888',
    nonce: 'denied',
  });
  const forbiddenToken = authTestJwt({
    subject: 'a8989898-8989-4989-8989-898989898989',
    nonce: 'forbidden',
  });
  const missingUserToken = authTestJwt({
    subject: 'a9090909-9090-4090-8090-909090909090',
    nonce: 'missing-user',
  });
  const upstreamResponses = [
    new Response(null, { status: 503 }),
    Response.json({ id: recoveredSubject }),
    Response.json({ message: 'expired' }, { status: 401 }),
    Response.json({ message: 'forbidden' }, { status: 403 }),
    Response.json({ email: 'missing-id@example.test' }),
    Response.json({ email: 'missing-id@example.test' }),
  ];
  let authCalls = 0;
  resetAuthenticatedUserTokenCacheForTest();
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      const response = upstreamResponses[authCalls];
      authCalls += 1;
      return response;
    }
    throw new Error(`Unexpected auth retry request: ${target}`);
  };

  try {
    const recovered = await worker.fetch(
      authenticatedGuestAccessRequest(recoveredToken, '203.0.113.213'),
      authenticationTestEnv,
    );
    const denied = await worker.fetch(
      authenticatedGuestAccessRequest(deniedToken, '203.0.113.214'),
      authenticationTestEnv,
    );
    const forbidden = await worker.fetch(
      authenticatedGuestAccessRequest(forbiddenToken, '203.0.113.217'),
      authenticationTestEnv,
    );
    const missingUser = await worker.fetch(
      authenticatedGuestAccessRequest(missingUserToken, '203.0.113.218'),
      authenticationTestEnv,
    );
    const deniedPayload = await denied.json();
    const forbiddenPayload = await forbidden.json();
    const missingUserPayload = await missingUser.json();

    assert.equal(recovered.status, 200);
    assert.equal(denied.status, 401);
    assert.equal(deniedPayload.error.code, 'INVALID_SESSION');
    assert.equal(forbidden.status, 401);
    assert.equal(forbiddenPayload.error.code, 'INVALID_SESSION');
    assert.equal(missingUser.status, 503);
    assert.equal(missingUserPayload.error.code, 'AUTH_SESSION_VERIFICATION_UNAVAILABLE');
    assert.equal(missingUserPayload.error.retryable, true);
    assert.equal(authCalls, 6, '401 and 403 must not retry; missing user id must retry once');
  } finally {
    resetAuthenticatedUserTokenCacheForTest();
    globalThis.fetch = originalFetch;
  }
});

test('malformed, missing-id, and JWT-sub-mismatched 2xx auth bodies retry then return typed 503', async () => {
  const originalFetch = globalThis.fetch;
  const malformedToken = authTestJwt({
    subject: 'ab111111-1111-4111-8111-111111111111',
    nonce: 'malformed-body',
  });
  const missingIdToken = authTestJwt({
    subject: 'ab222222-2222-4222-8222-222222222222',
    nonce: 'missing-id-body',
  });
  const mismatchedToken = authTestJwt({
    subject: 'ab333333-3333-4333-8333-333333333333',
    nonce: 'mismatched-id-body',
  });
  const upstreamResponses = [
    new Response('{not-json', { status: 200 }),
    new Response('{still-not-json', { status: 200 }),
    Response.json({ email: 'missing-id@example.test' }),
    Response.json({ email: 'still-missing-id@example.test' }),
    Response.json({ id: 'ab444444-4444-4444-8444-444444444444' }),
    Response.json({ id: 'ab444444-4444-4444-8444-444444444444' }),
  ];
  let authCalls = 0;
  resetAuthenticatedUserTokenCacheForTest();
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      const response = upstreamResponses[authCalls];
      authCalls += 1;
      return response;
    }
    throw new Error(`Unexpected unusable auth body request: ${target}`);
  };

  try {
    const responses = [];
    for (const [index, token] of [malformedToken, missingIdToken, mismatchedToken].entries()) {
      responses.push(await worker.fetch(
        authenticatedGuestAccessRequest(token, `203.0.113.22${index}`),
        authenticationTestEnv,
      ));
    }
    for (const response of responses) {
      const payload = await response.json();
      assert.equal(response.status, 503);
      assert.equal(payload.error.code, 'AUTH_SESSION_VERIFICATION_UNAVAILABLE');
      assert.equal(payload.error.retryable, true);
    }
    assert.equal(authCalls, 6);
    assert.equal(authenticatedUserTokenCacheSizeForTest(), 0);
  } finally {
    resetAuthenticatedUserTokenCacheForTest();
    globalThis.fetch = originalFetch;
  }
});

test('a never-ending 200 auth body is aborted, retried once, and returned as typed 503', async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const token = authTestJwt({
    subject: 'ab555555-5555-4555-8555-555555555555',
    nonce: 'stream-timeout',
  });
  let authCalls = 0;
  resetAuthenticatedUserTokenCacheForTest();
  globalThis.setTimeout = (callback, delay, ...args) => originalSetTimeout(
    callback,
    delay >= 5_000 ? 0 : delay,
    ...args,
  );
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      authCalls += 1;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"id":"unfinished'));
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected streaming auth request: ${target}`);
  };

  try {
    const response = await worker.fetch(
      authenticatedGuestAccessRequest(token, '203.0.113.226'),
      authenticationTestEnv,
    );
    const payload = await response.json();
    assert.equal(response.status, 503);
    assert.equal(payload.error.code, 'AUTH_SESSION_VERIFICATION_UNAVAILABLE');
    assert.equal(payload.error.retryable, true);
    assert.equal(authCalls, 2);
    assert.equal(authenticatedUserTokenCacheSizeForTest(), 0);
  } finally {
    resetAuthenticatedUserTokenCacheForTest();
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('Supabase Auth 408 is retried once and can recover', async () => {
  const originalFetch = globalThis.fetch;
  const subject = 'ab666666-6666-4666-8666-666666666666';
  const token = authTestJwt({ subject, nonce: 'upstream-408' });
  let authCalls = 0;
  resetAuthenticatedUserTokenCacheForTest();
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      authCalls += 1;
      return authCalls === 1
        ? new Response(null, { status: 408 })
        : Response.json({ id: subject });
    }
    throw new Error(`Unexpected auth 408 retry request: ${target}`);
  };

  try {
    const response = await worker.fetch(
      authenticatedGuestAccessRequest(token, '203.0.113.227'),
      authenticationTestEnv,
    );
    assert.equal(response.status, 200);
    assert.equal(authCalls, 2);
    assert.equal(authenticatedUserTokenCacheSizeForTest(), 1);
  } finally {
    resetAuthenticatedUserTokenCacheForTest();
    globalThis.fetch = originalFetch;
  }
});

test('Supabase Auth timeout retries once then returns retryable 503 without caching', async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const token = authTestJwt({
    subject: 'a9999999-9999-4999-8999-999999999999',
    nonce: 'timeout',
  });
  let authCalls = 0;
  resetAuthenticatedUserTokenCacheForTest();
  globalThis.setTimeout = (callback, delay, ...args) => originalSetTimeout(
    callback,
    delay >= 5_000 ? 0 : delay,
    ...args,
  );
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      authCalls += 1;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          reject(new DOMException('Timed out', 'AbortError'));
        }, { once: true });
      });
    }
    throw new Error(`Unexpected auth timeout request: ${target}`);
  };

  try {
    const response = await worker.fetch(
      authenticatedGuestAccessRequest(token, '203.0.113.215'),
      authenticationTestEnv,
    );
    const payload = await response.json();
    assert.equal(response.status, 503);
    assert.equal(payload.error.code, 'AUTH_SESSION_VERIFICATION_UNAVAILABLE');
    assert.equal(payload.error.retryable, true);
    assert.equal(payload.error.retryAfterSeconds, 5);
    assert.equal(authCalls, 2);
    assert.equal(authenticatedUserTokenCacheSizeForTest(), 0);
  } finally {
    resetAuthenticatedUserTokenCacheForTest();
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('Supabase Auth verification survives latency beyond the former five-second deadline', async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const subject = 'a9898989-9898-4989-8989-989898989898';
  const token = authTestJwt({ subject, nonce: 'regional-latency' });
  let authCalls = 0;
  resetAuthenticatedUserTokenCacheForTest();
  globalThis.setTimeout = (callback, delay, ...args) => originalSetTimeout(
    callback,
    delay >= 5_000 ? delay / 100 : delay,
    ...args,
  );
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      authCalls += 1;
      return new Promise((resolve, reject) => {
        const responseTimer = originalSetTimeout(
          () => resolve(Response.json({ id: subject })),
          80,
        );
        options.signal.addEventListener('abort', () => {
          originalClearTimeout(responseTimer);
          reject(new DOMException('Timed out', 'AbortError'));
        }, { once: true });
      });
    }
    throw new Error(`Unexpected regional-latency auth request: ${target}`);
  };

  try {
    const response = await worker.fetch(
      authenticatedGuestAccessRequest(token, '203.0.113.228'),
      authenticationTestEnv,
    );
    assert.equal(response.status, 200);
    assert.equal(authCalls, 1);
    assert.equal(authenticatedUserTokenCacheSizeForTest(), 1);
  } finally {
    resetAuthenticatedUserTokenCacheForTest();
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('a generic Supabase Auth network failure is retried once and can recover', async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const subject = 'aa111111-1111-4111-8111-111111111111';
  const token = authTestJwt({ subject, nonce: 'network-recovery' });
  let authCalls = 0;
  const warnings = [];
  resetAuthenticatedUserTokenCacheForTest();
  console.warn = (...args) => warnings.push(args);
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      authCalls += 1;
      if (authCalls === 1) throw new TypeError('network unavailable');
      return Response.json({ id: subject });
    }
    throw new Error(`Unexpected auth network retry request: ${target}`);
  };

  try {
    const response = await worker.fetch(
      authenticatedGuestAccessRequest(token, '203.0.113.216'),
      authenticationTestEnv,
    );
    assert.equal(response.status, 200);
    assert.equal(authCalls, 2);
    assert.equal(authenticatedUserTokenCacheSizeForTest(), 1);
    assert.deepEqual(warnings, [[
      'Supabase Auth verification transient failure',
      { category: 'network_error', status: null, attempt: 1 },
    ]]);
    assert.equal(JSON.stringify(warnings).includes(token), false);
  } finally {
    resetAuthenticatedUserTokenCacheForTest();
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test('the cross-request verified JWT cache remains bounded to 512 entries', async () => {
  const originalFetch = globalThis.fetch;
  const tokens = Array.from({ length: 513 }, (_, index) => {
    const suffix = (index + 1).toString(16).padStart(12, '0');
    return authTestJwt({
      subject: `b0000000-0000-4000-8000-${suffix}`,
      nonce: `bounded-${index}`,
    });
  });
  let authCalls = 0;
  resetAuthenticatedUserTokenCacheForTest();
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      authCalls += 1;
      const authorization = new Headers(options.headers).get('Authorization') || '';
      const payloadPart = authorization.replace(/^Bearer\s+/i, '').split('.')[1];
      const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
      return Response.json({ id: payload.sub });
    }
    throw new Error(`Unexpected bounded JWT cache request: ${target}`);
  };

  try {
    for (let index = 0; index < tokens.length; index += 1) {
      const response = await worker.fetch(
        authenticatedGuestAccessRequest(tokens[index], `bounded-cache-${index}`),
        authenticationTestEnv,
      );
      assert.equal(response.status, 200);
    }
    assert.equal(authCalls, 513);
    assert.equal(authenticatedUserTokenCacheSizeForTest(), 512);

    const newest = await worker.fetch(
      authenticatedGuestAccessRequest(tokens.at(-1), 'bounded-cache-newest-reuse'),
      authenticationTestEnv,
    );
    assert.equal(newest.status, 200);
    assert.equal(authCalls, 513, 'the newest cached token should be reused');

    const oldest = await worker.fetch(
      authenticatedGuestAccessRequest(tokens[0], 'bounded-cache-oldest-retry'),
      authenticationTestEnv,
    );
    assert.equal(oldest.status, 200);
    assert.equal(authCalls, 514, 'the oldest entry should have been evicted');
    assert.equal(authenticatedUserTokenCacheSizeForTest(), 512);
  } finally {
    resetAuthenticatedUserTokenCacheForTest();
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
      SUPABASE_SERVICE_ROLE_KEY: '  test-service-role-placeholder\r\n',
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

test('payment field validation accepts the approved ₱149 GoTyme InstaPay checkout', () => {
  const value = normalizePaymentFields({
    planCode: 'early_access_beta',
    amountPhp: '149.00',
    paymentMethod: 'gotyme_instapay',
    paymentDate: '2026-08-18',
    transactionReference: 'GOTYME-2026-0001',
    note: 'Paid through the displayed GoTyme InstaPay QR.',
  });
  assert.equal(value.planCode, 'early_access_beta');
  assert.equal(value.paymentMethod, 'gotyme_instapay');
  assert.equal(value.amountPhp, 149);
});

test('payment validation rejects retired plans, unapproved channels, and malformed references', () => {
  for (const input of [
    { planCode: 'premium', amountPhp: 499, paymentMethod: 'gotyme_instapay', paymentDate: '2026-08-18', transactionReference: 'REF-1' },
    { planCode: 'early_access_beta', amountPhp: 149, paymentMethod: 'gcash', paymentDate: '2026-08-18', transactionReference: 'REF-1' },
    { planCode: 'early_access_beta', amountPhp: 149, paymentMethod: 'gotyme_instapay', paymentDate: '2026-08-18', transactionReference: '<script>' },
  ]) {
    assert.throws(() => normalizePaymentFields(input), PaymentValidationError);
  }
});

test('proof validation enforces matching PNG, JPEG, and PDF signatures', () => {
  const fixtures = [
    ['proof.png', 'image/png', new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1])],
    ['proof.jpeg', 'image/jpeg', new Uint8Array([0xff,0xd8,0xff,0xe0,1])],
    ['proof.pdf', 'application/pdf', new TextEncoder().encode('%PDF-1.7')],
  ];
  for (const [name, mime, bytes] of fixtures) {
    assert.ok(proofExtension(name, mime));
    assert.equal(validateProofSignature(bytes, mime).byteLength, bytes.byteLength);
  }
  assert.throws(
    () => validateProofSignature(new TextEncoder().encode('<html>'), 'image/png'),
    PaymentValidationError,
  );
  assert.throws(() => proofExtension('proof.svg', 'image/svg+xml'), PaymentValidationError);
  assert.throws(() => proofExtension('proof.pdf', 'image/png'), PaymentValidationError);
});

test('refund and partnership validation require strong identifiers, contact, message, and consent', () => {
  assert.deepEqual(normalizeRefundRequest({
    paymentRequestId: '11111111-1111-4111-8111-111111111111',
    reason: 'I request review under the published refund policy.',
  }), {
    paymentRequestId: '11111111-1111-4111-8111-111111111111',
    reason: 'I request review under the published refund policy.',
  });
  assert.throws(() => normalizeRefundRequest({ paymentRequestId: 'bad', reason: 'short' }), PaymentValidationError);
  assert.equal(normalizePartnershipRequest({
    inquiryType: 'institutional_license',
    contactName: 'Dean Test',
    contactEmail: 'dean@example.edu',
    organization: 'Example College of Law',
    message: 'We would like to discuss an institutional license for our students.',
    consent: true,
  }).consent, true);
  assert.throws(() => normalizePartnershipRequest({
    inquiryType: 'other',
    contactName: 'Test',
    contactEmail: 'bad',
    message: 'This message is long enough for validation.',
    consent: true,
  }), PaymentValidationError);
  assert.throws(() => normalizePartnershipRequest({
    inquiryType: 'other',
    contactName: 'Test',
    contactEmail: 'test@example.com',
    message: 'This message is long enough for validation.',
    consent: false,
  }), PaymentValidationError);
});

test('plans endpoint exposes only the approved Early Access offer', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/rest/v1/rpc/phase4_plan_catalog')) {
      return Response.json([
        { planCode: 'early_access_beta', pricePhp: 149, checkoutEnabled: true },
      ]);
    }
    throw new Error(`Unexpected plans fetch: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/plans', {
      method: 'POST',
      headers: { Origin: reliabilityOrigin },
    }), {
      ALLOWED_ORIGIN: reliabilityOrigin,
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
      PRIVATE_BETA_GATE_ENABLED: 'true',
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.plans.map((plan) => plan.planCode), ['early_access_beta']);
    assert.equal(payload.plans[0].pricePhp, 149);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('plans endpoint defensively removes retired Standard and Premium rows', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/rest/v1/rpc/phase4_plan_catalog')) {
      return Response.json([
        { planCode: 'early_access_beta', pricePhp: 149, checkoutEnabled: true },
        { planCode: 'standard', pricePhp: 249, checkoutEnabled: true },
        { planCode: 'premium', pricePhp: 499, checkoutEnabled: true, status: 'active' },
      ]);
    }
    throw new Error(`Unexpected plans fetch: ${url}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/plans', {
      method: 'POST',
      headers: { Origin: reliabilityOrigin },
    }), {
      ALLOWED_ORIGIN: reliabilityOrigin,
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
      PUBLIC_PRICING_ENABLED: 'true',
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.plans.map((plan) => plan.planCode), ['early_access_beta']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('payment endpoint authenticates, verifies file bytes, uploads privately, and stores trusted metadata', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    calls.push({ target, init });
    if (target.endsWith('/auth/v1/user')) {
      return Response.json({ id: '11111111-1111-4111-8111-111111111111' });
    }
    if (target.includes('/storage/v1/object/payment-proofs/')) {
      assert.equal(init.headers['x-upsert'], 'false');
      assert.equal(init.headers['Content-Type'], 'image/png');
      return Response.json({ Key: 'private-object' });
    }
    if (target.endsWith('/rest/v1/rpc/phase4_create_payment_request')) {
      const body = JSON.parse(init.body);
      assert.equal(body.p_user_id, '11111111-1111-4111-8111-111111111111');
      assert.equal(body.p_plan_code, 'early_access_beta');
      assert.equal(body.p_payment_method, 'gotyme_instapay');
      assert.equal(body.p_amount_php, 149);
      assert.match(body.p_proof_object_path, /^11111111-1111-4111-8111-111111111111\/[0-9a-f-]+\.png$/);
      assert.match(body.p_proof_sha256, /^[0-9a-f]{64}$/);
      return Response.json({
        id: '22222222-2222-4222-8222-222222222222',
        status: 'pending',
        planCode: 'early_access_beta',
        amountPhp: 149,
        replayed: false,
      });
    }
    throw new Error(`Unexpected payment fetch: ${target}`);
  };
  try {
    const form = new FormData();
    form.set('planCode', 'early_access_beta');
    form.set('amountPhp', '149');
    form.set('paymentMethod', 'gotyme_instapay');
    form.set('paymentDate', '2026-08-18');
    form.set('transactionReference', 'GOTYME-TEST-001');
    form.set('note', 'Synthetic Worker test');
    form.set(
      'proof',
      new File(
        [new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1])],
        'proof.png',
        { type: 'image/png' },
      ),
    );
    const response = await worker.fetch(new Request('https://worker.example/payments/submit', {
      method: 'POST',
      headers: {
        Origin: reliabilityOrigin,
        Authorization: 'Bearer verified-user-token',
        'X-Request-ID': 'payment_worker_test_0001',
        'CF-Connecting-IP': '203.0.113.241',
      },
      body: form,
    }), {
      ALLOWED_ORIGIN: reliabilityOrigin,
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
      PUBLIC_PRICING_ENABLED: 'true',
    });
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(payload.payment.status, 'pending');
    assert.equal(calls.filter((call) => call.target.includes('/storage/v1/object/')).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('unsafe payment proof fails before any private upload or database call', async () => {
  const originalFetch = globalThis.fetch;
  let protectedCalls = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith('/auth/v1/user')) {
      return Response.json({ id: '11111111-1111-4111-8111-111111111111' });
    }
    protectedCalls += 1;
    throw new Error(`Unexpected protected call: ${target}`);
  };
  try {
    const form = new FormData();
    form.set('planCode', 'early_access_beta');
    form.set('amountPhp', '149');
    form.set('paymentMethod', 'gotyme_instapay');
    form.set('paymentDate', '2026-08-18');
    form.set('transactionReference', 'GOTYME-TEST-UNSAFE-001');
    form.set('proof', new File(['<html>unsafe</html>'], 'proof.png', { type: 'image/png' }));
    const response = await worker.fetch(new Request('https://worker.example/payments/submit', {
      method: 'POST',
      headers: {
        Origin: reliabilityOrigin,
        Authorization: 'Bearer verified-user-token',
        'X-Request-ID': 'payment_worker_test_unsafe_0002',
        'CF-Connecting-IP': '203.0.113.242',
      },
      body: form,
    }), {
      ALLOWED_ORIGIN: reliabilityOrigin,
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
      PUBLIC_PRICING_ENABLED: 'true',
    });
    const payload = await response.json();
    assert.equal(response.status, 415);
    assert.equal(payload.error.code, 'UNSAFE_PROOF_FILE');
    assert.equal(protectedCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('native partnership endpoint queues a consented inquiry without external redirect', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/rest/v1/rpc/phase4_create_partnership_inquiry')) {
      const body = JSON.parse(init.body);
      assert.equal(body.p_user_id, null);
      assert.equal(body.p_contact_email, 'dean@example.edu');
      assert.equal(body.p_consent, true);
      return Response.json({
        id: '33333333-3333-4333-8333-333333333333',
        status: 'new',
        replayed: false,
      });
    }
    throw new Error(`Unexpected partnership fetch: ${target}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/partnerships', {
      method: 'POST',
      headers: {
        Origin: reliabilityOrigin,
        'Content-Type': 'application/json',
        'X-Request-ID': 'partnership_worker_test_0001',
        'CF-Connecting-IP': '203.0.113.243',
      },
      body: JSON.stringify({
        inquiryType: 'institutional_license',
        contactName: 'Dean Test',
        contactEmail: 'dean@example.edu',
        organization: 'Example College of Law',
        message: 'We would like to discuss an institutional license for our students.',
        consent: true,
      }),
    }), {
      ALLOWED_ORIGIN: reliabilityOrigin,
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
    });
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(payload.inquiry.status, 'new');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('production submission enforcement rejects every anonymous user-generated submission before validation', async () => {
  const originalFetch = globalThis.fetch;
  let downstreamCalls = 0;
  globalThis.fetch = async () => {
    downstreamCalls += 1;
    throw new Error('Anonymous submissions must not reach a downstream service.');
  };

  try {
    for (const path of ['/', '/support', '/partnerships', '/corrections']) {
      const response = await worker.fetch(new Request(`https://worker.example${path}`, {
        method: 'POST',
        headers: {
          Origin: reliabilityOrigin,
          'Content-Type': 'application/json',
          'CF-Connecting-IP': `203.0.113.${path.length + 100}`,
        },
        body: '{}',
      }), {
        ALLOWED_ORIGIN: reliabilityOrigin,
        REQUIRE_AUTHENTICATED_SUBMISSIONS: 'true',
        PHASE4_ACCESS_ENFORCEMENT: 'true',
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-role',
      });
      const payload = await response.json();
      assert.equal(response.status, 401, `${path} must reject an anonymous request`);
      assert.equal(payload.error.code, 'AUTHENTICATION_REQUIRED');
      assert.match(payload.error.message, /sign in/i);
    }
    assert.equal(downstreamCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

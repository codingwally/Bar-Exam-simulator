import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';
import {
  applyDeterministicScoreCap,
  assessmentPolicy,
  validateExaminerResult,
} from './examiner-core.mjs';

// Synthetic, non-customer reproductions of two saved benchmark failure shapes.
// These are tests of the existing policy, not new legal calibration/authority.
const context = {
  question: 'Explain whether intention alone establishes liability under a statute requiring conduct.',
  questionType: 'explanation',
  applicationRequired: false,
  suggestedAnswer: 'No. The prosecution must establish the statutory conduct and other elements, not intention alone.',
  legalBasis: 'Statutory liability requires proof of the specified conduct and other elements.',
  verified: true,
};
const soundAnswer = 'No. A statute requiring conduct cannot be satisfied by intention alone. Under the governing statute, the prosecution must establish the specified conduct and every other element. Therefore, intention without the required conduct is insufficient.';
const fabricatedAnswer = `${soundAnswer} My cited test-only authority is deliberately fabricated for this synthetic test.`;
const faultyAnswer = 'Yes. Bad intent alone makes a person liable. Under the governing statute, the intention to cause harm suffices to establish liability even without the specified conduct. Therefore, intention alone establishes liability.';

function assessment(overrides = {}) {
  return {
    score: 4.5,
    rationale: 'The answer is responsive and gives a supported explanation.',
    strengths: ['The response states a direct conclusion.'],
    errors: [],
    improvements: ['Continue explaining the elements clearly.'],
    legalExplanation: 'The specified conduct is an element of the synthetic statute.',
    modelAnswerALAC: {
      answer: 'No. Intention alone is insufficient.',
      legalBasis: context.legalBasis,
      application: 'The question stipulates that conduct is required, so intention alone does not establish the specified element.',
      conclusion: 'Therefore, the required conduct must be established.',
    },
    authorityStatus: 'not_cited_or_omitted',
    scoreCeilingCode: 'none',
    rubricBreakdown: {
      responsiveness: 5, legalBasis: 5, application: 5, conclusion: 5,
      questionType: 'explanation', applicationRequired: false,
    },
    ...overrides,
  };
}

const failures = [
  {
    name: 'confirmed fabrication with contradictory praise',
    answer: fabricatedAnswer,
    raw: assessment({ score: 5, rationale: 'The answer deserves full credit without reliance on fabricated authorities.' }),
    expected: 2.5,
    code: 'confirmed_fabricated_authority',
    reason: /confirmed false or nonexistent legal authority/u,
  },
  {
    name: 'affirmative intent-only rule with obsolete numeric recommendation',
    answer: faultyAnswer,
    raw: assessment({
      score: 3,
      rationale: 'The conclusion is responsive, so a score of 3.0 is appropriate.',
      rubricBreakdown: {
        responsiveness: 5, legalBasis: 2, application: 2.5, conclusion: 4,
        questionType: 'explanation', applicationRequired: false,
      },
    }),
    expected: 1.5,
    code: 'materially_wrong_rule',
    reason: /materially incorrect or irrelevant governing rule/u,
  },
];

for (const fixture of failures) {
  test(`capped final rationale agrees with unchanged score: ${fixture.name}`, () => {
    const original = structuredClone(fixture.raw);
    const validated = validateExaminerResult(fixture.raw, assessmentPolicy(context));
    const result = applyDeterministicScoreCap(validated, fixture.answer, context);
    assert.equal(result.score, fixture.expected);
    assert.equal(result.appliedScoreCeiling.code, fixture.code);
    assert.equal(result.appliedScoreCeiling.changedScore, true);
    assert.equal(result.percentagePointValue, fixture.expected);
    assert.match(result.rationale, new RegExp(`^Final score: ${fixture.expected.toFixed(1).replace('.', '\\.')}\\/5\\.0\\. `, 'u'));
    assert.match(result.rationale, fixture.reason);
    assert.ok(!result.rationale.includes(fixture.raw.rationale));
    for (const key of ['rubricBreakdown', 'strengths', 'improvements', 'legalExplanation', 'modelAnswerALAC', 'sources']) {
      assert.deepEqual(result[key], validated[key], `preserve ${key}`);
    }
    assert.deepEqual(fixture.raw, original, 'normalization must not mutate input');

    // changedScore retains its existing per-invocation meaning (false on replay).
    // Final score/text, selected ceiling, diagnostics and error list are stable.
    let previous = result;
    for (let pass = 0; pass < 3; pass += 1) {
      const repeated = applyDeterministicScoreCap(previous, fixture.answer, context);
      assert.deepEqual({ ...repeated, appliedScoreCeiling: { ...repeated.appliedScoreCeiling, changedScore: true } }, result);
      assert.equal(repeated.appliedScoreCeiling.changedScore, false);
      const revalidated = applyDeterministicScoreCap(validateExaminerResult(previous, assessmentPolicy(context)), fixture.answer, context);
      assert.equal(revalidated.score, result.score);
      assert.equal(revalidated.rationale, result.rationale);
      assert.deepEqual(revalidated.errors, result.errors);
      previous = repeated;
    }
  });
}

for (const fixture of [
  { name: 'sound alternative explanation', answer: soundAnswer, raw: assessment() },
  { name: 'negated wrong-rule finding', answer: soundAnswer, raw: assessment({ rationale: 'The legal basis is not wrong; the alternative explanation is defensible.' }) },
  { name: 'quoted and rejected intent-only claim', answer: `${soundAnswer} I reject the assertion that "bad intent alone makes a person liable".`, raw: assessment() },
  { name: 'unverified is not confirmed fabrication', answer: soundAnswer, raw: assessment({ authorityStatus: 'unverified', rationale: 'The citation is unverified; the explanation remains responsive.' }) },
  { name: 'already below confirmed fabrication ceiling', answer: fabricatedAnswer, raw: assessment({ score: 2, authorityStatus: 'confirmed_fabricated', rationale: 'The answer earns 2.0 for its limited responsive analysis.' }) },
  { name: 'already at confirmed fabrication ceiling', answer: fabricatedAnswer, raw: assessment({ score: 2.5, authorityStatus: 'confirmed_fabricated', rationale: 'The confirmed authority problem limits this otherwise responsive answer.' }) },
]) {
  test(`preserves score and original rationale: ${fixture.name}`, () => {
    const result = applyDeterministicScoreCap(fixture.raw, fixture.answer, context);
    assert.equal(result.score, fixture.raw.score);
    assert.equal(result.rationale, fixture.raw.rationale);
    assert.deepEqual(result.rubricBreakdown, fixture.raw.rubricBreakdown);
    assert.deepEqual(result.errors, fixture.raw.errors);
  });
}

test('all explicit existing policy ceilings retain their exact scores', () => {
  for (const [code, maximum] of [['major_central_gap', 3.5], ['confirmed_fabricated_authority', 2.5], ['materially_wrong_rule', 1.5]]) {
    for (const score of [0, 1, 1.5, 2, 2.5, 3, 3.5, 4.5, 5]) {
      const raw = assessment({ score, scoreCeilingCode: code });
      const result = applyDeterministicScoreCap(raw, soundAnswer, context);
      assert.equal(result.score, Math.min(score, maximum), `${code}, input ${score}`);
      if (score <= maximum) assert.equal(result.rationale, raw.rationale);
      else assert.match(result.rationale, /^Final score:/u);
    }
  }
});

test('real single-answer Worker boundary finalizes the consistent capped report with one mocked provider response', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.endsWith('/rest/v1/rpc/reserve_guest_grade')) return Response.json({
      allowed: true, reservation_id: '11111111-1111-4111-8111-111111111111', remaining: 2, consumed: 0,
    });
    if (target.endsWith('/rest/v1/rpc/finalize_guest_grade')) return Response.json({ allowed: true, remaining: 2, consumed: 1 });
    // Keep the existing embedded-bank/compatibility path deterministic and
    // offline; bounded visibility retries are unrelated to model generation.
    if (target.startsWith('https://docs.google.com/spreadsheets/')) return new Response(null, { status: 503 });
    if (target.startsWith('https://generativelanguage.googleapis.com/')) {
      const { score, ...raw } = failures[1].raw;
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ ...raw, scoreTenths: score * 10 }) }] } }] });
    }
    throw new Error(`Unexpected mocked route: ${new URL(target).pathname}`);
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/', {
      method: 'POST',
      headers: {
        Origin: 'https://duediligence.ph', 'Content-Type': 'application/json',
        'CF-Connecting-IP': '192.0.2.92', 'User-Agent': 'SyntheticCoachingTest/1.0',
        'X-Guest-Device-ID': 'device_coaching_1234567890_1234567890',
        'X-Request-ID': 'request_coaching_1234567890',
      },
      body: JSON.stringify({ questionId: 'ASTRA-SYNTHETIC-COACHING', studentAnswer: faultyAnswer, questionContext: context }),
    }), {
      ALLOWED_ORIGIN: 'https://duediligence.ph', GEMINI_API_KEY: 'synthetic-placeholder',
      GEMINI_MODEL: 'gemini-3.5-flash-lite', GEMINI_GROUNDING_ENABLED: 'false',
      GUEST_USAGE_HMAC_KEY: 'synthetic-guest-hmac-placeholder',
      SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-placeholder',
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.assessment.score, 1.5);
    assert.match(body.assessment.rationale, /^Final score: 1\.5\/5\.0\./u);
    assert.doesNotMatch(body.assessment.rationale, /3\.0 is appropriate/u);
    assert.equal(calls.filter((url) => url.startsWith('https://generativelanguage.googleapis.com/')).length, 1);
    assert.equal(calls.filter((url) => url.endsWith('/finalize_guest_grade')).length, 1);
    assert.equal(calls.filter((url) => url.startsWith('https://docs.google.com/spreadsheets/')).length, 4);
    assert.equal(calls.length, 7, 'only mocked reservation/bounded bank reads/provider/finalization; no email or extra model call');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

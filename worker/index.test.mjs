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
  for (const score of [0, 0.1, 1.2, 2.7, 3.7, 4.6, 5]) {
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
  assert.equal(capped(answer, 4.6).score, 4.6);
  assert.equal(capped(answer, 5).score, 5);
});

test('Worker applies the cap after Gemini returns a high score', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (!String(url).includes('generativelanguage.googleapis.com')) {
      throw new Error(`Unexpected request: ${url}`);
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

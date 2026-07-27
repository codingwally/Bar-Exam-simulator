import assert from 'node:assert/strict';
import test from 'node:test';

import worker from './index.mjs';

const origin = 'https://duediligence.ph';
const bankUrl = `${origin}/content/question-bank/website-upload.json`;

function bankRecord(index) {
  return {
    'Question ID': index === 0 ? 'CIV-2024-Q01' : `TEST-${String(index).padStart(3, '0')}`,
    Subject: 'Civil Law',
    'Essay Question': `Question ${index}`,
    'Suggested Answer': 'Answer: Yes. Legal Basis: Article 1174. Application: The facts satisfy the rule. Conclusion: Therefore, the claim succeeds.',
    'Legal Basis / Provision': 'Civil Code, Article 1174',
    'Jurisprudence / Case': 'Virginia Real v. Belo',
    'Citation / G.R. No.': 'G.R. No. 146224',
    'Source URL': 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/40783',
  };
}

function modelResult() {
  return {
    score: 4,
    maxScore: 5,
    percentagePointValue: 4,
    tier: '4.0',
    performanceLabel: 'Strong answer',
    assessmentType: 'question_bank',
    label: 'Question-bank assessment',
    rationale: 'The answer states the rule and applies it to the facts.',
    strengths: ['Direct answer'],
    errors: [],
    improvements: ['Add more factual detail'],
    legalExplanation: 'Article 1174 governs fortuitous events.',
    modelAnswerALAC: {
      answer: 'Yes.',
      legalBasis: 'Article 1174 of the Civil Code applies.',
      application: 'The stated facts satisfy the rule.',
      conclusion: 'Therefore, the claim succeeds.',
    },
    sources: [],
    sourceStatus: 'stored',
    reviewRequired: false,
    rubricVersion: 'SC-2025-BB4-PER-QUESTION-v1',
  };
}

function gradingRequest() {
  return new Request('https://worker.example', {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.10',
    },
    body: JSON.stringify({
      questionId: 'CIV-2024-Q01',
      studentAnswer: 'Answer: Yes. Legal Basis: Article 1174. Application: The facts satisfy the rule. Conclusion: Therefore, the claim succeeds.',
    }),
  });
}

test('transient Gemini failures are retried and do not lock a failed submission', async () => {
  const originalFetch = globalThis.fetch;
  let providerMode = 'fail';
  let providerCalls = 0;

  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target === bankUrl) {
      return Response.json({ records: Array.from({ length: 320 }, (_, index) => bankRecord(index)) });
    }
    if (target.startsWith('https://generativelanguage.googleapis.com/')) {
      providerCalls += 1;
      if (providerMode === 'fail') {
        return Response.json({ error: { status: 'UNAVAILABLE', message: 'temporary outage' } }, { status: 503 });
      }
      return Response.json({
        candidates: [{
          content: {
            parts: [{ text: JSON.stringify(modelResult()) }],
          },
        }],
      });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };

  try {
    const env = {
      ALLOWED_ORIGIN: origin,
      GEMINI_API_KEY: 'test-key',
      GEMINI_MODEL: 'gemini-test',
      GEMINI_GROUNDING_ENABLED: 'false',
      WEBSITE_BANK_URL: bankUrl,
    };

    const failedResponse = await worker.fetch(gradingRequest(), env);
    const failedPayload = await failedResponse.json();
    assert.equal(failedResponse.status, 502);
    assert.equal(failedPayload.error.code, 'EXAMINER_UNAVAILABLE');
    assert.ok(providerCalls >= 2, 'the Worker should retry transient provider failures');

    providerMode = 'success';
    const retryResponse = await worker.fetch(gradingRequest(), env);
    const retryPayload = await retryResponse.json();
    assert.equal(retryResponse.status, 200);
    assert.equal(retryPayload.ok, true);
    assert.equal(retryPayload.assessment.score, 4);
    assert.equal(retryPayload.assessment.questionAuthority, 'server_question_bank');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

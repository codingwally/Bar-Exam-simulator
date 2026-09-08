import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';

// All legal text, identities, keys, Auth/RPC replies and Gemini output are inert
// fixtures. These tests establish route policy isolation, not legal accuracy.
const origin = 'https://duediligence.ph';
const supabaseUrl = 'https://syllabus-route-policy.test';
const userId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';
const questionId = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';
const reservationId = '55555555-5555-4555-8555-555555555555';
const policyVersion = 'syllabus-results-20260909-v1';
const reference = 'A conditional duty is an obligation that becomes enforceable only when a stated future event occurs.';
const legalBasis = 'A conditional duty depends on a future event before performance becomes enforceable.';
const question = 'What is a conditional duty?';
const env = {
  ALLOWED_ORIGIN: origin,
  SUPABASE_URL: supabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: 'inert-service-role',
  GUEST_USAGE_HMAC_KEY: 'inert-guest-hmac',
  GEMINI_API_KEY: 'inert-gemini-key',
  GEMINI_MODEL: 'gemini-test',
  GEMINI_GROUNDING_ENABLED: 'false',
  PHASE4_MODEL_QUALITY_ENFORCEMENT: 'false',
};

function providerAssessment() {
  return {
    scoreTenths: 45,
    maxScore: 5,
    percentagePointValue: 4.5,
    tier: '4.5',
    performanceLabel: 'Strong answer',
    assessmentType: 'question_bank',
    label: 'Question-bank assessment',
    rationale: 'The response accurately states the governing rule and directly answers the definition.',
    strengths: ['Correct and complete definition.'],
    errors: [],
    improvements: [],
    legalExplanation: legalBasis,
    authorityStatus: 'not_cited_or_omitted',
    scoreCeilingCode: 'none',
    rubricBreakdown: {
      responsiveness: 4.5,
      legalBasis: 4.5,
      application: 4.5,
      conclusion: 4.5,
    },
    modelAnswerALAC: {
      answer: reference,
      legalBasis,
      application: 'The stated future event determines when this conditional duty becomes enforceable.',
      conclusion: 'Therefore, enforceability depends on that event.',
    },
    sources: [],
    sourceStatus: 'stored',
    reviewRequired: false,
    rubricVersion: 'SC-2025-BB4-PER-QUESTION-v1',
  };
}

const cases = [
  { name: 'authorized Syllabus uses definition policy', track: 'per_subject', score: 4.5, type: 'definition' },
  { name: 'authorized Bar Simulation retains legacy grading', track: 'bar_feels', score: 2.5, type: 'problem' },
  { name: 'payload and question markers cannot opt Bar Simulation into Syllabus', track: 'bar_feels', spoof: true, score: 2.5, type: 'problem' },
  { name: 'payload and question markers cannot opt a null authorized track into Syllabus', track: null, spoof: true, score: 2.5, type: 'problem' },
  { name: 'payload and question markers cannot opt an unknown authorized track into Syllabus', track: 'unknown', spoof: true, score: 2.5, type: 'problem' },
  { name: 'payload and question track cannot override authorized Syllabus', track: 'per_subject', spoof: true, spoofTrack: 'bar_feels', score: 4.5, type: 'definition' },
];

for (const [index, scenario] of cases.entries()) {
  test(scenario.name, { concurrency: false }, async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    const prompts = [];
    let stored = null;
    const spoof = scenario.spoof ? {
      track: scenario.spoofTrack || 'per_subject',
      gradingTrack: scenario.spoofTrack || 'per_subject',
      gradingPolicyVersion: policyVersion,
      questionType: 'definition',
      applicationRequired: false,
      questionContext: {
        authority: 'curated-approved-examination-snapshot',
        gradingTrack: scenario.spoofTrack || 'per_subject',
        gradingPolicyVersion: policyVersion,
      },
    } : {};
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      calls.push(target);
      if (target === `${supabaseUrl}/auth/v1/user`) {
        return Response.json({ id: userId, email: 'inert-syllabus@example.com' });
      }
      const payload = JSON.parse(options.body);
      if (target === `${supabaseUrl}/rest/v1/rpc/examination_authorize_access`) {
        assert.deepEqual(payload, {
          p_user_id: userId,
          p_track: null,
          p_version_id: null,
          p_attempt_id: attemptId,
          p_allow_historical: false,
        });
        return Response.json({
          allowed: true,
          basis: scenario.track === 'bar_feels' ? 'paid_subscription' : 'current_owner',
          unlimited: true,
          track: scenario.track,
        });
      }
      if (target === `${supabaseUrl}/rest/v1/rpc/examination_command`) {
        assert.equal(payload.p_user_id, userId);
        assert.equal(payload.p_operation, 'request_ai_grading');
        assert.equal(payload.p_payload.attemptId, attemptId);
        for (const key of Object.keys(spoof)) assert.equal(payload.p_payload[key], undefined);
        return Response.json({
          jobId,
          attemptId,
          status: 'queued',
          ...spoof,
          questions: [{
            questionId,
            subject: 'Synthetic definition exercise',
            prompt: question,
            studentAnswer: reference,
            modelAnswer: reference,
            legalBasis,
            application: 'The future event controls enforceability.',
            conclusion: 'The duty becomes enforceable upon the event.',
            jurisprudence: [],
            sourceUrls: [],
            modelAnswerHash: 'a'.repeat(64),
            ...spoof,
          }],
        });
      }
      if (target === `${supabaseUrl}/rest/v1/rpc/phase4_reserve_grade_v2`) {
        assert.equal(payload.p_user_id, userId);
        assert.equal(payload.p_question_bank_id, questionId);
        assert.equal(payload.p_examination_track, scenario.track === 'bar_feels' ? 'bar_feels' : 'subject_matter');
        return Response.json({ allowed: true, basis: 'free', accessMode: 'free', reservationId });
      }
      if (target.startsWith('https://generativelanguage.googleapis.com/')) {
        const text = payload.contents[0].parts[0].text;
        const match = text.match(/\n<UNTRUSTED_EXAM_DATA>\s*([\s\S]*?)\s*<\/UNTRUSTED_EXAM_DATA>/u);
        assert.ok(match, 'Actual provider prompt contains the bounded exam data.');
        prompts.push(JSON.parse(match[1]));
        return Response.json({
          candidates: [{ content: { parts: [{ text: JSON.stringify(providerAssessment()) }] } }],
        });
      }
      if (target === `${supabaseUrl}/rest/v1/rpc/examination_store_ai_assessment_commercial`) {
        stored = payload;
        assert.equal(payload.p_user_id, userId);
        assert.equal(payload.p_job_id, jobId);
        assert.equal(payload.p_question_id, questionId);
        assert.equal(payload.p_reservation_id, reservationId);
        return Response.json({ jobId, attemptId, status: 'completed', completedQuestions: 1, questionCount: 1, modelsReleased: false });
      }
      throw new Error(`Unexpected external boundary in inert route test: ${target}`);
    };
    try {
      const response = await worker.fetch(new Request('https://worker.example/examinations/command', {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          Authorization: 'Bearer inert-user-access-token',
          'CF-Connecting-IP': `192.0.2.${index + 101}`,
        },
        body: JSON.stringify({ operation: 'request_ai_grading', attemptId, requestKey: `syllabus_policy_route_${index}_0001`, ...spoof }),
      }), env);
      const body = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.ok, true);
      assert.equal(body.data.status, 'completed');
      assert.equal(prompts.length, 1, 'One mocked provider call grades one question.');
      assert.equal(prompts[0].question, question);
      assert.equal(prompts[0].studentAnswer, reference);
      assert.equal(prompts[0].questionType, scenario.type);
      assert.equal(prompts[0].applicationRequired, scenario.type === 'problem');
      assert.ok(stored, 'The completed result must reach actual persistence plumbing.');
      assert.equal(stored.p_score, scenario.score);
      assert.equal(stored.p_assessment.score, scenario.score);
      assert.equal(stored.p_assessment.rubricBreakdown.questionType, scenario.type);
      assert.equal(stored.p_assessment.rubricBreakdown.applicationRequired, scenario.type === 'problem');
      assert.equal(stored.p_grader_model, 'gemini-test');
      assert.equal(calls.filter(url => url.endsWith('/examination_authorize_access')).length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

const SUPABASE_URL = String(process.env.STAGING_SUPABASE_URL || '').replace(/\/+$/, '');
const PUBLISHABLE_KEY = String(process.env.STAGING_SUPABASE_PUBLISHABLE_KEY || '');
const WORKER_URL = String(process.env.STAGING_EXAMINATION_WORKER_URL || '').replace(/\/+$/, '');
const EMAIL = String(process.env.STAGING_SMOKE_EMAIL || '');
const PASSWORD = String(process.env.STAGING_SMOKE_PASSWORD || '');

assert.equal(SUPABASE_URL, 'https://hlzqmreeoghbldnhlybr.supabase.co');
assert.equal(
  WORKER_URL,
  'https://duediligence-examinations-staging.wallyesteban1993.workers.dev',
);
assert.match(PUBLISHABLE_KEY, /^sb_publishable_[A-Za-z0-9_-]{20,}$/);
assert.match(EMAIL, /^dd-randomizer-smoke-[A-Za-z0-9]+@duediligence\.ph$/);
assert.ok(PASSWORD.length >= 24);

function requestKey(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function tabToken() {
  return randomBytes(32).toString('hex');
}

async function jsonRequest(url, options = {}, expected = [200]) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(180_000),
  });
  const body = await response.json().catch(() => null);
  if (!expected.includes(response.status)) {
    throw new Error(
      `${options.method || 'GET'} ${new URL(url).pathname} returned ${response.status}: `
      + `${body?.error?.code || body?.error?.message || body?.message || 'invalid JSON'}`,
    );
  }
  return { response, body };
}

async function workerPost(path, payload, token, expected = [200]) {
  return jsonRequest(`${WORKER_URL}${path}`, {
    method: 'POST',
    headers: {
      Origin: WORKER_URL,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }, expected);
}

async function examinationQuery(token, operation, payload = {}) {
  const { body } = await workerPost('/examinations/query', { operation, ...payload }, token);
  assert.equal(body.ok, true);
  return body.data;
}

async function examinationCommand(token, operation, payload = {}, expected = [200]) {
  const { body } = await workerPost(
    '/examinations/command',
    { operation, ...payload },
    token,
    expected,
  );
  assert.equal(body.ok, true);
  return body.data;
}

const { body: session } = await jsonRequest(
  `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
  {
    method: 'POST',
    headers: {
      apikey: PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  },
);
const token = session.access_token;
assert.ok(typeof token === 'string' && token.length > 40);

const { body: accessBefore } = await workerPost('/access', {}, token);
const disclosureVersion = String(accessBefore.access?.tokenDisclosureVersion || '');
assert.ok(disclosureVersion.length > 8);

await jsonRequest(`${SUPABASE_URL}/rest/v1/rpc/accept_terms`, {
  method: 'POST',
  headers: {
    apikey: PUBLISHABLE_KEY,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    p_terms_version: 'terms-soft-launch-v1-2026-08-21',
    p_privacy_version: 'privacy-soft-launch-v1-2026-08-21',
    p_acceptance_source: 'randomizer_authenticated_staging_smoke',
  }),
}, [200, 204]);

await jsonRequest(`${SUPABASE_URL}/rest/v1/rpc/complete_commercial_profile_onboarding_v2`, {
  method: 'POST',
  headers: {
    apikey: PUBLISHABLE_KEY,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    p_display_name: 'Randomizer staging smoke',
    p_law_school_id: 'other',
    p_law_school_other: 'Synthetic Staging Law School',
    p_category: 'review',
    p_professor_license_number: null,
    p_terms_version: 'terms-soft-launch-v1-2026-08-21',
    p_privacy_version: 'privacy-soft-launch-v1-2026-08-21',
    p_trial_disclosure_version: disclosureVersion,
    p_trial_acknowledged: true,
  }),
}, [200, 204]);

const { body: accessAfter } = await workerPost('/access', {}, token);
assert.equal(accessAfter.access?.allowed, true);
console.log('STAGING_SMOKE: authenticated commercial profile ready');

const practiceQuestionIds = [];
for (let index = 0; index < 2; index += 1) {
  const id = requestKey(`practice_${index}`);
  const { body } = await workerPost('/exam/question', {
    subject: 'Labor Law',
    requestId: id,
  }, token);
  assert.equal(body.ok, true);
  assert.equal(body.question?.subject, 'Labor Law');
  assert.ok(typeof body.question?.id === 'string' || typeof body.question?.questionId === 'string');
  assert.equal(body.rotation?.feature, 'bar_question_practice');
  practiceQuestionIds.push(body.question.id || body.question.questionId);
}
assert.equal(new Set(practiceQuestionIds).size, 2);
console.log('STAGING_SMOKE: Bar Question Practice issued two unique questions');

const subjectCatalog = await examinationQuery(token, 'subject_catalog');
assert.ok(Array.isArray(subjectCatalog.items) && subjectCatalog.items.length > 0);
const subject = subjectCatalog.items.find((item) => (
  item.subject === 'Criminal Law I' && Number(item.yearLevel) === 1 && Number(item.term) === 1
)) || subjectCatalog.items[0];
const subjectPayload = {
  subject: subject.subject,
  yearLevel: Number(subject.yearLevel),
  term: Number(subject.term),
};
const firstSelection = await examinationQuery(token, 'subject_next', subjectPayload);
assert.equal(firstSelection.exhausted, false);
const repeatedSelection = await examinationQuery(token, 'subject_next', subjectPayload);
assert.equal(repeatedSelection.setup.versionId, firstSelection.setup.versionId);

const subjectTab = tabToken();
const subjectAttempt = await examinationCommand(token, 'start_attempt', {
  versionId: firstSelection.setup.versionId,
  timerMode: 'none',
  requestKey: requestKey('subject_start'),
  tabToken: subjectTab,
}, [201]);
assert.equal(subjectAttempt.questions.length, 1);
await examinationCommand(token, 'save_response', {
  attemptId: subjectAttempt.attempt.attemptId,
  questionId: subjectAttempt.questions[0].questionId,
  tabToken: subjectTab,
  answerText: 'Answer: Yes. Legal basis: The controlling rule applies. Application: The material facts satisfy the rule. Conclusion: Relief should be granted.',
  expectedRevision: Number(subjectAttempt.questions[0].revision) || 0,
  flagged: false,
});
await examinationCommand(token, 'submit_attempt', {
  attemptId: subjectAttempt.attempt.attemptId,
  tabToken: subjectTab,
  requestKey: requestKey('subject_submit'),
  confirmed: true,
});
const secondSelection = await examinationQuery(token, 'subject_next', subjectPayload);
assert.equal(secondSelection.exhausted, false);
assert.notEqual(secondSelection.setup.versionId, firstSelection.setup.versionId);
console.log('STAGING_SMOKE: Syllabus-Based Review excluded the answered question');

const simulationCatalog = await examinationQuery(token, 'catalog', { track: 'bar_feels' });
const simulation = simulationCatalog.items.find((item) => (
  item.subject === 'Civil Law'
  && item.assessmentKind === 'curated'
  && item.testOnly === false
));
assert.ok(simulation, 'The published Civil Law Simulation destination is required.');
const simulationTab = tabToken();
const simulationRequestKey = requestKey('simulation_start');
const simulationPayload = {
  versionId: simulation.versionId,
  timerMode: 'strict',
  requestKey: simulationRequestKey,
  tabToken: simulationTab,
};
const simulationAttempt = await examinationCommand(
  token,
  'start_attempt',
  simulationPayload,
  [201],
);
assert.equal(simulationAttempt.questions.length, 20);
assert.ok(simulationAttempt.allocationId);
assert.equal(new Set(simulationAttempt.questions.map((item) => item.questionId)).size, 20);
const simulationReplay = await examinationCommand(
  token,
  'start_attempt',
  simulationPayload,
  [200, 201],
);
assert.equal(simulationReplay.attempt.attemptId, simulationAttempt.attempt.attemptId);
assert.equal(simulationReplay.allocationId, simulationAttempt.allocationId);
console.log('STAGING_SMOKE: Bar Exam Simulation allocated twenty unique questions idempotently');

console.log(JSON.stringify({
  gate: 'PASS',
  accessMode: accessAfter.access?.accessMode || null,
  practice: {
    requests: 2,
    uniqueQuestions: new Set(practiceQuestionIds).size,
  },
  syllabusBasedReview: {
    courseCode: subject.courseCode,
    firstVersionId: firstSelection.setup.versionId,
    nextVersionChanged: secondSelection.setup.versionId !== firstSelection.setup.versionId,
  },
  barExamSimulation: {
    destination: simulation.subject,
    questions: simulationAttempt.questions.length,
    uniqueQuestions: new Set(simulationAttempt.questions.map((item) => item.questionId)).size,
    idempotentReplay: simulationReplay.attempt.attemptId === simulationAttempt.attempt.attemptId,
  },
}));

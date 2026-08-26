import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import {
  GRAMMAR_STRENGTH_RUBRIC,
  GRAMMAR_STRENGTH_RUBRIC_ID,
  grammarStrengthPromptSection,
  validateGrammarStrengthDiagnostic,
} from '../worker/auxiliary-grammar-strength-rubric.mjs';
import {
  ISSUE_SPOTTING_RUBRIC,
  ISSUE_SPOTTING_RUBRIC_ID,
  issueSpottingPromptSection,
  validateIssueSpottingDiagnostic,
} from '../worker/auxiliary-issue-spotting-rubric.mjs';
import {
  AUXILIARY_SOURCE_TYPES,
  AUXILIARY_WRITING_DIAGNOSTICS_RESPONSE_SCHEMA,
  attachAuxiliaryDiagnostics,
  auxiliaryAnswerEligible,
  auxiliaryPersistencePayload,
  buildAuxiliaryWritingDiagnosticsPrompt,
  normalizeAuxiliaryEnsureRequest,
  normalizeAuxiliaryRecordsRequest,
  validateAuxiliaryWritingDiagnosticsResult,
} from '../worker/auxiliary-writing-diagnostics-core.mjs';
import { createAuxiliaryWritingDiagnosticsHandlers } from '../worker/auxiliary-writing-diagnostics-routes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

const [
  clientSource,
  routeSource,
  examinationsSource,
  indexSource,
  css,
  migration,
  leastPrivilegeMigration,
  claimFencingMigration,
  retryBackoffMigration,
  terminalRetryMigration,
] = await Promise.all([
  read('assets/auxiliary-writing-diagnostics.js'),
  read('worker/auxiliary-writing-diagnostics-routes.mjs'),
  read('assets/examinations.js'),
  read('index.html'),
  read('assets/auxiliary-writing-diagnostics.css'),
  read('supabase/migrations/20260826174331_auxiliary_writing_diagnostics.sql'),
  read('supabase/migrations/20260826180126_auxiliary_writing_diagnostics_least_privilege.sql'),
  read('supabase/migrations/20260826180430_auxiliary_writing_diagnostics_claim_fencing.sql'),
  read('supabase/migrations/20260826183000_auxiliary_writing_diagnostics_retry_backoff.sql'),
  read('supabase/migrations/20260826184500_auxiliary_writing_diagnostics_terminal_retry.sql'),
]);

const GRAMMAR_COACHING = 'Revise sentence boundaries and remove unnecessary words.';
const ISSUE_COACHING = 'List the material issues before beginning the rule discussion.';
const RESULT_DISCLAIMER = 'These scores are not part of your answer score. They are provided only to help you assess grammar and issue spotting.';
const ANALYTICS_DISCLAIMER = 'Grammar Strength and Issue Spotting are separate 0–5% auxiliary diagnostics. They do not change your answer score.';
const VALID_SOURCE_ID_A = '11111111-1111-4111-8111-111111111111';
const VALID_SOURCE_ID_B = '22222222-2222-4222-8222-222222222222';

function diagnostic(points, briefCoaching) {
  return { auxiliaryPoints: points, briefCoaching };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function collectKeys(value, keys = []) {
  if (!value || typeof value !== 'object') return keys;
  for (const [key, item] of Object.entries(value)) {
    keys.push(key);
    collectKeys(item, keys);
  }
  return keys;
}

function count(source, literal) {
  return source.split(literal).length - 1;
}

function cssDeclarationBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Expected CSS rule for ${selector}.`);
  return match[1].replace(/\s+/g, '');
}

function loadClient(items, { immediateTimers = false } = {}) {
  const requests = [];
  const events = [];
  const schedule = immediateTimers
    ? (callback) => { queueMicrotask(callback); return 1; }
    : setTimeout;
  const fakeWindow = {
    DueDiligencePhase2: {
      getSession: () => ({ access_token: 'test-access-token' }),
    },
    DueDiligencePhase2Config: {
      workerUrl: 'https://auxiliary.test',
    },
    DueDiligencePrivateBeta: {
      accessHeaders: () => ({ 'X-Test-Access': 'isolated' }),
    },
    dispatchEvent: (event) => events.push(event.type),
    setTimeout: schedule,
  };
  class TestCustomEvent {
    constructor(type) {
      this.type = type;
    }
  }
  const fetch = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return {
      ok: true,
      json: async () => ({
        result: url.includes('/ensure')
          ? { status: 'unavailable', expectedQuestions: 1 }
          : { items },
      }),
    };
  };
  vm.runInNewContext(clientSource, {
    window: fakeWindow,
    CustomEvent: TestCustomEvent,
    fetch,
    setTimeout: schedule,
  }, { filename: 'assets/auxiliary-writing-diagnostics.js' });
  return {
    api: fakeWindow.DueDiligenceAuxiliaryDiagnostics,
    events,
    requests,
  };
}

// Each auxiliary rubric owns an independent five-point contract. A genuine
// zero is valid, while absent or non-numeric values must not silently become 0.
for (const [label, validator, coaching] of [
  ['Grammar Strength', validateGrammarStrengthDiagnostic, GRAMMAR_COACHING],
  ['Issue Spotting', validateIssueSpottingDiagnostic, ISSUE_COACHING],
]) {
  assert.equal(validator(diagnostic(0, coaching)).auxiliaryPoints, 0,
    `${label} must preserve a genuine zero.`);
  assert.equal(validator(diagnostic(5, coaching)).auxiliaryPoints, 5,
    `${label} must accept the upper bound.`);
  assert.equal(validator(diagnostic(2.46, coaching)).auxiliaryPoints, 2.5,
    `${label} must normalize to one decimal place.`);
  for (const invalid of [-0.1, 5.1, Number.NaN, Number.POSITIVE_INFINITY, null, '', '   ', false]) {
    assert.throws(
      () => validator(diagnostic(invalid, coaching)),
      { name: /RangeError|TypeError/ },
      `${label} must reject ${String(invalid)} rather than coerce it to a score.`,
    );
  }
  assert.throws(() => validator({ briefCoaching: coaching }), { name: /RangeError|TypeError/ });
  assert.throws(() => validator(diagnostic(3, '')), { name: 'RangeError' });
  assert.throws(() => validator(diagnostic(3, 'x'.repeat(181))), { name: 'RangeError' });
  assert.throws(
    () => validator(diagnostic(3, 'This official grade passed the answer rubric.')),
    /separate from official grading language/,
    `${label} coaching must not introduce official grade, pass/fail, or rubric language.`,
  );
}

assert.notEqual(GRAMMAR_STRENGTH_RUBRIC_ID, ISSUE_SPOTTING_RUBRIC_ID);
assert.equal(GRAMMAR_STRENGTH_RUBRIC.maximumPoints, 5);
assert.equal(ISSUE_SPOTTING_RUBRIC.maximumPoints, 5);
assert.notStrictEqual(GRAMMAR_STRENGTH_RUBRIC, ISSUE_SPOTTING_RUBRIC);
assert.notStrictEqual(GRAMMAR_STRENGTH_RUBRIC.anchors, ISSUE_SPOTTING_RUBRIC.anchors);
assert.equal(GRAMMAR_STRENGTH_RUBRIC.anchors.length, 6);
assert.equal(ISSUE_SPOTTING_RUBRIC.anchors.length, 6);

const validated = validateAuxiliaryWritingDiagnosticsResult({
  grammarStrength: { ...diagnostic(0, GRAMMAR_COACHING), weightedScore: 99 },
  issueSpotting: { ...diagnostic(5, ISSUE_COACHING), combinedTotal: 99 },
  total: 99,
  overallScore: 99,
  passed: true,
});
assert.deepEqual(Object.keys(validated).sort(), [
  'grammarStrength',
  'issueSpotting',
  'version',
]);
assert.deepEqual(Object.keys(validated.grammarStrength).sort(), [
  'auxiliaryPoints',
  'briefCoaching',
  'maximumPoints',
  'rubricId',
]);
assert.deepEqual(Object.keys(validated.issueSpotting).sort(), [
  'auxiliaryPoints',
  'briefCoaching',
  'maximumPoints',
  'rubricId',
]);
assert.equal(validated.grammarStrength.auxiliaryPoints, 0);
assert.equal(validated.issueSpotting.auxiliaryPoints, 5);
assert.ok(Object.isFrozen(validated));
assert.ok(Object.isFrozen(validated.grammarStrength));
assert.ok(Object.isFrozen(validated.issueSpotting));

const forbiddenDiagnosticKey = /(?:combined|weighted|total|overall|official|pass|fail)/i;
assert.deepEqual(
  collectKeys(validated).filter((key) => forbiddenDiagnosticKey.test(key)),
  [],
  'The validated auxiliary result must expose no combined, weighted, official, or pass/fail field.',
);
assert.deepEqual(Object.keys(AUXILIARY_WRITING_DIAGNOSTICS_RESPONSE_SCHEMA.properties).sort(), [
  'grammarStrength',
  'issueSpotting',
]);
assert.equal(AUXILIARY_WRITING_DIAGNOSTICS_RESPONSE_SCHEMA.properties.grammarStrength.properties.auxiliaryPoints.maximum, 5);
assert.equal(AUXILIARY_WRITING_DIAGNOSTICS_RESPONSE_SCHEMA.properties.issueSpotting.properties.auxiliaryPoints.maximum, 5);

// The auxiliary prompt is built only from question facts and learner response.
// Extra official-result sentinels are deliberately ignored.
const grammarPrompt = grammarStrengthPromptSection();
const issuePrompt = issueSpottingPromptSection();
assert.equal(count(grammarPrompt, GRAMMAR_STRENGTH_RUBRIC_ID), 1);
assert.equal(count(grammarPrompt, ISSUE_SPOTTING_RUBRIC_ID), 0);
assert.equal(count(issuePrompt, ISSUE_SPOTTING_RUBRIC_ID), 1);
assert.equal(count(issuePrompt, GRAMMAR_STRENGTH_RUBRIC_ID), 0);
assert.match(grammarPrompt, /Do not assess whether the law, issue, analysis, or conclusion is correct\./);
assert.match(issuePrompt, /Do not assess rule accuracy, legal basis, application quality, conclusion, or writing mechanics\./);

const prompt = buildAuxiliaryWritingDiagnosticsPrompt({
  question: 'A complaint was filed after the stated deadline. Identify the issues raised by the facts.',
  answer: 'The response identifies prescription and explains why the filing date matters.',
  officialScore: 'OFFICIAL_SCORE_SENTINEL',
  officialRubric: 'OFFICIAL_RUBRIC_SENTINEL',
  passFail: 'PASS_FAIL_SENTINEL',
});
assert.equal(count(prompt, GRAMMAR_STRENGTH_RUBRIC_ID), 1);
assert.equal(count(prompt, ISSUE_SPOTTING_RUBRIC_ID), 1);
assert.match(prompt, /Do not combine, average, weight, or total the two auxiliary diagnostics\./);
assert.match(prompt, /No official score, official rubric result, pass\/fail decision, or answer grade is supplied to you\./);
assert.doesNotMatch(prompt, /OFFICIAL_SCORE_SENTINEL|OFFICIAL_RUBRIC_SENTINEL|PASS_FAIL_SENTINEL/);
assert.ok(prompt.indexOf(GRAMMAR_STRENGTH_RUBRIC_ID) < prompt.indexOf(ISSUE_SPOTTING_RUBRIC_ID));

// Eligibility is intentionally conservative: blank, one/two-word, and short
// fragments remain unassessed instead of becoming false zeroes.
for (const ineligible of [
  null,
  undefined,
  '',
  '   ',
  'one',
  'one two',
  'a bb ccc',
  '123456789012',
]) {
  assert.equal(auxiliaryAnswerEligible(ineligible), false, `${String(ineligible)} must be ineligible.`);
}
assert.equal(auxiliaryAnswerEligible('One two three'), true);
assert.equal(auxiliaryAnswerEligible('  One   two\nthree  '), true);
assert.throws(
  () => buildAuxiliaryWritingDiagnosticsPrompt({ question: 'Question facts', answer: 'too short' }),
  /too short/i,
);
assert.throws(
  () => buildAuxiliaryWritingDiagnosticsPrompt({ question: '   ', answer: 'One two three' }),
  /Question facts are required/i,
);

// Request references are normalized without accepting arbitrary sources or
// identifiers. Batch requests deduplicate references and remain immutable.
assert.deepEqual([...AUXILIARY_SOURCE_TYPES].sort(), [
  'examination_attempt',
  'legacy_grading_result',
  'phase4_exam_attempt',
]);
for (const sourceType of AUXILIARY_SOURCE_TYPES) {
  assert.deepEqual(
    normalizeAuxiliaryEnsureRequest({
      sourceType: ` ${sourceType} `,
      sourceId: ` ${VALID_SOURCE_ID_A} `,
      ignored: 'not persisted',
    }),
    { sourceType, sourceId: VALID_SOURCE_ID_A },
  );
}
for (const invalid of [
  null,
  [],
  {},
  { sourceType: 'unsupported', sourceId: VALID_SOURCE_ID_A },
  { sourceType: 'examination_attempt', sourceId: 'not-a-uuid' },
]) {
  assert.throws(() => normalizeAuxiliaryEnsureRequest(invalid), { name: 'TypeError' });
}

const normalizedRecords = normalizeAuxiliaryRecordsRequest({
  records: [
    { sourceType: 'phase4_exam_attempt', sourceId: VALID_SOURCE_ID_A },
    { sourceType: 'phase4_exam_attempt', sourceId: VALID_SOURCE_ID_A },
    { sourceType: 'examination_attempt', sourceId: VALID_SOURCE_ID_B },
  ],
  officialScore: 'must be discarded',
});
assert.deepEqual(normalizedRecords.records, [
  { sourceType: 'phase4_exam_attempt', sourceId: VALID_SOURCE_ID_A },
  { sourceType: 'examination_attempt', sourceId: VALID_SOURCE_ID_B },
]);
assert.deepEqual(Object.keys(normalizedRecords), ['records']);
assert.ok(Object.isFrozen(normalizedRecords));
assert.ok(Object.isFrozen(normalizedRecords.records));
assert.throws(
  () => normalizeAuxiliaryRecordsRequest({
    records: Array.from({ length: 501 }, () => ({
      sourceType: 'phase4_exam_attempt',
      sourceId: VALID_SOURCE_ID_A,
    })),
  }),
  /up to 500/i,
);

// Attaching diagnostics wraps, rather than spreads into or mutates, the opaque
// official result. This test intentionally knows nothing about rubric internals.
const officialResult = deepFreeze({
  opaqueScoreSentinel: 'OFFICIAL_SCORE_BYTES',
  opaqueOutcomeSentinel: 'OFFICIAL_PASS_FAIL_BYTES',
  opaqueRubricPayload: {
    nested: ['OFFICIAL_RUBRIC_BYTES', { untouched: true }],
  },
});
const officialSnapshot = JSON.stringify(officialResult);
for (const diagnostics of [
  validated,
  validateAuxiliaryWritingDiagnosticsResult({
    grammarStrength: diagnostic(5, GRAMMAR_COACHING),
    issueSpotting: diagnostic(0, ISSUE_COACHING),
  }),
  null,
]) {
  const attached = attachAuxiliaryDiagnostics(officialResult, diagnostics);
  assert.deepEqual(Object.keys(attached).sort(), [
    'auxiliaryWritingDiagnostics',
    'officialResult',
  ]);
  assert.strictEqual(attached.officialResult, officialResult);
  assert.strictEqual(attached.auxiliaryWritingDiagnostics, diagnostics);
  assert.equal(JSON.stringify(attached.officialResult), officialSnapshot);
  assert.ok(Object.isFrozen(attached));
}
assert.equal(JSON.stringify(officialResult), officialSnapshot);

const persistencePayload = auxiliaryPersistencePayload({
  userId: VALID_SOURCE_ID_A,
  jobId: VALID_SOURCE_ID_B,
  claimToken: VALID_SOURCE_ID_A,
  result: validated,
  model: 'auxiliary-test-model',
});
assert.equal(persistencePayload.p_claim_token, VALID_SOURCE_ID_A);
assert.throws(() => auxiliaryPersistencePayload({
  userId: VALID_SOURCE_ID_A,
  jobId: VALID_SOURCE_ID_B,
  claimToken: '',
  result: validated,
  model: 'auxiliary-test-model',
}), /claim token/i);

// Exercise only the new client asset in a VM. Missing values are excluded
// independently, a genuine zero remains measured, and source references are
// deduplicated before the isolated records request.
const clientItems = [
  {
    sourceType: 'phase4_exam_attempt',
    sourceId: VALID_SOURCE_ID_A,
    questionId: 'q-1',
    status: 'completed',
    updatedAt: '2026-08-27T01:00:00Z',
    grammarStrength: diagnostic(0, 'Grammar zero remains real.'),
    issueSpotting: diagnostic(5, 'Issue five remains real.'),
  },
  {
    sourceType: 'phase4_exam_attempt',
    sourceId: VALID_SOURCE_ID_A,
    questionId: 'q-2',
    status: 'completed',
    updatedAt: '2026-08-27T02:00:00Z',
    grammarStrength: diagnostic(5, 'Grammar five remains real.'),
  },
  {
    sourceType: 'examination_attempt',
    sourceId: VALID_SOURCE_ID_B,
    questionId: 'q-3',
    status: 'completed',
    updatedAt: '2026-08-27T03:00:00Z',
    grammarStrength: diagnostic(99, 'Invalid and ignored.'),
    issueSpotting: diagnostic(1, 'Issue one remains real.'),
  },
];
const client = loadClient(clientItems);
assert.ok(client.api);
assert.ok(Object.isFrozen(client.api));
await client.api.loadForRecords([
  { sourceType: 'phase4_exam_attempt', sourceId: VALID_SOURCE_ID_A },
  { sourceType: 'phase4_exam_attempt', sourceId: VALID_SOURCE_ID_A },
  { sourceType: 'examination_attempt', sourceId: VALID_SOURCE_ID_B },
]);
assert.equal(client.requests.length, 1);
assert.equal(client.requests[0].url, 'https://auxiliary.test/dd2026/auxiliary-diagnostics/records');
assert.equal(client.requests[0].options.headers.Authorization, 'Bearer test-access-token');
assert.deepEqual(client.requests[0].body.records, [
  { sourceType: 'phase4_exam_attempt', sourceId: VALID_SOURCE_ID_A },
  { sourceType: 'examination_attempt', sourceId: VALID_SOURCE_ID_B },
]);

const clientSummary = client.api.summaryFor([
  { sourceType: 'phase4_exam_attempt', sourceId: VALID_SOURCE_ID_A },
  { sourceType: 'examination_attempt', sourceId: VALID_SOURCE_ID_B },
]);
assert.equal(clientSummary.grammarStrength, 2.5,
  'Missing/invalid Grammar data must not become zero or borrow Issue data.');
assert.equal(clientSummary.issueSpotting, 3,
  'Missing Issue data must not borrow Grammar data.');
assert.equal(clientSummary.assessedAttempts, 2);
assert.equal(clientSummary.assessedAnswers, 3);

const zeroSummary = client.api.summaryFor([
  { sourceType: 'phase4_exam_attempt', sourceId: VALID_SOURCE_ID_A },
]);
assert.equal(zeroSummary.grammarStrength, 2.5);
assert.equal(zeroSummary.issueSpotting, 5);

const progressiveLegacyClient = loadClient([], { immediateTimers: true });
const progressiveLegacyRecords = Array.from({ length: 10 }, (_, index) => ({
  sourceType: 'legacy_grading_result',
  sourceId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
}));
await progressiveLegacyClient.api.ensureForRecords(progressiveLegacyRecords);
assert.equal(progressiveLegacyClient.requests.filter((request) => (
  request.url.endsWith('/dd2026/auxiliary-diagnostics/ensure')
)).length, 8, 'One Analytics visit may queue at most eight legacy diagnostics.');
await progressiveLegacyClient.api.ensureForRecords(progressiveLegacyRecords);
const progressiveEnsureRequests = progressiveLegacyClient.requests.filter((request) => (
  request.url.endsWith('/dd2026/auxiliary-diagnostics/ensure')
));
assert.equal(progressiveEnsureRequests.length, 10,
  'A failed first batch must not monopolize later progressive legacy coverage.');
assert.deepEqual(progressiveEnsureRequests.slice(8).map((request) => request.body.sourceId), [
  progressiveLegacyRecords[8].sourceId,
  progressiveLegacyRecords[9].sourceId,
]);

const analyticsMarkup = client.api.analyticsMarkup([
  { sourceType: 'phase4_exam_attempt', sourceId: VALID_SOURCE_ID_A },
  { sourceType: 'examination_attempt', sourceId: VALID_SOURCE_ID_B },
]);
assert.match(analyticsMarkup, new RegExp(ANALYTICS_DISCLAIMER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.equal(count(analyticsMarkup, 'data-auxiliary-metric="grammar-strength"'), 1);
assert.equal(count(analyticsMarkup, 'data-auxiliary-metric="issue-spotting"'), 1);
assert.equal(count(analyticsMarkup, 'class="aux-analytics-fill'), 2);
assert.match(analyticsMarkup, /aria-valuemin="0" aria-valuemax="5"/);
assert.doesNotMatch(analyticsMarkup, /weighted|combined|overall|pass|fail/i);

// The auxiliary bars use their own selector and the approved navy/gold pair.
// The test does not inspect any pre-existing analytics or scoring stylesheet.
const fillRule = cssDeclarationBlock('.aux-analytics-fill');
assert.match(fillRule, /border:1pxsolidvar\(--gold,#C5A059\)/);
assert.match(fillRule, /background:var\(--navy,#002147\)/);
assert.doesNotMatch(css, /\.analytics-bar-fill\s*\{/,
  'Auxiliary styling must not override the existing analytics bar class.');
assert.match(clientSource, /class="aux-analytics-fill/);
assert.doesNotMatch(clientSource, /class="analytics-bar-fill/);

assert.equal(count(clientSource, RESULT_DISCLAIMER), 1,
  'The exact non-scoring coaching disclaimer must be defined once.');
assert.equal(count(clientSource, ANALYTICS_DISCLAIMER), 1,
  'The exact non-scoring Analytics disclaimer must be defined once.');
assert.doesNotMatch(css, /position\s*:\s*(?:fixed|sticky)|animation\s*:/i,
  'The auxiliary presentation must remain quiet and non-invasive.');
assert.match(migration, /on conflict \(user_id, source_type, source_id, question_id, input_hash, diagnostic_version\)[\s\S]*do nothing/,
  'First-claim idempotency must be protected by an atomic conflict path.');
assert.match(migration, /p_grammar_points is null or p_issue_points is null/,
  'Persistence must reject missing diagnostic points rather than treating them as zero.');
assert.doesNotMatch(migration, /a\.score is not null|g\.overall_score is not null/,
  'Auxiliary source readiness must not read official score fields.');
assert.match(leastPrivilegeMigration, /revoke all on table public\.auxiliary_writing_diagnostic_jobs from service_role/);
assert.match(leastPrivilegeMigration, /revoke all on table public\.auxiliary_writing_diagnostics from service_role/);
assert.match(claimFencingMigration, /add column if not exists claim_token uuid not null/);
assert.match(claimFencingMigration, /v_job\.claim_token is distinct from p_claim_token/,
  'A stale evaluator must not be able to finalize a reclaimed diagnostic job.');
assert.match(claimFencingMigration, /and claim_token = p_claim_token[\s\S]*and status = 'processing'/,
  'Failure updates must also be fenced by the current claim token.');
assert.match(retryBackoffMigration, /v_job\.status = 'failed'[\s\S]*make_interval\(secs => v_retry_seconds\)/,
  'Failed jobs must wait for a database-enforced retry cooldown.');
assert.match(retryBackoffMigration, /least\([\s\S]*900,[\s\S]*power\(2,/,
  'Repeated evaluator failures must use capped exponential backoff.');
assert.match(terminalRetryMigration, /attempt_count >= 20[\s\S]*set status = 'failed',[\s\S]*failure_code = 'AUXILIARY_RETRY_EXHAUSTED'/,
  'Retry exhaustion must be persisted so a killed final worker cannot leave an endless pending row.');
assert.match(routeSource, /const MAX_QUESTIONS_PER_ENSURE = 4/,
  'Each background invocation must cap the number of evaluator calls.');
assert.match(routeSource, /expiredLeaseCandidates/,
  'Expired processing leases must be passed back through the atomic claim RPC.');
assert.match(clientSource, /ensureForRecords/,
  'Legacy graded records need a safe path to queue their auxiliary diagnostics.');
assert.match(clientSource, /uniqueReferences\(records\)\.filter\([\s\S]*?\)\.slice\(0, 8\)\.forEach/,
  'Legacy backfill must skip settled records before selecting a bounded batch.');
assert.match(clientSource, /pollBackgroundReference\(ref, remaining = 12\)/,
  'A scheduled legacy diagnostic must be polled without issuing another expensive ensure request.');
assert.match(indexSource, /ensureForRecords\?\.\([\s\S]*legacy_grading_result/,
  'Legacy grading results must be queued when their Analytics history is loaded.');
assert.match(indexSource, /function analyticsAuxiliaryMarkup\(records\) \{[\s\S]*try \{[\s\S]*catch \(auxiliaryError\)/,
  'Auxiliary Analytics rendering must fail open.');
assert.match(examinationsSource, /try \{[\s\S]*DueDiligenceAuxiliaryDiagnostics\?\.mount[\s\S]*catch \(auxiliaryError\)/,
  'An auxiliary mount error must not replace the official result renderer.');

function routeHarness({
  failEvaluation = false,
  questionCount = 1,
  existingItems = [],
  claimResult = null,
} = {}) {
  const calls = [];
  const pending = [];
  let finalStatus = null;
  const handlers = createAuxiliaryWritingDiagnosticsHandlers({
    enforceDD2026RateLimit: async () => undefined,
    requireAuthenticatedUser: async () => ({ id: VALID_SOURCE_ID_B }),
    parseBoundedJson: async (request) => request.payload,
    jsonResponse: (body, status) => ({ body, status }),
    resolveVerdictQuestion: async () => ({ question: 'Resolved question facts.' }),
    structuredGemini: async (_env, prompt) => {
      calls.push({ operation: 'evaluate', prompt });
      if (failEvaluation) {
        const error = new Error('simulated auxiliary evaluator failure');
        error.code = 'AUXILIARY_TEST_FAILURE';
        throw error;
      }
      return {
        model: 'auxiliary-test-model',
        result: validateAuxiliaryWritingDiagnosticsResult({
          grammarStrength: diagnostic(4, GRAMMAR_COACHING),
          issueSpotting: diagnostic(3, ISSUE_COACHING),
        }),
      };
    },
    dd2026Rpc: async (_env, operation, payload) => {
      calls.push({ operation, payload });
      if (operation === 'dd2026_auxiliary_diagnostic_source') {
        return {
          sourceType: 'examination_attempt',
          sourceId: VALID_SOURCE_ID_A,
          officialScoreSentinel: 'MUST_NOT_ENTER_AUXILIARY_PROMPT',
          questions: Array.from({ length: questionCount }, (_, index) => ({
            questionId: `question-${index + 1}`,
            question: 'Discuss the material legal issues raised by the facts.',
            answer: 'The claimant must first establish the controlling legal issue before relief may be granted.',
          })),
        };
      }
      if (operation === 'dd2026_auxiliary_diagnostic_claim') {
        return claimResult || {
          claimed: true,
          jobId: VALID_SOURCE_ID_A,
          claimToken: VALID_SOURCE_ID_B,
          status: 'processing',
        };
      }
      if (operation === 'dd2026_auxiliary_diagnostic_finish') {
        finalStatus = 'completed';
        return { jobId: VALID_SOURCE_ID_A, status: 'completed' };
      }
      if (operation === 'dd2026_auxiliary_diagnostic_fail') {
        finalStatus = 'failed';
        return { jobId: VALID_SOURCE_ID_A, status: 'failed' };
      }
      if (operation === 'dd2026_auxiliary_diagnostic_records') {
        return finalStatus ? {
          items: [{
            sourceType: 'examination_attempt',
            sourceId: VALID_SOURCE_ID_A,
            questionId: 'question-1',
            expectedQuestions: questionCount,
            status: finalStatus,
          }],
        } : { items: existingItems };
      }
      throw new Error(`Unexpected auxiliary RPC: ${operation}`);
    },
  });
  return {
    calls,
    handlers,
    context: { waitUntil: (promise) => pending.push(promise) },
    wait: () => Promise.all(pending),
  };
}

const successfulRoute = routeHarness();
const ensureResponse = await successfulRoute.handlers.ensure(
  { payload: { sourceType: 'examination_attempt', sourceId: VALID_SOURCE_ID_A } },
  {},
  '',
  '',
  successfulRoute.context,
);
assert.equal(ensureResponse.status, 202,
  'Auxiliary evaluation must be scheduled after the official result can render.');
assert.equal(ensureResponse.body.result.status, 'processing');
assert.doesNotMatch(JSON.stringify(ensureResponse), /officialScoreSentinel|MUST_NOT_ENTER/);
await successfulRoute.wait();
assert.equal(successfulRoute.calls.filter((call) => call.operation === 'evaluate').length, 1);
assert.equal(successfulRoute.calls.filter((call) => call.operation === 'dd2026_auxiliary_diagnostic_finish').length, 1);
assert.equal(successfulRoute.calls.filter((call) => call.operation === 'dd2026_auxiliary_diagnostic_fail').length, 0);
assert.equal(
  successfulRoute.calls.find((call) => call.operation === 'dd2026_auxiliary_diagnostic_finish')
    .payload.p_claim_token,
  VALID_SOURCE_ID_B,
);
assert.doesNotMatch(
  successfulRoute.calls.find((call) => call.operation === 'evaluate').prompt,
  /MUST_NOT_ENTER_AUXILIARY_PROMPT/,
  'Unrelated official-result fields must never enter the auxiliary evaluator prompt.',
);

const failedRoute = routeHarness({ failEvaluation: true });
const failedEnsureResponse = await failedRoute.handlers.ensure(
  { payload: { sourceType: 'examination_attempt', sourceId: VALID_SOURCE_ID_A } },
  {},
  '',
  '',
  failedRoute.context,
);
assert.equal(failedEnsureResponse.status, 202,
  'An auxiliary evaluator failure must not block the already-completed answer result.');
const originalWarn = console.warn;
try {
  console.warn = () => undefined;
  await failedRoute.wait();
} finally {
  console.warn = originalWarn;
}
assert.equal(failedRoute.calls.filter((call) => call.operation === 'dd2026_auxiliary_diagnostic_finish').length, 0);
assert.equal(failedRoute.calls.filter((call) => call.operation === 'dd2026_auxiliary_diagnostic_fail').length, 1);
assert.equal(
  failedRoute.calls.find((call) => call.operation === 'dd2026_auxiliary_diagnostic_fail')
    .payload.p_claim_token,
  VALID_SOURCE_ID_B,
);

const boundedRoute = routeHarness({ questionCount: 6 });
const boundedResponse = await boundedRoute.handlers.ensure(
  { payload: { sourceType: 'examination_attempt', sourceId: VALID_SOURCE_ID_A } },
  {},
  '',
  '',
  boundedRoute.context,
);
assert.equal(boundedResponse.body.result.expectedQuestions, 6);
await boundedRoute.wait();
assert.equal(boundedRoute.calls.filter((call) => call.operation === 'evaluate').length, 4,
  'Only four answers may be evaluated in one bounded background batch.');
assert.ok(boundedRoute.calls.filter((call) => (
  call.operation === 'dd2026_auxiliary_diagnostic_claim'
)).every((call) => call.payload.p_expected_questions === 6));

const synchronousRoute = routeHarness();
const synchronousResponse = await synchronousRoute.handlers.ensure(
  { payload: { sourceType: 'examination_attempt', sourceId: VALID_SOURCE_ID_A } },
  {},
  '',
  '',
);
assert.equal(synchronousResponse.status, 200);
assert.equal(synchronousResponse.body.result.status, 'ready',
  'A synchronous fallback may report ready only after refreshed records confirm completion.');

const staleProcessingRoute = routeHarness({
  existingItems: [{
    sourceType: 'examination_attempt',
    sourceId: VALID_SOURCE_ID_A,
    questionId: 'question-1',
    expectedQuestions: 1,
    status: 'processing',
    updatedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
  }],
});
await staleProcessingRoute.handlers.ensure(
  { payload: { sourceType: 'examination_attempt', sourceId: VALID_SOURCE_ID_A } },
  {},
  '',
  '',
  staleProcessingRoute.context,
);
await staleProcessingRoute.wait();
assert.equal(staleProcessingRoute.calls.filter((call) => (
  call.operation === 'dd2026_auxiliary_diagnostic_claim'
)).length, 1, 'A killed worker lease must become reclaimable after 15 minutes.');
assert.equal(staleProcessingRoute.calls.filter((call) => call.operation === 'evaluate').length, 1);

const freshProcessingRoute = routeHarness({
  existingItems: [{
    sourceType: 'examination_attempt',
    sourceId: VALID_SOURCE_ID_A,
    questionId: 'question-1',
    expectedQuestions: 1,
    status: 'processing',
    updatedAt: new Date().toISOString(),
  }],
});
await freshProcessingRoute.handlers.ensure(
  { payload: { sourceType: 'examination_attempt', sourceId: VALID_SOURCE_ID_A } },
  {},
  '',
  '',
  freshProcessingRoute.context,
);
await freshProcessingRoute.wait();
assert.equal(freshProcessingRoute.calls.filter((call) => (
  call.operation === 'dd2026_auxiliary_diagnostic_claim'
)).length, 0, 'A live evaluator lease must not be reclaimed early.');

const coolingFailureRoute = routeHarness({
  existingItems: [{
    sourceType: 'examination_attempt',
    sourceId: VALID_SOURCE_ID_A,
    questionId: 'question-1',
    expectedQuestions: 1,
    status: 'failed',
    updatedAt: new Date().toISOString(),
  }],
  claimResult: { claimed: false, jobId: VALID_SOURCE_ID_A, status: 'failed' },
});
await coolingFailureRoute.handlers.ensure(
  { payload: { sourceType: 'examination_attempt', sourceId: VALID_SOURCE_ID_A } },
  {},
  '',
  '',
  coolingFailureRoute.context,
);
await coolingFailureRoute.wait();
assert.equal(coolingFailureRoute.calls.filter((call) => (
  call.operation === 'dd2026_auxiliary_diagnostic_claim'
)).length, 1);
assert.equal(coolingFailureRoute.calls.filter((call) => call.operation === 'evaluate').length, 0,
  'A retry-cooling job must not spend another evaluator call or attempt immediately.');

const mixedRecoveryRoute = routeHarness({
  questionCount: 5,
  existingItems: [
    ...Array.from({ length: 4 }, (_, index) => ({
      sourceType: 'examination_attempt',
      sourceId: VALID_SOURCE_ID_A,
      questionId: `question-${index + 1}`,
      expectedQuestions: 5,
      status: 'failed',
      updatedAt: new Date().toISOString(),
    })),
    {
      sourceType: 'examination_attempt',
      sourceId: VALID_SOURCE_ID_A,
      questionId: 'question-5',
      expectedQuestions: 5,
      status: 'processing',
      updatedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    },
  ],
});
await mixedRecoveryRoute.handlers.ensure(
  { payload: { sourceType: 'examination_attempt', sourceId: VALID_SOURCE_ID_A } },
  {},
  '',
  '',
  mixedRecoveryRoute.context,
);
await mixedRecoveryRoute.wait();
assert.ok(mixedRecoveryRoute.calls.some((call) => (
  call.operation === 'dd2026_auxiliary_diagnostic_claim'
    && call.payload.p_question_id === 'question-5'
)), 'Cooling failed jobs must not starve an expired processing lease.');

// Metadata-only feature boundary. No protected source is opened: Git reports
// path names changed from the pinned feature base, and only the isolated
// integration shell plus newly created auxiliary files are permitted.
const FEATURE_BASE = '20b9e48859af64cbf34f2d7d98b3e84ed4daf1d2';
const FEATURE_BRANCH = 'feat/auxiliary-writing-diagnostics';
const git = (...args) => execFileSync('git', args, {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
const currentBranch = git('branch', '--show-current').trim();
const shouldEnforceFeatureBoundary = process.env.AUXILIARY_DIAGNOSTICS_ENFORCE_BASE_GUARD === '1'
  || currentBranch === FEATURE_BRANCH
  || process.env.GITHUB_HEAD_REF === FEATURE_BRANCH;

if (shouldEnforceFeatureBoundary) {
  assert.doesNotThrow(() => git('merge-base', '--is-ancestor', FEATURE_BASE, 'HEAD'),
    'The pinned auxiliary feature base must be an ancestor of HEAD.');
  const tracked = git('diff', '--name-only', '-z', FEATURE_BASE, '--').split('\0').filter(Boolean);
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
  const changedPaths = [...new Set([...tracked, ...untracked])].sort();
  const permitted = [
    /^\.github\/workflows\/deploy\.yml$/,
    /^\.github\/workflows\/deploy-worker\.yml$/,
    /^design-qa\.md$/,
    /^assets\/auxiliary-writing-diagnostics\.(?:css|js)$/,
    /^assets\/examinations\.js$/,
    /^index\.html$/,
    /^scripts\/test-analytics-page\.mjs$/,
    /^scripts\/test-auxiliary-writing-diagnostics\.mjs$/,
    /^scripts\/(?:build|test)-pages-artifact\.mjs$/,
    /^supabase\/migrations\/202608261(?:74331_auxiliary_writing_diagnostics|80126_auxiliary_writing_diagnostics_least_privilege|80430_auxiliary_writing_diagnostics_claim_fencing|83000_auxiliary_writing_diagnostics_retry_backoff|84500_auxiliary_writing_diagnostics_terminal_retry)\.sql$/,
    /^worker\/auxiliary-(?:grammar-strength-rubric|issue-spotting-rubric|writing-diagnostics-core|writing-diagnostics-routes)\.mjs$/,
    /^worker\/index\.mjs$/,
  ];
  const unexpected = changedPaths.filter((changedPath) => (
    !permitted.some((pattern) => pattern.test(changedPath))
  ));
  assert.deepEqual(unexpected, [],
    `Only isolated auxiliary integration paths may change from ${FEATURE_BASE}.`);

  const protectedPath = /(?:^|\/)(?:examination-room|examination_room|exam-room)(?:\/|[-_.]|$)/i;
  assert.deepEqual(changedPaths.filter((changedPath) => protectedPath.test(changedPath)), [],
    'Examination Room paths must remain completely untouched.');
}

console.log('Auxiliary writing diagnostic isolation, validation, presentation, and no-touch checks passed.');

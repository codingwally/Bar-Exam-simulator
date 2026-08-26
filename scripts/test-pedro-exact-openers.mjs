import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const plain = (value) => JSON.parse(JSON.stringify(value));
const [doctrineSource, examinationSource] = await Promise.all([
  readFile(new URL('assets/duediligence-2026.js', root), 'utf8'),
  readFile(new URL('assets/examinations.js', root), 'utf8'),
]);

function extractFunction(source, name) {
  const signature = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = signature.exec(source);
  assert.ok(match, `${name} must exist`);
  const start = match.index;
  const nextFunctionOffset = source.slice(start + match[0].length).search(
    /\n  (?:async\s+)?function\s+[A-Za-z0-9_]+\s*\(/,
  );
  assert.notEqual(nextFunctionOffset, -1, `${name} must have a following function boundary`);
  return source.slice(start, start + match[0].length + nextFunctionOffset).trim();
}

assert.match(
  doctrineSource,
  /global\.openDoctrines = \(options = \{\}\) => open\([\s\S]*?'doctrine'[\s\S]*?options,[\s\S]*?\);/,
  'Doctrine Review must pass optional exact-detail options through the existing opener.',
);

const helperContext = vm.createContext({
  Object,
  Array,
  String,
  Number,
  Error,
  TARGETED_QUESTION_UUID_PATTERN:
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
});
for (const name of [
  'normalizeTargetedQuestion',
  'setupMatchesTargetedQuestion',
  'activeMatchesTargetedQuestion',
  'targetedQuestionError',
]) {
  vm.runInContext(extractFunction(examinationSource, name), helperContext);
}

const versionId = '11111111-1111-4111-8111-111111111111';
const questionId = '22222222-2222-4222-8222-222222222222';
const normalized = vm.runInContext(
  `normalizeTargetedQuestion({ versionId: '${versionId.toUpperCase()}', questionId: ' ${questionId} ' })`,
  helperContext,
);
assert.equal(normalized.versionId, versionId);
assert.equal(normalized.questionId, questionId);
assert.equal(vm.runInContext(
  `normalizeTargetedQuestion({ versionId: '${versionId}', questionId: '${questionId}', url: 'https://example.com' })`,
  helperContext,
), null, 'extra keys, including arbitrary URLs, must be rejected');
assert.equal(vm.runInContext(
  "normalizeTargetedQuestion({ versionId: 'not-a-uuid', questionId: 'also-not-a-uuid' })",
  helperContext,
), null);

helperContext.target = normalized;
helperContext.setup = { versionId, track: 'per_subject', questionCount: 1 };
helperContext.active = {
  attempt: { versionId },
  examination: { track: 'per_subject' },
  questions: [{ questionId }],
};
assert.equal(vm.runInContext('setupMatchesTargetedQuestion(setup, target)', helperContext), true);
assert.equal(vm.runInContext('activeMatchesTargetedQuestion(active, target)', helperContext), true);
helperContext.active.questions[0].questionId = '33333333-3333-4333-8333-333333333333';
assert.equal(vm.runInContext('activeMatchesTargetedQuestion(active, target)', helperContext), false);

const startCalls = [];
const startContext = vm.createContext({
  PRACTICE_TIMER_MODES: [{ value: 'strict' }, { value: 'selfPaced' }, { value: 'none' }],
  state: { preferredTimerMode: 'selfPaced', setup: null },
  api: async (path, body) => {
    startCalls.push({ path, body });
    return startContext.nextActive;
  },
  requestKey: () => 'start_1234567890123456',
  tabToken: () => 'tab_1234567890123456789012345678',
  activeMatchesTargetedQuestion: (active, target) => (
    active?.attempt?.versionId === target.versionId
      && active?.examination?.track === 'per_subject'
      && active?.questions?.length === 1
      && active.questions[0].questionId === target.questionId
  ),
  targetedQuestionError: () => Object.assign(new Error('target mismatch'), {
    code: 'TARGETED_QUESTION_UNAVAILABLE',
  }),
  activateAttempt: (active) => startCalls.push({ activated: active }),
});
vm.runInContext(extractFunction(examinationSource, 'startSubjectSetup'), startContext);
startContext.nextActive = {
  attempt: { versionId },
  examination: { track: 'per_subject' },
  questions: [{ questionId }],
};
startContext.setup = { versionId };
startContext.target = { versionId, questionId };
assert.equal(
  await vm.runInContext(
    "startSubjectSetup(setup, { practiceTimerMode: 'selfPaced', expectedTarget: target })",
    startContext,
  ),
  startContext.nextActive,
);
assert.equal(startCalls.filter((call) => call.activated).length, 1);
assert.deepEqual(plain(startCalls[0].body), {
  operation: 'start_attempt',
  versionId,
  timerMode: 'selfPaced',
  requestKey: 'start_1234567890123456',
  tabToken: 'tab_1234567890123456789012345678',
});

startContext.nextActive = {
  attempt: { versionId },
  examination: { track: 'per_subject' },
  questions: [{ questionId: '33333333-3333-4333-8333-333333333333' }],
};
await assert.rejects(
  vm.runInContext(
    "startSubjectSetup(setup, { practiceTimerMode: 'selfPaced', expectedTarget: target })",
    startContext,
  ),
  (error) => error.code === 'TARGETED_QUESTION_UNAVAILABLE',
);
assert.equal(
  startCalls.filter((call) => call.activated).length,
  1,
  'a mismatched server response must be rejected before it reaches the examination renderer',
);

const openCalls = [];
const openContext = vm.createContext({
  normalizeTargetedQuestion: (value) => (
    value?.versionId === versionId && value?.questionId === questionId ? value : null
  ),
  showTrackPage: (track) => openCalls.push({ track }),
  setStatus: (message, type = '') => openCalls.push({ message, type }),
  api: async (path, body) => {
    openCalls.push({ path, body });
    return openContext.setupResponse;
  },
  setupMatchesTargetedQuestion: (setup, target) => (
    setup?.versionId === target.versionId
      && setup?.track === 'per_subject'
      && setup?.questionCount === 1
  ),
  targetedQuestionError: () => new Error('target unavailable'),
  targetedQuestionTimerMode: () => 'selfPaced',
  startSubjectSetup: async (setup, options) => openCalls.push({ setup, options }),
  isStaleIdentityError: (error) => error?.code === 'STALE_IDENTITY',
});
vm.runInContext(extractFunction(examinationSource, 'openTargetedQuestion'), openContext);
openContext.setupResponse = {
  versionId,
  track: 'per_subject',
  questionCount: 1,
  timerMode: 'selfPaced',
  allowedTimerModes: ['selfPaced'],
};
openContext.target = { versionId, questionId };
assert.equal(await vm.runInContext('openTargetedQuestion(target)', openContext), true);
assert.deepEqual(plain(openCalls.find((call) => call.path)?.body), {
  operation: 'setup',
  versionId,
});
assert.deepEqual(plain(openCalls.find((call) => call.options)?.options), {
  practiceTimerMode: 'selfPaced',
  expectedTarget: openContext.target,
});

const requestCount = openCalls.filter((call) => call.path).length;
assert.equal(await vm.runInContext("openTargetedQuestion({ url: 'https://example.com' })", openContext), false);
assert.equal(openCalls.filter((call) => call.path).length, requestCount,
  'invalid targets must not make authenticated examination requests');

assert.match(examinationSource, /openTargetedQuestion,/);
const openerBlock = extractFunction(examinationSource, 'openTargetedQuestion');
assert.doesNotMatch(openerBlock, /location|history|window\.open|href|url/i,
  'the exact opener must use the fixed in-app examination route, never an arbitrary URL');

console.log('Pedro exact public opener tests passed.');

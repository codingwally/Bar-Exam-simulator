import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

function extractNamedFunction(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `Expected ${name}() to exist.`);
  const parameterStart = source.indexOf('(', match.index);
  let parameterDepth = 0;
  let parameterEnd = -1;
  for (let index = parameterStart; index < source.length; index += 1) {
    if (source[index] === '(') parameterDepth += 1;
    if (source[index] === ')') parameterDepth -= 1;
    if (parameterDepth === 0) {
      parameterEnd = index;
      break;
    }
  }
  const openingBrace = source.indexOf('{', parameterEnd);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(match.index, index + 1);
  }
  assert.fail(`Could not extract ${name}().`);
}

function fakeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(...names) { names.forEach((name) => values.add(name)); },
    remove(...names) { names.forEach((name) => values.delete(name)); },
    toggle(name, force) {
      if (force === true) values.add(name);
      else if (force === false) values.delete(name);
      else if (values.has(name)) values.delete(name);
      else values.add(name);
    },
    contains(name) { return values.has(name); },
  };
}

function fakeAnswer(value) {
  return {
    value,
    dataset: {},
    dispatches: 0,
    dispatchEvent() { this.dispatches += 1; },
    focus() {},
    setAttribute() {},
    removeAttribute() {},
  };
}

function fakeButton(label) {
  return {
    disabled: false,
    textContent: label,
    dataset: {},
    classList: fakeClassList(),
    setAttribute() {},
    removeAttribute() {},
  };
}

const root = new URL('../', import.meta.url);
const [landing, study, examinations, community, publicPage] = await Promise.all([
  readFile(new URL('assets/private-beta-landing.js', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.js', root), 'utf8'),
  readFile(new URL('assets/examinations.js', root), 'utf8'),
  readFile(new URL('assets/lex-forum.js', root), 'utf8'),
  readFile(new URL('index.html', root), 'utf8'),
]);

// A false-return auth/access path must replace "Opening…" with terminal guidance.
async function exerciseFalseNavigation(session) {
  const events = [];
  let reported = null;
  const context = vm.createContext({
    state: { publicNavigationBusy: false, publicNavigationVersion: 0, navigationStatusTimer: null },
    featureLabels: { 'bar-easy': 'Quick Drills' },
    setPublicNavigationBusy() {},
    showNavigationStatus(message, kind) { events.push({ message, kind }); },
    openQuorumHome: async () => false,
    openProtectedFeature: async () => false,
    currentSession: () => session,
    reportNavigationError(message, retry) { reported = { message, retry }; },
    resetQuorumHomeLocation() {},
    clearNavigationStatus() {},
    global: { setTimeout: () => null },
  });
  vm.runInContext(extractNamedFunction(landing, 'runPublicNavigation'), context);
  const opened = await vm.runInContext("runPublicNavigation('bar-easy')", context);
  return { opened, events, reported };
}

const signedOutNavigation = await exerciseFalseNavigation(null);
assert.equal(signedOutNavigation.opened, false);
assert.match(signedOutNavigation.events.at(-1)?.message || '', /Sign in to continue to Quick Drills/);
assert.equal(signedOutNavigation.events.at(-1)?.kind, 'info');
assert.equal(signedOutNavigation.reported, null);

const accessBlockedNavigation = await exerciseFalseNavigation({ access_token: 'token' });
assert.equal(accessBlockedNavigation.opened, false);
assert.match(accessBlockedNavigation.reported?.message || '', /Quick Drills did not open/);
assert.equal(typeof accessBlockedNavigation.reported?.retry, 'function');
assert.match(
  extractNamedFunction(landing, 'showApplication'),
  /options\.activateRoute !== false[\s\S]*clearNavigationStatus\(\)[\s\S]*activateApplicationRoute/,
  'Successful authentication must clear obsolete sign-in guidance before restoring the selected route.',
);

// A grading response must belong to the exact mounted question and answer before committing.
async function exerciseStaleGrade({ kind, view, functionName, endpoint, idleLabel }) {
  const item = { id: `${kind}-old-question`, payload: {} };
  const page = { classList: fakeClassList(['active']) };
  const oldAnswer = fakeAnswer('old submitted answer');
  const oldButton = fakeButton(idleLabel);
  const oldResult = { innerHTML: 'old result placeholder' };
  const elements = new Map([
    [`dd26-${kind}-answer`, oldAnswer],
    [`dd26-${kind}-submit`, oldButton],
    [`dd26-${kind}-result`, oldResult],
    ['page-dd2026', page],
  ]);
  let resolveGrade;
  let requestedPath = '';
  const statusEvents = [];
  const state = {
    view,
    selectedId: item.id,
    filtered: [item],
    busy: false,
    answerRequestGeneration: 0,
    activeAnswerRequest: null,
  };
  const context = vm.createContext({
    state,
    document: { getElementById: (id) => elements.get(id) || null },
    authenticatedUserId: () => 'user-1',
    selectedItem: () => item,
    codePointLength: (value) => [...String(value)].length,
    randomKey: () => `${kind}-request-key`,
    setAnswerButtonBusy(button, busy, _busyLabel, normalLabel) {
      button.disabled = busy;
      if (!busy) button.textContent = normalLabel;
    },
    setAnswerFlowBusy() {},
    setAnswerStatus(_kind, message, status) { statusEvents.push({ message, status }); },
    api(path) {
      requestedPath = path;
      return new Promise((resolve) => { resolveGrade = resolve; });
    },
    escapeHtml: (value) => String(value ?? ''),
    safeSourceLink: () => '',
    betaNotice: () => '',
    Event: class {},
    global: { setTimeout() {} },
  });
  vm.runInContext([
    extractNamedFunction(study, 'invalidateAnswerRequest'),
    extractNamedFunction(study, 'beginAnswerRequest'),
    extractNamedFunction(study, 'isCurrentAnswerRequest'),
    extractNamedFunction(study, 'canCommitAnswerRequest'),
    extractNamedFunction(study, functionName),
  ].join('\n'), context);

  const pendingGrade = vm.runInContext(`${functionName}()`, context);
  assert.equal(requestedPath, endpoint);
  assert.equal(typeof resolveGrade, 'function');

  vm.runInContext('invalidateAnswerRequest()', context);
  const newAnswer = fakeAnswer('new question draft must survive');
  const newButton = fakeButton(idleLabel);
  const newResult = { innerHTML: 'new question result placeholder' };
  elements.set(`dd26-${kind}-answer`, newAnswer);
  elements.set(`dd26-${kind}-submit`, newButton);
  elements.set(`dd26-${kind}-result`, newResult);
  state.view = view;
  state.selectedId = item.id;

  const statusCountBeforeResolution = statusEvents.length;
  resolveGrade({ result: {}, study: {} });
  await pendingGrade;

  assert.equal(newAnswer.value, 'new question draft must survive');
  assert.equal(newAnswer.dispatches, 0);
  assert.equal(newResult.innerHTML, 'new question result placeholder');
  assert.equal(oldAnswer.value, 'old submitted answer');
  assert.equal(oldResult.innerHTML, 'old result placeholder');
  assert.equal(statusEvents.length, statusCountBeforeResolution);
  assert.equal(state.busy, false);
}

await exerciseStaleGrade({
  kind: 'easy',
  view: 'bar_easy',
  functionName: 'gradeBarEasy',
  endpoint: '/dd2026/bar-easy/grade',
  idleLabel: 'Submit answer',
});
await exerciseStaleGrade({
  kind: 'doctrine',
  view: 'doctrine',
  functionName: 'gradeDoctrine',
  endpoint: '/dd2026/doctrines/grade',
  idleLabel: 'Check mastery',
});

// A Syllabus performance completion must not replace a newer Syllabus surface.
const syllabusRoot = {
  isConnected: true,
  firstElementChild: null,
  _html: '',
  set innerHTML(value) {
    this._html = value;
    this.firstElementChild = { owner: this, value };
  },
  get innerHTML() { return this._html; },
};
const syllabusPage = { classList: fakeClassList(['active']) };
let resolvePerformance;
const syllabusState = {
  track: 'per_subject',
  selectedSubject: 'Civil Law',
  subjectPerformanceRequestGeneration: 0,
  subjectPerformanceRequest: null,
};
const syllabusContext = vm.createContext({
  state: syllabusState,
  pageRoot: () => syllabusRoot,
  privateRequestIdentity: () => ({ ownerUserId: 'user-1', generation: 1 }),
  privateRequestIdentityIsCurrent: () => true,
  document: { getElementById: (id) => (id === 'page-midterms' ? syllabusPage : null) },
  api: () => new Promise((resolve) => { resolvePerformance = resolve; }),
  escapeHtml: (value) => String(value ?? ''),
  escapeAttribute: (value) => String(value ?? ''),
  formatDate: () => 'date',
  assessmentCard: () => '',
  subjectPerformanceFailureMessage: () => 'error',
  isStaleIdentityError: () => false,
  focusRendered() {},
  global: { navigator: { onLine: true } },
});
vm.runInContext([
  extractNamedFunction(examinations, 'beginSubjectPerformanceRequest'),
  extractNamedFunction(examinations, 'isCurrentSubjectPerformanceRequest'),
  extractNamedFunction(examinations, 'renderSubjectPerformance'),
].join('\n'), syllabusContext);

const pendingPerformance = vm.runInContext("renderSubjectPerformance('Civil Law')", syllabusContext);
assert.equal(typeof resolvePerformance, 'function');
syllabusRoot.innerHTML = '<div>newly reopened Syllabus catalog</div>';
const newSyllabusSurface = syllabusRoot.firstElementChild;
resolvePerformance({
  recentAttempts: [],
  flaggedForLater: [],
  attemptedQuestions: 1,
  completedQuestions: 1,
  skippedQuestions: 0,
  unassistedCompletedQuestions: 1,
  unassistedAverageScore: 4,
});
assert.equal(await pendingPerformance, false);
assert.equal(syllabusRoot.firstElementChild, newSyllabusSurface);
assert.equal(syllabusRoot.innerHTML, '<div>newly reopened Syllabus catalog</div>');

// A rejected subject request must not clear or relabel a newer same-subject request.
const subjectRequests = [];
const subjectBusyEvents = [];
const subjectStatusEvents = [];
let completedSubject = null;
let handledSubjectErrors = 0;
const subjectContext = vm.createContext({
  SUBJECTS: ['Civil Law'],
  BAR_QUESTIONS: { 'Civil Law': [] },
  subjectSelectionRequestGeneration: 0,
  pendingSubjectSelection: null,
  currentSubj: null,
  currentIdx: 0,
  currentAttemptKey: null,
  examStage: 'idle',
  onboardingStage: 'subjectSelection',
  websiteQuestionBankStatus: 'loading',
  laborQuestionBankStatus: 'loading',
  stopExamSession() {},
  clearPersistedWorkspace() {},
  setWorkspaceLocked() {},
  setSubjectSelectionBusy(busy, subject) { subjectBusyEvents.push({ busy, subject }); },
  setSubjectSelectionStatus(message, kind) { subjectStatusEvents.push({ message, kind }); },
  escapeHtml: (value) => String(value ?? ''),
  document: { getElementById: () => null },
  completeSubjectSelection(subject, generation) {
    if (generation === subjectContext.subjectSelectionRequestGeneration
        && subjectContext.pendingSubjectSelection === subject) completedSubject = subject;
  },
  window: {
    DueDiligencePhase4: {
      loadProtectedQuestion() {
        return new Promise((resolve, reject) => subjectRequests.push({ resolve, reject }));
      },
    },
    DueDiligencePhase2: { handleGradeError() { handledSubjectErrors += 1; } },
  },
});
vm.runInContext([
  extractNamedFunction(publicPage, 'invalidateSubjectSelectionRequest'),
  extractNamedFunction(publicPage, 'selectSubjectForSession'),
].join('\n'), subjectContext);
const oldSubjectRequest = vm.runInContext("selectSubjectForSession('Civil Law')", subjectContext);
assert.equal(subjectRequests.length, 1);
vm.runInContext("invalidateSubjectSelectionRequest({ resetSelectionState: true })", subjectContext);
const newSubjectRequest = vm.runInContext("selectSubjectForSession('Civil Law')", subjectContext);
assert.equal(subjectRequests.length, 2);
const busyEventsBeforeOldFailure = subjectBusyEvents.length;
const statusEventsBeforeOldFailure = subjectStatusEvents.length;
subjectRequests[0].reject(new Error('old request failed'));
assert.equal(await oldSubjectRequest, false);
assert.equal(subjectContext.pendingSubjectSelection, 'Civil Law');
assert.equal(subjectContext.examStage, 'subjectLoading');
assert.equal(subjectBusyEvents.length, busyEventsBeforeOldFailure);
assert.equal(subjectStatusEvents.length, statusEventsBeforeOldFailure);
assert.equal(handledSubjectErrors, 0);
subjectRequests[1].resolve({ id: 'civil-current-question' });
assert.equal(await newSubjectRequest, true);
assert.equal(completedSubject, 'Civil Law');

// Community feed and Study Circles responses must not commit after another view wins.
const communityFeed = {
  children: [],
  attributes: new Map(),
  replaceChildren(...children) { this.children = children; },
  setAttribute(name, value) { this.attributes.set(name, value); },
};
const communityLoadMore = { hidden: false };
const communityRequests = [];
const communityState = {
  view: 'home',
  items: [{ entryId: 'existing-post' }],
  cursor: null,
  hasMore: false,
  filters: { subject: '', entryType: '', category: '', sort: 'latest', query: '' },
  bootstrap: null,
  activeCircleId: null,
  circles: [{ circleId: 'existing-circle' }],
  circleJoinedOnly: false,
  loading: false,
  viewRequestSequence: 0,
  feedRequestSequence: 0,
  feedController: null,
  viewController: null,
  searchController: null,
};
let communityRenderCount = 0;
let communityErrorCount = 0;
const communityContext = vm.createContext({
  state: communityState,
  AbortController,
  document: { createElement: (tagName) => ({ tagName }) },
  $: (selector) => (selector === '#lex-feed' ? communityFeed : selector === '#lex-load-more' ? communityLoadMore : null),
  hasSession: () => true,
  query(operation, payload, options) {
    return new Promise((resolve, reject) => {
      communityRequests.push({ operation, payload, options, resolve, reject });
    });
  },
  setFeedStatus() {},
  renderFeed() { communityRenderCount += 1; },
  handleError() { communityErrorCount += 1; },
  circlesPanel: (items) => ({ type: 'circles-panel', items }),
});
vm.runInContext([
  extractNamedFunction(community, 'cancelCommunityViewRequests'),
  extractNamedFunction(community, 'beginCommunityViewRequest'),
  extractNamedFunction(community, 'isCommunityViewRequestActive'),
  extractNamedFunction(community, 'feedPayload'),
  extractNamedFunction(community, 'refreshFeed'),
  extractNamedFunction(community, 'renderCirclesView'),
].join('\n'), communityContext);

const staleFeed = vm.runInContext('refreshFeed({ viewRequestSequence: state.viewRequestSequence })', communityContext);
assert.equal(communityRequests.length, 1);
assert.equal(communityRequests[0].options.signal.aborted, false);
vm.runInContext("beginCommunityViewRequest(); state.view = 'circles'", communityContext);
assert.equal(communityRequests[0].options.signal.aborted, true);
communityRequests[0].resolve({ items: [{ entryId: 'stale-home-post' }], hasMore: false });
assert.equal(await staleFeed, false);
assert.deepEqual(communityState.items, [{ entryId: 'existing-post' }]);
assert.equal(communityRenderCount, 0);

communityState.view = 'circles';
const staleCircles = vm.runInContext('renderCirclesView(state.viewRequestSequence)', communityContext);
assert.equal(communityRequests.length, 2);
vm.runInContext("beginCommunityViewRequest(); state.view = 'home'", communityContext);
communityFeed.replaceChildren('new Home surface');
communityRequests[1].resolve({ items: [{ circleId: 'stale-circle' }] });
assert.equal(await staleCircles, false);
assert.deepEqual(communityState.circles, [{ circleId: 'existing-circle' }]);
assert.deepEqual(communityFeed.children, ['new Home surface']);
assert.equal(communityErrorCount, 0);

console.log('Public Release 1 async view/request race regressions passed.');

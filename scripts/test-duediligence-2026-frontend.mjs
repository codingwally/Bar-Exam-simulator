import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function extractNamedFunction(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `Expected ${name}() to exist in the production source.`);
  const start = match.index;
  const parameterStart = source.indexOf('(', start);
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
  assert.ok(parameterEnd > parameterStart, `Could not extract the ${name}() parameters.`);
  const openingBrace = source.indexOf('{', parameterEnd);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`Could not extract the complete ${name}() function body.`);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const root = new URL('../', import.meta.url);
const [html, js, css, build, store, examinations, featureLoader, publicLanding] = await Promise.all([
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.js', root), 'utf8'),
  readFile(new URL('assets/duediligence-2026.css', root), 'utf8'),
  readFile(new URL('scripts/build-pages-artifact.mjs', root), 'utf8'),
  readFile(new URL('assets/examination-room-2-store.js', root), 'utf8'),
  readFile(new URL('assets/examinations.js', root), 'utf8'),
  readFile(new URL('assets/feature-loader.js', root), 'utf8'),
  readFile(new URL('assets/private-beta-landing.js', root), 'utf8'),
]);

assert.doesNotMatch(html, /<link[^>]+assets\/duediligence-2026\.css/);
assert.doesNotMatch(html, /<script[^>]+assets\/duediligence-2026\.js/);
assert.match(html, /assets\/feature-loader\.js\?v=question-randomization-20260825-1/);
assert.match(featureLoader, /assets\/duediligence-2026\.css\?v=guided-random-access-20260822-1/);
assert.match(featureLoader, /assets\/duediligence-2026\.js\?v=exam-room-professor-inbox-20260825-1/);
assert.match(build, /assets\/duediligence-2026\.css/);
assert.match(build, /assets\/duediligence-2026\.js/);
assert.doesNotMatch(html, /<script[^>]+assets\/examination-room-2-store\.js/);
assert.match(featureLoader, /assets\/examination-room-2-store\.js\?v=exam-room-ux-20260814-1/);
assert.match(build, /assets\/examination-room-2-store\.js/);

// Capped assessments keep the authoritative final score and omit the provider's
// pre-cap component display, which can otherwise contradict that final score.
const assessmentScoreWasCapped = vm.runInNewContext(
  `(${extractNamedFunction(examinations, 'assessmentScoreWasCapped')})`,
);
assert.equal(assessmentScoreWasCapped({
  score: 2.5,
  appliedScoreCeiling: { code: 'rule_without_application', maximum: 2.5, changedScore: true },
  rubricBreakdown: { conclusion: 5, legalBasis: 5, application: 5, responsiveness: 5 },
}), true);
assert.equal(assessmentScoreWasCapped({
  score: 3.5,
  scoreCeilingCode: 'major_central_gap',
}), true, 'Stored semantic score ceilings must hide the component breakdown.');
assert.equal(assessmentScoreWasCapped({
  score: 2.5,
  errors: ['Score capped because the answer lacks meaningful factual application.'],
}), true, 'Legacy capped assessments must be recognized from their persisted cap note.');
assert.equal(assessmentScoreWasCapped({
  score: 4.6,
  scoreCeilingCode: 'none',
  appliedScoreCeiling: null,
  errors: [],
}), false, 'Uncapped assessments must retain their explanatory component breakdown.');
assert.match(
  examinations,
  /assessmentScoreWasCapped\(assessment\) \? '' : assessmentBreakdown\(assessment\.rubricBreakdown, \{ track \}\)/,
  'Capped assessments must not render a contradictory point-by-point comparison.',
);

for (const [id, feature, handler] of [
  ['spa-bar-easy', 'bar-easy', 'openBarEasy'],
  ['spa-chairs-case', 'chair-cases', 'openChairCases'],
  ['spa-jurisprudence', 'doctrines', 'openDoctrines'],
  ['spa-case-digest', 'anchor-cases', 'openAnchorCases'],
  ['spa-examination-room', 'examination-room', 'openExaminationRoom'],
]) {
  assert.match(html, new RegExp(`id="${id}"[^>]*data-public-feature="${feature}"`));
  assert.match(publicLanding, new RegExp(`feature === '${feature}'[\\s\\S]*?global\\.${handler}\\?\\.\\(\\)`));
  assert.match(js, new RegExp(`global\\.${handler} =`));
}

for (const route of ['bar-easy', 'chairs-cases', 'doctrines', 'anchor-case-digests', 'examination-room']) {
  assert.match(js, new RegExp(`['"]${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`));
}

assert.match(
  js,
  /global\.addEventListener\('duediligence:session',[\s\S]*event\.detail\?\.authenticated[\s\S]*routeFromHash\(\)[\s\S]*open\('exam_room'/,
  'protected 2026 routes must retry after the persisted authentication session becomes ready',
);
assert.match(
  js,
  /state\.exam\.portalPromiseUserId === userId[\s\S]*state\.exam\.portalPromiseGeneration === generation[\s\S]*return state\.exam\.portalPromise/,
  'Concurrent Examination Room restoration may coalesce only for the same user and identity generation.',
);
assert.match(
  js,
  /isExamRoomAvailabilityError\(error\)[\s\S]*features\(\{ forceFresh: true, userId \}\)[\s\S]*if \(!snapshot\) return null[\s\S]*examRoomFeaturesEnabled\(snapshot\)[\s\S]*const payloads = await requestPortal\(\)/,
  'A transient room-availability mismatch may retry once only after a fresh enabled feature snapshot.',
);
assert.match(
  js,
  /const \{ identityChanged \} = synchronizeSessionCaches\(sessionUserId\)[\s\S]*if \(!shouldReopenSessionRoute\(identityChanged, routePageActive\)\) return/,
  'Token refresh and duplicate session signals must not reopen an already active Examination Room.',
);
assert.match(
  js,
  /const sessionUserId = event\.detail\?\.authenticated \? event\.detail\?\.userId \|\| null : null/,
  'Every unauthenticated session event must invalidate the portal as a signed-out identity.',
);
assert.match(
  js,
  /await enrichProfessorExamIntents\(portal\)[\s\S]*if \(!isCurrentExamPortalRequest\(portalUserId, portalGeneration\)\) return false;[\s\S]*state\.exam\.portal = portal/,
  'Portal data must be assigned only after the authenticated user and request generation are revalidated.',
);
assert.match(
  js,
  /function isCurrentExamPortalRequest[\s\S]*state\.view === 'exam_room'[\s\S]*isExamRoomPageActive\(\)[\s\S]*state\.exam\.portalRequestGeneration === generation/,
  'Portal and enrichment continuations must become stale after navigation away from Examination Room.',
);
assert.match(
  js,
  /async function returnToExaminationRoomHome[\s\S]*beginExamPortalLifecycle\(\)[\s\S]*state\.exam\.section = 'entry'/,
  'Returning to the role chooser must invalidate pending role-specific portal work.',
);
assert.match(
  js,
  /const portalGeneration = view === 'exam_room' \|\| previousView === 'exam_room'[\s\S]*beginExamPortalLifecycle\(\)[\s\S]*openExamRoomView\(openUserId, portalGeneration\)/,
  'Every Examination Room entry and exit must invalidate older portal continuations.',
);
assert.match(
  js,
  /\.then\(\(opened\) => \{[\s\S]*opened !== true[\s\S]*state\.sessionUserId !== sessionUserId[\s\S]*authenticatedUserId\(\) !== sessionUserId[\s\S]*selectExamRole/,
  'A stale or failed session restoration must never replay a previous account role intent.',
);

const pendingFeaturePromise = Promise.resolve({ flags: {} });
const sessionCacheState = {
  sessionUserId: 'user-a',
  featureSnapshot: { flags: { EXAMINATION_ROOM_ENABLED: true } },
  featureSnapshotUserId: 'user-a',
  featureSnapshotGeneration: 7,
  featurePromise: pendingFeaturePromise,
  featurePromiseUserId: 'user-a',
  featurePromiseGeneration: 7,
  featureGeneration: 7,
  exam: {
    portalRequestGeneration: 4,
    portalPromise: null,
    portalPromiseUserId: null,
    portalPromiseGeneration: null,
    portal: null,
    roomRequests: null,
  },
};
let sessionCacheHandoffClears = 0;
const sessionCacheContext = {
  state: sessionCacheState,
  clearBeadleStudentHandoff() {
    sessionCacheHandoffClears += 1;
  },
  stopProfessorRoomPolling() {},
};
sessionCacheContext.beginExamPortalLifecycle = vm.runInNewContext(
  `(${extractNamedFunction(js, 'beginExamPortalLifecycle')})`,
  sessionCacheContext,
);
sessionCacheContext.synchronizeExamPortalIdentity = vm.runInNewContext(
  `(${extractNamedFunction(js, 'synchronizeExamPortalIdentity')})`,
  sessionCacheContext,
);
sessionCacheContext.invalidateFeatureCache = vm.runInNewContext(
  `(${extractNamedFunction(js, 'invalidateFeatureCache')})`,
  sessionCacheContext,
);
const synchronizeSessionCaches = vm.runInNewContext(
  `(${extractNamedFunction(js, 'synchronizeSessionCaches')})`,
  sessionCacheContext,
);
const sameUserRefresh = synchronizeSessionCaches('user-a');
assert.equal(sameUserRefresh.identityChanged, false);
assert.equal(
  sameUserRefresh.featureRequestWasPending,
  true,
  'A same-user token refresh must recognize the already pending feature request.',
);
assert.equal(
  sessionCacheState.featurePromise,
  pendingFeaturePromise,
  'A same-user token refresh must preserve the request that phase4 is already refreshing.',
);
assert.equal(sessionCacheState.featureGeneration, 7, 'Preserving an in-flight refresh must not start a new generation.');
const switchedUser = synchronizeSessionCaches('user-b');
assert.equal(switchedUser.identityChanged, true, 'An account switch must invalidate all user-scoped caches.');
assert.equal(sessionCacheState.featurePromise, null);
assert.equal(sessionCacheState.featureGeneration, 8);
assert.equal(
  sessionCacheHandoffClears,
  1,
  'An account switch must discard a persisted Beadle-to-student handoff from the previous account.',
);

const shouldReopenSessionRoute = vm.runInNewContext(
  `(${extractNamedFunction(js, 'shouldReopenSessionRoute')})`,
);
assert.equal(
  shouldReopenSessionRoute(false, true),
  false,
  'A same-user refresh must not recursively reopen an already active protected route.',
);
assert.equal(shouldReopenSessionRoute(true, true), true, 'A changed identity must restore the protected route.');
assert.equal(shouldReopenSessionRoute(false, false), true, 'An inactive protected route may be restored once.');

let authenticatedFeatureUserId = 'user-a';
let featureRequests = [];
const featureState = {
  sessionUserId: 'user-a',
  featureSnapshot: null,
  featureSnapshotUserId: null,
  featureSnapshotGeneration: null,
  featurePromise: null,
  featurePromiseUserId: null,
  featurePromiseGeneration: null,
  featureGeneration: 1,
};
const featureContext = {
  state: featureState,
  authenticatedUserId: () => authenticatedFeatureUserId,
  synchronizeExamPortalIdentity(userId) {
    featureState.sessionUserId = userId;
    return true;
  },
  api(path) {
    const request = deferred();
    featureRequests.push({ path, ...request });
    return request.promise;
  },
};
featureContext.invalidateFeatureCache = vm.runInNewContext(
  `(${extractNamedFunction(js, 'invalidateFeatureCache')})`,
  featureContext,
);
featureContext.isCurrentFeatureRequest = vm.runInNewContext(
  `(${extractNamedFunction(js, 'isCurrentFeatureRequest')})`,
  featureContext,
);
const loadFeatures = vm.runInNewContext(
  `(${extractNamedFunction(js, 'features')})`,
  featureContext,
);
const staleUserAFeatures = loadFeatures({ userId: 'user-a' });
assert.equal(featureRequests.length, 1);
authenticatedFeatureUserId = 'user-b';
featureState.sessionUserId = 'user-b';
featureContext.invalidateFeatureCache();
assert.equal(featureState.featureGeneration, 2);
assert.equal(featureState.featurePromise, null);
featureRequests[0].resolve({ flags: { owner: 'user-a' } });
assert.equal(await staleUserAFeatures, null, 'A previous user’s completed feature request must be discarded.');
assert.equal(featureState.featureSnapshot, null);

featureRequests = [];
const firstUserBFeatures = loadFeatures({ userId: 'user-b' });
const concurrentUserBFeatures = loadFeatures({ userId: 'user-b' });
assert.equal(featureRequests.length, 1, 'Feature requests may coalesce only inside one user/generation scope.');
featureRequests[0].resolve({ flags: { owner: 'user-b' } });
const [firstUserBResult, concurrentUserBResult] = await Promise.all([firstUserBFeatures, concurrentUserBFeatures]);
assert.equal(firstUserBResult.flags.owner, 'user-b');
assert.equal(concurrentUserBResult.flags.owner, 'user-b');
assert.equal(featureState.featureSnapshotUserId, 'user-b');
assert.equal(featureState.featureSnapshotGeneration, 2);
featureContext.invalidateFeatureCache();
assert.equal(featureState.featureGeneration, 3, 'A same-user token refresh must advance the feature generation.');
assert.equal(featureState.featureSnapshot, null);
assert.equal(featureState.featureSnapshotUserId, null);

const disabledRoomFeatures = {
  flags: { EXAMINATION_ROOM_ENABLED: false, EXAMINATION_ROOM_2_ENABLED: true },
};
const enabledRoomFeatures = {
  flags: { EXAMINATION_ROOM_ENABLED: true, EXAMINATION_ROOM_2_ENABLED: true },
};
let roomFeatureResponses = [disabledRoomFeatures, enabledRoomFeatures];
const roomFeatureCalls = [];
const roomFeatureContext = {
  state: { view: 'exam_room' },
  authenticatedUserId: () => 'user-b',
  features: async (options) => {
    roomFeatureCalls.push(options);
    const response = roomFeatureResponses.shift();
    if (response instanceof Error) throw response;
    return response;
  },
  EXAMINATION_ROOM_BASE_FLAG: 'EXAMINATION_ROOM_ENABLED',
  FLAG_NAMES: { exam_room: 'EXAMINATION_ROOM_2_ENABLED' },
};
roomFeatureContext.examRoomFeaturesEnabled = vm.runInNewContext(
  `(${extractNamedFunction(js, 'examRoomFeaturesEnabled')})`,
  roomFeatureContext,
);
const loadExamRoomFeatures = vm.runInNewContext(
  `(${extractNamedFunction(js, 'loadExamRoomFeatures')})`,
  roomFeatureContext,
);
assert.equal(
  await loadExamRoomFeatures('user-b'),
  enabledRoomFeatures,
  'A cached disabled snapshot must be followed by one genuinely fresh enabled snapshot.',
);
assert.equal(roomFeatureCalls.length, 2);
assert.equal(roomFeatureCalls[0].forceFresh, undefined);
assert.equal(roomFeatureCalls[1].forceFresh, true);

roomFeatureCalls.length = 0;
const refreshNetworkError = new Error('feature refresh network failure');
roomFeatureResponses = [disabledRoomFeatures, refreshNetworkError];
await assert.rejects(
  loadExamRoomFeatures('user-b'),
  (error) => error === refreshNetworkError,
  'The real feature-refresh network failure must propagate unchanged.',
);
assert.equal(roomFeatureCalls.length, 2, 'A failed fresh feature request must not loop.');

const stalePortalPromise = Promise.resolve('stale');
const identityState = {
  sessionUserId: 'user-a',
  exam: {
    portal: { owner: 'user-a' },
    portalPromise: stalePortalPromise,
    portalPromiseUserId: 'user-a',
    portalPromiseGeneration: 4,
    portalRequestGeneration: 4,
    roomRequests: { owner: 'user-a' },
  },
};
let identityHandoffClears = 0;
const identityContext = {
  state: identityState,
  stopProfessorRoomPolling() {},
  clearBeadleStudentHandoff() {
    identityHandoffClears += 1;
  },
};
identityContext.beginExamPortalLifecycle = vm.runInNewContext(
  `(${extractNamedFunction(js, 'beginExamPortalLifecycle')})`,
  identityContext,
);
const synchronizeExamPortalIdentity = vm.runInNewContext(
  `(${extractNamedFunction(js, 'synchronizeExamPortalIdentity')})`,
  identityContext,
);
assert.equal(synchronizeExamPortalIdentity('user-b'), true, 'An account switch must invalidate portal state.');
assert.equal(identityState.sessionUserId, 'user-b');
assert.equal(identityState.exam.portalRequestGeneration, 5);
assert.equal(identityState.exam.portalPromise, null);
assert.equal(identityState.exam.portalPromiseUserId, null);
assert.equal(identityState.exam.portalPromiseGeneration, null);
assert.equal(identityState.exam.portal, null);
assert.equal(identityState.exam.roomRequests, null);
assert.equal(identityHandoffClears, 1, 'Switching accounts must clear the prior account handoff marker.');
assert.equal(
  synchronizeExamPortalIdentity('user-b'),
  false,
  'An equivalent same-user session event must preserve the current generation.',
);
assert.equal(identityState.exam.portalRequestGeneration, 5);
identityState.exam.portalPromise = stalePortalPromise;
identityState.exam.portalPromiseUserId = 'user-b';
identityState.exam.portalPromiseGeneration = 5;
identityState.exam.portal = { owner: 'user-b' };
assert.equal(synchronizeExamPortalIdentity(null), true, 'Sign-out must invalidate the current portal request.');
assert.equal(identityState.exam.portalRequestGeneration, 6);
assert.equal(identityState.exam.portalPromise, null);
assert.equal(identityState.exam.portal, null);
assert.equal(identityHandoffClears, 2, 'Signing out must clear the signed-in account handoff marker.');

let authenticatedPortalUserId = 'user-a';
let portalPageActive = true;
let portalRequests = [];
const validRoomSnapshot = (overrides = {}) => ({
  identity: { name: 'User A', email: 'user-a@example.test' },
  roles: {},
  professorRequests: [],
  beadleRequests: [],
  administratorRequests: [],
  unassignedRequests: [],
  ...overrides,
});
const portalState = {
  view: 'exam_room',
  sessionUserId: 'user-a',
  featureSnapshot: null,
  exam: {
    portalPromise: null,
    portalPromiseUserId: null,
    portalPromiseGeneration: null,
    portalRequestGeneration: 1,
    roomRequests: null,
    roomRequestsLoadState: 'idle',
    roomRequestsPromise: null,
    roomRequestsPromiseUserId: null,
    roomRequestsPromiseGeneration: null,
    roomRequestsPromiseForce: false,
  },
};
const portalContext = {
  state: portalState,
  authenticatedUserId: () => authenticatedPortalUserId,
  document: {
    getElementById: () => ({ classList: { contains: () => portalPageActive } }),
  },
  api(path, body) {
    const request = deferred();
    portalRequests.push({ path, operation: body.operation, ...request });
    return request.promise;
  },
  config: { features: { examinationRoom2: true } },
  isExamRoomAvailabilityError: (error) => ['EXAMINATION_ROOM_DISABLED', 'EXAMINATION_ROOM_2_DISABLED'].includes(error?.code),
  isTransientTransportFailure: (error) => error instanceof TypeError
    || (!error?.code && !error?.status)
    || (error?.code === 'REQUEST_FAILED' && (!error?.status || Number(error.status) >= 500)),
  features: async () => ({
    flags: { EXAMINATION_ROOM_ENABLED: true, EXAMINATION_ROOM_2_ENABLED: true },
  }),
  EXAMINATION_ROOM_BASE_FLAG: 'EXAMINATION_ROOM_ENABLED',
  FLAG_NAMES: { exam_room: 'EXAMINATION_ROOM_2_ENABLED' },
};
portalContext.isExamRoomPageActive = vm.runInNewContext(
  `(${extractNamedFunction(js, 'isExamRoomPageActive')})`,
  portalContext,
);
portalContext.isCurrentExamPortalRequest = vm.runInNewContext(
  `(${extractNamedFunction(js, 'isCurrentExamPortalRequest')})`,
  portalContext,
);
portalContext.examRoomFeaturesEnabled = vm.runInNewContext(
  `(${extractNamedFunction(js, 'examRoomFeaturesEnabled')})`,
  portalContext,
);
portalContext.roomRequestsSnapshotIsValid = vm.runInNewContext(
  `(${extractNamedFunction(js, 'roomRequestsSnapshotIsValid')})`,
  portalContext,
);
assert.equal(portalContext.roomRequestsSnapshotIsValid(validRoomSnapshot()), true);
assert.equal(portalContext.roomRequestsSnapshotIsValid({ roles: {}, professorRequests: [] }), false,
  'An incomplete response must never be rendered as an empty request list.');
portalContext.isTransientRoomRequestsError = vm.runInNewContext(
  `(${extractNamedFunction(js, 'isTransientRoomRequestsError')})`,
  portalContext,
);
portalContext.queryRoomRequestsWithSingleRetry = vm.runInNewContext(
  `(${extractNamedFunction(js, 'queryRoomRequestsWithSingleRetry')})`,
  portalContext,
);
portalContext.isCurrentExamPortalLifecycle = (lifecycle) => (
  Boolean(lifecycle)
  && portalContext.isCurrentExamPortalRequest(lifecycle.userId, lifecycle.generation)
);
const loadInitialExamRoomPortal = vm.runInNewContext(
  `(${extractNamedFunction(js, 'loadInitialExamRoomPortal')})`,
  portalContext,
);
const loadRoomRequests = vm.runInNewContext(
  `(${extractNamedFunction(js, 'loadRoomRequests')})`,
  portalContext,
);
const firstPortalLoad = loadInitialExamRoomPortal('user-a', 1);
const concurrentPortalLoad = loadInitialExamRoomPortal('user-a', 1);
assert.equal(portalRequests.length, 2, 'Same-user concurrent loads must issue one portal/request pair.');
portalRequests.find(({ operation }) => operation === 'portal').resolve({ result: { owner: 'user-a' } });
portalRequests.find(({ operation }) => operation === 'room_requests').resolve({ result: validRoomSnapshot({ owner: 'user-a' }) });
const [firstPortalResult, concurrentPortalResult] = await Promise.all([firstPortalLoad, concurrentPortalLoad]);
assert.equal(firstPortalResult[0].result.owner, 'user-a');
assert.equal(concurrentPortalResult[0].result.owner, 'user-a');
assert.equal(portalState.exam.portalPromise, null);
assert.equal(portalState.exam.portalPromiseUserId, null);
assert.equal(portalState.exam.portalPromiseGeneration, null);

portalRequests = [];
portalState.sessionUserId = 'user-a';
portalState.exam.portalRequestGeneration = 2;
authenticatedPortalUserId = 'user-a';
const stalePortalLoad = loadInitialExamRoomPortal('user-a', 2);
assert.equal(portalRequests.length, 2);
portalState.sessionUserId = 'user-b';
portalState.exam.portalRequestGeneration = 3;
portalState.exam.portalPromise = null;
portalState.exam.portalPromiseUserId = null;
portalState.exam.portalPromiseGeneration = null;
authenticatedPortalUserId = 'user-b';
portalRequests.find(({ operation }) => operation === 'portal').resolve({ result: { owner: 'user-a' } });
portalRequests.find(({ operation }) => operation === 'room_requests').resolve({ result: validRoomSnapshot({ owner: 'user-a' }) });
assert.equal(
  await stalePortalLoad,
  null,
  'A completed request from the previous account must be discarded instead of becoming renderable data.',
);

portalRequests = [];
portalState.view = 'exam_room';
portalState.sessionUserId = 'user-a';
portalState.exam.portalRequestGeneration = 4;
authenticatedPortalUserId = 'user-a';
const navigatedAwayPortalLoad = loadInitialExamRoomPortal('user-a', 4);
assert.equal(portalRequests.length, 2);
portalState.view = 'bar_easy';
portalState.exam.portalRequestGeneration = 5;
portalState.view = 'exam_room';
portalRequests.find(({ operation }) => operation === 'portal').resolve({ result: { owner: 'user-a' } });
portalRequests.find(({ operation }) => operation === 'room_requests').resolve({ result: validRoomSnapshot({ owner: 'user-a' }) });
assert.equal(
  await navigatedAwayPortalLoad,
  null,
  'Portal data from a leave-return cycle must stay stale even after Examination Room becomes active again.',
);

portalRequests = [];
portalState.view = 'exam_room';
portalState.sessionUserId = 'user-a';
portalState.exam.portalRequestGeneration = 6;
portalState.exam.portalPromise = null;
portalState.exam.portalPromiseUserId = null;
portalState.exam.portalPromiseGeneration = null;
authenticatedPortalUserId = 'user-a';
portalPageActive = true;
const hiddenPagePortalLoad = loadInitialExamRoomPortal('user-a', 6);
assert.equal(portalRequests.length, 2);
portalPageActive = false;
portalRequests.find(({ operation }) => operation === 'portal').resolve({ result: { owner: 'user-a' } });
portalRequests.find(({ operation }) => operation === 'room_requests').resolve({ result: validRoomSnapshot({ owner: 'user-a' }) });
assert.equal(
  await hiddenPagePortalLoad,
  null,
  'Site-wide navigation must invalidate a portal continuation even when the module-local view value is unchanged.',
);
portalPageActive = true;

portalState.view = 'exam_room';
portalState.sessionUserId = 'user-a';
portalState.exam.portalRequestGeneration = 7;
portalState.exam.portalPromise = null;
portalState.exam.portalPromiseUserId = null;
portalState.exam.portalPromiseGeneration = null;
authenticatedPortalUserId = 'user-a';
let optionalPortalCalls = 0;
let optionalRoomRequestCalls = 0;
portalContext.api = async (path, body) => {
  if (body.operation === 'portal') {
    optionalPortalCalls += 1;
    return { result: { owner: 'user-a' } };
  }
  optionalRoomRequestCalls += 1;
  throw Object.assign(new Error('optional room request failed'), { code: 'REQUEST_FAILED' });
};
portalContext.features = async () => assert.fail('An ordinary optional room-request failure must not refresh features.');
const optionalRoomResult = await loadInitialExamRoomPortal('user-a', 7);
assert.equal(optionalPortalCalls, 1);
assert.equal(optionalRoomRequestCalls, 2, 'A transient room-request failure receives one bounded retry.');
assert.equal(optionalRoomResult[0].result.owner, 'user-a');
assert.equal(optionalRoomResult[1].degraded, true);
assert.equal(optionalRoomResult[1].result, null,
  'A persistent optional failure must not masquerade as an authoritative empty request list.');

portalState.exam.portalRequestGeneration = 8;
portalState.exam.portalPromise = null;
portalState.exam.portalPromiseUserId = null;
portalState.exam.portalPromiseGeneration = null;
let roomDisabledPortalCalls = 0;
let roomDisabledRequestCalls = 0;
let roomDisabledFeatureCalls = 0;
const roomRequestsDisabledError = Object.assign(new Error('room v2 unavailable'), { code: 'EXAMINATION_ROOM_2_DISABLED' });
portalContext.api = async (path, body) => {
  if (body.operation === 'portal') {
    roomDisabledPortalCalls += 1;
    return { result: { owner: 'user-a', attempt: roomDisabledPortalCalls } };
  }
  roomDisabledRequestCalls += 1;
  if (roomDisabledRequestCalls === 1) throw roomRequestsDisabledError;
  return { result: validRoomSnapshot({ requests: [] }) };
};
portalContext.features = async (options) => {
  roomDisabledFeatureCalls += 1;
  assert.equal(options.forceFresh, true);
  assert.equal(options.userId, 'user-a');
  return enabledRoomFeatures;
};
const recoveredRoomRequestsResult = await loadInitialExamRoomPortal('user-a', 8);
assert.equal(roomDisabledFeatureCalls, 1, 'room_requests availability failure must force one fresh feature check.');
assert.equal(roomDisabledPortalCalls, 2, 'room_requests availability recovery must retry the portal pair once.');
assert.equal(roomDisabledRequestCalls, 2, 'room_requests availability recovery must retry that request once.');
assert.equal(recoveredRoomRequestsResult[0].result.attempt, 2);
assert.deepEqual(recoveredRoomRequestsResult[1].result.requests, []);

portalState.exam.portalRequestGeneration = 9;
portalState.exam.portalPromise = null;
portalState.exam.portalPromiseUserId = null;
portalState.exam.portalPromiseGeneration = null;
const availabilityError = Object.assign(new Error('room unavailable'), { code: 'EXAMINATION_ROOM_DISABLED' });
let availabilityPortalCalls = 0;
portalContext.api = async (path, body) => {
  if (body.operation === 'portal') {
    availabilityPortalCalls += 1;
    throw availabilityError;
  }
  return { result: validRoomSnapshot() };
};
portalContext.features = async (options) => {
  assert.equal(options.forceFresh, true);
  throw refreshNetworkError;
};
await assert.rejects(
  loadInitialExamRoomPortal('user-a', 9),
  (error) => error === refreshNetworkError,
  'Availability recovery must propagate its real feature-refresh network failure.',
);
assert.equal(availabilityPortalCalls, 1, 'A failed feature refresh must not retry the portal request.');

portalState.exam.portalRequestGeneration = 10;
portalState.exam.portalPromise = null;
portalState.exam.portalPromiseUserId = null;
portalState.exam.portalPromiseGeneration = null;
let boundedPortalCalls = 0;
let boundedRoomRequestCalls = 0;
portalContext.api = async (path, body) => {
  if (body.operation === 'portal') {
    boundedPortalCalls += 1;
    throw Object.assign(new Error('room unavailable'), { code: 'EXAMINATION_ROOM_DISABLED' });
  }
  boundedRoomRequestCalls += 1;
  return { result: validRoomSnapshot() };
};
portalContext.features = async (options) => {
  assert.equal(options.forceFresh, true);
  return enabledRoomFeatures;
};
await assert.rejects(
  loadInitialExamRoomPortal('user-a', 10),
  (error) => error?.code === 'EXAMINATION_ROOM_DISABLED',
  'The single portal retry must remain fail-closed when the Worker still reports disabled.',
);
assert.equal(boundedPortalCalls, 2, 'Availability recovery must attempt the portal exactly twice in total.');
assert.equal(boundedRoomRequestCalls, 2, 'Each bounded portal attempt may issue one room-request query only.');

portalState.exam.portalRequestGeneration = 11;
portalState.exam.roomRequests = null;
portalState.exam.roomRequestsLoadState = 'idle';
portalState.exam.roomRequestsPromise = null;
portalState.exam.roomRequestsPromiseUserId = null;
portalState.exam.roomRequestsPromiseGeneration = null;
portalState.exam.roomRequestsPromiseForce = false;
const roomLifecycle = { userId: 'user-a', generation: 11 };
let coalescedRoomCalls = 0;
const coalescedRoomRequest = deferred();
portalContext.api = async (_path, body) => {
  assert.equal(body.operation, 'room_requests');
  coalescedRoomCalls += 1;
  return coalescedRoomRequest.promise;
};
const roomLoadA = loadRoomRequests(false, roomLifecycle);
const roomLoadB = loadRoomRequests(false, roomLifecycle);
const roomLoadC = loadRoomRequests(false, roomLifecycle);
assert.equal(coalescedRoomCalls, 1, 'Concurrent room-request loads must share one in-flight request.');
coalescedRoomRequest.resolve({ result: validRoomSnapshot({ roles: { professor: true } }) });
const coalescedResults = await Promise.all([roomLoadA, roomLoadB, roomLoadC]);
assert.equal(coalescedResults.every((entry) => entry.roles.professor === true), true);
assert.equal(portalState.exam.roomRequestsPromise, null, 'The room-request in-flight marker must clear after success.');
assert.equal(portalState.exam.roomRequestsLoadState, 'ready');
await loadRoomRequests(false, roomLifecycle);
assert.equal(coalescedRoomCalls, 1, 'A non-forced load must reuse the safe cached snapshot.');

let forcedRoomCalls = 0;
portalContext.api = async () => {
  forcedRoomCalls += 1;
  return { result: validRoomSnapshot({ roles: { professor: true }, professorRequests: [{ requestId: 'fresh' }] }) };
};
const forcedRoomResult = await loadRoomRequests(true, roomLifecycle);
assert.equal(forcedRoomCalls, 1, 'An explicit refresh must issue exactly one fresh request when it succeeds.');
assert.equal(forcedRoomResult.professorRequests[0].requestId, 'fresh');

const preservedRoomSnapshot = forcedRoomResult;
let failedRoomCalls = 0;
portalContext.api = async () => {
  failedRoomCalls += 1;
  throw Object.assign(new Error('temporary network failure'), { code: 'REQUEST_FAILED', status: 503 });
};
const degradedRoomResult = await loadRoomRequests(true, roomLifecycle);
assert.equal(failedRoomCalls, 2, 'A transient request failure must stop after one retry.');
assert.equal(degradedRoomResult, preservedRoomSnapshot, 'A failed refresh must preserve the last safe request snapshot.');
assert.equal(portalState.exam.roomRequestsPromise, null, 'The room-request in-flight marker must clear after failure.');
assert.equal(portalState.exam.roomRequestsLoadState, 'degraded');
assert.doesNotMatch(js, /Room requests could not load right now/,
  'Optional request-history failure must not create a global warning-toast storm.');

portalState.exam.portalRequestGeneration = 12;
portalState.exam.roomRequests = null;
const staleRoomLifecycle = { userId: 'user-a', generation: 12 };
const staleRoomDeferred = deferred();
portalContext.api = async () => staleRoomDeferred.promise;
const staleRoomLoad = loadRoomRequests(false, staleRoomLifecycle);
portalState.exam.portalRequestGeneration = 13;
staleRoomDeferred.resolve({ result: validRoomSnapshot({ professorRequests: [{ requestId: 'stale' }] }) });
assert.equal(await staleRoomLoad, null, 'A room-request response from an invalidated lifecycle must be discarded.');
assert.equal(portalState.exam.roomRequests, null, 'A stale response must never overwrite current room-request state.');

portalState.exam.portalRequestGeneration = 14;
portalState.exam.roomRequests = null;
portalState.exam.roomRequestsLoadState = 'idle';
let emptyFailureCalls = 0;
portalContext.api = async () => {
  emptyFailureCalls += 1;
  throw Object.assign(new Error('temporary request failure'), { code: 'REQUEST_FAILED', status: 503 });
};
const noSnapshotResult = await loadRoomRequests(true, { userId: 'user-a', generation: 14 });
assert.equal(emptyFailureCalls, 2);
assert.equal(noSnapshotResult, null, 'A request failure with no prior snapshot must remain unknown, not empty.');
assert.equal(portalState.exam.roomRequests, null);
assert.equal(portalState.exam.roomRequestsLoadState, 'degraded');

portalState.exam.portalRequestGeneration = 15;
portalState.exam.roomRequests = null;
portalState.exam.roomRequestsLoadState = 'idle';
const firstRefresh = deferred();
const forcedRefresh = deferred();
let overlappingRefreshCalls = 0;
portalContext.api = async () => {
  overlappingRefreshCalls += 1;
  return overlappingRefreshCalls === 1 ? firstRefresh.promise : forcedRefresh.promise;
};
const baseRefresh = loadRoomRequests(false, { userId: 'user-a', generation: 15 });
const forcedRefreshA = loadRoomRequests(true, { userId: 'user-a', generation: 15 });
const forcedRefreshB = loadRoomRequests(true, { userId: 'user-a', generation: 15 });
firstRefresh.resolve({ result: validRoomSnapshot() });
await baseRefresh;
await Promise.resolve();
assert.equal(overlappingRefreshCalls, 2,
  'Multiple forced refreshes waiting behind one load must coalesce into one follow-up request.');
forcedRefresh.resolve({ result: validRoomSnapshot({ professorRequests: [{ requestId: 'coalesced-force' }] }) });
const forcedResults = await Promise.all([forcedRefreshA, forcedRefreshB]);
assert.equal(forcedResults.every((result) => result.professorRequests[0].requestId === 'coalesced-force'), true);
assert.equal(overlappingRefreshCalls, 2);

portalContext.loadRoomRequestsWithAvailabilityRecovery = async () => {
  throw Object.assign(new Error('refresh unavailable'), { code: 'REQUEST_FAILED', status: 503 });
};
const refreshRoomRequestsAfterMutation = vm.runInNewContext(
  `(${extractNamedFunction(js, 'refreshRoomRequestsAfterMutation')})`,
  portalContext,
);
assert.equal(
  await refreshRoomRequestsAfterMutation({ userId: 'user-a', generation: 15 }),
  false,
  'A secondary refresh failure must not turn a successful primary mutation into a false failure.',
);
assert.equal(portalState.exam.roomRequestsLoadState, 'degraded');

portalContext.roomRequestLoadStatus = vm.runInNewContext(
  `(${extractNamedFunction(js, 'roomRequestLoadStatus')})`,
  portalContext,
);
portalState.exam.roomRequests = null;
assert.match(portalContext.roomRequestLoadStatus(), /temporarily unavailable/);
assert.doesNotMatch(portalContext.roomRequestLoadStatus(), /No Examination Room request/);
portalState.exam.roomRequests = validRoomSnapshot({ professorRequests: [{ requestId: 'last-safe' }] });
assert.match(portalContext.roomRequestLoadStatus(), /last available request status/);

assert.match(js, /sessionUser\.user_metadata/,
  'The Professor request form must retain signed-in identity when request history is unavailable.');
assert.match(js, /await refreshRoomRequestsAfterMutation\(\);[\s\S]{0,120}closeDialog\(\)/,
  'Successful mutations must complete independently of the best-effort request-list refresh.');

assert.match(js, /maxlength="5000"/);
assert.match(js, /maxlength="3000"/);
assert.match(js, /maxlength="20000"/);
assert.match(js, /maxlength="5000"/);
assert.match(js, /id="dd26-exam-title" maxlength="200"/);
assert.match(js, /id="dd26-exam-instructions" maxlength="10000"/);
assert.match(js, /id="dd26-exam-count" type="number" min="1" max="200" step="1"/);
assert.match(js, /attempt\.questions\.length/);
assert.match(js, /preview\.questions\.length/);

assert.match(js, /Your answer text and coaching explanation are not saved/);
assert.match(js, /Your answer text is not saved\. Only your thumbs-up or thumbs-down mastery result is recorded/);
assert.match(js, /return `dd:exam-room:grading:/,
  'Professor grading drafts must use a narrowly namespaced local key.');
assert.match(js, /global\.localStorage\?\.setItem\(gradingDraftKey/,
  'Professor grading drafts must survive an accidental tab or window switch.');
assert.doesNotMatch(js, /localStorage[^\n]*(?:answerText|studentAnswer)|(?:answerText|studentAnswer)[^\n]*localStorage/,
  'Student answers must not be copied into localStorage by the public 2026 experience.');
assert.doesNotMatch(js, /sessionStorage/);
assert.match(store, /indexedDB/);
assert.doesNotMatch(store, /localStorage|sessionStorage/);
assert.match(js, /snapshot\?\.flags\?\.\[flag\] !== true/);
assert.match(js, /AI-assisted educational content/);
assert.match(js, /Source-based coaching/);
assert.doesNotMatch(js, /AI-prepared beta|Gemini coaching|Gemini explanation/);

assert.match(js, /readonly aria-readonly="true"/);
assert.doesNotMatch(js, /operation: '(?:open_dispute|dispute_view|close_dispute)'/,
  'the public bundle must not expose the retired broad dispute viewer');
assert.match(js, /open_book/);
assert.match(js, /operation: 'live_status_v3'/);
assert.match(js, /data-dd26-monitor-exam/);
assert.match(js, /visibility_exit/);
assert.match(js, /focus_exit/);
assert.match(js, /context_menu_attempt/);
assert.match(js, /addEventListener\('contextmenu', contextMenuIncident, true\)/);
assert.match(js, /surface\.contains\(event\.target\)/,
  'right-click deterrence must remain scoped to the active examination surface');
assert.match(js, /addEventListener\('copy', clipboardIncident, true\)/);
assert.match(js, /addEventListener\('cut', clipboardIncident, true\)/);
assert.match(js, /addEventListener\('paste', clipboardIncident, true\)/);
assert.match(js, /copy_attempt/);
assert.match(js, /paste_attempt/);
assert.match(js, /visibilitychange/);
assert.match(js, /fullscreenchange/);
assert.match(js, /not proof by themselves/);
assert.doesNotMatch(js, /leak[- ]?proof/i);
const examinationRoomEntry = js.slice(
  js.indexOf('function examEntry()'),
  js.indexOf('function bindExamEntry()'),
);
assert.match(examinationRoomEntry, /\['professor', 'Professor'/);
assert.match(examinationRoomEntry, /\['student', 'Student'/);
assert.doesNotMatch(examinationRoomEntry, /\['(?:beadle|exam_administrator)'/,
  'the public Examination Room entry must expose only Professor and Student');
assert.match(js, /Submission pending — not yet received by Due Diligence/);
assert.match(js, /Saved on this device/);
assert.match(js, /Synced at/);

assert.match(js, /openVerdictExport/);
assert.match(js, /selectionKind/);
assert.match(js, /selectedIds/);
assert.match(html, /openVerdictExport/);
assert.match(css, /#031a33/);
assert.match(css, /#c5a059/i);
assert.match(css, /'Playfair Display'/);
assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
assert.match(css, /animation-duration:\.01ms!important/);

console.log('DueDiligence 2026 frontend contracts passed.');

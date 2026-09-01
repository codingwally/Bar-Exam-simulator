import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [phase2, phase4, landing, indexHtml, serviceWorker] = await Promise.all([
  readFile(new URL('../assets/phase2-experience.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/phase4-experience.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/private-beta-landing.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../service-worker.js', import.meta.url), 'utf8'),
]);

function extractNamedFunction(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(source);
  assert.ok(match, `Expected ${name}() to exist in production source.`);
  const openingBrace = match.index + match[0].lastIndexOf('{');
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(match.index, index + 1);
  }
  assert.fail(`Could not extract ${name}().`);
}

const routineReasons = new Set(['refresh', 'TOKEN_REFRESHED']);
const handleAuthStateChangeSource = extractNamedFunction(phase2, 'handleAuthStateChange');
assert.match(handleAuthStateChangeSource, /if \(session && sessionChanged\)/);
assert.doesNotMatch(
  handleAuthStateChangeSource,
  /TOKEN_REFRESHED/,
  'Token refresh must never relaunch profile, terms, or access bootstrap.',
);
assert.match(
  extractNamedFunction(phase2, 'dispatchSessionState'),
  /routineSessionRefreshReasons\.has\(reason\)[\s\S]*return false/,
  'Routine refreshes must be suppressed before the global session event is dispatched.',
);

let ownerStateLoads = 0;
const ownerTimers = [];
const ownerEvents = [];
const ownerContext = vm.createContext({
  routineSessionRefreshReasons: routineReasons,
  authAttemptStorageKey: 'auth-attempt',
  state: {
    sessionEventInitialized: true,
    lastSessionEventUserId: 'user-a',
    lastSessionEventAccessToken: 'token-a',
    session: { access_token: 'token-a', user: { id: 'user-a' } },
    user: { id: 'user-a' },
    profile: { id: 'profile-a' },
    admin: { authorized: true },
    welcomedUserId: 'user-a',
    userStatePromise: Promise.resolve(),
    userStateUserId: 'user-a',
    privateBetaAllowed: true,
  },
  global: {
    dispatchEvent(event) { ownerEvents.push(event.detail); },
    DueDiligencePrivateBeta: { clear() {} },
    DueDiligenceAnalytics: { track() {} },
  },
  CustomEvent: class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init.detail; }
  },
  config: { features: { privateBetaGate: false } },
  safeSessionRemove() {},
  resetGoogleSignIn() {},
  syncAuthUi() {},
  setTimeout(callback) { ownerTimers.push(callback); },
  notifyOwnerOfSuccessfulSignIn() {},
  closeEntry() {},
  loadUserState() { ownerStateLoads += 1; return Promise.resolve(); },
  Date,
});
vm.runInContext(
  `${extractNamedFunction(phase2, 'dispatchSessionState')}\n${handleAuthStateChangeSource}`,
  ownerContext,
);
ownerContext.handleAuthStateChange('TOKEN_REFRESHED', {
  access_token: 'token-a-rotated',
  user: { id: 'user-a' },
});
assert.equal(ownerEvents.length, 0);
assert.equal(ownerTimers.length, 0, 'A same-user token rotation must schedule no bootstrap work.');
assert.deepEqual(ownerContext.state.profile, { id: 'profile-a' });
assert.deepEqual(ownerContext.state.admin, { authorized: true });
ownerContext.handleAuthStateChange('TOKEN_REFRESHED', {
  access_token: 'token-b',
  user: { id: 'user-b' },
});
assert.deepEqual(ownerEvents.map(({ reason, userId }) => ({ reason, userId })), [
  { reason: 'SIGNED_IN', userId: 'user-b' },
]);
assert.equal(ownerContext.state.profile, null, 'An identity change must clear the previous profile immediately.');
assert.equal(ownerContext.state.admin, null, 'An identity change must clear the previous admin context immediately.');
assert.equal(ownerTimers.length, 1, 'An unexpected refreshed identity must bootstrap exactly once.');
ownerTimers.shift()();
await Promise.resolve();
assert.equal(ownerStateLoads, 1);

let phase4Refreshes = 0;
const phase4Timers = [];
const phase4State = {
  access: { allowed: true },
  accessAuthRetryBlockedUntil: 123,
  setupGate: false,
  paymentGate: false,
  gateNoticeShown: false,
  pendingRoute: '',
  subjectReviewAccessGate: null,
  lastFocusRefreshAt: 0,
};
const handlePhase4SessionChange = vm.runInNewContext(
  `(${extractNamedFunction(phase4, 'handlePhase4SessionChange')})`,
  {
    state: phase4State,
    ROUTINE_SESSION_REFRESH_REASONS: routineReasons,
    setTimeout(callback) { phase4Timers.push(callback); },
    refreshAccess() {
      phase4Refreshes += 1;
      return Promise.resolve({ allowed: true });
    },
    document: { documentElement: { classList: { remove() {} } } },
    syncAccessUi() {},
  },
);
handlePhase4SessionChange({ detail: { authenticated: true, reason: 'refresh' } });
handlePhase4SessionChange({ detail: { authenticated: true, reason: 'TOKEN_REFRESHED' } });
assert.equal(phase4Timers.length, 0, 'Routine refreshes must schedule zero access checks.');
assert.equal(phase4Refreshes, 0);
handlePhase4SessionChange({ detail: { authenticated: true, reason: 'SIGNED_IN' } });
assert.equal(phase4Timers.length, 1, 'A genuine sign-in must schedule one access check.');
phase4Timers.shift()();
await Promise.resolve();
assert.equal(phase4Refreshes, 1);
assert.equal(phase4State.accessAuthRetryBlockedUntil, 0);

let landingSyncs = 0;
const handleLandingSessionChange = vm.runInNewContext(
  `(${extractNamedFunction(landing, 'handleLandingSessionChange')})`,
  {
    routineSessionRefreshReasons: routineReasons,
    syncAuthenticatedState() { landingSyncs += 1; },
  },
);
handleLandingSessionChange({ detail: { authenticated: true, reason: 'refresh' } });
handleLandingSessionChange({ detail: { authenticated: true, reason: 'TOKEN_REFRESHED' } });
assert.equal(landingSyncs, 0, 'Routine refreshes must not reopen or navigate Home.');
handleLandingSessionChange({ detail: { authenticated: true, reason: 'SIGNED_IN' } });
assert.equal(landingSyncs, 1, 'A genuine sign-in must still enter the authenticated application once.');

let shellProfileLoads = 0;
let headerRenders = 0;
const shellState = { examinationRoomDoorRequest: 0, nativeView: '', user: { id: 'user-1' } };
const handlePhase2SessionChange = vm.runInNewContext(
  `(${extractNamedFunction(phase2, 'handlePhase2SessionChange')})`,
  {
    routineSessionRefreshReasons: routineReasons,
    state: shellState,
    checkProfessorDoor() {},
    renderHeaderAccountControl() { headerRenders += 1; },
    loadAccountProfilePhoto() {
      shellProfileLoads += 1;
      return Promise.resolve();
    },
  },
);
handlePhase2SessionChange({ detail: { authenticated: true, reason: 'TOKEN_REFRESHED' } });
assert.equal(headerRenders, 0);
assert.equal(shellProfileLoads, 0, 'Token refresh must not reload owner profile UI.');
handlePhase2SessionChange({ detail: { authenticated: true, reason: 'SIGNED_IN' } });
assert.equal(headerRenders, 1);
assert.equal(shellProfileLoads, 1);

let fetchCalls = 0;
let refreshCalls = 0;
const request = vm.runInNewContext(
  `(${extractNamedFunction(phase4, 'request')})`,
  {
    authenticatedHeaders: () => ({ Authorization: 'Bearer test' }),
    config: { workerUrl: 'https://worker.invalid' },
    FormData: class FormData {},
    fetch: async () => {
      fetchCalls += 1;
      return {
        ok: false,
        status: 401,
        async json() {
          return { ok: false, error: { code: 'INVALID_SESSION', message: 'Invalid session.' } };
        },
      };
    },
    legacy: {
      async refreshSession() {
        refreshCalls += 1;
        return { access_token: 'rotated-token' };
      },
    },
    refreshAccess: () => assert.fail('A 401 access check must not enter 403 recovery.'),
    isSubjectReviewAccessError: () => false,
    legalRequired: () => false,
    reauthenticationRequired: () => false,
    profileRequired: () => false,
    paymentRequired: () => false,
    paidSubscriptionExpired: () => false,
    accessMessage: () => '',
  },
);
await assert.rejects(
  request('/access', { requestId: false, recoverAccess: false }),
  (error) => error.authRetryExhausted === true,
);
assert.equal(fetchCalls, 2, 'A failed access check gets exactly one retry.');
assert.equal(refreshCalls, 1, 'The one access retry gets exactly one session refresh.');

let now = 10_000;
let cooldownRequests = 0;
const cooldownState = {
  access: null,
  accessPromise: null,
  accessAuthRetryBlockedUntil: 0,
};
const refreshAccess = vm.runInNewContext(
  `(${extractNamedFunction(phase4, 'refreshAccess')})`,
  {
    state: cooldownState,
    session: () => ({ access_token: 'session' }),
    syncAccessUi() {},
    request: async () => {
      cooldownRequests += 1;
      const error = new Error('Invalid session.');
      error.authRetryExhausted = true;
      throw error;
    },
    adoptAccess: () => assert.fail('A failed request must not adopt access.'),
    enforceResolvedAccess() {},
    ACCESS_AUTH_RETRY_COOLDOWN_MS: 5_000,
    Date: { now: () => now },
    Error,
  },
);
await assert.rejects(refreshAccess(), /Invalid session/);
assert.equal(cooldownRequests, 1);
await assert.rejects(refreshAccess(), (error) => error.code === 'AUTHENTICATION_RETRY_COOLDOWN');
assert.equal(cooldownRequests, 1, 'The exhausted retry must not immediately re-enter itself.');
now += 5_001;
await assert.rejects(refreshAccess(), /Invalid session/);
assert.equal(cooldownRequests, 2, 'A later user/browser recovery attempt remains possible.');

let completedProfileLoads = 0;
const completedState = {
  nativeView: '',
  user: { id: 'new-user' },
  userStatePromise: Promise.resolve(),
  userStateUserId: 'new-user',
};
const handleProfileCompleted = vm.runInNewContext(
  `(${extractNamedFunction(phase2, 'handleProfileCompleted')})`,
  {
    state: completedState,
    checkProfessorDoor() {},
    loadUserState() {
      completedProfileLoads += 1;
      return Promise.resolve();
    },
    global: { toast() {} },
  },
);
handleProfileCompleted();
await Promise.resolve();
assert.equal(completedState.userStatePromise, null);
assert.equal(completedState.userStateUserId, null);
assert.equal(completedProfileLoads, 1, 'Completing first-user onboarding must resume setup exactly once.');

for (const asset of ['phase2-experience.js', 'phase4-experience.js', 'private-beta-landing.js']) {
  assert.match(indexHtml, new RegExp(`${asset.replace('.', '\\.') }[^"\\n]*auth=login-loop-p0-20260901-1`));
}
assert.match(serviceWorker, /duediligence-shell-access-flow-20260902-1/);
assert.match(serviceWorker, /phase2-experience\.js[^'\n]*auth=login-loop-p0-20260901-1/);
assert.match(serviceWorker, /private-beta-landing\.js[^'\n]*auth=login-loop-p0-20260901-1/);

console.log('P0 login-loop regression checks passed.');

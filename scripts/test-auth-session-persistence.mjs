import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [storageSource, phase2, phase4, landing, admin, indexHtml, adminHtml] = await Promise.all([
  readFile(new URL('../assets/auth-session-storage.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/phase2-experience.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/phase4-experience.js', import.meta.url), 'utf8'),
  readFile(new URL('../assets/private-beta-landing.js', import.meta.url), 'utf8'),
  readFile(new URL('../admin/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../admin/index.html', import.meta.url), 'utf8'),
]);

function extractNamedFunction(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, `Expected ${name}() to exist in the production source.`);
  const start = match.index;
  const openingBrace = source.indexOf('{', start);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`Could not extract the complete ${name}() function body.`);
}

class MemoryStorage {
  constructor(entries = []) {
    this.values = new Map(entries);
  }

  get length() {
    return this.values.size;
  }

  key(index) {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const projectUrl = 'https://hbllomlijfznnuudpdvr.supabase.co';
const authKey = 'sb-hbllomlijfznnuudpdvr-auth-token';
const legacySession = JSON.stringify({
  access_token: 'legacy-access-token',
  refresh_token: 'legacy-refresh-token',
  expires_at: 2_000_000_000,
});
const olderPersistentSession = JSON.stringify({
  access_token: 'older-access-token',
  refresh_token: 'older-refresh-token',
  expires_at: 1_900_000_000,
});
const temporary = new MemoryStorage([
  [authKey, legacySession],
  [`${authKey}-code-verifier`, 'pkce-verifier'],
]);
const persistent = new MemoryStorage([[authKey, olderPersistentSession]]);
const window = { localStorage: persistent, sessionStorage: temporary };
window.window = window;

vm.runInNewContext(storageSource, {
  window,
  URL,
  JSON,
  Number,
  Object,
  String,
});

const authStorage = window.DueDiligenceAuthSessionStorage;
assert.ok(authStorage);
assert.equal(authStorage.storageKey(projectUrl), authKey);
assert.equal(authStorage.prepare(projectUrl), persistent);
assert.equal(persistent.getItem(authKey), legacySession);

const staleTemporarySession = JSON.stringify({
  access_token: 'stale-access-token',
  refresh_token: 'stale-refresh-token',
  expires_at: 1_800_000_000,
});
const newerPersistentSession = JSON.stringify({
  access_token: 'newer-access-token',
  refresh_token: 'newer-refresh-token',
  expires_at: 2_100_000_000,
});
temporary.setItem(authKey, staleTemporarySession);
persistent.setItem(authKey, newerPersistentSession);
assert.equal(authStorage.prepare(projectUrl), persistent);
assert.equal(persistent.getItem(authKey), newerPersistentSession);
assert.equal(
  temporary.getItem(authKey),
  null,
  'An obsolete temporary session must not survive to resurrect after deliberate sign-out.',
);
assert.equal(persistent.getItem(`${authKey}-code-verifier`), 'pkce-verifier');
assert.equal(temporary.getItem(authKey), null);
assert.equal(temporary.getItem(`${authKey}-code-verifier`), null);
assert.equal(authStorage.prepare(projectUrl), persistent);
assert.equal(persistent.getItem(authKey), newerPersistentSession);

const blockedPersistent = {
  getItem() { return null; },
  setItem() { throw new Error('blocked'); },
  removeItem() {},
};
const fallbackWindow = {
  localStorage: blockedPersistent,
  sessionStorage: new MemoryStorage(),
};
fallbackWindow.window = fallbackWindow;
vm.runInNewContext(storageSource, {
  window: fallbackWindow,
  URL,
  JSON,
  Number,
  Object,
  String,
});
assert.equal(
  fallbackWindow.DueDiligenceAuthSessionStorage.prepare(projectUrl),
  fallbackWindow.sessionStorage,
  'Browsers that block persistent storage must retain a functional tab session.',
);

const throwingWindow = {};
Object.defineProperties(throwingWindow, {
  localStorage: { get() { throw new Error('blocked'); } },
  sessionStorage: { get() { return temporary; } },
  window: { value: throwingWindow },
});
vm.runInNewContext(storageSource, {
  window: throwingWindow,
  URL,
  JSON,
  Number,
  Object,
  String,
});
assert.equal(
  throwingWindow.DueDiligenceAuthSessionStorage.prepare(projectUrl),
  temporary,
  'A browser storage access exception must not prevent application startup.',
);

for (const [name, source] of [['main app', phase2], ['admin app', admin]]) {
  assert.match(source, /DueDiligenceAuthSessionStorage\?\.prepare\?\.\(config\.supabase\.url\)/);
  assert.match(source, /persistSession:\s*true/);
  assert.match(source, /storage:\s*authStorage/);
  assert.match(source, /autoRefreshToken:\s*true/);
}

for (const [name, html] of [['main app', indexHtml], ['admin app', adminHtml]]) {
  const helper = html.indexOf('auth-session-storage.js');
  const caller = html.indexOf(name === 'main app' ? 'phase2-experience.js' : 'admin.js');
  assert.ok(helper >= 0 && caller > helper, `${name} must load durable storage before auth initialization.`);
}

const onboardingExit = phase2.slice(
  phase2.indexOf('function returnFromOnboarding()'),
  phase2.indexOf('function continueFromGuestReminder()'),
);
assert.doesNotMatch(onboardingExit, /signOut|state\.session\s*=\s*null/);
assert.match(onboardingExit, /DueDiligencePublicHome\?\.show/);
assert.match(phase2, /whenAuthReady:\s*\(\)\s*=>\s*authReady/);
assert.match(landing, /await global\.DueDiligencePhase2\?\.whenAuthReady\?\.\(\)/);
assert.match(phase2, /auth\.refreshSession\(\)/);
assert.match(phase4, /await legacy\.refreshSession\?\.\(\)/);
assert.match(phase2, /\{ attemptRefresh: false \}/);
assert.match(phase4, /error\.authRetryExhausted = authenticationError/);
assert.match(phase2, /attemptRefresh: error\?\.authRetryExhausted !== true/);
assert.match(
  phase2,
  /function dispatchSessionState\(session,[\s\S]*state\.lastSessionEventUserId === userId[\s\S]*state\.lastSessionEventAccessToken === accessToken[\s\S]*return false/,
  'Equivalent Supabase session notifications must be dispatched only once.',
);
assert.match(
  phase2,
  /if \(state\.userStatePromise && state\.userStateUserId === userId\)[\s\S]*return state\.userStatePromise/,
  'Concurrent profile restoration must share one in-flight request.',
);
assert.match(
  phase2,
  /if \(state\.welcomedUserId !== userId\)[\s\S]*Welcome back/,
  'A restored account must receive only one welcome notification per page lifecycle.',
);
assert.match(
  extractNamedFunction(phase2, 'restoreAuthDestination'),
  /if \(!state\.authReturnPending\) return;[\s\S]*state\.authReturnPending = false;[\s\S]*safeSessionRemove\(authReturnStorageKey\)[\s\S]*history\.replaceState\([\s\S]*dueDiligenceRoute:\s*'quorum'[\s\S]*#quorum[\s\S]*PopStateEvent\('popstate'/,
  'Only a genuine completed authentication return may send the user to Quorum.',
);
assert.match(
  phase2,
  /authReturnPending:\s*isAuthenticationReturn\(\)/,
  'Authentication-return state must be captured once so ordinary session refreshes preserve the active page.',
);
assert.doesNotMatch(
  extractNamedFunction(phase2, 'restoreAuthDestination'),
  /openPremiumBarFeels|openPerSubject|openExaminationRoom|showPage/,
  'A stale protected route must never reopen automatically after sign-in.',
);
assert.match(
  extractNamedFunction(phase2, 'recoverAuthAfterNavigation'),
  /state\.session = data\.session;[\s\S]*state\.user = data\.session\.user \|\| null;[\s\S]*dispatchSessionState\(data\.session, 'navigation-recovery'\);[\s\S]*await loadUserState\(\);/,
  'BFCache and app-switch recovery must republish the restored identity and refresh owner-scoped state.',
);

const dispatchedSessions = [];
const dispatchContext = {
  state: {
    sessionEventInitialized: false,
    lastSessionEventUserId: null,
    lastSessionEventAccessToken: null,
  },
  global: {
    dispatchEvent(event) {
      dispatchedSessions.push(event.detail);
    },
  },
  CustomEvent: class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init.detail;
    }
  },
};
const dispatchSessionState = vm.runInNewContext(
  `(${extractNamedFunction(phase2, 'dispatchSessionState')})`,
  dispatchContext,
);
const restoredSession = {
  access_token: 'restored-access-token',
  user: { id: 'restored-user' },
};
assert.equal(dispatchSessionState(restoredSession, 'initial-session'), true);
assert.equal(
  dispatchSessionState(restoredSession, 'INITIAL_SESSION'),
  false,
  'The equivalent Supabase INITIAL_SESSION callback must not redispatch an explicitly restored session.',
);
assert.equal(
  dispatchSessionState(restoredSession, 'auth-callback'),
  false,
  'An equivalent authentication callback must not redispatch the same user and access token.',
);
assert.deepEqual(
  dispatchedSessions.map(({ authenticated, userId }) => ({ authenticated, userId })),
  [{ authenticated: true, userId: 'restored-user' }],
  'Equivalent startup session events must produce exactly one public session event.',
);
assert.equal(
  dispatchSessionState({ ...restoredSession, access_token: 'refreshed-access-token' }, 'TOKEN_REFRESHED'),
  true,
  'A genuinely refreshed access token must still dispatch a new session event.',
);

let resolveUserState;
let userStateLoads = 0;
const coalescedResult = { profile: 'restored' };
const coalescingState = {
  client: {},
  user: { id: 'restored-user' },
  userStatePromise: null,
  userStateUserId: null,
};
const loadUserState = vm.runInNewContext(
  `(${extractNamedFunction(phase2, 'loadUserState')})`,
  {
    state: coalescingState,
    deferOnboardingForPrivateBeta: () => false,
    loadUserStateFor: () => {
      userStateLoads += 1;
      return new Promise((resolve) => {
        resolveUserState = resolve;
      });
    },
  },
);
const firstUserStateLoad = loadUserState();
const concurrentUserStateLoad = loadUserState();
assert.equal(userStateLoads, 1, 'Concurrent profile restoration calls must start only one backend load.');
resolveUserState(coalescedResult);
assert.deepEqual(
  await Promise.all([firstUserStateLoad, concurrentUserStateLoad]),
  [coalescedResult, coalescedResult],
  'Every coalesced caller must receive the same completed restoration result.',
);
assert.equal(coalescingState.userStatePromise, null, 'The completed in-flight restoration must be released.');
assert.equal(coalescingState.userStateUserId, null, 'The completed restoration user marker must be released.');

const welcomeMessages = [];
let restoredDestinations = 0;
const welcomeState = {
  client: {
    from() {
      const query = {
        select() { return query; },
        eq() { return query; },
        maybeSingle() {
          return Promise.resolve({ data: {
            id: welcomeState.user.id,
            display_name: 'Esteban',
            profile_completed_at: '2026-08-13T00:00:00Z',
          } });
        },
        limit() {
          return Promise.resolve({
            data: [{ accepted_at: '2026-08-13T00:00:00Z' }],
          });
        },
      };
      return query;
    },
  },
  user: { id: 'restored-user', user_metadata: {} },
  session: { access_token: 'restored-access-token' },
  profile: null,
  admin: null,
  welcomedUserId: null,
};
const loadUserStateFor = vm.runInNewContext(
  `(${extractNamedFunction(phase2, 'loadUserStateFor')})`,
  {
    state: welcomeState,
    config: {
      legal: { termsVersion: 'terms-test', privacyVersion: 'privacy-test' },
      features: { adminDashboard: false },
      workerUrl: 'https://worker.invalid',
    },
    commercialLegal: {
      termsVersion: 'terms-commercial-v1-2026-08-18',
      privacyVersion: 'privacy-commercial-v1-2026-08-18',
    },
    refreshLegalPolicy: async () => ({
      termsVersion: 'terms-commercial-v1-2026-08-18',
      privacyVersion: 'privacy-commercial-v1-2026-08-18',
    }),
    global: {
      toast(message, tone) {
        welcomeMessages.push({ message, tone });
      },
    },
    fetch: () => assert.fail('Admin fetch must remain disabled in this focused restoration harness.'),
    syncAuthUi() {},
    openTermsAcceptance() {
      assert.fail('Accepted terms must not reopen the terms dialog.');
    },
    closeEntry() {},
    setOverlay() {},
    restoreAuthDestination() {
      restoredDestinations += 1;
    },
  },
);
await loadUserStateFor('restored-user');
await loadUserStateFor('restored-user');
assert.deepEqual(
  welcomeMessages,
  [{ message: 'Welcome back, Esteban.', tone: 'ok' }],
  'Repeated restoration for the same signed-in user must emit exactly one welcome toast.',
);
assert.equal(restoredDestinations, 2, 'Deduplicating the toast must not suppress destination restoration.');

console.log('Durable authentication session checks passed.');

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
  /if \(state\.authReturnPending && state\.welcomedUserId !== userId\)[\s\S]*Welcome back/,
  'Only an interactive authentication return may emit a welcome notification.',
);
const restoreAuthDestinationSource = extractNamedFunction(phase2, 'restoreAuthDestination');
assert.match(
  restoreAuthDestinationSource,
  /if \(!state\.authReturnPending\) return;[\s\S]*const storedReturn = safeSessionRead\(authReturnStorageKey\);[\s\S]*const returnHash = safeReturnHash\(storedReturn\) \|\| '#quorum';[\s\S]*safeSessionRemove\(authReturnStorageKey\)[\s\S]*dueDiligenceRoute:\s*returnHash\.slice\(1\)[\s\S]*PopStateEvent\('popstate'/,
  'A completed authentication return must restore only a validated saved destination and retain Quorum as its fallback.',
);
assert.match(
  phase2,
  /authReturnPending:\s*isAuthenticationReturn\(\)/,
  'Authentication-return state must be captured once so ordinary session refreshes preserve the active page.',
);
assert.doesNotMatch(
  restoreAuthDestinationSource,
  /openPremiumBarFeels|openPerSubject|showPage/,
  'A stale protected route must never reopen automatically after sign-in.',
);

function exerciseAuthDestinationRestore(storedReturn) {
  const authReturnStorageKey = 'duediligence.auth.return.v1';
  const sessionValues = new Map(storedReturn == null ? [] : [[authReturnStorageKey, storedReturn]]);
  const replacements = [];
  const events = [];
  const restoreState = { authReturnPending: true };
  const location = {
    origin: 'https://duediligence.ph',
    pathname: '/',
    search: '',
  };
  const history = {
    state: { preserved: true },
    replaceState(stateValue, _title, url) {
      this.state = stateValue;
      replacements.push({ state: stateValue, url });
    },
  };
  const restoreAuthDestination = vm.runInNewContext(
    `(() => {
      ${extractNamedFunction(phase2, 'safeReturnHash')}
      ${restoreAuthDestinationSource}
      return restoreAuthDestination;
    })()`,
    {
      URL,
      state: restoreState,
      location,
      history,
      authReturnStorageKey,
      safeSessionRead: (key) => sessionValues.get(key) ?? null,
      safeSessionRemove: (key) => sessionValues.delete(key),
      global: { dispatchEvent: (event) => events.push(event) },
      PopStateEvent: class PopStateEvent {
        constructor(type, init) {
          this.type = type;
          this.state = init.state;
        }
      },
    },
  );
  restoreAuthDestination();
  return { events, replacements, restoreState, sessionValues };
}

const examinationRoomReturn = exerciseAuthDestinationRestore('https://duediligence.ph/#examination-room');
assert.equal(
  examinationRoomReturn.replacements[0]?.url,
  '/#examination-room',
  'Professor sign-in must return to the Examination Room door through the validated same-page hash.',
);
assert.equal(examinationRoomReturn.replacements[0]?.state?.preserved, true);
assert.equal(examinationRoomReturn.replacements[0]?.state?.dueDiligenceRoute, 'examination-room');
assert.equal(examinationRoomReturn.events[0]?.type, 'popstate');
assert.equal(examinationRoomReturn.restoreState.authReturnPending, false);
assert.equal(examinationRoomReturn.sessionValues.size, 0, 'The one-time authentication destination must be removed after use.');

const unsafeReturn = exerciseAuthDestinationRestore('https://attacker.invalid/#examination-room');
assert.equal(
  unsafeReturn.replacements[0]?.url,
  '/#quorum',
  'An unsafe or unavailable authentication destination must fall back to Quorum.',
);
assert.equal(unsafeReturn.replacements[0]?.state?.preserved, true);
assert.equal(unsafeReturn.replacements[0]?.state?.dueDiligenceRoute, 'quorum');
assert.match(
  extractNamedFunction(phase2, 'recoverAuthAfterNavigation'),
  /state\.session = data\.session;[\s\S]*state\.user = data\.session\.user \|\| null;[\s\S]*dispatchSessionState\(data\.session, 'navigation-recovery'\);[\s\S]*await loadUserState\(\);/,
  'BFCache and app-switch recovery must republish the restored identity and refresh owner-scoped state.',
);

const dispatchedSessions = [];
const dispatchContext = {
  routineSessionRefreshReasons: new Set(['refresh', 'TOKEN_REFRESHED']),
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
  false,
  'A routine Supabase token rotation must update session state without broadcasting a new login.',
);
assert.equal(
  dispatchSessionState({ ...restoredSession, access_token: 'manual-refresh-token' }, 'refresh'),
  false,
  'A request-driven session refresh must not re-enter authenticated application setup.',
);
assert.equal(dispatchedSessions.length, 1, 'Routine refreshes must not add public session events.');
assert.equal(
  dispatchContext.state.lastSessionEventAccessToken,
  'manual-refresh-token',
  'Silent refreshes must still update the token used for later duplicate detection.',
);
assert.equal(dispatchSessionState(null, 'SIGNED_OUT'), true);
assert.equal(
  dispatchSessionState({ ...restoredSession, access_token: 'fresh-sign-in-token' }, 'SIGNED_IN'),
  true,
);
assert.deepEqual(
  dispatchedSessions.map(({ reason }) => reason),
  ['initial-session', 'SIGNED_OUT', 'SIGNED_IN'],
  'Sign-out and a genuine subsequent sign-in must still reach every session consumer.',
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
  authReturnPending: false,
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
  [],
  'Passive same-device session restoration must not emit a redundant welcome toast.',
);
welcomeState.authReturnPending = true;
welcomeState.welcomedUserId = null;
await loadUserStateFor('restored-user');
await loadUserStateFor('restored-user');
assert.deepEqual(
  welcomeMessages,
  [{ message: 'Welcome back, Esteban.', tone: 'ok' }],
  'A completed Google return must emit exactly one welcome toast.',
);
assert.equal(restoredDestinations, 4, 'Toast suppression must not suppress destination restoration.');

await import('./test-login-loop-p0.mjs');

console.log('Durable authentication session checks passed.');

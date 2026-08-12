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

console.log('Durable authentication session checks passed.');

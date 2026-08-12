import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = Object.fromEntries(await Promise.all(
  [
    'index.html',
    'admin/index.html',
    'admin/admin.js',
    'assets/auth-session-storage.js',
    'assets/private-beta-session.js',
    'assets/phase2-experience.js',
    'assets/phase3-analytics.js',
    'assets/phase4-experience.js',
    'assets/lex-forum.js',
    'assets/examinations.js',
    'scripts/build-pages-artifact.mjs',
  ].map(async (relative) => [
    relative,
    await readFile(path.join(root, relative), 'utf8'),
  ]),
));

for (const html of ['index.html', 'admin/index.html']) {
  const configPosition = files[html].indexOf('phase2-config.js');
  const authStoragePosition = files[html].indexOf('auth-session-storage.js');
  const admissionPosition = files[html].indexOf('private-beta-session.js');
  assert.ok(configPosition >= 0, `${html} must load the shared configuration`);
  assert.ok(authStoragePosition > configPosition, `${html} must load durable auth storage after configuration`);
  assert.ok(admissionPosition > authStoragePosition, `${html} must load admission after auth storage`);
}
assert.ok(
  files['index.html'].indexOf('private-beta-session.js')
    < files['index.html'].indexOf('phase2-experience.js'),
  'the public app must load admission before authenticated callers',
);
assert.ok(
  files['admin/index.html'].indexOf('private-beta-session.js')
    < files['admin/index.html'].indexOf('admin.js'),
  'the admin app must load admission before the admin caller',
);
assert.match(
  files['scripts/build-pages-artifact.mjs'],
  /'assets\/auth-session-storage\.js'/,
);
assert.match(
  files['scripts/build-pages-artifact.mjs'],
  /'assets\/private-beta-session\.js'/,
);

for (const relative of [
  'admin/admin.js',
  'assets/phase2-experience.js',
  'assets/phase3-analytics.js',
  'assets/phase4-experience.js',
  'assets/lex-forum.js',
]) {
  assert.match(
    files[relative],
    /DueDiligencePrivateBeta\?\.accessHeaders\?\.\(\)/,
    `${relative} must forward private-beta access`,
  );
}
assert.match(files['admin/admin.js'], /storage:\s*authStorage/);
assert.match(files['assets/phase2-experience.js'], /storage:\s*authStorage/);
assert.match(files['admin/admin.js'], /DueDiligencePrivateBeta\?\.clear\?\.\(\)/);
assert.match(files['assets/phase2-experience.js'], /DueDiligencePrivateBeta\?\.clear\?\.\(\)/);

const tokenApiStart = files['assets/examinations.js'].indexOf('async function tokenApi');
const tokenApiEnd = files['assets/examinations.js'].indexOf('\n  }', tokenApiStart);
assert.ok(tokenApiStart >= 0 && tokenApiEnd > tokenApiStart);
assert.doesNotMatch(
  files['assets/examinations.js'].slice(tokenApiStart, tokenApiEnd),
  /X-DD-Beta-Access|DueDiligencePrivateBeta/,
  'human-examiner capability-token calls must remain independent of student admission',
);

const storage = new Map();
let localStorageTouched = false;
const requests = [];
const future = (hours) => new Date(Date.now() + hours * 3_600_000).toISOString();
const window = {
  crypto: webcrypto,
  sessionStorage: {
    getItem(key) {
      return storage.get(key) || null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
  },
  localStorage: {
    getItem() {
      localStorageTouched = true;
      throw new Error('localStorage must not be used');
    },
    setItem() {
      localStorageTouched = true;
      throw new Error('localStorage must not be used');
    },
    removeItem() {
      localStorageTouched = true;
      throw new Error('localStorage must not be used');
    },
  },
  DueDiligencePhase2Config: {
    workerUrl: 'https://worker.example.invalid',
  },
  async fetch(url, options) {
    requests.push({ url, options });
    if (url.endsWith('/beta/access/policy')) {
      return Response.json({ ok: true, policy: { enabled: true } });
    }
    if (url.endsWith('/beta/access/verify')) {
      return Response.json({
        ok: true,
        pending: {
          token: 'pending-token-for-browser-contract',
          disclosureVersion: 'beta-disclosure-v1-2026-07-31',
          expiresAt: future(0.25),
        },
      });
    }
    if (url.endsWith('/beta/access/complete')) {
      return Response.json({
        ok: true,
        access: {
          allowed: true,
          token: 'access-token-for-browser-contract',
          admissionKind: 'beta_tester',
          disclosureVersion: 'beta-disclosure-v1-2026-07-31',
          expiresAt: future(12),
        },
      });
    }
    if (url.endsWith('/beta/access/status')) {
      return Response.json({
        ok: true,
        access: {
          allowed: true,
          admissionKind: 'beta_tester',
          disclosureVersion: 'beta-disclosure-v1-2026-07-31',
          expiresAt: future(12),
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  },
};
window.window = window;

vm.runInNewContext(files['assets/private-beta-session.js'], {
  window,
  btoa,
  Date,
  Error,
  JSON,
  Number,
  Object,
  RegExp,
  Response,
  String,
  Uint8Array,
});

const admission = window.DueDiligencePrivateBeta;
assert.ok(admission);
assert.equal((await admission.policy()).enabled, true);
const acknowledgements = {
  aiLimitations: true,
  educationalOnly: true,
  termsAndPrivacy: true,
};
await admission.verifyCode({
  accessCode: 'ephemeral-test-code',
  disclosureEndReached: true,
  acknowledgements,
});
assert.match(admission.flowHeaders()['X-DD-Beta-Flow-ID'], /^[A-Za-z0-9_-]{22,128}$/);
assert.equal(
  [...storage.values()].some((value) => value.includes('ephemeral-test-code')),
  false,
  'the access code must never be persisted',
);
assert.equal(requests[1].options.cache, 'no-store');
assert.equal(requests[1].options.credentials, 'omit');

await admission.completeAdmission({
  authAccessToken: 'test-auth-session',
  disclosureEndReached: true,
  acknowledgements,
});
assert.equal(
  admission.accessHeaders()['X-DD-Beta-Access'],
  'access-token-for-browser-contract',
);
assert.equal(admission.getPending(), null);
assert.equal(
  requests[2].options.headers.Authorization,
  'Bearer test-auth-session',
);

const status = await admission.status('test-auth-session');
assert.equal(status.allowed, true);
assert.equal(
  requests[3].options.headers['X-DD-Beta-Access'],
  'access-token-for-browser-contract',
);
assert.equal(localStorageTouched, false);

admission.clear();
assert.equal(storage.size, 0);
assert.equal(Object.keys(admission.accessHeaders()).length, 0);

const globalStatus = await admission.status('test-auth-session');
assert.equal(globalStatus.allowed, true);
assert.equal(
  requests[4].options.headers['X-DD-Beta-Access'],
  undefined,
  'global access status must not require a browser-stored admission token',
);

console.log('Private-beta frontend session and propagation checks passed.');

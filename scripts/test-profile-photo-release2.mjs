import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const repositoryRoot = new URL('../', import.meta.url);
const source = await readFile(new URL('../assets/profile-photo.js', import.meta.url), 'utf8');

class TestCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

class TestWindow {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    (this.listeners.get(event.type) || []).forEach((listener) => listener(event));
    return true;
  }
}

class TestImage {
  constructor() {
    this.listeners = new Map();
    this.alt = '';
    this.decoding = '';
    this.src = '';
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  async emit(type) {
    return this.listeners.get(type)?.({ type, target: this });
  }
}

class TestContainer {
  constructor() {
    this.children = [];
    this.attributes = new Map();
    this.classes = new Set();
    this._textContent = '';
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
    };
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    if (this._textContent) this.children = [];
  }

  replaceChildren(...children) {
    this.children = children;
    this._textContent = '';
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }
}

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ ok: status >= 200 && status < 300, data }),
  };
}

function createHarness({ initialSession, fetch, createImageBitmap = null, optimizedBlob = null }) {
  let session = initialSession;
  const testWindow = new TestWindow();
  const document = {
    createElement(tagName) {
      if (tagName === 'img') return new TestImage();
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage() {},
            fillRect() {},
            fillStyle: '',
          }),
          toBlob: (callback) => callback(optimizedBlob),
        };
      }
      throw new Error(`Unexpected test element: ${tagName}`);
    },
  };
  Object.assign(testWindow, {
    CustomEvent: TestCustomEvent,
    DueDiligencePhase2Config: { workerUrl: 'https://worker.example' },
    DueDiligencePhase2: {
      getSession: () => session,
      refreshSession: async () => session,
    },
    Math,
    URL,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    crypto: { randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    document,
    fetch,
    location: { origin: 'https://duediligence.ph' },
    navigator: { onLine: true },
  });
  if (createImageBitmap) testWindow.createImageBitmap = createImageBitmap;
  vm.runInNewContext(source, { window: testWindow }, { filename: 'assets/profile-photo.js' });
  return {
    api: testWindow.DueDiligenceProfilePhoto,
    setSession(nextSession, reason = 'SIGNED_IN') {
      session = nextSession;
      testWindow.dispatchEvent(new TestCustomEvent('duediligence:session', {
        detail: {
          authenticated: Boolean(nextSession?.access_token),
          userId: nextSession?.user?.id || null,
          reason,
        },
      }));
    },
    window: testWindow,
  };
}

function signedUrl(label, expiresAtSeconds) {
  const payload = Buffer.from(JSON.stringify({ exp: expiresAtSeconds }))
    .toString('base64url');
  return `https://storage.example/object/${label}.jpg?token=header.${payload}.signature`;
}

test('profile-photo cache and delayed requests are isolated across account switches', async () => {
  const userA = { id: 'user-a' };
  const userB = { id: 'user-b' };
  let resolveUserA;
  const requests = [];
  const harness = createHarness({
    initialSession: { access_token: 'token-a', user: userA },
    fetch: async (_url, options) => {
      const authorization = options.headers.Authorization;
      requests.push(authorization);
      if (authorization === 'Bearer token-a') {
        return new Promise((resolve) => { resolveUserA = resolve; });
      }
      return response({ avatarUrl: 'https://storage.example/user-b.jpg', displayName: 'Beta User' });
    },
  });

  const staleLoad = harness.api.load();
  harness.setSession({ access_token: 'token-b', user: userB });
  resolveUserA(response({ avatarUrl: 'https://storage.example/user-a.jpg', displayName: 'Alpha User' }));

  await assert.rejects(staleLoad, (error) => error.code === 'PROFILE_PHOTO_SESSION_CHANGED');
  assert.equal(harness.api.current(userB.id), null);
  assert.equal(harness.api.current(userA.id), null);

  const current = await harness.api.load();
  assert.equal(current.avatarUrl, 'https://storage.example/user-b.jpg');
  assert.equal(harness.api.current(userB.id)?.displayName, 'Beta User');
  assert.deepEqual(requests, ['Bearer token-a', 'Bearer token-b']);
});

test('a stale image error callback cannot replace a newer render in the same surface', async () => {
  const harness = createHarness({
    initialSession: { access_token: 'token-a', user: { id: 'user-a' } },
    fetch: async () => {
      throw new Error('A stale image callback must not start a refresh request.');
    },
  });
  const container = new TestContainer();
  const oldProfile = harness.api.remember({
    avatarUrl: 'https://storage.example/user-a-old.jpg',
    displayName: 'Alpha User',
  });
  const oldRender = harness.api.render(container, oldProfile, { initials: 'AU' });
  const newProfile = harness.api.remember({
    avatarUrl: 'https://storage.example/user-a-new.jpg',
    displayName: 'Alpha User',
  });
  const newRender = harness.api.render(container, newProfile, { initials: 'AU' });

  await oldRender.image.emit('error');

  assert.equal(container.firstElementChild, newRender.image);
  assert.equal(newRender.image.src, newProfile.avatarUrl);
  assert.equal(container.textContent, '');
  assert.equal(container.classes.has('has-profile-photo'), true);
});

test('an account switch during image refresh cannot alter the new account render', async () => {
  let resolveRefresh;
  const harness = createHarness({
    initialSession: { access_token: 'token-a', user: { id: 'user-a' } },
    fetch: async () => new Promise((resolve) => { resolveRefresh = resolve; }),
  });
  const container = new TestContainer();
  const userAProfile = harness.api.remember({
    avatarUrl: 'https://storage.example/user-a-old.jpg',
    displayName: 'Alpha User',
  });
  const userARender = harness.api.render(container, userAProfile, { initials: 'AU' });
  const refresh = userARender.image.emit('error');

  harness.setSession({ access_token: 'token-b', user: { id: 'user-b' } });
  const userBProfile = harness.api.remember({
    avatarUrl: 'https://storage.example/user-b.jpg',
    displayName: 'Beta User',
  });
  const userBRender = harness.api.render(container, userBProfile, { initials: 'BU' });
  resolveRefresh(response({
    avatarUrl: 'https://storage.example/user-a-refreshed.jpg',
    displayName: 'Alpha User',
  }));
  await refresh;

  assert.equal(container.firstElementChild, userBRender.image);
  assert.equal(userBRender.image.src, userBProfile.avatarUrl);
  assert.equal(harness.api.current('user-a'), null);
  assert.equal(harness.api.current('user-b')?.avatarUrl, userBProfile.avatarUrl);
});

test('a load started before profile-photo removal cannot restore the removed avatar', async () => {
  let resolveLoad;
  const harness = createHarness({
    initialSession: { access_token: 'token-a', user: { id: 'user-a' } },
    fetch: async (_url, options) => {
      const operation = JSON.parse(options.body).operation;
      if (operation === 'profile') {
        return new Promise((resolve) => { resolveLoad = resolve; });
      }
      assert.equal(operation, 'remove_profile_avatar');
      return response({});
    },
  });
  harness.api.remember({
    avatarUrl: 'https://storage.example/user-a-old.jpg',
    displayName: 'Alpha User',
  });

  const staleLoad = harness.api.load({ force: true });
  const staleLoadRejected = assert.rejects(
    staleLoad,
    (error) => error.code === 'PROFILE_PHOTO_SESSION_CHANGED',
  );
  const removed = await harness.api.remove();
  resolveLoad(response({
    avatarUrl: 'https://storage.example/user-a-old.jpg',
    displayName: 'Alpha User',
  }));
  await staleLoadRejected;

  assert.equal(removed.avatarUrl, null);
  assert.equal(harness.api.current('user-a')?.avatarUrl, null);
});

test('a load started before profile-photo upload cannot overwrite the uploaded avatar', async () => {
  let resolveLoad;
  const uploadedUrl = 'https://storage.example/user-a-uploaded.jpg';
  const optimizedBlob = new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0x00])], {
    type: 'image/jpeg',
  });
  const harness = createHarness({
    initialSession: { access_token: 'token-a', user: { id: 'user-a' } },
    fetch: async (_url, options) => {
      const operation = JSON.parse(options.body).operation;
      if (operation === 'profile') {
        return new Promise((resolve) => { resolveLoad = resolve; });
      }
      assert.equal(operation, 'set_profile_avatar');
      return response({ avatarUrl: uploadedUrl });
    },
    createImageBitmap: async () => ({
      width: 1024,
      height: 1024,
      close() {},
    }),
    optimizedBlob,
  });
  harness.api.remember({
    avatarUrl: 'https://storage.example/user-a-old.jpg',
    displayName: 'Alpha User',
  });

  const staleLoad = harness.api.load({ force: true });
  const staleLoadRejected = assert.rejects(
    staleLoad,
    (error) => error.code === 'PROFILE_PHOTO_SESSION_CHANGED',
  );
  const uploaded = await harness.api.upload({ type: 'image/jpeg', size: 1024 });
  resolveLoad(response({
    avatarUrl: 'https://storage.example/user-a-old.jpg',
    displayName: 'Alpha User',
  }));
  await staleLoadRejected;

  assert.equal(uploaded.avatarUrl, uploadedUrl);
  assert.equal(harness.api.current('user-a')?.avatarUrl, uploadedUrl);
});

test('an expired signed image refreshes once and then falls back to initials on image failure', async () => {
  const expired = signedUrl('avatar', Math.floor(Date.now() / 1000) - 60);
  const refreshed = signedUrl('avatar', Math.floor(Date.now() / 1000) + 900);
  let refreshRequests = 0;
  const harness = createHarness({
    initialSession: { access_token: 'token-a', user: { id: 'user-a' } },
    fetch: async () => {
      refreshRequests += 1;
      return response({ avatarUrl: refreshed, displayName: 'Alpha User' });
    },
  });
  const original = harness.api.remember({ avatarUrl: expired, displayName: 'Alpha User' });
  assert.ok(harness.api.signedUrlExpiresAt(expired) < Date.now());

  const container = new TestContainer();
  let fallbackReason = '';
  const rendered = harness.api.render(container, original, {
    initials: 'AU',
    onFallback: (reason) => { fallbackReason = reason; },
  });
  assert.equal(container.firstElementChild, rendered.image);

  await rendered.image.emit('error');
  assert.equal(rendered.image.src, refreshed);
  assert.equal(container.firstElementChild, rendered.image);
  assert.equal(refreshRequests, 1);

  const concurrentContainer = new TestContainer();
  const concurrent = harness.api.render(concurrentContainer, harness.api.current('user-a'), { initials: 'AU' });
  await concurrent.image.emit('error');
  assert.equal(concurrentContainer.textContent, 'AU');
  assert.equal(refreshRequests, 1);

  await rendered.image.emit('error');
  assert.equal(container.firstElementChild, null);
  assert.equal(container.textContent, 'AU');
  assert.equal(container.classes.has('has-profile-photo'), false);
  assert.equal(fallbackReason, 'image-error');
  assert.equal(refreshRequests, 1);
});

test('a 20 MB local source remains eligible when optimization produces a payload within 3 MB', async () => {
  let closed = false;
  const optimizedBlob = new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0x00])], {
    type: 'image/jpeg',
  });
  const harness = createHarness({
    initialSession: { access_token: 'token-a', user: { id: 'user-a' } },
    fetch: async () => response({}),
    createImageBitmap: async () => ({
      width: 2048,
      height: 2048,
      close: () => { closed = true; },
    }),
    optimizedBlob,
  });
  const payload = await harness.api.optimize({
    type: 'image/jpeg',
    size: harness.api.SOURCE_BYTES,
  });
  assert.equal(payload.mimeType, 'image/jpeg');
  assert.equal(Buffer.from(payload.dataBase64, 'base64').byteLength, optimizedBlob.size);
  assert.equal(closed, true);
  assert.equal(harness.api.UPLOAD_BYTES, 3 * 1024 * 1024);

  await assert.rejects(
    harness.api.optimize({
      type: 'image/jpeg',
      size: harness.api.SOURCE_BYTES + 1,
    }),
    /no larger than 20 MB/i,
  );
});

test('Release 2 profile-photo integration contracts remain wired to existing surfaces', async () => {
  const [html, experience, forum, forumCss, shellCss, core, worker, build, serviceWorker] = await Promise.all([
    'index.html',
    'assets/phase2-experience.js',
    'assets/lex-forum.js',
    'assets/lex-forum.css',
    'assets/quorum-first-shell.css',
    'worker/forum-core.mjs',
    'worker/index.mjs',
    'scripts/build-pages-artifact.mjs',
    'service-worker.js',
  ].map((file) => readFile(new URL(file, repositoryRoot), 'utf8')));

  assert.ok(html.indexOf('assets/profile-photo.js?v=profile-photo-release2-20260827-1')
    < html.indexOf('assets/phase2-experience.js?v=profile-photo-release2-20260827-1'));
  assert.match(html, /id="lex-composer"[\s\S]*class="lex-member-mark"[^>]*><\/span>/);
  assert.doesNotMatch(html, /class="lex-member-mark"[^>]*>DD<\/span>/);
  assert.match(forum, /function syncComposerProfile[\s\S]*#lex-composer \.lex-member-mark/);
  assert.match(forum, /state\.draftOwnerId = currentUserId\(\) \|\| null;[\s\S]*syncComposerProfile\(null\)/);
  assert.match(forum, /eventUserId !== activeUserId[\s\S]*syncComposerProfile\(null\)/);
  assert.match(forumCss, /\.lex-member-mark img[\s\S]*object-fit:\s*cover/);

  for (const control of [
    'dd2-account-photo-choose',
    'dd2-account-photo-remove',
    'dd2-account-photo-input',
    'dd2-account-photo-status',
  ]) assert.match(experience, new RegExp(control));
  assert.match(experience, /detailUserId[\s\S]*detailUserId === activeUserId[\s\S]*profilePhotoFallback\(\)/);
  assert.match(experience, /source up to 20 MB[\s\S]*upload no larger than 3 MB/);
  assert.match(experience, /Loading your protected profile photo/);
  assert.match(experience, /profile photo was updated[\s\S]*'success'/i);
  assert.match(experience, /profile photo could not be (?:loaded|updated)[\s\S]*'error'/i);
  assert.match(experience, /function resetAccountProfilePhotoRemovalConfirmation[\s\S]*delete remove\.dataset\.confirmRemove[\s\S]*clearTimeout\(remove\.confirmTimer\)/);
  assert.match(experience, /function renderAccountProfilePhoto[\s\S]*resetAccountProfilePhotoRemovalConfirmation\(\)/);
  assert.match(experience, /dd2-account-photo-choose'\)\?\.addEventListener\('click',[\s\S]*resetAccountProfilePhotoRemovalConfirmation\(\)/);
  assert.match(experience, /Removal confirmation expired\. Your profile photo was not changed\./);
  assert.match(experience, /if \(!global\.DueDiligenceProfilePhoto\)[\s\S]*choose\.disabled = true[\s\S]*Profile photo unavailable[\s\S]*remove\.disabled = true[\s\S]*Profile photo controls could not be loaded/);
  assert.match(experience, /if \(removalSucceeded\)[\s\S]*dd2-account-photo-choose'\)\?\.focus\(\)/);
  assert.doesNotMatch(`${experience}\n${forum}`, /removes embedded metadata/i);
  assert.match(shellCss, /#header-account-control\.has-profile-photo-control[\s\S]*\.qfs-profile-avatar img/);

  assert.match(core, /avatarBytes:\s*3_145_728/);
  assert.match(core, /'remove_profile_avatar'/);
  assert.match(worker, /removeQuorumAvatarRecord[\s\S]*user_id=eq\.\$\{encodeURIComponent\(userId\)\}/);
  assert.match(build, /'assets\/profile-photo\.js'/);
  assert.match(serviceWorker, /profile-photo\.js\?v=profile-photo-release2-20260827-1/);
});

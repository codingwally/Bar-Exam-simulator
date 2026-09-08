import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imageNames = [
  'dimasalang-library.webp',
  'participant-2-tropical.webp',
  'participant-3-bedroom.webp',
  'participant-4-condo.webp',
  'virtual-background-due-diligence-branded.webp',
];

const [html, css, client, pricingClient, ...images] = await Promise.all([
  readFile(path.join(root, 'index.html'), 'utf8'),
  readFile(path.join(root, 'assets/study-room-preview.css'), 'utf8'),
  readFile(path.join(root, 'assets/study-room-preview.js'), 'utf8'),
  readFile(path.join(root, 'assets/phase2-experience.js'), 'utf8'),
  ...imageNames.map((name) => readFile(path.join(root, 'assets/study-room', name))),
]);

const profile = html.indexOf('id="dd2-header-role-button"');
const examination = html.indexOf('id="dd2-header-exam-button"');
const studyRoom = html.indexOf('id="dd-study-room-trigger"');
const pricing = html.indexOf('id="dd2-header-pricing-button"');
assert.ok(
  profile >= 0 && profile < examination && examination < studyRoom && studyRoom < pricing,
  'Study Room must appear directly between Examination Room and Plans & Pricing.',
);
assert.match(html, /id="dd-study-room-trigger"[\s\S]*data-study-room-trigger[\s\S]*aria-haspopup="dialog"/);
assert.match(html, /id="spa-study-room"[\s\S]*data-study-room-trigger[\s\S]*hidden/);
for (const id of ['dd-study-room-trigger', 'spa-study-room']) {
  const button = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0];
  assert.ok(button, `${id}: the Home entry must exist.`);
  assert.match(button, /aria-busy="true"/);
  assert.doesNotMatch(button, /\sdisabled(?:\s|=|>)|aria-disabled="true"/,
    `${id}: pending Home Auth must not prevent a user-triggered dedicated-page launch.`);
}

assert.match(html, /id="dd-study-room-dialog" role="dialog" aria-modal="true"/);
assert.match(html, /aria-labelledby="dd-study-room-title" aria-describedby="dd-study-room-description"/);
assert.match(html, /id="dd-study-room-overlay" aria-hidden="true" hidden/);
assert.match(html, /id="dd-study-room-close"[\s\S]*aria-label="Close Study Room preview"/);
assert.match(client, /event\.key === 'Escape'[\s\S]*close\(\)/);
assert.match(client, /event\.key !== 'Tab'[\s\S]*focusableElements/);
assert.match(client, /restoreFocusTo\.focus/);

assert.match(html, /You won&rsquo;t have to study alone\./);
assert.match(html, /Due Diligence Study Room/);
assert.match(html, /Dimasalang/);
assert.match(html, /Live accountability/);
assert.match(html, /Nickname privacy/);
assert.match(html, /Separate-window study/);
assert.match(html, /Open to all signed-in members/);
assert.match(html, /Available to all signed-in Due Diligence members, free and paid\./);
assert.doesNotMatch(html, /Study Room is being tested with admins|Subscribe to Due Diligence and follow the launch/);
assert.match(html, /Interface preview only\. No camera or microphone is active\./);
assert.match(html, /Turn the backdrop off with one click for a lighter, faster video mode\./);
assert.match(html, /aria-label="Backdrop can be turned off"/);
assert.doesNotMatch(html, /data-study-room-background=|>None<|>Blur</);
assert.doesNotMatch(client, /data-study-room-background|studyRoomBackground/);

assert.match(css, /dd-study-room-trigger[\s\S]*order:\s*3/);
assert.match(css, /dd2-header-pricing-button\s*\{\s*order:\s*4/);
assert.match(css, /dd-study-room-trigger[\s\S]*min-height:\s*44px/);
assert.match(css, /dd-study-room-subscribe[\s\S]*min-height:\s*58px/);
assert.match(css, /dd-study-room-trigger:focus-visible/);
assert.match(css, /dd-study-room-subscribe:focus-visible/);
assert.match(css, /dd-study-room-subscribe\.is-subscribed[\s\S]*animation:\s*none/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /dd-study-room-close[\s\S]*width:\s*44px;[\s\S]*height:\s*44px;/);
assert.match(css, /dd-study-room-window-button[\s\S]*min-height:\s*44px/);
assert.match(css, /dd-study-room-control[\s\S]*width:\s*44px;[\s\S]*height:\s*44px;/);
assert.match(css, /dd-study-room-mute[\s\S]*min-height:\s*44px/);
assert.match(css, /dd-study-room-mute:focus-visible/);

assert.match(client, /ADMIN_ROLES/);
assert.doesNotMatch(client, /DueDiligenceSubscriptionCta|isFoundingBetaTester|headerShowsAdmin/);
assert.match(client, /subscribe\.disabled = false/);
assert.match(client, /liveAccess \? 'Open Study Room' : 'Sign in to join'/);
assert.match(client, /Available to all signed-in members, free and paid/);
assert.match(client, /hasLiveRoomAccess\(\)[\s\S]*return openLiveRoom\(\)/);
assert.match(client, /new URL\('\/study-room\/', global\.location\.origin\)/);
assert.match(client, /global\.open\([\s\S]*roomUrl\.href[\s\S]*popup=yes[\s\S]*toolbar=no[\s\S]*location=no/);
assert.match(client, /popup\.opener = null/);
assert.match(client, /popup\.focus\?\.\(\)/);
assert.match(client, /studyRoomWindow && !studyRoomWindow\.closed[\s\S]*studyRoomWindow\.focus\?\.\(\)/);
assert.match(client, /studyRoomWindow = popup/);
assert.match(client, /if \(!popup\) \{[\s\S]*global\.location\.assign\(roomUrl\.href\)/);
assert.match(client, /try \{[\s\S]*popup = global\.open\([\s\S]*\} catch \{[\s\S]*global\.location\.assign\(roomUrl\.href\)/);
assert.doesNotMatch(client, /Allow pop-ups for Due Diligence/);
assert.match(client, /return openMarketingPreview\(trigger\)/);
assert.match(client, /DueDiligencePhase2\.openSignIn\(\{ allowDismiss: true \}\)/);
assert.match(client, /getElementById\('btn-signin'\)\?\.click\(\)/);
assert.match(client, /study_room_preview_opened/);
assert.match(html, /study-room-preview\.css\?v=study-room-launch-20260830-1/);
assert.match(html, /study-room-preview\.js\?v=study-room-all-members-20260908-1&amp;entry=free-join-20260909-1/);

function extractNamedFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing function ${name}.`);
  const openingBrace = source.indexOf('{', start);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unterminated function ${name}.`);
}

const accessContext = vm.createContext({
  ADMIN_ROLES: new Set(['admin', 'administrator', 'super admin', 'founder admin']),
  session: null,
});
for (const name of [
  'normalized',
  'isAdmin',
  'signedIn',
  'hasLiveRoomAccess',
]) {
  vm.runInContext(extractNamedFunction(client, name), accessContext);
}
assert.equal(vm.runInContext("isAdmin({ role: 'founder_admin' })", accessContext), true);
assert.equal(vm.runInContext("isAdmin({ role: 'member' })", accessContext), false);
for (const missingSession of [null, {}, { user: { id: 'inert-member' } }, { access_token: '' }, { access_token: '  ' }, { access_token: true }, { role: 'admin' }]) {
  accessContext.candidate = missingSession;
  assert.equal(vm.runInContext('hasLiveRoomAccess(candidate)', accessContext), false, 'Profile or role metadata alone must not count as a session.');
}
assert.equal(vm.runInContext("hasLiveRoomAccess({ access_token: 'inert-token', user: { id: 'inert-member' } })", accessContext), true);

const memberAccessCases = [
  ['free', { role: 'member', allowed: false, subscription: null }],
  ['paid', { role: 'member', allowed: true, subscription: { status: 'active' } }],
  ['exhausted', { role: 'member', allowed: false, remainingTokens: 0 }],
  ['expired', { role: 'member', allowed: false, paidSubscriptionExpired: true, subscription: { status: 'expired' } }],
  ['founding beta', { role: 'member', allowed: true, basis: 'founding_beta' }],
  ['loading or failed access', null],
];
let launchCases = 0;
for (const [label, value] of memberAccessCases) {
  for (const authSettled of [false, true]) {
    let currentSession = { access_token: 'inert-token', user: { id: 'inert-member' } };
    let launches = 0;
    let previews = 0;
    const context = vm.createContext({
      session: null, sessionFromExplicitEvent: false, access: value, authSettled,
      global: { DueDiligencePhase4: { getSession: () => currentSession } },
      accessWithVerifiedRole: () => value,
      openLiveRoom: () => { launches += 1; return true; },
      openMarketingPreview: () => { previews += 1; return true; },
    });
    for (const name of ['signedIn', 'hasLiveRoomAccess', 'runtimeSession', 'accessIsResolving', 'open']) {
      vm.runInContext(extractNamedFunction(client, name), context);
    }
    assert.equal(vm.runInContext('open()', context), true, `${label}: open must complete synchronously.`);
    assert.equal(launches, 1, `${label}: subscription state must not prevent signed-in launch.`);
    assert.equal(previews, 0);
    currentSession = null;
    context.authSettled = true;
    assert.equal(vm.runInContext('open()', context), true);
    assert.equal(launches, 1, `${label}: a removed browser session must not reopen using cached identity.`);
    assert.equal(previews, 1);
    launchCases += 1;
  }
}

const liveWindowFunction = extractNamedFunction(client, 'openLiveRoom');
assert.doesNotMatch(liveWindowFunction, /openMarketingPreview/);
assert.doesNotMatch(liveWindowFunction, /setPreviewStatus/);
const openFunction = extractNamedFunction(client, 'open');
assert.doesNotMatch(openFunction, /await|\.then\(/, 'Study Room click routing must stay synchronous for popup user activation.');
assert.match(openFunction, /accessIsResolving\(\)[\s\S]*return openLiveRoom\(\)/);

assert.equal(extractNamedFunction(client, 'accessIsResolving').includes('return !authSettled && !signedIn();'), true);
assert.doesNotMatch(extractNamedFunction(client, 'hasLiveRoomAccess'), /isAdmin\(|\.allowed|\.basis|subscription|remainingTokens/);
assert.doesNotMatch(client, /access_token: 'authenticated-session'/, 'An event without a real runtime session must not synthesize a token.');
assert.match(client, /querySelectorAll\('\[data-study-room-trigger\]'\)[\s\S]*trigger\.disabled = false/);
assert.match(client, /setAttribute\('aria-busy', String\(busy\)\)/);
assert.match(client, /setAttribute\('aria-disabled', 'false'\)/);
assert.match(client, /DueDiligencePhase2\?\.whenAuthReady\?\.\(\)/);
assert.match(client, /DueDiligencePhase4\?\.refreshAccess\?\.\(\{[\s\S]*enforce: false,[\s\S]*force: true/);
assert.match(client, /accessResolutionFailed = signedIn\(latestSession\) && !latestAccess/);
assert.match(client, /detail\?\.authenticated === false[\s\S]*\? null/);
assert.match(client, /access: !signedIn\(nextSession\) \|\| changedAccount \? null : access/);
assert.match(client, /if \(!signedIn\(readySession\)\) \{[\s\S]*session: null, access: null/);
assert.match(client, /if \(!current \|\| typeof current !== 'object'\) return null/);

// Run the complete actual module: isolated function stubs cannot catch a disabled
// DOM trigger or a pending bootstrap that never reaches its rejection handler.
function previewHarness({ popupMode = 'open' } = {}) {
  class Element {
    constructor(id) {
      this.id = id;
      this.disabled = true;
      this.hidden = true;
      this.attributes = new Map();
      this.classList = { add() {}, remove() {}, toggle() {} };
      this.label = { textContent: '' };
    }
    setAttribute(key, value) { this.attributes.set(key, value); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    querySelector() { return this.label; }
    querySelectorAll() { return []; }
    addEventListener() {}
    focus() {}
    closest(selector) {
      if (selector === '[data-study-room-trigger]') return this.id === 'dd-study-room-trigger' ? this : null;
      return selector === `#${this.id}` ? this : null;
    }
  }
  const nodes = new Map(['dd-study-room-trigger', 'spa-study-room', 'dd-study-room-overlay',
    'dd-study-room-dialog', 'dd-study-room-close', 'dd-study-room-subscribe',
    'dd-study-room-subscribe-note'].map((id) => [id, new Element(id)]));
  const documentHandlers = new Map();
  const windowHandlers = new Map();
  const record = (target, type, callback) => target.set(type, [...(target.get(type) || []), callback]);
  const opened = [];
  const navigated = [];
  let currentSession = null;
  let readyCalls = 0;
  let signInCalls = 0;
  const document = {
    readyState: 'complete', activeElement: null,
    body: { classList: { add() {}, remove() {} } },
    getElementById: (id) => nodes.get(id) || null,
    querySelectorAll: (selector) => selector === '[data-study-room-trigger]'
      ? [nodes.get('dd-study-room-trigger'), nodes.get('spa-study-room')] : [],
    addEventListener: (type, callback) => record(documentHandlers, type, callback),
  };
  const window = {
    document, HTMLElement: Element,
    location: { origin: 'https://inert.example', assign: (url) => navigated.push(url) },
    requestAnimationFrame: (callback) => callback(),
    addEventListener: (type, callback) => record(windowHandlers, type, callback),
    DueDiligencePhase2: {
      getSession: () => currentSession,
      whenAuthReady: () => { readyCalls += 1; return new Promise(() => {}); },
      openSignIn: () => { signInCalls += 1; },
    },
    open: (url, name) => {
      opened.push({ url, name });
      if (popupMode === 'throw') throw new Error('Inert blocked popup');
      return popupMode === 'null' ? null : { closed: false, focus() {} };
    },
    fetch: () => { throw new Error('The Home launcher must never make an Auth or service request.'); },
  };
  vm.runInContext(client, vm.createContext({ window, URL }));
  return {
    nodes, opened, navigated,
    readyCalls: () => readyCalls,
    signInCalls: () => signInCalls,
    session: (value) => { currentSession = value; },
    dispatch: (type, detail) => {
      for (const callback of windowHandlers.get(type) || []) callback({ detail });
    },
    click: (id = 'dd-study-room-trigger') => {
      const target = nodes.get(id);
      assert.equal(target.disabled, false, `${id}: a real disabled button would never dispatch a click.`);
      for (const callback of documentHandlers.get('click') || []) callback({ target, preventDefault() {} });
    },
  };
}

let bootstrapCases = 0;
for (const popupMode of ['open', 'null', 'throw']) {
  const harness = previewHarness({ popupMode });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.readyCalls(), 1, 'The actual Auth readiness promise is pending, not mocked away.');
  assert.equal(harness.nodes.get('dd-study-room-trigger').getAttribute('aria-busy'), 'true');
  harness.dispatch('duediligence:access', { access: null });
  harness.click();
  assert.deepEqual(harness.opened, [{ url: 'https://inert.example/study-room/', name: 'DueDiligenceStudyRoom' }]);
  assert.deepEqual(harness.navigated, popupMode === 'open' ? [] : ['https://inert.example/study-room/']);
  assert.equal(harness.nodes.get('dd-study-room-overlay').hidden, true);
  assert.equal(harness.signInCalls(), 0);
  bootstrapCases += 1;
}

const signedOut = previewHarness();
signedOut.dispatch('duediligence:session', { authenticated: false });
signedOut.click();
assert.equal(signedOut.opened.length, 0);
assert.equal(signedOut.nodes.get('dd-study-room-overlay').hidden, false);
signedOut.click('dd-study-room-subscribe');
assert.equal(signedOut.signInCalls(), 1);
assert.equal(signedOut.opened.length, 0, 'A known signed-out user keeps the normal sign-in path.');
bootstrapCases += 1;

const eventSession = previewHarness();
eventSession.dispatch('duediligence:session', {
  authenticated: true, session: { access_token: 'inert-session', user: { id: 'inert-user' } },
});
eventSession.click();
assert.equal(eventSession.opened.length, 1, 'An explicit session event must survive a temporarily null runtime getter.');
eventSession.dispatch('duediligence:session', { authenticated: false });
eventSession.click();
assert.equal(eventSession.opened.length, 1, 'Explicit logout must clear the event session, without reopening the cached window.');
assert.equal(eventSession.nodes.get('dd-study-room-overlay').hidden, false);
bootstrapCases += 1;

const metadataOnly = previewHarness();
metadataOnly.dispatch('duediligence:session', { authenticated: true, userId: 'inert-user-without-session' });
metadataOnly.click();
assert.equal(metadataOnly.opened.length, 0, 'Auth metadata alone must not become a retained session.');
assert.equal(metadataOnly.nodes.get('dd-study-room-overlay').hidden, false);
bootstrapCases += 1;

for (const forbidden of [
  /study-room-demo/,
  /home-current/,
  /\blocalhost\b/,
  /127\.0\.0\.1/,
  /\bfetch\s*\(/,
  /\.rpc\s*\(/,
  /navigator\.mediaDevices/,
  /getUserMedia/,
  /RTCPeerConnection/,
  /\bWebSocket\b/,
  /\bMediaRecorder\b/,
]) {
  assert.doesNotMatch(client, forbidden, 'The launcher must not acquire media or replace the live page server authorization.');
}
assert.doesNotMatch(css, /study-room-demo|home-current/);
assert.doesNotMatch(html, /study-room-demo|home-current|assets\/study-room\/[^"'\s>]+\.png/);
assert.match(pricingClient, /id="dd2-pricing-retry"/);
assert.match(pricingClient, /Plans &amp; Pricing could not load just now\./);
assert.match(html, /phase2-experience\.js[^"\n]*pricing=regular-checkout-r3/);
assert.doesNotMatch(
  pricingClient,
  /host\.innerHTML\s*=\s*`<div class="dd2-status is-error">\$\{escapeHtml\(error\.message/,
  'The Plans & Pricing UI must not display a raw browser error such as Failed to fetch.',
);

for (let index = 0; index < imageNames.length; index += 1) {
  const name = imageNames[index];
  const image = images[index];
  assert.ok(html.includes('assets/study-room/' + name), name + ' must be referenced by the marketing preview.');
  assert.equal(image.subarray(0, 4).toString('ascii'), 'RIFF', name + ' must be a RIFF WebP.');
  assert.equal(image.subarray(8, 12).toString('ascii'), 'WEBP', name + ' must be a valid WebP.');
}

const sizes = await Promise.all(
  imageNames.map((name) => stat(path.join(root, 'assets/study-room', name)).then((value) => value.size)),
);
const totalImageBytes = sizes.reduce((total, size) => total + size, 0);
assert.ok(totalImageBytes <= 1.5 * 1024 * 1024, 'Study Room preview images must total at most 1.5 MiB.');

console.log(`Study Room signed-in launch contract tests passed (${launchCases} access/auth combinations, ${bootstrapCases} full-module bootstrap/event cases, plus missing-session guards).`);
console.log('Optimized WebP total: ' + totalImageBytes + ' bytes.');

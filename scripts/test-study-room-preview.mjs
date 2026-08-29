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
assert.match(html, /id="dd-study-room-trigger"[\s\S]*aria-busy="true"[\s\S]*aria-disabled="true" disabled/);
assert.match(html, /id="spa-study-room"[\s\S]*aria-busy="true"[\s\S]*aria-disabled="true" disabled hidden/);

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
assert.match(html, /Admin beta currently in testing/);
assert.match(html, /Interface preview only\. No camera or microphone is active\./);
assert.match(html, /The branded backdrop is automatic and cannot be disabled\./);
assert.match(html, /Always applied before video is shared/);
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
assert.match(client, /DueDiligenceSubscriptionCta\?\.isAudienceEligible\?\.\(value\) === true/);
assert.match(client, /const subscribed = known && !eligible/);
assert.match(client, /subscribe\.disabled = !eligible/);
assert.match(client, /subscribed \? 'Already subscribed' : 'Subscribe now'/);
assert.match(client, /isAdmin\(access\)[\s\S]*accessResolutionFailed[\s\S]*return openAdminRoom\(\)/);
assert.match(client, /new URL\('\/study-room\/', global\.location\.origin\)/);
assert.match(client, /global\.open\([\s\S]*roomUrl\.href[\s\S]*popup=yes[\s\S]*toolbar=no[\s\S]*location=no/);
assert.match(client, /popup\.opener = null/);
assert.match(client, /popup\.focus\?\.\(\)/);
assert.match(client, /adminRoomWindow && !adminRoomWindow\.closed[\s\S]*adminRoomWindow\.focus\?\.\(\)/);
assert.match(client, /adminRoomWindow = popup/);
assert.match(client, /if \(!popup\) \{[\s\S]*global\.location\.assign\(roomUrl\.href\)/);
assert.match(client, /try \{[\s\S]*popup = global\.open\([\s\S]*\} catch \{[\s\S]*global\.location\.assign\(roomUrl\.href\)/);
assert.doesNotMatch(client, /Allow pop-ups for Due Diligence/);
assert.match(client, /return openMarketingPreview\(trigger\)/);
assert.match(client, /target\?\.click\(\)/);
assert.match(client, /study_room_preview_opened/);
assert.match(html, /study-room-preview\.css\?v=study-room-mandatory-backdrop-20260829-1/);
assert.match(html, /study-room-preview\.js\?v=study-room-mandatory-backdrop-20260829-1/);

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

const subscriptionContext = vm.createContext({});
vm.runInContext(
  await readFile(path.join(root, 'assets/subscription-cta.js'), 'utf8'),
  subscriptionContext,
);
const accessContext = vm.createContext({
  ADMIN_ROLES: new Set(['admin', 'administrator', 'super admin', 'founder admin']),
  global: subscriptionContext,
});
for (const name of ['normalized', 'isAdmin', 'isSubscriptionEligible']) {
  vm.runInContext(extractNamedFunction(client, name), accessContext);
}
assert.equal(vm.runInContext("isAdmin({ role: 'founder_admin' })", accessContext), true);
assert.equal(vm.runInContext("isAdmin({ role: 'member' })", accessContext), false);
assert.equal(vm.runInContext("isSubscriptionEligible({ role: 'founder_admin' })", accessContext), false);
assert.equal(vm.runInContext("isSubscriptionEligible({ basis: 'founding_beta', freeBeta: { active: true }, unlimited: true })", accessContext), true);
assert.equal(vm.runInContext("isSubscriptionEligible({ basis: 'introductory', introductoryTokensEligible: true, unlimited: true })", accessContext), true);
assert.equal(vm.runInContext("isSubscriptionEligible({ subscription: { status: 'active', planCode: 'early_access_beta' } })", accessContext), false);
assert.equal(vm.runInContext("isSubscriptionEligible({ paidSubscriptionExpired: true, subscription: { status: 'expired' } })", accessContext), true);
assert.equal(vm.runInContext("isSubscriptionEligible({ globalBeta: { active: true }, unlimited: false })", accessContext), false);
assert.equal(vm.runInContext("isSubscriptionEligible({ basis: 'complimentary', unlimited: true })", accessContext), false);
assert.equal(vm.runInContext("isSubscriptionEligible({ role: 'member', subscription: null })", accessContext), true);
assert.equal(vm.runInContext("isSubscriptionEligible(null)", accessContext), false);

const adminWindowFunction = extractNamedFunction(client, 'openAdminRoom');
assert.doesNotMatch(adminWindowFunction, /openMarketingPreview/);
assert.doesNotMatch(adminWindowFunction, /setPreviewStatus/);
const openFunction = extractNamedFunction(client, 'open');
assert.doesNotMatch(openFunction, /await|\.then\(/, 'Study Room click routing must stay synchronous for popup user activation.');
assert.match(openFunction, /accessIsResolving\(\)[\s\S]*return false/);

assert.match(client, /function accessIsResolving\(\)[\s\S]*!authSettled[\s\S]*signedIn\(\) && !access/);
assert.match(client, /accessResolutionFailed[\s\S]*signedIn\(\) && headerShowsAdmin\(\)/);
assert.match(client, /querySelectorAll\('\[data-study-room-trigger\]'\)[\s\S]*trigger\.disabled = busy/);
assert.match(client, /setAttribute\('aria-busy', String\(busy\)\)/);
assert.match(client, /setAttribute\('aria-disabled', String\(busy\)\)/);
assert.match(client, /DueDiligencePhase2\?\.whenAuthReady\?\.\(\)/);
assert.match(client, /DueDiligencePhase4\?\.refreshAccess\?\.\(\{[\s\S]*enforce: false,[\s\S]*force: true/);
assert.match(client, /accessResolutionFailed = signedIn\(latestSession\) && !latestAccess/);
assert.match(client, /detail\?\.authenticated === false[\s\S]*\? null/);
assert.match(client, /access: !signedIn\(nextSession\) \|\| changedAccount \? null : access/);
assert.match(client, /if \(!signedIn\(readySession\)\) \{[\s\S]*session: null, access: null/);
assert.match(client, /if \(!current \|\| typeof current !== 'object'\) return null/);

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
  assert.doesNotMatch(client, forbidden, 'Phase one must remain a local marketing preview without live-room infrastructure.');
}
assert.doesNotMatch(css, /study-room-demo|home-current/);
assert.doesNotMatch(html, /study-room-demo|home-current|assets\/study-room\/[^"'\s>]+\.png/);
assert.match(pricingClient, /id="dd2-pricing-retry"/);
assert.match(pricingClient, /Plans &amp; Pricing could not load just now\./);
assert.match(html, /phase2-experience\.js[^"\n]*pricing=study-room-recovery-20260829-1/);
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

console.log('Study Room phase-one marketing contract tests passed.');
console.log('Optimized WebP total: ' + totalImageBytes + ' bytes.');

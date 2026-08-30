import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const index = read('index.html');
const experience = read('assets/phase2-experience.js');
const experienceCss = read('assets/phase2.css');
const configSource = read('assets/phase2-config.js');
const migration = read('supabase/migrations/20260728_003_phase2_guest_access_support.sql');
const legalPolicyMigration = read('supabase/migrations/20260818062500_current_legal_policy_contract.sql');
const worker = read('worker/index.mjs');
const wrangler = read('worker/wrangler.toml');

const sandbox = { window: {} };
vm.runInNewContext(configSource, sandbox);
const config = sandbox.window.DueDiligencePhase2Config;

assert.equal(config.guest.enabled, false);
assert.equal(config.legal.termsVersion, 'terms-soft-launch-v1-2026-08-21');
assert.equal(config.legal.privacyVersion, 'privacy-soft-launch-v1-2026-08-21');
assert.equal('marketingConsentVersion' in config.legal, false);
assert.deepEqual(Array.from(config.plans.items), []);
assert.equal(config.plans.catalogVersion, 'server-published-pricing-v1');
assert.equal(
  config.plans.notice,
  'Plans, prices, payment details, and QR codes load from the current published Admin revision.',
);
assert.equal(config.features.payments, true);
assert.equal(config.features.subscriptionEnforcement, true);
assert.equal(config.features.coachingBooking, false);

for (const expected of [
  'Welcome to Due Diligence',
  'Your chamber for serious Bar preparation.',
  'Continue with Google',
  'Save progress',
  'Personal analytics',
  'Syllabus-Based Review',
  '/beta/access/accept-terms',
  'complete_commercial_profile_onboarding_v2',
  'Introductory tokens and paid access',
  'one lifetime allowance of five practice tokens',
  "publicWorkerRequest('/beta/access/policy')",
  'await refreshLegalPolicy();',
  "document.getElementById('dd2-entry-consent-submit')?.addEventListener('click', submitEntryConsent);",
  'await waitForMaintenanceAccess();',
  'data-dd2-entry-video',
  'data-src="assets/brand/signin-intro.mp4?v=cropped-20260823-1"',
  'playEntryBrandMedia(entryMode);',
]) {
  assert.ok(experience.includes(expected), `Phase 2 experience must include: ${expected}`);
}

assert.match(experience, /id="dd2-guest-continue" hidden/);
assert.match(experience, /config\.guest\?\.enabled !== true[\s\S]*signInWithGoogle\(\)/);
assert.doesNotMatch(
  experience,
  /Current policy verification failed\. No acceptance was recorded\./,
  'The policy gate must not expose an internal verification failure to the user.',
);
assert.match(
  experience,
  /function waitForMaintenanceAccess\(\)[\s\S]*duediligence:maintenance-unlocked[\s\S]*await waitForMaintenanceAccess\(\);[\s\S]*await initializeAuth\(\);/,
  'Authentication and policy loading must wait until maintenance access is verified.',
);
assert.match(
  experience,
  /catch \{[\s\S]*configuredLegalPolicy\(\)[\s\S]*commercialLegal = Object\.freeze\(configuredPolicy\)/,
  'A matching release-config policy must keep the legal gate recoverable during a transient policy-read failure.',
);
assert.match(
  experience,
  /data-dd2-entry-video[\s\S]*autoplay muted playsinline[\s\S]*controlslist="nodownload nofullscreen noplaybackrate"/,
  'The legal/sign-in panel must use the approved silent, control-free intro video.',
);
assert.match(
  experience,
  /video\.addEventListener\('ended', finishEntryBrandMedia\)[\s\S]*frame\.classList\.add\('is-still'\)/,
  'The legal/sign-in video must resolve to the existing static brand image.',
);
assert.doesNotMatch(experience, /<video[^>]*\scontrols(?:\s|=|>)/,
  'The decorative legal/sign-in video must not expose playback controls.');
assert.match(experienceCss, /\.dd2-entry-brandmark-video[\s\S]*mask-image:[\s\S]*transition: opacity 360ms ease/,
  'The approved intro must blend into the existing navy composition and cross-fade smoothly.');
assert.match(experienceCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.dd2-entry-brandmark-video \{ transition: none; \}/,
  'Reduced-motion users must receive the static, non-animated presentation.');
assert.match(experienceCss, /\.dd2-entry-close \{[\s\S]*top: 18px;[\s\S]*right: 18px;/,
  'The entry dialog close control must remain anchored in the upper-right corner.');

assert.doesNotMatch(
  experience,
  /state\.client\.rpc\('accept_terms'/,
  'The browser must not directly write legal acceptance without Worker verification.',
);

for (const removedMarketingSurface of [
  'record_marketing_consent',
  'dd2-marketing-consent',
  'dd2-account-marketing',
  'Send me optional product and Bar-review updates',
  'Receive optional product and Bar-review updates',
]) {
  assert.equal(
    experience.includes(removedMarketingSurface),
    false,
    `Phase 2 experience must not collect a marketing preference: ${removedMarketingSurface}`,
  );
}
assert.ok(experience.includes('does not currently operate an email-marketing program'));
assert.ok(experience.includes('No email-marketing program is active.'));

for (const requiredHook of [
  'DueDiligencePhase2.beforeGrade',
  'DueDiligencePhase2?.gradingHeaders',
  'DueDiligencePhase2?.afterGrade',
  'DueDiligencePhase2?.handleGradeError',
]) {
  assert.ok(index.includes(requiredHook), `index must use ${requiredHook}`);
}

assert.doesNotMatch(`${index}\n${experience}\n${read('assets/phase2.css')}`, /phase2-law-library\.jpg|assets\/private-beta\/.+\.(?:avif|webp|jpe?g)/i);
assert.ok(experience.includes("['philippine-law-school', 'Philippine Law School']"));
assert.ok(experience.includes("['pampanga-state-university', 'Pampanga State University']"));
assert.match(experience, /id="dd2-school" list="dd2-school-suggestions"/);
assert.match(experience, /Suggestions are optional\. You may type and save any school name\./);
assert.match(experience, /p_law_school_id: school\.schoolId/);
assert.match(experience, /p_law_school_other: school\.schoolOther/);
assert.ok(index.includes('supabase-js@2.49.8'));
assert.ok(index.includes('data-dd2-view="terms"'));
assert.ok(index.includes('data-dd2-view="privacy"'));
assert.ok(experience.includes('Review the <button class="link-button" type="button" data-dd2-view="terms">Terms of Use</button>'));
assert.ok(experience.includes('data-dd2-view="privacy">Privacy Policy</button> before continuing.'));
assert.ok(experience.includes("note.innerHTML = 'Google opens its secure consent screen."));
assert.ok(index.includes('assets/phase2-experience.js?v=profile-photo-release2-20260827-1'));
assert.ok(index.includes('assets/phase2.css?release=profile-photo-release2-20260827-1'));
assert.match(experience, /nativeOverlay\.dataset\.nativeView = view/,
  'Native views must expose their active view so pricing can use the approved centered presentation.');
assert.match(experienceCss, /data-native-view="pricing"[\s\S]*align-items:\s*center;[\s\S]*justify-content:\s*center;/,
  'Plans and Pricing must render as a centered modal rather than the generic side sheet.');

for (const table of [
  'guest_grading_usage',
  'guest_grading_devices',
  'guest_grading_reservations',
  'support_requests',
]) {
  assert.ok(migration.includes(`public.${table}`), `migration must create ${table}`);
  assert.match(
    migration,
    new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`, 'i'),
    `${table} must not be client-writable`,
  );
}
for (const rpc of ['reserve_guest_grade', 'finalize_guest_grade', 'release_guest_grade']) {
  assert.ok(migration.includes(`function public.${rpc}`), `migration must define ${rpc}`);
}
assert.ok(migration.includes('pg_advisory_xact_lock'), 'reservation must use transaction-scoped locks');
assert.ok(migration.includes("status = 'reserved'"), 'pending reservations must be explicit');
assert.ok(migration.includes("status = 'released'"), 'failed-provider releases must be explicit');
assert.ok(worker.includes("pathname === '/support'"), 'Worker must expose native support');
assert.ok(worker.indexOf('reserveGradeAccess') < worker.indexOf('callGemini(env'), 'guest slot must be reserved before Gemini');
assert.ok(worker.includes("new URL('/auth/v1/user'"), 'signed-in bypass must verify the Supabase token');
assert.ok(worker.includes('GUEST_USAGE_HMAC_KEY'), 'guest identity must use an encrypted Worker secret');
assert.match(
  wrangler,
  /ALLOW_LEGACY_GUESTS\s*=\s*"false"/,
  'the committed Worker configuration must end in strict guest enforcement',
);
assert.ok(experience.includes('trapOverlayFocus'), 'Phase 2 dialogs must trap keyboard focus');
assert.equal(
  experience.includes('terms-commercial-v1-2026-08-18'),
  false,
  'The browser must not hard-code the current commercial Terms version.',
);
assert.equal(
  experience.includes('privacy-commercial-v1-2026-08-18'),
  false,
  'The browser must not hard-code the current commercial Privacy version.',
);
assert.match(legalPolicyMigration, /'termsVersion', s\.current_terms_version/);
assert.match(legalPolicyMigration, /'privacyVersion', s\.current_privacy_version/);
assert.match(
  legalPolicyMigration,
  /revoke all on function public\.phase4_global_beta_public_policy\(\)[\s\S]*from public, anon, authenticated/,
);

for (const forbidden of [
  /service_role\s*[:=]\s*['"][A-Za-z0-9._-]{20,}/i,
  /GUEST_USAGE_HMAC_KEY\s*[:=]\s*['"][A-Za-z0-9._-]{20,}/,
  /google.*client.*secret\s*[:=]/i,
]) {
  assert.doesNotMatch(`${index}\n${experience}\n${configSource}\n${migration}\n${worker}`, forbidden);
}

console.log('Phase 2 authentication, commercial onboarding, support, and access contract tests passed.');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const index = read('index.html');
const experience = read('assets/phase2-experience.js');
const configSource = read('assets/phase2-config.js');
const migration = read('supabase/migrations/20260728_003_phase2_guest_access_support.sql');
const legalPolicyMigration = read('supabase/migrations/20260818062500_current_legal_policy_contract.sql');
const worker = read('worker/index.mjs');
const wrangler = read('worker/wrangler.toml');

const sandbox = { window: {} };
vm.runInNewContext(configSource, sandbox);
const config = sandbox.window.DueDiligencePhase2Config;

assert.equal(config.guest.gradeLimit, 3);
assert.equal(config.legal.termsVersion, 'terms-beta-v2-2026-07-28');
assert.equal(config.legal.privacyVersion, 'privacy-beta-v2-2026-07-28');
assert.equal('marketingConsentVersion' in config.legal, false);
assert.deepEqual(Array.from(config.plans.items, (plan) => [
  plan.id,
  plan.pricingHidden,
]), [['premium', true]]);
assert.equal(config.plans.notice, 'Pricing will be announced after beta testing.');
assert.equal(config.features.payments, false);
assert.equal(config.features.subscriptionEnforcement, true);
assert.equal(config.features.coachingBooking, false);

for (const expected of [
  'Welcome to Due Diligence',
  'Your chamber for serious Bar preparation.',
  'Continue with Google',
  'Continue as Guest',
  'Save progress',
  'Personal analytics',
  'Guided Subject Matter practice',
  'Guest access includes 3 graded questions across all subjects.',
  'You have completed your 3 guest questions.',
  '/beta/access/accept-terms',
  'complete_commercial_profile_onboarding',
  'Free and Early Access',
  'five successful question submissions per Philippine calendar day',
  "publicWorkerRequest('/beta/access/policy')",
  'await refreshLegalPolicy();',
  "document.getElementById('dd2-entry-consent-submit')?.addEventListener('click', submitEntryConsent);",
]) {
  assert.ok(experience.includes(expected), `Phase 2 experience must include: ${expected}`);
}

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
assert.ok(index.includes('assets/phase2-experience.js?v=commercial-launch-20260818-5'));

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

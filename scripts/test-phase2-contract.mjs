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
const worker = read('worker/index.mjs');
const wrangler = read('worker/wrangler.toml');

const sandbox = { window: {} };
vm.runInNewContext(configSource, sandbox);
const config = sandbox.window.DueDiligencePhase2Config;

assert.equal(config.guest.gradeLimit, 3);
assert.equal(config.legal.termsVersion, 'terms-beta-v2-2026-07-28');
assert.equal(config.legal.privacyVersion, 'privacy-beta-v2-2026-07-28');
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
  'accept_terms',
  'record_marketing_consent',
  'complete_profile_onboarding',
]) {
  assert.ok(experience.includes(expected), `Phase 2 experience must include: ${expected}`);
}

for (const requiredHook of [
  'DueDiligencePhase2.beforeGrade',
  'DueDiligencePhase2?.gradingHeaders',
  'DueDiligencePhase2?.afterGrade',
  'DueDiligencePhase2?.handleGradeError',
]) {
  assert.ok(index.includes(requiredHook), `index must use ${requiredHook}`);
}

assert.ok(index.includes('assets/phase2-law-library.jpg') || read('assets/phase2.css').includes('phase2-law-library.jpg'));
assert.ok(index.includes('supabase-js@2.49.8'));
assert.ok(index.includes('data-dd2-view="terms"'));
assert.ok(index.includes('data-dd2-view="privacy"'));
assert.ok(experience.includes('Review the <button class="link-button" type="button" data-dd2-view="terms">Terms of Use</button>'));
assert.ok(experience.includes('data-dd2-view="privacy">Privacy Policy</button> before continuing.'));
assert.ok(experience.includes("note.innerHTML = 'Google opens its secure consent screen."));
assert.ok(index.includes('assets/phase2-experience.js?v=auth-persistence-20260812-1'));

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

for (const forbidden of [
  /service_role\s*[:=]\s*['"][A-Za-z0-9._-]{20,}/i,
  /GUEST_USAGE_HMAC_KEY\s*[:=]\s*['"][A-Za-z0-9._-]{20,}/,
  /google.*client.*secret\s*[:=]/i,
]) {
  assert.doesNotMatch(`${index}\n${experience}\n${configSource}\n${migration}\n${worker}`, forbidden);
}

console.log('Phase 2 authentication, guest-limit, support, and concealed beta pricing contract tests passed.');

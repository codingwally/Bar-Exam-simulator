import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

const phase2 = read('assets/phase2-experience.js');
const phase4 = read('assets/phase4-experience.js');
const index = read('index.html');
const admin = read('admin/admin.js');
const adminHtml = read('admin/index.html');
const worker = read('worker/index.mjs');
const workerConfig = read('worker/wrangler.toml');
const phase1Migration = read('supabase/migrations/20260727_002_auth_user_data_analytics_foundation.sql');
const phase4Migration = read('supabase/migrations/20260730_005_phase4_access_subscriptions.sql');

assert.match(
  workerConfig,
  /REQUIRE_AUTHENTICATED_SUBMISSIONS\s*=\s*"true"/,
  'Production Worker configuration must require authenticated submissions.',
);
assert.match(
  worker,
  /requireAuthenticatedSubmission/,
  'Worker must centralize authenticated submission enforcement.',
);
for (const handler of ['handleGrade', 'handleCorrection', 'handleSupport', 'handlePartnershipSubmit']) {
  const start = worker.indexOf(`async function ${handler}`);
  assert.notEqual(start, -1, `${handler} must exist`);
  const body = worker.slice(start, worker.indexOf('\n}', start) + 2);
  assert.match(
    body,
    /requireAuthenticatedSubmission/,
    `${handler} must authenticate before accepting user-generated content.`,
  );
}

assert.doesNotMatch(
  phase2,
  /authRequired:\s*false/,
  'Native user-generated forms must not opt out of authentication.',
);
assert.match(
  phase2,
  /pageshow/,
  'OAuth controls must recover after browser back/forward cache navigation.',
);
assert.match(
  phase2,
  /auth.*timeout|timeout.*auth/is,
  'OAuth must provide a visible stalled-attempt timeout.',
);
assert.match(
  phase2,
  /pendingSubmission|submissionDraft|draft.*sign.?in/is,
  'Safe form drafts must survive a required sign-in redirect.',
);
assert.equal(
  (phase2.match(/dd2-native-close'\)\?\.addEventListener\('click', closeNativeView\)/g) || []).length,
  1,
  'The native-view close control must have one stable listener instead of stacking per render.',
);
assert.doesNotMatch(
  phase2,
  /dd2-native-close'[\s\S]{0,120}\{\s*once:\s*true\s*\}/,
  'The persistent native-view close control must not consume its listener after one use.',
);
assert.match(
  phase2,
  /function closeNativeView\(\)\s*\{[\s\S]{0,720}hideNativeView\(\);[\s\S]{0,260}history\.back\(\)/,
  'Closing a native view must hide it immediately before asynchronous history navigation.',
);
assert.match(
  phase2,
  /history\.state\?\.dd2View\s*\?\s*'replaceState'\s*:\s*'pushState'/,
  'Switching between native views must replace, rather than stack, modal history entries.',
);
assert.match(
  phase4,
  /AUTHENTICATION_REQUIRED/,
  'Protected exam access must retain an explicit authentication error.',
);
assert.match(
  index,
  /id="suggest-submit"[^>]+type="button"/,
  'Correction submission must use an explicit non-default button type.',
);

for (const id of ['action-dialog-close', 'action-dialog-cancel']) {
  assert.match(
    adminHtml,
    new RegExp(`id="${id}"[^>]+type="button"`),
    `${id} must be an explicit non-submit control.`,
  );
}
assert.match(
  adminHtml,
  /id="action-confirm"[^>]+type="submit"/,
  'Only the audited action confirmation may submit its form.',
);
assert.match(
  admin,
  /cancelActionDialog/,
  'Admin action dialog must have a validation-free cancel path.',
);

assert.match(
  phase1Migration,
  /create or replace function public\.complete_profile_onboarding/,
  'The existing onboarding function must remain documented in migration history.',
);
assert.match(
  phase4Migration,
  /terms-beta-v2-2026-07-28/,
  'Phase 4 current legal versions must remain authoritative.',
);
assert.ok(
  read('supabase/migrations/20260801_010_release_a_auth_submission_fix.sql')
    .includes('platform_access_settings'),
  'Release A must reconcile profile onboarding with the current legal-version settings.',
);

console.log('Release A authentication, submission authorization, dialog-exit, and onboarding contracts passed.');

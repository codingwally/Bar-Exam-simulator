import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const actionCoreSource = await readFile(
  new URL('../admin/subscription-actions-core.js', import.meta.url),
  'utf8',
);
const actionCoreSandbox = {};
actionCoreSandbox.globalThis = actionCoreSandbox;
runInNewContext(actionCoreSource, actionCoreSandbox);
const actions = actionCoreSandbox.DueDiligenceSubscriptionActions;

const activeRow = Object.freeze({
  user_id: '11111111-1111-4111-8111-111111111111',
  subscription_id: '22222222-2222-4222-8222-222222222222',
  subscription_status: 'active',
  free_beta_enabled: false,
});
const pausedRow = Object.freeze({
  ...activeRow,
  subscription_status: 'paused',
  free_beta_enabled: true,
});
const noSubscriptionRow = Object.freeze({
  user_id: activeRow.user_id,
  subscription_id: null,
  subscription_status: null,
  free_beta_enabled: false,
});

const labels = (row, role) => actions.actionsForSubscription(row, role)
  .map((item) => item.label);

for (const role of ['super_admin', 'founder_admin']) {
  const activeLabels = labels(activeRow, role);
  assert.ok(activeLabels.includes('Change Plan'), `${role} can change plans`);
  assert.ok(activeLabels.includes('Suspend'), `${role} can suspend active access`);
  assert.ok(activeLabels.includes('Expire now'), `${role} can expire active access`);
  assert.ok(activeLabels.includes('Revoke'), `${role} can revoke active access`);
  assert.ok(activeLabels.includes('Extend'), `${role} can extend active access`);
  assert.ok(activeLabels.includes('Change Start Date'), `${role} can change start date`);
  assert.ok(activeLabels.includes('Change Expiration Date'), `${role} can change expiration`);
  assert.ok(activeLabels.includes('Enable Free Beta'), `${role} can enable Free Beta`);
  assert.ok(activeLabels.includes('Grant Complimentary Access'), `${role} can grant access`);
  assert.ok(activeLabels.includes('Apply Discount'), `${role} can apply discounts`);
  assert.ok(activeLabels.includes('View Audit History'), `${role} can view audit history`);
}

assert.ok(labels(pausedRow, 'founder_admin').includes('Resume'));
assert.ok(labels(pausedRow, 'founder_admin').includes('Disable Free Beta'));
assert.ok(labels(noSubscriptionRow, 'super_admin').includes('Activate Retainer'));
assert.ok(labels(noSubscriptionRow, 'super_admin').includes('Change Plan'));
assert.equal(labels(activeRow, 'student').length, 0);
assert.equal(labels(activeRow, '').length, 0);

const plans = actions.availablePlans({
  items: [
    { id: 'early_access_beta', name: 'Early Access Beta', pricePhp: 149, durationDays: 30, previewStatus: 'active' },
    { id: 'standard', name: 'Standard', pricePhp: 249, durationDays: 30, previewStatus: 'active' },
    { id: 'premium', name: 'Premium', pricePhp: 499, durationDays: null, previewStatus: 'active' },
  ],
});
assert.equal(plans[0].disabled, false);
assert.equal(plans[1].disabled, false);
assert.equal(plans[2].disabled, false);
assert.equal(plans[2].statusLabel, 'Available');
assert.equal(
  plans[2].note,
  'Explicit expiration required. Bar Feels included.',
);

const [
  adminSource,
  adminHtml,
  adminCss,
  workerSource,
  migrationSource,
  artifactSource,
  bundleBuilderSource,
] =
  await Promise.all([
    readFile(new URL('../admin/admin.js', import.meta.url), 'utf8'),
    readFile(new URL('../admin/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../admin/admin.css', import.meta.url), 'utf8'),
    readFile(new URL('../worker/index.mjs', import.meta.url), 'utf8'),
    readFile(
      new URL('../supabase/migrations/20260804_014_premium_499_entitlements.sql', import.meta.url),
      'utf8',
    ),
    readFile(new URL('./build-pages-artifact.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./build-admin-subscription-hotfix-bundle.mjs', import.meta.url), 'utf8'),
  ]);

const subscriptionRenderer = adminSource.slice(
  adminSource.indexOf('async function renderSubscriptions'),
  adminSource.indexOf('async function renderPayments'),
);
assert.doesNotMatch(subscriptionRenderer, /\$\{actionButton\(/);
assert.doesNotMatch(subscriptionRenderer, /\[object Object\]/);
assert.match(subscriptionRenderer, /data-subscription-actions-for/);
assert.match(adminSource, /document\.createElement\('button'\)/);
assert.match(adminSource, /button\.addEventListener\('click'/);
assert.match(adminSource, /state\.actionInFlight/);
assert.match(adminSource, /state\.action\.requestKey \|\|= uuidKey\(\)/);
assert.match(adminSource, /Confirm that you verified the target/);
assert.match(
  adminHtml,
  /<dialog id="action-dialog"[^>]*aria-labelledby="action-title"/,
);
assert.match(adminHtml, /id="action-confirm-risk"/);
assert.match(adminHtml, /subscription-actions-core\.js/);
assert.match(adminCss, /@media \(max-width: 560px\)/);
assert.match(adminCss, /\.plan-option\.disabled/);
assert.match(workerSource, /phase4_admin_manage_subscription/);
assert.match(workerSource, /phase4_admin_subscription_audit/);
assert.match(migrationSource, /phase4_require_founder\(p_actor_user_id\)/);
assert.match(migrationSource, /Premium activation requires an explicit future expiration/);
assert.match(migrationSource, /Subscription does not belong to target user/);
assert.match(migrationSource, /insert into public\.subscription_history/);
assert.match(migrationSource, /insert into public\.admin_audit_log/);
assert.match(migrationSource, /admin_action_requests/);
assert.match(artifactSource, /admin\/subscription-actions-core\.js/);
assert.match(bundleBuilderSource, /20260731009/);
assert.match(bundleBuilderSource, /sha256:/);
assert.match(bundleBuilderSource, /Migration \$\{version\} is already recorded/);

console.log('Admin subscription action renderer and security contract checks passed.');

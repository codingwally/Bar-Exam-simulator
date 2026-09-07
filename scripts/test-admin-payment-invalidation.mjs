import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
const [migration, worker, paymentCore, admin, adminPage, subscriptionActions] = await Promise.all([
  read('supabase/migrations/20260901120000_admin_payment_invalidation.sql'),
  read('worker/index.mjs'),
  read('worker/payment-core.mjs'),
  read('admin/admin.js'),
  read('admin/index.html'),
  read('admin/subscription-actions-core.js'),
]);

assert.match(migration, /create or replace function public\.phase4_admin_invalidate_payment\(/u);
assert.match(migration, /security invoker[\s\S]*set search_path = ''/u);
assert.match(migration, /perform public\.phase4_require_founder\(p_actor_user_id\)/u);
assert.match(migration, /'payment_invalidate'/u);
assert.match(migration, /for update/u);
assert.match(migration, /hashtextextended\('subscription:' \|\| v_payment\.user_id::text, 0\)/u);
assert.match(migration, /hashtextextended\(v_payment\.user_id::text, 499\)/u);
assert.match(migration, /v_pair_count <> 1/u);
assert.match(migration, /payment_history\.action = 'approved'[\s\S]*payment_history\.new_status = 'approved'/u);
assert.match(migration, /subscription_history\.actor_user_id = payment_history\.actor_user_id/u);
assert.match(migration, /to_jsonb\(v_subscription\) @> v_approval_history\.new_state/u);
assert.match(migration, /other_payment\.status = 'approved'/u);
assert.match(migration, /other_approval\.approval_count = 1/u);
assert.match(migration, /other_lineage\.pair_count = 1/u);
assert.match(migration, /other_lineage\.ancestor_pair_count = 1/u);
assert.match(migration, /v_approval_history\.previous_state->>'version'/u);
assert.match(migration, /active refund workflow/u);
assert.match(migration, /v_payment\.approved_entitlement_changed is distinct from false/u);
assert.match(migration, /v_approval_history\.action is distinct from 'activate'[\s\S]*v_approval_history\.previous_state is distinct from '\{\}'::jsonb/u);
assert.match(migration, /source = 'invalidated_payment'/u);
assert.match(migration, /source <> 'invalidated_payment' or status = 'cancelled'/u);
assert.match(migration, /set status = 'rejected'/u);
assert.match(migration, /when subscriber_receipt_status = 'sent' then 'sent'[\s\S]*else 'suppressed'/u);
assert.match(migration, /subscriber_receipt_status = 'sending'[\s\S]*nothing changed/iu);
assert.match(migration, /public\.phase4_access_snapshot\(v_payment\.user_id, false, null\)/u);
assert.match(migration, /'introductoryTokensPreserved', true/u);
assert.match(migration, /'proofPreserved', true/u);
assert.match(migration, /insert into public\.payment_request_history/u);
assert.match(migration, /insert into public\.subscription_history/u);
assert.match(migration, /insert into public\.admin_audit_log/u);
assert.doesNotMatch(migration, /\n\s*'restore',\s*\n/u);
assert.match(migration, /revoke all on function public\.phase4_admin_invalidate_payment\([\s\S]*from public, anon, authenticated, service_role/u);
assert.match(migration, /grant execute on function public\.phase4_admin_invalidate_payment\([\s\S]*to service_role/u);

for (const destructiveStatement of [
  /delete\s+from\s+public\.payment_requests/iu,
  /delete\s+from\s+public\.payment_request_history/iu,
  /delete\s+from\s+public\.subscription_history/iu,
  /delete\s+from\s+public\.introductory_token/iu,
  /update\s+public\.introductory_token/iu,
]) {
  assert.doesNotMatch(migration, destructiveStatement);
}
assert.doesNotMatch(
  migration,
  /examination|exam_attempt|question|answer|grade|simulation/iu,
  'The payment invalidation migration must remain isolated from examination data and functions.',
);

assert.match(paymentCore, /'payment_review', 'payment_invalidate', 'refund_review'/u);
assert.match(paymentCore, /if \(action === 'payment_invalidate'\)[\s\S]*actionPayload = \{\}/u);
assert.match(worker, /action\.action === 'payment_invalidate'[\s\S]*phase4_admin_invalidate_payment/u);
assert.match(worker, /PAYMENT_INVALIDATION_UNSAFE/u);
assert.match(worker, /PAYMENT_RECEIPT_IN_FLIGHT/u);
assert.match(worker, /subscription \(\?:was \)\?changed/u);
assert.doesNotMatch(
  worker.match(/action\.action === 'payment_invalidate'[\s\S]*?\} else if \(action\.action === 'payment_review'\)/u)?.[0] || '',
  /p_payload/u,
);

assert.match(admin, /=== 'approved' && founderAuthorized[\s\S]*'payment_invalidate'/u);
assert.match(admin, /Mark proof invalid & cancel access/u);
assert.match(admin, /if \(action === 'payment_invalidate'\) return true/u);
assert.match(admin, /proofNextAction === 'payment_invalidate'[\s\S]*openAction\('payment_invalidate'/u);
assert.match(admin, /Introductory tokens are not replenished/u);
assert.match(admin, /PAYMENT_INVALIDATION_NO_CHANGE_CODES\.has\(error\.code\)/u);
assert.match(admin, /Outcome not confirmed\. The request may have completed/u);
assert.match(admin, /same safety key is reused/u);
assert.match(admin, /state\.action\.requestReason \|\|= reason/u);
assert.match(admin, /reason: action === 'payment_invalidate' \? state\.action\.requestReason : reason/u);
assert.match(admin, /Retry same request safely/u);
assert.match(admin, /delete state\.action\.requestKey[\s\S]*delete state\.action\.requestReason/u);
assert.match(admin, /state\.actionInFlight[\s\S]*state\.action\?\.action === 'payment_invalidate'[\s\S]*options\.allowInFlight !== true/u);
assert.match(admin, /cancelActionDialog\(\{ allowInFlight: true \}\)/u);
assert.match(admin, /'payment_review','payment_invalidate','refund_review'/u);
assert.match(adminPage, /payment-invalidation=20260901-1/u);
assert.match(subscriptionActions, /source === 'invalidated_payment'/u);
assert.match(subscriptionActions, /&& !invalidatedPayment/u);

console.log(JSON.stringify({
  ok: true,
  action: 'payment_invalidate',
  isolation: 'admin-payment-only',
  databasePolicy: 'fail-closed-causal-reversal',
}));

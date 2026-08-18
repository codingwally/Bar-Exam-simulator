-- Remove the abandoned duplicate payment-notification implementation created
-- during a concurrent hotfix attempt. The authoritative production path is:
--
--   public.payment_verification_recipients
--   -> worker/commercial-entry.mjs
--   -> Resend attachment delivery
--
-- This migration is idempotent and does not alter payment requests,
-- subscriptions, access decisions, or the authoritative verifier directory.

begin;

drop trigger if exists phase4_enqueue_payment_notification_trigger
  on public.payment_requests;

drop function if exists public.phase4_enqueue_payment_notification();
drop function if exists public.phase4_choose_launch_trial(uuid, text);
drop function if exists public.phase4_payment_notification_context(uuid, uuid);
drop function if exists public.phase4_claim_payment_notification(uuid, integer);
drop function if exists public.phase4_claim_payment_notification_batch(integer, integer);
drop function if exists public.phase4_complete_payment_notification(uuid, uuid, text);
drop function if exists public.phase4_fail_payment_notification(uuid, uuid, text);

drop table if exists public.payment_notification_deliveries;
drop table if exists public.payment_verifier_recipients;

commit;

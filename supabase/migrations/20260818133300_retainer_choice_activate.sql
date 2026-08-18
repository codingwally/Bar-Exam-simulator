-- Activate explicit Free Trial or Early Access selection.
-- Split from the reviewed explicit Retainer choice release for rolling safety.

begin;

update public.platform_access_settings
set mandatory_access_choice_enabled = true,
    launch_trial_ends_at = '2026-09-01 23:59:59+08'::timestamptz,
    commercial_policy_version = commercial_policy_version + 1,
    commercial_updated_at = now(),
    updated_at = now()
where singleton = true;

comment on function public.phase4_access_snapshot(uuid, boolean, text)
  is 'Resolver requiring an explicit Free Trial or Early Access choice for ordinary accounts.';
comment on function public.phase4_choose_access(text, text)
  is 'Authenticated idempotent Retainer choice; identity comes only from auth.uid().';
comment on function public.phase4_plan_catalog()
  is 'Worker catalog for Free Trial and one-time ₱149 Early Access choices.';

commit;

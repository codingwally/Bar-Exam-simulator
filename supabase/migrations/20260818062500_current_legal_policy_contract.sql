begin;

-- The browser must never guess which legal-document versions are current.
-- This public policy contains only non-sensitive release metadata; the Worker
-- remains the sole caller of the service-role RPC.
create or replace function public.phase4_global_beta_public_policy()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', s.global_beta_all_access_enabled,
    'commercialLaunchEnabled', s.commercial_launch_enabled,
    'legal', jsonb_build_object(
      'termsVersion', s.current_terms_version,
      'privacyVersion', s.current_privacy_version
    )
  )
  from public.platform_access_settings s
  where s.singleton = true
$$;

revoke all on function public.phase4_global_beta_public_policy()
  from public, anon, authenticated;
grant execute on function public.phase4_global_beta_public_policy()
  to service_role;

comment on function public.phase4_global_beta_public_policy()
  is 'Public, non-sensitive launch and current legal-document metadata returned only through the Worker.';

commit;

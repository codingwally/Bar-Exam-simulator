-- Release A: reconcile profile onboarding with the current legal-version settings.
-- This replaces one existing RPC in place. It creates no table and changes no
-- stored profile, subscription, examination, grading, or question-bank record.

begin;

create or replace function public.complete_profile_onboarding(
  p_display_name text,
  p_school text,
  p_enrollment_status text,
  p_year_level text,
  p_terms_version text default 'terms-beta-v2-2026-07-28',
  p_privacy_version text default 'privacy-beta-v2-2026-07-28'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_settings public.platform_access_settings%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into strict v_settings
  from public.platform_access_settings
  where singleton = true;

  if p_enrollment_status is null
     or p_enrollment_status not in ('enrolled', 'not_yet_enrolled') then
    raise exception 'Invalid enrollment status';
  end if;

  if btrim(coalesce(p_terms_version, '')) <> v_settings.current_terms_version
     or btrim(coalesce(p_privacy_version, '')) <> v_settings.current_privacy_version then
    raise exception 'Current Terms and Privacy versions are required';
  end if;

  if p_enrollment_status = 'enrolled'
     and (
       nullif(btrim(p_school), '') is null
       or nullif(btrim(p_year_level), '') is null
     ) then
    raise exception 'School and year level are required for enrolled students';
  end if;

  if not exists (
    select 1
    from public.terms_acceptances
    where user_id = v_user_id
      and terms_version = v_settings.current_terms_version
      and privacy_version = v_settings.current_privacy_version
  ) then
    raise exception 'Required terms have not been accepted';
  end if;

  update public.profiles
  set display_name = nullif(btrim(p_display_name), ''),
      school = case
        when p_enrollment_status = 'not_yet_enrolled' then nullif(btrim(p_school), '')
        else btrim(p_school)
      end,
      enrollment_status = p_enrollment_status,
      year_level = case
        when p_enrollment_status = 'not_yet_enrolled' then nullif(btrim(p_year_level), '')
        else btrim(p_year_level)
      end,
      profile_completed_at = now()
  where id = v_user_id;

  if not found then
    raise exception 'Profile does not exist for authenticated user';
  end if;
end;
$$;

revoke all on function public.complete_profile_onboarding(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_profile_onboarding(text, text, text, text, text, text)
  to authenticated;

commit;

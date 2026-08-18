begin;

-- Legal acceptance is written by the trusted Worker after it verifies the
-- caller's Supabase session. The browser never supplies a user id or a legal
-- document version, so stale clients cannot acknowledge the wrong contract.
create or replace function public.phase4_accept_current_terms_for_user(
  p_user_id uuid,
  p_acceptance_source text default 'web_authenticated_acceptance'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_terms_version text;
  v_privacy_version text;
  v_accepted_at timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Trusted backend access is required'
      using errcode = '42501';
  end if;

  if p_user_id is null
     or not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'Authenticated user does not exist'
      using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_acceptance_source, '')), '') is null
     or char_length(btrim(p_acceptance_source)) > 80 then
    raise exception 'A valid acceptance source is required'
      using errcode = '22023';
  end if;

  select
    s.current_terms_version,
    s.current_privacy_version
  into strict
    v_terms_version,
    v_privacy_version
  from public.platform_access_settings s
  where s.singleton = true;

  if nullif(btrim(v_terms_version), '') is null
     or nullif(btrim(v_privacy_version), '') is null then
    raise exception 'Current legal-document versions are unavailable';
  end if;

  insert into public.terms_acceptances (
    user_id,
    terms_version,
    privacy_version,
    accepted_at,
    acceptance_source
  )
  values (
    p_user_id,
    btrim(v_terms_version),
    btrim(v_privacy_version),
    now(),
    btrim(p_acceptance_source)
  )
  on conflict (user_id, terms_version, privacy_version) do nothing;

  select t.accepted_at
  into strict v_accepted_at
  from public.terms_acceptances t
  where t.user_id = p_user_id
    and t.terms_version = btrim(v_terms_version)
    and t.privacy_version = btrim(v_privacy_version);

  return jsonb_build_object(
    'recorded', true,
    'termsVersion', btrim(v_terms_version),
    'privacyVersion', btrim(v_privacy_version),
    'acceptedAt', v_accepted_at
  );
end;
$$;

revoke all on function public.phase4_accept_current_terms_for_user(uuid, text)
  from public, anon, authenticated;
grant execute on function public.phase4_accept_current_terms_for_user(uuid, text)
  to service_role;

comment on function public.phase4_accept_current_terms_for_user(uuid, text)
  is 'Idempotently records the current legal versions for a Worker-authenticated user; service-role only.';

commit;

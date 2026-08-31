-- Require the September 1, 2026 Bar Forecast disclosure without deleting
-- consent recorded for the prior disclosure version.

begin;

alter table public.dd2026_bar_forecast_consents
  drop constraint if exists dd2026_bar_forecast_consents_consent_version_check;
alter table public.dd2026_bar_forecast_consents
  add constraint dd2026_bar_forecast_consents_consent_version_check check (
    consent_version in ('2026-08-31', '2026-09-01')
  );

create or replace function public.dd2026_bar_forecast_consent_status(
  p_actor_user_id uuid,
  p_consent_version text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor_user_id is null or not public.dd2026_is_admin(p_actor_user_id) then
    raise exception 'DD2026_ADMIN_REQUIRED';
  end if;
  if p_consent_version is distinct from '2026-09-01' then
    raise exception 'DD2026_BAR_FORECAST_CONSENT_VERSION_INVALID';
  end if;

  return jsonb_build_object(
    'consentAccepted',
    exists (
      select 1
      from public.dd2026_bar_forecast_consents c
      where c.user_id = p_actor_user_id
        and c.consent_version = p_consent_version
    )
  );
end;
$$;

create or replace function public.dd2026_bar_forecast_accept_consent(
  p_actor_user_id uuid,
  p_consent_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor_user_id is null or not public.dd2026_is_admin(p_actor_user_id) then
    raise exception 'DD2026_ADMIN_REQUIRED';
  end if;
  if p_consent_version is distinct from '2026-09-01' then
    raise exception 'DD2026_BAR_FORECAST_CONSENT_VERSION_INVALID';
  end if;

  insert into public.dd2026_bar_forecast_consents (
    user_id,
    consent_version,
    accepted_at
  ) values (
    p_actor_user_id,
    p_consent_version,
    now()
  )
  on conflict (user_id, consent_version) do nothing;

  return jsonb_build_object('consentAccepted', true);
end;
$$;

create or replace function public.dd2026_bar_forecast_admin_list(
  p_actor_user_id uuid,
  p_subject text,
  p_consent_version text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_count integer;
  v_rank_count integer;
begin
  -- The flag remains disabled for every public/commercial route. This RPC is
  -- intentionally available only through a separately authenticated admin route.
  if p_actor_user_id is null or not public.dd2026_is_admin(p_actor_user_id) then
    raise exception 'DD2026_ADMIN_REQUIRED';
  end if;
  if p_consent_version is distinct from '2026-09-01' then
    raise exception 'DD2026_BAR_FORECAST_CONSENT_VERSION_INVALID';
  end if;
  if not exists (
    select 1
    from public.dd2026_bar_forecast_consents c
    where c.user_id = p_actor_user_id
      and c.consent_version = p_consent_version
  ) then
    raise exception 'DD2026_BAR_FORECAST_CONSENT_REQUIRED';
  end if;
  if p_subject is null or p_subject not in (
    'Political and Public International Law',
    'Commercial and Taxation Laws',
    'Civil Law and Land Titles and Deeds',
    'Labor Law and Social Legislation',
    'Criminal Law',
    'Remedial Law, Legal and Judicial Ethics, with Practical Exercises'
  ) then
    raise exception 'DD2026_BAR_FORECAST_SUBJECT_INVALID';
  end if;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'contentType', i.content_type,
          'subject', i.subject,
          'title', i.title,
          'version', v.source_version,
          'payload', v.payload
        )
        order by (v.payload ->> 'rank_within_subject')::integer, i.id
      ),
      '[]'::jsonb
    ),
    count(*)::integer,
    count(distinct (v.payload ->> 'rank_within_subject'))::integer
  into v_items, v_count, v_rank_count
  from public.dd2026_content_items i
  join public.dd2026_content_versions v
    on v.id = i.current_published_version_id
  where i.content_type = 'bar_forecast_question'
    and i.subject = p_subject
    and v.source_version = '2026.3'
    and v.source_status = 'AI_PREPARED_BETA'
    and v.lifecycle_state = 'published'
    and v.payload ->> 'version' = '2026.3'
    and v.payload ->> 'subject' = p_subject
    and coalesce(v.payload ->> 'rank_within_subject', '') ~ '^(20|1[0-9]|[1-9])$';

  if v_count <> 20 or v_rank_count <> 20 then
    raise exception 'DD2026_BAR_FORECAST_INCOMPLETE';
  end if;

  return jsonb_build_object('items', v_items, 'total', v_count);
end;
$$;

revoke all on function public.dd2026_bar_forecast_consent_status(uuid, text)
  from public, anon, authenticated;
revoke all on function public.dd2026_bar_forecast_accept_consent(uuid, text)
  from public, anon, authenticated;
revoke all on function public.dd2026_bar_forecast_admin_list(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.dd2026_bar_forecast_consent_status(uuid, text)
  to service_role;
grant execute on function public.dd2026_bar_forecast_accept_consent(uuid, text)
  to service_role;
grant execute on function public.dd2026_bar_forecast_admin_list(uuid, text, text)
  to service_role;

commit;

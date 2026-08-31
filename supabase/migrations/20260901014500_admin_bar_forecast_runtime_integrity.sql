-- Fail closed unless every returned Forecast row has matching envelope and
-- payload identity plus complete checksum, prompt, rank, and editorial coverage.

begin;

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
  v_prompt_count integer;
  v_editorial_count integer;
  v_checksum_count integer;
begin
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
          'checksum', v.checksum,
          'payload', v.payload
        )
        order by (v.payload ->> 'rank_within_subject')::integer, i.id
      ),
      '[]'::jsonb
    ),
    count(*)::integer,
    count(distinct (v.payload ->> 'rank_within_subject'))::integer,
    count(distinct (v.payload ->> 'prompt'))::integer,
    count(distinct (v.payload ->> 'editorial_ref'))::integer,
    count(distinct v.checksum)::integer
  into
    v_items,
    v_count,
    v_rank_count,
    v_prompt_count,
    v_editorial_count,
    v_checksum_count
  from public.dd2026_content_items i
  join public.dd2026_content_versions v
    on v.id = i.current_published_version_id
  where i.content_type = 'bar_forecast_question'
    and i.subject = p_subject
    and v.source_version = '2026.3'
    and v.source_status = 'AI_PREPARED_BETA'
    and v.lifecycle_state = 'published'
    and v.payload ->> 'id' = i.id
    and v.payload ->> 'version' = v.source_version
    and v.payload ->> 'subject' = i.subject
    and i.title = concat(v.payload ->> 'editorial_ref', ' — ', v.payload ->> 'title')
    and v.checksum ~ '^[0-9a-f]{64}$'
    and coalesce(v.payload ->> 'prompt', '') <> ''
    and coalesce(v.payload ->> 'editorial_ref', '') <> ''
    and coalesce(v.payload ->> 'rank_within_subject', '') ~ '^(20|1[0-9]|[1-9])$';

  if v_count <> 20
    or v_rank_count <> 20
    or v_prompt_count <> 20
    or v_editorial_count <> 20
    or v_checksum_count <> 20
  then
    raise exception 'DD2026_BAR_FORECAST_INTEGRITY_INVALID';
  end if;

  return jsonb_build_object(
    'items', v_items,
    'total', v_count,
    'sourceVersion', '2026.3',
    'contentType', 'bar_forecast_question'
  );
end;
$$;

revoke all on function public.dd2026_bar_forecast_admin_list(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.dd2026_bar_forecast_admin_list(uuid, text, text)
  to service_role;

commit;

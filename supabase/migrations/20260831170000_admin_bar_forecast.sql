-- DueDiligence 2026 administrator-only Bar Forecast boundary.
-- Additive to the existing 2026.1 content foundation: Forecast content uses
-- the dedicated bar_forecast_question type and the legally reviewed 2026.3 source.

begin;

insert into public.dd2026_feature_flags (flag_key, enabled, description)
values
  ('BAR_FORECAST_ENABLED', false, 'Keep the Bar Forecast unavailable to public and commercial-member routes by default.'),
  ('BAR_FORECAST_ADMIN_ONLY', true, 'Restrict the Bar Forecast to independently authorized administrators.')
on conflict (flag_key) do nothing;

alter table public.dd2026_content_items
  drop constraint if exists dd2026_content_items_content_type_check;
alter table public.dd2026_content_items
  add constraint dd2026_content_items_content_type_check check (
    content_type in (
      'bar_easy',
      'doctrine',
      'chair_case',
      'anchor_case',
      'bar_forecast_question'
    )
  );

alter table public.dd2026_content_versions
  drop constraint if exists dd2026_content_versions_source_version_check;
alter table public.dd2026_content_versions
  add constraint dd2026_content_versions_source_version_check check (
    source_version in ('2026.1', '2026.3')
  );

-- Preserve every 2026.1 import path while admitting only the dedicated
-- Forecast type at source version 2026.3.
create or replace function public.dd2026_import_content_batch(
  p_actor_user_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_id text;
  v_type text;
  v_subject text;
  v_title text;
  v_checksum text;
  v_source_version text;
  v_item public.dd2026_content_items%rowtype;
  v_item_exists boolean;
  v_version public.dd2026_content_versions%rowtype;
  v_revision integer;
  v_human_review boolean;
  v_created integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
begin
  if p_actor_user_id is not null and not public.dd2026_is_admin(p_actor_user_id) then
    raise exception 'DD2026_ADMIN_REQUIRED';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 1 then
    raise exception 'DD2026_IMPORT_ROWS_INVALID';
  end if;

  select enabled into v_human_review
  from public.dd2026_feature_flags
  where flag_key = 'CONTENT_HUMAN_REVIEW_REQUIRED';

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_id := lower(btrim(v_row ->> 'id'));
    v_type := btrim(v_row ->> 'content_type');
    v_subject := btrim(v_row ->> 'subject');
    v_title := btrim(v_row ->> 'title');
    v_checksum := lower(btrim(v_row ->> 'checksum'));
    v_source_version := btrim(v_row ->> 'source_version');

    if v_id !~ '^[a-z0-9][a-z0-9-]{2,79}$'
      or v_type not in (
        'bar_easy', 'doctrine', 'chair_case', 'anchor_case', 'bar_forecast_question'
      )
      or not (
        (v_type = 'bar_forecast_question' and v_source_version = '2026.3')
        or (
          v_type in ('bar_easy', 'doctrine', 'chair_case', 'anchor_case')
          and v_source_version = '2026.1'
        )
      )
      or char_length(v_subject) not between 2 and 160
      or char_length(v_title) not between 2 and 500
      or v_checksum !~ '^[0-9a-f]{64}$'
      or v_row ->> 'source_status' <> 'AI_PREPARED_BETA'
      or jsonb_typeof(v_row -> 'payload') <> 'object'
    then
      raise exception 'DD2026_IMPORT_ROW_INVALID:%', coalesce(v_id, 'unknown');
    end if;

    select * into v_item
    from public.dd2026_content_items
    where id = v_id
    for update;
    v_item_exists := found;

    if v_item_exists and v_item.content_type <> v_type then
      raise exception 'DD2026_CONTENT_TYPE_IMMUTABLE:%', v_id;
    end if;

    if exists (
      select 1
      from public.dd2026_content_versions
      where content_id = v_id and checksum = v_checksum
    ) then
      v_unchanged := v_unchanged + 1;
      continue;
    end if;

    if not v_item_exists then
      insert into public.dd2026_content_items (id, content_type, subject, title)
      values (v_id, v_type, v_subject, v_title);
      v_created := v_created + 1;
    else
      update public.dd2026_content_items
      set subject = v_subject,
          title = v_title,
          updated_at = now()
      where id = v_id;
      v_updated := v_updated + 1;
    end if;

    select coalesce(max(revision), 0) + 1 into v_revision
    from public.dd2026_content_versions
    where content_id = v_id;

    insert into public.dd2026_content_versions (
      content_id, revision, source_version, source_status, payload, checksum,
      lifecycle_state, ai_prepared_beta, author_user_id, publisher_user_id, published_at
    ) values (
      v_id, v_revision, v_source_version, 'AI_PREPARED_BETA', v_row -> 'payload', v_checksum,
      case when v_human_review then 'draft' else 'published' end,
      true,
      p_actor_user_id,
      case when v_human_review then null else p_actor_user_id end,
      case when v_human_review then null else now() end
    ) returning * into v_version;

    if not v_human_review then
      update public.dd2026_content_items
      set current_published_version_id = v_version.id,
          updated_at = now()
      where id = v_id;
    end if;

    insert into public.dd2026_content_audit (
      content_id, content_version_id, actor_user_id, action, to_state, metadata
    ) values (
      v_id, v_version.id, p_actor_user_id,
      case when v_revision = 1 then 'import_created' else 'import_updated' end,
      v_version.lifecycle_state,
      jsonb_build_object(
        'revision', v_revision,
        'checksum', v_checksum,
        'sourceVersion', v_source_version
      )
    );
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'reviewRequired', v_human_review
  );
end;
$$;

create table if not exists public.dd2026_bar_forecast_consents (
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_version text not null check (consent_version = '2026-08-31'),
  accepted_at timestamptz not null default now(),
  primary key (user_id, consent_version)
);

alter table public.dd2026_bar_forecast_consents enable row level security;
alter table public.dd2026_bar_forecast_consents force row level security;
revoke all privileges on table public.dd2026_bar_forecast_consents
  from public, anon, authenticated;
grant select, insert, update, delete on table public.dd2026_bar_forecast_consents
  to service_role;

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
  if p_consent_version is distinct from '2026-08-31' then
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
  if p_consent_version is distinct from '2026-08-31' then
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
  if p_consent_version is distinct from '2026-08-31' then
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

revoke all on function public.dd2026_import_content_batch(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.dd2026_bar_forecast_consent_status(uuid, text)
  from public, anon, authenticated;
revoke all on function public.dd2026_bar_forecast_accept_consent(uuid, text)
  from public, anon, authenticated;
revoke all on function public.dd2026_bar_forecast_admin_list(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.dd2026_import_content_batch(uuid, jsonb)
  to service_role;
grant execute on function public.dd2026_bar_forecast_consent_status(uuid, text)
  to service_role;
grant execute on function public.dd2026_bar_forecast_accept_consent(uuid, text)
  to service_role;
grant execute on function public.dd2026_bar_forecast_admin_list(uuid, text, text)
  to service_role;

commit;

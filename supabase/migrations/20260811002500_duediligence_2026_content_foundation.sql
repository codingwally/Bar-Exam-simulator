-- DueDiligence 2026: feature flags, editorial content, non-retentive practice,
-- and server-authorized Verdict export foundation.
-- Additive only. Existing questions, grading, subscriptions, and examinations
-- are intentionally not altered.

begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.dd2026_feature_flags (
  flag_key text primary key check (flag_key ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  enabled boolean not null,
  description text not null check (char_length(btrim(description)) between 3 and 500),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.dd2026_feature_flags (flag_key, enabled, description)
values
  ('VERDICT_PDF_ENABLED', true, 'Allow authorized Verdict PDF export.'),
  ('VERDICT_PDF_PREMIUM_REQUIRED', false, 'Require an active premium entitlement for Verdict PDF export.'),
  ('BAR_EASY_ENABLED', true, 'Expose the non-retentive Bar Easy practice route.'),
  ('CHAIR_CASES_ENABLED', true, 'Expose the 2026 Chair''s Cases collection.'),
  ('DOCTRINES_ENABLED', true, 'Expose the non-retentive Doctrine practice route.'),
  ('ANCHOR_CASE_DIGESTS_ENABLED', true, 'Expose the Anchor Case Digest collection.'),
  ('EXAMINATION_ROOM_ENABLED', true, 'Expose the institutional Examination Room.'),
  ('EXAM_GOOGLE_BACKUP_ENABLED', true, 'Queue Examination Room Google backup events.'),
  ('AI_PREPARED_BETA_BADGE', true, 'Show the AI-prepared beta and verification warning.'),
  ('CONTENT_HUMAN_REVIEW_REQUIRED', false, 'Require human approval before newly imported content can publish.')
on conflict (flag_key) do nothing;

create table if not exists public.dd2026_content_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('content_editor', 'content_reviewer', 'content_publisher')),
  assigned_by uuid not null references auth.users(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoke_reason text,
  primary key (user_id, role),
  constraint dd2026_content_roles_revoke_check check (
    (revoked_at is null and revoked_by is null and revoke_reason is null)
    or (revoked_at is not null and revoked_by is not null and char_length(btrim(revoke_reason)) between 5 and 1000)
  )
);

create table if not exists public.dd2026_content_items (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  content_type text not null check (content_type in ('bar_easy', 'doctrine', 'chair_case', 'anchor_case')),
  subject text not null check (char_length(btrim(subject)) between 2 and 160),
  title text not null check (char_length(btrim(title)) between 2 and 500),
  current_published_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dd2026_content_versions (
  id uuid primary key default gen_random_uuid(),
  content_id text not null references public.dd2026_content_items(id) on delete cascade,
  revision integer not null check (revision > 0),
  source_version text not null check (source_version = '2026.1'),
  source_status text not null check (source_status = 'AI_PREPARED_BETA'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  lifecycle_state text not null check (
    lifecycle_state in ('draft', 'in_review', 'approved', 'published', 'archived')
  ),
  ai_prepared_beta boolean not null default true,
  author_user_id uuid references auth.users(id) on delete set null,
  editor_user_id uuid references auth.users(id) on delete set null,
  reviewer_user_id uuid references auth.users(id) on delete set null,
  publisher_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  submitted_for_review_at timestamptz,
  reviewed_at timestamptz,
  published_at timestamptz,
  archived_at timestamptz,
  unique (content_id, revision),
  unique (content_id, checksum),
  constraint dd2026_content_versions_state_timestamps check (
    (lifecycle_state <> 'published' or published_at is not null)
    and (lifecycle_state <> 'archived' or archived_at is not null)
  )
);

alter table public.dd2026_content_items
  drop constraint if exists dd2026_content_items_current_published_version_fkey;
alter table public.dd2026_content_items
  add constraint dd2026_content_items_current_published_version_fkey
  foreign key (current_published_version_id)
  references public.dd2026_content_versions(id)
  on delete set null
  deferrable initially deferred;

create index if not exists dd2026_content_items_catalog_idx
  on public.dd2026_content_items (content_type, subject, id);
create index if not exists dd2026_content_versions_state_idx
  on public.dd2026_content_versions (lifecycle_state, content_id, revision desc);

create table if not exists public.dd2026_content_audit (
  id bigint generated always as identity primary key,
  content_id text references public.dd2026_content_items(id) on delete set null,
  content_version_id uuid references public.dd2026_content_versions(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action ~ '^[a-z][a-z0-9_]{2,79}$'),
  from_state text,
  to_state text,
  note text check (note is null or char_length(note) <= 2000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists dd2026_content_audit_item_idx
  on public.dd2026_content_audit (content_id, created_at desc);

create table if not exists public.dd2026_bar_easy_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_id text not null references public.dd2026_content_items(id) on delete restrict,
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  grader_model text not null check (char_length(btrim(grader_model)) between 2 and 120),
  completed_at timestamptz not null default now(),
  unique (user_id, request_key)
);

create index if not exists dd2026_bar_easy_usage_user_idx
  on public.dd2026_bar_easy_usage (user_id, completed_at desc);

create table if not exists public.dd2026_doctrine_mastery (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  doctrine_id text not null references public.dd2026_content_items(id) on delete restrict,
  mastery_result text not null check (mastery_result in ('thumbs_up', 'thumbs_down')),
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  grader_model text not null check (char_length(btrim(grader_model)) between 2 and 120),
  completed_at timestamptz not null default now(),
  unique (user_id, request_key)
);

create index if not exists dd2026_doctrine_mastery_user_idx
  on public.dd2026_doctrine_mastery (user_id, completed_at desc);
create index if not exists dd2026_doctrine_mastery_content_idx
  on public.dd2026_doctrine_mastery (user_id, doctrine_id, completed_at desc);

create table if not exists public.dd2026_verdict_pdf_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  grading_result_id uuid not null references public.grading_results(id) on delete restrict,
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  selection_kind text not null check (selection_kind in ('entire_result', 'sections', 'questions')),
  selected_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(selected_ids) = 'array'),
  output_bytes integer not null check (output_bytes between 1 and 26214400),
  created_at timestamptz not null default now(),
  unique (user_id, request_key)
);

create index if not exists dd2026_verdict_pdf_exports_user_idx
  on public.dd2026_verdict_pdf_exports (user_id, created_at desc);

create or replace function public.dd2026_is_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_roles r
    where r.user_id = p_user_id
      and r.role in ('admin', 'founder_admin', 'super_admin')
  );
$$;

create or replace function public.dd2026_has_editorial_role(p_user_id uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.dd2026_is_admin(p_user_id)
    or exists (
      select 1
      from public.dd2026_content_roles r
      where r.user_id = p_user_id
        and r.role = p_role
        and r.revoked_at is null
    );
$$;

create or replace function public.dd2026_is_premium(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.dd2026_is_admin(p_user_id)
    or exists (
      select 1
      from public.user_entitlements e
      where e.user_id = p_user_id
        and e.status = 'active'
        and e.plan_code not in ('free', 'free_beta')
        and e.effective_from <= now()
        and (e.effective_until is null or e.effective_until > now())
    );
$$;

create or replace function public.dd2026_require_user(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null or not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'DD2026_AUTH_REQUIRED';
  end if;
end;
$$;

create or replace function public.dd2026_feature_snapshot(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_flags jsonb;
begin
  perform public.dd2026_require_user(p_user_id);
  select coalesce(jsonb_object_agg(flag_key, enabled), '{}'::jsonb)
  into v_flags
  from public.dd2026_feature_flags;

  return jsonb_build_object(
    'flags', v_flags,
    'premium', public.dd2026_is_premium(p_user_id),
    'admin', public.dd2026_is_admin(p_user_id),
    'betaWarning', 'AI-prepared beta. Verify independently against current law and primary authority.'
  );
end;
$$;

create or replace function public.dd2026_import_content_batch(
  p_actor_user_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_id text;
  v_type text;
  v_subject text;
  v_title text;
  v_checksum text;
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

    if v_id !~ '^[a-z0-9][a-z0-9-]{2,79}$'
      or v_type not in ('bar_easy', 'doctrine', 'chair_case', 'anchor_case')
      or char_length(v_subject) not between 2 and 160
      or char_length(v_title) not between 2 and 500
      or v_checksum !~ '^[0-9a-f]{64}$'
      or v_row ->> 'source_version' <> '2026.1'
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
      select 1 from public.dd2026_content_versions
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
      v_id, v_revision, '2026.1', 'AI_PREPARED_BETA', v_row -> 'payload', v_checksum,
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
      jsonb_build_object('revision', v_revision, 'checksum', v_checksum)
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

create or replace function public.dd2026_editorial_transition(
  p_actor_user_id uuid,
  p_content_id text,
  p_version_id uuid,
  p_action text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version public.dd2026_content_versions%rowtype;
  v_next text;
begin
  if p_note is not null and char_length(p_note) > 2000 then
    raise exception 'DD2026_EDITORIAL_NOTE_TOO_LONG';
  end if;

  select * into v_version
  from public.dd2026_content_versions
  where id = p_version_id and content_id = p_content_id
  for update;
  if not found then raise exception 'DD2026_CONTENT_VERSION_NOT_FOUND'; end if;

  if p_action = 'submit_review' and v_version.lifecycle_state = 'draft' then
    if not public.dd2026_has_editorial_role(p_actor_user_id, 'content_editor') then
      raise exception 'DD2026_EDITOR_REQUIRED';
    end if;
    v_next := 'in_review';
    update public.dd2026_content_versions
    set lifecycle_state = v_next, editor_user_id = p_actor_user_id,
        edited_at = coalesce(edited_at, now()), submitted_for_review_at = now()
    where id = p_version_id;
  elsif p_action = 'approve' and v_version.lifecycle_state = 'in_review' then
    if not public.dd2026_has_editorial_role(p_actor_user_id, 'content_reviewer') then
      raise exception 'DD2026_REVIEWER_REQUIRED';
    end if;
    v_next := 'approved';
    update public.dd2026_content_versions
    set lifecycle_state = v_next, reviewer_user_id = p_actor_user_id, reviewed_at = now()
    where id = p_version_id;
  elsif p_action = 'publish' and v_version.lifecycle_state = 'approved' then
    if not public.dd2026_has_editorial_role(p_actor_user_id, 'content_publisher') then
      raise exception 'DD2026_PUBLISHER_REQUIRED';
    end if;
    v_next := 'published';
    update public.dd2026_content_versions
    set lifecycle_state = v_next, publisher_user_id = p_actor_user_id, published_at = now()
    where id = p_version_id;
    update public.dd2026_content_items
    set current_published_version_id = p_version_id, updated_at = now()
    where id = p_content_id;
  elsif p_action = 'archive' and v_version.lifecycle_state = 'published' then
    if not public.dd2026_has_editorial_role(p_actor_user_id, 'content_publisher') then
      raise exception 'DD2026_PUBLISHER_REQUIRED';
    end if;
    v_next := 'archived';
    update public.dd2026_content_versions
    set lifecycle_state = v_next, archived_at = now()
    where id = p_version_id;
    update public.dd2026_content_items
    set current_published_version_id = null, updated_at = now()
    where id = p_content_id and current_published_version_id = p_version_id;
  else
    raise exception 'DD2026_EDITORIAL_TRANSITION_INVALID';
  end if;

  insert into public.dd2026_content_audit (
    content_id, content_version_id, actor_user_id, action, from_state, to_state, note
  ) values (
    p_content_id, p_version_id, p_actor_user_id, p_action,
    v_version.lifecycle_state, v_next, nullif(btrim(p_note), '')
  );

  return jsonb_build_object('contentId', p_content_id, 'versionId', p_version_id, 'state', v_next);
end;
$$;

create or replace function public.dd2026_content_list(
  p_user_id uuid,
  p_content_type text,
  p_subject text default null,
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_enabled boolean;
  v_flag text;
  v_rows jsonb;
  v_total integer;
begin
  perform public.dd2026_require_user(p_user_id);
  if p_content_type not in ('bar_easy', 'doctrine', 'chair_case', 'anchor_case')
    or p_limit not between 1 and 200 or p_offset < 0
    or (p_search is not null and char_length(p_search) > 200)
  then raise exception 'DD2026_CONTENT_QUERY_INVALID'; end if;

  v_flag := case p_content_type
    when 'bar_easy' then 'BAR_EASY_ENABLED'
    when 'doctrine' then 'DOCTRINES_ENABLED'
    when 'chair_case' then 'CHAIR_CASES_ENABLED'
    else 'ANCHOR_CASE_DIGESTS_ENABLED'
  end;
  select enabled into v_enabled from public.dd2026_feature_flags where flag_key = v_flag;
  if not coalesce(v_enabled, false) then raise exception 'DD2026_FEATURE_DISABLED'; end if;

  select count(*) into v_total
  from public.dd2026_content_items i
  join public.dd2026_content_versions v on v.id = i.current_published_version_id
  where i.content_type = p_content_type
    and v.lifecycle_state = 'published'
    and (p_subject is null or i.subject = p_subject)
    and (
      p_search is null or btrim(p_search) = ''
      or i.title ilike '%' || p_search || '%'
      or i.subject ilike '%' || p_search || '%'
      or v.payload::text ilike '%' || p_search || '%'
    );

  select coalesce(jsonb_agg(row_data order by ordinal), '[]'::jsonb) into v_rows
  from (
    select row_number() over (order by i.subject, i.id) as ordinal,
      jsonb_build_object(
        'id', i.id,
        'contentType', i.content_type,
        'subject', i.subject,
        'title', i.title,
        'version', v.source_version,
        'aiPreparedBeta', v.ai_prepared_beta,
        'payload', v.payload
      ) as row_data
    from public.dd2026_content_items i
    join public.dd2026_content_versions v on v.id = i.current_published_version_id
    where i.content_type = p_content_type
      and v.lifecycle_state = 'published'
      and (p_subject is null or i.subject = p_subject)
      and (
        p_search is null or btrim(p_search) = ''
        or i.title ilike '%' || p_search || '%'
        or i.subject ilike '%' || p_search || '%'
        or v.payload::text ilike '%' || p_search || '%'
      )
    order by i.subject, i.id
    limit p_limit offset p_offset
  ) q;

  return jsonb_build_object('items', v_rows, 'total', v_total, 'limit', p_limit, 'offset', p_offset);
end;
$$;

create or replace function public.dd2026_content_get(
  p_user_id uuid,
  p_content_type text,
  p_content_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform public.dd2026_require_user(p_user_id);
  select jsonb_build_object(
    'id', i.id,
    'contentType', i.content_type,
    'subject', i.subject,
    'title', i.title,
    'version', v.source_version,
    'aiPreparedBeta', v.ai_prepared_beta,
    'payload', v.payload
  ) into v_result
  from public.dd2026_content_items i
  join public.dd2026_content_versions v on v.id = i.current_published_version_id
  where i.id = p_content_id
    and i.content_type = p_content_type
    and v.lifecycle_state = 'published';
  if v_result is null then raise exception 'DD2026_CONTENT_NOT_FOUND'; end if;
  return v_result;
end;
$$;

create or replace function public.dd2026_record_bar_easy_completion(
  p_user_id uuid,
  p_content_id text,
  p_request_key text,
  p_grader_model text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.dd2026_bar_easy_usage%rowtype;
begin
  perform public.dd2026_require_user(p_user_id);
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
    or char_length(btrim(p_grader_model)) not between 2 and 120
    or not exists (
      select 1 from public.dd2026_content_items i
      where i.id = p_content_id and i.content_type = 'bar_easy'
    )
  then raise exception 'DD2026_BAR_EASY_COMPLETION_INVALID'; end if;

  insert into public.dd2026_bar_easy_usage (user_id, content_id, request_key, grader_model)
  values (p_user_id, p_content_id, p_request_key, p_grader_model)
  on conflict (user_id, request_key) do update set request_key = excluded.request_key
  returning * into v_row;

  return jsonb_build_object('completionId', v_row.id, 'completedAt', v_row.completed_at);
end;
$$;

create or replace function public.dd2026_record_doctrine_mastery(
  p_user_id uuid,
  p_doctrine_id text,
  p_mastery_result text,
  p_request_key text,
  p_grader_model text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.dd2026_doctrine_mastery%rowtype;
begin
  perform public.dd2026_require_user(p_user_id);
  if p_mastery_result not in ('thumbs_up', 'thumbs_down')
    or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
    or char_length(btrim(p_grader_model)) not between 2 and 120
    or not exists (
      select 1 from public.dd2026_content_items i
      where i.id = p_doctrine_id and i.content_type = 'doctrine'
    )
  then raise exception 'DD2026_DOCTRINE_MASTERY_INVALID'; end if;

  insert into public.dd2026_doctrine_mastery (
    user_id, doctrine_id, mastery_result, request_key, grader_model
  ) values (
    p_user_id, p_doctrine_id, p_mastery_result, p_request_key, p_grader_model
  )
  on conflict (user_id, request_key) do update set request_key = excluded.request_key
  returning * into v_row;

  return jsonb_build_object(
    'masteryId', v_row.id,
    'result', v_row.mastery_result,
    'completedAt', v_row.completed_at
  );
end;
$$;

create or replace function public.dd2026_verdict_result(
  p_user_id uuid,
  p_grading_result_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_enabled boolean;
  v_premium_required boolean;
  v_result jsonb;
begin
  perform public.dd2026_require_user(p_user_id);
  select enabled into v_enabled from public.dd2026_feature_flags where flag_key = 'VERDICT_PDF_ENABLED';
  select enabled into v_premium_required from public.dd2026_feature_flags where flag_key = 'VERDICT_PDF_PREMIUM_REQUIRED';
  if not coalesce(v_enabled, false) then raise exception 'DD2026_VERDICT_PDF_DISABLED'; end if;
  if coalesce(v_premium_required, false) and not public.dd2026_is_premium(p_user_id) then
    raise exception 'DD2026_PREMIUM_REQUIRED';
  end if;

  select jsonb_build_object(
    'resultId', g.id,
    'submissionId', s.id,
    'subject', subj.name,
    'barYear', q.bar_year,
    'questionNumber', q.question_no,
    'question', q.prompt_text,
    'suggestedAnswer', q.model_answer,
    'userAnswer', s.answer_text,
    'feedback', coalesce(g.feedback_json, '{}'::jsonb),
    'score', g.overall_score,
    'passed', g.passed,
    'gradedAt', g.graded_at,
    'rubricVersion', g.rubric_version
  ) into v_result
  from public.grading_results g
  join public.submissions s on s.id = g.submission_id
  join public.questions q on q.id = s.question_id
  join public.subjects subj on subj.id = q.subject_id
  where g.id = p_grading_result_id and s.user_id = p_user_id;

  if v_result is null then raise exception 'DD2026_VERDICT_RESULT_NOT_FOUND'; end if;
  return v_result;
end;
$$;

create or replace function public.dd2026_record_verdict_export(
  p_user_id uuid,
  p_grading_result_id uuid,
  p_request_key text,
  p_selection_kind text,
  p_selected_ids jsonb,
  p_output_bytes integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.dd2026_verdict_pdf_exports%rowtype;
begin
  perform public.dd2026_verdict_result(p_user_id, p_grading_result_id);
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
    or p_selection_kind not in ('entire_result', 'sections', 'questions')
    or jsonb_typeof(p_selected_ids) <> 'array'
    or p_output_bytes not between 1 and 26214400
  then raise exception 'DD2026_VERDICT_EXPORT_INVALID'; end if;

  insert into public.dd2026_verdict_pdf_exports (
    user_id, grading_result_id, request_key, selection_kind, selected_ids, output_bytes
  ) values (
    p_user_id, p_grading_result_id, p_request_key, p_selection_kind, p_selected_ids, p_output_bytes
  )
  on conflict (user_id, request_key) do update set request_key = excluded.request_key
  returning * into v_row;

  return jsonb_build_object('exportId', v_row.id, 'createdAt', v_row.created_at);
end;
$$;

-- Every new table is Worker-only. RLS remains forced as defense in depth.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'dd2026_feature_flags',
    'dd2026_content_roles',
    'dd2026_content_items',
    'dd2026_content_versions',
    'dd2026_content_audit',
    'dd2026_bar_easy_usage',
    'dd2026_doctrine_mastery',
    'dd2026_verdict_pdf_exports'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', v_table);
    execute format('grant select, insert, update, delete on table public.%I to service_role', v_table);
  end loop;
end;
$$;

revoke all privileges on sequence public.dd2026_content_audit_id_seq
  from public, anon, authenticated;
grant usage, select on sequence public.dd2026_content_audit_id_seq to service_role;

revoke all on function public.dd2026_is_admin(uuid) from public, anon, authenticated;
revoke all on function public.dd2026_has_editorial_role(uuid, text) from public, anon, authenticated;
revoke all on function public.dd2026_is_premium(uuid) from public, anon, authenticated;
revoke all on function public.dd2026_require_user(uuid) from public, anon, authenticated;
revoke all on function public.dd2026_feature_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.dd2026_import_content_batch(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.dd2026_editorial_transition(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.dd2026_content_list(uuid, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.dd2026_content_get(uuid, text, text) from public, anon, authenticated;
revoke all on function public.dd2026_record_bar_easy_completion(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.dd2026_record_doctrine_mastery(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.dd2026_verdict_result(uuid, uuid) from public, anon, authenticated;
revoke all on function public.dd2026_record_verdict_export(uuid, uuid, text, text, jsonb, integer) from public, anon, authenticated;

grant execute on function public.dd2026_is_admin(uuid) to service_role;
grant execute on function public.dd2026_has_editorial_role(uuid, text) to service_role;
grant execute on function public.dd2026_is_premium(uuid) to service_role;
grant execute on function public.dd2026_require_user(uuid) to service_role;
grant execute on function public.dd2026_feature_snapshot(uuid) to service_role;
grant execute on function public.dd2026_import_content_batch(uuid, jsonb) to service_role;
grant execute on function public.dd2026_editorial_transition(uuid, text, uuid, text, text) to service_role;
grant execute on function public.dd2026_content_list(uuid, text, text, text, integer, integer) to service_role;
grant execute on function public.dd2026_content_get(uuid, text, text) to service_role;
grant execute on function public.dd2026_record_bar_easy_completion(uuid, text, text, text) to service_role;
grant execute on function public.dd2026_record_doctrine_mastery(uuid, text, text, text, text) to service_role;
grant execute on function public.dd2026_verdict_result(uuid, uuid) to service_role;
grant execute on function public.dd2026_record_verdict_export(uuid, uuid, text, text, jsonb, integer) to service_role;

commit;

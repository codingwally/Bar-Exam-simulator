-- Bar Exam Simulation: private source pool and per-user randomized allocations.
--
-- This release is deliberately additive and dormant:
--   * the existing six catalog definitions and their active versions are not changed;
--   * loading the complete source pool does not publish or activate a version;
--   * allocation remains disabled until an administrator passes the pool gate and
--     explicitly enables the database-side switch; and
--   * the Worker must also opt into bar_simulation_start_attempt_v1.

begin;

set local lock_timeout = '250ms';
set local statement_timeout = '5s';

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Private pool, rollout switch, immutable allocation records, and receipts
-- ---------------------------------------------------------------------------

create table if not exists public.bar_simulation_runtime_config (
  config_key text primary key
    check (config_key = 'randomized_allocation_v1'),
  allocation_enabled boolean not null default false,
  minimum_pool_total integer not null default 800
    check (minimum_pool_total >= 800),
  minimum_per_subject integer not null default 100
    check (minimum_per_subject >= 100),
  current_source_digest text
    check (current_source_digest is null or current_source_digest ~ '^[0-9a-f]{64}$'),
  updated_by uuid references auth.users(id) on delete set null,
  update_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.bar_simulation_runtime_config (
  config_key,
  allocation_enabled,
  minimum_pool_total,
  minimum_per_subject,
  update_reason
)
values (
  'randomized_allocation_v1',
  false,
  800,
  100,
  'Additive installation. Runtime allocation remains disabled by default.'
)
on conflict (config_key) do nothing;

commit;

begin;

set local lock_timeout = '250ms';
set local statement_timeout = '5s';

create table if not exists public.bar_simulation_question_pool (
  question_id uuid primary key
    references public.examination_questions(id) on delete restrict,
  source_question_id text not null unique
    check (char_length(btrim(source_question_id)) between 1 and 200),
  subject text not null check (
    subject in (
      'Political and Public International Law',
      'Labor Law',
      'Civil Law',
      'Taxation Law',
      'Commercial Law',
      'Criminal Law',
      'Remedial Law',
      'Legal and Judicial Ethics'
    )
  ),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  source_digest text not null check (source_digest ~ '^[0-9a-f]{64}$'),
  eligible boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists bar_simulation_pool_subject_eligible_idx
  on public.bar_simulation_question_pool (subject, question_id)
  where eligible;

commit;

begin;

set local lock_timeout = '250ms';
set local statement_timeout = '5s';

create table if not exists public.bar_simulation_pool_syncs (
  id uuid primary key default extensions.gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  source_digest text not null unique check (source_digest ~ '^[0-9a-f]{64}$'),
  source_endpoint text not null check (
    source_endpoint like 'https://docs.google.com/spreadsheets/%'
  ),
  imported_count integer not null check (imported_count >= 800),
  subject_counts jsonb not null check (jsonb_typeof(subject_counts) = 'object'),
  response_json jsonb not null check (jsonb_typeof(response_json) = 'object'),
  completed_at timestamptz not null default now()
);

commit;

begin;

set local lock_timeout = '250ms';
set local statement_timeout = '5s';

-- A private snapshot version may be used by exactly the pre-registered owner
-- and attempt. This also prevents the legacy generic start RPC from replaying
-- a private randomized version after its original attempt closes.
create table if not exists public.bar_simulation_private_versions (
  version_id uuid primary key
    references public.examination_versions(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  expected_attempt_id uuid not null unique,
  destination text not null check (
    destination in (
      'Political and Public International Law',
      'Commercial and Taxation Laws',
      'Civil Law',
      'Labor Law and Social Legislations',
      'Criminal Law',
      'Remedial Law, Legal and Judicial Ethics'
    )
  ),
  created_at timestamptz not null default now()
);

commit;

begin;

set local lock_timeout = '250ms';
set local statement_timeout = '5s';

create table if not exists public.bar_simulation_allocations (
  id uuid primary key default extensions.gen_random_uuid(),
  public_id uuid not null default extensions.gen_random_uuid() unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  destination text not null check (
    destination in (
      'Political and Public International Law',
      'Commercial and Taxation Laws',
      'Civil Law',
      'Labor Law and Social Legislations',
      'Criminal Law',
      'Remedial Law, Legal and Judicial Ethics'
    )
  ),
  catalog_exam_id uuid not null
    references public.examination_definitions(id) on delete restrict,
  catalog_version_id uuid not null
    references public.examination_versions(id) on delete restrict,
  allocated_version_id uuid not null unique
    references public.examination_versions(id) on delete restrict,
  attempt_id uuid not null unique
    references public.examination_attempts_multi(id) on delete restrict,
  start_request_key text not null
    check (start_request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  source_digest text not null check (source_digest ~ '^[0-9a-f]{64}$'),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, start_request_key),
  constraint bar_simulation_allocation_close_truth check (
    (status = 'open' and closed_at is null)
    or (status = 'closed' and closed_at is not null)
  )
);

create unique index if not exists bar_simulation_one_open_destination_idx
  on public.bar_simulation_allocations (user_id, destination)
  where status = 'open';
create index if not exists bar_simulation_allocations_user_history_idx
  on public.bar_simulation_allocations (user_id, created_at desc);

commit;

begin;

set local lock_timeout = '250ms';
set local statement_timeout = '5s';

create table if not exists public.bar_simulation_allocation_questions (
  allocation_id uuid not null
    references public.bar_simulation_allocations(id) on delete restrict,
  ordinal smallint not null check (ordinal between 1 and 20),
  question_id uuid not null
    references public.examination_questions(id) on delete restrict,
  original_subject text not null check (
    original_subject in (
      'Political and Public International Law',
      'Labor Law',
      'Civil Law',
      'Taxation Law',
      'Commercial Law',
      'Criminal Law',
      'Remedial Law',
      'Legal and Judicial Ethics'
    )
  ),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (allocation_id, ordinal),
  unique (allocation_id, question_id)
);

create index if not exists bar_simulation_allocation_question_lookup_idx
  on public.bar_simulation_allocation_questions (question_id, allocation_id);

commit;

begin;

set local lock_timeout = '250ms';
set local statement_timeout = '5s';

create table if not exists public.bar_simulation_start_receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  destination text not null check (
    destination in (
      'Political and Public International Law',
      'Commercial and Taxation Laws',
      'Civil Law',
      'Labor Law and Social Legislations',
      'Criminal Law',
      'Remedial Law, Legal and Judicial Ethics'
    )
  ),
  catalog_version_id uuid not null
    references public.examination_versions(id) on delete restrict,
  attempt_id uuid not null
    references public.examination_attempts_multi(id) on delete restrict,
  allocation_id uuid
    references public.bar_simulation_allocations(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (user_id, request_key)
);

create index if not exists bar_simulation_receipts_attempt_idx
  on public.bar_simulation_start_receipts (attempt_id);

commit;

begin;

set local lock_timeout = '250ms';
set local statement_timeout = '5s';

-- This ledger records the first time an answer becomes nonblank. Clearing or
-- later editing the response cannot make that question eligible again.
create table if not exists public.bar_simulation_answered_questions (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null
    references public.examination_questions(id) on delete restrict,
  first_attempt_id uuid
    references public.examination_attempts_multi(id) on delete set null,
  first_answered_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

commit;

begin;

set local statement_timeout = '5min';

-- Every new table is Worker-only. FORCE RLS is defense in depth if the public
-- schema is exposed through the Data API.
do $bar_simulation_private_tables$
declare
  v_table text;
begin
  foreach v_table in array array[
    'bar_simulation_runtime_config',
    'bar_simulation_question_pool',
    'bar_simulation_pool_syncs',
    'bar_simulation_private_versions',
    'bar_simulation_allocations',
    'bar_simulation_allocation_questions',
    'bar_simulation_start_receipts',
    'bar_simulation_answered_questions'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format(
      'revoke all privileges on table public.%I from public, anon, authenticated',
      v_table
    );
    execute format(
      'grant select on table public.%I to service_role',
      v_table
    );
  end loop;
end;
$bar_simulation_private_tables$;

commit;

begin;

set local statement_timeout = '5min';

-- ---------------------------------------------------------------------------
-- Safe full-snapshot population. This changes only the private pool/base rows;
-- it never creates a version or changes examination_definitions.active_version_id.
-- ---------------------------------------------------------------------------

create or replace function public.bar_simulation_sync_pool_v1(
  p_actor_user_id uuid,
  p_rows jsonb,
  p_source_digest text,
  p_source_endpoint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $bar_simulation_sync_pool_v1$
declare
  v_row jsonb;
  v_source_question_id text;
  v_subject text;
  v_prompt text;
  v_answer text;
  v_legal_basis text;
  v_content_hash text;
  v_publication_ready text;
  v_question_id uuid;
  v_seen_source_ids text[] := '{}'::text[];
  v_subjects constant text[] := array[
    'Political and Public International Law',
    'Labor Law',
    'Civil Law',
    'Taxation Law',
    'Commercial Law',
    'Criminal Law',
    'Remedial Law',
    'Legal and Judicial Ethics'
  ];
  v_subject_count integer;
  v_total integer;
  v_counts jsonb := '{}'::jsonb;
  v_response jsonb;
  v_existing public.bar_simulation_pool_syncs%rowtype;
  v_bar_year integer;
  v_sheet_row integer;
begin
  perform public.examination_require_admin(p_actor_user_id);

  if jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) < 800
     or jsonb_array_length(p_rows) > 10000
     or coalesce(p_source_digest, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_source_endpoint, '') not like 'https://docs.google.com/spreadsheets/%'
  then
    raise exception 'BAR_SIMULATION_POOL_SOURCE_INVALID';
  end if;

  -- Validate the complete snapshot before acquiring the short write lock or
  -- mutating any row. The transaction rolls back on every later failure too.
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'BAR_SIMULATION_POOL_ROW_INVALID';
    end if;
    v_source_question_id := btrim(coalesce(v_row->>'questionId', ''));
    v_subject := btrim(coalesce(v_row->>'subject', ''));
    v_prompt := btrim(coalesce(v_row->>'prompt', ''));
    v_answer := btrim(coalesce(v_row->>'suggestedAnswer', ''));
    v_legal_basis := btrim(coalesce(v_row->>'legalBasis', ''));
    v_content_hash := lower(btrim(coalesce(v_row->>'contentHash', '')));
    v_publication_ready := lower(btrim(coalesce(v_row->>'publicationReady', '')));

    if v_source_question_id = ''
       or char_length(v_source_question_id) > 200
       or v_source_question_id = any(v_seen_source_ids)
       or not (v_subject = any(v_subjects))
       or char_length(v_prompt) < 20
       or char_length(v_answer) < 20
       or char_length(v_legal_basis) < 10
       or v_content_hash !~ '^[0-9a-f]{64}$'
       or v_publication_ready not in ('yes', 'true')
       or jsonb_typeof(coalesce(v_row->'jurisprudence', '[]'::jsonb)) <> 'array'
       or jsonb_typeof(coalesce(v_row->'sourceUrls', '[]'::jsonb)) <> 'array'
    then
      raise exception 'BAR_SIMULATION_POOL_ROW_INVALID:%', v_source_question_id;
    end if;
    if nullif(v_row->>'barYear', '') is not null
       and (v_row->>'barYear') !~ '^[0-9]{4}$'
    then
      raise exception 'BAR_SIMULATION_POOL_ROW_INVALID:%', v_source_question_id;
    end if;
    if nullif(v_row->>'sheetRow', '') is not null
       and (v_row->>'sheetRow') !~ '^[1-9][0-9]*$'
    then
      raise exception 'BAR_SIMULATION_POOL_ROW_INVALID:%', v_source_question_id;
    end if;
    v_seen_source_ids := array_append(v_seen_source_ids, v_source_question_id);
  end loop;

  foreach v_subject in array v_subjects
  loop
    select count(*)
    into v_subject_count
    from jsonb_array_elements(p_rows) item
    where item->>'subject' = v_subject;
    if v_subject_count < 100 then
      raise exception 'BAR_SIMULATION_POOL_SUBJECT_INCOMPLETE:%', v_subject;
    end if;
    v_counts := jsonb_set(v_counts, array[v_subject], to_jsonb(v_subject_count), true);
  end loop;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bar-simulation-pool-sync-v1', 0)
  );

  select *
  into v_existing
  from public.bar_simulation_pool_syncs
  where source_digest = lower(p_source_digest)
  for update;
  if v_existing.id is not null then
    if v_existing.source_endpoint <> p_source_endpoint
       or v_existing.imported_count <> jsonb_array_length(p_rows)
       or v_existing.subject_counts <> v_counts
    then
      raise exception 'BAR_SIMULATION_POOL_SYNC_CONFLICT';
    end if;
    return v_existing.response_json || jsonb_build_object('replayed', true);
  end if;

  -- Configuration is locked before pool rows so enable/disable and pool sync
  -- always use one lock order and cannot deadlock each other.
  perform 1
  from public.bar_simulation_runtime_config
  where config_key = 'randomized_allocation_v1'
  for update;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_source_question_id := btrim(v_row->>'questionId');
    v_subject := btrim(v_row->>'subject');
    v_prompt := btrim(v_row->>'prompt');
    v_answer := btrim(v_row->>'suggestedAnswer');
    v_legal_basis := btrim(v_row->>'legalBasis');
    v_content_hash := lower(btrim(v_row->>'contentHash'));
    v_question_id := public.release_deterministic_uuid(
      'bar-feels-question:' || v_source_question_id
    );
    v_bar_year := nullif(v_row->>'barYear', '')::integer;
    v_sheet_row := nullif(v_row->>'sheetRow', '')::integer;

    insert into public.examination_questions (
      id, source_key, source_type, owner_user_id, subject, topic, bar_year,
      question_number, difficulty, prompt_text, model_answer, legal_basis,
      doctrine, application_text, conclusion_text, jurisprudence, citation,
      governing_provision, source_urls, source_metadata, review_status,
      publication_ready, content_hash, source_updated_at, approved_at,
      approved_by
    )
    values (
      v_question_id,
      'bar-feels:' || v_source_question_id,
      'google_sheet',
      null,
      v_subject,
      nullif(v_row->>'topic', ''),
      v_bar_year,
      nullif(v_row->>'questionNumber', ''),
      nullif(v_row->>'difficulty', ''),
      v_prompt,
      v_answer,
      v_legal_basis,
      nullif(v_row->>'doctrine', ''),
      nullif(v_row#>>'{alac,application}', ''),
      nullif(v_row#>>'{alac,conclusion}', ''),
      coalesce(v_row->'jurisprudence', '[]'::jsonb),
      nullif(v_row->>'citation', ''),
      v_legal_basis,
      coalesce(v_row->'sourceUrls', '[]'::jsonb),
      jsonb_build_object(
        'spreadsheetId', '1DgDe_ObIoiTy9NJ3DmdM1ec7h7t0FS7RvFhBTjubZ8A',
        'sheetName', coalesce(nullif(btrim(v_row->>'sourceSheetName'), ''), 'Website Upload'),
        'sheetRow', v_sheet_row,
        'originalQuestionId', v_source_question_id,
        'feature', 'bar_exam_simulation',
        'sourceUrlText', nullif(v_row->>'sourceUrlText', ''),
        'editorialStatus', nullif(v_row->>'editorialStatus', ''),
        'publicationReady', 'Yes'
      ),
      'owner_override',
      true,
      v_content_hash,
      now(),
      now(),
      p_actor_user_id
    )
    on conflict (id) do update
    set subject = excluded.subject,
        topic = excluded.topic,
        bar_year = excluded.bar_year,
        question_number = excluded.question_number,
        difficulty = excluded.difficulty,
        prompt_text = excluded.prompt_text,
        model_answer = excluded.model_answer,
        legal_basis = excluded.legal_basis,
        doctrine = excluded.doctrine,
        application_text = excluded.application_text,
        conclusion_text = excluded.conclusion_text,
        jurisprudence = excluded.jurisprudence,
        citation = excluded.citation,
        governing_provision = excluded.governing_provision,
        source_urls = excluded.source_urls,
        source_metadata = excluded.source_metadata,
        review_status = 'owner_override',
        publication_ready = true,
        content_hash = excluded.content_hash,
        source_updated_at = excluded.source_updated_at,
        approved_at = excluded.approved_at,
        approved_by = excluded.approved_by,
        updated_at = now()
    where examination_questions.source_type = 'google_sheet'
      and examination_questions.source_key = excluded.source_key
      and examination_questions.owner_user_id is null;

    if not exists (
      select 1
      from public.examination_questions question
      where question.id = v_question_id
        and question.source_type = 'google_sheet'
        and question.source_key = 'bar-feels:' || v_source_question_id
        and question.owner_user_id is null
        and question.content_hash = v_content_hash
    ) then
      raise exception 'BAR_SIMULATION_POOL_IDENTITY_CONFLICT:%', v_source_question_id;
    end if;

    insert into public.bar_simulation_question_pool (
      question_id, source_question_id, subject, content_hash,
      source_digest, eligible, first_seen_at, last_seen_at
    )
    values (
      v_question_id, v_source_question_id, v_subject, v_content_hash,
      lower(p_source_digest), true, now(), now()
    )
    on conflict (question_id) do update
    set source_question_id = excluded.source_question_id,
        subject = excluded.subject,
        content_hash = excluded.content_hash,
        source_digest = excluded.source_digest,
        eligible = true,
        last_seen_at = now()
    where bar_simulation_question_pool.source_question_id = excluded.source_question_id;
  end loop;

  -- Full-snapshot semantics remove absent rows from future selection without
  -- deleting any immutable historical version or attempt.
  update public.bar_simulation_question_pool pool
  set eligible = false,
      last_seen_at = now()
  where pool.eligible
    and not (pool.source_question_id = any(v_seen_source_ids));

  select count(*) into v_total
  from public.bar_simulation_question_pool
  where eligible;
  if v_total <> jsonb_array_length(p_rows) then
    raise exception 'BAR_SIMULATION_POOL_FINAL_COUNT_MISMATCH';
  end if;

  update public.bar_simulation_runtime_config
  set current_source_digest = lower(p_source_digest),
      updated_by = p_actor_user_id,
      update_reason = 'Validated Simulation source-pool snapshot synchronized; enablement unchanged.',
      updated_at = now()
  where config_key = 'randomized_allocation_v1';

  v_response := jsonb_build_object(
    'sourceDigest', lower(p_source_digest),
    'eligibleQuestions', v_total,
    'subjectCounts', v_counts,
    'versionsCreated', 0,
    'catalogActivated', false,
    'replayed', false
  );
  insert into public.bar_simulation_pool_syncs (
    actor_user_id, source_digest, source_endpoint, imported_count,
    subject_counts, response_json
  )
  values (
    p_actor_user_id, lower(p_source_digest), p_source_endpoint, v_total,
    v_counts, v_response
  );
  return v_response;
end;
$bar_simulation_sync_pool_v1$;

-- ---------------------------------------------------------------------------
-- Runtime gate. Enabling is refused unless the complete per-subject floor and
-- base-row content integrity are both present.
-- ---------------------------------------------------------------------------

create or replace function public.bar_simulation_set_randomization_v1(
  p_actor_user_id uuid,
  p_enabled boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $bar_simulation_set_randomization_v1$
declare
  v_config public.bar_simulation_runtime_config%rowtype;
  v_subject text;
  v_total integer;
  v_count integer;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.examination_require_admin(p_actor_user_id);
  if p_enabled is null or char_length(v_reason) not between 10 and 1000 then
    raise exception 'BAR_SIMULATION_RANDOMIZATION_CHANGE_INVALID';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bar-simulation-runtime-config-v1', 0)
  );
  select * into v_config
  from public.bar_simulation_runtime_config
  where config_key = 'randomized_allocation_v1'
  for update;

  if p_enabled then
    if v_config.current_source_digest is null then
      raise exception 'BAR_SIMULATION_POOL_NOT_READY';
    end if;
    select count(*) into v_total
    from public.bar_simulation_question_pool pool
    join public.examination_questions question on question.id = pool.question_id
    where pool.eligible
      and pool.source_digest = v_config.current_source_digest
      and question.publication_ready
      and question.review_status in ('approved', 'owner_override')
      and question.content_hash = pool.content_hash;
    if v_total < v_config.minimum_pool_total then
      raise exception 'BAR_SIMULATION_POOL_NOT_READY';
    end if;
    foreach v_subject in array array[
      'Political and Public International Law',
      'Labor Law',
      'Civil Law',
      'Taxation Law',
      'Commercial Law',
      'Criminal Law',
      'Remedial Law',
      'Legal and Judicial Ethics'
    ]
    loop
      select count(*) into v_count
      from public.bar_simulation_question_pool pool
      join public.examination_questions question on question.id = pool.question_id
      where pool.eligible
        and pool.subject = v_subject
        and pool.source_digest = v_config.current_source_digest
        and question.publication_ready
        and question.review_status in ('approved', 'owner_override')
        and question.content_hash = pool.content_hash;
      if v_count < v_config.minimum_per_subject then
        raise exception 'BAR_SIMULATION_POOL_NOT_READY:%', v_subject;
      end if;
    end loop;
  end if;

  update public.bar_simulation_runtime_config
  set allocation_enabled = p_enabled,
      updated_by = p_actor_user_id,
      update_reason = v_reason,
      updated_at = now()
  where config_key = 'randomized_allocation_v1'
  returning * into v_config;

  insert into public.examination_audit_log (
    actor_user_id, action, resource_type, resource_id, reason, metadata
  )
  values (
    p_actor_user_id,
    case when p_enabled
      then 'bar_simulation_randomization_enabled'
      else 'bar_simulation_randomization_disabled'
    end,
    'bar_simulation_runtime_config',
    v_config.config_key,
    v_reason,
    jsonb_build_object('enabled', p_enabled)
  );

  return jsonb_build_object(
    'enabled', v_config.allocation_enabled,
    'updatedAt', v_config.updated_at
  );
end;
$bar_simulation_set_randomization_v1$;

-- ---------------------------------------------------------------------------
-- Lifetime feature-scoped answer history and allocation immutability
-- ---------------------------------------------------------------------------

create or replace function public.bar_simulation_capture_answer_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $bar_simulation_capture_answer_v1$
declare
  v_user_id uuid;
begin
  -- Once a response has ever been nonblank it is lifetime-ineligible. During
  -- installation, a legacy answer can be cleared after the trigger is active
  -- but before the historical backfill reaches it; preserve OLD in that race.
  if nullif(btrim(new.answer_text), '') is null
     and (
       tg_op <> 'UPDATE'
       or nullif(btrim(old.answer_text), '') is null
     )
  then
    return new;
  end if;
  select attempt.user_id
  into v_user_id
  from public.examination_attempts_multi attempt
  join public.examination_versions version on version.id = attempt.version_id
  join public.examination_definitions definition on definition.id = version.exam_id
  where attempt.id = new.attempt_id
    and definition.track = 'bar_feels';
  if v_user_id is not null then
    insert into public.bar_simulation_answered_questions (
      user_id, question_id, first_attempt_id, first_answered_at
    )
    values (v_user_id, new.question_id, new.attempt_id, now())
    on conflict (user_id, question_id) do nothing;
  end if;
  return new;
end;
$bar_simulation_capture_answer_v1$;

-- The trigger on the live response table and the historical backfill are
-- installed by separate, ordered migrations. Keeping them out of this long
-- additive migration avoids holding a write-conflicting table lock while the
-- remaining functions and grants are created.

create or replace function public.bar_simulation_guard_allocation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $bar_simulation_guard_allocation_v1$
begin
  if tg_op = 'DELETE' then
    raise exception 'BAR_SIMULATION_ALLOCATION_IMMUTABLE';
  end if;
  if new.id is distinct from old.id
     or new.public_id is distinct from old.public_id
     or new.user_id is distinct from old.user_id
     or new.destination is distinct from old.destination
     or new.catalog_exam_id is distinct from old.catalog_exam_id
     or new.catalog_version_id is distinct from old.catalog_version_id
     or new.allocated_version_id is distinct from old.allocated_version_id
     or new.attempt_id is distinct from old.attempt_id
     or new.start_request_key is distinct from old.start_request_key
     or new.source_digest is distinct from old.source_digest
     or new.created_at is distinct from old.created_at
     or (old.status = 'closed' and new.status <> 'closed')
     or (old.status = 'open' and new.status not in ('open', 'closed'))
  then
    raise exception 'BAR_SIMULATION_ALLOCATION_IMMUTABLE';
  end if;
  return new;
end;
$bar_simulation_guard_allocation_v1$;

drop trigger if exists bar_simulation_guard_allocation_v1_trigger
  on public.bar_simulation_allocations;
create trigger bar_simulation_guard_allocation_v1_trigger
before update or delete on public.bar_simulation_allocations
for each row
execute function public.bar_simulation_guard_allocation_v1();

create or replace function public.bar_simulation_guard_allocation_question_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $bar_simulation_guard_allocation_question_v1$
begin
  if tg_op <> 'INSERT' then
    raise exception 'BAR_SIMULATION_ALLOCATION_IMMUTABLE';
  end if;
  if not exists (
    select 1
    from public.bar_simulation_allocations allocation
    join public.examination_versions version
      on version.id = allocation.allocated_version_id
    where allocation.id = new.allocation_id
      and allocation.status = 'open'
      and version.status = 'draft'
  ) then
    raise exception 'BAR_SIMULATION_ALLOCATION_IMMUTABLE';
  end if;
  return new;
end;
$bar_simulation_guard_allocation_question_v1$;

drop trigger if exists bar_simulation_guard_allocation_question_v1_trigger
  on public.bar_simulation_allocation_questions;
create trigger bar_simulation_guard_allocation_question_v1_trigger
before insert or update or delete on public.bar_simulation_allocation_questions
for each row
execute function public.bar_simulation_guard_allocation_question_v1();

create or replace function public.bar_simulation_close_allocation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $bar_simulation_close_allocation_v1$
begin
  if old.status in ('in_progress', 'review')
     and new.status not in ('in_progress', 'review')
  then
    update public.bar_simulation_allocations
    set status = 'closed',
        closed_at = coalesce(closed_at, now()),
        updated_at = now()
    where attempt_id = new.id
      and status = 'open';
  end if;
  return new;
end;
$bar_simulation_close_allocation_v1$;

-- While randomized allocation is enabled (or an allocated attempt is still
-- open during rollback), also protect the legacy start path from creating a
-- second open attempt for the same Simulation destination.
create or replace function public.bar_simulation_guard_one_open_attempt_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $bar_simulation_guard_one_open_attempt_v1$
declare
  v_destination text;
  v_enabled boolean;
  v_private_version public.bar_simulation_private_versions%rowtype;
begin
  if new.status not in ('in_progress', 'review') then
    return new;
  end if;
  select definition.subject
  into v_destination
  from public.examination_versions version
  join public.examination_definitions definition on definition.id = version.exam_id
  where version.id = new.version_id
    and definition.track = 'bar_feels';
  if v_destination is null then
    return new;
  end if;
  select * into v_private_version
  from public.bar_simulation_private_versions private_version
  where private_version.version_id = new.version_id;
  if v_private_version.version_id is not null
     and (
       v_private_version.user_id <> new.user_id
       or v_private_version.expected_attempt_id <> new.id
     )
  then
    raise exception 'BAR_SIMULATION_PRIVATE_VERSION_FORBIDDEN';
  end if;
  select allocation_enabled into v_enabled
  from public.bar_simulation_runtime_config
  where config_key = 'randomized_allocation_v1';
  if not coalesce(v_enabled, false)
     and not exists (
       select 1
       from public.bar_simulation_allocations allocation
       where allocation.user_id = new.user_id
         and allocation.destination = v_destination
         and allocation.status = 'open'
         and allocation.attempt_id <> new.id
     )
  then
    return new;
  end if;

  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'bar-simulation-destination:' || new.user_id::text || ':' || v_destination,
    0
  ));
  if exists (
    select 1
    from public.examination_attempts_multi attempt
    join public.examination_versions version on version.id = attempt.version_id
    join public.examination_definitions definition on definition.id = version.exam_id
    where attempt.user_id = new.user_id
      and attempt.id <> new.id
      and attempt.status in ('in_progress', 'review')
      and definition.track = 'bar_feels'
      and definition.subject = v_destination
  ) then
    raise exception 'BAR_SIMULATION_OPEN_ATTEMPT_EXISTS';
  end if;
  return new;
end;
$bar_simulation_guard_one_open_attempt_v1$;

create or replace function public.bar_simulation_guard_private_version_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $bar_simulation_guard_private_version_v1$
begin
  raise exception 'BAR_SIMULATION_PRIVATE_VERSION_IMMUTABLE';
end;
$bar_simulation_guard_private_version_v1$;

drop trigger if exists bar_simulation_guard_private_version_v1_trigger
  on public.bar_simulation_private_versions;
create trigger bar_simulation_guard_private_version_v1_trigger
before update or delete on public.bar_simulation_private_versions
for each row
execute function public.bar_simulation_guard_private_version_v1();

-- ---------------------------------------------------------------------------
-- Atomic 20-question allocation. The RPC is private and creates a published,
-- immutable snapshot version solely for its owner/attempt. It never changes
-- the definition's active catalog version and reserves no grading credit.
-- ---------------------------------------------------------------------------

create or replace function public.bar_simulation_start_attempt_v1(
  p_user_id uuid,
  p_catalog_version_id uuid,
  p_timer_mode text,
  p_request_key text,
  p_tab_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $bar_simulation_start_attempt_v1$
declare
  v_now timestamptz := now();
  v_request_hash text;
  v_tab_hash text;
  v_receipt public.bar_simulation_start_receipts%rowtype;
  v_attempt public.examination_attempts_multi%rowtype;
  v_catalog_version public.examination_versions%rowtype;
  v_definition public.examination_definitions%rowtype;
  v_config public.bar_simulation_runtime_config%rowtype;
  v_allocation_id uuid;
  v_allocated_version_id uuid;
  v_attempt_id uuid;
  v_destination text;
  v_pool_subjects text[];
  v_pool_quotas integer[];
  v_selected_ids uuid[] := '{}'::uuid[];
  v_subject text;
  v_quota integer;
  v_selected_before integer;
  v_pool_index integer;
  v_question record;
  v_ordered_questions jsonb;
  v_snapshot_hash text;
  v_pool_digest text;
  v_version_number integer;
  v_result jsonb;
  v_existing_allocation_id uuid;
begin
  if p_user_id is null
     or p_catalog_version_id is null
     or coalesce(p_timer_mode, '') not in ('strict', 'selfPaced', 'none')
     or coalesce(p_request_key, '') !~ '^[A-Za-z0-9_-]{16,128}$'
     or char_length(coalesce(p_tab_token, '')) < 32
  then
    raise exception 'BAR_SIMULATION_START_INVALID';
  end if;

  v_tab_hash := encode(extensions.digest(coalesce(p_tab_token, ''), 'sha256'), 'hex');
  v_request_hash := encode(extensions.digest(
    jsonb_build_object(
      'catalogVersionId', p_catalog_version_id,
      'timerMode', p_timer_mode,
      'requestKey', p_request_key,
      'tabHash', v_tab_hash
    )::text,
    'sha256'
  ), 'hex');

  -- The request-key lock makes idempotency durable even for A/B/A ordering or
  -- concurrent retries. A receipt is checked before current catalog state so a
  -- historical retry always resolves to its original attempt.
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'bar-simulation-request:' || p_user_id::text || ':' || p_request_key,
    0
  ));
  select * into v_receipt
  from public.bar_simulation_start_receipts
  where user_id = p_user_id
    and request_key = p_request_key
  for update;
  if v_receipt.id is not null then
    if v_receipt.request_hash <> v_request_hash then
      raise exception 'BAR_SIMULATION_START_REQUEST_CONFLICT';
    end if;
    select * into v_attempt
    from public.examination_attempts_multi
    where id = v_receipt.attempt_id
      and user_id = p_user_id
    for update;
    if v_attempt.id is null then
      raise exception 'BAR_SIMULATION_RECEIPT_CORRUPT';
    end if;
    if v_attempt.status in ('in_progress', 'review') then
      if v_attempt.active_tab_hash <> v_tab_hash
         and v_attempt.tab_lease_until > v_now
      then
        raise exception 'EXAM_SECOND_TAB_BLOCKED';
      end if;
      update public.examination_attempts_multi
      set active_tab_hash = v_tab_hash,
          tab_lease_until = v_now + interval '90 seconds',
          last_heartbeat_at = v_now,
          updated_at = v_now
      where id = v_attempt.id
      returning * into v_attempt;
    end if;
    return public.examination_render_attempt(v_attempt.id, true)
      || jsonb_build_object(
        'resumed', true,
        'replayed', true,
        'allocationId', v_receipt.allocation_id,
        'destination', v_receipt.destination
      );
  end if;

  perform public.examination_require_beta(p_user_id);

  select * into v_catalog_version
  from public.examination_versions
  where id = p_catalog_version_id
    and status = 'published';
  if v_catalog_version.id is null then
    raise exception 'EXAM_VERSION_NOT_FOUND';
  end if;
  select * into v_definition
  from public.examination_definitions
  where id = v_catalog_version.exam_id
    and status = 'published'
    and active_version_id = p_catalog_version_id
    and track = 'bar_feels'
    and assessment_kind = 'curated';
  if v_definition.id is null then
    raise exception 'BAR_SIMULATION_CATALOG_STALE';
  end if;
  if (v_definition.available_from is not null and v_definition.available_from > v_now)
     or (v_definition.available_until is not null and v_definition.available_until <= v_now)
  then
    raise exception 'EXAM_NOT_AVAILABLE';
  end if;
  if not (
    v_definition.owner_user_id = p_user_id
    or public.examination_is_admin(p_user_id)
    or exists (
      select 1
      from public.examination_participants participant
      where participant.version_id = v_catalog_version.id
        and participant.user_id = p_user_id
        and participant.enabled
    )
    or public.examination_has_beta_access(p_user_id)
  ) then
    raise exception 'EXAM_NOT_AVAILABLE';
  end if;
  if not (v_catalog_version.allowed_timer_modes ? p_timer_mode) then
    raise exception 'EXAM_TIMER_MODE_LOCKED';
  end if;

  v_destination := v_definition.subject;
  if v_destination = 'Commercial and Taxation Laws' then
    v_pool_subjects := array['Commercial Law', 'Taxation Law'];
    v_pool_quotas := array[10, 10];
  elsif v_destination = 'Remedial Law, Legal and Judicial Ethics' then
    v_pool_subjects := array['Remedial Law', 'Legal and Judicial Ethics'];
    v_pool_quotas := array[10, 10];
  elsif v_destination = 'Labor Law and Social Legislations' then
    v_pool_subjects := array['Labor Law'];
    v_pool_quotas := array[20];
  elsif v_destination = any(array[
    'Political and Public International Law',
    'Civil Law',
    'Criminal Law'
  ]) then
    v_pool_subjects := array[v_destination];
    v_pool_quotas := array[20];
  else
    raise exception 'BAR_SIMULATION_DESTINATION_INVALID';
  end if;

  -- Serialize all starts for this user/destination, and share the legacy
  -- active-version lock so an in-flight pre-rollout start cannot create a
  -- second open attempt while the feature flag changes.
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'examination-start:' || p_user_id::text || ':' || p_catalog_version_id::text,
    0
  ));
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'bar-simulation-destination:' || p_user_id::text || ':' || v_destination,
    0
  ));

  -- Recheck catalog truth after the locks.
  select * into v_definition
  from public.examination_definitions
  where id = v_catalog_version.exam_id
    and status = 'published'
    and active_version_id = p_catalog_version_id
    and track = 'bar_feels'
    and assessment_kind = 'curated'
  for update;
  if v_definition.id is null then
    raise exception 'BAR_SIMULATION_CATALOG_STALE';
  end if;

  -- Resume any open Simulation attempt for this destination, including an
  -- attempt created by the legacy fixed-version path before rollout.
  select attempt.* into v_attempt
  from public.examination_attempts_multi attempt
  join public.examination_versions version on version.id = attempt.version_id
  join public.examination_definitions definition on definition.id = version.exam_id
  where attempt.user_id = p_user_id
    and attempt.status in ('in_progress', 'review')
    and definition.track = 'bar_feels'
    and definition.subject = v_destination
  order by attempt.started_at desc, attempt.id
  limit 1
  for update of attempt;
  if v_attempt.id is not null then
    if v_attempt.active_tab_hash <> v_tab_hash
       and v_attempt.tab_lease_until > v_now
    then
      raise exception 'EXAM_SECOND_TAB_BLOCKED';
    end if;
    update public.examination_attempts_multi
    set active_tab_hash = v_tab_hash,
        tab_lease_until = v_now + interval '90 seconds',
        last_heartbeat_at = v_now,
        updated_at = v_now
    where id = v_attempt.id
    returning * into v_attempt;
    select id into v_existing_allocation_id
    from public.bar_simulation_allocations
    where attempt_id = v_attempt.id;
    insert into public.bar_simulation_start_receipts (
      user_id, request_key, request_hash, destination, catalog_version_id,
      attempt_id, allocation_id
    )
    values (
      p_user_id, p_request_key, v_request_hash, v_destination,
      p_catalog_version_id, v_attempt.id, v_existing_allocation_id
    );
    return public.examination_render_attempt(v_attempt.id, true)
      || jsonb_build_object(
        'resumed', true,
        'replayed', false,
        'allocationId', v_existing_allocation_id,
        'destination', v_destination
      );
  end if;

  select * into v_config
  from public.bar_simulation_runtime_config
  where config_key = 'randomized_allocation_v1'
  for share;
  if v_config.config_key is null or not v_config.allocation_enabled then
    raise exception 'BAR_SIMULATION_RANDOMIZATION_DISABLED';
  end if;

  v_pool_digest := v_config.current_source_digest;
  if v_pool_digest is null then
    raise exception 'BAR_SIMULATION_POOL_NOT_READY';
  end if;

  for v_pool_index in 1..array_length(v_pool_subjects, 1)
  loop
    v_subject := v_pool_subjects[v_pool_index];
    v_quota := v_pool_quotas[v_pool_index];
    v_selected_before := coalesce(array_length(v_selected_ids, 1), 0);
    for v_question in
      select pool.question_id
      from public.bar_simulation_question_pool pool
      join public.examination_questions question on question.id = pool.question_id
      where pool.eligible
        and pool.subject = v_subject
        and pool.source_digest = v_pool_digest
        and question.publication_ready
        and question.review_status in ('approved', 'owner_override')
        and question.content_hash = pool.content_hash
        and not exists (
          select 1
          from public.bar_simulation_answered_questions answered
          where answered.user_id = p_user_id
            and answered.question_id = pool.question_id
        )
      order by extensions.gen_random_bytes(16)
      limit v_quota
    loop
      v_selected_ids := array_append(v_selected_ids, v_question.question_id);
    end loop;
    if coalesce(array_length(v_selected_ids, 1), 0) - v_selected_before <> v_quota then
      raise exception 'BAR_SIMULATION_POOL_EXHAUSTED:%', v_subject;
    end if;
  end loop;

  -- A second independent cryptographic shuffle establishes final ordinal order.
  select jsonb_agg(
    jsonb_build_object(
      'questionId', shuffled.question_id,
      'subject', shuffled.subject,
      'contentHash', shuffled.content_hash
    )
    order by shuffled.order_key
  )
  into v_ordered_questions
  from (
    select pool.question_id,
           pool.subject,
           pool.content_hash,
           extensions.gen_random_bytes(16) as order_key
    from public.bar_simulation_question_pool pool
    where pool.question_id = any(v_selected_ids)
  ) shuffled;
  if jsonb_array_length(coalesce(v_ordered_questions, '[]'::jsonb)) <> 20 then
    raise exception 'BAR_SIMULATION_ALLOCATION_COUNT_INVALID';
  end if;

  select encode(extensions.digest(
    string_agg(
      (item.value->>'questionId') || ':' || (item.value->>'contentHash'),
      E'\n' order by item.ordinality
    ),
    'sha256'
  ), 'hex')
  into v_snapshot_hash
  from jsonb_array_elements(v_ordered_questions)
    with ordinality as item(value, ordinality);

  v_allocation_id := extensions.gen_random_uuid();
  v_allocated_version_id := extensions.gen_random_uuid();
  v_attempt_id := extensions.gen_random_uuid();

  -- The definition row lock serializes version-number assignment with catalog
  -- publication without changing that definition.
  select coalesce(max(version_number), 0) + 1
  into v_version_number
  from public.examination_versions
  where exam_id = v_definition.id;

  insert into public.examination_versions (
    id, exam_id, version_number, label, duration_seconds,
    default_timer_mode, allowed_timer_modes, grading_route,
    answer_release_rule, release_at, instructions, syllabus,
    question_count, status, snapshot_hash, created_by, published_at
  )
  values (
    v_allocated_version_id,
    v_definition.id,
    v_version_number,
    'Private randomized allocation ' || left(v_allocation_id::text, 8),
    v_catalog_version.duration_seconds,
    v_catalog_version.default_timer_mode,
    v_catalog_version.allowed_timer_modes,
    v_catalog_version.grading_route,
    v_catalog_version.answer_release_rule,
    v_catalog_version.release_at,
    v_catalog_version.instructions,
    v_catalog_version.syllabus,
    20,
    'draft',
    v_snapshot_hash,
    v_catalog_version.created_by,
    null
  );

  insert into public.bar_simulation_private_versions (
    version_id, user_id, expected_attempt_id, destination
  )
  values (
    v_allocated_version_id, p_user_id, v_attempt_id, v_destination
  );

  if exists (
    select 1
    from public.examination_attempts_multi attempt
    where attempt.user_id = p_user_id
      and attempt.start_request_key = p_request_key
  ) then
    raise exception 'BAR_SIMULATION_START_REQUEST_CONFLICT';
  end if;

  insert into public.examination_attempts_multi (
    id, user_id, version_id, timer_mode, status, started_at,
    deadline_at, last_activity_at, last_heartbeat_at, active_tab_hash,
    tab_lease_until, elapsed_seconds, start_request_key,
    grading_entitlement_reserved, grading_entitlement_reference,
    created_at, updated_at
  )
  values (
    v_attempt_id,
    p_user_id,
    v_allocated_version_id,
    p_timer_mode,
    'in_progress',
    v_now,
    case when p_timer_mode = 'strict'
      then v_now + make_interval(secs => v_catalog_version.duration_seconds)
      else null
    end,
    v_now,
    v_now,
    v_tab_hash,
    v_now + interval '90 seconds',
    0,
    p_request_key,
    false,
    null,
    v_now,
    v_now
  );

  insert into public.bar_simulation_allocations (
    id, user_id, destination, catalog_exam_id, catalog_version_id,
    allocated_version_id, attempt_id, start_request_key, source_digest,
    status, created_at, updated_at
  )
  values (
    v_allocation_id, p_user_id, v_destination, v_definition.id,
    p_catalog_version_id, v_allocated_version_id, v_attempt_id,
    p_request_key, v_pool_digest, 'open', v_now, v_now
  );

  insert into public.bar_simulation_allocation_questions (
    allocation_id, ordinal, question_id, original_subject, content_hash
  )
  select
    v_allocation_id,
    item.ordinality::smallint,
    (item.value->>'questionId')::uuid,
    item.value->>'subject',
    item.value->>'contentHash'
  from jsonb_array_elements(v_ordered_questions)
    with ordinality as item(value, ordinality);

  insert into public.examination_version_questions (
    version_id, question_id, ordinal, prompt_snapshot,
    model_answer_snapshot, legal_basis_snapshot, application_snapshot,
    conclusion_snapshot, jurisprudence_snapshot, citation_snapshot,
    governing_provision_snapshot, source_urls_snapshot, snapshot_hash
  )
  select
    v_allocated_version_id,
    allocation_question.question_id,
    allocation_question.ordinal,
    question.prompt_text,
    question.model_answer,
    question.legal_basis,
    question.application_text,
    question.conclusion_text,
    question.jurisprudence,
    question.citation,
    question.governing_provision,
    question.source_urls,
    allocation_question.content_hash
  from public.bar_simulation_allocation_questions allocation_question
  join public.examination_questions question
    on question.id = allocation_question.question_id
  where allocation_question.allocation_id = v_allocation_id
  order by allocation_question.ordinal;

  if (
    select count(*)
    from public.examination_version_questions
    where version_id = v_allocated_version_id
  ) <> 20 then
    raise exception 'BAR_SIMULATION_ALLOCATION_COUNT_INVALID';
  end if;

  update public.examination_versions
  set status = 'published',
      published_at = v_now
  where id = v_allocated_version_id;

  insert into public.examination_responses (attempt_id, question_id)
  select v_attempt_id, question_id
  from public.examination_version_questions
  where version_id = v_allocated_version_id
  order by ordinal;

  insert into public.examination_audit_log (
    actor_user_id, action, resource_type, resource_id, reason, metadata
  )
  values (
    p_user_id,
    'bar_simulation_attempt_allocated',
    'bar_simulation_allocation',
    v_allocation_id::text,
    'Examinee confirmed Begin Examination with randomized allocation enabled.',
    jsonb_build_object(
      'attemptId', v_attempt_id,
      'destination', v_destination,
      'catalogVersionId', p_catalog_version_id,
      'allocatedVersionId', v_allocated_version_id,
      'questionCount', 20,
      'sourceDigest', v_pool_digest,
      'gradingCreditReserved', false
    )
  );

  insert into public.bar_simulation_start_receipts (
    user_id, request_key, request_hash, destination, catalog_version_id,
    attempt_id, allocation_id
  )
  values (
    p_user_id, p_request_key, v_request_hash, v_destination,
    p_catalog_version_id, v_attempt_id, v_allocation_id
  );

  v_result := public.examination_render_attempt(v_attempt_id, true)
    || jsonb_build_object(
      'resumed', false,
      'replayed', false,
      'allocationId', v_allocation_id,
      'destination', v_destination,
      'sourceDigest', v_pool_digest
    );
  return v_result;
exception
  when unique_violation then
    raise exception 'BAR_SIMULATION_START_CONFLICT';
end;
$bar_simulation_start_attempt_v1$;

-- Optional Worker helper for catalog UI. It exposes identifiers/status only,
-- never prompt, answer, or source-pool content.
create or replace function public.bar_simulation_open_attempt_v1(
  p_user_id uuid,
  p_catalog_version_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $bar_simulation_open_attempt_v1$
  select coalesce((
    select jsonb_build_object(
      'attemptId', attempt.id,
      'status', attempt.status,
      'destination', catalog_definition.subject,
      'allocatedVersionId', attempt.version_id
    )
    from public.examination_versions catalog_version
    join public.examination_definitions catalog_definition
      on catalog_definition.id = catalog_version.exam_id
    join public.examination_versions attempt_version
      on attempt_version.exam_id = catalog_definition.id
    join public.examination_attempts_multi attempt
      on attempt.version_id = attempt_version.id
    where catalog_version.id = p_catalog_version_id
      and catalog_definition.track = 'bar_feels'
      and attempt.user_id = p_user_id
      and attempt.status in ('in_progress', 'review')
    order by attempt.started_at desc, attempt.id
    limit 1
  ), '{}'::jsonb);
$bar_simulation_open_attempt_v1$;

-- ---------------------------------------------------------------------------
-- Exact privileges. SECURITY DEFINER is necessary because the Worker-mediated
-- RPCs touch FORCE-RLS private tables; browser roles cannot execute them.
-- ---------------------------------------------------------------------------

revoke all on function public.bar_simulation_sync_pool_v1(uuid, jsonb, text, text)
  from public, anon, authenticated;
revoke all on function public.bar_simulation_set_randomization_v1(uuid, boolean, text)
  from public, anon, authenticated;
revoke all on function public.bar_simulation_start_attempt_v1(uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.bar_simulation_open_attempt_v1(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.bar_simulation_capture_answer_v1()
  from public, anon, authenticated;
revoke all on function public.bar_simulation_guard_allocation_v1()
  from public, anon, authenticated;
revoke all on function public.bar_simulation_guard_allocation_question_v1()
  from public, anon, authenticated;
revoke all on function public.bar_simulation_close_allocation_v1()
  from public, anon, authenticated;
revoke all on function public.bar_simulation_guard_one_open_attempt_v1()
  from public, anon, authenticated;
revoke all on function public.bar_simulation_guard_private_version_v1()
  from public, anon, authenticated;

grant execute on function public.bar_simulation_sync_pool_v1(uuid, jsonb, text, text)
  to service_role;
grant execute on function public.bar_simulation_set_randomization_v1(uuid, boolean, text)
  to service_role;
grant execute on function public.bar_simulation_start_attempt_v1(uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.bar_simulation_open_attempt_v1(uuid, uuid)
  to service_role;

commit;

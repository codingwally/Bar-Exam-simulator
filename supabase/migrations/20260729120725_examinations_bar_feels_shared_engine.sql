-- Due Diligence: shared examination engine for Subject Matter Examinations and Bar Feels.
-- Additive migration. Existing Mock Bar, grading, subscription, payment, Quorum,
-- and question-bank objects are intentionally not altered.

begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Curated and private uploaded question snapshots
-- ---------------------------------------------------------------------------

create table if not exists public.examination_questions (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  source_type text not null
    check (source_type in ('google_sheet', 'uploaded')),
  owner_user_id uuid references auth.users(id) on delete cascade,
  subject text not null check (char_length(btrim(subject)) between 2 and 120),
  topic text,
  bar_year integer check (bar_year is null or bar_year between 1900 and 2200),
  question_number text,
  difficulty text,
  prompt_text text not null check (char_length(btrim(prompt_text)) >= 20),
  model_answer text,
  legal_basis text,
  doctrine text,
  application_text text,
  conclusion_text text,
  jurisprudence jsonb not null default '[]'::jsonb
    check (jsonb_typeof(jurisprudence) = 'array'),
  citation text,
  governing_provision text,
  source_urls jsonb not null default '[]'::jsonb
    check (jsonb_typeof(source_urls) = 'array'),
  source_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_metadata) = 'object'),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected')),
  publication_ready boolean not null default false,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  source_updated_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint examination_questions_source_scope_unique
    unique nulls not distinct (source_type, source_key, owner_user_id),
  constraint examination_questions_publication_truth_check
    check (
      not publication_ready
      or (
        review_status = 'approved'
        and model_answer is not null
        and char_length(btrim(model_answer)) >= 20
        and legal_basis is not null
        and char_length(btrim(legal_basis)) >= 10
        and source_type = 'google_sheet'
      )
    ),
  constraint examination_questions_upload_private_check
    check (
      (source_type = 'uploaded' and owner_user_id is not null and not publication_ready)
      or source_type = 'google_sheet'
    )
);

alter table public.examination_questions
  add column if not exists bar_year integer
    check (bar_year is null or bar_year between 1900 and 2200),
  add column if not exists question_number text,
  add column if not exists difficulty text,
  add column if not exists doctrine text,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_metadata) = 'object');

create index if not exists examination_questions_subject_ready_idx
  on public.examination_questions (subject, publication_ready, review_status);
create index if not exists examination_questions_owner_idx
  on public.examination_questions (owner_user_id)
  where owner_user_id is not null;

-- ---------------------------------------------------------------------------
-- Definitions and immutable published versions
-- ---------------------------------------------------------------------------

create table if not exists public.examination_definitions (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  track text not null check (track in ('per_subject', 'bar_feels')),
  assessment_kind text not null check (
    assessment_kind in ('midterm', 'final', 'curated', 'uploaded', 'system_test')
  ),
  title text not null check (char_length(btrim(title)) between 3 and 180),
  subject text,
  year_level smallint check (year_level between 1 and 4),
  semester smallint check (semester between 1 and 3),
  owner_user_id uuid references auth.users(id) on delete cascade,
  test_only boolean not null default true,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'unpublished', 'closed')),
  active_version_id uuid,
  available_from timestamptz,
  available_until timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint examination_definitions_track_kind_check check (
    (track = 'per_subject' and assessment_kind in ('midterm', 'final', 'system_test'))
    or (track = 'bar_feels' and assessment_kind in ('curated', 'uploaded', 'system_test'))
  ),
  constraint examination_definitions_owner_check check (
    (assessment_kind = 'uploaded' and owner_user_id is not null and track = 'bar_feels')
    or assessment_kind <> 'uploaded'
  ),
  constraint examination_definitions_availability_check check (
    available_until is null or available_from is null or available_until > available_from
  )
);

create index if not exists examination_definitions_catalog_idx
  on public.examination_definitions (track, status, subject, assessment_kind);
create index if not exists examination_definitions_owner_idx
  on public.examination_definitions (owner_user_id)
  where owner_user_id is not null;

create table if not exists public.examination_versions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.examination_definitions(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  label text not null check (char_length(btrim(label)) between 1 and 120),
  duration_seconds integer not null check (duration_seconds between 60 and 14400),
  default_timer_mode text not null
    check (default_timer_mode in ('strict', 'selfPaced', 'none')),
  allowed_timer_modes jsonb not null default '["strict","selfPaced","none"]'::jsonb
    check (jsonb_typeof(allowed_timer_modes) = 'array'),
  grading_route text not null
    check (grading_route in ('ai', 'human', 'either', 'provisional')),
  answer_release_rule text not null
    check (answer_release_rule in ('after_ai', 'after_human', 'scheduled', 'manual')),
  release_at timestamptz,
  instructions text not null default ''
    check (char_length(instructions) <= 8000),
  syllabus jsonb not null default '[]'::jsonb check (jsonb_typeof(syllabus) = 'array'),
  question_count integer not null default 0 check (question_count between 0 and 20),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'retired')),
  snapshot_hash text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  retired_at timestamptz,
  unique (exam_id, version_number),
  constraint examination_versions_release_check check (
    answer_release_rule <> 'scheduled' or release_at is not null
  ),
  constraint examination_versions_published_snapshot_check check (
    status <> 'published'
    or (
      question_count > 0
      and snapshot_hash ~ '^[0-9a-f]{64}$'
      and published_at is not null
    )
  )
);

alter table public.examination_definitions
  drop constraint if exists examination_definitions_active_version_fkey;
alter table public.examination_definitions
  add constraint examination_definitions_active_version_fkey
  foreign key (active_version_id)
  references public.examination_versions(id)
  on delete set null
  deferrable initially deferred;

create index if not exists examination_versions_exam_status_idx
  on public.examination_versions (exam_id, status, version_number desc);

create table if not exists public.examination_version_questions (
  version_id uuid not null
    references public.examination_versions(id) on delete cascade,
  question_id uuid not null
    references public.examination_questions(id) on delete restrict,
  ordinal smallint not null check (ordinal between 1 and 20),
  prompt_snapshot text not null check (char_length(btrim(prompt_snapshot)) >= 20),
  model_answer_snapshot text,
  legal_basis_snapshot text,
  application_snapshot text,
  conclusion_snapshot text,
  jurisprudence_snapshot jsonb not null default '[]'::jsonb
    check (jsonb_typeof(jurisprudence_snapshot) = 'array'),
  citation_snapshot text,
  governing_provision_snapshot text,
  source_urls_snapshot jsonb not null default '[]'::jsonb
    check (jsonb_typeof(source_urls_snapshot) = 'array'),
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (version_id, question_id),
  unique (version_id, ordinal)
);

create index if not exists examination_version_questions_order_idx
  on public.examination_version_questions (version_id, ordinal);

-- ---------------------------------------------------------------------------
-- Beta access and explicit participants
-- ---------------------------------------------------------------------------

create table if not exists public.examination_beta_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  expires_at timestamptz,
  granted_by uuid not null references auth.users(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.examination_participants (
  version_id uuid not null references public.examination_versions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  granted_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (version_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Server-authoritative attempts, revisions, submissions, and grading
-- ---------------------------------------------------------------------------

create table if not exists public.examination_attempts_multi (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  version_id uuid not null references public.examination_versions(id) on delete restrict,
  timer_mode text not null check (timer_mode in ('strict', 'selfPaced', 'none')),
  status text not null default 'in_progress'
    check (status in ('in_progress', 'review', 'submitted', 'expired', 'cancelled')),
  started_at timestamptz not null default now(),
  deadline_at timestamptz,
  submitted_at timestamptz,
  last_activity_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  active_tab_hash text not null check (active_tab_hash ~ '^[0-9a-f]{64}$'),
  tab_lease_until timestamptz not null default (now() + interval '90 seconds'),
  elapsed_seconds integer not null default 0 check (elapsed_seconds >= 0),
  start_request_key text not null check (start_request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  grading_entitlement_reserved boolean not null default false,
  grading_entitlement_reference text,
  submission_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, start_request_key),
  constraint examination_attempts_strict_deadline_check check (
    timer_mode <> 'strict' or deadline_at is not null
  ),
  constraint examination_attempts_submission_check check (
    status not in ('submitted', 'expired') or submitted_at is not null
  )
);

create unique index if not exists examination_attempts_one_open_idx
  on public.examination_attempts_multi (user_id, version_id)
  where status in ('in_progress', 'review');
create index if not exists examination_attempts_user_history_idx
  on public.examination_attempts_multi (user_id, started_at desc);
create index if not exists examination_attempts_deadline_idx
  on public.examination_attempts_multi (deadline_at)
  where status in ('in_progress', 'review') and timer_mode = 'strict';

create table if not exists public.examination_responses (
  attempt_id uuid not null
    references public.examination_attempts_multi(id) on delete cascade,
  question_id uuid not null
    references public.examination_questions(id) on delete restrict,
  answer_text text not null default ''
    check (char_length(answer_text) <= 20000),
  flagged boolean not null default false,
  revision integer not null default 0 check (revision >= 0),
  activity_seconds integer not null default 0 check (activity_seconds >= 0),
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

create index if not exists examination_responses_question_idx
  on public.examination_responses (question_id);

create table if not exists public.examination_submissions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique
    references public.examination_attempts_multi(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  receipt_code text not null unique,
  answered_count integer not null check (answered_count >= 0),
  flagged_count integer not null check (flagged_count >= 0),
  question_count integer not null check (question_count between 1 and 20),
  submitted_at timestamptz not null default now(),
  automatic boolean not null default false,
  unique (user_id, request_key)
);

create table if not exists public.examination_grading_jobs (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null
    references public.examination_attempts_multi(id) on delete cascade,
  route text not null check (route in ('ai', 'human', 'provisional')),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  requested_by uuid not null references auth.users(id) on delete cascade,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  safe_error_code text,
  created_at timestamptz not null default now(),
  unique (requested_by, request_key),
  unique (attempt_id, route)
);

create table if not exists public.examination_ai_assessments (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null
    references public.examination_attempts_multi(id) on delete cascade,
  question_id uuid not null
    references public.examination_questions(id) on delete restrict,
  score numeric(2,1) not null check (score between 0.0 and 5.0),
  assessment_json jsonb not null check (jsonb_typeof(assessment_json) = 'object'),
  grader_model text not null,
  model_answer_hash text not null check (model_answer_hash ~ '^[0-9a-f]{64}$'),
  finalized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);

create index if not exists examination_ai_assessments_attempt_idx
  on public.examination_ai_assessments (attempt_id, finalized_at);

-- ---------------------------------------------------------------------------
-- Human review, model release, notifications, uploads, and audit
-- ---------------------------------------------------------------------------

create table if not exists public.examination_examiner_assignments (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  attempt_id uuid not null
    references public.examination_attempts_multi(id) on delete cascade,
  examiner_email text not null
    check (examiner_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'finalized', 'expired', 'revoked')),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  finalized_at timestamptz,
  invitation_status text not null default 'not_configured'
    check (invitation_status in ('not_configured', 'suppressed', 'sent', 'failed')),
  invitation_provider_id text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint examination_assignment_expiration_check
    check (expires_at > created_at)
);

create unique index if not exists examination_assignment_active_idx
  on public.examination_examiner_assignments (attempt_id)
  where status in ('pending', 'claimed');
create index if not exists examination_assignment_email_idx
  on public.examination_examiner_assignments (lower(examiner_email), expires_at);

create table if not exists public.examination_examiner_reviews (
  assignment_id uuid not null
    references public.examination_examiner_assignments(id) on delete cascade,
  question_id uuid not null
    references public.examination_questions(id) on delete restrict,
  score numeric(2,1) not null check (score between 0.0 and 5.0),
  comments text not null default '' check (char_length(comments) <= 8000),
  revision integer not null default 1 check (revision > 0),
  saved_at timestamptz not null default now(),
  finalized_at timestamptz,
  primary key (assignment_id, question_id)
);

create table if not exists public.examination_model_releases (
  attempt_id uuid primary key
    references public.examination_attempts_multi(id) on delete cascade,
  released_at timestamptz not null default now(),
  released_by uuid references auth.users(id) on delete set null,
  release_reason text not null check (char_length(btrim(release_reason)) between 5 and 1000),
  email_status text not null default 'not_configured'
    check (email_status in ('not_configured', 'suppressed', 'sent', 'failed')),
  email_provider_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.examination_uploads (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  bucket_id text not null default 'examination-uploads'
    check (bucket_id = 'examination-uploads'),
  object_path text not null unique,
  safe_file_name text not null,
  mime_type text not null check (
    mime_type in (
      'text/plain',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  ),
  size_bytes integer not null check (size_bytes between 1 and 1500000),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'parsed'
    check (status in ('pending', 'parsed', 'confirmed', 'failed', 'deleted')),
  extracted_questions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(extracted_questions) = 'array'),
  parsing_error_code text,
  exam_id uuid references public.examination_definitions(id) on delete set null,
  retention_until timestamptz not null default (now() + interval '30 days'),
  confirmed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, content_hash)
);

create index if not exists examination_uploads_retention_idx
  on public.examination_uploads (retention_until)
  where deleted_at is null;

create table if not exists public.examination_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  assignment_id uuid references public.examination_examiner_assignments(id) on delete cascade,
  notification_type text not null
    check (notification_type in ('examiner_invitation', 'human_review_finalized', 'model_answers_released')),
  recipient text not null,
  status text not null
    check (status in ('not_configured', 'suppressed', 'sent', 'failed')),
  provider_id text,
  safe_error_code text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists public.examination_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(btrim(action)) between 3 and 120),
  resource_type text not null check (char_length(btrim(resource_type)) between 3 and 80),
  resource_id text not null check (char_length(btrim(resource_id)) between 1 and 160),
  reason text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists examination_audit_resource_idx
  on public.examination_audit_log (resource_type, resource_id, created_at desc);
create index if not exists examination_audit_actor_idx
  on public.examination_audit_log (actor_user_id, created_at desc);

create table if not exists public.examination_command_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null,
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response_json jsonb not null check (jsonb_typeof(response_json) = 'object'),
  created_at timestamptz not null default now(),
  unique (user_id, operation, request_key)
);

-- Private bucket. Objects are uploaded and signed only by the Worker service role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'examination-uploads',
  'examination-uploads',
  false,
  1500000,
  array[
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Immutability and integrity helpers
-- ---------------------------------------------------------------------------

create or replace function public.examination_forbid_published_version_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'published' then
    if tg_op = 'DELETE' then
      raise exception 'EXAM_VERSION_IMMUTABLE';
    end if;
    if new.exam_id is distinct from old.exam_id
      or new.version_number is distinct from old.version_number
      or new.duration_seconds is distinct from old.duration_seconds
      or new.default_timer_mode is distinct from old.default_timer_mode
      or new.allowed_timer_modes is distinct from old.allowed_timer_modes
      or new.grading_route is distinct from old.grading_route
      or new.answer_release_rule is distinct from old.answer_release_rule
      or new.release_at is distinct from old.release_at
      or new.instructions is distinct from old.instructions
      or new.syllabus is distinct from old.syllabus
      or new.question_count is distinct from old.question_count
      or new.snapshot_hash is distinct from old.snapshot_hash
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
    then
      raise exception 'EXAM_VERSION_IMMUTABLE';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

/* Moved after all function definitions so PostgreSQL can revoke exact signatures.
-- ---------------------------------------------------------------------------
-- Least privilege: all examination data is Worker-mediated.
-- No browser role receives direct table, sequence, function, or storage access.
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'examination_questions',
    'examination_definitions',
    'examination_versions',
    'examination_version_questions',
    'examination_beta_access',
    'examination_participants',
    'examination_attempts_multi',
    'examination_responses',
    'examination_submissions',
    'examination_grading_jobs',
    'examination_ai_assessments',
    'examination_examiner_assignments',
    'examination_examiner_reviews',
    'examination_model_releases',
    'examination_uploads',
    'examination_notifications',
    'examination_audit_log',
    'examination_command_receipts'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format(
      'revoke all privileges on table public.%I from public, anon, authenticated',
      v_table
    );
    execute format(
      'grant select, insert, update, delete on table public.%I to service_role',
      v_table
    );
  end loop;
end;
$$;

revoke all privileges on sequence public.examination_audit_log_id_seq
  from public, anon, authenticated;
grant usage, select on sequence public.examination_audit_log_id_seq
  to service_role;

revoke all on function public.examination_forbid_published_version_change()
  from public, anon, authenticated;
revoke all on function public.examination_forbid_published_question_change()
  from public, anon, authenticated;
revoke all on function public.examination_response_belongs_to_version()
  from public, anon, authenticated;
revoke all on function public.examination_safe_metadata(jsonb)
  from public, anon, authenticated;
revoke all on function public.examination_is_admin(uuid)
  from public, anon, authenticated;
revoke all on function public.examination_has_beta_access(uuid)
  from public, anon, authenticated;
revoke all on function public.examination_require_admin(uuid)
  from public, anon, authenticated;
revoke all on function public.examination_require_beta(uuid)
  from public, anon, authenticated;
revoke all on function public.examination_tab_hash(text)
  from public, anon, authenticated;
revoke all on function public.examination_request_hash(jsonb)
  from public, anon, authenticated;
revoke all on function public.examination_attempt_remaining_seconds(
  public.examination_attempts_multi
) from public, anon, authenticated;
revoke all on function public.examination_attempt_summary(
  public.examination_attempts_multi
) from public, anon, authenticated;
revoke all on function public.examination_render_attempt(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.examination_submit_attempt_internal(
  uuid, uuid, text, boolean, text
) from public, anon, authenticated;
revoke all on function public.examination_query(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.examination_command(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.examination_admin(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.examination_register_upload(
  uuid, text, text, text, integer, text, jsonb, text
) from public, anon, authenticated;
revoke all on function public.examination_confirm_upload(
  uuid, uuid, text, text, integer, text, text
) from public, anon, authenticated;
revoke all on function public.examination_store_ai_assessment(
  uuid, uuid, uuid, numeric, jsonb, text, text
) from public, anon, authenticated;
revoke all on function public.examination_fail_ai_job(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.examination_forbid_published_version_change()
  to service_role;
grant execute on function public.examination_forbid_published_question_change()
  to service_role;
grant execute on function public.examination_response_belongs_to_version()
  to service_role;
grant execute on function public.examination_safe_metadata(jsonb)
  to service_role;
grant execute on function public.examination_is_admin(uuid)
  to service_role;
grant execute on function public.examination_has_beta_access(uuid)
  to service_role;
grant execute on function public.examination_require_admin(uuid)
  to service_role;
grant execute on function public.examination_require_beta(uuid)
  to service_role;
grant execute on function public.examination_tab_hash(text)
  to service_role;
grant execute on function public.examination_request_hash(jsonb)
  to service_role;
grant execute on function public.examination_attempt_remaining_seconds(
  public.examination_attempts_multi
) to service_role;
grant execute on function public.examination_attempt_summary(
  public.examination_attempts_multi
) to service_role;
grant execute on function public.examination_render_attempt(uuid, boolean)
  to service_role;
grant execute on function public.examination_submit_attempt_internal(
  uuid, uuid, text, boolean, text
) to service_role;
grant execute on function public.examination_query(uuid, text, jsonb)
  to service_role;
grant execute on function public.examination_command(uuid, text, jsonb)
  to service_role;
grant execute on function public.examination_admin(uuid, text, jsonb)
  to service_role;
grant execute on function public.examination_register_upload(
  uuid, text, text, text, integer, text, jsonb, text
) to service_role;
grant execute on function public.examination_confirm_upload(
  uuid, uuid, text, text, integer, text, text
) to service_role;
grant execute on function public.examination_store_ai_assessment(
  uuid, uuid, uuid, numeric, jsonb, text, text
) to service_role;
grant execute on function public.examination_fail_ai_job(uuid, uuid, text)
  to service_role;

revoke all on storage.objects from anon, authenticated;

commit;
*/

-- ---------------------------------------------------------------------------
-- Worker-only upload registration and AI result persistence
-- ---------------------------------------------------------------------------

create or replace function public.examination_register_upload(
  p_user_id uuid,
  p_object_path text,
  p_safe_file_name text,
  p_mime_type text,
  p_size_bytes integer,
  p_content_hash text,
  p_extracted_questions jsonb,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_upload public.examination_uploads%rowtype;
begin
  perform public.examination_require_beta(p_user_id);
  if p_object_path !~ ('^' || p_user_id::text || '/[0-9a-f]{32,64}/[A-Za-z0-9_.-]+$')
    or p_mime_type not in (
      'text/plain',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    or p_size_bytes not between 1 and 1500000
    or p_content_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_extracted_questions) <> 'array'
    or jsonb_array_length(p_extracted_questions) not between 1 and 20
    or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
  then raise exception 'EXAM_UPLOAD_INVALID'; end if;

  insert into public.examination_uploads (
    owner_user_id, object_path, safe_file_name, mime_type,
    size_bytes, content_hash, status, extracted_questions
  ) values (
    p_user_id, p_object_path, left(p_safe_file_name, 120), p_mime_type,
    p_size_bytes, p_content_hash, 'parsed', p_extracted_questions
  )
  on conflict (owner_user_id, content_hash) do update
    set updated_at = now()
  returning * into v_upload;

  insert into public.examination_audit_log (
    actor_user_id, action, resource_type, resource_id, reason, metadata
  ) values (
    p_user_id, 'upload_parsed', 'examination_upload', v_upload.id::text,
    'Private examination upload parsed for examinee confirmation.',
    jsonb_build_object(
      'mimeType', p_mime_type,
      'sizeBytes', p_size_bytes,
      'questionCount', jsonb_array_length(p_extracted_questions)
    )
  );

  return jsonb_build_object(
    'uploadId', v_upload.id,
    'publicId', v_upload.public_id,
    'status', v_upload.status,
    'fileName', v_upload.safe_file_name,
    'mimeType', v_upload.mime_type,
    'sizeBytes', v_upload.size_bytes,
    'questionCount', jsonb_array_length(v_upload.extracted_questions),
    'questions', v_upload.extracted_questions,
    'retentionUntil', v_upload.retention_until
  );
end;
$$;

create or replace function public.examination_confirm_upload(
  p_user_id uuid,
  p_upload_id uuid,
  p_title text,
  p_timer_mode text,
  p_duration_seconds integer,
  p_grading_route text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_upload public.examination_uploads%rowtype;
  v_exam public.examination_definitions%rowtype;
  v_version public.examination_versions%rowtype;
  v_item jsonb;
  v_question public.examination_questions%rowtype;
  v_ordinal integer := 0;
  v_hash text;
begin
  perform public.examination_require_beta(p_user_id);
  perform pg_advisory_xact_lock(hashtextextended(
    'examination-upload-confirm:' || p_upload_id::text, 0
  ));
  select * into v_upload
  from public.examination_uploads
  where id = p_upload_id and owner_user_id = p_user_id
  for update;
  if v_upload.id is null or v_upload.status in ('failed', 'deleted') then
    raise exception 'EXAM_UPLOAD_NOT_FOUND';
  end if;
  if v_upload.status = 'confirmed' and v_upload.exam_id is not null then
    return (
      select jsonb_build_object(
        'uploadId', v_upload.id,
        'examId', d.id,
        'versionId', d.active_version_id,
        'status', 'confirmed',
        'replayed', true
      )
      from public.examination_definitions d where d.id = v_upload.exam_id
    );
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 180
    or p_timer_mode not in ('strict', 'selfPaced', 'none')
    or p_duration_seconds not between 60 and 14400
    or p_grading_route not in ('human', 'provisional')
    or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
  then raise exception 'EXAM_UPLOAD_INVALID'; end if;

  insert into public.examination_definitions (
    track, assessment_kind, title, owner_user_id, test_only, status, created_by
  ) values (
    'bar_feels', 'uploaded', btrim(p_title), p_user_id, true, 'draft', p_user_id
  ) returning * into v_exam;

  insert into public.examination_versions (
    exam_id, version_number, label, duration_seconds, default_timer_mode,
    allowed_timer_modes, grading_route, answer_release_rule,
    instructions, syllabus, created_by
  ) values (
    v_exam.id, 1, 'Private upload v1', p_duration_seconds, p_timer_mode,
    jsonb_build_array(p_timer_mode), p_grading_route, 'after_human',
    'Answer every essay using ALAC. Review all answers before final submission.',
    '["Private uploaded examination"]'::jsonb, p_user_id
  ) returning * into v_version;

  for v_item in select value from jsonb_array_elements(v_upload.extracted_questions)
  loop
    v_ordinal := v_ordinal + 1;
    v_hash := encode(extensions.digest(
      coalesce(v_item->>'prompt', '') || ':' || v_upload.content_hash || ':' || v_ordinal,
      'sha256'
    ), 'hex');
    insert into public.examination_questions (
      source_key, source_type, owner_user_id, subject, topic, prompt_text,
      review_status, publication_ready, content_hash
    ) values (
      'upload:' || v_upload.id::text || ':' || v_ordinal,
      'uploaded', p_user_id, 'Private Uploaded Examination',
      'Uploaded Question ' || v_ordinal,
      btrim(v_item->>'prompt'),
      'pending', false, v_hash
    )
    returning * into v_question;
    insert into public.examination_version_questions (
      version_id, question_id, ordinal, prompt_snapshot, snapshot_hash
    ) values (
      v_version.id, v_question.id, v_ordinal, v_question.prompt_text, v_hash
    );
  end loop;

  v_hash := encode(extensions.digest(
    v_exam.id::text || ':' || v_version.id::text || ':'
    || v_upload.content_hash || ':' || v_ordinal,
    'sha256'
  ), 'hex');
  update public.examination_versions
  set question_count = v_ordinal,
      snapshot_hash = v_hash,
      status = 'published',
      published_at = now()
  where id = v_version.id
  returning * into v_version;
  update public.examination_definitions
  set status = 'published', active_version_id = v_version.id, updated_at = now()
  where id = v_exam.id
  returning * into v_exam;
  update public.examination_uploads
  set status = 'confirmed', confirmed_at = now(), exam_id = v_exam.id, updated_at = now()
  where id = v_upload.id;
  insert into public.examination_participants (
    version_id, user_id, enabled, granted_by
  ) values (
    v_version.id, p_user_id, true, p_user_id
  ) on conflict (version_id, user_id) do update set enabled = true, updated_at = now();
  insert into public.examination_audit_log (
    actor_user_id, action, resource_type, resource_id, reason, metadata
  ) values (
    p_user_id, 'upload_confirmed', 'examination_upload', v_upload.id::text,
    'Examinee confirmed the extracted private examination.',
    jsonb_build_object(
      'examId', v_exam.id,
      'versionId', v_version.id,
      'questionCount', v_ordinal,
      'gradingRoute', p_grading_route
    )
  );
  return jsonb_build_object(
    'uploadId', v_upload.id,
    'examId', v_exam.id,
    'versionId', v_version.id,
    'status', 'confirmed',
    'questionCount', v_ordinal,
    'replayed', false
  );
end;
$$;

create or replace function public.examination_store_ai_assessment(
  p_user_id uuid,
  p_job_id uuid,
  p_question_id uuid,
  p_score numeric,
  p_assessment jsonb,
  p_grader_model text,
  p_model_answer_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.examination_grading_jobs%rowtype;
  v_attempt public.examination_attempts_multi%rowtype;
  v_version public.examination_versions%rowtype;
  v_expected integer;
  v_completed integer;
begin
  select * into v_job
  from public.examination_grading_jobs
  where id = p_job_id and requested_by = p_user_id
  for update;
  if v_job.id is null then raise exception 'EXAM_GRADING_JOB_NOT_FOUND'; end if;
  if v_job.status in ('failed', 'cancelled') then raise exception 'EXAM_GRADING_JOB_CLOSED'; end if;
  select * into v_attempt
  from public.examination_attempts_multi
  where id = v_job.attempt_id and user_id = p_user_id;
  if v_attempt.id is null then raise exception 'EXAM_ATTEMPT_NOT_FOUND'; end if;
  if not exists (
    select 1 from public.examination_version_questions
    where version_id = v_attempt.version_id and question_id = p_question_id
      and snapshot_hash = p_model_answer_hash
  ) then raise exception 'EXAM_MODEL_NOT_AVAILABLE'; end if;
  if p_score < 0 or p_score > 5
    or round(p_score, 1) <> p_score
    or jsonb_typeof(p_assessment) <> 'object'
    or char_length(btrim(coalesce(p_grader_model, ''))) < 2
  then raise exception 'EXAM_ASSESSMENT_INVALID'; end if;

  update public.examination_grading_jobs
  set status = 'processing', started_at = coalesce(started_at, now())
  where id = v_job.id;
  insert into public.examination_ai_assessments (
    attempt_id, question_id, score, assessment_json,
    grader_model, model_answer_hash
  ) values (
    v_attempt.id, p_question_id, p_score, p_assessment,
    left(p_grader_model, 120), p_model_answer_hash
  )
  on conflict (attempt_id, question_id) do update
    set score = excluded.score,
        assessment_json = excluded.assessment_json,
        grader_model = excluded.grader_model,
        model_answer_hash = excluded.model_answer_hash,
        finalized_at = now();

  select * into v_version
  from public.examination_versions where id = v_attempt.version_id;
  v_expected := v_version.question_count;
  select count(*) into v_completed
  from public.examination_ai_assessments
  where attempt_id = v_attempt.id;
  if v_completed = v_expected then
    update public.examination_grading_jobs
    set status = 'completed', completed_at = now(), safe_error_code = null
    where id = v_job.id;
    if v_version.answer_release_rule = 'after_ai' then
      insert into public.examination_model_releases (
        attempt_id, released_by, release_reason, email_status
      ) values (
        v_attempt.id, null, 'Automatic release after finalized AI Assessment.',
        'not_configured'
      )
      on conflict (attempt_id) do nothing;
      insert into public.examination_notifications (
        user_id, notification_type, recipient, status
      ) values (
        p_user_id, 'model_answers_released', 'authenticated-student', 'not_configured'
      );
    end if;
  end if;
  return jsonb_build_object(
    'jobId', v_job.id,
    'attemptId', v_attempt.id,
    'completedQuestions', v_completed,
    'questionCount', v_expected,
    'status', case when v_completed = v_expected then 'completed' else 'processing' end,
    'modelsReleased', v_completed = v_expected
      and v_version.answer_release_rule = 'after_ai'
  );
end;
$$;

create or replace function public.examination_fail_ai_job(
  p_user_id uuid,
  p_job_id uuid,
  p_safe_error_code text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.examination_grading_jobs
  set status = 'failed',
      completed_at = now(),
      safe_error_code = left(regexp_replace(
        coalesce(p_safe_error_code, 'grading_failed'),
        '[^A-Za-z0-9_-]', '', 'g'
      ), 80)
  where id = p_job_id and requested_by = p_user_id
    and status in ('queued', 'processing');
end;
$$;

-- ---------------------------------------------------------------------------
-- Attempt state helpers
-- ---------------------------------------------------------------------------

create or replace function public.examination_submit_attempt_internal(
  p_attempt_id uuid,
  p_user_id uuid,
  p_request_key text,
  p_automatic boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_attempt public.examination_attempts_multi%rowtype;
  v_submission public.examination_submissions%rowtype;
  v_question_count integer;
  v_answered integer;
  v_flagged integer;
  v_receipt text;
begin
  select * into v_attempt
  from public.examination_attempts_multi
  where id = p_attempt_id and user_id = p_user_id
  for update;
  if v_attempt.id is null then raise exception 'EXAM_ATTEMPT_NOT_FOUND'; end if;

  select * into v_submission
  from public.examination_submissions
  where attempt_id = v_attempt.id;
  if v_submission.id is not null then
    return jsonb_build_object(
      'attemptId', v_attempt.id,
      'status', v_attempt.status,
      'receiptCode', v_submission.receipt_code,
      'submittedAt', v_submission.submitted_at,
      'answeredCount', v_submission.answered_count,
      'flaggedCount', v_submission.flagged_count,
      'questionCount', v_submission.question_count,
      'automatic', v_submission.automatic,
      'replayed', true
    );
  end if;

  if v_attempt.status not in ('in_progress', 'review') then
    raise exception 'EXAM_ATTEMPT_CLOSED';
  end if;

  select count(*),
         count(*) filter (where nullif(btrim(answer_text), '') is not null),
         count(*) filter (where flagged)
  into v_question_count, v_answered, v_flagged
  from public.examination_responses
  where attempt_id = v_attempt.id;
  if v_question_count < 1 then raise exception 'EXAM_PUBLISH_INCOMPLETE'; end if;

  v_receipt := upper(
    'DD-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-')
    || encode(extensions.gen_random_bytes(5), 'hex')
  );

  update public.examination_attempts_multi
  set status = case when p_automatic then 'expired' else 'submitted' end,
      submitted_at = now(),
      submission_reason = left(coalesce(nullif(btrim(p_reason), ''), 'manual'), 120),
      elapsed_seconds = case
        when timer_mode = 'strict' then least(
          floor(extract(epoch from (now() - started_at)))::integer,
          (
            select duration_seconds
            from public.examination_versions where id = v_attempt.version_id
          )
        )
        else greatest(
          elapsed_seconds,
          floor(extract(epoch from (now() - started_at)))::integer
        )
      end,
      last_activity_at = now(),
      updated_at = now()
  where id = v_attempt.id
  returning * into v_attempt;

  insert into public.examination_submissions (
    attempt_id, user_id, request_key, receipt_code,
    answered_count, flagged_count, question_count, automatic
  ) values (
    v_attempt.id, p_user_id, p_request_key, v_receipt,
    v_answered, v_flagged, v_question_count, p_automatic
  )
  returning * into v_submission;

  insert into public.examination_audit_log (
    actor_user_id, action, resource_type, resource_id, reason, metadata
  ) values (
    p_user_id,
    case when p_automatic then 'attempt_auto_submitted' else 'attempt_submitted' end,
    'examination_attempt',
    v_attempt.id::text,
    p_reason,
    jsonb_build_object(
      'answeredCount', v_answered,
      'flaggedCount', v_flagged,
      'questionCount', v_question_count
    )
  );

  return jsonb_build_object(
    'attemptId', v_attempt.id,
    'status', v_attempt.status,
    'receiptCode', v_submission.receipt_code,
    'submittedAt', v_submission.submitted_at,
    'answeredCount', v_submission.answered_count,
    'flaggedCount', v_submission.flagged_count,
    'questionCount', v_submission.question_count,
    'automatic', v_submission.automatic,
    'replayed', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Authenticated and token-authorized commands
-- ---------------------------------------------------------------------------

create or replace function public.examination_command(
  p_user_id uuid,
  p_operation text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_operation text := lower(btrim(coalesce(p_operation, '')));
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_request_key text := btrim(coalesce(v_payload->>'requestKey', ''));
  v_request_hash text := public.examination_request_hash(v_payload);
  v_existing public.examination_command_receipts%rowtype;
  v_attempt public.examination_attempts_multi%rowtype;
  v_version public.examination_versions%rowtype;
  v_definition public.examination_definitions%rowtype;
  v_response public.examination_responses%rowtype;
  v_assignment public.examination_examiner_assignments%rowtype;
  v_review public.examination_examiner_reviews%rowtype;
  v_tab_hash text;
  v_token_hash text;
  v_question_id uuid;
  v_expected_revision integer;
  v_now timestamptz := now();
  v_result jsonb;
  v_job public.examination_grading_jobs%rowtype;
  v_question_count integer;
  v_model_count integer;
  v_object_path text;
begin
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'EXAM_COMMAND_INVALID';
  end if;

  -- Secure assignment links are capability-authorized and deliberately do not
  -- require the examiner to possess a Due Diligence student account.
  if v_operation in (
    'claim_examiner_assignment',
    'save_examiner_review',
    'finalize_examiner_review'
  ) then
    v_token_hash := public.examination_tab_hash(v_payload->>'assignmentToken');
    select * into v_assignment
    from public.examination_examiner_assignments
    where token_hash = v_token_hash
    for update;
    if v_assignment.id is null then raise exception 'EXAM_ASSIGNMENT_NOT_FOUND'; end if;
    if v_assignment.status in ('expired', 'revoked')
      or (v_assignment.expires_at <= v_now and v_assignment.status <> 'finalized')
    then
      update public.examination_examiner_assignments
      set status = 'expired', updated_at = v_now
      where id = v_assignment.id and status in ('pending', 'claimed');
      raise exception 'EXAM_ASSIGNMENT_EXPIRED';
    end if;
    if v_assignment.status = 'finalized' then
      raise exception 'EXAM_ASSIGNMENT_FINALIZED';
    end if;

    if v_operation = 'claim_examiner_assignment' then
      update public.examination_examiner_assignments
      set status = 'claimed',
          claimed_at = coalesce(claimed_at, v_now),
          updated_at = v_now
      where id = v_assignment.id
      returning * into v_assignment;
      return jsonb_build_object(
        'assignmentId', v_assignment.public_id,
        'status', v_assignment.status,
        'claimedAt', v_assignment.claimed_at,
        'expiresAt', v_assignment.expires_at
      );
    end if;

    if v_operation = 'save_examiner_review' then
      v_question_id := (v_payload->>'questionId')::uuid;
      if not exists (
        select 1
        from public.examination_attempts_multi a
        join public.examination_version_questions vq
          on vq.version_id = a.version_id
         and vq.question_id = v_question_id
        where a.id = v_assignment.attempt_id
      ) then raise exception 'EXAM_QUESTION_NOT_IN_VERSION'; end if;
      v_expected_revision := greatest(0, coalesce((v_payload->>'expectedRevision')::integer, 0));
      select * into v_review
      from public.examination_examiner_reviews
      where assignment_id = v_assignment.id and question_id = v_question_id
      for update;
      if v_review.assignment_id is null then
        if v_expected_revision <> 0 then raise exception 'EXAM_RESPONSE_CONFLICT'; end if;
        insert into public.examination_examiner_reviews (
          assignment_id, question_id, score, comments, revision
        ) values (
          v_assignment.id,
          v_question_id,
          round((v_payload->>'score')::numeric, 1),
          left(coalesce(v_payload->>'comments', ''), 8000),
          1
        )
        returning * into v_review;
      else
        if v_review.revision <> v_expected_revision then
          raise exception 'EXAM_RESPONSE_CONFLICT';
        end if;
        update public.examination_examiner_reviews
        set score = round((v_payload->>'score')::numeric, 1),
            comments = left(coalesce(v_payload->>'comments', ''), 8000),
            revision = revision + 1,
            saved_at = v_now
        where assignment_id = v_assignment.id and question_id = v_question_id
        returning * into v_review;
      end if;
      update public.examination_examiner_assignments
      set status = 'claimed',
          claimed_at = coalesce(claimed_at, v_now),
          updated_at = v_now
      where id = v_assignment.id;
      return jsonb_build_object(
        'questionId', v_review.question_id,
        'score', v_review.score,
        'comments', v_review.comments,
        'revision', v_review.revision,
        'savedAt', v_review.saved_at
      );
    end if;

    if v_operation = 'finalize_examiner_review' then
      v_expected_revision := greatest(0, coalesce((v_payload->>'expectedRevision')::integer, 0));
      select count(*) into v_question_count
      from public.examination_version_questions vq
      join public.examination_attempts_multi a on a.version_id = vq.version_id
      where a.id = v_assignment.attempt_id;
      if (
        select count(*) from public.examination_examiner_reviews
        where assignment_id = v_assignment.id
      ) <> v_question_count then
        raise exception 'EXAM_PUBLISH_INCOMPLETE';
      end if;
      if v_expected_revision <> (
        select coalesce(sum(revision), 0)
        from public.examination_examiner_reviews
        where assignment_id = v_assignment.id
      ) then raise exception 'EXAM_RESPONSE_CONFLICT'; end if;

      update public.examination_examiner_reviews
      set finalized_at = v_now
      where assignment_id = v_assignment.id;
      update public.examination_examiner_assignments
      set status = 'finalized', finalized_at = v_now, updated_at = v_now
      where id = v_assignment.id
      returning * into v_assignment;

      insert into public.examination_notifications (
        user_id, assignment_id, notification_type, recipient, status
      )
      select a.user_id, v_assignment.id, 'human_review_finalized',
             'authenticated-student', 'not_configured'
      from public.examination_attempts_multi a
      where a.id = v_assignment.attempt_id;

      insert into public.examination_model_releases (
        attempt_id, released_by, release_reason, email_status
      )
      select v_assignment.attempt_id, null,
             'Automatic release after finalized Human Examiner Review.',
             'not_configured'
      from public.examination_attempts_multi a
      join public.examination_versions ev on ev.id = a.version_id
      where a.id = v_assignment.attempt_id
        and ev.answer_release_rule = 'after_human'
      on conflict (attempt_id) do nothing;

      insert into public.examination_audit_log (
        actor_user_id, action, resource_type, resource_id, reason, metadata
      ) values (
        null, 'human_review_finalized', 'examiner_assignment',
        v_assignment.id::text, 'Examiner confirmed final structured review.',
        jsonb_build_object('questionCount', v_question_count)
      );
      return jsonb_build_object(
        'assignmentId', v_assignment.public_id,
        'status', v_assignment.status,
        'finalizedAt', v_assignment.finalized_at,
        'studentNotificationStatus', 'not_configured'
      );
    end if;
  end if;

  perform public.examination_require_beta(p_user_id);

  if nullif(v_request_key, '') is not null then
    select * into v_existing
    from public.examination_command_receipts
    where user_id = p_user_id
      and operation = v_operation
      and request_key = v_request_key;
    if v_existing.id is not null then
      if v_existing.request_hash <> v_request_hash then
        raise exception 'EXAM_SUBMISSION_CONFLICT';
      end if;
      return v_existing.response_json || jsonb_build_object('replayed', true);
    end if;
  end if;

  if v_operation = 'start_attempt' then
    select * into v_version
    from public.examination_versions
    where id = (v_payload->>'versionId')::uuid and status = 'published';
    if v_version.id is null then raise exception 'EXAM_VERSION_NOT_FOUND'; end if;
    select * into v_definition
    from public.examination_definitions
    where id = v_version.exam_id and status = 'published';
    if v_definition.id is null
      or (v_definition.available_from is not null and v_definition.available_from > v_now)
      or (v_definition.available_until is not null and v_definition.available_until <= v_now)
    then raise exception 'EXAM_NOT_AVAILABLE'; end if;
    if not (
      v_definition.owner_user_id = p_user_id
      or public.examination_is_admin(p_user_id)
      or exists (
        select 1 from public.examination_participants ep
        where ep.version_id = v_version.id and ep.user_id = p_user_id and ep.enabled
      )
      or (
        v_definition.assessment_kind <> 'uploaded'
        and public.examination_has_beta_access(p_user_id)
      )
    ) then raise exception 'EXAM_NOT_AVAILABLE'; end if;
    if not (v_version.allowed_timer_modes ? (v_payload->>'timerMode')) then
      raise exception 'EXAM_TIMER_MODE_LOCKED';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(
      'examination-start:' || p_user_id::text || ':' || v_version.id::text, 0
    ));
    select * into v_attempt
    from public.examination_attempts_multi
    where user_id = p_user_id and version_id = v_version.id
      and status in ('in_progress', 'review')
    for update;
    v_tab_hash := public.examination_tab_hash(v_payload->>'tabToken');
    if v_attempt.id is not null then
      if v_attempt.active_tab_hash <> v_tab_hash and v_attempt.tab_lease_until > v_now then
        raise exception 'EXAM_SECOND_TAB_BLOCKED';
      end if;
      update public.examination_attempts_multi
      set active_tab_hash = v_tab_hash,
          tab_lease_until = v_now + interval '90 seconds',
          last_heartbeat_at = v_now,
          updated_at = v_now
      where id = v_attempt.id
      returning * into v_attempt;
      v_result := public.examination_render_attempt(v_attempt.id, true)
        || jsonb_build_object('resumed', true);
    else
      insert into public.examination_attempts_multi (
        user_id, version_id, timer_mode, deadline_at, active_tab_hash,
        tab_lease_until, start_request_key, grading_entitlement_reserved,
        grading_entitlement_reference
      ) values (
        p_user_id,
        v_version.id,
        v_payload->>'timerMode',
        case when v_payload->>'timerMode' = 'strict'
          then v_now + make_interval(secs => v_version.duration_seconds)
          else null end,
        v_tab_hash,
        v_now + interval '90 seconds',
        v_request_key,
        true,
        'beta-examination-access'
      )
      returning * into v_attempt;
      insert into public.examination_responses (attempt_id, question_id)
      select v_attempt.id, question_id
      from public.examination_version_questions
      where version_id = v_version.id
      order by ordinal;
      insert into public.examination_audit_log (
        actor_user_id, action, resource_type, resource_id, reason, metadata
      ) values (
        p_user_id, 'attempt_started', 'examination_attempt', v_attempt.id::text,
        'Examinee confirmed Begin Examination.',
        jsonb_build_object(
          'timerMode', v_attempt.timer_mode,
          'versionId', v_version.id,
          'questionCount', v_version.question_count
        )
      );
      v_result := public.examination_render_attempt(v_attempt.id, true)
        || jsonb_build_object('resumed', false);
    end if;

  elsif v_operation in ('heartbeat', 'save_response', 'flag_response') then
    select * into v_attempt
    from public.examination_attempts_multi
    where id = (v_payload->>'attemptId')::uuid and user_id = p_user_id
    for update;
    if v_attempt.id is null then raise exception 'EXAM_ATTEMPT_NOT_FOUND'; end if;
    if v_attempt.status not in ('in_progress', 'review') then
      raise exception 'EXAM_ATTEMPT_CLOSED';
    end if;
    v_tab_hash := public.examination_tab_hash(v_payload->>'tabToken');

    if v_attempt.active_tab_hash <> v_tab_hash then
      if v_attempt.tab_lease_until > v_now
        or coalesce((v_payload->>'takeover')::boolean, false) is not true
      then raise exception 'EXAM_SECOND_TAB_BLOCKED'; end if;
      v_attempt.active_tab_hash := v_tab_hash;
    end if;

    if v_attempt.timer_mode = 'strict' and v_attempt.deadline_at <= v_now then
      v_result := public.examination_submit_attempt_internal(
        v_attempt.id,
        p_user_id,
        'expiry-' || replace(v_attempt.id::text, '-', ''),
        true,
        'Strict Scrutiny overall time expired.'
      );
      return v_result || jsonb_build_object('expired', true);
    end if;

    update public.examination_attempts_multi
    set active_tab_hash = v_tab_hash,
        tab_lease_until = v_now + interval '90 seconds',
        elapsed_seconds = case
          when timer_mode = 'selfPaced'
          then greatest(
            elapsed_seconds,
            floor(extract(epoch from (v_now - started_at)))::integer
          )
          when timer_mode = 'strict'
          then floor(extract(epoch from (v_now - started_at)))::integer
          else elapsed_seconds
        end,
        last_heartbeat_at = v_now,
        last_activity_at = case when v_operation <> 'heartbeat'
          then v_now else last_activity_at end,
        updated_at = v_now
    where id = v_attempt.id
    returning * into v_attempt;

    if v_operation = 'heartbeat' then
      return public.examination_attempt_summary(v_attempt)
        || jsonb_build_object('takeoverAccepted', v_attempt.active_tab_hash = v_tab_hash);
    end if;

    v_question_id := (v_payload->>'questionId')::uuid;
    v_expected_revision := greatest(0, coalesce((v_payload->>'expectedRevision')::integer, 0));
    select * into v_response
    from public.examination_responses
    where attempt_id = v_attempt.id and question_id = v_question_id
    for update;
    if v_response.attempt_id is null then raise exception 'EXAM_QUESTION_NOT_IN_VERSION'; end if;
    if v_response.revision <> v_expected_revision then
      raise exception 'EXAM_RESPONSE_CONFLICT';
    end if;
    update public.examination_responses
    set answer_text = case when v_operation = 'save_response'
          then left(coalesce(v_payload->>'answerText', ''), 20000)
          else answer_text end,
        flagged = coalesce((v_payload->>'flagged')::boolean, flagged),
        revision = revision + 1,
        saved_at = v_now
    where attempt_id = v_attempt.id and question_id = v_question_id
    returning * into v_response;
    return jsonb_build_object(
      'attemptId', v_attempt.id,
      'questionId', v_response.question_id,
      'answerText', v_response.answer_text,
      'flagged', v_response.flagged,
      'revision', v_response.revision,
      'savedAt', v_response.saved_at,
      'remainingSeconds', public.examination_attempt_remaining_seconds(v_attempt)
    );

  elsif v_operation = 'submit_attempt' then
    select * into v_attempt
    from public.examination_attempts_multi
    where id = (v_payload->>'attemptId')::uuid and user_id = p_user_id
    for update;
    if v_attempt.id is null then raise exception 'EXAM_ATTEMPT_NOT_FOUND'; end if;
    v_tab_hash := public.examination_tab_hash(v_payload->>'tabToken');
    if v_attempt.active_tab_hash <> v_tab_hash and v_attempt.tab_lease_until > v_now then
      raise exception 'EXAM_SECOND_TAB_BLOCKED';
    end if;
    v_result := public.examination_submit_attempt_internal(
      v_attempt.id, p_user_id, v_request_key, false, 'Confirmed manual submission.'
    );

  elsif v_operation = 'request_ai_grading' then
    select * into v_attempt
    from public.examination_attempts_multi
    where id = (v_payload->>'attemptId')::uuid and user_id = p_user_id;
    if v_attempt.id is null then raise exception 'EXAM_ATTEMPT_NOT_FOUND'; end if;
    if v_attempt.status not in ('submitted', 'expired') then
      raise exception 'EXAM_ATTEMPT_CLOSED';
    end if;
    select * into v_version
    from public.examination_versions where id = v_attempt.version_id;
    if v_version.grading_route not in ('ai', 'either') then
      raise exception 'EXAM_MODEL_NOT_AVAILABLE';
    end if;
    select count(*), count(*) filter (
      where nullif(btrim(model_answer_snapshot), '') is not null
        and nullif(btrim(legal_basis_snapshot), '') is not null
    )
    into v_question_count, v_model_count
    from public.examination_version_questions
    where version_id = v_attempt.version_id;
    if v_question_count = 0 or v_model_count <> v_question_count then
      raise exception 'EXAM_MODEL_NOT_AVAILABLE';
    end if;
    insert into public.examination_grading_jobs (
      attempt_id, route, request_key, requested_by
    ) values (
      v_attempt.id, 'ai', v_request_key, p_user_id
    )
    on conflict (attempt_id, route) do update
      set request_key = public.examination_grading_jobs.request_key,
          status = case
            when public.examination_grading_jobs.status = 'failed' then 'queued'
            else public.examination_grading_jobs.status
          end,
          safe_error_code = case
            when public.examination_grading_jobs.status = 'failed' then null
            else public.examination_grading_jobs.safe_error_code
          end,
          completed_at = case
            when public.examination_grading_jobs.status = 'failed' then null
            else public.examination_grading_jobs.completed_at
          end
    returning * into v_job;
    v_result := jsonb_build_object(
      'jobId', v_job.id,
      'attemptId', v_attempt.id,
      'status', v_job.status,
      'questions', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'questionId', vq.question_id,
            'ordinal', vq.ordinal,
            'subject', (
              select d.subject
              from public.examination_definitions d
              where d.id = v_version.exam_id
            ),
            'prompt', vq.prompt_snapshot,
            'studentAnswer', r.answer_text,
            'modelAnswer', vq.model_answer_snapshot,
            'legalBasis', vq.legal_basis_snapshot,
            'application', vq.application_snapshot,
            'conclusion', vq.conclusion_snapshot,
            'jurisprudence', vq.jurisprudence_snapshot,
            'citation', vq.citation_snapshot,
            'governingProvision', vq.governing_provision_snapshot,
            'sourceUrls', vq.source_urls_snapshot,
            'modelAnswerHash', vq.snapshot_hash
          )
          order by vq.ordinal
        )
        from public.examination_version_questions vq
        join public.examination_responses r
          on r.attempt_id = v_attempt.id and r.question_id = vq.question_id
        where vq.version_id = v_attempt.version_id
          and not exists (
            select 1
            from public.examination_ai_assessments completed
            where completed.attempt_id = v_attempt.id
              and completed.question_id = vq.question_id
          )
      ), '[]'::jsonb)
    );

  elsif v_operation = 'create_examiner_assignment' then
    select * into v_attempt
    from public.examination_attempts_multi
    where id = (v_payload->>'attemptId')::uuid and user_id = p_user_id;
    if v_attempt.id is null then raise exception 'EXAM_ATTEMPT_NOT_FOUND'; end if;
    if v_attempt.status not in ('submitted', 'expired') then
      raise exception 'EXAM_ATTEMPT_CLOSED';
    end if;
    v_token_hash := public.examination_tab_hash(v_payload->>'assignmentToken');
    insert into public.examination_examiner_assignments (
      attempt_id, examiner_email, token_hash, expires_at, created_by
    ) values (
      v_attempt.id,
      lower(v_payload->>'examinerEmail'),
      v_token_hash,
      v_now + interval '7 days',
      p_user_id
    )
    returning * into v_assignment;
    v_result := jsonb_build_object(
      'assignmentId', v_assignment.public_id,
      'attemptId', v_attempt.id,
      'status', v_assignment.status,
      'expiresAt', v_assignment.expires_at,
      'invitationStatus', v_assignment.invitation_status
    );

  elsif v_operation = 'release_model_answers' then
    select * into v_attempt
    from public.examination_attempts_multi
    where id = (v_payload->>'attemptId')::uuid and user_id = p_user_id;
    if v_attempt.id is null then raise exception 'EXAM_ATTEMPT_NOT_FOUND'; end if;
    select * into v_version
    from public.examination_versions where id = v_attempt.version_id;
    if not (
      (v_version.answer_release_rule = 'after_ai' and exists (
        select 1 from public.examination_grading_jobs
        where attempt_id = v_attempt.id and route = 'ai' and status = 'completed'
      ))
      or (v_version.answer_release_rule = 'after_human' and exists (
        select 1 from public.examination_examiner_assignments
        where attempt_id = v_attempt.id and status = 'finalized'
      ))
      or (
        v_version.answer_release_rule = 'scheduled'
        and v_version.release_at is not null and v_version.release_at <= v_now
      )
    ) then raise exception 'EXAM_MODEL_NOT_AVAILABLE'; end if;
    insert into public.examination_model_releases (
      attempt_id, released_by, release_reason, email_status
    ) values (
      v_attempt.id, p_user_id, v_payload->>'reason', 'not_configured'
    )
    on conflict (attempt_id) do nothing;
    v_result := jsonb_build_object(
      'attemptId', v_attempt.id,
      'released', true,
      'emailStatus', (
        select email_status from public.examination_model_releases
        where attempt_id = v_attempt.id
      )
    );

  elsif v_operation = 'confirm_upload' then
    v_result := public.examination_confirm_upload(
      p_user_id,
      (v_payload->>'uploadId')::uuid,
      v_payload->>'title',
      v_payload->>'timerMode',
      (v_payload->>'durationSeconds')::integer,
      v_payload->>'gradingRoute',
      v_request_key
    );

  elsif v_operation = 'delete_upload' then
    update public.examination_uploads
    set status = 'deleted', deleted_at = v_now, updated_at = v_now
    where id = (v_payload->>'uploadId')::uuid
      and owner_user_id = p_user_id
      and deleted_at is null
    returning object_path into v_object_path;
    if v_object_path is null then raise exception 'EXAM_UPLOAD_NOT_FOUND'; end if;
    v_result := jsonb_build_object(
      'uploadId', v_payload->>'uploadId',
      'objectPath', v_object_path,
      'deleted', true
    );
  else
    raise exception 'EXAM_COMMAND_INVALID';
  end if;

  if nullif(v_request_key, '') is not null then
    insert into public.examination_command_receipts (
      user_id, operation, request_key, request_hash, response_json
    ) values (
      p_user_id, v_operation, v_request_key, v_request_hash, v_result
    )
    on conflict (user_id, operation, request_key) do nothing;
  end if;
  return v_result;
exception
  when unique_violation then
    if v_operation = 'create_examiner_assignment' then
      raise exception 'EXAM_ASSIGNMENT_ACTIVE';
    end if;
    raise;
  when invalid_text_representation or numeric_value_out_of_range
    or check_violation then
    raise exception 'EXAM_COMMAND_INVALID';
end;
$$;

drop trigger if exists examination_forbid_published_version_change_trigger
  on public.examination_versions;
create trigger examination_forbid_published_version_change_trigger
before update or delete on public.examination_versions
for each row execute function public.examination_forbid_published_version_change();

create or replace function public.examination_forbid_published_question_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version_id uuid := coalesce(new.version_id, old.version_id);
begin
  if exists (
    select 1 from public.examination_versions
    where id = v_version_id and status = 'published'
  ) then
    raise exception 'EXAM_VERSION_IMMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists examination_forbid_published_question_change_trigger
  on public.examination_version_questions;
create trigger examination_forbid_published_question_change_trigger
before insert or update or delete on public.examination_version_questions
for each row execute function public.examination_forbid_published_question_change();

create or replace function public.examination_response_belongs_to_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.examination_attempts_multi a
    join public.examination_version_questions vq
      on vq.version_id = a.version_id
     and vq.question_id = new.question_id
    where a.id = new.attempt_id
  ) then
    raise exception 'EXAM_QUESTION_NOT_IN_VERSION';
  end if;
  return new;
end;
$$;

drop trigger if exists examination_response_belongs_to_version_trigger
  on public.examination_responses;
create trigger examination_response_belongs_to_version_trigger
before insert or update on public.examination_responses
for each row execute function public.examination_response_belongs_to_version();

create or replace function public.examination_safe_metadata(p_value jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  with recursive walk(value) as (
    select coalesce(p_value, '{}'::jsonb)
    union all
    select child.value
    from walk
    cross join lateral (
      select value from jsonb_each(walk.value)
      where jsonb_typeof(walk.value) = 'object'
      union all
      select value from jsonb_array_elements(walk.value)
      where jsonb_typeof(walk.value) = 'array'
    ) child
  ),
  keys(key) as (
    select lower(k)
    from walk
    cross join lateral jsonb_object_keys(walk.value) k
    where jsonb_typeof(walk.value) = 'object'
  )
  select not exists (
    select 1 from keys
    where key in (
      'answer_text', 'student_answer', 'raw_ip', 'ip', 'ip_address',
      'email', 'token', 'access_token', 'refresh_token', 'api_key',
      'service_role_key', 'password', 'authorization'
    )
  );
$$;

alter table public.examination_audit_log
  drop constraint if exists examination_audit_safe_metadata_check;
alter table public.examination_audit_log
  add constraint examination_audit_safe_metadata_check
  check (public.examination_safe_metadata(metadata));

-- ---------------------------------------------------------------------------
-- Authorization and rendering helpers
-- ---------------------------------------------------------------------------

create or replace function public.examination_is_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = p_user_id
      and role in ('founder_admin', 'super_admin')
  );
$$;

create or replace function public.examination_has_beta_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.examination_is_admin(p_user_id)
    or exists (
      select 1
      from public.examination_beta_access
      where user_id = p_user_id
        and enabled
        and (expires_at is null or expires_at > now())
    );
$$;

create or replace function public.examination_require_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null or not public.examination_is_admin(p_user_id) then
    raise exception 'EXAM_ADMIN_REQUIRED';
  end if;
end;
$$;

create or replace function public.examination_require_beta(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null or not public.examination_has_beta_access(p_user_id) then
    raise exception 'EXAM_BETA_ACCESS_REQUIRED';
  end if;
end;
$$;

create or replace function public.examination_tab_hash(p_tab_token text)
returns text
language sql
immutable
security definer
set search_path = public, extensions, pg_temp
as $$
  select encode(extensions.digest(coalesce(p_tab_token, ''), 'sha256'), 'hex');
$$;

create or replace function public.examination_request_hash(p_payload jsonb)
returns text
language sql
immutable
security definer
set search_path = public, extensions, pg_temp
as $$
  select encode(extensions.digest(coalesce(p_payload, '{}'::jsonb)::text, 'sha256'), 'hex');
$$;

create or replace function public.examination_attempt_remaining_seconds(
  p_attempt public.examination_attempts_multi
)
returns integer
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when p_attempt.timer_mode <> 'strict' or p_attempt.deadline_at is null then null
    else greatest(0, floor(extract(epoch from (p_attempt.deadline_at - now())))::integer)
  end;
$$;

create or replace function public.examination_attempt_summary(
  p_attempt public.examination_attempts_multi
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'attemptId', p_attempt.id,
    'publicId', p_attempt.public_id,
    'versionId', p_attempt.version_id,
    'status', p_attempt.status,
    'timerMode', p_attempt.timer_mode,
    'startedAt', p_attempt.started_at,
    'deadlineAt', p_attempt.deadline_at,
    'submittedAt', p_attempt.submitted_at,
    'lastSavedAt', p_attempt.last_activity_at,
    'elapsedSeconds', case
      when p_attempt.timer_mode = 'selfPaced'
        and p_attempt.status in ('in_progress', 'review')
      then greatest(
        p_attempt.elapsed_seconds,
        floor(extract(epoch from (now() - p_attempt.started_at)))::integer
      )
      else p_attempt.elapsed_seconds
    end,
    'remainingSeconds', public.examination_attempt_remaining_seconds(p_attempt),
    'tabLeaseUntil', p_attempt.tab_lease_until,
    'counts', jsonb_build_object(
      'answered', (
        select count(*) from public.examination_responses r
        where r.attempt_id = p_attempt.id and nullif(btrim(r.answer_text), '') is not null
      ),
      'flagged', (
        select count(*) from public.examination_responses r
        where r.attempt_id = p_attempt.id and r.flagged
      ),
      'total', (
        select count(*) from public.examination_responses r
        where r.attempt_id = p_attempt.id
      )
    )
  );
$$;

create or replace function public.examination_render_attempt(
  p_attempt_id uuid,
  p_include_answers boolean default true
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'attempt', public.examination_attempt_summary(a),
    'examination', jsonb_build_object(
      'examId', d.id,
      'publicId', d.public_id,
      'track', d.track,
      'assessmentKind', d.assessment_kind,
      'title', d.title,
      'subject', d.subject,
      'testOnly', d.test_only,
      'versionId', v.id,
      'versionLabel', v.label,
      'durationSeconds', v.duration_seconds,
      'instructions', v.instructions,
      'syllabus', v.syllabus,
      'gradingRoute', v.grading_route,
      'answerReleaseRule', v.answer_release_rule,
      'questionCount', v.question_count
    ),
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'questionId', vq.question_id,
          'ordinal', vq.ordinal,
          'prompt', vq.prompt_snapshot,
          'answerText', case when p_include_answers then r.answer_text else '' end,
          'flagged', r.flagged,
          'revision', r.revision,
          'savedAt', r.saved_at,
          'wordCount', case
            when nullif(btrim(r.answer_text), '') is null then 0
            else array_length(regexp_split_to_array(btrim(r.answer_text), '\s+'), 1)
          end
        )
        order by vq.ordinal
      )
      from public.examination_version_questions vq
      join public.examination_responses r
        on r.attempt_id = a.id and r.question_id = vq.question_id
      where vq.version_id = a.version_id
    ), '[]'::jsonb)
  )
  from public.examination_attempts_multi a
  join public.examination_versions v on v.id = a.version_id
  join public.examination_definitions d on d.id = v.exam_id
  where a.id = p_attempt_id;
$$;

-- ---------------------------------------------------------------------------
-- Authenticated reads. Model answers remain sealed until a release row exists.
-- ---------------------------------------------------------------------------

create or replace function public.examination_query(
  p_user_id uuid,
  p_operation text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation text := lower(btrim(coalesce(p_operation, '')));
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_attempt public.examination_attempts_multi%rowtype;
  v_version public.examination_versions%rowtype;
  v_assignment public.examination_examiner_assignments%rowtype;
  v_token_hash text;
  v_limit integer := least(100, greatest(1, coalesce((v_payload->>'limit')::integer, 30)));
  v_offset integer := least(10000, greatest(0, coalesce((v_payload->>'offset')::integer, 0)));
begin
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'EXAM_QUERY_INVALID';
  end if;

  if v_operation = 'assignment' then
    v_token_hash := public.examination_tab_hash(v_payload->>'assignmentToken');
    select * into v_assignment
    from public.examination_examiner_assignments
    where token_hash = v_token_hash;
    if v_assignment.id is null then raise exception 'EXAM_ASSIGNMENT_NOT_FOUND'; end if;
    if v_assignment.status in ('expired', 'revoked')
      or (v_assignment.expires_at <= now() and v_assignment.status <> 'finalized')
    then
      update public.examination_examiner_assignments
      set status = 'expired', updated_at = now()
      where id = v_assignment.id and status in ('pending', 'claimed');
      raise exception 'EXAM_ASSIGNMENT_EXPIRED';
    end if;
    select * into v_attempt
    from public.examination_attempts_multi
    where id = v_assignment.attempt_id;
    return jsonb_build_object(
      'assignment', jsonb_build_object(
        'assignmentId', v_assignment.public_id,
        'status', v_assignment.status,
        'expiresAt', v_assignment.expires_at,
        'finalizedAt', v_assignment.finalized_at
      ),
      'examination', (
        select jsonb_build_object(
          'title', d.title,
          'subject', d.subject,
          'assessmentKind', d.assessment_kind,
          'questionCount', ev.question_count
        )
        from public.examination_versions ev
        join public.examination_definitions d on d.id = ev.exam_id
        where ev.id = v_attempt.version_id
      ),
      'questions', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'questionId', vq.question_id,
            'ordinal', vq.ordinal,
            'prompt', vq.prompt_snapshot,
            'answerText', r.answer_text,
            'score', er.score,
            'comments', er.comments,
            'revision', coalesce(er.revision, 0),
            'finalizedAt', er.finalized_at
          )
          order by vq.ordinal
        )
        from public.examination_version_questions vq
        join public.examination_responses r
          on r.attempt_id = v_attempt.id and r.question_id = vq.question_id
        left join public.examination_examiner_reviews er
          on er.assignment_id = v_assignment.id and er.question_id = vq.question_id
        where vq.version_id = v_attempt.version_id
      ), '[]'::jsonb)
    );
  end if;

  perform public.examination_require_beta(p_user_id);

  if v_operation = 'catalog' then
    return jsonb_build_object(
      'betaAccess', true,
      'isAdmin', public.examination_is_admin(p_user_id),
      'items', coalesce((
        select jsonb_agg(item order by item->>'subject', item->>'title')
        from (
          select jsonb_build_object(
            'examId', d.id,
            'publicId', d.public_id,
            'track', d.track,
            'assessmentKind', d.assessment_kind,
            'title', d.title,
            'subject', d.subject,
            'yearLevel', d.year_level,
            'semester', d.semester,
            'testOnly', d.test_only,
            'availableFrom', d.available_from,
            'availableUntil', d.available_until,
            'versionId', v.id,
            'versionLabel', v.label,
            'questionCount', v.question_count,
            'durationSeconds', v.duration_seconds,
            'timerMode', v.default_timer_mode,
            'allowedTimerModes', v.allowed_timer_modes,
            'gradingRoute', v.grading_route,
            'answerReleaseRule', v.answer_release_rule,
            'syllabus', v.syllabus,
            'resumableAttemptId', a.id,
            'resumableStatus', a.status
          ) item
          from public.examination_definitions d
          join public.examination_versions v on v.id = d.active_version_id
          left join lateral (
            select id, status
            from public.examination_attempts_multi
            where user_id = p_user_id
              and version_id = v.id
              and status in ('in_progress', 'review')
            limit 1
          ) a on true
          where d.status = 'published'
            and v.status = 'published'
            and (v_payload->>'track' is null or d.track = v_payload->>'track')
            and (d.available_from is null or d.available_from <= now())
            and (d.available_until is null or d.available_until > now())
            and (
              d.owner_user_id = p_user_id
              or public.examination_is_admin(p_user_id)
              or exists (
                select 1 from public.examination_participants ep
                where ep.version_id = v.id and ep.user_id = p_user_id and ep.enabled
              )
              or (
                d.assessment_kind <> 'uploaded'
                and public.examination_has_beta_access(p_user_id)
              )
            )
        ) catalog
      ), '[]'::jsonb)
    );

  elsif v_operation = 'setup' then
    select * into v_version
    from public.examination_versions
    where id = (v_payload->>'versionId')::uuid
      and status = 'published';
    if v_version.id is null then raise exception 'EXAM_VERSION_NOT_FOUND'; end if;
    if not exists (
      select 1
      from public.examination_definitions d
      where d.id = v_version.exam_id
        and d.status = 'published'
        and (d.available_from is null or d.available_from <= now())
        and (d.available_until is null or d.available_until > now())
        and (
          d.owner_user_id = p_user_id
          or public.examination_is_admin(p_user_id)
          or exists (
            select 1 from public.examination_participants ep
            where ep.version_id = v_version.id
              and ep.user_id = p_user_id and ep.enabled
          )
          or (
            d.assessment_kind <> 'uploaded'
            and public.examination_has_beta_access(p_user_id)
          )
        )
    ) then raise exception 'EXAM_NOT_AVAILABLE'; end if;
    return (
      select jsonb_build_object(
        'examId', d.id,
        'publicId', d.public_id,
        'versionId', v_version.id,
        'track', d.track,
        'assessmentKind', d.assessment_kind,
        'title', d.title,
        'subject', d.subject,
        'source', case
          when d.assessment_kind = 'uploaded' then 'Authorized private upload'
          else 'Due Diligence curated question bank'
        end,
        'testOnly', d.test_only,
        'questionCount', v_version.question_count,
        'durationSeconds', v_version.duration_seconds,
        'timerMode', v_version.default_timer_mode,
        'allowedTimerModes', v_version.allowed_timer_modes,
        'instructions', v_version.instructions,
        'syllabus', v_version.syllabus,
        'gradingRoute', v_version.grading_route,
        'answerReleaseRule', v_version.answer_release_rule,
        'examinee', (
          select coalesce(nullif(btrim(display_name), ''), 'Authenticated examinee')
          from public.profiles where id = p_user_id
        )
      )
      from public.examination_definitions d
      where d.id = v_version.exam_id
    );

  elsif v_operation = 'resume' then
    if nullif(v_payload->>'attemptId', '') is not null then
      select * into v_attempt
      from public.examination_attempts_multi
      where id = (v_payload->>'attemptId')::uuid and user_id = p_user_id;
    else
      select * into v_attempt
      from public.examination_attempts_multi
      where version_id = (v_payload->>'versionId')::uuid
        and user_id = p_user_id
        and status in ('in_progress', 'review')
      limit 1;
    end if;
    if v_attempt.id is null then raise exception 'EXAM_ATTEMPT_NOT_FOUND'; end if;
    return public.examination_render_attempt(v_attempt.id, true);

  elsif v_operation = 'history' then
    return jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(item order by item->>'startedAt' desc)
        from (
          select jsonb_build_object(
            'attemptId', a.id,
            'publicId', a.public_id,
            'title', d.title,
            'subject', d.subject,
            'track', d.track,
            'assessmentKind', d.assessment_kind,
            'testOnly', d.test_only,
            'status', a.status,
            'timerMode', a.timer_mode,
            'startedAt', a.started_at,
            'submittedAt', a.submitted_at,
            'elapsedSeconds', a.elapsed_seconds,
            'questionCount', v.question_count,
            'answeredCount', (
              select count(*) from public.examination_responses r
              where r.attempt_id = a.id and nullif(btrim(r.answer_text), '') is not null
            ),
            'aiAssessmentCount', (
              select count(*) from public.examination_ai_assessments aa
              where aa.attempt_id = a.id
            ),
            'humanFinalized', exists (
              select 1 from public.examination_examiner_assignments ea
              where ea.attempt_id = a.id and ea.status = 'finalized'
            ),
            'modelsReleased', exists (
              select 1 from public.examination_model_releases mr
              where mr.attempt_id = a.id
            )
          ) item
          from public.examination_attempts_multi a
          join public.examination_versions v on v.id = a.version_id
          join public.examination_definitions d on d.id = v.exam_id
          where a.user_id = p_user_id
          order by a.started_at desc
          limit v_limit offset v_offset
        ) history_rows
      ), '[]'::jsonb)
    );

  elsif v_operation = 'verdict' then
    select * into v_attempt
    from public.examination_attempts_multi
    where id = (v_payload->>'attemptId')::uuid and user_id = p_user_id;
    if v_attempt.id is null then raise exception 'EXAM_ATTEMPT_NOT_FOUND'; end if;
    return jsonb_build_object(
      'attempt', public.examination_attempt_summary(v_attempt),
      'released', exists (
        select 1 from public.examination_model_releases
        where attempt_id = v_attempt.id
      ),
      'gradingJob', (
        select jsonb_build_object(
          'route', route,
          'status', status,
          'queuedAt', queued_at,
          'completedAt', completed_at,
          'safeErrorCode', safe_error_code
        )
        from public.examination_grading_jobs
        where attempt_id = v_attempt.id
        order by created_at desc limit 1
      ),
      'results', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'questionId', vq.question_id,
            'ordinal', vq.ordinal,
            'prompt', vq.prompt_snapshot,
            'answerText', r.answer_text,
            'aiAssessment', case
              when mr.attempt_id is not null then aa.assessment_json
              else aa.assessment_json - 'modelAnswer'
            end,
            'aiScore', aa.score,
            'humanScore', hr.score,
            'humanComments', hr.comments,
            'modelAnswer', case when mr.attempt_id is not null
              then vq.model_answer_snapshot else null end,
            'legalBasis', case when mr.attempt_id is not null
              then vq.legal_basis_snapshot else null end,
            'application', case when mr.attempt_id is not null
              then vq.application_snapshot else null end,
            'conclusion', case when mr.attempt_id is not null
              then vq.conclusion_snapshot else null end,
            'sources', case when mr.attempt_id is not null
              then vq.source_urls_snapshot else '[]'::jsonb end
          )
          order by vq.ordinal
        )
        from public.examination_version_questions vq
        join public.examination_responses r
          on r.attempt_id = v_attempt.id and r.question_id = vq.question_id
        left join public.examination_ai_assessments aa
          on aa.attempt_id = v_attempt.id and aa.question_id = vq.question_id
        left join public.examination_examiner_assignments ea
          on ea.attempt_id = v_attempt.id and ea.status = 'finalized'
        left join public.examination_examiner_reviews hr
          on hr.assignment_id = ea.id and hr.question_id = vq.question_id
        left join public.examination_model_releases mr
          on mr.attempt_id = v_attempt.id
        where vq.version_id = v_attempt.version_id
      ), '[]'::jsonb)
    );
  end if;

  raise exception 'EXAM_QUERY_INVALID';
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'EXAM_QUERY_INVALID';
end;
$$;

-- ---------------------------------------------------------------------------
-- Founder/Super Admin examination management
-- ---------------------------------------------------------------------------

create or replace function public.examination_admin(
  p_actor_user_id uuid,
  p_operation text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_operation text := lower(btrim(coalesce(p_operation, '')));
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_action text := lower(btrim(coalesce(v_payload->>'action', '')));
  v_reason text := btrim(coalesce(v_payload->>'reason', ''));
  v_request_key text := btrim(coalesce(v_payload->>'requestKey', ''));
  v_request_hash text := public.examination_request_hash(v_payload);
  v_existing public.examination_command_receipts%rowtype;
  v_exam public.examination_definitions%rowtype;
  v_version public.examination_versions%rowtype;
  v_attempt public.examination_attempts_multi%rowtype;
  v_question_id uuid;
  v_ordinal integer;
  v_count integer;
  v_hash text;
  v_result jsonb;
begin
  perform public.examination_require_admin(p_actor_user_id);
  if jsonb_typeof(v_payload) <> 'object' then raise exception 'EXAM_ADMIN_REQUEST_INVALID'; end if;

  if v_operation = 'dashboard' then
    return jsonb_build_object(
      'definitions', coalesce((
        select jsonb_agg(item order by created_at desc)
        from (
          select d.created_at,
            jsonb_build_object(
              'examId', d.id,
              'publicId', d.public_id,
              'track', d.track,
              'assessmentKind', d.assessment_kind,
              'title', d.title,
              'subject', d.subject,
              'yearLevel', d.year_level,
              'semester', d.semester,
              'testOnly', d.test_only,
              'status', d.status,
              'activeVersionId', d.active_version_id,
              'availableFrom', d.available_from,
              'availableUntil', d.available_until,
              'createdAt', d.created_at,
              'version', case when v.id is null then null else jsonb_build_object(
                'versionId', v.id,
                'label', v.label,
                'status', v.status,
                'questionCount', v.question_count,
                'durationSeconds', v.duration_seconds,
                'timerMode', v.default_timer_mode,
                'gradingRoute', v.grading_route,
                'answerReleaseRule', v.answer_release_rule
              ) end,
              'attemptCounts', jsonb_build_object(
                'active', coalesce(counts.active, 0),
                'submitted', coalesce(counts.submitted, 0),
                'total', coalesce(counts.total, 0)
              )
            ) item
          from public.examination_definitions d
          left join public.examination_versions v on v.id = d.active_version_id
          left join lateral (
            select
              count(*) filter (where a.status in ('in_progress', 'review')) active,
              count(*) filter (where a.status in ('submitted', 'expired')) submitted,
              count(*) total
            from public.examination_attempts_multi a
            where a.version_id = v.id
          ) counts on true
        ) definition_rows
      ), '[]'::jsonb),
      'versions', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'versionId', v.id,
            'examId', v.exam_id,
            'versionNumber', v.version_number,
            'label', v.label,
            'durationSeconds', v.duration_seconds,
            'timerMode', v.default_timer_mode,
            'allowedTimerModes', v.allowed_timer_modes,
            'gradingRoute', v.grading_route,
            'answerReleaseRule', v.answer_release_rule,
            'releaseAt', v.release_at,
            'questionCount', v.question_count,
            'status', v.status,
            'createdAt', v.created_at,
            'publishedAt', v.published_at,
            'questionIds', coalesce((
              select jsonb_agg(vq.question_id order by vq.ordinal)
              from public.examination_version_questions vq
              where vq.version_id = v.id
            ), '[]'::jsonb)
          )
          order by v.created_at desc, v.version_number desc
        )
        from public.examination_versions v
      ), '[]'::jsonb),
      'approvedQuestions', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'questionId', q.id,
            'sourceQuestionId', q.source_key,
            'subject', q.subject,
            'topic', q.topic,
            'difficulty', q.difficulty,
            'barYear', q.bar_year,
            'promptPreview', left(q.prompt_text, 240),
            'reviewStatus', q.review_status,
            'publicationReady', q.publication_ready
          )
          order by q.subject, q.source_key
        )
        from public.examination_questions q
        where q.review_status = 'approved'
          and q.publication_ready
      ), '[]'::jsonb),
      'questionInventory', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'subject', subject,
            'approved', approved,
            'pending', pending,
            'total', total
          ) order by subject
        )
        from (
          select subject,
            count(*) filter (where review_status = 'approved' and publication_ready) approved,
            count(*) filter (where not (review_status = 'approved' and publication_ready)) pending,
            count(*) total
          from public.examination_questions
          where source_type = 'google_sheet'
          group by subject
        ) inventory
      ), '[]'::jsonb),
      'gradingQueue', jsonb_build_object(
        'queued', (select count(*) from public.examination_grading_jobs where status = 'queued'),
        'processing', (select count(*) from public.examination_grading_jobs where status = 'processing'),
        'failed', (select count(*) from public.examination_grading_jobs where status = 'failed'),
        'humanPending', (
          select count(*) from public.examination_examiner_assignments
          where status in ('pending', 'claimed')
        )
      ),
      'uploadsPendingDeletion', (
        select count(*) from public.examination_uploads
        where deleted_at is null and retention_until <= now()
      ),
      'recentAttempts', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'attemptId', rows.id,
            'examId', rows.exam_id,
            'title', rows.title,
            'subject', rows.subject,
            'userId', rows.user_id,
            'status', rows.status,
            'timerMode', rows.timer_mode,
            'startedAt', rows.started_at,
            'submittedAt', rows.submitted_at,
            'gradingStatus', rows.grading_status
          )
          order by rows.started_at desc
        )
        from (
          select a.id, v.exam_id, d.title, d.subject, a.user_id, a.status,
            a.timer_mode, a.started_at, a.submitted_at,
            coalesce(g.status, 'not_requested') grading_status
          from public.examination_attempts_multi a
          join public.examination_versions v on v.id = a.version_id
          join public.examination_definitions d on d.id = v.exam_id
          left join lateral (
            select status
            from public.examination_grading_jobs
            where attempt_id = a.id
            order by queued_at desc
            limit 1
          ) g on true
          order by a.started_at desc
          limit 100
        ) rows
      ), '[]'::jsonb),
      'examinerAssignments', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'assignmentId', ea.id,
            'attemptId', ea.attempt_id,
            'status', ea.status,
            'invitationStatus', ea.invitation_status,
            'expiresAt', ea.expires_at,
            'createdAt', ea.created_at,
            'finalizedAt', ea.finalized_at
          )
          order by ea.created_at desc
        )
        from (
          select *
          from public.examination_examiner_assignments
          order by created_at desc
          limit 100
        ) ea
      ), '[]'::jsonb),
      'lastUpdatedAt', now()
    );

  elsif v_operation = 'audit' then
    return jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', id,
            'actorUserId', actor_user_id,
            'action', action,
            'resourceType', resource_type,
            'resourceId', resource_id,
            'reason', reason,
            'metadata', metadata,
            'createdAt', created_at
          )
          order by created_at desc, id desc
        )
        from (
          select *
          from public.examination_audit_log
          where nullif(v_payload->>'examId', '') is null
             or resource_id = v_payload->>'examId'
             or metadata->>'examId' = v_payload->>'examId'
          order by created_at desc, id desc
          limit least(100, greatest(1, coalesce((v_payload->>'limit')::integer, 50)))
          offset least(10000, greatest(0, coalesce((v_payload->>'offset')::integer, 0)))
        ) rows
      ), '[]'::jsonb)
    );
  end if;

  if char_length(v_reason) < 5
    or v_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
  then raise exception 'EXAM_ADMIN_REQUEST_INVALID'; end if;

  select * into v_existing
  from public.examination_command_receipts
  where user_id = p_actor_user_id
    and operation = 'admin:' || v_operation
    and request_key = v_request_key;
  if v_existing.id is not null then
    if v_existing.request_hash <> v_request_hash then
      raise exception 'EXAM_SUBMISSION_CONFLICT';
    end if;
    return v_existing.response_json || jsonb_build_object('replayed', true);
  end if;

  if v_operation = 'create_exam' then
    if v_payload->>'track' not in ('per_subject', 'bar_feels')
      or v_payload->>'assessmentKind' not in (
        'midterm', 'final', 'curated', 'uploaded', 'system_test'
      )
      or char_length(btrim(coalesce(v_payload->>'title', ''))) not between 3 and 180
    then raise exception 'EXAM_ADMIN_REQUEST_INVALID'; end if;
    insert into public.examination_definitions (
      track, assessment_kind, title, subject, year_level, semester,
      owner_user_id, test_only, created_by
    ) values (
      v_payload->>'track',
      v_payload->>'assessmentKind',
      btrim(v_payload->>'title'),
      nullif(btrim(v_payload->>'subject'), ''),
      nullif(v_payload->>'yearLevel', '')::smallint,
      nullif(v_payload->>'semester', '')::smallint,
      nullif(v_payload->>'ownerUserId', '')::uuid,
      coalesce((v_payload->>'testOnly')::boolean, true),
      p_actor_user_id
    )
    returning * into v_exam;
    v_result := jsonb_build_object(
      'examId', v_exam.id,
      'publicId', v_exam.public_id,
      'status', v_exam.status
    );

  elsif v_operation = 'create_version' then
    select * into v_exam
    from public.examination_definitions
    where id = (v_payload->>'examId')::uuid and status <> 'closed'
    for update;
    if v_exam.id is null then raise exception 'EXAM_NOT_AVAILABLE'; end if;
    insert into public.examination_versions (
      exam_id, version_number, label, duration_seconds, default_timer_mode,
      allowed_timer_modes, grading_route, answer_release_rule, release_at,
      instructions, syllabus, created_by
    ) values (
      v_exam.id,
      coalesce((
        select max(version_number) + 1
        from public.examination_versions where exam_id = v_exam.id
      ), 1),
      coalesce(nullif(btrim(v_payload->>'label'), ''), 'Version'),
      (v_payload->>'durationSeconds')::integer,
      coalesce(nullif(v_payload->>'timerMode', ''), 'strict'),
      case
        when nullif(v_payload->>'timerMode', '') is not null
          then jsonb_build_array(v_payload->>'timerMode')
        else '["strict","selfPaced","none"]'::jsonb
      end,
      v_payload->>'gradingRoute',
      v_payload->>'answerReleaseRule',
      nullif(v_payload->>'releaseAt', '')::timestamptz,
      left(coalesce(v_payload->>'instructions', ''), 8000),
      coalesce(v_payload->'syllabus', '[]'::jsonb),
      p_actor_user_id
    )
    returning * into v_version;
    v_result := jsonb_build_object(
      'examId', v_exam.id,
      'versionId', v_version.id,
      'versionNumber', v_version.version_number,
      'status', v_version.status
    );

  elsif v_operation = 'set_questions' then
    select * into v_version
    from public.examination_versions
    where id = (v_payload->>'versionId')::uuid and status = 'draft'
    for update;
    if v_version.id is null then raise exception 'EXAM_VERSION_IMMUTABLE'; end if;
    if jsonb_typeof(v_payload->'questionIds') <> 'array'
      or jsonb_array_length(v_payload->'questionIds') not between 1 and 20
      or (
        select count(distinct value)
        from jsonb_array_elements_text(v_payload->'questionIds')
      ) <> jsonb_array_length(v_payload->'questionIds')
    then raise exception 'EXAM_PUBLISH_INCOMPLETE'; end if;
    delete from public.examination_version_questions
    where version_id = v_version.id;
    v_ordinal := 0;
    for v_question_id in
      select value::uuid
      from jsonb_array_elements_text(v_payload->'questionIds')
    loop
      v_ordinal := v_ordinal + 1;
      insert into public.examination_version_questions (
        version_id, question_id, ordinal, prompt_snapshot,
        model_answer_snapshot, legal_basis_snapshot, application_snapshot,
        conclusion_snapshot, jurisprudence_snapshot, citation_snapshot,
        governing_provision_snapshot, source_urls_snapshot, snapshot_hash
      )
      select
        v_version.id, q.id, v_ordinal, q.prompt_text,
        q.model_answer, q.legal_basis, q.application_text,
        q.conclusion_text, q.jurisprudence, q.citation,
        q.governing_provision, q.source_urls, q.content_hash
      from public.examination_questions q
      join public.examination_definitions d on d.id = v_version.exam_id
      where q.id = v_question_id
        and (
          (
            q.source_type = 'google_sheet'
            and q.review_status = 'approved'
            and q.publication_ready
          )
          or (
            q.source_type = 'uploaded'
            and q.owner_user_id = d.owner_user_id
            and d.assessment_kind = 'uploaded'
          )
        );
      if not found then raise exception 'EXAM_QUESTION_NOT_APPROVED'; end if;
    end loop;
    update public.examination_versions
    set question_count = v_ordinal
    where id = v_version.id
    returning * into v_version;
    v_result := jsonb_build_object(
      'versionId', v_version.id,
      'questionCount', v_version.question_count
    );

  elsif v_operation = 'publish_version' then
    select * into v_version
    from public.examination_versions
    where id = (v_payload->>'versionId')::uuid and status = 'draft'
    for update;
    if v_version.id is null then raise exception 'EXAM_VERSION_IMMUTABLE'; end if;
    select * into v_exam
    from public.examination_definitions
    where id = v_version.exam_id
    for update;
    select count(*) into v_count
    from public.examination_version_questions
    where version_id = v_version.id;
    if v_count < 1 or v_count <> v_version.question_count
      or (not v_exam.test_only and v_count <> 20)
      or (
        v_version.grading_route in ('ai', 'either')
        and exists (
          select 1 from public.examination_version_questions
          where version_id = v_version.id
            and (
              nullif(btrim(model_answer_snapshot), '') is null
              or nullif(btrim(legal_basis_snapshot), '') is null
            )
        )
      )
    then raise exception 'EXAM_PUBLISH_INCOMPLETE'; end if;
    select encode(extensions.digest(
      string_agg(
        vq.ordinal::text || ':' || vq.snapshot_hash,
        '|' order by vq.ordinal
      )
      || ':' || v_version.duration_seconds
      || ':' || v_version.default_timer_mode
      || ':' || v_version.grading_route
      || ':' || v_version.answer_release_rule,
      'sha256'
    ), 'hex')
    into v_hash
    from public.examination_version_questions vq
    where vq.version_id = v_version.id;
    update public.examination_versions
    set snapshot_hash = v_hash,
        status = 'published',
        published_at = now()
    where id = v_version.id
    returning * into v_version;
    update public.examination_versions
    set status = 'retired', retired_at = now()
    where exam_id = v_exam.id and id <> v_version.id and status = 'published';
    update public.examination_definitions
    set status = 'published',
        active_version_id = v_version.id,
        updated_at = now()
    where id = v_exam.id
    returning * into v_exam;
    v_result := jsonb_build_object(
      'examId', v_exam.id,
      'versionId', v_version.id,
      'status', v_exam.status,
      'questionCount', v_version.question_count,
      'testOnly', v_exam.test_only
    );

  elsif v_operation = 'set_availability' then
    update public.examination_definitions
    set available_from = nullif(v_payload->>'availableFrom', '')::timestamptz,
        available_until = nullif(v_payload->>'availableUntil', '')::timestamptz,
        updated_at = now()
    where id = (v_payload->>'examId')::uuid and status <> 'closed'
    returning * into v_exam;
    if v_exam.id is null then raise exception 'EXAM_NOT_AVAILABLE'; end if;
    v_result := jsonb_build_object(
      'examId', v_exam.id,
      'availableFrom', v_exam.available_from,
      'availableUntil', v_exam.available_until
    );

  elsif v_operation = 'set_participant' then
    if coalesce((v_payload->>'enabled')::boolean, false) then
      insert into public.examination_participants (
        version_id, user_id, enabled, granted_by
      ) values (
        (v_payload->>'versionId')::uuid,
        (v_payload->>'userId')::uuid,
        true,
        p_actor_user_id
      )
      on conflict (version_id, user_id) do update
        set enabled = true, granted_by = excluded.granted_by, updated_at = now();
    else
      update public.examination_participants
      set enabled = false, granted_by = p_actor_user_id, updated_at = now()
      where version_id = (v_payload->>'versionId')::uuid
        and user_id = (v_payload->>'userId')::uuid;
    end if;
    v_result := jsonb_build_object(
      'versionId', v_payload->>'versionId',
      'userId', v_payload->>'userId',
      'enabled', coalesce((v_payload->>'enabled')::boolean, false)
    );

  elsif v_operation = 'set_beta_access' then
    insert into public.examination_beta_access (
      user_id, enabled, expires_at, granted_by, reason
    ) values (
      (v_payload->>'userId')::uuid,
      coalesce((v_payload->>'enabled')::boolean, false),
      nullif(v_payload->>'expiresAt', '')::timestamptz,
      p_actor_user_id,
      v_reason
    )
    on conflict (user_id) do update
      set enabled = excluded.enabled,
          expires_at = excluded.expires_at,
          granted_by = excluded.granted_by,
          reason = excluded.reason,
          updated_at = now();
    v_result := jsonb_build_object(
      'userId', v_payload->>'userId',
      'enabled', coalesce((v_payload->>'enabled')::boolean, false),
      'expiresAt', nullif(v_payload->>'expiresAt', '')::timestamptz
    );

  elsif v_operation in ('unpublish_exam', 'close_exam') then
    select * into v_exam
    from public.examination_definitions
    where id = (v_payload->>'examId')::uuid
    for update;
    if v_exam.id is null then raise exception 'EXAM_NOT_AVAILABLE'; end if;
    if exists (
      select 1
      from public.examination_attempts_multi a
      join public.examination_versions v on v.id = a.version_id
      where v.exam_id = v_exam.id and a.status in ('in_progress', 'review')
    ) then raise exception 'EXAM_ACTIVE_ATTEMPTS_EXIST'; end if;
    update public.examination_definitions
    set status = case when v_operation = 'close_exam' then 'closed' else 'unpublished' end,
        closed_at = case when v_operation = 'close_exam' then now() else closed_at end,
        updated_at = now()
    where id = v_exam.id
    returning * into v_exam;
    v_result := jsonb_build_object('examId', v_exam.id, 'status', v_exam.status);

  elsif v_operation = 'release_model_answers' then
    select * into v_attempt
    from public.examination_attempts_multi
    where id = (v_payload->>'attemptId')::uuid;
    if v_attempt.id is null or v_attempt.status not in ('submitted', 'expired') then
      raise exception 'EXAM_ATTEMPT_NOT_FOUND';
    end if;
    if exists (
      select 1
      from public.examination_version_questions
      where version_id = v_attempt.version_id
        and nullif(btrim(model_answer_snapshot), '') is null
    ) then raise exception 'EXAM_MODEL_NOT_AVAILABLE'; end if;
    insert into public.examination_model_releases (
      attempt_id, released_by, release_reason, email_status
    ) values (
      v_attempt.id, p_actor_user_id, v_reason, 'not_configured'
    )
    on conflict (attempt_id) do nothing;
    v_result := jsonb_build_object(
      'attemptId', v_attempt.id,
      'released', true,
      'emailStatus', (
        select email_status from public.examination_model_releases
        where attempt_id = v_attempt.id
      )
    );
  else
    raise exception 'EXAM_ADMIN_REQUEST_INVALID';
  end if;

  insert into public.examination_audit_log (
    actor_user_id, action, resource_type, resource_id, reason, metadata
  ) values (
    p_actor_user_id,
    'admin_' || v_operation,
    'examination_management',
    coalesce(
      v_result->>'examId',
      v_result->>'versionId',
      v_result->>'attemptId',
      v_result->>'userId',
      'configuration'
    ),
    v_reason,
    v_result - array['email', 'examinerEmail', 'answerText']
  );
  insert into public.examination_command_receipts (
    user_id, operation, request_key, request_hash, response_json
  ) values (
    p_actor_user_id, 'admin:' || v_operation, v_request_key, v_request_hash, v_result
  );
  return v_result;
exception
  when invalid_text_representation or numeric_value_out_of_range
    or check_violation then
    raise exception 'EXAM_ADMIN_REQUEST_INVALID';
end;
$$;

create or replace function public.examination_record_delivery(
  p_actor_user_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_status text,
  p_provider_id text default null,
  p_safe_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment public.examination_examiner_assignments%rowtype;
  v_attempt public.examination_attempts_multi%rowtype;
begin
  if p_status not in ('not_configured', 'suppressed', 'sent', 'failed')
    or p_target_type not in ('examiner_invitation', 'model_answers_released')
  then raise exception 'EXAM_DELIVERY_INVALID'; end if;

  if p_target_type = 'examiner_invitation' then
    select ea.* into v_assignment
    from public.examination_examiner_assignments ea
    join public.examination_attempts_multi a on a.id = ea.attempt_id
    where ea.public_id = p_target_id
      and (
        a.user_id = p_actor_user_id
        or public.examination_is_admin(p_actor_user_id)
      )
    for update of ea;
    if v_assignment.id is null then raise exception 'EXAM_ASSIGNMENT_NOT_FOUND'; end if;
    update public.examination_examiner_assignments
    set invitation_status = p_status,
        invitation_provider_id = left(nullif(p_provider_id, ''), 180),
        updated_at = now()
    where id = v_assignment.id
    returning * into v_assignment;
    select * into v_attempt
    from public.examination_attempts_multi where id = v_assignment.attempt_id;
    insert into public.examination_notifications (
      user_id, assignment_id, notification_type, recipient,
      status, provider_id, safe_error_code, sent_at
    ) values (
      v_attempt.user_id,
      v_assignment.id,
      'examiner_invitation',
      v_assignment.examiner_email,
      p_status,
      left(nullif(p_provider_id, ''), 180),
      left(nullif(p_safe_error_code, ''), 80),
      case when p_status = 'sent' then now() else null end
    );
    return jsonb_build_object(
      'assignmentId', v_assignment.public_id,
      'status', v_assignment.invitation_status
    );
  end if;

  select * into v_attempt
  from public.examination_attempts_multi
  where id = p_target_id
    and (
      user_id = p_actor_user_id
      or public.examination_is_admin(p_actor_user_id)
    );
  if v_attempt.id is null then raise exception 'EXAM_ATTEMPT_NOT_FOUND'; end if;
  update public.examination_model_releases
  set email_status = p_status,
      email_provider_id = left(nullif(p_provider_id, ''), 180)
  where attempt_id = v_attempt.id;
  insert into public.examination_notifications (
    user_id, notification_type, recipient, status,
    provider_id, safe_error_code, sent_at
  ) values (
    v_attempt.user_id,
    'model_answers_released',
    'authenticated-student',
    p_status,
    left(nullif(p_provider_id, ''), 180),
    left(nullif(p_safe_error_code, ''), 80),
    case when p_status = 'sent' then now() else null end
  );
  return jsonb_build_object('attemptId', v_attempt.id, 'status', p_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- Least privilege: all examination data is Worker-mediated.
-- Existing storage/table privileges outside this feature are left unchanged.
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'examination_questions',
    'examination_definitions',
    'examination_versions',
    'examination_version_questions',
    'examination_beta_access',
    'examination_participants',
    'examination_attempts_multi',
    'examination_responses',
    'examination_submissions',
    'examination_grading_jobs',
    'examination_ai_assessments',
    'examination_examiner_assignments',
    'examination_examiner_reviews',
    'examination_model_releases',
    'examination_uploads',
    'examination_notifications',
    'examination_audit_log',
    'examination_command_receipts'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format(
      'revoke all privileges on table public.%I from public, anon, authenticated',
      v_table
    );
    execute format(
      'grant select, insert, update, delete on table public.%I to service_role',
      v_table
    );
  end loop;
end;
$$;

revoke all privileges on sequence public.examination_audit_log_id_seq
  from public, anon, authenticated;
grant usage, select on sequence public.examination_audit_log_id_seq
  to service_role;

do $$
declare
  v_function record;
begin
  for v_function in
    select
      n.nspname as schema_name,
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as identity_arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'examination\_%' escape '\'
  loop
    execute format(
      'revoke all on function %I.%I(%s) from public, anon, authenticated',
      v_function.schema_name,
      v_function.function_name,
      v_function.identity_arguments
    );
    execute format(
      'grant execute on function %I.%I(%s) to service_role',
      v_function.schema_name,
      v_function.function_name,
      v_function.identity_arguments
    );
  end loop;
end;
$$;

commit;

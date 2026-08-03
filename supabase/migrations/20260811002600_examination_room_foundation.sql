-- DueDiligence 2026 Examination Room.
-- This is a separate institutional exam model. It does not alter the existing
-- Mock Bar, Subject Matter, or Bar Feels examination engine.

begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Professors, classrooms, and roster
-- ---------------------------------------------------------------------------

create table if not exists public.exam_room_professors (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  activated_by uuid not null references auth.users(id) on delete restrict,
  activated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exam_room_professor_activations (
  id uuid primary key default gen_random_uuid(),
  target_email text not null check (
    target_email = lower(btrim(target_email))
    and target_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
  ),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'issued'
    check (status in ('issued', 'redeemed', 'expired', 'revoked', 'locked')),
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
  locked_until timestamptz,
  expires_at timestamptz not null,
  issued_by uuid not null references auth.users(id) on delete restrict,
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default now(),
  constraint exam_room_activation_expiry_check check (
    expires_at > created_at and expires_at <= created_at + interval '7 days'
  ),
  constraint exam_room_activation_redemption_check check (
    (status <> 'redeemed') or (redeemed_by is not null and redeemed_at is not null)
  )
);

create unique index if not exists exam_room_activation_one_active_email_idx
  on public.exam_room_professor_activations (target_email)
  where status = 'issued';

create table if not exists public.exam_room_classrooms (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  owner_professor_id uuid not null references public.exam_room_professors(user_id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 2 and 200),
  school_name text check (school_name is null or char_length(school_name) <= 300),
  academic_term text check (academic_term is null or char_length(academic_term) <= 160),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists exam_room_classrooms_owner_idx
  on public.exam_room_classrooms (owner_professor_id, status, created_at desc);

create table if not exists public.exam_room_roster (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.exam_room_classrooms(id) on delete cascade,
  student_user_id uuid references auth.users(id) on delete restrict,
  canonical_email text not null check (
    canonical_email = lower(btrim(canonical_email))
    and canonical_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
  ),
  student_number text not null check (char_length(btrim(student_number)) between 1 and 120),
  candidate_number text not null check (char_length(btrim(candidate_number)) between 1 and 120),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 240),
  status text not null default 'active' check (status in ('active', 'inactive', 'removed')),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (classroom_id, canonical_email),
  unique (classroom_id, student_number),
  unique (classroom_id, candidate_number)
);

create unique index if not exists exam_room_roster_class_account_idx
  on public.exam_room_roster (classroom_id, student_user_id)
  where student_user_id is not null;
create unique index if not exists exam_room_roster_student_number_ci_idx
  on public.exam_room_roster (classroom_id, lower(student_number));
create unique index if not exists exam_room_roster_candidate_number_ci_idx
  on public.exam_room_roster (classroom_id, lower(candidate_number));
create index if not exists exam_room_roster_student_idx
  on public.exam_room_roster (student_user_id, status)
  where student_user_id is not null;

-- ---------------------------------------------------------------------------
-- Exams, source files, and immutable question versions
-- ---------------------------------------------------------------------------

create table if not exists public.exam_room_exams (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  classroom_id uuid not null references public.exam_room_classrooms(id) on delete restrict,
  owner_professor_id uuid not null references public.exam_room_professors(user_id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  instructions text not null default '' check (char_length(instructions) <= 10000),
  requested_question_count integer not null check (requested_question_count > 0),
  duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 480),
  opens_at timestamptz,
  hard_closes_at timestamptz,
  status text not null default 'draft' check (
    status in ('draft', 'confirmed', 'scheduled', 'open', 'closed', 'grading', 'sealed')
  ),
  integrity_preset text not null default 'standard'
    check (integrity_preset in ('open_book', 'standard', 'strict')),
  include_questionnaire boolean not null default false,
  active_question_version_id uuid,
  release_id uuid,
  google_sheet_id text,
  google_professor_access_removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sealed_at timestamptz,
  constraint exam_room_exams_schedule_check check (
    (opens_at is null and hard_closes_at is null)
    or (opens_at is not null and hard_closes_at is not null and hard_closes_at > opens_at)
  ),
  constraint exam_room_exams_sealed_check check (
    status <> 'sealed' or sealed_at is not null
  )
);

create index if not exists exam_room_exams_owner_idx
  on public.exam_room_exams (owner_professor_id, status, created_at desc);
create index if not exists exam_room_exams_class_idx
  on public.exam_room_exams (classroom_id, status, opens_at);
create index if not exists exam_room_exams_deadline_idx
  on public.exam_room_exams (hard_closes_at)
  where status in ('scheduled', 'open');

create table if not exists public.exam_room_question_sources (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exam_room_exams(id) on delete cascade,
  source_version integer not null check (source_version > 0),
  object_path text not null unique,
  safe_file_name text not null check (char_length(btrim(safe_file_name)) between 1 and 180),
  mime_type text not null check (
    mime_type in ('text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  ),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  page_count integer check (page_count is null or page_count between 1 and 50),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  extraction_status text not null check (extraction_status in ('preview', 'confirmed', 'rejected')),
  extraction_warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(extraction_warnings) = 'array'),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  unique (exam_id, source_version),
  unique (exam_id, content_hash),
  constraint exam_room_source_confirmation_check check (
    extraction_status <> 'confirmed' or (confirmed_by is not null and confirmed_at is not null)
  )
);

create unique index if not exists exam_room_source_one_confirmed_idx
  on public.exam_room_question_sources (exam_id)
  where extraction_status = 'confirmed';

create table if not exists public.exam_room_question_versions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exam_room_exams(id) on delete cascade,
  source_id uuid not null references public.exam_room_question_sources(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  question_count integer not null check (question_count > 0),
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'confirmed' check (status in ('confirmed', 'retired')),
  confirmed_by uuid not null references auth.users(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  unique (exam_id, version_number),
  unique (exam_id, snapshot_hash)
);

create table if not exists public.exam_room_questions (
  id uuid primary key default gen_random_uuid(),
  question_version_id uuid not null references public.exam_room_question_versions(id) on delete cascade,
  ordinal integer not null check (ordinal > 0),
  prompt_text text not null check (char_length(btrim(prompt_text)) > 0),
  maximum_points numeric(10,2) not null default 5 check (maximum_points > 0),
  prompt_hash text not null check (prompt_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (question_version_id, ordinal),
  unique (question_version_id, prompt_hash)
);

alter table public.exam_room_exams
  drop constraint if exists exam_room_exams_active_question_version_fkey;
alter table public.exam_room_exams
  add constraint exam_room_exams_active_question_version_fkey
  foreign key (active_question_version_id)
  references public.exam_room_question_versions(id)
  on delete set null
  deferrable initially deferred;

-- Private source bucket. Browser roles never receive direct object access.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'exam-room-sources',
  'exam-room-sources',
  false,
  10485760,
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
-- Scoped credentials, attempts, answers, integrity, and grading
-- ---------------------------------------------------------------------------

create table if not exists public.exam_room_credentials (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exam_room_exams(id) on delete cascade,
  credential_type text not null check (
    credential_type in ('student_exam', 'professor_grading', 'attempt_unlock', 'dispute_review')
  ),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  scoped_user_id uuid references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'redeemed', 'revoked', 'expired')),
  valid_from timestamptz,
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoke_reason text,
  constraint exam_room_credentials_validity_check check (
    valid_from is null or expires_at > valid_from
  ),
  constraint exam_room_credentials_revoke_check check (
    status <> 'revoked'
    or (revoked_at is not null and revoked_by is not null and char_length(btrim(revoke_reason)) between 5 and 1000)
  )
);

create unique index if not exists exam_room_one_active_credential_idx
  on public.exam_room_credentials (exam_id, credential_type, scoped_user_id)
  where status = 'active';

create table if not exists public.exam_room_credential_windows (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid references public.exam_room_exams(id) on delete cascade,
  activation_id uuid references public.exam_room_professor_activations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete cascade,
  credential_type text not null,
  rate_key_hash text not null check (rate_key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  failures integer not null default 0 check (failures between 0 and 5),
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  constraint exam_room_credential_window_scope_check check (
    (exam_id is not null)::integer + (activation_id is not null)::integer = 1
  )
);

create unique index if not exists exam_room_credential_window_exam_idx
  on public.exam_room_credential_windows (
    exam_id, actor_user_id, credential_type, rate_key_hash
  ) where exam_id is not null;
create unique index if not exists exam_room_credential_window_activation_idx
  on public.exam_room_credential_windows (
    activation_id, actor_user_id, credential_type, rate_key_hash
  ) where activation_id is not null;

create table if not exists public.exam_room_attempts (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null default gen_random_uuid() unique,
  exam_id uuid not null references public.exam_room_exams(id) on delete restrict,
  question_version_id uuid not null references public.exam_room_question_versions(id) on delete restrict,
  roster_id uuid not null references public.exam_room_roster(id) on delete restrict,
  student_user_id uuid not null references auth.users(id) on delete restrict,
  candidate_number text not null,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'locked', 'submitted', 'auto_submitted', 'sealed')),
  started_at timestamptz not null default now(),
  server_deadline timestamptz not null,
  submitted_at timestamptz,
  last_heartbeat_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_reason text,
  submission_request_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_id, student_user_id),
  unique (exam_id, candidate_number),
  constraint exam_room_attempt_deadline_check check (server_deadline > started_at),
  constraint exam_room_attempt_submission_check check (
    status not in ('submitted', 'auto_submitted', 'sealed') or submitted_at is not null
  )
);

create index if not exists exam_room_attempts_due_idx
  on public.exam_room_attempts (server_deadline)
  where status in ('in_progress', 'locked');
create index if not exists exam_room_attempts_student_idx
  on public.exam_room_attempts (student_user_id, started_at desc);

create table if not exists public.exam_room_answers (
  attempt_id uuid not null references public.exam_room_attempts(id) on delete cascade,
  question_id uuid not null references public.exam_room_questions(id) on delete restrict,
  answer_text text not null default '' check (char_length(answer_text) <= 20000),
  revision integer not null default 0 check (revision >= 0),
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

create index if not exists exam_room_answers_question_idx
  on public.exam_room_answers (question_id);

create table if not exists public.exam_room_integrity_events (
  id bigint generated always as identity primary key,
  exam_id uuid not null references public.exam_room_exams(id) on delete restrict,
  attempt_id uuid not null references public.exam_room_attempts(id) on delete cascade,
  student_user_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null check (
    event_type in (
      'fullscreen_exit', 'visibility_exit', 'focus_exit', 'copy_attempt',
      'paste_attempt', 'context_menu_attempt', 'heartbeat_gap', 'network_gap',
      'warning', 'lock', 'unlock'
    )
  ),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz not null default now()
);

create index if not exists exam_room_integrity_attempt_idx
  on public.exam_room_integrity_events (attempt_id, occurred_at);

create table if not exists public.exam_room_grades (
  attempt_id uuid not null references public.exam_room_attempts(id) on delete cascade,
  question_id uuid not null references public.exam_room_questions(id) on delete restrict,
  score numeric(10,2) not null check (score >= 0),
  maximum_points numeric(10,2) not null check (maximum_points > 0 and score <= maximum_points),
  professor_comment text not null default '' check (char_length(professor_comment) <= 5000),
  grade_state text not null default 'draft' check (grade_state in ('draft', 'final')),
  revision integer not null default 1 check (revision > 0),
  graded_by uuid not null references auth.users(id) on delete restrict,
  graded_at timestamptz not null default now(),
  finalized_at timestamptz,
  primary key (attempt_id, question_id),
  constraint exam_room_grade_final_check check (
    grade_state <> 'final' or finalized_at is not null
  )
);

create table if not exists public.exam_room_grade_history (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references public.exam_room_attempts(id) on delete restrict,
  question_id uuid not null references public.exam_room_questions(id) on delete restrict,
  revision integer not null check (revision > 0),
  score numeric(10,2) not null,
  maximum_points numeric(10,2) not null,
  professor_comment text not null,
  grade_state text not null,
  changed_by uuid not null references auth.users(id) on delete restrict,
  change_reason text not null check (char_length(btrim(change_reason)) between 5 and 1000),
  changed_at timestamptz not null default now(),
  unique (attempt_id, question_id, revision)
);

-- ---------------------------------------------------------------------------
-- Release, disputes, outbox, email, and audit
-- ---------------------------------------------------------------------------

create table if not exists public.exam_room_releases (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null unique references public.exam_room_exams(id) on delete restrict,
  request_key text not null unique check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  released_by uuid not null references auth.users(id) on delete restrict,
  include_questionnaire boolean not null,
  expected_count integer not null check (expected_count >= 0),
  started_count integer not null check (started_count >= 0),
  submitted_count integer not null check (submitted_count >= 0),
  auto_submitted_count integer not null check (auto_submitted_count >= 0),
  locked_count integer not null check (locked_count >= 0),
  released_at timestamptz not null default now(),
  sealed_at timestamptz not null default now()
);

alter table public.exam_room_exams
  drop constraint if exists exam_room_exams_release_fkey;
alter table public.exam_room_exams
  add constraint exam_room_exams_release_fkey
  foreign key (release_id)
  references public.exam_room_releases(id)
  on delete restrict
  deferrable initially deferred;

create table if not exists public.exam_room_dispute_reviews (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exam_room_exams(id) on delete restrict,
  case_reference text not null check (char_length(btrim(case_reference)) between 2 and 200),
  reason text not null check (char_length(btrim(reason)) between 10 and 2000),
  access_mode text not null default 'read_only' check (access_mode in ('read_only', 'correction')),
  status text not null default 'open' check (status in ('open', 'closed', 'expired')),
  opened_by uuid not null references auth.users(id) on delete restrict,
  opened_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  close_reason text,
  constraint exam_room_dispute_expiry_check check (
    expires_at > opened_at and expires_at <= opened_at + interval '72 hours'
  ),
  constraint exam_room_dispute_close_check check (
    status <> 'closed'
    or (closed_by is not null and closed_at is not null and char_length(btrim(close_reason)) between 5 and 1000)
  )
);

create unique index if not exists exam_room_one_open_dispute_idx
  on public.exam_room_dispute_reviews (exam_id)
  where status = 'open';

create table if not exists public.exam_room_backup_outbox (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exam_room_exams(id) on delete restrict,
  sequence_number bigint not null check (sequence_number > 0),
  event_type text not null check (
    event_type in (
      'exam_confirmed', 'roster_imported', 'attempt_submitted', 'grades_released',
      'dispute_opened', 'dispute_closed', 'admin_correction'
    )
  ),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'processing', 'synced', 'failed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 12),
  next_attempt_at timestamptz not null default now(),
  processing_started_at timestamptz,
  provider_reference text,
  verified_hash text check (verified_hash is null or verified_hash ~ '^[0-9a-f]{64}$'),
  safe_error_code text check (safe_error_code is null or safe_error_code ~ '^[A-Z0-9_]{2,80}$'),
  created_at timestamptz not null default now(),
  synced_at timestamptz,
  unique (exam_id, sequence_number),
  unique (exam_id, event_type, content_hash)
);

create index if not exists exam_room_backup_due_idx
  on public.exam_room_backup_outbox (status, next_attempt_at, created_at)
  where status in ('pending', 'failed');

create table if not exists public.exam_room_email_jobs (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exam_room_exams(id) on delete restrict,
  release_id uuid references public.exam_room_releases(id) on delete restrict,
  recipient_user_id uuid references auth.users(id) on delete restrict,
  recipient_email text not null check (
    recipient_email = lower(btrim(recipient_email))
    and recipient_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
  ),
  email_type text not null check (email_type in ('student_result', 'student_correction', 'professor_release_summary')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 8),
  next_attempt_at timestamptz not null default now(),
  provider_id text,
  safe_error_code text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (exam_id, email_type, recipient_email)
);

create index if not exists exam_room_email_due_idx
  on public.exam_room_email_jobs (status, next_attempt_at, created_at)
  where status in ('pending', 'failed');

alter table public.exam_room_email_jobs
  drop constraint if exists exam_room_email_jobs_email_type_check;
alter table public.exam_room_email_jobs
  add constraint exam_room_email_jobs_email_type_check
  check (email_type in ('student_result', 'student_correction', 'professor_release_summary'));

create table if not exists public.exam_room_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  exam_id uuid references public.exam_room_exams(id) on delete set null,
  classroom_id uuid references public.exam_room_classrooms(id) on delete set null,
  attempt_id uuid references public.exam_room_attempts(id) on delete set null,
  dispute_review_id uuid references public.exam_room_dispute_reviews(id) on delete set null,
  action text not null check (action ~ '^[a-z][a-z0-9_]{2,99}$'),
  reason text check (reason is null or char_length(reason) <= 2000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists exam_room_audit_exam_idx
  on public.exam_room_audit_log (exam_id, created_at desc);
create index if not exists exam_room_audit_actor_idx
  on public.exam_room_audit_log (actor_user_id, created_at desc);

create table if not exists public.exam_room_command_receipts (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null check (operation ~ '^[a-z][a-z0-9_]{2,79}$'),
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response_json jsonb not null check (jsonb_typeof(response_json) = 'object'),
  created_at timestamptz not null default now(),
  unique (actor_user_id, operation, request_key)
);

-- ---------------------------------------------------------------------------
-- Authorization, hashing, outbox, and immutable-state helpers
-- ---------------------------------------------------------------------------

create or replace function public.exam_room_is_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = p_user_id
      and r.role in ('admin', 'founder_admin', 'super_admin')
  );
$$;

create or replace function public.exam_room_is_professor(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.exam_room_is_admin(p_user_id)
    or exists (
      select 1 from public.exam_room_professors p
      where p.user_id = p_user_id and p.status = 'active'
    );
$$;

create or replace function public.exam_room_require_admin(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.exam_room_is_admin(p_user_id) then
    raise exception 'EXAM_ROOM_ADMIN_REQUIRED';
  end if;
end;
$$;

create or replace function public.exam_room_require_professor(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.exam_room_is_professor(p_user_id) then
    raise exception 'EXAM_ROOM_PROFESSOR_REQUIRED';
  end if;
end;
$$;

create or replace function public.exam_room_hash_json(p_value jsonb)
returns text
language sql
immutable
security definer
set search_path = public, extensions, pg_temp
as $$
  select encode(digest(convert_to(coalesce(p_value, '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function public.exam_room_queue_backup(
  p_exam_id uuid,
  p_event_type text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sequence bigint;
  v_hash text;
  v_id uuid;
begin
  if jsonb_typeof(p_payload) <> 'object' then raise exception 'EXAM_ROOM_BACKUP_PAYLOAD_INVALID'; end if;
  select coalesce(max(sequence_number), 0) + 1 into v_sequence
  from public.exam_room_backup_outbox where exam_id = p_exam_id;
  v_hash := public.exam_room_hash_json(p_payload);
  insert into public.exam_room_backup_outbox (
    exam_id, sequence_number, event_type, payload, content_hash
  ) values (p_exam_id, v_sequence, p_event_type, p_payload, v_hash)
  on conflict (exam_id, event_type, content_hash) do update
  set content_hash = excluded.content_hash
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.exam_room_forbid_sealed_exam_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'sealed' then raise exception 'EXAM_ROOM_SEALED'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists exam_room_exams_sealed_guard on public.exam_room_exams;
create trigger exam_room_exams_sealed_guard
before update or delete on public.exam_room_exams
for each row execute function public.exam_room_forbid_sealed_exam_change();

create or replace function public.exam_room_forbid_confirmed_question_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version_id uuid;
  v_status text;
begin
  v_version_id := case when tg_op = 'DELETE' then old.question_version_id else new.question_version_id end;
  select status into v_status from public.exam_room_question_versions where id = v_version_id;
  if v_status = 'confirmed' then raise exception 'EXAM_ROOM_QUESTION_VERSION_IMMUTABLE'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists exam_room_questions_confirmed_guard on public.exam_room_questions;
create trigger exam_room_questions_confirmed_guard
before update or delete on public.exam_room_questions
for each row execute function public.exam_room_forbid_confirmed_question_change();

create or replace function public.exam_room_forbid_sealed_child_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam_id uuid;
  v_status text;
begin
  if current_setting('app.exam_room_admin_correction', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_table_name = 'exam_room_attempts' then
    v_exam_id := case when tg_op = 'DELETE' then old.exam_id else new.exam_id end;
  elsif tg_table_name = 'exam_room_answers' then
    select exam_id into v_exam_id from public.exam_room_attempts
    where id = case when tg_op = 'DELETE' then old.attempt_id else new.attempt_id end;
  elsif tg_table_name = 'exam_room_integrity_events' then
    v_exam_id := case when tg_op = 'DELETE' then old.exam_id else new.exam_id end;
  elsif tg_table_name = 'exam_room_grades' then
    select exam_id into v_exam_id from public.exam_room_attempts
    where id = case when tg_op = 'DELETE' then old.attempt_id else new.attempt_id end;
  else
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select status into v_status from public.exam_room_exams where id = v_exam_id;
  if v_status = 'sealed' then raise exception 'EXAM_ROOM_SEALED'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists exam_room_attempts_sealed_guard on public.exam_room_attempts;
create trigger exam_room_attempts_sealed_guard before insert or update or delete
on public.exam_room_attempts for each row execute function public.exam_room_forbid_sealed_child_change();
drop trigger if exists exam_room_answers_sealed_guard on public.exam_room_answers;
create trigger exam_room_answers_sealed_guard before insert or update or delete
on public.exam_room_answers for each row execute function public.exam_room_forbid_sealed_child_change();
drop trigger if exists exam_room_integrity_sealed_guard on public.exam_room_integrity_events;
create trigger exam_room_integrity_sealed_guard before insert or update or delete
on public.exam_room_integrity_events for each row execute function public.exam_room_forbid_sealed_child_change();
drop trigger if exists exam_room_grades_sealed_guard on public.exam_room_grades;
create trigger exam_room_grades_sealed_guard before insert or update or delete
on public.exam_room_grades for each row execute function public.exam_room_forbid_sealed_child_change();

create or replace function public.exam_room_answer_belongs_to_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.exam_room_attempts a
    join public.exam_room_questions q on q.id = new.question_id
    where a.id = new.attempt_id and a.question_version_id = q.question_version_id
  ) then raise exception 'EXAM_ROOM_QUESTION_VERSION_MISMATCH'; end if;
  return new;
end;
$$;

drop trigger if exists exam_room_answers_version_guard on public.exam_room_answers;
create trigger exam_room_answers_version_guard before insert or update
on public.exam_room_answers for each row execute function public.exam_room_answer_belongs_to_version();

create or replace function public.exam_room_json_has_forbidden_key(p_value jsonb)
returns boolean
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_child jsonb;
begin
  if p_value is null then return false; end if;
  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_child in select key, value from jsonb_each(p_value)
    loop
      if lower(v_key) = any(array[
        'answer', 'answer_text', 'student_answer', 'email', 'ip', 'ip_address',
        'raw_ip', 'token', 'key', 'password', 'api_key', 'service_role_key'
      ]) or public.exam_room_json_has_forbidden_key(v_child) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value)
    loop
      if public.exam_room_json_has_forbidden_key(v_child) then return true; end if;
    end loop;
  end if;
  return false;
end;
$$;

alter table public.exam_room_integrity_events
  drop constraint if exists exam_room_integrity_details_safe_check;
alter table public.exam_room_integrity_events
  add constraint exam_room_integrity_details_safe_check
  check (not public.exam_room_json_has_forbidden_key(details));

-- ---------------------------------------------------------------------------
-- Activation, classroom, and roster RPCs
-- ---------------------------------------------------------------------------

create or replace function public.exam_room_issue_professor_activation(
  p_actor_user_id uuid,
  p_target_email text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(p_target_email));
  v_activation public.exam_room_professor_activations%rowtype;
begin
  perform public.exam_room_require_admin(p_actor_user_id);
  if v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
    or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at <= now()
    or p_expires_at > now() + interval '7 days'
    or char_length(btrim(p_reason)) not between 5 and 1000
  then raise exception 'EXAM_ROOM_ACTIVATION_INVALID'; end if;

  update public.exam_room_professor_activations
  set status = 'revoked', revoked_by = p_actor_user_id, revoked_at = now(),
      revoke_reason = 'Superseded by a newly issued activation.'
  where target_email = v_email and status = 'issued';

  insert into public.exam_room_professor_activations (
    target_email, token_hash, expires_at, issued_by
  ) values (v_email, p_token_hash, p_expires_at, p_actor_user_id)
  returning * into v_activation;

  insert into public.exam_room_audit_log (
    actor_user_id, action, reason, metadata
  ) values (
    p_actor_user_id, 'professor_activation_issued', p_reason,
    jsonb_build_object('activationId', v_activation.id, 'expiresAt', v_activation.expires_at)
  );

  return jsonb_build_object('activationId', v_activation.id, 'expiresAt', v_activation.expires_at);
end;
$$;

create or replace function public.exam_room_redeem_professor_activation(
  p_user_id uuid,
  p_token_hash text,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
  v_activation public.exam_room_professor_activations%rowtype;
  v_window public.exam_room_credential_windows%rowtype;
  v_failures integer;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' or p_rate_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'EXAM_ROOM_CREDENTIAL_INPUT_INVALID';
  end if;
  select lower(email) into v_email from auth.users where id = p_user_id;
  if v_email is null then raise exception 'EXAM_ROOM_AUTH_REQUIRED'; end if;

  select * into v_activation
  from public.exam_room_professor_activations
  where target_email = v_email and status in ('issued', 'locked')
  order by created_at desc limit 1
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'ACTIVATION_NOT_FOUND');
  end if;

  if v_activation.expires_at <= now() then
    update public.exam_room_professor_activations set status = 'expired' where id = v_activation.id;
    return jsonb_build_object('ok', false, 'code', 'ACTIVATION_EXPIRED');
  end if;

  select * into v_window
  from public.exam_room_credential_windows
  where activation_id = v_activation.id
    and actor_user_id = p_user_id
    and credential_type = 'professor_activation'
    and rate_key_hash = p_rate_key_hash
  for update;

  if found and v_window.locked_until is not null and v_window.locked_until > now() then
    return jsonb_build_object('ok', false, 'code', 'CREDENTIAL_LOCKED', 'lockedUntil', v_window.locked_until);
  end if;

  if v_activation.token_hash <> p_token_hash then
    if not found or v_window.window_started_at < now() - interval '15 minutes' then
      insert into public.exam_room_credential_windows (
        activation_id, actor_user_id, credential_type, rate_key_hash, failures, window_started_at
      ) values (v_activation.id, p_user_id, 'professor_activation', p_rate_key_hash, 1, now())
      on conflict (activation_id, actor_user_id, credential_type, rate_key_hash)
      where activation_id is not null
      do update set failures = 1, window_started_at = now(), locked_until = null, updated_at = now()
      returning failures into v_failures;
    else
      v_failures := least(v_window.failures + 1, 5);
      update public.exam_room_credential_windows
      set failures = v_failures,
          locked_until = case when v_failures >= 5 then now() + interval '15 minutes' else null end,
          updated_at = now()
      where id = v_window.id;
    end if;
    if v_failures >= 5 then
      update public.exam_room_professor_activations
      set status = 'locked', failed_attempts = 5, locked_until = now() + interval '15 minutes'
      where id = v_activation.id;
    else
      update public.exam_room_professor_activations
      set failed_attempts = v_failures where id = v_activation.id;
    end if;
    insert into public.exam_room_audit_log (actor_user_id, action, metadata)
    values (p_user_id, 'professor_activation_failed', jsonb_build_object('activationId', v_activation.id));
    return jsonb_build_object('ok', false, 'code', case when v_failures >= 5 then 'CREDENTIAL_LOCKED' else 'ACTIVATION_INVALID' end);
  end if;

  update public.exam_room_professor_activations
  set status = 'redeemed', redeemed_by = p_user_id, redeemed_at = now(),
      failed_attempts = 0, locked_until = null
  where id = v_activation.id;

  insert into public.exam_room_professors (user_id, status, activated_by)
  values (p_user_id, 'active', v_activation.issued_by)
  on conflict (user_id) do update
  set status = 'active', activated_by = excluded.activated_by, updated_at = now();

  delete from public.exam_room_credential_windows where activation_id = v_activation.id;
  insert into public.exam_room_audit_log (actor_user_id, action, metadata)
  values (p_user_id, 'professor_activation_redeemed', jsonb_build_object('activationId', v_activation.id));
  return jsonb_build_object('ok', true, 'role', 'professor');
end;
$$;

create or replace function public.exam_room_create_classroom(
  p_professor_user_id uuid,
  p_title text,
  p_school_name text default null,
  p_academic_term text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_class public.exam_room_classrooms%rowtype;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  if char_length(btrim(p_title)) not between 2 and 200
    or (p_school_name is not null and char_length(p_school_name) > 300)
    or (p_academic_term is not null and char_length(p_academic_term) > 160)
  then raise exception 'EXAM_ROOM_CLASS_INVALID'; end if;
  insert into public.exam_room_classrooms (
    owner_professor_id, title, school_name, academic_term
  ) values (
    p_professor_user_id, btrim(p_title), nullif(btrim(p_school_name), ''), nullif(btrim(p_academic_term), '')
  ) returning * into v_class;
  insert into public.exam_room_audit_log (
    actor_user_id, classroom_id, action
  ) values (p_professor_user_id, v_class.id, 'classroom_created');
  return jsonb_build_object('classroomId', v_class.public_id, 'title', v_class.title);
end;
$$;

create or replace function public.exam_room_validate_roster(
  p_professor_user_id uuid,
  p_classroom_public_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_class public.exam_room_classrooms%rowtype;
  v_errors jsonb := '[]'::jsonb;
  v_row jsonb;
  v_index integer := 0;
  v_email text;
  v_student text;
  v_candidate text;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_class from public.exam_room_classrooms
  where public_id = p_classroom_public_id
    and (owner_professor_id = p_professor_user_id or public.exam_room_is_admin(p_professor_user_id));
  if not found then raise exception 'EXAM_ROOM_CLASS_NOT_FOUND'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array(
      jsonb_build_object('row', 0, 'code', 'ROSTER_SIZE_INVALID', 'message', 'Roster must contain 1 to 500 students.')
    ));
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_index := v_index + 1;
    v_email := lower(btrim(v_row ->> 'email'));
    v_student := btrim(v_row ->> 'studentNumber');
    v_candidate := btrim(v_row ->> 'candidateNumber');
    if v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_index, 'code', 'EMAIL_INVALID', 'message', 'Enter a valid email.'));
    end if;
    if char_length(v_student) not between 1 and 120 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_index, 'code', 'STUDENT_NUMBER_INVALID', 'message', 'Student number is required.'));
    end if;
    if char_length(v_candidate) not between 1 and 120 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_index, 'code', 'CANDIDATE_NUMBER_INVALID', 'message', 'Candidate number is required.'));
    end if;
    if char_length(btrim(v_row ->> 'displayName')) not between 1 and 240 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_index, 'code', 'DISPLAY_NAME_INVALID', 'message', 'Display name is required.'));
    end if;
  end loop;

  if exists (
    select 1 from (
      select lower(btrim(value ->> 'email')) value_key, count(*) count_rows
      from jsonb_array_elements(p_rows) group by 1 having count(*) > 1
    ) d
  ) then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', 0, 'code', 'DUPLICATE_EMAIL', 'message', 'Duplicate email found in roster.'));
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) incoming
    join public.exam_room_roster existing
      on existing.classroom_id = v_class.id
      and existing.canonical_email <> lower(btrim(incoming ->> 'email'))
      and (
        lower(existing.student_number) = lower(btrim(incoming ->> 'studentNumber'))
        or lower(existing.candidate_number) = lower(btrim(incoming ->> 'candidateNumber'))
      )
  ) then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'row', 0,
      'code', 'ROSTER_IDENTIFIER_ALREADY_ASSIGNED',
      'message', 'A student or candidate number is already assigned to another roster entry.'
    ));
  end if;
  if exists (
    select 1 from (
      select btrim(value ->> 'studentNumber') value_key, count(*) count_rows
      from jsonb_array_elements(p_rows) group by 1 having count(*) > 1
    ) d
  ) then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', 0, 'code', 'DUPLICATE_STUDENT_NUMBER', 'message', 'Duplicate student number found in roster.'));
  end if;
  if exists (
    select 1 from (
      select btrim(value ->> 'candidateNumber') value_key, count(*) count_rows
      from jsonb_array_elements(p_rows) group by 1 having count(*) > 1
    ) d
  ) then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', 0, 'code', 'DUPLICATE_CANDIDATE_NUMBER', 'message', 'Duplicate candidate number found in roster.'));
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_errors) = 0,
    'rowCount', jsonb_array_length(p_rows),
    'errors', v_errors
  );
end;
$$;

create or replace function public.exam_room_import_roster(
  p_professor_user_id uuid,
  p_classroom_public_id uuid,
  p_rows jsonb,
  p_request_key text,
  p_source_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_class public.exam_room_classrooms%rowtype;
  v_validation jsonb;
  v_row jsonb;
  v_user_id uuid;
  v_count integer := 0;
  v_response jsonb;
  v_existing jsonb;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' or p_source_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'EXAM_ROOM_ROSTER_REQUEST_INVALID';
  end if;
  select * into v_class from public.exam_room_classrooms
  where public_id = p_classroom_public_id
    and (owner_professor_id = p_professor_user_id or public.exam_room_is_admin(p_professor_user_id))
  for update;
  if not found then raise exception 'EXAM_ROOM_CLASS_NOT_FOUND'; end if;
  if exists (
    select 1 from public.exam_room_exams e
    where e.classroom_id = v_class.id and e.status in ('open', 'closed', 'grading', 'sealed')
  ) then raise exception 'EXAM_ROOM_ROSTER_LOCKED'; end if;

  select response_json into v_existing
  from public.exam_room_command_receipts
  where actor_user_id = p_professor_user_id and operation = 'import_roster' and request_key = p_request_key;
  if v_existing is not null then return v_existing; end if;

  v_validation := public.exam_room_validate_roster(p_professor_user_id, p_classroom_public_id, p_rows);
  if not (v_validation ->> 'ok')::boolean then return v_validation; end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    select id into v_user_id from auth.users
    where lower(email) = lower(btrim(v_row ->> 'email')) limit 1;

    insert into public.exam_room_roster (
      classroom_id, student_user_id, canonical_email, student_number,
      candidate_number, display_name, status, created_by, updated_by
    ) values (
      v_class.id, v_user_id, lower(btrim(v_row ->> 'email')),
      btrim(v_row ->> 'studentNumber'), btrim(v_row ->> 'candidateNumber'),
      btrim(v_row ->> 'displayName'), 'active', p_professor_user_id, p_professor_user_id
    )
    on conflict (classroom_id, canonical_email) do update
    set student_user_id = excluded.student_user_id,
        student_number = excluded.student_number,
        candidate_number = excluded.candidate_number,
        display_name = excluded.display_name,
        status = 'active', updated_by = excluded.updated_by, updated_at = now();
    v_count := v_count + 1;
  end loop;

  v_response := jsonb_build_object('ok', true, 'imported', v_count, 'sourceHash', p_source_hash);
  insert into public.exam_room_command_receipts (
    actor_user_id, operation, request_key, request_hash, response_json
  ) values (
    p_professor_user_id, 'import_roster', p_request_key,
    public.exam_room_hash_json(jsonb_build_object('rows', p_rows, 'sourceHash', p_source_hash)), v_response
  );
  insert into public.exam_room_audit_log (
    actor_user_id, classroom_id, action, metadata
  ) values (
    p_professor_user_id, v_class.id, 'roster_imported',
    jsonb_build_object('rowCount', v_count, 'sourceHash', p_source_hash)
  );
  return v_response;
end;
$$;

-- ---------------------------------------------------------------------------
-- Exam creation, source confirmation, scheduling, and credential checks
-- ---------------------------------------------------------------------------

create or replace function public.exam_room_create_exam(
  p_professor_user_id uuid,
  p_classroom_public_id uuid,
  p_title text,
  p_instructions text,
  p_requested_question_count integer,
  p_integrity_preset text,
  p_include_questionnaire boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_class public.exam_room_classrooms%rowtype;
  v_exam public.exam_room_exams%rowtype;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_class from public.exam_room_classrooms
  where public_id = p_classroom_public_id
    and owner_professor_id = p_professor_user_id
    and status = 'active';
  if not found then raise exception 'EXAM_ROOM_CLASS_NOT_FOUND'; end if;
  if char_length(btrim(p_title)) not between 1 and 200
    or char_length(coalesce(p_instructions, '')) > 10000
    or p_requested_question_count is null or p_requested_question_count < 1
    or p_integrity_preset not in ('open_book', 'standard', 'strict')
  then raise exception 'EXAM_ROOM_EXAM_INVALID'; end if;

  insert into public.exam_room_exams (
    classroom_id, owner_professor_id, title, instructions,
    requested_question_count, integrity_preset, include_questionnaire
  ) values (
    v_class.id, p_professor_user_id, btrim(p_title), coalesce(p_instructions, ''),
    p_requested_question_count, p_integrity_preset, coalesce(p_include_questionnaire, false)
  ) returning * into v_exam;

  insert into public.exam_room_audit_log (
    actor_user_id, exam_id, classroom_id, action,
    metadata
  ) values (
    p_professor_user_id, v_exam.id, v_class.id, 'exam_created',
    jsonb_build_object('questionCount', p_requested_question_count)
  );
  return jsonb_build_object(
    'examId', v_exam.public_id,
    'status', v_exam.status,
    'questionCount', v_exam.requested_question_count
  );
end;
$$;

create or replace function public.exam_room_confirm_questions(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_object_path text,
  p_safe_file_name text,
  p_mime_type text,
  p_size_bytes integer,
  p_page_count integer,
  p_content_hash text,
  p_questions jsonb,
  p_warnings jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_source public.exam_room_question_sources%rowtype;
  v_version public.exam_room_question_versions%rowtype;
  v_source_version integer;
  v_question jsonb;
  v_ordinal integer;
  v_prompt text;
  v_count integer;
  v_snapshot_hash text;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam from public.exam_room_exams
  where public_id = p_exam_public_id and owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.status <> 'draft' then raise exception 'EXAM_ROOM_EXAM_NOT_DRAFT'; end if;
  if p_mime_type not in ('text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    or p_size_bytes not between 1 and 10485760
    or (p_page_count is not null and p_page_count not between 1 and 50)
    or p_content_hash !~ '^[0-9a-f]{64}$'
    or p_object_path !~ ('^' || v_exam.id::text || '/[0-9a-f]{64}/[A-Za-z0-9_.-]+$')
    or char_length(btrim(p_safe_file_name)) not between 1 and 180
    or jsonb_typeof(p_questions) <> 'array'
    or jsonb_typeof(p_warnings) <> 'array'
  then raise exception 'EXAM_ROOM_QUESTION_SOURCE_INVALID'; end if;

  v_count := jsonb_array_length(p_questions);
  if v_count < 1 or v_count <> v_exam.requested_question_count then
    raise exception 'EXAM_ROOM_QUESTION_COUNT_MISMATCH';
  end if;
  if exists (
    select 1 from (
      select (value ->> 'ordinal')::integer ordinal, count(*) count_rows
      from jsonb_array_elements(p_questions)
      group by 1 having count(*) > 1
    ) d
  ) then raise exception 'EXAM_ROOM_QUESTION_ORDINAL_DUPLICATE'; end if;

  for v_question in select value from jsonb_array_elements(p_questions)
  loop
    begin
      v_ordinal := (v_question ->> 'ordinal')::integer;
    exception when others then
      raise exception 'EXAM_ROOM_QUESTION_ORDINAL_INVALID';
    end;
    v_prompt := v_question ->> 'prompt';
    if v_ordinal not between 1 and v_count or char_length(btrim(v_prompt)) < 1 then
      raise exception 'EXAM_ROOM_QUESTION_INVALID';
    end if;
  end loop;

  if exists (
    select 1 from generate_series(1, v_count) expected
    where not exists (
      select 1 from jsonb_array_elements(p_questions) q
      where (q ->> 'ordinal')::integer = expected
    )
  ) then raise exception 'EXAM_ROOM_QUESTION_SEQUENCE_INVALID'; end if;

  select coalesce(max(source_version), 0) + 1 into v_source_version
  from public.exam_room_question_sources where exam_id = v_exam.id;
  insert into public.exam_room_question_sources (
    exam_id, source_version, object_path, safe_file_name, mime_type,
    size_bytes, page_count, content_hash, extraction_status,
    extraction_warnings, uploaded_by, confirmed_by, confirmed_at
  ) values (
    v_exam.id, v_source_version, p_object_path, p_safe_file_name, p_mime_type,
    p_size_bytes, p_page_count, p_content_hash, 'confirmed',
    p_warnings, p_professor_user_id, p_professor_user_id, now()
  ) returning * into v_source;

  v_snapshot_hash := encode(digest(convert_to(p_questions::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.exam_room_question_versions (
    exam_id, source_id, version_number, question_count, snapshot_hash, confirmed_by
  ) values (
    v_exam.id, v_source.id, v_source_version, v_count, v_snapshot_hash, p_professor_user_id
  ) returning * into v_version;

  for v_question in select value from jsonb_array_elements(p_questions) order by (value ->> 'ordinal')::integer
  loop
    v_ordinal := (v_question ->> 'ordinal')::integer;
    v_prompt := v_question ->> 'prompt';
    insert into public.exam_room_questions (
      question_version_id, ordinal, prompt_text, maximum_points, prompt_hash
    ) values (
      v_version.id, v_ordinal, v_prompt,
      coalesce(nullif(v_question ->> 'maximumPoints', '')::numeric, 5),
      encode(digest(convert_to(v_prompt, 'UTF8'), 'sha256'), 'hex')
    );
  end loop;

  update public.exam_room_exams
  set active_question_version_id = v_version.id,
      status = 'confirmed', updated_at = now()
  where id = v_exam.id;

  perform public.exam_room_queue_backup(
    v_exam.id,
    'exam_confirmed',
    jsonb_build_object(
      'examId', v_exam.public_id,
      'sourceFileName', p_safe_file_name,
      'sourceHash', p_content_hash,
      'snapshotHash', v_snapshot_hash,
      'questionCount', v_count,
      'questions', p_questions
    )
  );
  insert into public.exam_room_audit_log (
    actor_user_id, exam_id, classroom_id, action, metadata
  ) values (
    p_professor_user_id, v_exam.id, v_exam.classroom_id, 'questions_confirmed',
    jsonb_build_object('questionCount', v_count, 'snapshotHash', v_snapshot_hash, 'sourceHash', p_content_hash)
  );
  return jsonb_build_object(
    'examId', v_exam.public_id,
    'questionVersionId', v_version.id,
    'questionCount', v_count,
    'snapshotHash', v_snapshot_hash,
    'status', 'confirmed'
  );
end;
$$;

create or replace function public.exam_room_schedule_exam(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_opens_at timestamptz,
  p_hard_closes_at timestamptz,
  p_duration_minutes integer,
  p_student_key_hash text,
  p_grading_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam public.exam_room_exams%rowtype;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam from public.exam_room_exams
  where public_id = p_exam_public_id and owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.status <> 'confirmed' or v_exam.active_question_version_id is null then
    raise exception 'EXAM_ROOM_EXAM_NOT_CONFIRMED';
  end if;
  if p_hard_closes_at <= p_opens_at
    or (p_duration_minutes is not null and p_duration_minutes not between 1 and 480)
    or p_student_key_hash !~ '^[0-9a-f]{64}$'
    or p_grading_key_hash !~ '^[0-9a-f]{64}$'
    or p_student_key_hash = p_grading_key_hash
  then raise exception 'EXAM_ROOM_SCHEDULE_INVALID'; end if;
  if not exists (
    select 1 from public.exam_room_roster r
    where r.classroom_id = v_exam.classroom_id and r.status = 'active'
  ) then raise exception 'EXAM_ROOM_ROSTER_REQUIRED'; end if;

  update public.exam_room_exams
  set opens_at = p_opens_at, hard_closes_at = p_hard_closes_at,
      duration_minutes = p_duration_minutes, status = 'scheduled', updated_at = now()
  where id = v_exam.id;

  insert into public.exam_room_credentials (
    exam_id, credential_type, token_hash, status, valid_from, expires_at, created_by
  ) values
    (v_exam.id, 'student_exam', p_student_key_hash, 'active', p_opens_at, p_hard_closes_at, p_professor_user_id),
    (v_exam.id, 'professor_grading', p_grading_key_hash, 'active', p_hard_closes_at, p_hard_closes_at + interval '180 days', p_professor_user_id);

  insert into public.exam_room_audit_log (
    actor_user_id, exam_id, classroom_id, action, metadata
  ) values (
    p_professor_user_id, v_exam.id, v_exam.classroom_id, 'exam_scheduled',
    jsonb_build_object('opensAt', p_opens_at, 'hardClosesAt', p_hard_closes_at, 'durationMinutes', p_duration_minutes)
  );
  return jsonb_build_object('examId', v_exam.public_id, 'status', 'scheduled', 'opensAt', p_opens_at, 'hardClosesAt', p_hard_closes_at);
end;
$$;

create or replace function public.exam_room_check_credential(
  p_actor_user_id uuid,
  p_exam_id uuid,
  p_credential_type text,
  p_presented_hash text,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_credential public.exam_room_credentials%rowtype;
  v_window public.exam_room_credential_windows%rowtype;
  v_failures integer;
begin
  if p_presented_hash !~ '^[0-9a-f]{64}$' or p_rate_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'EXAM_ROOM_CREDENTIAL_INPUT_INVALID';
  end if;
  select * into v_credential
  from public.exam_room_credentials
  where exam_id = p_exam_id and credential_type = p_credential_type
    and status = 'active'
    and (scoped_user_id is null or scoped_user_id = p_actor_user_id)
  order by created_at desc limit 1;
  if not found then return jsonb_build_object('ok', false, 'code', 'CREDENTIAL_NOT_ACTIVE'); end if;
  if (v_credential.valid_from is not null and now() < v_credential.valid_from)
    or now() >= v_credential.expires_at
  then return jsonb_build_object('ok', false, 'code', 'CREDENTIAL_NOT_ACTIVE'); end if;

  select * into v_window
  from public.exam_room_credential_windows
  where exam_id = p_exam_id and actor_user_id = p_actor_user_id
    and credential_type = p_credential_type and rate_key_hash = p_rate_key_hash
  for update;
  if found and v_window.locked_until is not null and v_window.locked_until > now() then
    return jsonb_build_object('ok', false, 'code', 'CREDENTIAL_LOCKED', 'lockedUntil', v_window.locked_until);
  end if;
  if v_credential.token_hash <> p_presented_hash then
    if not found or v_window.window_started_at < now() - interval '15 minutes' then
      insert into public.exam_room_credential_windows (
        exam_id, actor_user_id, credential_type, rate_key_hash, failures, window_started_at
      ) values (p_exam_id, p_actor_user_id, p_credential_type, p_rate_key_hash, 1, now())
      on conflict (exam_id, actor_user_id, credential_type, rate_key_hash)
      where exam_id is not null
      do update set failures = 1, window_started_at = now(), locked_until = null, updated_at = now()
      returning failures into v_failures;
    else
      v_failures := least(v_window.failures + 1, 5);
      update public.exam_room_credential_windows
      set failures = v_failures,
          locked_until = case when v_failures >= 5 then now() + interval '15 minutes' else null end,
          updated_at = now()
      where id = v_window.id;
    end if;
    insert into public.exam_room_audit_log (
      actor_user_id, exam_id, action, metadata
    ) values (
      p_actor_user_id, p_exam_id, 'credential_failed',
      jsonb_build_object('credentialType', p_credential_type)
    );
    return jsonb_build_object('ok', false, 'code', case when v_failures >= 5 then 'CREDENTIAL_LOCKED' else 'CREDENTIAL_INVALID' end);
  end if;
  delete from public.exam_room_credential_windows
  where exam_id = p_exam_id and actor_user_id = p_actor_user_id
    and credential_type = p_credential_type and rate_key_hash = p_rate_key_hash;
  return jsonb_build_object('ok', true, 'credentialId', v_credential.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Student entry, autosave, integrity, and submission
-- ---------------------------------------------------------------------------

create or replace function public.exam_room_start_attempt(
  p_student_user_id uuid,
  p_exam_public_id uuid,
  p_student_key_hash text,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_roster public.exam_room_roster%rowtype;
  v_attempt public.exam_room_attempts%rowtype;
  v_email text;
  v_credential jsonb;
  v_deadline timestamptz;
begin
  select lower(email) into v_email from auth.users where id = p_student_user_id;
  if v_email is null then raise exception 'EXAM_ROOM_AUTH_REQUIRED'; end if;
  select * into v_exam from public.exam_room_exams
  where public_id = p_exam_public_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if now() < v_exam.opens_at then return jsonb_build_object('ok', false, 'code', 'EXAM_NOT_OPEN'); end if;
  if now() >= v_exam.hard_closes_at or v_exam.status in ('closed', 'grading', 'sealed') then
    return jsonb_build_object('ok', false, 'code', 'EXAM_CLOSED');
  end if;

  select * into v_roster
  from public.exam_room_roster
  where classroom_id = v_exam.classroom_id and status = 'active'
    and (student_user_id = p_student_user_id or canonical_email = v_email)
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'ROSTER_REQUIRED'); end if;
  if v_roster.student_user_id is null then
    update public.exam_room_roster set student_user_id = p_student_user_id, updated_at = now()
    where id = v_roster.id;
    v_roster.student_user_id := p_student_user_id;
  elsif v_roster.student_user_id <> p_student_user_id then
    return jsonb_build_object('ok', false, 'code', 'ROSTER_ACCOUNT_MISMATCH');
  end if;

  select * into v_attempt from public.exam_room_attempts
  where exam_id = v_exam.id and student_user_id = p_student_user_id;
  if found then
    return jsonb_build_object(
      'ok', true, 'resumed', true, 'attemptId', v_attempt.public_id,
      'status', v_attempt.status, 'serverDeadline', v_attempt.server_deadline
    );
  end if;

  v_credential := public.exam_room_check_credential(
    p_student_user_id, v_exam.id, 'student_exam', p_student_key_hash, p_rate_key_hash
  );
  if not (v_credential ->> 'ok')::boolean then return v_credential; end if;

  v_deadline := least(
    v_exam.hard_closes_at,
    case when v_exam.duration_minutes is null then v_exam.hard_closes_at
      else now() + make_interval(mins => v_exam.duration_minutes) end
  );

  insert into public.exam_room_attempts (
    exam_id, question_version_id, roster_id, student_user_id,
    candidate_number, server_deadline
  ) values (
    v_exam.id, v_exam.active_question_version_id, v_roster.id, p_student_user_id,
    v_roster.candidate_number, v_deadline
  ) returning * into v_attempt;

  update public.exam_room_exams set status = 'open', updated_at = now()
  where id = v_exam.id and status = 'scheduled';
  insert into public.exam_room_audit_log (
    actor_user_id, exam_id, classroom_id, attempt_id, action,
    metadata
  ) values (
    p_student_user_id, v_exam.id, v_exam.classroom_id, v_attempt.id, 'attempt_started',
    jsonb_build_object('candidateNumber', v_roster.candidate_number, 'serverDeadline', v_deadline)
  );
  return jsonb_build_object(
    'ok', true, 'resumed', false, 'attemptId', v_attempt.public_id,
    'status', v_attempt.status, 'serverDeadline', v_attempt.server_deadline
  );
exception
  when unique_violation then
    select * into v_attempt from public.exam_room_attempts
    where exam_id = v_exam.id and student_user_id = p_student_user_id;
    return jsonb_build_object(
      'ok', true, 'resumed', true, 'attemptId', v_attempt.public_id,
      'status', v_attempt.status, 'serverDeadline', v_attempt.server_deadline
    );
end;
$$;

create or replace function public.exam_room_attempt_view(
  p_student_user_id uuid,
  p_attempt_public_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_exam public.exam_room_exams%rowtype;
  v_questions jsonb;
begin
  select * into v_attempt from public.exam_room_attempts
  where public_id = p_attempt_public_id and student_user_id = p_student_user_id;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  select * into v_exam from public.exam_room_exams where id = v_attempt.exam_id;
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', q.id,
      'ordinal', q.ordinal,
      'prompt', q.prompt_text,
      'maximumPoints', q.maximum_points,
      'answer', coalesce(a.answer_text, ''),
      'revision', coalesce(a.revision, 0),
      'savedAt', a.saved_at
    ) order by q.ordinal
  ), '[]'::jsonb) into v_questions
  from public.exam_room_questions q
  left join public.exam_room_answers a
    on a.question_id = q.id and a.attempt_id = v_attempt.id
  where q.question_version_id = v_attempt.question_version_id;
  return jsonb_build_object(
    'attemptId', v_attempt.public_id,
    'examId', v_exam.public_id,
    'title', v_exam.title,
    'instructions', v_exam.instructions,
    'integrityPreset', v_exam.integrity_preset,
    'integrityDisclosure', 'Browser integrity controls are deterrents and incident records; they cannot detect every outside device or operating-system action.',
    'status', v_attempt.status,
    'serverNow', now(),
    'serverDeadline', v_attempt.server_deadline,
    'hardClosesAt', v_exam.hard_closes_at,
    'questions', v_questions
  );
end;
$$;

create or replace function public.exam_room_submit_attempt_internal(
  p_attempt_id uuid,
  p_automatic boolean,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_exam public.exam_room_exams%rowtype;
  v_questions jsonb;
  v_answers jsonb;
  v_status text;
begin
  select * into v_attempt from public.exam_room_attempts where id = p_attempt_id for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.status in ('submitted', 'auto_submitted', 'sealed') then
    return jsonb_build_object('ok', true, 'alreadySubmitted', true, 'status', v_attempt.status, 'submittedAt', v_attempt.submitted_at);
  end if;
  select * into v_exam from public.exam_room_exams where id = v_attempt.exam_id;
  v_status := case when p_automatic then 'auto_submitted' else 'submitted' end;
  update public.exam_room_attempts
  set status = v_status, submitted_at = now(), submission_request_key = p_request_key,
      updated_at = now()
  where id = v_attempt.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'questionId', q.id, 'ordinal', q.ordinal, 'promptHash', q.prompt_hash
  ) order by q.ordinal), '[]'::jsonb) into v_questions
  from public.exam_room_questions q where q.question_version_id = v_attempt.question_version_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'questionId', a.question_id, 'answerText', a.answer_text,
    'revision', a.revision, 'savedAt', a.saved_at
  ) order by q.ordinal), '[]'::jsonb) into v_answers
  from public.exam_room_questions q
  left join public.exam_room_answers a
    on a.question_id = q.id and a.attempt_id = v_attempt.id
  where q.question_version_id = v_attempt.question_version_id;

  perform public.exam_room_queue_backup(
    v_exam.id,
    'attempt_submitted',
    jsonb_build_object(
      'attemptId', v_attempt.public_id,
      'candidateNumber', v_attempt.candidate_number,
      'studentUserId', v_attempt.student_user_id,
      'startedAt', v_attempt.started_at,
      'serverDeadline', v_attempt.server_deadline,
      'submittedAt', now(),
      'automatic', p_automatic,
      'questions', v_questions,
      'answers', v_answers,
      'integrityIncidentCount', (
        select count(*) from public.exam_room_integrity_events e where e.attempt_id = v_attempt.id
      )
    )
  );
  insert into public.exam_room_audit_log (
    actor_user_id, exam_id, classroom_id, attempt_id, action, metadata
  ) values (
    v_attempt.student_user_id, v_exam.id, v_exam.classroom_id, v_attempt.id,
    case when p_automatic then 'attempt_auto_submitted' else 'attempt_submitted' end,
    jsonb_build_object('candidateNumber', v_attempt.candidate_number)
  );
  return jsonb_build_object('ok', true, 'status', v_status, 'submittedAt', now());
end;
$$;

create or replace function public.exam_room_save_answer(
  p_student_user_id uuid,
  p_attempt_public_id uuid,
  p_question_id uuid,
  p_answer_text text,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_answer public.exam_room_answers%rowtype;
begin
  if char_length(coalesce(p_answer_text, '')) > 20000 then raise exception 'EXAM_ROOM_ANSWER_TOO_LONG'; end if;
  if p_expected_revision is null or p_expected_revision < 0 then raise exception 'EXAM_ROOM_REVISION_INVALID'; end if;
  select * into v_attempt from public.exam_room_attempts
  where public_id = p_attempt_public_id and student_user_id = p_student_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.status not in ('in_progress') then
    return jsonb_build_object('ok', false, 'code', case when v_attempt.status = 'locked' then 'ATTEMPT_LOCKED' else 'ATTEMPT_CLOSED' end);
  end if;
  if now() >= v_attempt.server_deadline then
    perform public.exam_room_submit_attempt_internal(v_attempt.id, true, 'deadline-auto-submit');
    return jsonb_build_object('ok', false, 'code', 'ATTEMPT_CLOSED');
  end if;
  if not exists (
    select 1 from public.exam_room_questions q
    where q.id = p_question_id and q.question_version_id = v_attempt.question_version_id
  ) then raise exception 'EXAM_ROOM_QUESTION_NOT_FOUND'; end if;

  select * into v_answer from public.exam_room_answers
  where attempt_id = v_attempt.id and question_id = p_question_id
  for update;
  if found and v_answer.revision <> p_expected_revision then
    return jsonb_build_object('ok', false, 'code', 'ANSWER_CONFLICT', 'revision', v_answer.revision, 'savedAt', v_answer.saved_at);
  end if;
  if not found and p_expected_revision <> 0 then
    return jsonb_build_object('ok', false, 'code', 'ANSWER_CONFLICT', 'revision', 0);
  end if;

  insert into public.exam_room_answers (
    attempt_id, question_id, answer_text, revision, saved_at
  ) values (
    v_attempt.id, p_question_id, coalesce(p_answer_text, ''), 1, now()
  )
  on conflict (attempt_id, question_id) do update
  set answer_text = excluded.answer_text,
      revision = public.exam_room_answers.revision + 1,
      saved_at = now()
  returning * into v_answer;
  update public.exam_room_attempts
  set last_heartbeat_at = now(), updated_at = now() where id = v_attempt.id;
  return jsonb_build_object('ok', true, 'revision', v_answer.revision, 'savedAt', v_answer.saved_at);
end;
$$;

create or replace function public.exam_room_heartbeat(
  p_student_user_id uuid,
  p_attempt_public_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
begin
  select * into v_attempt from public.exam_room_attempts
  where public_id = p_attempt_public_id and student_user_id = p_student_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.status in ('submitted', 'auto_submitted', 'sealed') then
    return jsonb_build_object('ok', false, 'code', 'ATTEMPT_CLOSED', 'status', v_attempt.status);
  end if;
  if now() >= v_attempt.server_deadline then
    return public.exam_room_submit_attempt_internal(v_attempt.id, true, 'deadline-auto-submit');
  end if;
  update public.exam_room_attempts set last_heartbeat_at = now(), updated_at = now()
  where id = v_attempt.id;
  return jsonb_build_object('ok', true, 'serverNow', now(), 'serverDeadline', v_attempt.server_deadline, 'status', v_attempt.status);
end;
$$;

create or replace function public.exam_room_record_integrity_event(
  p_student_user_id uuid,
  p_attempt_public_id uuid,
  p_event_type text,
  p_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_exam public.exam_room_exams%rowtype;
  v_count integer;
  v_threshold integer;
  v_locked boolean := false;
begin
  if p_event_type not in (
    'fullscreen_exit', 'visibility_exit', 'focus_exit', 'copy_attempt',
    'paste_attempt', 'context_menu_attempt', 'heartbeat_gap', 'network_gap'
  ) or jsonb_typeof(p_details) <> 'object' or octet_length(p_details::text) > 4000 then
    raise exception 'EXAM_ROOM_INTEGRITY_EVENT_INVALID';
  end if;
  if public.exam_room_json_has_forbidden_key(p_details) then
    raise exception 'EXAM_ROOM_INTEGRITY_DETAILS_SENSITIVE';
  end if;
  select * into v_attempt from public.exam_room_attempts
  where public_id = p_attempt_public_id and student_user_id = p_student_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.status <> 'in_progress' then
    return jsonb_build_object('ok', false, 'code', case when v_attempt.status = 'locked' then 'ATTEMPT_LOCKED' else 'ATTEMPT_CLOSED' end);
  end if;
  select * into v_exam from public.exam_room_exams where id = v_attempt.exam_id;
  insert into public.exam_room_integrity_events (
    exam_id, attempt_id, student_user_id, event_type, details
  ) values (v_exam.id, v_attempt.id, p_student_user_id, p_event_type, p_details);
  select count(*) into v_count from public.exam_room_integrity_events
  where attempt_id = v_attempt.id and event_type not in ('warning', 'lock', 'unlock');
  v_threshold := case v_exam.integrity_preset when 'strict' then 3 when 'standard' then 5 else 2147483647 end;
  if v_count >= v_threshold then
    update public.exam_room_attempts
    set status = 'locked', locked_at = now(), lock_reason = 'Configured integrity-event threshold reached.', updated_at = now()
    where id = v_attempt.id;
    insert into public.exam_room_integrity_events (
      exam_id, attempt_id, student_user_id, event_type, details
    ) values (v_exam.id, v_attempt.id, p_student_user_id, 'lock', jsonb_build_object('threshold', v_threshold));
    v_locked := true;
  end if;
  return jsonb_build_object('ok', true, 'incidentCount', v_count, 'locked', v_locked, 'threshold', case when v_exam.integrity_preset = 'open_book' then null else v_threshold end);
end;
$$;

create or replace function public.exam_room_submit_attempt(
  p_student_user_id uuid,
  p_attempt_public_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
begin
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then raise exception 'EXAM_ROOM_REQUEST_KEY_INVALID'; end if;
  select * into v_attempt from public.exam_room_attempts
  where public_id = p_attempt_public_id and student_user_id = p_student_user_id;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.status = 'locked' then return jsonb_build_object('ok', false, 'code', 'ATTEMPT_LOCKED'); end if;
  return public.exam_room_submit_attempt_internal(v_attempt.id, false, p_request_key);
end;
$$;

create or replace function public.exam_room_auto_submit_due(p_exam_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt record;
  v_count integer := 0;
begin
  for v_attempt in
    select id from public.exam_room_attempts
    where status in ('in_progress', 'locked') and server_deadline <= now()
      and (p_exam_id is null or exam_id = p_exam_id)
    for update skip locked
  loop
    perform public.exam_room_submit_attempt_internal(v_attempt.id, true, 'deadline-auto-submit');
    v_count := v_count + 1;
  end loop;
  update public.exam_room_exams
  set status = 'closed', updated_at = now()
  where status in ('scheduled', 'open') and hard_closes_at <= now()
    and (p_exam_id is null or id = p_exam_id);
  return jsonb_build_object('autoSubmitted', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- Professor grading, release, dispute review, and asynchronous delivery
-- ---------------------------------------------------------------------------

create or replace function public.exam_room_grading_workspace(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_grading_key_hash text,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_credential jsonb;
  v_candidates jsonb;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam from public.exam_room_exams
  where public_id = p_exam_public_id and owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if now() < v_exam.hard_closes_at then return jsonb_build_object('ok', false, 'code', 'GRADING_NOT_OPEN'); end if;
  perform public.exam_room_auto_submit_due(v_exam.id);
  v_credential := public.exam_room_check_credential(
    p_professor_user_id, v_exam.id, 'professor_grading', p_grading_key_hash, p_rate_key_hash
  );
  if not (v_credential ->> 'ok')::boolean then return v_credential; end if;
  update public.exam_room_exams set status = 'grading', updated_at = now()
  where id = v_exam.id and status <> 'sealed';

  select coalesce(jsonb_agg(candidate_data order by candidate_number), '[]'::jsonb) into v_candidates
  from (
    select a.candidate_number,
      jsonb_build_object(
        'attemptId', a.public_id,
        'candidateNumber', a.candidate_number,
        'status', a.status,
        'submittedAt', a.submitted_at,
        'incidentCount', (select count(*) from public.exam_room_integrity_events ie where ie.attempt_id = a.id),
        'questions', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'questionId', q.id,
            'ordinal', q.ordinal,
            'prompt', q.prompt_text,
            'answer', coalesce(ans.answer_text, ''),
            'maximumPoints', q.maximum_points,
            'score', g.score,
            'comment', g.professor_comment,
            'gradeState', g.grade_state,
            'gradeRevision', coalesce(g.revision, 0)
          ) order by q.ordinal), '[]'::jsonb)
          from public.exam_room_questions q
          left join public.exam_room_answers ans on ans.attempt_id = a.id and ans.question_id = q.id
          left join public.exam_room_grades g on g.attempt_id = a.id and g.question_id = q.id
          where q.question_version_id = a.question_version_id
        )
      ) candidate_data
    from public.exam_room_attempts a
    where a.exam_id = v_exam.id
  ) q;
  return jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'title', v_exam.title,
    'questionCount', v_exam.requested_question_count,
    'candidates', v_candidates
  );
end;
$$;

create or replace function public.exam_room_save_grade(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_attempt_public_id uuid,
  p_question_id uuid,
  p_score numeric,
  p_comment text,
  p_grade_state text,
  p_expected_revision integer,
  p_change_reason text,
  p_grading_key_hash text,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_attempt public.exam_room_attempts%rowtype;
  v_question public.exam_room_questions%rowtype;
  v_grade public.exam_room_grades%rowtype;
  v_credential jsonb;
  v_revision integer;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam from public.exam_room_exams
  where public_id = p_exam_public_id and owner_professor_id = p_professor_user_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.status = 'sealed' then raise exception 'EXAM_ROOM_SEALED'; end if;
  if now() < v_exam.hard_closes_at then raise exception 'EXAM_ROOM_GRADING_NOT_OPEN'; end if;
  if char_length(coalesce(p_comment, '')) > 5000
    or p_grade_state not in ('draft', 'final')
    or p_expected_revision is null or p_expected_revision < 0
    or char_length(btrim(p_change_reason)) not between 5 and 1000
  then raise exception 'EXAM_ROOM_GRADE_INVALID'; end if;
  v_credential := public.exam_room_check_credential(
    p_professor_user_id, v_exam.id, 'professor_grading', p_grading_key_hash, p_rate_key_hash
  );
  if not (v_credential ->> 'ok')::boolean then return v_credential; end if;
  select * into v_attempt from public.exam_room_attempts
  where public_id = p_attempt_public_id and exam_id = v_exam.id;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  select * into v_question from public.exam_room_questions
  where id = p_question_id and question_version_id = v_attempt.question_version_id;
  if not found then raise exception 'EXAM_ROOM_QUESTION_NOT_FOUND'; end if;
  if p_score < 0 or p_score > v_question.maximum_points then raise exception 'EXAM_ROOM_SCORE_INVALID'; end if;

  select * into v_grade from public.exam_room_grades
  where attempt_id = v_attempt.id and question_id = p_question_id for update;
  if found and v_grade.revision <> p_expected_revision then
    return jsonb_build_object('ok', false, 'code', 'GRADE_CONFLICT', 'revision', v_grade.revision);
  end if;
  if not found and p_expected_revision <> 0 then
    return jsonb_build_object('ok', false, 'code', 'GRADE_CONFLICT', 'revision', 0);
  end if;
  v_revision := case when found then v_grade.revision + 1 else 1 end;
  insert into public.exam_room_grades (
    attempt_id, question_id, score, maximum_points, professor_comment,
    grade_state, revision, graded_by, graded_at, finalized_at
  ) values (
    v_attempt.id, p_question_id, p_score, v_question.maximum_points, coalesce(p_comment, ''),
    p_grade_state, v_revision, p_professor_user_id, now(),
    case when p_grade_state = 'final' then now() else null end
  )
  on conflict (attempt_id, question_id) do update
  set score = excluded.score,
      maximum_points = excluded.maximum_points,
      professor_comment = excluded.professor_comment,
      grade_state = excluded.grade_state,
      revision = excluded.revision,
      graded_by = excluded.graded_by,
      graded_at = now(),
      finalized_at = excluded.finalized_at;

  insert into public.exam_room_grade_history (
    attempt_id, question_id, revision, score, maximum_points,
    professor_comment, grade_state, changed_by, change_reason
  ) values (
    v_attempt.id, p_question_id, v_revision, p_score, v_question.maximum_points,
    coalesce(p_comment, ''), p_grade_state, p_professor_user_id, p_change_reason
  );
  return jsonb_build_object('ok', true, 'revision', v_revision, 'gradeState', p_grade_state, 'savedAt', now());
end;
$$;

create or replace function public.exam_room_unlock_attempt(
  p_actor_user_id uuid,
  p_attempt_public_id uuid,
  p_reason text,
  p_grading_key_hash text default null,
  p_rate_key_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_exam public.exam_room_exams%rowtype;
  v_credential jsonb;
begin
  if char_length(btrim(p_reason)) not between 5 and 1000 then raise exception 'EXAM_ROOM_REASON_REQUIRED'; end if;
  select * into v_attempt from public.exam_room_attempts where public_id = p_attempt_public_id for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  select * into v_exam from public.exam_room_exams where id = v_attempt.exam_id;
  if v_exam.status = 'sealed' then raise exception 'EXAM_ROOM_SEALED'; end if;
  if not public.exam_room_is_admin(p_actor_user_id) then
    if v_exam.owner_professor_id <> p_actor_user_id then raise exception 'EXAM_ROOM_PROFESSOR_REQUIRED'; end if;
    v_credential := public.exam_room_check_credential(
      p_actor_user_id, v_exam.id, 'professor_grading', p_grading_key_hash, p_rate_key_hash
    );
    if not (v_credential ->> 'ok')::boolean then return v_credential; end if;
  end if;
  if v_attempt.status <> 'locked' then return jsonb_build_object('ok', true, 'status', v_attempt.status); end if;
  if now() >= v_attempt.server_deadline then
    return public.exam_room_submit_attempt_internal(v_attempt.id, true, 'deadline-auto-submit');
  end if;
  update public.exam_room_attempts
  set status = 'in_progress', locked_at = null, lock_reason = null, updated_at = now()
  where id = v_attempt.id;
  insert into public.exam_room_integrity_events (
    exam_id, attempt_id, student_user_id, event_type, details
  ) values (
    v_exam.id, v_attempt.id, v_attempt.student_user_id, 'unlock', jsonb_build_object('reason', p_reason)
  );
  insert into public.exam_room_audit_log (
    actor_user_id, exam_id, classroom_id, attempt_id, action, reason
  ) values (p_actor_user_id, v_exam.id, v_exam.classroom_id, v_attempt.id, 'attempt_unlocked', p_reason);
  return jsonb_build_object('ok', true, 'status', 'in_progress');
end;
$$;

create or replace function public.exam_room_release_results(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_request_key text,
  p_include_questionnaire boolean,
  p_grading_key_hash text,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_release public.exam_room_releases%rowtype;
  v_credential jsonb;
  v_expected integer;
  v_started integer;
  v_submitted integer;
  v_auto integer;
  v_locked integer;
  v_professor_email text;
  v_attempt record;
  v_questions jsonb;
  v_grades jsonb;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then raise exception 'EXAM_ROOM_REQUEST_KEY_INVALID'; end if;
  select * into v_exam from public.exam_room_exams
  where public_id = p_exam_public_id and owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.release_id is not null then
    select * into v_release from public.exam_room_releases where id = v_exam.release_id;
    return jsonb_build_object('ok', true, 'alreadyReleased', true, 'releaseId', v_release.id, 'releasedAt', v_release.released_at);
  end if;
  if now() < v_exam.hard_closes_at then raise exception 'EXAM_ROOM_RELEASE_TOO_EARLY'; end if;
  perform public.exam_room_auto_submit_due(v_exam.id);
  v_credential := public.exam_room_check_credential(
    p_professor_user_id, v_exam.id, 'professor_grading', p_grading_key_hash, p_rate_key_hash
  );
  if not (v_credential ->> 'ok')::boolean then return v_credential; end if;

  if exists (
    select 1 from public.exam_room_attempts a
    join public.exam_room_questions q on q.question_version_id = a.question_version_id
    left join public.exam_room_grades g on g.attempt_id = a.id and g.question_id = q.id
    where a.exam_id = v_exam.id and (g.attempt_id is null or g.grade_state <> 'final')
  ) then raise exception 'EXAM_ROOM_FINAL_GRADES_REQUIRED'; end if;

  select count(*) into v_expected from public.exam_room_roster
  where classroom_id = v_exam.classroom_id and status = 'active';
  select count(*) into v_started from public.exam_room_attempts where exam_id = v_exam.id;
  select count(*) into v_submitted from public.exam_room_attempts where exam_id = v_exam.id and status = 'submitted';
  select count(*) into v_auto from public.exam_room_attempts where exam_id = v_exam.id and status = 'auto_submitted';
  select count(*) into v_locked from public.exam_room_integrity_events where exam_id = v_exam.id and event_type = 'lock';

  insert into public.exam_room_releases (
    exam_id, request_key, released_by, include_questionnaire,
    expected_count, started_count, submitted_count, auto_submitted_count, locked_count
  ) values (
    v_exam.id, p_request_key, p_professor_user_id, coalesce(p_include_questionnaire, false),
    v_expected, v_started, v_submitted, v_auto, v_locked
  ) returning * into v_release;

  update public.exam_room_attempts
  set status = 'sealed', updated_at = now()
  where exam_id = v_exam.id;
  update public.exam_room_credentials
  set status = 'revoked', revoked_by = p_professor_user_id, revoked_at = now(),
      revoke_reason = 'Exam released and sealed.'
  where exam_id = v_exam.id and status = 'active';
  update public.exam_room_exams
  set status = 'sealed', release_id = v_release.id, sealed_at = now(),
      include_questionnaire = coalesce(p_include_questionnaire, false), updated_at = now()
  where id = v_exam.id;

  select lower(email) into v_professor_email from auth.users where id = p_professor_user_id;
  insert into public.exam_room_email_jobs (
    exam_id, release_id, recipient_user_id, recipient_email, email_type, payload
  ) values (
    v_exam.id, v_release.id, p_professor_user_id, v_professor_email,
    'professor_release_summary',
    jsonb_build_object(
      'examId', v_exam.public_id, 'title', v_exam.title,
      'expected', v_expected, 'started', v_started, 'submitted', v_submitted,
      'autoSubmitted', v_auto, 'locked', v_locked
    )
  );

  for v_attempt in
    select a.*, lower(u.email) recipient_email
    from public.exam_room_attempts a
    join auth.users u on u.id = a.student_user_id
    where a.exam_id = v_exam.id
  loop
    select coalesce(jsonb_agg(jsonb_build_object(
      'questionId', q.id,
      'ordinal', q.ordinal,
      'prompt', case when p_include_questionnaire then q.prompt_text else null end
    ) order by q.ordinal), '[]'::jsonb) into v_questions
    from public.exam_room_questions q where q.question_version_id = v_attempt.question_version_id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'questionId', g.question_id,
      'score', g.score,
      'maximumPoints', g.maximum_points,
      'comment', g.professor_comment
    ) order by q.ordinal), '[]'::jsonb) into v_grades
    from public.exam_room_grades g
    join public.exam_room_questions q on q.id = g.question_id
    where g.attempt_id = v_attempt.id;
    insert into public.exam_room_email_jobs (
      exam_id, release_id, recipient_user_id, recipient_email, email_type, payload
    ) values (
      v_exam.id, v_release.id, v_attempt.student_user_id, v_attempt.recipient_email,
      'student_result',
      jsonb_build_object(
        'examId', v_exam.public_id, 'title', v_exam.title,
        'candidateNumber', v_attempt.candidate_number,
        'includeQuestionnaire', p_include_questionnaire,
        'questions', v_questions, 'grades', v_grades
      )
    );
  end loop;

  perform public.exam_room_queue_backup(
    v_exam.id,
    'grades_released',
    jsonb_build_object(
      'releaseId', v_release.id,
      'releasedAt', v_release.released_at,
      'includeQuestionnaire', p_include_questionnaire,
      'summary', jsonb_build_object(
        'expected', v_expected, 'started', v_started, 'submitted', v_submitted,
        'autoSubmitted', v_auto, 'locked', v_locked
      ),
      'grades', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'attemptId', a.public_id, 'candidateNumber', a.candidate_number,
          'questionId', g.question_id, 'score', g.score,
          'maximumPoints', g.maximum_points, 'comment', g.professor_comment,
          'revision', g.revision
        )), '[]'::jsonb)
        from public.exam_room_grades g
        join public.exam_room_attempts a on a.id = g.attempt_id
        where a.exam_id = v_exam.id
      )
    )
  );
  insert into public.exam_room_audit_log (
    actor_user_id, exam_id, classroom_id, action, metadata
  ) values (
    p_professor_user_id, v_exam.id, v_exam.classroom_id, 'results_released_and_sealed',
    jsonb_build_object('releaseId', v_release.id, 'includeQuestionnaire', p_include_questionnaire)
  );
  return jsonb_build_object('ok', true, 'releaseId', v_release.id, 'releasedAt', v_release.released_at, 'sealed', true);
end;
$$;

create or replace function public.exam_room_student_result(
  p_student_user_id uuid,
  p_exam_public_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_attempt public.exam_room_attempts%rowtype;
  v_rows jsonb;
begin
  select * into v_exam from public.exam_room_exams
  where public_id = p_exam_public_id and status = 'sealed';
  if not found then raise exception 'EXAM_ROOM_RESULT_NOT_RELEASED'; end if;
  select * into v_attempt from public.exam_room_attempts
  where exam_id = v_exam.id and student_user_id = p_student_user_id;
  if not found then raise exception 'EXAM_ROOM_RESULT_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'ordinal', q.ordinal,
    'question', case when v_exam.include_questionnaire then q.prompt_text else null end,
    'score', g.score,
    'maximumPoints', g.maximum_points,
    'comment', g.professor_comment
  ) order by q.ordinal), '[]'::jsonb) into v_rows
  from public.exam_room_questions q
  join public.exam_room_grades g on g.question_id = q.id and g.attempt_id = v_attempt.id
  where q.question_version_id = v_attempt.question_version_id;
  return jsonb_build_object(
    'examId', v_exam.public_id, 'title', v_exam.title,
    'candidateNumber', v_attempt.candidate_number,
    'releasedAt', (select released_at from public.exam_room_releases where id = v_exam.release_id),
    'includeQuestionnaire', v_exam.include_questionnaire,
    'grades', v_rows
  );
end;
$$;

create or replace function public.exam_room_open_dispute(
  p_admin_user_id uuid,
  p_exam_public_id uuid,
  p_case_reference text,
  p_reason text,
  p_access_mode text,
  p_token_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_dispute public.exam_room_dispute_reviews%rowtype;
begin
  perform public.exam_room_require_admin(p_admin_user_id);
  select * into v_exam from public.exam_room_exams where public_id = p_exam_public_id and status = 'sealed';
  if not found then raise exception 'EXAM_ROOM_SEALED_EXAM_REQUIRED'; end if;
  if char_length(btrim(p_case_reference)) < 2
    or char_length(btrim(p_case_reference)) > 200 then
    raise exception 'EXAM_ROOM_DISPUTE_INVALID';
  end if;
  if char_length(btrim(p_reason)) < 10 or char_length(btrim(p_reason)) > 2000 then
    raise exception 'EXAM_ROOM_DISPUTE_INVALID';
  end if;
  if p_access_mode <> all (array['read_only', 'correction']::text[])
    or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at <= now()
    or p_expires_at > now() + interval '72 hours' then
    raise exception 'EXAM_ROOM_DISPUTE_INVALID';
  end if;
  insert into public.exam_room_dispute_reviews (
    exam_id, case_reference, reason, access_mode, opened_by, expires_at
  ) values (
    v_exam.id, btrim(p_case_reference), btrim(p_reason), p_access_mode, p_admin_user_id, p_expires_at
  ) returning * into v_dispute;
  insert into public.exam_room_credentials (
    exam_id, credential_type, token_hash, scoped_user_id, status,
    valid_from, expires_at, created_by
  ) values (
    v_exam.id, 'dispute_review', p_token_hash, p_admin_user_id, 'active', now(), p_expires_at, p_admin_user_id
  );
  perform public.exam_room_queue_backup(
    v_exam.id, 'dispute_opened',
    jsonb_build_object('disputeId', v_dispute.id, 'caseReference', v_dispute.case_reference, 'accessMode', v_dispute.access_mode, 'expiresAt', v_dispute.expires_at)
  );
  insert into public.exam_room_audit_log (
    actor_user_id, exam_id, classroom_id, dispute_review_id, action, reason,
    metadata
  ) values (
    p_admin_user_id, v_exam.id, v_exam.classroom_id, v_dispute.id,
    'dispute_review_opened', p_reason,
    jsonb_build_object('caseReference', p_case_reference, 'accessMode', p_access_mode, 'expiresAt', p_expires_at)
  );
  return jsonb_build_object('disputeId', v_dispute.id, 'status', 'open', 'expiresAt', v_dispute.expires_at);
end;
$$;

create or replace function public.exam_room_dispute_view(
  p_admin_user_id uuid,
  p_dispute_id uuid,
  p_token_hash text,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dispute public.exam_room_dispute_reviews%rowtype;
  v_exam public.exam_room_exams%rowtype;
  v_credential jsonb;
begin
  perform public.exam_room_require_admin(p_admin_user_id);
  select * into v_dispute from public.exam_room_dispute_reviews
  where id = p_dispute_id and opened_by = p_admin_user_id and status = 'open';
  if not found then raise exception 'EXAM_ROOM_DISPUTE_NOT_FOUND'; end if;
  if v_dispute.expires_at <= now() then
    update public.exam_room_dispute_reviews set status = 'expired' where id = v_dispute.id;
    update public.exam_room_credentials set status = 'expired'
    where exam_id = v_dispute.exam_id and credential_type = 'dispute_review'
      and scoped_user_id = p_admin_user_id and status = 'active';
    return jsonb_build_object('ok', false, 'code', 'DISPUTE_EXPIRED');
  end if;
  v_credential := public.exam_room_check_credential(
    p_admin_user_id, v_dispute.exam_id, 'dispute_review', p_token_hash, p_rate_key_hash
  );
  if not (v_credential ->> 'ok')::boolean then return v_credential; end if;
  select * into v_exam from public.exam_room_exams where id = v_dispute.exam_id;
  return jsonb_build_object(
    'ok', true,
    'dispute', jsonb_build_object(
      'id', v_dispute.id, 'caseReference', v_dispute.case_reference,
      'reason', v_dispute.reason, 'accessMode', v_dispute.access_mode,
      'openedAt', v_dispute.opened_at, 'expiresAt', v_dispute.expires_at
    ),
    'exam', jsonb_build_object(
      'id', v_exam.public_id, 'title', v_exam.title, 'status', v_exam.status,
      'googleSheetId', v_exam.google_sheet_id
    ),
    'attempts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'attemptId', a.public_id, 'candidateNumber', a.candidate_number,
        'status', a.status, 'startedAt', a.started_at, 'submittedAt', a.submitted_at,
        'answers', (select coalesce(jsonb_agg(jsonb_build_object(
          'questionId', ans.question_id, 'answerText', ans.answer_text,
          'revision', ans.revision, 'savedAt', ans.saved_at
        )), '[]'::jsonb) from public.exam_room_answers ans where ans.attempt_id = a.id),
        'grades', (select coalesce(jsonb_agg(jsonb_build_object(
          'questionId', g.question_id, 'score', g.score, 'maximumPoints', g.maximum_points,
          'comment', g.professor_comment, 'revision', g.revision
        )), '[]'::jsonb) from public.exam_room_grades g where g.attempt_id = a.id)
      )), '[]'::jsonb)
      from public.exam_room_attempts a where a.exam_id = v_exam.id
    ),
    'audit', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'action', l.action, 'reason', l.reason, 'createdAt', l.created_at
      ) order by l.created_at), '[]'::jsonb)
      from public.exam_room_audit_log l where l.exam_id = v_exam.id
    )
  );
end;
$$;

create or replace function public.exam_room_close_dispute(
  p_admin_user_id uuid,
  p_dispute_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dispute public.exam_room_dispute_reviews%rowtype;
begin
  perform public.exam_room_require_admin(p_admin_user_id);
  if char_length(btrim(p_reason)) not between 5 and 1000 then raise exception 'EXAM_ROOM_REASON_REQUIRED'; end if;
  select * into v_dispute from public.exam_room_dispute_reviews
  where id = p_dispute_id and status = 'open' for update;
  if not found then raise exception 'EXAM_ROOM_DISPUTE_NOT_FOUND'; end if;
  update public.exam_room_dispute_reviews
  set status = 'closed', closed_by = p_admin_user_id, closed_at = now(), close_reason = p_reason
  where id = v_dispute.id;
  update public.exam_room_credentials
  set status = 'revoked', revoked_by = p_admin_user_id, revoked_at = now(), revoke_reason = 'Dispute review closed.'
  where exam_id = v_dispute.exam_id and credential_type = 'dispute_review' and status = 'active';
  perform public.exam_room_queue_backup(
    v_dispute.exam_id, 'dispute_closed',
    jsonb_build_object('disputeId', v_dispute.id, 'closedAt', now())
  );
  insert into public.exam_room_audit_log (
    actor_user_id, exam_id, dispute_review_id, action, reason
  ) values (p_admin_user_id, v_dispute.exam_id, v_dispute.id, 'dispute_review_closed', p_reason);
  return jsonb_build_object('ok', true, 'status', 'closed');
end;
$$;

create or replace function public.exam_room_claim_backup_batch(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  if p_limit not between 1 and 100 then raise exception 'EXAM_ROOM_BATCH_LIMIT_INVALID'; end if;
  with claimed as (
    select id from public.exam_room_backup_outbox
    where status in ('pending', 'failed') and next_attempt_at <= now() and attempt_count < 12
    order by created_at
    limit p_limit
    for update skip locked
  ), updated as (
    update public.exam_room_backup_outbox o
    set status = 'processing', processing_started_at = now(), attempt_count = attempt_count + 1
    from claimed c where o.id = c.id
    returning o.*
  )
  select coalesce(jsonb_agg(to_jsonb(updated)), '[]'::jsonb) into v_rows from updated;
  return v_rows;
end;
$$;

create or replace function public.exam_room_complete_backup(
  p_outbox_id uuid,
  p_provider_reference text,
  p_verified_hash text,
  p_google_sheet_id text default null,
  p_professor_access_removed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.exam_room_backup_outbox%rowtype;
begin
  if p_verified_hash !~ '^[0-9a-f]{64}$' or char_length(btrim(p_provider_reference)) not between 1 and 500 then
    raise exception 'EXAM_ROOM_BACKUP_COMPLETION_INVALID';
  end if;
  update public.exam_room_backup_outbox
  set status = 'synced', provider_reference = p_provider_reference,
      verified_hash = p_verified_hash, safe_error_code = null, synced_at = now()
  where id = p_outbox_id and status = 'processing'
  returning * into v_row;
  if not found then raise exception 'EXAM_ROOM_BACKUP_EVENT_NOT_FOUND'; end if;
  if p_google_sheet_id is not null then
    update public.exam_room_exams
    set google_sheet_id = p_google_sheet_id,
        google_professor_access_removed_at = case when p_professor_access_removed then now() else google_professor_access_removed_at end,
        updated_at = now()
    where id = v_row.exam_id;
  end if;
  return jsonb_build_object('ok', true, 'outboxId', v_row.id, 'status', 'synced');
end;
$$;

create or replace function public.exam_room_fail_backup(
  p_outbox_id uuid,
  p_safe_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.exam_room_backup_outbox%rowtype;
begin
  if p_safe_error_code !~ '^[A-Z0-9_]{2,80}$' then raise exception 'EXAM_ROOM_SAFE_ERROR_INVALID'; end if;
  update public.exam_room_backup_outbox
  set status = 'failed', safe_error_code = p_safe_error_code,
      next_attempt_at = now() + least(interval '60 minutes', make_interval(secs => (2 ^ greatest(attempt_count - 1, 0))::integer * 30))
  where id = p_outbox_id and status = 'processing'
  returning * into v_row;
  if not found then raise exception 'EXAM_ROOM_BACKUP_EVENT_NOT_FOUND'; end if;
  return jsonb_build_object('ok', true, 'outboxId', v_row.id, 'status', 'failed', 'nextAttemptAt', v_row.next_attempt_at);
end;
$$;

create or replace function public.exam_room_claim_email_batch(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  if p_limit not between 1 and 100 then raise exception 'EXAM_ROOM_BATCH_LIMIT_INVALID'; end if;
  with claimed as (
    select id from public.exam_room_email_jobs
    where status in ('pending', 'failed') and next_attempt_at <= now() and attempt_count < 8
    order by created_at
    limit p_limit
    for update skip locked
  ), updated as (
    update public.exam_room_email_jobs j
    set status = 'processing', attempt_count = attempt_count + 1
    from claimed c where j.id = c.id
    returning j.*
  )
  select coalesce(jsonb_agg(to_jsonb(updated)), '[]'::jsonb) into v_rows from updated;
  return v_rows;
end;
$$;

create or replace function public.exam_room_complete_email(
  p_job_id uuid,
  p_provider_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.exam_room_email_jobs
  set status = 'sent', provider_id = p_provider_id, safe_error_code = null, sent_at = now()
  where id = p_job_id and status = 'processing';
  if not found then raise exception 'EXAM_ROOM_EMAIL_JOB_NOT_FOUND'; end if;
  return jsonb_build_object('ok', true, 'jobId', p_job_id, 'status', 'sent');
end;
$$;

create or replace function public.exam_room_fail_email(
  p_job_id uuid,
  p_safe_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_safe_error_code !~ '^[A-Z0-9_]{2,80}$' then raise exception 'EXAM_ROOM_SAFE_ERROR_INVALID'; end if;
  update public.exam_room_email_jobs
  set status = 'failed', safe_error_code = p_safe_error_code,
      next_attempt_at = now() + least(interval '60 minutes', make_interval(secs => (2 ^ greatest(attempt_count - 1, 0))::integer * 30))
  where id = p_job_id and status = 'processing';
  if not found then raise exception 'EXAM_ROOM_EMAIL_JOB_NOT_FOUND'; end if;
  return jsonb_build_object('ok', true, 'jobId', p_job_id, 'status', 'failed');
end;
$$;

create or replace function public.exam_room_admin_correct_grade(
  p_admin_user_id uuid,
  p_dispute_id uuid,
  p_attempt_public_id uuid,
  p_question_id uuid,
  p_score numeric,
  p_comment text,
  p_reason text,
  p_token_hash text,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dispute public.exam_room_dispute_reviews%rowtype;
  v_attempt public.exam_room_attempts%rowtype;
  v_question public.exam_room_questions%rowtype;
  v_grade public.exam_room_grades%rowtype;
  v_credential jsonb;
  v_revision integer;
  v_email text;
begin
  perform public.exam_room_require_admin(p_admin_user_id);
  if char_length(btrim(p_reason)) not between 10 and 1000 or char_length(coalesce(p_comment, '')) > 5000 then
    raise exception 'EXAM_ROOM_CORRECTION_INVALID';
  end if;
  select * into v_dispute from public.exam_room_dispute_reviews
  where id = p_dispute_id and status = 'open' and access_mode = 'correction';
  if not found or v_dispute.expires_at <= now() then raise exception 'EXAM_ROOM_CORRECTION_AUTH_REQUIRED'; end if;
  v_credential := public.exam_room_check_credential(
    p_admin_user_id, v_dispute.exam_id, 'dispute_review', p_token_hash, p_rate_key_hash
  );
  if not (v_credential ->> 'ok')::boolean then return v_credential; end if;
  select * into v_attempt from public.exam_room_attempts
  where public_id = p_attempt_public_id and exam_id = v_dispute.exam_id;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  select * into v_question from public.exam_room_questions
  where id = p_question_id and question_version_id = v_attempt.question_version_id;
  if not found then raise exception 'EXAM_ROOM_QUESTION_NOT_FOUND'; end if;
  if p_score < 0 or p_score > v_question.maximum_points then raise exception 'EXAM_ROOM_SCORE_INVALID'; end if;
  select * into v_grade from public.exam_room_grades
  where attempt_id = v_attempt.id and question_id = p_question_id;
  if not found then raise exception 'EXAM_ROOM_GRADE_NOT_FOUND'; end if;
  v_revision := v_grade.revision + 1;

  perform set_config('app.exam_room_admin_correction', 'on', true);

  -- The previous released record is preserved in grade_history; this appends a
  -- new correction revision and never deletes the original evidence.
  insert into public.exam_room_grade_history (
    attempt_id, question_id, revision, score, maximum_points,
    professor_comment, grade_state, changed_by, change_reason
  ) values (
    v_attempt.id, p_question_id, v_revision, p_score, v_question.maximum_points,
    coalesce(p_comment, ''), 'final', p_admin_user_id, p_reason
  );
  update public.exam_room_grades
  set score = p_score, professor_comment = coalesce(p_comment, ''),
      revision = v_revision, graded_by = p_admin_user_id, graded_at = now(), finalized_at = now()
  where attempt_id = v_attempt.id and question_id = p_question_id;

  perform public.exam_room_queue_backup(
    v_dispute.exam_id, 'admin_correction',
    jsonb_build_object(
      'disputeId', v_dispute.id, 'attemptId', v_attempt.public_id,
      'questionId', p_question_id, 'revision', v_revision,
      'score', p_score, 'maximumPoints', v_question.maximum_points,
      'comment', coalesce(p_comment, ''), 'reason', p_reason
    )
  );
  select lower(email) into v_email from auth.users where id = v_attempt.student_user_id;
  insert into public.exam_room_email_jobs (
    exam_id, release_id, recipient_user_id, recipient_email, email_type, payload
  ) values (
    v_dispute.exam_id,
    (select release_id from public.exam_room_exams where id = v_dispute.exam_id),
    v_attempt.student_user_id, v_email, 'student_correction',
    jsonb_build_object(
      'disputeId', v_dispute.id, 'attemptId', v_attempt.public_id,
      'questionId', p_question_id, 'score', p_score,
      'maximumPoints', v_question.maximum_points, 'comment', coalesce(p_comment, '')
    )
  ) on conflict (exam_id, email_type, recipient_email) do update
  set payload = excluded.payload, status = 'pending', attempt_count = 0,
      next_attempt_at = now(), provider_id = null, safe_error_code = null, sent_at = null;
  insert into public.exam_room_audit_log (
    actor_user_id, exam_id, attempt_id, dispute_review_id, action, reason,
    metadata
  ) values (
    p_admin_user_id, v_dispute.exam_id, v_attempt.id, v_dispute.id,
    'released_grade_corrected', p_reason,
    jsonb_build_object('questionId', p_question_id, 'revision', v_revision)
  );
  return jsonb_build_object('ok', true, 'revision', v_revision, 'correctedAt', now());
end;
$$;

create or replace function public.exam_room_portal_snapshot(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_admin boolean := public.exam_room_is_admin(p_user_id);
  v_is_professor boolean := public.exam_room_is_professor(p_user_id);
  v_email text;
  v_classes jsonb := '[]'::jsonb;
  v_student_exams jsonb := '[]'::jsonb;
begin
  select lower(email) into v_email from auth.users where id = p_user_id;
  if v_email is null then raise exception 'EXAM_ROOM_AUTH_REQUIRED'; end if;
  if v_is_professor then
    select coalesce(jsonb_agg(jsonb_build_object(
      'classroomId', c.public_id,
      'title', c.title,
      'schoolName', c.school_name,
      'academicTerm', c.academic_term,
      'rosterCount', (select count(*) from public.exam_room_roster r where r.classroom_id = c.id and r.status = 'active'),
      'exams', (select coalesce(jsonb_agg(jsonb_build_object(
        'examId', e.public_id, 'title', e.title, 'status', e.status,
        'questionCount', e.requested_question_count,
        'opensAt', e.opens_at, 'hardClosesAt', e.hard_closes_at,
        'sealedAt', e.sealed_at, 'backupSheetReady', e.google_sheet_id is not null
      ) order by e.created_at desc), '[]'::jsonb)
      from public.exam_room_exams e where e.classroom_id = c.id)
    ) order by c.created_at desc), '[]'::jsonb) into v_classes
    from public.exam_room_classrooms c
    where c.owner_professor_id = p_user_id or v_is_admin;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'examId', e.public_id, 'title', e.title, 'status', e.status,
    'opensAt', e.opens_at, 'hardClosesAt', e.hard_closes_at,
    'attemptId', a.public_id, 'attemptStatus', a.status,
    'serverDeadline', a.server_deadline, 'resultReleased', e.status = 'sealed'
  ) order by e.opens_at desc), '[]'::jsonb) into v_student_exams
  from public.exam_room_roster r
  join public.exam_room_exams e on e.classroom_id = r.classroom_id
  left join public.exam_room_attempts a on a.exam_id = e.id and a.student_user_id = p_user_id
  where r.status = 'active' and (r.student_user_id = p_user_id or r.canonical_email = v_email);
  return jsonb_build_object(
    'roles', jsonb_build_object('admin', v_is_admin, 'professor', v_is_professor, 'student', true),
    'classes', v_classes,
    'studentExams', v_student_exams,
    'limits', jsonb_build_object(
      'answerCharacters', 20000, 'commentCharacters', 5000,
      'rosterBytes', 2097152, 'rosterEntries', 500,
      'sourceBytes', 10485760, 'sourcePages', 50,
      'durationMinutesMin', 1, 'durationMinutesMax', 480
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Least privilege. All data and RPCs are Worker-only.
-- ---------------------------------------------------------------------------

do $$
declare
  v_table text;
  v_sequence text;
  v_function regprocedure;
begin
  for v_table in
    select tablename from pg_tables
    where schemaname = 'public' and tablename like 'exam_room_%'
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', v_table);
    execute format('grant select, insert, update, delete on table public.%I to service_role', v_table);
  end loop;

  for v_sequence in
    select sequence_name from information_schema.sequences
    where sequence_schema = 'public' and sequence_name like 'exam_room_%'
  loop
    execute format('revoke all privileges on sequence public.%I from public, anon, authenticated', v_sequence);
    execute format('grant usage, select on sequence public.%I to service_role', v_sequence);
  end loop;

  for v_function in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'exam_room_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_function);
    execute format('grant execute on function %s to service_role', v_function);
  end loop;
end;
$$;

-- The source bucket is private and has no browser object policy. Existing
-- storage permissions and unrelated buckets are not changed.

commit;

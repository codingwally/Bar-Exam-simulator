-- DueDiligence Examination Room 2.0 beta.
--
-- This migration intentionally follows 20260811003000. The Supabase CLI first
-- generated an empty 20260809141407 stub, but that timestamp preceded the
-- Examination Room foundation on which this additive migration depends. The
-- empty stub was reordered before any environment applied it.
--
-- Rollback is intentionally forward-only: disable the 2.0 feature flag/Worker
-- routes first, retain the append-only evidence tables, and deploy a new
-- migration that revokes the v2 RPCs. Do not drop exam evidence during an
-- incident or dispute. See docs/examination-room-2.0-rollback.md.

begin;

-- ---------------------------------------------------------------------------
-- Publication snapshots and exam-level rules
-- ---------------------------------------------------------------------------

create table if not exists public.exam_room_publications (
  id uuid primary key default extensions.gen_random_uuid(),
  public_id uuid not null default extensions.gen_random_uuid() unique,
  exam_id uuid not null references public.exam_room_exams(id) on delete restrict,
  question_version_id uuid not null references public.exam_room_question_versions(id) on delete restrict,
  publication_number integer not null default 1 check (publication_number > 0),
  supersedes_publication_id uuid references public.exam_room_publications(id) on delete restrict,
  replacement_reason text check (
    replacement_reason is null
    or char_length(btrim(replacement_reason)) between 5 and 1000
  ),
  replacement_request_key text check (
    replacement_request_key is null
    or replacement_request_key ~ '^[A-Za-z0-9_-]{16,128}$'
  ),
  title_snapshot text not null check (char_length(btrim(title_snapshot)) between 1 and 200),
  instructions_snapshot text not null check (char_length(instructions_snapshot) <= 10000),
  question_count integer not null check (question_count > 0),
  questions_snapshot jsonb not null check (jsonb_typeof(questions_snapshot) = 'array'),
  rules_snapshot jsonb not null check (jsonb_typeof(rules_snapshot) = 'object'),
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  published_by uuid not null references auth.users(id) on delete restrict,
  published_at timestamptz not null default now(),
  unique (exam_id, publication_number),
  unique (exam_id, snapshot_hash),
  unique (supersedes_publication_id),
  constraint exam_room_publication_replacement_shape_check check (
    (supersedes_publication_id is null and replacement_reason is null and replacement_request_key is null)
    or (supersedes_publication_id is not null and replacement_reason is not null and replacement_request_key is not null)
  ),
  constraint exam_room_publication_question_count_check
    check (jsonb_array_length(questions_snapshot) = question_count),
  constraint exam_room_publication_payload_size_check
    check (octet_length(questions_snapshot::text) <= 4000000 and octet_length(rules_snapshot::text) <= 65536)
);

-- A rehearsal of the beta may have created the original one-publication-only
-- constraint. Replacement publication is append-only, so drop only that
-- constraint and preserve the per-version uniqueness constraints above.
alter table public.exam_room_publications
  drop constraint if exists exam_room_publications_exam_id_key;
alter table public.exam_room_publications
  add column if not exists supersedes_publication_id uuid
    references public.exam_room_publications(id) on delete restrict,
  add column if not exists replacement_reason text,
  add column if not exists replacement_request_key text;
-- The table-level uniqueness constraint already owns the covering index.
-- Remove the rehearsal-era duplicate so the Supabase performance advisor is
-- clean without weakening publication version uniqueness.
drop index if exists public.exam_room_publications_exam_version_v2_uq;
create unique index if not exists exam_room_publications_supersedes_v2_uq
  on public.exam_room_publications (supersedes_publication_id)
  where supersedes_publication_id is not null;
do $exam_room_publication_rehearsal_constraints$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.exam_room_publications'::regclass
      and c.conname = 'exam_room_publications_supersedes_v2_fkey'
  ) then
    alter table public.exam_room_publications
      add constraint exam_room_publications_supersedes_v2_fkey
      foreign key (supersedes_publication_id)
      references public.exam_room_publications(id)
      on delete restrict;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.exam_room_publications'::regclass
      and c.conname = 'exam_room_publications_replacement_reason_v2_check'
  ) then
    alter table public.exam_room_publications
      add constraint exam_room_publications_replacement_reason_v2_check
      check (
        replacement_reason is null
        or char_length(btrim(replacement_reason)) between 5 and 1000
      );
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.exam_room_publications'::regclass
      and c.conname = 'exam_room_publications_replacement_key_v2_check'
  ) then
    alter table public.exam_room_publications
      add constraint exam_room_publications_replacement_key_v2_check
      check (
        replacement_request_key is null
        or replacement_request_key ~ '^[A-Za-z0-9_-]{16,128}$'
      );
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.exam_room_publications'::regclass
      and c.conname = 'exam_room_publications_replacement_shape_v2_check'
  ) then
    alter table public.exam_room_publications
      add constraint exam_room_publications_replacement_shape_v2_check
      check (
        (supersedes_publication_id is null and replacement_reason is null and replacement_request_key is null)
        or (supersedes_publication_id is not null and replacement_reason is not null and replacement_request_key is not null)
      );
  end if;
end;
$exam_room_publication_rehearsal_constraints$;

-- Private model-answer material is deliberately separated from the student
-- publication snapshot. No student or Beadle RPC reads either table.
create table if not exists public.exam_room_model_answer_sources (
  id uuid primary key default extensions.gen_random_uuid(),
  exam_id uuid not null references public.exam_room_exams(id) on delete cascade,
  object_path text not null unique,
  safe_file_name text not null check (char_length(btrim(safe_file_name)) between 1 and 180),
  mime_type text not null check (mime_type in (
    'text/plain',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  unique (exam_id, content_hash)
);

create table if not exists public.exam_room_publication_model_answers (
  publication_id uuid primary key references public.exam_room_publications(id) on delete restrict,
  exam_id uuid not null references public.exam_room_exams(id) on delete restrict,
  mode text not null check (mode in ('paste', 'upload')),
  answer_text text,
  source_id uuid references public.exam_room_model_answer_sources(id) on delete restrict,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint exam_room_private_model_answer_shape_check check (
    (mode = 'paste' and answer_text is not null and char_length(btrim(answer_text)) between 1 and 100000 and source_id is null)
    or (mode = 'upload' and answer_text is null and source_id is not null)
  )
);

alter table public.exam_room_exams
  add column if not exists current_publication_id uuid,
  add column if not exists published_at timestamptz;

alter table public.exam_room_exams
  drop constraint if exists exam_room_exams_current_publication_fkey;
alter table public.exam_room_exams
  add constraint exam_room_exams_current_publication_fkey
  foreign key (current_publication_id)
  references public.exam_room_publications(id)
  on delete restrict
  deferrable initially deferred;

alter table public.exam_room_attempts
  add column if not exists publication_id uuid references public.exam_room_publications(id) on delete restrict;

-- A corrected pre-start question set is staged alongside, rather than over,
-- the source used by the immutable current publication. Keep the foundation's
-- one-`confirmed`-source invariant intact and give replacement provenance its
-- own terminal status. Both states require an attributable confirmation.
alter table public.exam_room_question_sources
  drop constraint if exists exam_room_question_sources_extraction_status_check;
alter table public.exam_room_question_sources
  add constraint exam_room_question_sources_extraction_status_check
  check (extraction_status in ('preview', 'confirmed', 'staged_replacement', 'rejected'));
alter table public.exam_room_question_sources
  drop constraint if exists exam_room_source_confirmation_check;
alter table public.exam_room_question_sources
  add constraint exam_room_source_confirmation_check
  check (
    extraction_status not in ('confirmed', 'staged_replacement')
    or (confirmed_by is not null and confirmed_at is not null)
  );

-- Notification jobs need a per-event idempotency key so multiple immutable
-- publication/reopening generations never overwrite an earlier delivery job.
alter table public.exam_room_email_jobs
  add column if not exists event_key text not null default 'legacy';
alter table public.exam_room_email_jobs
  drop constraint if exists exam_room_email_jobs_event_key_v2_check;
alter table public.exam_room_email_jobs
  add constraint exam_room_email_jobs_event_key_v2_check
  check (event_key ~ '^[A-Za-z0-9_-]{6,128}$');
alter table public.exam_room_email_jobs
  drop constraint if exists exam_room_email_jobs_exam_id_email_type_recipient_email_key;
alter table public.exam_room_email_jobs
  drop constraint if exists exam_room_email_jobs_email_type_check;
alter table public.exam_room_email_jobs
  add constraint exam_room_email_jobs_email_type_check
  check (email_type in (
    'student_result', 'student_correction', 'professor_release_summary',
    'exam_publication_replaced', 'submission_reopened'
  ));
create unique index if not exists exam_room_email_jobs_event_v2_uq
  on public.exam_room_email_jobs (exam_id, email_type, recipient_email, event_key);

-- ---------------------------------------------------------------------------
-- Beadle delegation, admission, accommodations, and identity outcomes
-- ---------------------------------------------------------------------------

create table if not exists public.exam_room_beadle_invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  exam_id uuid not null references public.exam_room_exams(id) on delete cascade,
  target_email text not null check (
    target_email = lower(btrim(target_email))
    and target_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
  ),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'issued' check (status in ('issued', 'redeemed', 'expired', 'revoked')),
  expires_at timestamptz not null,
  delegation_reason text not null check (char_length(btrim(delegation_reason)) between 5 and 1000),
  invited_by uuid not null references auth.users(id) on delete restrict,
  invited_at timestamptz not null default now(),
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason is null or char_length(btrim(revoke_reason)) between 5 and 1000),
  constraint exam_room_beadle_invitation_expiry_check
    check (expires_at > invited_at and expires_at <= invited_at + interval '7 days'),
  constraint exam_room_beadle_invitation_redeemed_check
    check (status <> 'redeemed' or (redeemed_by is not null and redeemed_at is not null)),
  constraint exam_room_beadle_invitation_revoked_check
    check (status <> 'revoked' or (revoked_by is not null and revoked_at is not null and revoke_reason is not null))
);

create unique index if not exists exam_room_beadle_one_active_invitation_idx
  on public.exam_room_beadle_invitations (exam_id, target_email)
  where status = 'issued';

create table if not exists public.exam_room_beadle_assignments (
  id uuid primary key default extensions.gen_random_uuid(),
  exam_id uuid not null references public.exam_room_exams(id) on delete cascade,
  beadle_user_id uuid not null references auth.users(id) on delete restrict,
  invitation_id uuid references public.exam_room_beadle_invitations(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  can_manage_roster boolean not null default true,
  can_manage_operations boolean not null default true,
  can_view_answers boolean not null default false check (can_view_answers = false),
  assigned_by uuid not null references auth.users(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason is null or char_length(btrim(revoke_reason)) between 5 and 1000),
  unique (exam_id, beadle_user_id),
  constraint exam_room_beadle_assignment_expiry_check
    check (expires_at > assigned_at and expires_at <= assigned_at + interval '7 days'),
  constraint exam_room_beadle_assignment_revoked_check
    check (status <> 'revoked' or (revoked_by is not null and revoked_at is not null and revoke_reason is not null))
);

-- Preserve a safe upgrade path if a prior beta rehearsal created the table
-- before delegated access had an explicit lifetime. Invitation-backed rows
-- inherit that invitation's expiry; older exceptional rows get the same
-- seven-day maximum used by invitations.
alter table public.exam_room_beadle_assignments
  add column if not exists expires_at timestamptz;
update public.exam_room_beadle_assignments b
set expires_at = least(
  greatest(
    coalesce(
      (select i.expires_at from public.exam_room_beadle_invitations i where i.id = b.invitation_id),
      b.assigned_at + interval '7 days'
    ),
    b.assigned_at + interval '1 second'
  ),
  b.assigned_at + interval '7 days'
)
where b.expires_at is null;
alter table public.exam_room_beadle_assignments
  alter column expires_at set not null;
alter table public.exam_room_beadle_assignments
  drop constraint if exists exam_room_beadle_assignment_expiry_check;
alter table public.exam_room_beadle_assignments
  add constraint exam_room_beadle_assignment_expiry_check
  check (expires_at > assigned_at and expires_at <= assigned_at + interval '7 days');

create index if not exists exam_room_beadle_user_idx
  on public.exam_room_beadle_assignments (beadle_user_id, status, assigned_at desc);

-- Candidate names are optional operational labels. Email, student number, and
-- candidate number remain the roster identity fields; blank names are stored
-- as NULL instead of an ambiguous empty string.
alter table public.exam_room_roster
  alter column display_name drop not null;
alter table public.exam_room_roster
  drop constraint if exists exam_room_roster_display_name_check;
alter table public.exam_room_roster
  add constraint exam_room_roster_display_name_check
  check (
    display_name is null
    or (display_name = btrim(display_name) and char_length(display_name) between 1 and 200)
  ) not valid;

create table if not exists public.exam_room_admissions (
  id uuid primary key default extensions.gen_random_uuid(),
  exam_id uuid not null references public.exam_room_exams(id) on delete cascade,
  roster_id uuid not null references public.exam_room_roster(id) on delete restrict,
  status text not null default 'eligible'
    check (status in ('eligible', 'admitted', 'denied', 'withdrawn', 'no_show')),
  decided_by uuid not null references auth.users(id) on delete restrict,
  decision_reason text check (decision_reason is null or char_length(btrim(decision_reason)) between 5 and 1000),
  decided_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_id, roster_id)
);

create table if not exists public.exam_room_accommodations (
  id uuid primary key default extensions.gen_random_uuid(),
  exam_id uuid not null references public.exam_room_exams(id) on delete cascade,
  roster_id uuid not null references public.exam_room_roster(id) on delete restrict,
  configuration jsonb not null check (jsonb_typeof(configuration) = 'object'),
  configuration_hash text not null check (configuration_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active', 'revoked')),
  approved_by uuid not null references auth.users(id) on delete restrict,
  approval_reason text not null check (char_length(btrim(approval_reason)) between 5 and 1000),
  approved_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  unique (exam_id, roster_id),
  constraint exam_room_accommodation_size_check check (octet_length(configuration::text) <= 16384)
);

create table if not exists public.exam_room_deadline_extensions (
  id uuid primary key default extensions.gen_random_uuid(),
  attempt_id uuid not null references public.exam_room_attempts(id) on delete restrict,
  accommodation_id uuid references public.exam_room_accommodations(id) on delete restrict,
  previous_deadline timestamptz not null,
  new_deadline timestamptz not null,
  extension_minutes integer not null check (extension_minutes between 1 and 480),
  extension_type text not null check (extension_type in ('accommodation', 'incident', 'administrative')),
  granted_by uuid not null references auth.users(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  granted_at timestamptz not null default now(),
  check (new_deadline > previous_deadline)
);

create index if not exists exam_room_deadline_extensions_attempt_idx
  on public.exam_room_deadline_extensions (attempt_id, granted_at desc);

create table if not exists public.exam_room_identity_verifications (
  id uuid primary key default extensions.gen_random_uuid(),
  exam_id uuid not null references public.exam_room_exams(id) on delete cascade,
  roster_id uuid not null references public.exam_room_roster(id) on delete restrict,
  method text not null check (method in ('physical', 'institutional', 'manual_exception', 'camera_exception')),
  outcome text not null check (outcome in ('verified', 'blocked', 'exception_approved')),
  note text not null default '' check (char_length(note) <= 1000),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now()
);

create index if not exists exam_room_verification_exam_roster_idx
  on public.exam_room_identity_verifications (exam_id, roster_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- Session epochs, local-first answer operations, and preserved branches
-- ---------------------------------------------------------------------------

create table if not exists public.exam_room_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  public_id uuid not null default extensions.gen_random_uuid() unique,
  attempt_id uuid not null references public.exam_room_attempts(id) on delete cascade,
  student_user_id uuid not null references auth.users(id) on delete restrict,
  epoch integer not null check (epoch > 0),
  device_instance_hash text not null check (device_instance_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active', 'transferred', 'closed')),
  opened_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references auth.users(id) on delete set null,
  end_reason text check (end_reason is null or char_length(btrim(end_reason)) between 3 and 1000),
  unique (attempt_id, epoch),
  constraint exam_room_session_end_check
    check (status = 'active' or (ended_at is not null and ended_by is not null and end_reason is not null))
);

create unique index if not exists exam_room_one_active_session_idx
  on public.exam_room_sessions (attempt_id) where status = 'active';

create table if not exists public.exam_room_session_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.exam_room_sessions(id) on delete restrict,
  attempt_id uuid not null references public.exam_room_attempts(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null check (event_type in ('opened', 'resumed', 'transfer_approved', 'transferred', 'closed')),
  epoch integer not null check (epoch > 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  check (octet_length(metadata::text) <= 4000)
);

create index if not exists exam_room_session_events_attempt_idx
  on public.exam_room_session_events (attempt_id, occurred_at desc);

create table if not exists public.exam_room_answer_operations (
  operation_id uuid primary key,
  exam_id uuid not null references public.exam_room_exams(id) on delete restrict,
  attempt_id uuid not null references public.exam_room_attempts(id) on delete cascade,
  question_version_id uuid not null references public.exam_room_question_versions(id) on delete restrict,
  question_id uuid not null references public.exam_room_questions(id) on delete restrict,
  student_user_id uuid not null references auth.users(id) on delete restrict,
  session_id uuid not null references public.exam_room_sessions(id) on delete restrict,
  session_epoch integer not null check (session_epoch > 0),
  local_sequence bigint not null check (local_sequence > 0),
  base_revision integer not null check (base_revision >= 0),
  answer_text text not null check (char_length(answer_text) <= 20000),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  disposition text not null check (disposition in ('applied', 'duplicate_content', 'conflict', 'late_evidence')),
  resulting_revision integer not null check (resulting_revision >= 0),
  client_saved_at timestamptz not null,
  server_received_at timestamptz not null default now(),
  result_json jsonb not null check (jsonb_typeof(result_json) = 'object'),
  unique (session_id, question_id, local_sequence)
);

create index if not exists exam_room_answer_operations_attempt_idx
  on public.exam_room_answer_operations (attempt_id, question_id, server_received_at desc);

create table if not exists public.exam_room_answer_revisions (
  id bigint generated always as identity primary key,
  exam_id uuid not null references public.exam_room_exams(id) on delete restrict,
  attempt_id uuid not null references public.exam_room_attempts(id) on delete cascade,
  question_version_id uuid not null references public.exam_room_question_versions(id) on delete restrict,
  question_id uuid not null references public.exam_room_questions(id) on delete restrict,
  operation_id uuid not null unique references public.exam_room_answer_operations(operation_id) on delete restrict,
  revision integer not null check (revision > 0),
  answer_text text not null check (char_length(answer_text) <= 20000),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  session_epoch integer not null check (session_epoch > 0),
  client_saved_at timestamptz not null,
  committed_at timestamptz not null default now(),
  unique (attempt_id, question_id, revision)
);

create table if not exists public.exam_room_answer_conflict_branches (
  id uuid primary key default extensions.gen_random_uuid(),
  operation_id uuid not null unique references public.exam_room_answer_operations(operation_id) on delete restrict,
  attempt_id uuid not null references public.exam_room_attempts(id) on delete cascade,
  question_id uuid not null references public.exam_room_questions(id) on delete restrict,
  base_revision integer not null check (base_revision >= 0),
  server_revision integer not null check (server_revision >= 0),
  incoming_answer_text text not null check (char_length(incoming_answer_text) <= 20000),
  incoming_content_hash text not null check (incoming_content_hash ~ '^[0-9a-f]{64}$'),
  server_answer_text text not null check (char_length(server_answer_text) <= 20000),
  server_content_hash text not null check (server_content_hash ~ '^[0-9a-f]{64}$'),
  branch_reason text not null default 'stale_revision'
    check (branch_reason in ('stale_revision', 'post_deadline_recovery')),
  client_saved_at timestamptz,
  outage_evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(outage_evidence) = 'object'),
  preserved_at timestamptz not null default now(),
  check (octet_length(outage_evidence::text) <= 8000)
);

-- ---------------------------------------------------------------------------
-- Immutable submission generations, receipts, errata, leave, and incidents
-- ---------------------------------------------------------------------------

create table if not exists public.exam_room_submissions (
  id uuid primary key default extensions.gen_random_uuid(),
  attempt_id uuid not null references public.exam_room_attempts(id) on delete restrict,
  publication_id uuid references public.exam_room_publications(id) on delete restrict,
  generation integer not null check (generation > 0),
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  answer_snapshot jsonb not null check (jsonb_typeof(answer_snapshot) = 'array'),
  answer_snapshot_hash text not null check (answer_snapshot_hash ~ '^[0-9a-f]{64}$'),
  client_answer_set_hash text check (client_answer_set_hash is null or client_answer_set_hash ~ '^[0-9a-f]{64}$'),
  automatic boolean not null default false,
  client_pending_at timestamptz,
  offline_since timestamptz,
  outage_evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(outage_evidence) = 'object'),
  reopening_id uuid,
  prior_submission_id uuid references public.exam_room_submissions(id) on delete restrict,
  committed_at timestamptz not null default now(),
  unique (attempt_id, generation),
  unique (attempt_id, request_key),
  check (octet_length(outage_evidence::text) <= 8000),
  check (offline_since is null or client_pending_at is null or offline_since <= client_pending_at),
  check (
    (reopening_id is null and prior_submission_id is null and generation = 1)
    or (reopening_id is not null and prior_submission_id is not null and generation > 1)
  )
);

create table if not exists public.exam_room_submission_receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  public_id uuid not null default extensions.gen_random_uuid() unique,
  submission_id uuid not null unique references public.exam_room_submissions(id) on delete restrict,
  attempt_id uuid not null references public.exam_room_attempts(id) on delete restrict,
  generation integer not null check (generation > 0),
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null default now(),
  unique (attempt_id, generation)
);

-- A reopening is an immutable authorization for exactly one later submission
-- generation. It never rewrites the original submission or receipt.
create table if not exists public.exam_room_submission_reopenings (
  id uuid primary key default extensions.gen_random_uuid(),
  public_id uuid not null default extensions.gen_random_uuid() unique,
  attempt_id uuid not null references public.exam_room_attempts(id) on delete restrict,
  prior_submission_id uuid not null references public.exam_room_submissions(id) on delete restrict,
  prior_receipt_id uuid not null references public.exam_room_submission_receipts(id) on delete restrict,
  authorized_generation integer not null check (authorized_generation > 1),
  authority_type text not null check (authority_type in ('owner_professor', 'admin_break_glass')),
  authorized_by uuid not null references auth.users(id) on delete restrict,
  admin_break_glass_grant_id uuid,
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  opened_at timestamptz not null default now(),
  new_deadline timestamptz not null,
  expires_at timestamptz not null,
  unique (attempt_id, authorized_generation),
  unique (authorized_by, request_key),
  constraint exam_room_submission_reopening_window_check check (
    new_deadline > opened_at
    and new_deadline <= opened_at + interval '4 hours'
    and expires_at = new_deadline
  ),
  constraint exam_room_submission_reopening_authority_shape_check check (
    (authority_type = 'owner_professor' and admin_break_glass_grant_id is null)
    or (authority_type = 'admin_break_glass' and admin_break_glass_grant_id is not null)
  )
);

alter table public.exam_room_submissions
  add column if not exists reopening_id uuid,
  add column if not exists prior_submission_id uuid
    references public.exam_room_submissions(id) on delete restrict;
alter table public.exam_room_submissions
  drop constraint if exists exam_room_submissions_reopening_id_fkey;
alter table public.exam_room_submissions
  add constraint exam_room_submissions_reopening_id_fkey
  foreign key (reopening_id)
  references public.exam_room_submission_reopenings(id)
  on delete restrict;
alter table public.exam_room_submissions
  drop constraint if exists exam_room_submissions_generation_lineage_v2_check;
alter table public.exam_room_submissions
  add constraint exam_room_submissions_generation_lineage_v2_check
  check (
    (reopening_id is null and prior_submission_id is null and generation = 1)
    or (reopening_id is not null and prior_submission_id is not null and generation > 1)
  );

create table if not exists public.exam_room_errata (
  id uuid primary key default extensions.gen_random_uuid(),
  public_id uuid not null default extensions.gen_random_uuid() unique,
  exam_id uuid not null references public.exam_room_exams(id) on delete restrict,
  publication_id uuid not null references public.exam_room_publications(id) on delete restrict,
  erratum_number integer not null check (erratum_number > 0),
  erratum_type text not null check (erratum_type in ('clarification', 'correction', 'stop_notice', 'replacement_notice')),
  affected_question_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(affected_question_ids) = 'array'),
  body text not null check (char_length(btrim(body)) between 3 and 5000),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  effective_at timestamptz not null,
  issued_by uuid not null references auth.users(id) on delete restrict,
  issued_at timestamptz not null default now(),
  unique (exam_id, erratum_number),
  unique (exam_id, content_hash),
  check (octet_length(affected_question_ids::text) <= 16384)
);

create table if not exists public.exam_room_temporary_leaves (
  id uuid primary key default extensions.gen_random_uuid(),
  public_id uuid not null default extensions.gen_random_uuid() unique,
  attempt_id uuid not null references public.exam_room_attempts(id) on delete cascade,
  session_id uuid not null references public.exam_room_sessions(id) on delete restrict,
  reason_code text not null check (reason_code in ('comfort_room', 'medical', 'technical', 'other')),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'returned')),
  started_at timestamptz not null default now(),
  started_by uuid not null references auth.users(id) on delete restrict,
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id) on delete set null,
  returned_at timestamptz,
  returned_by uuid references auth.users(id) on delete set null,
  operational_note text not null default '' check (char_length(operational_note) <= 1000),
  check (returned_at is null or returned_at >= started_at)
);

create unique index if not exists exam_room_one_open_leave_idx
  on public.exam_room_temporary_leaves (attempt_id) where status in ('open', 'acknowledged');

create table if not exists public.exam_room_leave_events (
  id bigint generated always as identity primary key,
  leave_id uuid not null references public.exam_room_temporary_leaves(id) on delete restrict,
  attempt_id uuid not null references public.exam_room_attempts(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null check (event_type in ('started', 'acknowledged', 'student_returned', 'beadle_recorded_return')),
  note text not null default '' check (char_length(note) <= 1000),
  occurred_at timestamptz not null default now()
);

create table if not exists public.exam_room_incident_groups (
  id uuid primary key default extensions.gen_random_uuid(),
  public_id uuid not null default extensions.gen_random_uuid() unique,
  exam_id uuid not null references public.exam_room_exams(id) on delete restrict,
  attempt_id uuid not null references public.exam_room_attempts(id) on delete cascade,
  category text not null check (category in ('attention', 'network', 'session', 'leave', 'verification', 'technical')),
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  status text not null default 'open' check (status in ('open', 'closed', 'reviewed')),
  event_count integer not null default 1 check (event_count > 0),
  first_occurred_at timestamptz not null,
  last_occurred_at timestamptz not null,
  summary text not null check (char_length(btrim(summary)) between 3 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (last_occurred_at >= first_occurred_at)
);

create unique index if not exists exam_room_one_open_incident_group_idx
  on public.exam_room_incident_groups (attempt_id, category) where status = 'open';

alter table public.exam_room_integrity_events
  add column if not exists group_id uuid references public.exam_room_incident_groups(id) on delete set null,
  add column if not exists session_id uuid references public.exam_room_sessions(id) on delete set null,
  add column if not exists session_epoch integer,
  add column if not exists client_event_id uuid,
  add column if not exists severity text not null default 'info';

alter table public.exam_room_integrity_events
  drop constraint if exists exam_room_integrity_events_event_type_check;
alter table public.exam_room_integrity_events
  add constraint exam_room_integrity_events_event_type_check
  check (event_type in (
    'fullscreen_enter', 'fullscreen_exit',
    'visibility_exit', 'visibility_resume', 'focus_exit', 'focus_return',
    'reload_resume', 'copy_attempt', 'paste_attempt', 'context_menu_attempt',
    'heartbeat_gap', 'network_gap', 'network_restored',
    'sync_failed', 'sync_restored', 'second_session_attempt',
    'multi_tab_detected', 'offline_mode', 'sync_recovered', 'session_transfer',
    'temporary_leave', 'technical_error', 'preflight_failure', 'verification',
    'recovery', 'warning', 'lock', 'unlock'
  ));

alter table public.exam_room_integrity_events
  drop constraint if exists exam_room_integrity_events_severity_check;
alter table public.exam_room_integrity_events
  add constraint exam_room_integrity_events_severity_check
  check (severity in ('info', 'warning', 'critical'));

create unique index if not exists exam_room_integrity_client_event_idx
  on public.exam_room_integrity_events (attempt_id, client_event_id)
  where client_event_id is not null;

create table if not exists public.exam_room_audit_events_v2 (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role text not null check (actor_role in ('system', 'admin', 'professor', 'beadle', 'student')),
  exam_id uuid references public.exam_room_exams(id) on delete set null,
  attempt_id uuid references public.exam_room_attempts(id) on delete set null,
  entity_type text not null check (entity_type ~ '^[a-z][a-z0-9_]{2,79}$'),
  entity_id uuid,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_]{2,99}$'),
  request_key text check (request_key is null or request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  check (octet_length(metadata::text) <= 8000)
);

-- Candidate-scoped Admin break-glass is deliberately separate from the
-- legacy broad dispute flow. The Worker must derive verified_aal and the
-- verified session id from the same validated JWT before calling these
-- service-role-only RPCs; the database records and rechecks that assertion.
create table if not exists public.exam_room_admin_break_glass_grants (
  id uuid primary key default extensions.gen_random_uuid(),
  public_id uuid not null default extensions.gen_random_uuid() unique,
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  exam_id uuid not null references public.exam_room_exams(id) on delete restrict,
  attempt_id uuid not null references public.exam_room_attempts(id) on delete restrict,
  candidate_number text not null check (char_length(btrim(candidate_number)) between 1 and 100),
  case_reference text not null check (
    char_length(btrim(case_reference)) between 2 and 200
    and case_reference ~ '^[A-Za-z0-9][A-Za-z0-9 _./:#-]{1,199}$'
  ),
  reason text not null check (char_length(btrim(reason)) between 10 and 2000),
  verified_aal text not null check (verified_aal = 'aal2'),
  verified_session_id uuid not null,
  verified_authentication_at timestamptz not null,
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (admin_user_id, request_key),
  constraint exam_room_admin_break_glass_window_check check (
    expires_at > issued_at and expires_at <= issued_at + interval '4 hours'
  ),
  constraint exam_room_admin_break_glass_auth_freshness_check check (
    verified_authentication_at >= issued_at - interval '15 minutes'
    and verified_authentication_at <= issued_at + interval '1 minute'
  )
);

alter table public.exam_room_submission_reopenings
  drop constraint if exists exam_room_submission_reopenings_break_glass_v2_fkey;
alter table public.exam_room_submission_reopenings
  add constraint exam_room_submission_reopenings_break_glass_v2_fkey
  foreign key (admin_break_glass_grant_id)
  references public.exam_room_admin_break_glass_grants(id)
  on delete restrict;

create table if not exists public.exam_room_admin_break_glass_events (
  id bigint generated always as identity primary key,
  grant_id uuid not null references public.exam_room_admin_break_glass_grants(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null check (
    event_type in ('issued', 'accessed', 'closed', 'post_review_completed', 'submission_reopened')
  ),
  verified_aal text not null check (verified_aal = 'aal2'),
  verified_session_id uuid not null,
  verified_authentication_at timestamptz not null,
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  reason text check (reason is null or char_length(btrim(reason)) between 5 and 2000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  unique (actor_user_id, event_type, request_key),
  check (octet_length(metadata::text) <= 8000),
  constraint exam_room_admin_break_glass_event_auth_freshness_check check (
    verified_authentication_at >= occurred_at - interval '15 minutes'
    and verified_authentication_at <= occurred_at + interval '1 minute'
  )
);

create unique index if not exists exam_room_admin_break_glass_one_close_idx
  on public.exam_room_admin_break_glass_events (grant_id)
  where event_type = 'closed';
create unique index if not exists exam_room_admin_break_glass_one_review_idx
  on public.exam_room_admin_break_glass_events (grant_id)
  where event_type = 'post_review_completed';

create index if not exists exam_room_audit_v2_exam_idx
  on public.exam_room_audit_events_v2 (exam_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Shared guards and helpers. Every new SECURITY DEFINER has an empty path.
-- ---------------------------------------------------------------------------

create or replace function public.exam_room_v2_forbid_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'EXAM_ROOM_IMMUTABLE_EVIDENCE';
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'exam_room_publications', 'exam_room_session_events',
    'exam_room_model_answer_sources', 'exam_room_publication_model_answers',
    'exam_room_answer_operations', 'exam_room_answer_revisions',
    'exam_room_answer_conflict_branches', 'exam_room_submissions',
    'exam_room_submission_receipts', 'exam_room_errata',
    'exam_room_leave_events', 'exam_room_deadline_extensions',
    'exam_room_audit_events_v2', 'exam_room_submission_reopenings',
    'exam_room_admin_break_glass_grants', 'exam_room_admin_break_glass_events'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_immutable_guard', v_table);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.exam_room_v2_forbid_change()',
      v_table || '_immutable_guard', v_table
    );
  end loop;
end;
$$;

-- Only replacement-staged sources are frozen here. Foundation preview/source
-- workflows retain their existing update semantics, while a source already
-- offered as corrected publication provenance cannot be rewritten or deleted.
create or replace function public.exam_room_guard_staged_question_source_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.extraction_status = 'staged_replacement' then
    raise exception 'EXAM_ROOM_STAGED_QUESTION_SOURCE_IMMUTABLE';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists exam_room_staged_question_source_immutable_guard_v2
  on public.exam_room_question_sources;
create trigger exam_room_staged_question_source_immutable_guard_v2
before update or delete on public.exam_room_question_sources
for each row execute function public.exam_room_guard_staged_question_source_v2();

-- Admin status is not Professor authority. An Admin who also teaches must be
-- explicitly activated as a Professor and then owns only their own resources.
create or replace function public.exam_room_is_professor(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.exam_room_professors p
    where p.user_id = p_user_id and p.status = 'active'
  );
$$;

alter function public.exam_room_is_admin(uuid) set search_path = '';
alter function public.exam_room_require_admin(uuid) set search_path = '';
alter function public.exam_room_require_professor(uuid) set search_path = '';

create or replace function public.exam_room_has_active_beadle_assignment_v2(
  p_user_id uuid,
  p_exam_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.exam_room_beadle_assignments b
    join public.exam_room_exams e on e.id = b.exam_id
    where b.exam_id = p_exam_id
      and b.beadle_user_id = p_user_id
      and b.status = 'active'
      and b.expires_at > now()
      and e.status <> 'sealed'
      and e.release_id is null
  );
$$;

create or replace function public.exam_room_is_operator_v2(
  p_user_id uuid,
  p_exam_id uuid,
  p_include_beadle boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.exam_room_exams e
      where e.id = p_exam_id and e.owner_professor_id = p_user_id
    )
    or (
      p_include_beadle
      and public.exam_room_has_active_beadle_assignment_v2(p_user_id, p_exam_id)
    );
$$;

create or replace function public.exam_room_actor_role_v2(p_user_id uuid, p_exam_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_user_id is null then 'system'
    when exists (select 1 from public.exam_room_exams e where e.id = p_exam_id and e.owner_professor_id = p_user_id) then 'professor'
    when public.exam_room_has_active_beadle_assignment_v2(p_user_id, p_exam_id) then 'beadle'
    when public.exam_room_is_admin(p_user_id) then 'admin'
    else 'student'
  end;
$$;

create or replace function public.exam_room_can_manage_roster_v2(
  p_user_id uuid,
  p_exam_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.exam_room_exams e
    where e.id = p_exam_id
      and (
        e.owner_professor_id = p_user_id
        or exists (
          select 1 from public.exam_room_beadle_assignments b
          where b.exam_id = e.id and b.beadle_user_id = p_user_id
            and b.status = 'active' and b.expires_at > now()
            and b.can_manage_roster
        )
      )
      and e.current_publication_id is null
      and not exists (select 1 from public.exam_room_attempts a where a.exam_id = e.id)
      and not exists (
        select 1 from public.exam_room_exams other
        where other.classroom_id = e.classroom_id and other.id <> e.id
          and (other.current_publication_id is not null or other.status in ('open', 'closed', 'grading', 'sealed'))
      )
  );
$$;

create or replace function public.exam_room_append_audit_v2(
  p_actor_user_id uuid,
  p_exam_id uuid,
  p_attempt_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_event_type text,
  p_request_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if p_entity_type !~ '^[a-z][a-z0-9_]{2,79}$'
    or p_event_type !~ '^[a-z][a-z0-9_]{2,99}$'
    or (p_request_key is not null and p_request_key !~ '^[A-Za-z0-9_-]{16,128}$')
    or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_metadata, '{}'::jsonb)::text) > 8000
    or public.exam_room_json_has_forbidden_key(coalesce(p_metadata, '{}'::jsonb))
  then
    raise exception 'EXAM_ROOM_AUDIT_EVENT_INVALID';
  end if;
  insert into public.exam_room_audit_events_v2 (
    actor_user_id, actor_role, exam_id, attempt_id, entity_type,
    entity_id, event_type, request_key, metadata
  ) values (
    p_actor_user_id, public.exam_room_actor_role_v2(p_actor_user_id, p_exam_id),
    p_exam_id, p_attempt_id, p_entity_type, p_entity_id,
    p_event_type, p_request_key, coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.exam_room_command_begin_v2(
  p_actor_user_id uuid,
  p_operation text,
  p_request_key text,
  p_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt public.exam_room_command_receipts%rowtype;
  v_hash text;
begin
  if p_actor_user_id is null
    or p_operation !~ '^[a-z][a-z0-9_]{2,79}$'
    or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
    or jsonb_typeof(p_request) <> 'object'
  then raise exception 'EXAM_ROOM_REQUEST_INVALID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_user_id::text || ':' || p_operation || ':' || p_request_key, 20260811003100)
  );
  v_hash := public.exam_room_hash_json(p_request);
  select * into v_receipt
  from public.exam_room_command_receipts
  where actor_user_id = p_actor_user_id and operation = p_operation and request_key = p_request_key;
  if not found then return null; end if;
  if v_receipt.request_hash <> v_hash then raise exception 'EXAM_ROOM_REQUEST_KEY_REUSED'; end if;
  return v_receipt.response_json;
end;
$$;

create or replace function public.exam_room_command_complete_v2(
  p_actor_user_id uuid,
  p_operation text,
  p_request_key text,
  p_request jsonb,
  p_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(p_response) <> 'object' then raise exception 'EXAM_ROOM_RESPONSE_INVALID'; end if;
  insert into public.exam_room_command_receipts (
    actor_user_id, operation, request_key, request_hash, response_json
  ) values (
    p_actor_user_id, p_operation, p_request_key,
    public.exam_room_hash_json(p_request), p_response
  );
  return p_response;
end;
$$;

-- The service role has no end-user JWT assurance context. These RPCs therefore
-- treat the Worker as an explicit attestation boundary: it must validate the
-- access token against Auth, derive aal2 + session_id + a fresh supported MFA AMR,
-- and pass all three. The database persists and revalidates that assertion on
-- every candidate-evidence access.
create or replace function public.exam_room_assert_fresh_aal2_v2(
  p_verified_aal text,
  p_verified_session_id uuid,
  p_verified_authentication_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_verified_aal is distinct from 'aal2'
    or p_verified_session_id is null
    or p_verified_authentication_at is null
    or p_verified_authentication_at < clock_timestamp() - interval '15 minutes'
    or p_verified_authentication_at > clock_timestamp() + interval '1 minute'
  then raise exception 'EXAM_ROOM_FRESH_AAL2_REQUIRED'; end if;
end;
$$;

create or replace function public.exam_room_assert_admin_break_glass_identity_v2(
  p_admin_user_id uuid,
  p_grant_public_id uuid,
  p_verified_aal text,
  p_verified_session_id uuid,
  p_verified_authentication_at timestamptz
)
returns public.exam_room_admin_break_glass_grants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.exam_room_admin_break_glass_grants%rowtype;
begin
  perform public.exam_room_require_admin(p_admin_user_id);
  perform public.exam_room_assert_fresh_aal2_v2(
    p_verified_aal, p_verified_session_id, p_verified_authentication_at
  );
  select * into v_grant
  from public.exam_room_admin_break_glass_grants g
  where g.public_id = p_grant_public_id
    and g.admin_user_id = p_admin_user_id
    and g.verified_aal = 'aal2'
    and g.verified_session_id = p_verified_session_id
  for update;
  if not found then raise exception 'EXAM_ROOM_BREAK_GLASS_NOT_FOUND'; end if;
  return v_grant;
end;
$$;

create or replace function public.exam_room_assert_admin_break_glass_active_v2(
  p_admin_user_id uuid,
  p_grant_public_id uuid,
  p_exam_public_id uuid,
  p_attempt_public_id uuid,
  p_candidate_number text,
  p_verified_aal text,
  p_verified_session_id uuid,
  p_verified_authentication_at timestamptz
)
returns public.exam_room_admin_break_glass_grants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.exam_room_admin_break_glass_grants%rowtype;
begin
  v_grant := public.exam_room_assert_admin_break_glass_identity_v2(
    p_admin_user_id, p_grant_public_id, p_verified_aal,
    p_verified_session_id, p_verified_authentication_at
  );
  if clock_timestamp() >= v_grant.expires_at
    or exists (
      select 1 from public.exam_room_admin_break_glass_events ev
      where ev.grant_id = v_grant.id and ev.event_type = 'closed'
    )
    or not exists (
      select 1
      from public.exam_room_exams e
      join public.exam_room_attempts a on a.exam_id = e.id
      join public.exam_room_publications publication on publication.id = a.publication_id
      where e.id = v_grant.exam_id
        and e.public_id = p_exam_public_id
        and a.id = v_grant.attempt_id
        and a.public_id = p_attempt_public_id
        and lower(a.candidate_number) = lower(btrim(p_candidate_number))
        and lower(v_grant.candidate_number) = lower(btrim(p_candidate_number))
        and a.status in ('submitted', 'auto_submitted', 'sealed')
        and not exists (
          select 1 from public.exam_room_sessions active_session
          where active_session.attempt_id = a.id and active_session.status = 'active'
        )
        and (publication.rules_snapshot ->> 'submissionGraceMinutes')::integer between 0 and 120
        and clock_timestamp() >= a.server_deadline + make_interval(
          mins => (publication.rules_snapshot ->> 'submissionGraceMinutes')::integer
        )
    )
  then raise exception 'EXAM_ROOM_BREAK_GLASS_SCOPE_OR_EXPIRY_INVALID'; end if;
  return v_grant;
end;
$$;

create or replace function public.exam_room_assert_session_v2(
  p_student_user_id uuid,
  p_attempt_id uuid,
  p_session_public_id uuid,
  p_session_epoch integer
)
returns public.exam_room_sessions
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.exam_room_sessions%rowtype;
begin
  select * into v_session
  from public.exam_room_sessions s
  where s.public_id = p_session_public_id
    and s.attempt_id = p_attempt_id
    and s.student_user_id = p_student_user_id
    and s.epoch = p_session_epoch;
  if not found then raise exception 'EXAM_ROOM_SESSION_NOT_FOUND'; end if;
  if v_session.status <> 'active' then raise exception 'EXAM_ROOM_SESSION_STALE'; end if;
  return v_session;
end;
$$;

create or replace function public.exam_room_issue_admin_break_glass_v2(
  p_admin_user_id uuid,
  p_exam_public_id uuid,
  p_attempt_public_id uuid,
  p_candidate_number text,
  p_case_reference text,
  p_reason text,
  p_expires_at timestamptz,
  p_verified_aal text,
  p_verified_session_id uuid,
  p_verified_authentication_at timestamptz,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_attempt public.exam_room_attempts%rowtype;
  v_grant public.exam_room_admin_break_glass_grants%rowtype;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id,
    'attemptId', p_attempt_public_id,
    'candidateNumber', p_candidate_number,
    'caseReference', p_case_reference,
    'reason', p_reason,
    'expiresAt', p_expires_at,
    'verifiedAal', p_verified_aal,
    'verifiedSessionId', p_verified_session_id,
    'verifiedAuthenticationAt', p_verified_authentication_at
  );
  v_response := public.exam_room_command_begin_v2(
    p_admin_user_id, 'issue_admin_break_glass_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  perform public.exam_room_require_admin(p_admin_user_id);
  perform public.exam_room_assert_fresh_aal2_v2(
    p_verified_aal, p_verified_session_id, p_verified_authentication_at
  );
  if char_length(btrim(coalesce(p_candidate_number, ''))) not between 1 and 100
    or char_length(btrim(coalesce(p_case_reference, ''))) not between 2 and 200
    or btrim(p_case_reference) !~ '^[A-Za-z0-9][A-Za-z0-9 _./:#-]{1,199}$'
    or char_length(btrim(coalesce(p_reason, ''))) not between 10 and 2000
    or p_expires_at is null
    or p_expires_at <= clock_timestamp()
    or p_expires_at > clock_timestamp() + interval '4 hours'
  then raise exception 'EXAM_ROOM_BREAK_GLASS_REQUEST_INVALID'; end if;
  select * into v_exam
  from public.exam_room_exams e
  where e.public_id = p_exam_public_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  select * into v_attempt
  from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id
    and a.exam_id = v_exam.id
    and lower(a.candidate_number) = lower(btrim(p_candidate_number))
  for update;
  if not found then raise exception 'EXAM_ROOM_BREAK_GLASS_SCOPE_INVALID'; end if;
  if v_attempt.status not in ('submitted', 'auto_submitted', 'sealed')
    or exists (
      select 1 from public.exam_room_sessions active_session
      where active_session.attempt_id = v_attempt.id
        and active_session.status = 'active'
    )
    or not exists (
      select 1 from public.exam_room_publications publication
      where publication.id = v_attempt.publication_id
        and (publication.rules_snapshot ->> 'submissionGraceMinutes')::integer between 0 and 120
        and clock_timestamp() >= v_attempt.server_deadline + make_interval(
          mins => (publication.rules_snapshot ->> 'submissionGraceMinutes')::integer
        )
    )
  then raise exception 'EXAM_ROOM_BREAK_GLASS_TERMINAL_EVIDENCE_REQUIRED'; end if;
  if exists (
    select 1 from public.exam_room_admin_break_glass_grants g
    where g.attempt_id = v_attempt.id
      and g.expires_at > clock_timestamp()
      and not exists (
        select 1 from public.exam_room_admin_break_glass_events ev
        where ev.grant_id = g.id and ev.event_type = 'closed'
      )
  ) then raise exception 'EXAM_ROOM_BREAK_GLASS_ALREADY_ACTIVE'; end if;
  insert into public.exam_room_admin_break_glass_grants (
    admin_user_id, exam_id, attempt_id, candidate_number,
    case_reference, reason, verified_aal, verified_session_id,
    verified_authentication_at, request_key, expires_at
  ) values (
    p_admin_user_id, v_exam.id, v_attempt.id, v_attempt.candidate_number,
    btrim(p_case_reference), btrim(p_reason), p_verified_aal,
    p_verified_session_id, p_verified_authentication_at,
    p_request_key, p_expires_at
  ) returning * into v_grant;
  insert into public.exam_room_admin_break_glass_events (
    grant_id, actor_user_id, event_type, verified_aal,
    verified_session_id, verified_authentication_at,
    request_key, reason, metadata
  ) values (
    v_grant.id, p_admin_user_id, 'issued', p_verified_aal,
    p_verified_session_id, p_verified_authentication_at,
    p_request_key, btrim(p_reason),
    jsonb_build_object(
      'examId', v_exam.public_id,
      'attemptId', v_attempt.public_id,
      'candidateNumber', v_attempt.candidate_number,
      'caseReference', v_grant.case_reference,
      'expiresAt', v_grant.expires_at,
      'verifiedAuthenticationAt', p_verified_authentication_at
    )
  );
  perform public.exam_room_append_audit_v2(
    p_admin_user_id, v_exam.id, v_attempt.id, 'admin_break_glass', v_grant.id,
    'admin_break_glass_issued', p_request_key,
    jsonb_build_object(
      'grantId', v_grant.public_id,
      'candidateNumber', v_attempt.candidate_number,
      'caseReference', v_grant.case_reference,
      'expiresAt', v_grant.expires_at,
      'verifiedAal', p_verified_aal,
      'verifiedSessionId', p_verified_session_id,
      'verifiedAuthenticationAt', p_verified_authentication_at,
      'scope', 'candidate_evidence'
    )
  );
  perform public.exam_room_queue_backup(
    v_exam.id, 'admin_break_glass',
    jsonb_build_object(
      'grantId', v_grant.public_id,
      'attemptId', v_attempt.public_id,
      'candidateNumber', v_attempt.candidate_number,
      'caseReference', v_grant.case_reference,
      'expiresAt', v_grant.expires_at,
      'scope', 'candidate_evidence',
      'event', 'issued'
    )
  );
  v_response := jsonb_build_object(
    'ok', true,
    'grantId', v_grant.public_id,
    'examId', v_exam.public_id,
    'attemptId', v_attempt.public_id,
    'candidateNumber', v_attempt.candidate_number,
    'caseReference', v_grant.case_reference,
    'issuedAt', v_grant.issued_at,
    'expiresAt', v_grant.expires_at,
    'scope', 'candidate_evidence',
    'requiresPostReview', true
  );
  return public.exam_room_command_complete_v2(
    p_admin_user_id, 'issue_admin_break_glass_v2',
    p_request_key, v_request, v_response
  );
end;
$$;

create or replace function public.exam_room_admin_break_glass_evidence_v2(
  p_admin_user_id uuid,
  p_grant_public_id uuid,
  p_exam_public_id uuid,
  p_attempt_public_id uuid,
  p_candidate_number text,
  p_verified_aal text,
  p_verified_session_id uuid,
  p_verified_authentication_at timestamptz,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.exam_room_admin_break_glass_grants%rowtype;
  v_exam public.exam_room_exams%rowtype;
  v_attempt public.exam_room_attempts%rowtype;
  v_publication public.exam_room_publications%rowtype;
  v_existing_event public.exam_room_admin_break_glass_events%rowtype;
  v_evidence jsonb;
begin
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'EXAM_ROOM_REQUEST_INVALID';
  end if;
  v_grant := public.exam_room_assert_admin_break_glass_active_v2(
    p_admin_user_id, p_grant_public_id, p_exam_public_id,
    p_attempt_public_id, p_candidate_number, p_verified_aal,
    p_verified_session_id, p_verified_authentication_at
  );
  select * into v_exam from public.exam_room_exams e where e.id = v_grant.exam_id;
  select * into v_attempt from public.exam_room_attempts a where a.id = v_grant.attempt_id;
  select * into v_publication
  from public.exam_room_publications p
  where p.id = v_attempt.publication_id and p.exam_id = v_exam.id;
  if not found then raise exception 'EXAM_ROOM_PUBLICATION_REQUIRED'; end if;

  select * into v_existing_event
  from public.exam_room_admin_break_glass_events ev
  where ev.actor_user_id = p_admin_user_id
    and ev.event_type = 'accessed'
    and ev.request_key = p_request_key;
  if found and v_existing_event.grant_id <> v_grant.id then
    raise exception 'EXAM_ROOM_REQUEST_KEY_REUSED';
  elsif not found then
    insert into public.exam_room_admin_break_glass_events (
      grant_id, actor_user_id, event_type, verified_aal,
      verified_session_id, verified_authentication_at,
      request_key, reason, metadata
    ) values (
      v_grant.id, p_admin_user_id, 'accessed', p_verified_aal,
      p_verified_session_id, p_verified_authentication_at,
      p_request_key, 'Candidate-scoped evidence viewed.',
      jsonb_build_object(
        'examId', v_exam.public_id,
        'attemptId', v_attempt.public_id,
        'candidateNumber', v_attempt.candidate_number,
        'caseReference', v_grant.case_reference,
        'verifiedAuthenticationAt', p_verified_authentication_at,
        'scope', 'candidate_evidence'
      )
    );
    perform public.exam_room_append_audit_v2(
      p_admin_user_id, v_exam.id, v_attempt.id,
      'admin_break_glass', v_grant.id, 'admin_break_glass_accessed',
      p_request_key,
      jsonb_build_object(
        'grantId', v_grant.public_id,
        'candidateNumber', v_attempt.candidate_number,
        'caseReference', v_grant.case_reference,
        'verifiedAuthenticationAt', p_verified_authentication_at,
        'scope', 'candidate_evidence'
      )
    );
  end if;

  v_evidence := jsonb_build_object(
    'exam', jsonb_build_object(
      'title', v_exam.title,
      'status', v_exam.status,
      'publicationId', v_publication.public_id,
      'publicationNumber', v_publication.publication_number,
      'questions', v_publication.questions_snapshot
    ),
    'attempt', jsonb_build_object(
      'status', v_attempt.status,
      'startedAt', v_attempt.started_at,
      'serverDeadline', v_attempt.server_deadline,
      'submittedAt', v_attempt.submitted_at
    ),
    'submissionHistory', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'generation', s.generation,
        'receiptId', receipt.public_id,
        'receivedAt', receipt.issued_at,
        'snapshotHash', receipt.snapshot_hash,
        'automatic', s.automatic,
        'answerSnapshot', s.answer_snapshot,
        'reopeningId', reopening.public_id,
        'priorSubmissionGeneration', prior.generation
      ) order by s.generation), '[]'::jsonb)
      from public.exam_room_submissions s
      join public.exam_room_submission_receipts receipt on receipt.submission_id = s.id
      left join public.exam_room_submission_reopenings reopening on reopening.id = s.reopening_id
      left join public.exam_room_submissions prior on prior.id = s.prior_submission_id
      where s.attempt_id = v_attempt.id
    ),
    'answerOperations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'operationId', o.operation_id,
        'questionId', o.question_id,
        'sessionEpoch', o.session_epoch,
        'localSequence', o.local_sequence,
        'baseRevision', o.base_revision,
        'answerText', o.answer_text,
        'contentHash', o.content_hash,
        'disposition', o.disposition,
        'resultingRevision', o.resulting_revision,
        'clientSavedAt', o.client_saved_at,
        'serverReceivedAt', o.server_received_at
      ) order by o.server_received_at), '[]'::jsonb)
      from public.exam_room_answer_operations o where o.attempt_id = v_attempt.id
    ),
    'conflictBranches', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'operationId', b.operation_id,
        'questionId', b.question_id,
        'baseRevision', b.base_revision,
        'serverRevision', b.server_revision,
        'incomingAnswerText', b.incoming_answer_text,
        'incomingContentHash', b.incoming_content_hash,
        'serverAnswerText', b.server_answer_text,
        'serverContentHash', b.server_content_hash,
        'branchReason', b.branch_reason,
        'clientSavedAt', b.client_saved_at,
        'preservedAt', b.preserved_at
      ) order by b.preserved_at), '[]'::jsonb)
      from public.exam_room_answer_conflict_branches b where b.attempt_id = v_attempt.id
    ),
    'sessions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'sessionId', s.public_id,
        'epoch', s.epoch,
        'status', s.status,
        'openedAt', s.opened_at,
        'lastSeenAt', s.last_seen_at,
        'endedAt', s.ended_at,
        'endReason', s.end_reason
      ) order by s.epoch), '[]'::jsonb)
      from public.exam_room_sessions s where s.attempt_id = v_attempt.id
    ),
    'sessionEvents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'eventType', ev.event_type,
        'epoch', ev.epoch,
        'metadata', ev.metadata,
        'occurredAt', ev.occurred_at
      ) order by ev.occurred_at), '[]'::jsonb)
      from public.exam_room_session_events ev where ev.attempt_id = v_attempt.id
    ),
    'integrityEvents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'eventType', ie.event_type,
        'severity', ie.severity,
        'details', ie.details,
        'occurredAt', ie.occurred_at
      ) order by ie.occurred_at), '[]'::jsonb)
      from public.exam_room_integrity_events ie where ie.attempt_id = v_attempt.id
    ),
    'incidentGroups', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'incidentId', g.public_id,
        'category', g.category,
        'severity', g.severity,
        'status', g.status,
        'eventCount', g.event_count,
        'firstOccurredAt', g.first_occurred_at,
        'lastOccurredAt', g.last_occurred_at,
        'summary', g.summary
      ) order by g.first_occurred_at), '[]'::jsonb)
      from public.exam_room_incident_groups g where g.attempt_id = v_attempt.id
    ),
    'temporaryLeaves', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'leaveId', l.public_id,
        'status', l.status,
        'startedAt', l.started_at,
        'acknowledgedAt', l.acknowledged_at,
        'returnedAt', l.returned_at
      ) order by l.started_at), '[]'::jsonb)
      from public.exam_room_temporary_leaves l where l.attempt_id = v_attempt.id
    ),
    'deadlineExtensions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'previousDeadline', d.previous_deadline,
        'newDeadline', d.new_deadline,
        'extensionMinutes', d.extension_minutes,
        'extensionType', d.extension_type,
        'reason', d.reason,
        'grantedAt', d.granted_at
      ) order by d.granted_at), '[]'::jsonb)
      from public.exam_room_deadline_extensions d where d.attempt_id = v_attempt.id
    ),
    'grades', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'questionId', g.question_id,
        'score', g.score,
        'maximumPoints', g.maximum_points,
        'comment', g.professor_comment,
        'gradeState', g.grade_state,
        'revision', g.revision,
        'gradedAt', g.graded_at
      ) order by q.ordinal), '[]'::jsonb)
      from public.exam_room_grades g
      join public.exam_room_questions q on q.id = g.question_id
      where g.attempt_id = v_attempt.id
    ),
    'gradeHistory', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'questionId', gh.question_id,
        'revision', gh.revision,
        'score', gh.score,
        'maximumPoints', gh.maximum_points,
        'comment', gh.professor_comment,
        'gradeState', gh.grade_state,
        'changeReason', gh.change_reason,
        'changedAt', gh.changed_at
      ) order by gh.changed_at), '[]'::jsonb)
      from public.exam_room_grade_history gh where gh.attempt_id = v_attempt.id
    )
  );
  return jsonb_build_object(
    'ok', true,
    'grantId', v_grant.public_id,
    'examId', v_exam.public_id,
    'attemptId', v_attempt.public_id,
    'candidateNumber', v_attempt.candidate_number,
    'caseReference', v_grant.case_reference,
    'scope', 'candidate_evidence',
    'expiresAt', v_grant.expires_at,
    'evidence', v_evidence
  );
end;
$$;

create or replace function public.exam_room_close_admin_break_glass_v2(
  p_admin_user_id uuid,
  p_grant_public_id uuid,
  p_exam_public_id uuid,
  p_attempt_public_id uuid,
  p_candidate_number text,
  p_reason text,
  p_verified_aal text,
  p_verified_session_id uuid,
  p_verified_authentication_at timestamptz,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.exam_room_admin_break_glass_grants%rowtype;
  v_event public.exam_room_admin_break_glass_events%rowtype;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object(
    'grantId', p_grant_public_id,
    'examId', p_exam_public_id,
    'attemptId', p_attempt_public_id,
    'candidateNumber', p_candidate_number,
    'reason', p_reason,
    'verifiedAal', p_verified_aal,
    'verifiedSessionId', p_verified_session_id,
    'verifiedAuthenticationAt', p_verified_authentication_at
  );
  v_response := public.exam_room_command_begin_v2(
    p_admin_user_id, 'close_admin_break_glass_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  v_grant := public.exam_room_assert_admin_break_glass_identity_v2(
    p_admin_user_id, p_grant_public_id, p_verified_aal,
    p_verified_session_id, p_verified_authentication_at
  );
  if not exists (
    select 1
    from public.exam_room_exams e
    join public.exam_room_attempts a on a.exam_id = e.id
    where e.id = v_grant.exam_id
      and e.public_id = p_exam_public_id
      and a.id = v_grant.attempt_id
      and a.public_id = p_attempt_public_id
      and lower(a.candidate_number) = lower(btrim(p_candidate_number))
      and lower(v_grant.candidate_number) = lower(btrim(p_candidate_number))
  ) then raise exception 'EXAM_ROOM_BREAK_GLASS_SCOPE_INVALID'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 2000 then
    raise exception 'EXAM_ROOM_BREAK_GLASS_CLOSE_INVALID';
  end if;
  if exists (
    select 1 from public.exam_room_admin_break_glass_events ev
    where ev.grant_id = v_grant.id and ev.event_type = 'closed'
  ) then raise exception 'EXAM_ROOM_BREAK_GLASS_ALREADY_CLOSED'; end if;
  insert into public.exam_room_admin_break_glass_events (
    grant_id, actor_user_id, event_type, verified_aal,
    verified_session_id, verified_authentication_at,
    request_key, reason, metadata
  ) values (
    v_grant.id, p_admin_user_id, 'closed', p_verified_aal,
    p_verified_session_id, p_verified_authentication_at,
    p_request_key, btrim(p_reason),
    jsonb_build_object(
      'caseReference', v_grant.case_reference,
      'verifiedAuthenticationAt', p_verified_authentication_at
    )
  ) returning * into v_event;
  perform public.exam_room_append_audit_v2(
    p_admin_user_id, v_grant.exam_id, v_grant.attempt_id,
    'admin_break_glass', v_grant.id, 'admin_break_glass_closed',
    p_request_key,
    jsonb_build_object(
      'grantId', v_grant.public_id,
      'candidateNumber', v_grant.candidate_number,
      'caseReference', v_grant.case_reference,
      'verifiedAuthenticationAt', p_verified_authentication_at
    )
  );
  v_response := jsonb_build_object(
    'ok', true,
    'grantId', v_grant.public_id,
    'examId', p_exam_public_id,
    'attemptId', p_attempt_public_id,
    'candidateNumber', v_grant.candidate_number,
    'caseReference', v_grant.case_reference,
    'closedAt', v_event.occurred_at,
    'requiresPostReview', true
  );
  return public.exam_room_command_complete_v2(
    p_admin_user_id, 'close_admin_break_glass_v2',
    p_request_key, v_request, v_response
  );
end;
$$;

create or replace function public.exam_room_record_admin_break_glass_review_v2(
  p_admin_user_id uuid,
  p_grant_public_id uuid,
  p_exam_public_id uuid,
  p_attempt_public_id uuid,
  p_candidate_number text,
  p_outcome text,
  p_notes text,
  p_verified_aal text,
  p_verified_session_id uuid,
  p_verified_authentication_at timestamptz,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.exam_room_admin_break_glass_grants%rowtype;
  v_event public.exam_room_admin_break_glass_events%rowtype;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object(
    'grantId', p_grant_public_id,
    'examId', p_exam_public_id,
    'attemptId', p_attempt_public_id,
    'candidateNumber', p_candidate_number,
    'outcome', p_outcome,
    'notes', p_notes,
    'verifiedAal', p_verified_aal,
    'verifiedSessionId', p_verified_session_id,
    'verifiedAuthenticationAt', p_verified_authentication_at
  );
  v_response := public.exam_room_command_begin_v2(
    p_admin_user_id, 'record_admin_break_glass_review_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  v_grant := public.exam_room_assert_admin_break_glass_identity_v2(
    p_admin_user_id, p_grant_public_id, p_verified_aal,
    p_verified_session_id, p_verified_authentication_at
  );
  if not exists (
    select 1
    from public.exam_room_exams e
    join public.exam_room_attempts a on a.exam_id = e.id
    where e.id = v_grant.exam_id
      and e.public_id = p_exam_public_id
      and a.id = v_grant.attempt_id
      and a.public_id = p_attempt_public_id
      and lower(a.candidate_number) = lower(btrim(p_candidate_number))
      and lower(v_grant.candidate_number) = lower(btrim(p_candidate_number))
  ) then raise exception 'EXAM_ROOM_BREAK_GLASS_SCOPE_INVALID'; end if;
  if p_outcome not in ('no_issue', 'procedure_change', 'escalation_required')
    or char_length(btrim(coalesce(p_notes, ''))) not between 5 and 4000
  then raise exception 'EXAM_ROOM_BREAK_GLASS_REVIEW_INVALID'; end if;
  if not exists (
    select 1 from public.exam_room_admin_break_glass_events ev
    where ev.grant_id = v_grant.id and ev.event_type = 'closed'
  ) then raise exception 'EXAM_ROOM_BREAK_GLASS_CLOSE_REQUIRED'; end if;
  if exists (
    select 1 from public.exam_room_admin_break_glass_events ev
    where ev.grant_id = v_grant.id and ev.event_type = 'post_review_completed'
  ) then raise exception 'EXAM_ROOM_BREAK_GLASS_REVIEW_ALREADY_RECORDED'; end if;
  insert into public.exam_room_admin_break_glass_events (
    grant_id, actor_user_id, event_type, verified_aal,
    verified_session_id, verified_authentication_at,
    request_key, reason, metadata
  ) values (
    v_grant.id, p_admin_user_id, 'post_review_completed', p_verified_aal,
    p_verified_session_id, p_verified_authentication_at,
    p_request_key, btrim(p_notes),
    jsonb_build_object(
      'outcome', p_outcome,
      'caseReference', v_grant.case_reference,
      'verifiedAuthenticationAt', p_verified_authentication_at
    )
  ) returning * into v_event;
  perform public.exam_room_append_audit_v2(
    p_admin_user_id, v_grant.exam_id, v_grant.attempt_id,
    'admin_break_glass', v_grant.id, 'admin_break_glass_post_review_completed',
    p_request_key,
    jsonb_build_object(
      'grantId', v_grant.public_id,
      'candidateNumber', v_grant.candidate_number,
      'caseReference', v_grant.case_reference,
      'outcome', p_outcome,
      'verifiedAuthenticationAt', p_verified_authentication_at
    )
  );
  v_response := jsonb_build_object(
    'ok', true,
    'grantId', v_grant.public_id,
    'examId', p_exam_public_id,
    'attemptId', p_attempt_public_id,
    'candidateNumber', v_grant.candidate_number,
    'caseReference', v_grant.case_reference,
    'outcome', p_outcome,
    'reviewedAt', v_event.occurred_at
  );
  return public.exam_room_command_complete_v2(
    p_admin_user_id, 'record_admin_break_glass_review_v2',
    p_request_key, v_request, v_response
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Read contracts. These return only the minimum role-scoped projection.
-- ---------------------------------------------------------------------------

create or replace function public.exam_room_exam_access_v2(
  p_user_id uuid,
  p_exam_public_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_email text;
  v_admin boolean;
  v_owner boolean;
  v_beadle boolean;
  v_student boolean;
  v_beadles jsonb := '[]'::jsonb;
  v_invitations jsonb := '[]'::jsonb;
begin
  select lower(u.email) into v_email from auth.users u where u.id = p_user_id;
  if v_email is null then raise exception 'EXAM_ROOM_AUTH_REQUIRED'; end if;
  select * into v_exam from public.exam_room_exams e where e.public_id = p_exam_public_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  v_admin := public.exam_room_is_admin(p_user_id);
  v_owner := v_exam.owner_professor_id = p_user_id;
  v_beadle := public.exam_room_has_active_beadle_assignment_v2(p_user_id, v_exam.id);
  v_student := exists (
    select 1 from public.exam_room_roster r
    where r.classroom_id = v_exam.classroom_id and r.status = 'active'
      and (r.student_user_id = p_user_id or r.canonical_email = v_email)
  );
  if v_owner then
    select coalesce(jsonb_agg(jsonb_build_object(
      'beadleUserId', b.beadle_user_id,
      'assignmentId', b.id,
      'status', case
        when b.status = 'active' and b.expires_at <= now() then 'expired'
        else b.status
      end,
      'assignedAt', b.assigned_at,
      'expiresAt', b.expires_at
    ) order by b.assigned_at desc), '[]'::jsonb)
    into v_beadles
    from public.exam_room_beadle_assignments b where b.exam_id = v_exam.id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'invitationId', i.id,
      'targetEmail', i.target_email,
      'status', i.status,
      'expiresAt', i.expires_at,
      'invitedAt', i.invited_at
    ) order by i.invited_at desc), '[]'::jsonb)
    into v_invitations
    from public.exam_room_beadle_invitations i
    where i.exam_id = v_exam.id and i.status = 'issued' and i.expires_at > now();
  end if;
  return jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'authorized', v_admin or v_owner or v_beadle or v_student,
    'roles', jsonb_build_object(
      'admin', v_admin,
      'professor', v_owner,
      'beadle', v_beadle,
      'student', v_student
    ),
    'canUploadQuestions', v_owner and (
      v_exam.status = 'draft'
      or (
        v_exam.status = 'scheduled'
        and v_exam.current_publication_id is not null
        and v_exam.opens_at is not null
        and now() < v_exam.opens_at
        and not exists (select 1 from public.exam_room_attempts a where a.exam_id = v_exam.id)
      )
    ),
    'canStageReplacementQuestions', v_owner
      and v_exam.status = 'scheduled'
      and v_exam.current_publication_id is not null
      and v_exam.opens_at is not null
      and now() < v_exam.opens_at
      and not exists (select 1 from public.exam_room_attempts a where a.exam_id = v_exam.id),
    'canUploadReplacementQuestions', v_owner
      and v_exam.status = 'scheduled'
      and v_exam.current_publication_id is not null
      and v_exam.opens_at is not null
      and now() < v_exam.opens_at
      and not exists (select 1 from public.exam_room_attempts a where a.exam_id = v_exam.id),
    'canUploadModelAnswer', v_owner
      and v_exam.status in ('confirmed', 'scheduled')
      and v_exam.current_publication_id is null
      and not exists (select 1 from public.exam_room_attempts a where a.exam_id = v_exam.id),
    'storagePrefix', case when v_owner then v_exam.id::text else null end,
    'canViewAnswers', v_owner,
    'canManageOperations', v_owner or v_beadle,
    'canManageRoster', public.exam_room_can_manage_roster_v2(p_user_id, v_exam.id),
    'currentPublicationId', (
      select p.public_id from public.exam_room_publications p
      where p.id = v_exam.current_publication_id
    ),
    'publicationNumber', (
      select p.publication_number from public.exam_room_publications p
      where p.id = v_exam.current_publication_id
    ),
    'attemptCount', (
      select count(*) from public.exam_room_attempts a where a.exam_id = v_exam.id
    ),
    'canReplacePublication', v_owner
      and v_exam.current_publication_id is not null
      and v_exam.status = 'scheduled'
      and v_exam.opens_at is not null
      and now() < v_exam.opens_at
      and not exists (select 1 from public.exam_room_attempts a where a.exam_id = v_exam.id),
    'replaceBlockedReason', case
      when not v_owner then 'NOT_OWNER'
      when v_exam.current_publication_id is null then 'NOT_PUBLISHED'
      when exists (select 1 from public.exam_room_attempts a where a.exam_id = v_exam.id) then 'ATTEMPTS_EXIST'
      when v_exam.opens_at is null or now() >= v_exam.opens_at then 'EXAM_ALREADY_OPEN'
      when v_exam.status <> 'scheduled' then 'EXAM_STATE_BLOCKED'
      else null
    end,
    'beadles', v_beadles,
    'pendingBeadleInvitations', v_invitations,
    'status', v_exam.status,
    'published', v_exam.current_publication_id is not null,
    'accessCodeRequired', case
      when v_exam.current_publication_id is null then null
      else (
        select (publication.rules_snapshot ->> 'studentAccessCodeRequired')::boolean
        from public.exam_room_publications publication
        where publication.id = v_exam.current_publication_id
      )
    end
  );
end;
$$;

create or replace function public.exam_room_beadle_portal_v2(
  p_user_id uuid,
  p_exam_public_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_assignments jsonb;
  v_candidates jsonb;
  v_counts jsonb;
  v_attention jsonb;
begin
  if p_exam_public_id is null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'examId', e.public_id,
      'title', e.title,
      'status', e.status,
      'opensAt', e.opens_at,
      'hardClosesAt', e.hard_closes_at,
      'role', case when e.owner_professor_id = p_user_id then 'professor' else 'beadle' end,
      'expiresAt', case when e.owner_professor_id = p_user_id then null else (
        select b.expires_at
        from public.exam_room_beadle_assignments b
        where b.exam_id = e.id
          and b.beadle_user_id = p_user_id
          and b.status = 'active'
          and b.expires_at > now()
        limit 1
      ) end
    ) order by e.opens_at desc nulls last), '[]'::jsonb)
    into v_assignments
    from public.exam_room_exams e
    where e.owner_professor_id = p_user_id
      or public.exam_room_has_active_beadle_assignment_v2(p_user_id, e.id);
    return jsonb_build_object('ok', true, 'assignments', v_assignments, 'canViewAnswers', false);
  end if;

  select * into v_exam from public.exam_room_exams e where e.public_id = p_exam_public_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  -- The public operations portal is role-scoped. Global administrators use
  -- the separate metadata-only admin surface and are never synthesized as a
  -- Beadle for every exam.
  if v_exam.owner_professor_id <> p_user_id
    and not public.exam_room_has_active_beadle_assignment_v2(p_user_id, v_exam.id)
  then
    raise exception 'EXAM_ROOM_OPERATOR_REQUIRED';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'candidateNumber', r.candidate_number,
    'displayName', r.display_name,
    'accountLinked', r.student_user_id is not null,
    'rosterStatus', r.status,
    'admissionStatus', coalesce(ad.status, 'eligible'),
    'admitted', coalesce(ad.status = 'admitted', false),
    'attemptId', a.public_id,
    'state', coalesce(a.status, 'not_started'),
    'attemptStatus', a.status,
    'activeSessionEpoch', case when a.status = 'in_progress' then (
      select s.epoch
      from public.exam_room_sessions s
      where s.attempt_id = a.id and s.status = 'active'
      limit 1
    ) else null end,
    'startedAt', a.started_at,
    'serverDeadline', a.server_deadline,
    'lastHeartbeatAt', a.last_heartbeat_at,
    'submittedAt', a.submitted_at,
    'generation', (
      select max(s.generation) from public.exam_room_submissions s where s.attempt_id = a.id
    ),
    'latestReceiptId', (
      select sr.public_id
      from public.exam_room_submissions s
      join public.exam_room_submission_receipts sr on sr.submission_id = s.id
      where s.attempt_id = a.id
      order by s.generation desc limit 1
    ),
    'priorReceiptId', (
      select prior_receipt.public_id
      from public.exam_room_submissions s
      join public.exam_room_submissions prior_submission on prior_submission.id = s.prior_submission_id
      join public.exam_room_submission_receipts prior_receipt
        on prior_receipt.submission_id = prior_submission.id
      where s.attempt_id = a.id
      order by s.generation desc limit 1
    ),
    'canReopenSubmission', v_exam.owner_professor_id = p_user_id
      and a.status in ('submitted', 'auto_submitted')
      and v_exam.status not in ('grading', 'sealed')
      and v_exam.release_id is null
      and exists (select 1 from public.exam_room_submissions s where s.attempt_id = a.id)
      and not exists (
        select 1 from public.exam_room_submission_reopenings ro
        where ro.attempt_id = a.id
          and ro.expires_at > now()
          and not exists (
            select 1 from public.exam_room_submissions rs where rs.reopening_id = ro.id
          )
      ),
    'reopenBlockedReason', case
      when v_exam.owner_professor_id <> p_user_id then 'NOT_OWNER'
      when a.id is null then 'ATTEMPT_NOT_STARTED'
      when a.status = 'sealed' or v_exam.status = 'sealed' or v_exam.release_id is not null then 'RESULTS_SEALED'
      when v_exam.status = 'grading' then 'GRADING_STARTED'
      when a.status not in ('submitted', 'auto_submitted') then 'ATTEMPT_NOT_SUBMITTED'
      when not exists (select 1 from public.exam_room_submissions s where s.attempt_id = a.id) then 'RECEIPT_REQUIRED'
      when exists (
        select 1 from public.exam_room_submission_reopenings ro
        where ro.attempt_id = a.id
          and ro.expires_at > now()
          and not exists (
            select 1 from public.exam_room_submissions rs where rs.reopening_id = ro.id
          )
      ) then 'REOPENING_ALREADY_ACTIVE'
      else null
    end,
    'leave', coalesce((
      select jsonb_build_object(
        'active', l.status in ('open', 'acknowledged'),
        'id', l.public_id,
        'departedAt', l.started_at,
        'elapsedMinutes', greatest(0, floor(extract(epoch from (coalesce(l.returned_at, now()) - l.started_at)) / 60)::integer),
        'status', l.status,
        'acknowledged', l.acknowledged_at is not null
      )
      from public.exam_room_temporary_leaves l
      where l.attempt_id = a.id
      order by l.started_at desc limit 1
    ), jsonb_build_object('active', false)),
    'incidentGroups', (
      select count(*) from public.exam_room_incident_groups g where g.attempt_id = a.id
    ),
    'verificationStatus', (
      select v.outcome from public.exam_room_identity_verifications v
      where v.exam_id = v_exam.id and v.roster_id = r.id
      order by v.recorded_at desc limit 1
    )
  ) order by r.candidate_number), '[]'::jsonb)
  into v_candidates
  from public.exam_room_roster r
  left join public.exam_room_admissions ad on ad.exam_id = v_exam.id and ad.roster_id = r.id
  left join public.exam_room_attempts a on a.exam_id = v_exam.id and a.roster_id = r.id
  where r.classroom_id = v_exam.classroom_id and r.status = 'active';

  select jsonb_build_object(
    'roster', count(*),
    'admitted', count(*) filter (where ad.status = 'admitted'),
    'notStarted', count(*) filter (where a.id is null),
    'inProgress', count(*) filter (where a.status = 'in_progress'),
    'submitted', count(*) filter (where a.status in ('submitted', 'auto_submitted', 'sealed')),
    'needsAttention', count(*) filter (where
      exists (select 1 from public.exam_room_temporary_leaves l where l.attempt_id = a.id and l.status in ('open', 'acknowledged'))
      or (a.status = 'in_progress' and a.last_heartbeat_at < now() - interval '90 seconds')
      or exists (select 1 from public.exam_room_incident_groups g where g.attempt_id = a.id and g.status = 'open' and g.severity in ('warning', 'critical'))
    )
  ) into v_counts
  from public.exam_room_roster r
  left join public.exam_room_admissions ad on ad.exam_id = v_exam.id and ad.roster_id = r.id
  left join public.exam_room_attempts a on a.exam_id = v_exam.id and a.roster_id = r.id
  where r.classroom_id = v_exam.classroom_id and r.status = 'active';

  select coalesce(jsonb_agg(jsonb_build_object(
    'candidateNumber', a.candidate_number,
    'attemptId', a.public_id,
    'attemptStatus', a.status,
    'lastHeartbeatAt', a.last_heartbeat_at,
    'activeLeaveId', (
      select l.public_id from public.exam_room_temporary_leaves l
      where l.attempt_id = a.id and l.status in ('open', 'acknowledged')
      order by l.started_at desc limit 1
    ),
    'reasons', jsonb_strip_nulls(jsonb_build_object(
      'activeLeave', case when exists (
        select 1 from public.exam_room_temporary_leaves l where l.attempt_id = a.id and l.status in ('open', 'acknowledged')
      ) then true else null end,
      'heartbeatStale', case when a.status = 'in_progress' and a.last_heartbeat_at < now() - interval '90 seconds' then true else null end,
      'incidentSeverity', (
        select max(g.severity) from public.exam_room_incident_groups g
        where g.attempt_id = a.id and g.status = 'open' and g.severity in ('warning', 'critical')
      )
    ))
  ) order by a.candidate_number), '[]'::jsonb)
  into v_attention
  from public.exam_room_attempts a
  where a.exam_id = v_exam.id and (
    exists (select 1 from public.exam_room_temporary_leaves l where l.attempt_id = a.id and l.status in ('open', 'acknowledged'))
    or (a.status = 'in_progress' and a.last_heartbeat_at < now() - interval '90 seconds')
    or exists (select 1 from public.exam_room_incident_groups g where g.attempt_id = a.id and g.status = 'open' and g.severity in ('warning', 'critical'))
  );

  return jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'title', v_exam.title,
    'status', v_exam.status,
    'opensAt', v_exam.opens_at,
    'hardClosesAt', v_exam.hard_closes_at,
    'accessCodeRequired', coalesce((
      select (p.rules_snapshot ->> 'studentAccessCodeRequired')::boolean
      from public.exam_room_publications p
      where p.id = v_exam.current_publication_id
    ), true),
    'assignmentExpiresAt', case when v_exam.owner_professor_id = p_user_id then null else (
      select b.expires_at
      from public.exam_room_beadle_assignments b
      where b.exam_id = v_exam.id
        and b.beadle_user_id = p_user_id
        and b.status = 'active'
        and b.expires_at > now()
      limit 1
    ) end,
    'canViewAnswers', false,
    'counts', v_counts,
    'attention', v_attention,
    'candidates', v_candidates
  );
end;
$$;

create or replace function public.exam_room_live_status_v2(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_grading_key_hash text,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_credential jsonb;
  v_candidates jsonb;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam
  from public.exam_room_exams e
  where e.public_id = p_exam_public_id
    and e.owner_professor_id = p_professor_user_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  v_credential := public.exam_room_check_credential(
    p_professor_user_id, v_exam.id, 'professor_grading',
    p_grading_key_hash, p_rate_key_hash
  );
  if not coalesce((v_credential ->> 'ok')::boolean, false) then
    return v_credential;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'candidateNumber', roster.candidate_number,
    'attemptId', attempt.public_id,
    'state', coalesce(attempt.status, 'not_started'),
    'startedAt', attempt.started_at,
    'serverDeadline', attempt.server_deadline,
    'submittedAt', attempt.submitted_at,
    'generation', latest_submission.generation,
    'latestReceiptId', latest_receipt.public_id,
    'priorReceiptId', prior_receipt.public_id,
    'activeReopeningId', active_reopening.public_id,
    'canReopenSubmission', attempt.status in ('submitted', 'auto_submitted')
      and v_exam.status not in ('grading', 'sealed')
      and v_exam.release_id is null
      and latest_submission.id is not null
      and latest_receipt.id is not null
      and active_reopening.id is null
      and attempt.server_deadline < clock_timestamp() + interval '4 hours',
    'reopenBlockedReason', case
      when attempt.id is null then 'ATTEMPT_NOT_STARTED'
      when attempt.status = 'sealed' or v_exam.status = 'sealed' or v_exam.release_id is not null then 'RESULTS_SEALED'
      when v_exam.status = 'grading' then 'GRADING_STARTED'
      when attempt.status not in ('submitted', 'auto_submitted') then 'ATTEMPT_NOT_SUBMITTED'
      when latest_submission.id is null or latest_receipt.id is null then 'RECEIPT_REQUIRED'
      when active_reopening.id is not null then 'REOPENING_ALREADY_ACTIVE'
      when attempt.server_deadline >= clock_timestamp() + interval '4 hours' then 'ORIGINAL_DEADLINE_TOO_FAR'
      else null
    end
  ) order by roster.candidate_number), '[]'::jsonb)
  into v_candidates
  from public.exam_room_roster roster
  left join public.exam_room_attempts attempt
    on attempt.exam_id = v_exam.id and attempt.roster_id = roster.id
  left join lateral (
    select submission.*
    from public.exam_room_submissions submission
    where submission.attempt_id = attempt.id
    order by submission.generation desc limit 1
  ) latest_submission on true
  left join public.exam_room_submission_receipts latest_receipt
    on latest_receipt.submission_id = latest_submission.id
  left join public.exam_room_submissions prior_submission
    on prior_submission.id = latest_submission.prior_submission_id
  left join public.exam_room_submission_receipts prior_receipt
    on prior_receipt.submission_id = prior_submission.id
  left join lateral (
    select reopening.*
    from public.exam_room_submission_reopenings reopening
    where reopening.attempt_id = attempt.id
      and reopening.expires_at > clock_timestamp()
      and not exists (
        select 1 from public.exam_room_submissions completed
        where completed.reopening_id = reopening.id
      )
    order by reopening.opened_at desc limit 1
  ) active_reopening on true
  where roster.classroom_id = v_exam.classroom_id
    and roster.status = 'active';
  return jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'title', v_exam.title,
    'status', v_exam.status,
    'opensAt', v_exam.opens_at,
    'hardClosesAt', v_exam.hard_closes_at,
    'serverNow', clock_timestamp(),
    'reopenMaximumMinutes', 240,
    'accessCodeRequired', coalesce((
      select (publication.rules_snapshot ->> 'studentAccessCodeRequired')::boolean
      from public.exam_room_publications publication
      where publication.id = v_exam.current_publication_id
    ), true),
    'candidates', v_candidates
  );
end;
$$;

create or replace function public.exam_room_student_preflight_v2(
  p_student_user_id uuid,
  p_exam_public_id uuid,
  p_device_instance_hash text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_roster public.exam_room_roster%rowtype;
  v_attempt public.exam_room_attempts%rowtype;
  v_email text;
  v_admission text;
  v_accommodation jsonb;
  v_rules jsonb;
  v_publication public.exam_room_publications%rowtype;
  v_session public.exam_room_sessions%rowtype;
  v_verification text;
begin
  if p_device_instance_hash is not null and p_device_instance_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'EXAM_ROOM_DEVICE_HASH_INVALID';
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = p_student_user_id;
  if v_email is null then raise exception 'EXAM_ROOM_AUTH_REQUIRED'; end if;
  select * into v_exam from public.exam_room_exams e where e.public_id = p_exam_public_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  select * into v_roster
  from public.exam_room_roster r
  where r.classroom_id = v_exam.classroom_id and r.status = 'active'
    and (r.student_user_id = p_student_user_id or r.canonical_email = v_email)
  limit 1;
  if not found then
    return jsonb_build_object(
      'ok', true, 'eligible', false, 'code', 'ROSTER_REQUIRED',
      'examId', v_exam.public_id, 'title', v_exam.title, 'serverNow', now(),
      'checks', jsonb_build_object('authenticated', true, 'rosterMatched', false)
    );
  end if;
  if v_roster.student_user_id is not null and v_roster.student_user_id <> p_student_user_id then
    return jsonb_build_object(
      'ok', true, 'eligible', false, 'code', 'ROSTER_ACCOUNT_MISMATCH',
      'examId', v_exam.public_id, 'title', v_exam.title, 'serverNow', now()
    );
  end if;
  select coalesce(a.status, 'eligible') into v_admission
  from (select 1) seed
  left join public.exam_room_admissions a on a.exam_id = v_exam.id and a.roster_id = v_roster.id;
  select a.configuration into v_accommodation
  from public.exam_room_accommodations a
  where a.exam_id = v_exam.id and a.roster_id = v_roster.id and a.status = 'active';
  select * into v_publication
  from public.exam_room_publications p where p.id = v_exam.current_publication_id;
  v_rules := v_publication.rules_snapshot;
  select * into v_attempt from public.exam_room_attempts a
  where a.exam_id = v_exam.id and a.roster_id = v_roster.id;
  if v_attempt.id is not null then
    select * into v_session from public.exam_room_sessions s
    where s.attempt_id = v_attempt.id and s.status = 'active';
  end if;
  select i.outcome into v_verification
  from public.exam_room_identity_verifications i
  where i.exam_id = v_exam.id and i.roster_id = v_roster.id
  order by i.recorded_at desc limit 1;
  return jsonb_build_object(
    'ok', true,
    'eligible', v_admission not in ('denied', 'withdrawn')
      and v_verification is distinct from 'blocked'
      and v_exam.current_publication_id is not null
      and (
        coalesce(v_rules ->> 'admissionMode', 'automatic') = 'automatic'
        or v_admission = 'admitted'
      ),
    'code', case
      when v_admission in ('denied', 'withdrawn') then 'ADMISSION_BLOCKED'
      when v_verification = 'blocked' then 'IDENTITY_VERIFICATION_BLOCKED'
      when v_exam.current_publication_id is null then 'EXAM_NOT_PUBLISHED'
      when coalesce(v_rules ->> 'admissionMode', 'automatic') = 'beadle_approval'
        and v_admission <> 'admitted' then 'ADMISSION_REQUIRED'
      else 'READY'
    end,
    'examId', v_exam.public_id,
    'title', v_exam.title,
    'instructions', coalesce(v_publication.instructions_snapshot, v_exam.instructions),
    'candidateNumber', v_roster.candidate_number,
    'accessCodeRequired', coalesce(
      (v_rules ->> 'studentAccessCodeRequired')::boolean,
      true
    ),
    'admissionStatus', v_admission,
    'verificationStatus', v_verification,
    'opensAt', v_exam.opens_at,
    'hardClosesAt', v_exam.hard_closes_at,
    'serverNow', now(),
    'serverDeadline', v_attempt.server_deadline,
    'sessionConflict', v_session.id is not null and (
      p_device_instance_hash is null or v_session.device_instance_hash <> p_device_instance_hash
    ),
    'activeEpoch', v_session.epoch,
    'rules', coalesce(v_rules, '{}'::jsonb),
    'accommodation', coalesce(v_accommodation, '{}'::jsonb),
    'attempt', case when v_attempt.id is null then null else jsonb_build_object(
      'attemptId', v_attempt.public_id,
      'status', v_attempt.status,
      'serverDeadline', v_attempt.server_deadline
    ) end,
    'checks', jsonb_build_object(
      'authenticated', true,
      'rosterMatched', true,
      'accountMatched', v_roster.student_user_id is null or v_roster.student_user_id = p_student_user_id,
      'published', v_exam.current_publication_id is not null,
      'accessCodeRequired', coalesce(
        (v_rules ->> 'studentAccessCodeRequired')::boolean,
        true
      )
    )
  );
end;
$$;

create or replace function public.exam_room_incident_summary_v2(
  p_actor_user_id uuid,
  p_exam_public_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_groups jsonb;
begin
  select * into v_exam from public.exam_room_exams e where e.public_id = p_exam_public_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if not public.exam_room_is_operator_v2(p_actor_user_id, v_exam.id, true) then
    raise exception 'EXAM_ROOM_OPERATOR_REQUIRED';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'incidentId', g.public_id,
    'attemptId', a.public_id,
    'candidateNumber', a.candidate_number,
    'category', g.category,
    'severity', g.severity,
    'status', g.status,
    'eventCount', g.event_count,
    'firstOccurredAt', g.first_occurred_at,
    'lastOccurredAt', g.last_occurred_at,
    'summary', g.summary
  ) order by g.last_occurred_at desc), '[]'::jsonb)
  into v_groups
  from public.exam_room_incident_groups g
  join public.exam_room_attempts a on a.id = g.attempt_id
  where g.exam_id = v_exam.id;
  return jsonb_build_object('ok', true, 'examId', v_exam.public_id, 'groups', v_groups, 'containsAnswers', false);
end;
$$;

-- Repair the inherited validator so the v2 optional-name contract is enforced
-- at the database boundary as well as in the Worker. This keeps the three
-- identity fields mandatory and limits a supplied display label to 200 chars.
create or replace function public.exam_room_validate_roster(
  p_professor_user_id uuid,
  p_classroom_public_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_class public.exam_room_classrooms%rowtype;
  v_errors jsonb := '[]'::jsonb;
  v_row jsonb;
  v_index integer := 0;
  v_email text;
  v_student text;
  v_candidate text;
  v_display_name text;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_class from public.exam_room_classrooms c
  where c.public_id = p_classroom_public_id
    and (
      c.owner_professor_id = p_professor_user_id
    );
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
    v_display_name := nullif(btrim(v_row ->> 'displayName'), '');
    if v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_index, 'code', 'EMAIL_INVALID', 'message', 'Enter a valid email.'));
    end if;
    if char_length(v_student) not between 1 and 120 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_index, 'code', 'STUDENT_NUMBER_INVALID', 'message', 'Student number is required.'));
    end if;
    if char_length(v_candidate) not between 1 and 120 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_index, 'code', 'CANDIDATE_NUMBER_INVALID', 'message', 'Candidate number is required.'));
    end if;
    if v_display_name is not null and char_length(v_display_name) > 200 then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_index, 'code', 'DISPLAY_NAME_INVALID', 'message', 'Display name must be 200 characters or fewer.'));
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

-- Exam-scoped Beadle roster wrappers. The legacy roster remains classroom
-- backed for compatibility; mutations are prohibited once this exam is
-- published or another exam in the same classroom is live/published.
create or replace function public.exam_room_validate_exam_roster_v2(
  p_actor_user_id uuid,
  p_exam_public_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_class public.exam_room_classrooms%rowtype;
begin
  select * into v_exam from public.exam_room_exams e where e.public_id = p_exam_public_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if not public.exam_room_can_manage_roster_v2(p_actor_user_id, v_exam.id) then
    raise exception 'EXAM_ROOM_OPERATOR_REQUIRED';
  end if;
  select * into v_class from public.exam_room_classrooms c where c.id = v_exam.classroom_id;
  return public.exam_room_validate_roster(
    v_exam.owner_professor_id, v_class.public_id, p_rows
  );
end;
$$;

create or replace function public.exam_room_import_exam_roster_v2(
  p_actor_user_id uuid,
  p_exam_public_id uuid,
  p_rows jsonb,
  p_request_key text,
  p_source_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_class public.exam_room_classrooms%rowtype;
  v_validation jsonb;
  v_row jsonb;
  v_user_id uuid;
  v_count integer := 0;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id, 'rows', p_rows, 'sourceHash', p_source_hash
  );
  v_response := public.exam_room_command_begin_v2(
    p_actor_user_id, 'import_exam_roster_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  if p_source_hash !~ '^[0-9a-f]{64}$' then raise exception 'EXAM_ROOM_ROSTER_REQUEST_INVALID'; end if;
  select * into v_exam from public.exam_room_exams e where e.public_id = p_exam_public_id for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if not public.exam_room_can_manage_roster_v2(p_actor_user_id, v_exam.id) then
    raise exception 'EXAM_ROOM_OPERATOR_REQUIRED';
  end if;
  if v_exam.current_publication_id is not null
    or exists (select 1 from public.exam_room_attempts a where a.exam_id = v_exam.id)
    or exists (
      select 1 from public.exam_room_exams other
      where other.classroom_id = v_exam.classroom_id and other.id <> v_exam.id
        and (other.current_publication_id is not null or other.status in ('open', 'closed', 'grading', 'sealed'))
    )
  then raise exception 'EXAM_ROOM_ROSTER_LOCKED'; end if;
  select * into v_class from public.exam_room_classrooms c where c.id = v_exam.classroom_id for update;
  v_validation := public.exam_room_validate_roster(
    v_exam.owner_professor_id, v_class.public_id, p_rows
  );
  if not (v_validation ->> 'ok')::boolean then return v_validation; end if;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    select u.id into v_user_id from auth.users u
    where lower(u.email) = lower(btrim(v_row ->> 'email')) limit 1;
    insert into public.exam_room_roster (
      classroom_id, student_user_id, canonical_email, student_number,
      candidate_number, display_name, status, created_by, updated_by
    ) values (
      v_class.id, v_user_id, lower(btrim(v_row ->> 'email')),
      btrim(v_row ->> 'studentNumber'), btrim(v_row ->> 'candidateNumber'),
      nullif(btrim(v_row ->> 'displayName'), ''), 'active', p_actor_user_id, p_actor_user_id
    )
    on conflict (classroom_id, canonical_email) do update
    set student_user_id = excluded.student_user_id,
        student_number = excluded.student_number,
        candidate_number = excluded.candidate_number,
        display_name = excluded.display_name,
        status = 'active', updated_by = excluded.updated_by, updated_at = now();
    v_count := v_count + 1;
  end loop;
  perform public.exam_room_queue_backup(
    v_exam.id, 'roster_imported',
    jsonb_build_object('examId', v_exam.public_id, 'rowCount', v_count, 'sourceHash', p_source_hash, 'rows', p_rows)
  );
  perform public.exam_room_append_audit_v2(
    p_actor_user_id, v_exam.id, null, 'exam_roster', v_exam.id,
    'exam_roster_imported', p_request_key,
    jsonb_build_object('rowCount', v_count, 'sourceHash', p_source_hash)
  );
  v_response := jsonb_build_object('ok', true, 'imported', v_count, 'sourceHash', p_source_hash);
  return public.exam_room_command_complete_v2(
    p_actor_user_id, 'import_exam_roster_v2', p_request_key, v_request, v_response
  );
end;
$$;

create or replace function public.exam_room_upsert_roster_row_v2(
  p_actor_user_id uuid,
  p_exam_public_id uuid,
  p_row jsonb,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_class public.exam_room_classrooms%rowtype;
  v_validation jsonb;
  v_roster public.exam_room_roster%rowtype;
  v_user_id uuid;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id, 'row', p_row, 'reason', p_reason
  );
  v_response := public.exam_room_command_begin_v2(
    p_actor_user_id, 'upsert_roster_row_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  if jsonb_typeof(p_row) <> 'object' or char_length(btrim(p_reason)) not between 5 and 1000 then
    raise exception 'EXAM_ROOM_ROSTER_REQUEST_INVALID';
  end if;
  select * into v_exam from public.exam_room_exams e where e.public_id = p_exam_public_id for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if not public.exam_room_can_manage_roster_v2(p_actor_user_id, v_exam.id) then
    raise exception 'EXAM_ROOM_OPERATOR_REQUIRED';
  end if;
  if v_exam.current_publication_id is not null
    or exists (select 1 from public.exam_room_attempts a where a.exam_id = v_exam.id)
    or exists (
      select 1 from public.exam_room_exams other
      where other.classroom_id = v_exam.classroom_id and other.id <> v_exam.id
        and (other.current_publication_id is not null or other.status in ('open', 'closed', 'grading', 'sealed'))
    )
  then raise exception 'EXAM_ROOM_ROSTER_LOCKED'; end if;
  select * into v_class from public.exam_room_classrooms c where c.id = v_exam.classroom_id for update;
  v_validation := public.exam_room_validate_roster(
    v_exam.owner_professor_id, v_class.public_id, jsonb_build_array(p_row)
  );
  if not (v_validation ->> 'ok')::boolean then return v_validation; end if;
  select u.id into v_user_id from auth.users u
  where lower(u.email) = lower(btrim(p_row ->> 'email')) limit 1;
  insert into public.exam_room_roster (
    classroom_id, student_user_id, canonical_email, student_number,
    candidate_number, display_name, status, created_by, updated_by
  ) values (
    v_class.id, v_user_id, lower(btrim(p_row ->> 'email')),
    btrim(p_row ->> 'studentNumber'), btrim(p_row ->> 'candidateNumber'),
    nullif(btrim(p_row ->> 'displayName'), ''), 'active', p_actor_user_id, p_actor_user_id
  )
  on conflict (classroom_id, canonical_email) do update
  set student_user_id = excluded.student_user_id,
      student_number = excluded.student_number,
      candidate_number = excluded.candidate_number,
      display_name = excluded.display_name,
      status = 'active', updated_by = excluded.updated_by, updated_at = now()
  returning * into v_roster;
  perform public.exam_room_append_audit_v2(
    p_actor_user_id, v_exam.id, null, 'exam_roster', v_roster.id,
    'exam_roster_row_changed', p_request_key,
    jsonb_build_object('candidateNumber', v_roster.candidate_number, 'reason', p_reason)
  );
  v_response := jsonb_build_object(
    'ok', true, 'candidateNumber', v_roster.candidate_number,
    'displayName', v_roster.display_name, 'accountLinked', v_roster.student_user_id is not null
  );
  return public.exam_room_command_complete_v2(
    p_actor_user_id, 'upsert_roster_row_v2', p_request_key, v_request, v_response
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Professor publication and delegated Beadle lifecycle
-- ---------------------------------------------------------------------------

create or replace function public.exam_room_register_model_answer_source_v2(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_object_path text,
  p_safe_file_name text,
  p_mime_type text,
  p_size_bytes integer,
  p_content_hash text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_source public.exam_room_model_answer_sources%rowtype;
  v_request jsonb;
  v_response jsonb;
begin
  -- File-backed model answers remain disabled until a Professor-only,
  -- post-close retrieval path is implemented and audited end to end.
  raise exception 'EXAM_ROOM_MODEL_ANSWER_UPLOAD_UNAVAILABLE';
  v_request := jsonb_build_object(
    'examId', p_exam_public_id, 'objectPath', p_object_path,
    'safeFileName', p_safe_file_name, 'mimeType', p_mime_type,
    'sizeBytes', p_size_bytes, 'contentHash', p_content_hash
  );
  v_response := public.exam_room_command_begin_v2(
    p_professor_user_id, 'register_model_answer_source_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  select * into v_exam from public.exam_room_exams e
  where e.public_id = p_exam_public_id
    and e.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.status not in ('confirmed', 'scheduled')
    or v_exam.current_publication_id is not null
    or exists (select 1 from public.exam_room_attempts a where a.exam_id = v_exam.id)
  then raise exception 'EXAM_ROOM_MODEL_ANSWER_UPLOAD_NOT_ALLOWED'; end if;
  if p_mime_type not in (
      'text/plain', 'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    or p_size_bytes not between 1 and 10485760
    or p_content_hash !~ '^[0-9a-f]{64}$'
    or char_length(btrim(p_safe_file_name)) not between 1 and 180
    or p_safe_file_name !~ '^[A-Za-z0-9][A-Za-z0-9_. -]{0,179}$'
    or p_object_path <> v_exam.id::text || '/model-answers/' || p_content_hash || '/' || p_safe_file_name
  then raise exception 'EXAM_ROOM_MODEL_ANSWER_SOURCE_INVALID'; end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'exam-room-sources' and o.name = p_object_path
  ) then raise exception 'EXAM_ROOM_MODEL_ANSWER_OBJECT_NOT_FOUND'; end if;
  insert into public.exam_room_model_answer_sources (
    exam_id, object_path, safe_file_name, mime_type,
    size_bytes, content_hash, uploaded_by
  ) values (
    v_exam.id, p_object_path, p_safe_file_name, p_mime_type,
    p_size_bytes, p_content_hash, p_professor_user_id
  ) returning * into v_source;
  perform public.exam_room_append_audit_v2(
    p_professor_user_id, v_exam.id, null, 'model_answer_source', v_source.id,
    'model_answer_source_registered', p_request_key,
    jsonb_build_object('contentHash', v_source.content_hash, 'mimeType', v_source.mime_type, 'sizeBytes', v_source.size_bytes)
  );
  v_response := jsonb_build_object(
    'ok', true, 'sourceId', v_source.id,
    'objectPath', v_source.object_path, 'contentHash', v_source.content_hash
  );
  return public.exam_room_command_complete_v2(
    p_professor_user_id, 'register_model_answer_source_v2', p_request_key, v_request, v_response
  );
end;
$$;

create or replace function public.exam_room_publish_exam_v2(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_rules jsonb,
  p_student_key_hash text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_publication public.exam_room_publications%rowtype;
  v_questions jsonb;
  v_snapshot jsonb;
  v_request jsonb;
  v_response jsonb;
  v_unknown_key text;
  v_student_rules jsonb;
  v_model_mode text;
  v_model_hash text;
  v_model_source public.exam_room_model_answer_sources%rowtype;
  v_access_code_required boolean;
  v_is_replacement boolean := false;
  v_supersedes_publication_id uuid;
  v_publication_number integer := 1;
  v_replacement_reason text;
  v_replacement_request_key text;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id,
    'rules', p_rules,
    'studentCredentialSupplied', p_student_key_hash is not null,
    'studentCredentialHash', p_student_key_hash
  );
  v_response := public.exam_room_command_begin_v2(
    p_professor_user_id, 'publish_exam_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam from public.exam_room_exams e
  where e.public_id = p_exam_public_id and e.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.status <> 'scheduled'
    or v_exam.active_question_version_id is null
    or v_exam.opens_at is null
    or v_exam.hard_closes_at is null
  then
    raise exception 'EXAM_ROOM_EXAM_NOT_SCHEDULED';
  end if;
  v_is_replacement := v_exam.current_publication_id is not null
    and coalesce(current_setting('app.exam_room_replacement_exam', true), '') = v_exam.id::text;
  if v_exam.current_publication_id is not null and not v_is_replacement then
    raise exception 'EXAM_ROOM_ALREADY_PUBLISHED';
  end if;
  if v_is_replacement then
    v_supersedes_publication_id := v_exam.current_publication_id;
    v_replacement_reason := nullif(
      current_setting('app.exam_room_replacement_reason', true), ''
    );
    v_replacement_request_key := nullif(
      current_setting('app.exam_room_replacement_request_key', true), ''
    );
    if v_replacement_reason is null or v_replacement_request_key is null then
      raise exception 'EXAM_ROOM_REPLACEMENT_CONTEXT_REQUIRED';
    end if;
    select coalesce(max(p.publication_number), 0) + 1
    into v_publication_number
    from public.exam_room_publications p
    where p.exam_id = v_exam.id;
  end if;
  if exists (select 1 from public.exam_room_attempts a where a.exam_id = v_exam.id)
    or not exists (
      select 1 from public.exam_room_credentials c
      where c.exam_id = v_exam.id and c.credential_type = 'professor_grading' and c.status = 'active'
    )
  then raise exception 'EXAM_ROOM_PUBLICATION_PRECONDITION_FAILED'; end if;
  if jsonb_typeof(p_rules) <> 'object'
    or octet_length(p_rules::text) > 65536
    or public.exam_room_json_has_forbidden_key(p_rules)
  then raise exception 'EXAM_ROOM_RULES_INVALID'; end if;
  select key into v_unknown_key
  from jsonb_object_keys(p_rules) key
  where key not in (
    'opensAt', 'hardClosesAt', 'durationMinutes', 'lateAdmissionMinutes',
    'submissionGraceMinutes', 'allowedMaterials', 'navigationMode',
    'integrityMode', 'fullscreenPolicy', 'admissionMode',
    'temporaryLeaveAcknowledgment', 'suggestedAnswerMode',
    'suggestedAnswer', 'suggestedAnswerObjectPath', 'aiGradingEnabled',
    'studentAccessCodeRequired'
  ) limit 1;
  if v_unknown_key is not null then raise exception 'EXAM_ROOM_RULE_UNKNOWN'; end if;
  -- One-way navigation cannot be enforced by presentation controls alone.
  -- Keep publication fail-closed until every accepted answer operation carries
  -- durable server-side question-progress state that cannot be rolled back.
  if p_rules ->> 'navigationMode' = 'one_way' then
    raise exception 'EXAM_ROOM_ONE_WAY_NAVIGATION_UNAVAILABLE';
  end if;
  if p_rules ->> 'suggestedAnswerMode' = 'upload' then
    raise exception 'EXAM_ROOM_MODEL_ANSWER_UPLOAD_UNAVAILABLE';
  end if;
  if not (p_rules ?& array[
      'opensAt', 'hardClosesAt', 'durationMinutes', 'lateAdmissionMinutes',
      'submissionGraceMinutes', 'allowedMaterials', 'navigationMode',
      'integrityMode', 'fullscreenPolicy', 'admissionMode',
      'temporaryLeaveAcknowledgment', 'suggestedAnswerMode', 'aiGradingEnabled',
      'studentAccessCodeRequired'
    ])
    or (p_rules ->> 'opensAt')::timestamptz <> v_exam.opens_at
    or (p_rules ->> 'hardClosesAt')::timestamptz <> v_exam.hard_closes_at
    or (
      (v_exam.duration_minutes is null and jsonb_typeof(p_rules -> 'durationMinutes') <> 'null')
      or (v_exam.duration_minutes is not null and (p_rules ->> 'durationMinutes')::integer <> v_exam.duration_minutes)
    )
    or (p_rules ->> 'lateAdmissionMinutes')::integer not between 0 and 480
    or (p_rules ->> 'submissionGraceMinutes')::integer not between 0 and 120
    or jsonb_typeof(p_rules -> 'allowedMaterials') <> 'string'
    or char_length(p_rules ->> 'allowedMaterials') > 2000
    or (p_rules ->> 'navigationMode') <> 'free'
    or (p_rules ->> 'integrityMode') not in ('off', 'record_only', 'warn_and_record')
    or (p_rules ->> 'fullscreenPolicy') not in ('off', 'requested', 'required_with_exemptions')
    or (p_rules ->> 'admissionMode') not in ('automatic', 'beadle_approval')
    or jsonb_typeof(p_rules -> 'temporaryLeaveAcknowledgment') <> 'boolean'
    or (p_rules ->> 'suggestedAnswerMode') not in ('none', 'paste')
    or jsonb_typeof(p_rules -> 'studentAccessCodeRequired') <> 'boolean'
    or coalesce((p_rules ->> 'aiGradingEnabled')::boolean, true)
  then raise exception 'EXAM_ROOM_RULES_INVALID'; end if;
  v_access_code_required := (p_rules ->> 'studentAccessCodeRequired')::boolean;
  if v_access_code_required then
    if p_student_key_hash !~ '^[0-9a-f]{64}$'
      or not exists (
        select 1 from public.exam_room_credentials c
        where c.exam_id = v_exam.id
          and c.credential_type = 'student_exam'
          and c.status = 'active'
          and c.token_hash = p_student_key_hash
      )
    then raise exception 'EXAM_ROOM_STUDENT_ACCESS_CODE_MISMATCH'; end if;
  elsif p_student_key_hash is not null then
    raise exception 'EXAM_ROOM_STUDENT_ACCESS_CODE_UNEXPECTED';
  end if;
  v_model_mode := p_rules ->> 'suggestedAnswerMode';
  if v_model_mode = 'none' then
    if nullif(btrim(coalesce(p_rules ->> 'suggestedAnswer', '')), '') is not null
      or nullif(btrim(coalesce(p_rules ->> 'suggestedAnswerObjectPath', '')), '') is not null
    then raise exception 'EXAM_ROOM_MODEL_ANSWER_INVALID'; end if;
    v_model_hash := null;
  elsif v_model_mode = 'paste' then
    if char_length(btrim(coalesce(p_rules ->> 'suggestedAnswer', ''))) not between 1 and 100000
      or nullif(btrim(coalesce(p_rules ->> 'suggestedAnswerObjectPath', '')), '') is not null
    then raise exception 'EXAM_ROOM_MODEL_ANSWER_INVALID'; end if;
    v_model_hash := encode(extensions.digest(
      pg_catalog.convert_to(p_rules ->> 'suggestedAnswer', 'UTF8'), 'sha256'
    ), 'hex');
  else
    if nullif(btrim(coalesce(p_rules ->> 'suggestedAnswer', '')), '') is not null
      or nullif(btrim(coalesce(p_rules ->> 'suggestedAnswerObjectPath', '')), '') is null
    then raise exception 'EXAM_ROOM_MODEL_ANSWER_INVALID'; end if;
    select * into v_model_source
    from public.exam_room_model_answer_sources s
    where s.exam_id = v_exam.id
      and s.object_path = p_rules ->> 'suggestedAnswerObjectPath';
    if not found
      or v_model_source.object_path !~ (
        '^' || v_exam.id::text || '/model-answers/[0-9a-f]{64}/[A-Za-z0-9][A-Za-z0-9_. -]{0,179}$'
      )
    then raise exception 'EXAM_ROOM_MODEL_ANSWER_SOURCE_NOT_REGISTERED'; end if;
    v_model_hash := v_model_source.content_hash;
  end if;
  v_student_rules := p_rules - 'suggestedAnswer' - 'suggestedAnswerObjectPath';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'ordinal', q.ordinal,
    'prompt', q.prompt_text,
    'maximumPoints', q.maximum_points,
    'promptHash', q.prompt_hash
  ) order by q.ordinal), '[]'::jsonb)
  into v_questions
  from public.exam_room_questions q
  where q.question_version_id = v_exam.active_question_version_id;
  if jsonb_array_length(v_questions) <> v_exam.requested_question_count then
    raise exception 'EXAM_ROOM_QUESTION_COUNT_MISMATCH';
  end if;
  if not v_access_code_required then
    update public.exam_room_credentials c
    set status = 'revoked',
        revoked_by = p_professor_user_id,
        revoked_at = now(),
        revoke_reason = 'Student access code disabled in the immutable publication policy.'
    where c.exam_id = v_exam.id
      and c.credential_type = 'student_exam'
      and c.status = 'active';
  end if;
  -- The shared exam credential may remain valid through the latest approved
  -- individual window. Roster/admission checks still scope actual entry.
  update public.exam_room_credentials c
  set expires_at = greatest(c.expires_at, coalesce((
    select max(
      coalesce(
        nullif(a.configuration ->> 'individualHardClosesAt', '')::timestamptz,
        v_exam.hard_closes_at
      ) + make_interval(mins =>
        coalesce((a.configuration ->> 'extraMinutes')::integer, 0)
        + coalesce((a.configuration ->> 'incidentExtensionMinutes')::integer, 0)
      )
    )
    from public.exam_room_accommodations a
    where a.exam_id = v_exam.id and a.status = 'active'
  ), c.expires_at))
  where c.exam_id = v_exam.id and c.credential_type = 'student_exam' and c.status = 'active';
  -- The same Professor key authenticates consequential operational commands
  -- such as a submission reopen. Grading data remains separately time-gated
  -- by its RPCs, so activating the credential at publication does not expose
  -- answers before grading readiness.
  update public.exam_room_credentials c
  set valid_from = least(coalesce(c.valid_from, now()), now())
  where c.exam_id = v_exam.id
    and c.credential_type = 'professor_grading'
    and c.status = 'active';
  v_snapshot := jsonb_build_object(
    'examId', v_exam.public_id,
    'title', v_exam.title,
    'instructions', v_exam.instructions,
    'durationMinutes', v_exam.duration_minutes,
    'opensAt', v_exam.opens_at,
    'hardClosesAt', v_exam.hard_closes_at,
    'integrityPreset', v_exam.integrity_preset,
    'questionVersionId', v_exam.active_question_version_id,
    'questions', v_questions,
    'rules', v_student_rules,
    'privateModelAnswerHash', v_model_hash
  );
  insert into public.exam_room_publications (
    exam_id, question_version_id, publication_number,
    supersedes_publication_id, replacement_reason, replacement_request_key,
    title_snapshot, instructions_snapshot, question_count,
    questions_snapshot, rules_snapshot, snapshot_hash, published_by
  ) values (
    v_exam.id, v_exam.active_question_version_id, v_publication_number,
    v_supersedes_publication_id, v_replacement_reason, v_replacement_request_key,
    v_exam.title, v_exam.instructions, v_exam.requested_question_count,
    v_questions, v_student_rules, public.exam_room_hash_json(v_snapshot), p_professor_user_id
  ) returning * into v_publication;
  if v_model_mode = 'paste' then
    insert into public.exam_room_publication_model_answers (
      publication_id, exam_id, mode, answer_text, content_hash, created_by
    ) values (
      v_publication.id, v_exam.id, 'paste', p_rules ->> 'suggestedAnswer',
      v_model_hash, p_professor_user_id
    );
  elsif v_model_mode = 'upload' then
    insert into public.exam_room_publication_model_answers (
      publication_id, exam_id, mode, source_id, content_hash, created_by
    ) values (
      v_publication.id, v_exam.id, 'upload', v_model_source.id,
      v_model_hash, p_professor_user_id
    );
  end if;
  update public.exam_room_exams
  set current_publication_id = v_publication.id,
      published_at = v_publication.published_at,
      updated_at = now()
  where id = v_exam.id;
  perform public.exam_room_append_audit_v2(
    p_professor_user_id, v_exam.id, null, 'publication', v_publication.id,
    case when v_is_replacement then 'exam_publication_version_created' else 'exam_published' end,
    p_request_key,
    jsonb_build_object(
      'publicationId', v_publication.public_id,
      'publicationNumber', v_publication.publication_number,
      'supersedesPublicationId', (
        select p.public_id from public.exam_room_publications p
        where p.id = v_publication.supersedes_publication_id
      ),
      'snapshotHash', v_publication.snapshot_hash,
      'studentAccessCodeRequired', v_access_code_required
    )
  );
  v_response := jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'publicationId', v_publication.public_id,
    'publicationNumber', v_publication.publication_number,
    'supersedesPublicationId', (
      select p.public_id from public.exam_room_publications p
      where p.id = v_publication.supersedes_publication_id
    ),
    'publishedAt', v_publication.published_at,
    'snapshotHash', v_publication.snapshot_hash,
    'questionCount', v_publication.question_count,
    'accessCodeRequired', v_access_code_required
  );
  return public.exam_room_command_complete_v2(
    p_professor_user_id, 'publish_exam_v2', p_request_key, v_request, v_response
  );
exception
  when invalid_text_representation then raise exception 'EXAM_ROOM_RULES_INVALID';
end;
$$;

-- Stage corrected questions for a replacement without mutating either the
-- published snapshot or exam.active_question_version_id. Only the subsequent
-- transactional replacement command may activate this exact staged version.
create or replace function public.exam_room_confirm_replacement_questions_v2(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_expected_publication_id uuid,
  p_object_path text,
  p_safe_file_name text,
  p_mime_type text,
  p_size_bytes integer,
  p_page_count integer,
  p_content_hash text,
  p_questions jsonb,
  p_warnings jsonb,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_publication public.exam_room_publications%rowtype;
  v_source public.exam_room_question_sources%rowtype;
  v_version public.exam_room_question_versions%rowtype;
  v_source_version integer;
  v_version_number integer;
  v_question jsonb;
  v_ordinal integer;
  v_prompt text;
  v_maximum_points numeric;
  v_count integer;
  v_snapshot_hash text;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id,
    'expectedPublicationId', p_expected_publication_id,
    'objectPath', p_object_path,
    'safeFileName', p_safe_file_name,
    'mimeType', p_mime_type,
    'sizeBytes', p_size_bytes,
    'pageCount', p_page_count,
    'contentHash', p_content_hash,
    'questions', p_questions,
    'warnings', p_warnings
  );
  v_response := public.exam_room_command_begin_v2(
    p_professor_user_id, 'confirm_replacement_questions_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam
  from public.exam_room_exams e
  where e.public_id = p_exam_public_id
    and e.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  select * into v_publication
  from public.exam_room_publications p
  where p.id = v_exam.current_publication_id
    and p.public_id = p_expected_publication_id
    and p.exam_id = v_exam.id;
  if not found then raise exception 'EXAM_ROOM_PUBLICATION_VERSION_CONFLICT'; end if;
  if v_exam.status <> 'scheduled'
    or v_exam.opens_at is null
    or clock_timestamp() >= v_exam.opens_at
    or v_exam.release_id is not null
    or exists (select 1 from public.exam_room_attempts a where a.exam_id = v_exam.id)
  then raise exception 'EXAM_ROOM_REPLACEMENT_NOT_ALLOWED'; end if;
  if p_mime_type not in (
      'text/plain', 'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    or p_size_bytes not between 1 and 10485760
    or (p_page_count is not null and p_page_count not between 1 and 50)
    or p_content_hash !~ '^[0-9a-f]{64}$'
    or p_safe_file_name !~ '^[A-Za-z0-9_.-]+$'
    or char_length(p_safe_file_name) not between 1 and 180
    or p_object_path <> (
      v_exam.id::text || '/' || p_content_hash || '/' || p_safe_file_name
    )
    or jsonb_typeof(p_questions) <> 'array'
    or jsonb_typeof(p_warnings) <> 'array'
    or octet_length(p_questions::text) > 4000000
    or octet_length(p_warnings::text) > 65536
    or public.exam_room_json_has_forbidden_key(p_warnings)
  then raise exception 'EXAM_ROOM_REPLACEMENT_QUESTION_SOURCE_INVALID'; end if;
  v_count := jsonb_array_length(p_questions);
  if v_count < 1 or v_count > 200 or v_count <> v_exam.requested_question_count then
    raise exception 'EXAM_ROOM_QUESTION_COUNT_MISMATCH';
  end if;
  if exists (
    select 1 from (
      select (value ->> 'ordinal')::integer ordinal, count(*) count_rows
      from jsonb_array_elements(p_questions)
      group by 1 having count(*) > 1
    ) duplicate_ordinals
  ) then raise exception 'EXAM_ROOM_QUESTION_ORDINAL_DUPLICATE'; end if;
  for v_question in
    select value from jsonb_array_elements(p_questions)
    order by (value ->> 'ordinal')::integer
  loop
    begin
      v_ordinal := (v_question ->> 'ordinal')::integer;
      v_maximum_points := coalesce(
        nullif(v_question ->> 'maximumPoints', '')::numeric,
        5
      );
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'EXAM_ROOM_QUESTION_INVALID';
    end;
    v_prompt := v_question ->> 'prompt';
    if v_ordinal not between 1 and v_count
      or char_length(btrim(coalesce(v_prompt, ''))) < 1
      or char_length(v_prompt) > 20000
      or v_maximum_points <= 0
      or v_maximum_points > 1000
    then raise exception 'EXAM_ROOM_QUESTION_INVALID'; end if;
  end loop;
  if exists (
    select 1 from generate_series(1, v_count) expected
    where not exists (
      select 1 from jsonb_array_elements(p_questions) q
      where (q ->> 'ordinal')::integer = expected
    )
  ) then raise exception 'EXAM_ROOM_QUESTION_SEQUENCE_INVALID'; end if;

  select coalesce(max(s.source_version), 0) + 1
  into v_source_version
  from public.exam_room_question_sources s where s.exam_id = v_exam.id;
  insert into public.exam_room_question_sources (
    exam_id, source_version, object_path, safe_file_name, mime_type,
    size_bytes, page_count, content_hash, extraction_status,
    extraction_warnings, uploaded_by, confirmed_by, confirmed_at
  ) values (
    v_exam.id, v_source_version, p_object_path, p_safe_file_name, p_mime_type,
    p_size_bytes, p_page_count, p_content_hash, 'staged_replacement',
    p_warnings, p_professor_user_id, p_professor_user_id, now()
  ) returning * into v_source;
  select coalesce(max(qv.version_number), 0) + 1
  into v_version_number
  from public.exam_room_question_versions qv where qv.exam_id = v_exam.id;
  v_snapshot_hash := public.exam_room_hash_json(p_questions);
  insert into public.exam_room_question_versions (
    exam_id, source_id, version_number, question_count,
    snapshot_hash, status, confirmed_by, confirmed_at
  ) values (
    v_exam.id, v_source.id, v_version_number, v_count,
    v_snapshot_hash, 'confirmed', p_professor_user_id, now()
  ) returning * into v_version;
  for v_question in
    select value from jsonb_array_elements(p_questions)
    order by (value ->> 'ordinal')::integer
  loop
    v_ordinal := (v_question ->> 'ordinal')::integer;
    v_prompt := v_question ->> 'prompt';
    v_maximum_points := coalesce(
      nullif(v_question ->> 'maximumPoints', '')::numeric,
      5
    );
    insert into public.exam_room_questions (
      question_version_id, ordinal, prompt_text, maximum_points, prompt_hash
    ) values (
      v_version.id, v_ordinal, v_prompt, v_maximum_points,
      encode(extensions.digest(pg_catalog.convert_to(v_prompt, 'UTF8'), 'sha256'), 'hex')
    );
  end loop;
  perform public.exam_room_append_audit_v2(
    p_professor_user_id, v_exam.id, null, 'question_version', v_version.id,
    'replacement_questions_staged', p_request_key,
    jsonb_build_object(
      'expectedPublicationId', v_publication.public_id,
      'replacementQuestionVersionId', v_version.id,
      'versionNumber', v_version.version_number,
      'questionCount', v_version.question_count,
      'snapshotHash', v_version.snapshot_hash
    )
  );
  v_response := jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'expectedPublicationId', v_publication.public_id,
    'replacementQuestionVersionId', v_version.id,
    'sourceVersion', v_source.source_version,
    'questionVersionNumber', v_version.version_number,
    'questionCount', v_version.question_count,
    'snapshotHash', v_version.snapshot_hash,
    'staged', true
  );
  return public.exam_room_command_complete_v2(
    p_professor_user_id, 'confirm_replacement_questions_v2',
    p_request_key, v_request, v_response
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'EXAM_ROOM_REPLACEMENT_QUESTION_SOURCE_INVALID';
end;
$$;

-- Create a new immutable publication only before the first candidate starts.
-- The exam row lock serializes this zero-attempt guard with start_attempt,
-- while the expected publication id prevents a stale Professor tab from
-- replacing a newer version. All active exam/grading credentials are rotated
-- in the same transaction; an optional student code is omitted entirely.
create or replace function public.exam_room_replace_publication_v2(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_expected_publication_id uuid,
  p_replacement_question_version_id uuid,
  p_rules jsonb,
  p_student_key_hash text,
  p_grading_key_hash text,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_previous public.exam_room_publications%rowtype;
  v_current public.exam_room_publications%rowtype;
  v_replacement_version public.exam_room_question_versions%rowtype;
  v_access_code_required boolean;
  v_request jsonb;
  v_response jsonb;
  v_publish jsonb;
  v_outbox_id uuid;
  v_notification_count integer := 0;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id,
    'expectedPublicationId', p_expected_publication_id,
    'replacementQuestionVersionId', p_replacement_question_version_id,
    'rules', p_rules,
    'reason', p_reason,
    'studentCredentialSupplied', p_student_key_hash is not null,
    'gradingCredentialSupplied', p_grading_key_hash is not null,
    'studentCredentialHash', p_student_key_hash,
    'gradingCredentialHash', p_grading_key_hash
  );
  v_response := public.exam_room_command_begin_v2(
    p_professor_user_id, 'replace_publication_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam
  from public.exam_room_exams e
  where e.public_id = p_exam_public_id
    and e.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.current_publication_id is null
    or v_exam.status <> 'scheduled'
    or v_exam.opens_at is null
    or clock_timestamp() >= v_exam.opens_at
    or v_exam.release_id is not null
  then raise exception 'EXAM_ROOM_REPLACEMENT_NOT_ALLOWED'; end if;
  if exists (
    select 1 from public.exam_room_attempts a where a.exam_id = v_exam.id
  ) then raise exception 'EXAM_ROOM_REPLACEMENT_ATTEMPTS_EXIST'; end if;
  select * into v_previous
  from public.exam_room_publications p
  where p.id = v_exam.current_publication_id
    and p.public_id = p_expected_publication_id
    and p.exam_id = v_exam.id;
  if not found then raise exception 'EXAM_ROOM_PUBLICATION_VERSION_CONFLICT'; end if;
  select qv.* into v_replacement_version
  from public.exam_room_question_versions qv
  join public.exam_room_question_sources source
    on source.id = qv.source_id
    and source.exam_id = qv.exam_id
    and source.extraction_status = 'staged_replacement'
    and source.confirmed_by = p_professor_user_id
    and source.confirmed_at >= v_previous.published_at
  where qv.id = p_replacement_question_version_id
    and qv.exam_id = v_exam.id
    and qv.status = 'confirmed'
    and qv.confirmed_by = p_professor_user_id
    and qv.id <> v_previous.question_version_id
    and qv.confirmed_at >= v_previous.published_at;
  if not found then raise exception 'EXAM_ROOM_REPLACEMENT_QUESTION_VERSION_INVALID'; end if;
  if jsonb_typeof(p_rules) <> 'object'
    or jsonb_typeof(p_rules -> 'studentAccessCodeRequired') <> 'boolean'
    or char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000
    or p_grading_key_hash is null
    or p_grading_key_hash !~ '^[0-9a-f]{64}$'
  then raise exception 'EXAM_ROOM_REPLACEMENT_CREDENTIAL_INVALID'; end if;
  v_access_code_required := (p_rules ->> 'studentAccessCodeRequired')::boolean;
  if (v_access_code_required and (
      p_student_key_hash is null
      or p_student_key_hash !~ '^[0-9a-f]{64}$'
    ))
    or (not v_access_code_required and p_student_key_hash is not null)
  then raise exception 'EXAM_ROOM_REPLACEMENT_CREDENTIAL_INVALID'; end if;

  update public.exam_room_credentials c
  set status = 'revoked',
      revoked_by = p_professor_user_id,
      revoked_at = now(),
      revoke_reason = 'Rotated for audited pre-start publication replacement.'
  where c.exam_id = v_exam.id
    and c.credential_type in ('student_exam', 'professor_grading')
    and c.status = 'active';
  if v_access_code_required then
    insert into public.exam_room_credentials (
      exam_id, credential_type, token_hash, status,
      valid_from, expires_at, created_by
    ) values (
      v_exam.id, 'student_exam', p_student_key_hash, 'active',
      v_exam.opens_at, v_exam.hard_closes_at, p_professor_user_id
    );
  end if;
  insert into public.exam_room_credentials (
    exam_id, credential_type, token_hash, status,
    valid_from, expires_at, created_by
  ) values (
    v_exam.id, 'professor_grading', p_grading_key_hash, 'active',
    v_exam.hard_closes_at, v_exam.hard_closes_at + interval '180 days',
    p_professor_user_id
  );

  update public.exam_room_exams
  set active_question_version_id = v_replacement_version.id,
      updated_at = now()
  where id = v_exam.id;

  perform set_config('app.exam_room_replacement_exam', v_exam.id::text, true);
  perform set_config('app.exam_room_replacement_reason', btrim(p_reason), true);
  perform set_config('app.exam_room_replacement_request_key', p_request_key, true);
  v_publish := public.exam_room_publish_exam_v2(
    p_professor_user_id, p_exam_public_id, p_rules,
    p_student_key_hash, p_request_key
  );
  perform set_config('app.exam_room_replacement_exam', '', true);
  perform set_config('app.exam_room_replacement_reason', '', true);
  perform set_config('app.exam_room_replacement_request_key', '', true);

  select * into v_current
  from public.exam_room_publications p
  where p.id = (
    select e.current_publication_id from public.exam_room_exams e where e.id = v_exam.id
  );
  if not found
    or v_current.supersedes_publication_id is distinct from v_previous.id
  then raise exception 'EXAM_ROOM_REPLACEMENT_LINEAGE_INVALID'; end if;
  v_outbox_id := public.exam_room_queue_backup(
    v_exam.id,
    'publication_replaced',
    jsonb_build_object(
      'examId', v_exam.public_id,
      'previousPublicationId', v_previous.public_id,
      'publicationId', v_current.public_id,
      'publicationNumber', v_current.publication_number,
      'replacementQuestionVersionId', v_replacement_version.id,
      'questionVersionChanged', true,
      'reason', btrim(p_reason),
      'credentialRotation', true,
      'studentAccessCodeRequired', v_access_code_required,
      'notifyAudience', 'active_roster',
      'zeroAttemptGuard', true,
      'occurredAt', v_current.published_at
    )
  );
  insert into public.exam_room_email_jobs (
    exam_id, recipient_user_id, recipient_email, email_type,
    event_key, payload, status, next_attempt_at
  )
  select
    v_exam.id,
    roster.student_user_id,
    roster.canonical_email,
    'exam_publication_replaced',
    v_current.public_id::text,
    jsonb_build_object(
      'examId', v_exam.public_id,
      'title', v_exam.title,
      'previousPublicationId', v_previous.public_id,
      'publicationId', v_current.public_id,
      'publicationNumber', v_current.publication_number,
      'opensAt', v_exam.opens_at,
      'hardClosesAt', v_exam.hard_closes_at,
      'studentAccessCodeRequired', v_access_code_required,
      'notice', 'The Professor replaced the exam publication before any candidate started. Review the updated instructions before entry.'
    ),
    'pending',
    now()
  from public.exam_room_roster roster
  where roster.classroom_id = v_exam.classroom_id
    and roster.status = 'active'
  on conflict (exam_id, email_type, recipient_email, event_key) do nothing;
  get diagnostics v_notification_count = row_count;
  insert into public.exam_room_audit_log (
    actor_user_id, exam_id, classroom_id, action, reason, metadata
  ) values (
    p_professor_user_id, v_exam.id, v_exam.classroom_id,
    'publication_replaced', btrim(p_reason),
    jsonb_build_object(
      'previousPublicationId', v_previous.public_id,
      'publicationId', v_current.public_id,
      'publicationNumber', v_current.publication_number,
      'replacementQuestionVersionId', v_replacement_version.id,
      'questionVersionChanged', true,
      'credentialsRotated', true,
      'backupOutboxId', v_outbox_id,
      'notificationCount', v_notification_count
    )
  );
  perform public.exam_room_append_audit_v2(
    p_professor_user_id, v_exam.id, null, 'publication', v_current.id,
    'publication_replaced', p_request_key,
    jsonb_build_object(
      'previousPublicationId', v_previous.public_id,
      'publicationId', v_current.public_id,
      'publicationNumber', v_current.publication_number,
      'credentialsRotated', true,
      'backupOutboxId', v_outbox_id,
      'notificationCount', v_notification_count
    )
  );
  v_response := v_publish || jsonb_build_object(
    'supersedesPublicationId', v_previous.public_id,
    'replacementQuestionVersionId', v_replacement_version.id,
    'questionVersionChanged', true,
    'accessCodeRequired', v_access_code_required,
    'credentialsRotated', true,
    'notificationQueued', v_notification_count > 0,
    'notificationStatus', case when v_notification_count > 0 then 'queued' else 'suppressed' end,
    'notificationCount', v_notification_count
  );
  return public.exam_room_command_complete_v2(
    p_professor_user_id, 'replace_publication_v2', p_request_key, v_request, v_response
  );
end;
$$;

create or replace function public.exam_room_grading_model_answer_v2(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_grading_key_hash text,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_publication public.exam_room_publications%rowtype;
  v_model public.exam_room_publication_model_answers%rowtype;
  v_source public.exam_room_model_answer_sources%rowtype;
  v_credential jsonb;
  v_response jsonb;
begin
  select * into v_exam from public.exam_room_exams e
  where e.public_id = p_exam_public_id
    and e.owner_professor_id = p_professor_user_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.hard_closes_at is null
    or now() < v_exam.hard_closes_at
    or v_exam.status not in ('grading', 'sealed')
  then
    return jsonb_build_object('ok', false, 'code', 'GRADING_NOT_OPEN');
  end if;
  v_credential := public.exam_room_check_credential(
    p_professor_user_id, v_exam.id, 'professor_grading',
    p_grading_key_hash, p_rate_key_hash
  );
  if not coalesce((v_credential ->> 'ok')::boolean, false) then
    return v_credential;
  end if;
  select * into v_publication from public.exam_room_publications p
  where p.id = v_exam.current_publication_id;
  if not found then raise exception 'EXAM_ROOM_PUBLICATION_REQUIRED'; end if;
  select * into v_model from public.exam_room_publication_model_answers m
  where m.publication_id = v_publication.id;

  if not found then
    v_response := jsonb_build_object(
      'ok', true,
      'available', false,
      'mode', 'none',
      'code', 'MODEL_ANSWER_NOT_CONFIGURED'
    );
  elsif v_model.mode = 'paste' then
    v_response := jsonb_build_object(
      'ok', true,
      'available', true,
      'mode', 'paste',
      'answerText', v_model.answer_text,
      'contentHash', v_model.content_hash
    );
  else
    select * into v_source from public.exam_room_model_answer_sources s
    where s.id = v_model.source_id and s.exam_id = v_exam.id;
    if not found then raise exception 'EXAM_ROOM_MODEL_ANSWER_SOURCE_NOT_FOUND'; end if;
    v_response := jsonb_build_object(
      'ok', true,
      'available', false,
      'mode', 'upload',
      'code', 'MODEL_ANSWER_FILE_RETRIEVAL_UNAVAILABLE',
      'safeFileName', v_source.safe_file_name,
      'mimeType', v_source.mime_type,
      'sizeBytes', v_source.size_bytes,
      'contentHash', v_model.content_hash
    );
  end if;
  perform public.exam_room_append_audit_v2(
    p_professor_user_id, v_exam.id, null, 'publication', v_publication.id,
    'grading_model_answer_accessed', null,
    jsonb_build_object(
      'mode', v_response ->> 'mode',
      'available', coalesce((v_response ->> 'available')::boolean, false)
    )
  );
  return v_response;
end;
$$;

create or replace function public.exam_room_issue_beadle_invitation_v2(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_target_email text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_invitation public.exam_room_beadle_invitations%rowtype;
  v_email text := lower(btrim(p_target_email));
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id, 'targetEmail', v_email,
    'tokenHash', p_token_hash, 'expiresAt', p_expires_at, 'reason', p_reason
  );
  v_response := public.exam_room_command_begin_v2(
    p_professor_user_id, 'issue_beadle_invitation_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam from public.exam_room_exams e
  where e.public_id = p_exam_public_id and e.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.status = 'sealed' or v_exam.release_id is not null then
    raise exception 'EXAM_ROOM_BEADLE_DELEGATION_CLOSED';
  end if;
  if v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
    or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at <= now() + interval '15 minutes'
    or p_expires_at > now() + interval '7 days'
    or char_length(btrim(p_reason)) not between 5 and 1000
  then raise exception 'EXAM_ROOM_BEADLE_INVITATION_INVALID'; end if;
  if v_email = (select lower(u.email) from auth.users u where u.id = v_exam.owner_professor_id) then
    raise exception 'EXAM_ROOM_BEADLE_INVITATION_INVALID';
  end if;
  update public.exam_room_beadle_invitations
  set status = 'expired'
  where exam_id = v_exam.id and status = 'issued' and expires_at <= now();
  insert into public.exam_room_beadle_invitations (
    exam_id, target_email, token_hash, expires_at, delegation_reason, invited_by
  ) values (
    v_exam.id, v_email, p_token_hash, p_expires_at, p_reason, p_professor_user_id
  ) returning * into v_invitation;
  perform public.exam_room_append_audit_v2(
    p_professor_user_id, v_exam.id, null, 'beadle_invitation', v_invitation.id,
    'beadle_invited', p_request_key, jsonb_build_object(
      'targetEmailHash', public.exam_room_hash_json(to_jsonb(v_email)),
      'reason', p_reason
    )
  );
  v_response := jsonb_build_object(
    'ok', true, 'invitationId', v_invitation.id,
    'examId', v_exam.public_id, 'targetEmail', v_email, 'expiresAt', v_invitation.expires_at
  );
  return public.exam_room_command_complete_v2(
    p_professor_user_id, 'issue_beadle_invitation_v2', p_request_key, v_request, v_response
  );
end;
$$;

create or replace function public.exam_room_redeem_beadle_invitation_v2(
  p_beadle_user_id uuid,
  p_token_hash text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitation public.exam_room_beadle_invitations%rowtype;
  v_assignment public.exam_room_beadle_assignments%rowtype;
  v_exam public.exam_room_exams%rowtype;
  v_email text;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object('tokenHash', p_token_hash);
  v_response := public.exam_room_command_begin_v2(
    p_beadle_user_id, 'redeem_beadle_invitation_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'EXAM_ROOM_BEADLE_INVITATION_INVALID'; end if;
  select lower(u.email) into v_email from auth.users u where u.id = p_beadle_user_id;
  if v_email is null then raise exception 'EXAM_ROOM_AUTH_REQUIRED'; end if;
  select * into v_invitation
  from public.exam_room_beadle_invitations i
  where i.token_hash = p_token_hash
  for update;
  if not found
    or v_invitation.status <> 'issued'
    or v_invitation.expires_at <= now()
    or v_invitation.target_email <> v_email
  then raise exception 'EXAM_ROOM_BEADLE_INVITATION_NOT_ACTIVE'; end if;
  select * into v_exam from public.exam_room_exams e
  where e.id = v_invitation.exam_id;
  if not found
    or v_exam.status = 'sealed'
    or v_exam.release_id is not null
  then raise exception 'EXAM_ROOM_BEADLE_DELEGATION_CLOSED'; end if;
  insert into public.exam_room_beadle_assignments (
    exam_id, beadle_user_id, invitation_id, assigned_by, expires_at
  ) values (
    v_invitation.exam_id, p_beadle_user_id, v_invitation.id,
    v_invitation.invited_by, v_invitation.expires_at
  )
  on conflict (exam_id, beadle_user_id) do update
  set invitation_id = excluded.invitation_id,
      status = 'active',
      can_manage_roster = true,
      can_manage_operations = true,
      can_view_answers = false,
      assigned_by = excluded.assigned_by,
      assigned_at = now(),
      expires_at = excluded.expires_at,
      revoked_by = null,
      revoked_at = null,
      revoke_reason = null
  returning * into v_assignment;
  update public.exam_room_beadle_invitations
  set status = 'redeemed', redeemed_by = p_beadle_user_id, redeemed_at = now()
  where id = v_invitation.id;
  perform public.exam_room_append_audit_v2(
    p_beadle_user_id, v_invitation.exam_id, null, 'beadle_assignment', v_assignment.id,
    'beadle_invitation_redeemed', p_request_key, '{}'::jsonb
  );
  v_response := jsonb_build_object(
    'ok', true,
    'assignmentId', v_assignment.id,
    'examId', (select e.public_id from public.exam_room_exams e where e.id = v_invitation.exam_id),
    'canViewAnswers', false,
    'expiresAt', v_assignment.expires_at
  );
  return public.exam_room_command_complete_v2(
    p_beadle_user_id, 'redeem_beadle_invitation_v2', p_request_key, v_request, v_response
  );
end;
$$;

create or replace function public.exam_room_revoke_beadle_assignment_v2(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_beadle_user_id uuid,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_assignment public.exam_room_beadle_assignments%rowtype;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id, 'beadleUserId', p_beadle_user_id, 'reason', p_reason
  );
  v_response := public.exam_room_command_begin_v2(
    p_professor_user_id, 'revoke_beadle_assignment_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  select * into v_exam from public.exam_room_exams e
  where e.public_id = p_exam_public_id
    and e.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if char_length(btrim(p_reason)) not between 5 and 1000 then raise exception 'EXAM_ROOM_REASON_REQUIRED'; end if;
  update public.exam_room_beadle_assignments b
  set status = 'revoked', revoked_by = p_professor_user_id,
      revoked_at = now(), revoke_reason = p_reason
  where b.exam_id = v_exam.id and b.beadle_user_id = p_beadle_user_id and b.status = 'active'
  returning * into v_assignment;
  if not found then raise exception 'EXAM_ROOM_BEADLE_ASSIGNMENT_NOT_FOUND'; end if;
  perform public.exam_room_append_audit_v2(
    p_professor_user_id, v_exam.id, null, 'beadle_assignment', v_assignment.id,
    'beadle_assignment_revoked', p_request_key, jsonb_build_object('reason', p_reason)
  );
  v_response := jsonb_build_object('ok', true, 'status', 'revoked');
  return public.exam_room_command_complete_v2(
    p_professor_user_id, 'revoke_beadle_assignment_v2', p_request_key, v_request, v_response
  );
end;
$$;

create or replace function public.exam_room_revoke_beadle_delegation_on_seal_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.status = 'sealed' or new.release_id is not null)
    and (old.status is distinct from new.status or old.release_id is distinct from new.release_id)
  then
    update public.exam_room_beadle_assignments b
    set status = 'revoked',
        revoked_by = new.owner_professor_id,
        revoked_at = now(),
        revoke_reason = 'Exam released and sealed.'
    where b.exam_id = new.id and b.status = 'active';

    update public.exam_room_beadle_invitations i
    set status = 'revoked',
        revoked_by = new.owner_professor_id,
        revoked_at = now(),
        revoke_reason = 'Exam released and sealed.'
    where i.exam_id = new.id and i.status = 'issued';
  end if;
  return new;
end;
$$;

drop trigger if exists exam_room_beadle_delegation_seal_guard_v2
  on public.exam_room_exams;
create trigger exam_room_beadle_delegation_seal_guard_v2
after update of status, release_id on public.exam_room_exams
for each row execute function public.exam_room_revoke_beadle_delegation_on_seal_v2();

-- ---------------------------------------------------------------------------
-- Candidate admission, accommodations, deadline evidence, and verification
-- ---------------------------------------------------------------------------

create or replace function public.exam_room_admit_candidate_v2(
  p_actor_user_id uuid,
  p_exam_public_id uuid,
  p_candidate_number text,
  p_decision text,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_roster public.exam_room_roster%rowtype;
  v_admission public.exam_room_admissions%rowtype;
  v_status text;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id, 'candidateNumber', p_candidate_number,
    'decision', p_decision, 'reason', coalesce(p_reason, '')
  );
  v_response := public.exam_room_command_begin_v2(
    p_actor_user_id, 'admit_candidate_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  select * into v_exam from public.exam_room_exams e where e.public_id = p_exam_public_id for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if not public.exam_room_is_operator_v2(p_actor_user_id, v_exam.id, true) then
    raise exception 'EXAM_ROOM_OPERATOR_REQUIRED';
  end if;
  if p_decision not in ('admit', 'deny', 'reset') then raise exception 'EXAM_ROOM_ADMISSION_INVALID'; end if;
  if p_decision = 'deny' and char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000 then
    raise exception 'EXAM_ROOM_REASON_REQUIRED';
  end if;
  select * into v_roster from public.exam_room_roster r
  where r.classroom_id = v_exam.classroom_id and r.status = 'active'
    and lower(r.candidate_number) = lower(btrim(p_candidate_number));
  if not found then raise exception 'EXAM_ROOM_ROSTER_REQUIRED'; end if;
  v_status := case p_decision when 'admit' then 'admitted' when 'deny' then 'denied' else 'eligible' end;
  insert into public.exam_room_admissions (
    exam_id, roster_id, status, decided_by, decision_reason
  ) values (
    v_exam.id, v_roster.id, v_status, p_actor_user_id, nullif(btrim(coalesce(p_reason, '')), '')
  )
  on conflict (exam_id, roster_id) do update
  set status = excluded.status,
      decided_by = excluded.decided_by,
      decision_reason = excluded.decision_reason,
      decided_at = now(),
      updated_at = now()
  returning * into v_admission;
  perform public.exam_room_append_audit_v2(
    p_actor_user_id, v_exam.id, null, 'admission', v_admission.id,
    'candidate_admission_changed', p_request_key,
    jsonb_build_object('candidateNumber', v_roster.candidate_number, 'status', v_status)
  );
  v_response := jsonb_build_object(
    'ok', true, 'candidateNumber', v_roster.candidate_number,
    'status', v_admission.status, 'decidedAt', v_admission.decided_at
  );
  return public.exam_room_command_complete_v2(
    p_actor_user_id, 'admit_candidate_v2', p_request_key, v_request, v_response
  );
end;
$$;

create or replace function public.exam_room_set_accommodation_v2(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_candidate_number text,
  p_accommodation jsonb,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_roster public.exam_room_roster%rowtype;
  v_attempt public.exam_room_attempts%rowtype;
  v_existing public.exam_room_accommodations%rowtype;
  v_accommodation public.exam_room_accommodations%rowtype;
  v_request jsonb;
  v_response jsonb;
  v_unknown_key text;
  v_new_extra integer := 0;
  v_old_deadline timestamptz;
  v_new_deadline timestamptz;
  v_effective_close timestamptz;
  v_old_window_open timestamptz;
  v_new_window_open timestamptz;
  v_extension_minutes integer := 0;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id, 'candidateNumber', p_candidate_number,
    'accommodation', p_accommodation, 'reason', p_reason
  );
  select * into v_exam from public.exam_room_exams e
  where e.public_id = p_exam_public_id
    and e.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.status = 'sealed' or v_exam.release_id is not null then
    raise exception 'EXAM_ROOM_SEALED';
  end if;
  if v_exam.status not in ('draft', 'confirmed', 'scheduled', 'open') then
    raise exception 'EXAM_ROOM_ACCOMMODATION_STATE_CLOSED';
  end if;
  v_response := public.exam_room_command_begin_v2(
    p_professor_user_id, 'set_accommodation_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  if jsonb_typeof(p_accommodation) <> 'object'
    or octet_length(p_accommodation::text) > 16384
    or public.exam_room_json_has_forbidden_key(p_accommodation)
    or char_length(btrim(p_reason)) not between 5 and 1000
  then raise exception 'EXAM_ROOM_ACCOMMODATION_INVALID'; end if;
  select key into v_unknown_key from jsonb_object_keys(p_accommodation) key
  where key not in (
    'extraMinutes', 'individualOpensAt', 'individualHardClosesAt', 'breakMinutes',
    'fullscreenExempt', 'cameraExempt', 'integrityExempt',
    'assistiveTechnology', 'permittedAids', 'incidentExtensionMinutes',
    'operationalNote'
  ) limit 1;
  if v_unknown_key is not null then raise exception 'EXAM_ROOM_ACCOMMODATION_UNKNOWN'; end if;
  v_new_extra := coalesce((p_accommodation ->> 'extraMinutes')::integer, 0)
    + coalesce((p_accommodation ->> 'incidentExtensionMinutes')::integer, 0);
  if coalesce((p_accommodation ->> 'extraMinutes')::integer, 0) not between 0 and 480
    or coalesce((p_accommodation ->> 'incidentExtensionMinutes')::integer, 0) not between 0 and 480
    or coalesce((p_accommodation ->> 'breakMinutes')::integer, 0) not between 0 and 240
    or coalesce((p_accommodation ->> 'extraMinutes')::integer, 0)
      + coalesce((p_accommodation ->> 'incidentExtensionMinutes')::integer, 0) > 480
    or v_new_extra > 480
    or (p_accommodation ? 'cameraExempt' and jsonb_typeof(p_accommodation -> 'cameraExempt') <> 'boolean')
    or (p_accommodation ? 'fullscreenExempt' and jsonb_typeof(p_accommodation -> 'fullscreenExempt') <> 'boolean')
    or (p_accommodation ? 'integrityExempt' and jsonb_typeof(p_accommodation -> 'integrityExempt') <> 'boolean')
    or (p_accommodation ? 'assistiveTechnology' and jsonb_typeof(p_accommodation -> 'assistiveTechnology') <> 'boolean')
    or (p_accommodation ? 'permittedAids' and (
      jsonb_typeof(p_accommodation -> 'permittedAids') <> 'string'
      or char_length(p_accommodation ->> 'permittedAids') > 1000
    ))
    or char_length(coalesce(p_accommodation ->> 'operationalNote', '')) > 1000
  then raise exception 'EXAM_ROOM_ACCOMMODATION_INVALID'; end if;
  if (p_accommodation ? 'individualOpensAt') <> (p_accommodation ? 'individualHardClosesAt') then
    raise exception 'EXAM_ROOM_ACCOMMODATION_WINDOW_INVALID';
  end if;
  if p_accommodation ? 'individualOpensAt'
    and (
      (jsonb_typeof(p_accommodation -> 'individualOpensAt') = 'null')
      <> (jsonb_typeof(p_accommodation -> 'individualHardClosesAt') = 'null')
    )
  then raise exception 'EXAM_ROOM_ACCOMMODATION_WINDOW_INVALID'; end if;
  if p_accommodation ? 'individualOpensAt'
    and jsonb_typeof(p_accommodation -> 'individualOpensAt') <> 'null'
    and (
      jsonb_typeof(p_accommodation -> 'individualHardClosesAt') = 'null'
      or (p_accommodation ->> 'individualHardClosesAt')::timestamptz
        <= (p_accommodation ->> 'individualOpensAt')::timestamptz
    )
  then raise exception 'EXAM_ROOM_ACCOMMODATION_WINDOW_INVALID'; end if;
  select * into v_roster from public.exam_room_roster r
  where r.classroom_id = v_exam.classroom_id and r.status = 'active'
    and lower(r.candidate_number) = lower(btrim(p_candidate_number));
  if not found then raise exception 'EXAM_ROOM_ROSTER_REQUIRED'; end if;
  select * into v_existing from public.exam_room_accommodations a
  where a.exam_id = v_exam.id and a.roster_id = v_roster.id for update;
  select * into v_attempt from public.exam_room_attempts a
  where a.exam_id = v_exam.id and a.roster_id = v_roster.id
  for update;
  if found and v_attempt.status in ('submitted', 'auto_submitted', 'sealed') then
    raise exception 'EXAM_ROOM_ACCOMMODATION_ATTEMPT_CLOSED';
  end if;

  v_new_window_open := coalesce(
    nullif(p_accommodation ->> 'individualOpensAt', '')::timestamptz,
    v_exam.opens_at
  );
  if v_attempt.id is not null and v_attempt.status in ('in_progress', 'locked') then
    v_old_window_open := coalesce(
      case
        when v_existing.id is not null and v_existing.status = 'active'
          then nullif(v_existing.configuration ->> 'individualOpensAt', '')::timestamptz
        else null
      end,
      v_exam.opens_at
    );
    if v_new_window_open is distinct from v_old_window_open then
      raise exception 'EXAM_ROOM_ACCOMMODATION_OPEN_WINDOW_IMMUTABLE';
    end if;

    v_effective_close := coalesce(
      nullif(p_accommodation ->> 'individualHardClosesAt', '')::timestamptz,
      v_exam.hard_closes_at
    ) + make_interval(mins => v_new_extra);
    v_new_deadline := v_effective_close;
    if v_exam.duration_minutes is not null then
      v_new_deadline := least(
        v_effective_close,
        v_attempt.started_at + make_interval(mins => v_exam.duration_minutes + v_new_extra)
      );
    end if;
    if v_new_deadline < v_attempt.server_deadline then
      raise exception 'EXAM_ROOM_ACCOMMODATION_DEADLINE_REDUCTION_FORBIDDEN';
    end if;
    if v_new_deadline > v_attempt.server_deadline then
      v_extension_minutes := ceil(
        extract(epoch from (v_new_deadline - v_attempt.server_deadline)) / 60.0
      )::integer;
      if v_extension_minutes not between 1 and 480 then
        raise exception 'EXAM_ROOM_ACCOMMODATION_EXTENSION_TOO_LARGE';
      end if;
    end if;
  end if;

  insert into public.exam_room_accommodations (
    exam_id, roster_id, configuration, configuration_hash,
    status, approved_by, approval_reason
  ) values (
    v_exam.id, v_roster.id, p_accommodation,
    public.exam_room_hash_json(p_accommodation), 'active',
    p_professor_user_id, p_reason
  )
  on conflict (exam_id, roster_id) do update
  set configuration = excluded.configuration,
      configuration_hash = excluded.configuration_hash,
      status = 'active',
      approved_by = excluded.approved_by,
      approval_reason = excluded.approval_reason,
      approved_at = now(),
      updated_at = now(),
      revoked_by = null,
      revoked_at = null
  returning * into v_accommodation;

  v_effective_close := coalesce(
    nullif(p_accommodation ->> 'individualHardClosesAt', '')::timestamptz,
    v_exam.hard_closes_at
  ) + make_interval(mins => v_new_extra);
  update public.exam_room_credentials
  set expires_at = greatest(expires_at, v_effective_close)
  where exam_id = v_exam.id and credential_type = 'student_exam' and status = 'active';

  if v_attempt.id is not null
    and v_attempt.status in ('in_progress', 'locked')
    and v_new_deadline > v_attempt.server_deadline
  then
    v_old_deadline := v_attempt.server_deadline;
    update public.exam_room_attempts
    set server_deadline = v_new_deadline, updated_at = now()
    where id = v_attempt.id;
    insert into public.exam_room_deadline_extensions (
      attempt_id, accommodation_id, previous_deadline, new_deadline,
      extension_minutes, extension_type, granted_by, reason
    ) values (
      v_attempt.id, v_accommodation.id, v_old_deadline, v_new_deadline,
      v_extension_minutes, case when coalesce((p_accommodation ->> 'incidentExtensionMinutes')::integer, 0) > 0
        then 'incident' else 'accommodation' end,
      p_professor_user_id, p_reason
    );
  end if;
  perform public.exam_room_append_audit_v2(
    p_professor_user_id, v_exam.id, v_attempt.id, 'accommodation', v_accommodation.id,
    'accommodation_set', p_request_key,
    jsonb_build_object('candidateNumber', v_roster.candidate_number, 'configurationHash', v_accommodation.configuration_hash)
  );
  v_response := jsonb_build_object(
    'ok', true,
    'candidateNumber', v_roster.candidate_number,
    'configurationHash', v_accommodation.configuration_hash,
    'serverDeadline', case
      when v_attempt.id is null then null
      when v_new_deadline > v_attempt.server_deadline then v_new_deadline
      else v_attempt.server_deadline
    end
  );
  return public.exam_room_command_complete_v2(
    p_professor_user_id, 'set_accommodation_v2', p_request_key, v_request, v_response
  );
exception
  when invalid_text_representation then raise exception 'EXAM_ROOM_ACCOMMODATION_INVALID';
end;
$$;

create or replace function public.exam_room_record_verification_v2(
  p_actor_user_id uuid,
  p_exam_public_id uuid,
  p_candidate_number text,
  p_method text,
  p_outcome text,
  p_note text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_roster public.exam_room_roster%rowtype;
  v_verification public.exam_room_identity_verifications%rowtype;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id, 'candidateNumber', p_candidate_number,
    'method', p_method, 'outcome', p_outcome, 'note', coalesce(p_note, '')
  );
  v_response := public.exam_room_command_begin_v2(
    p_actor_user_id, 'record_verification_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  select * into v_exam from public.exam_room_exams e where e.public_id = p_exam_public_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if not public.exam_room_is_operator_v2(p_actor_user_id, v_exam.id, true) then
    raise exception 'EXAM_ROOM_OPERATOR_REQUIRED';
  end if;
  if p_method not in ('physical', 'institutional', 'manual_exception', 'camera_exception')
    or p_outcome not in ('verified', 'blocked', 'exception_approved')
    or char_length(coalesce(p_note, '')) > 1000
  then raise exception 'EXAM_ROOM_VERIFICATION_INVALID'; end if;
  select * into v_roster from public.exam_room_roster r
  where r.classroom_id = v_exam.classroom_id and r.status = 'active'
    and lower(r.candidate_number) = lower(btrim(p_candidate_number));
  if not found then raise exception 'EXAM_ROOM_ROSTER_REQUIRED'; end if;
  insert into public.exam_room_identity_verifications (
    exam_id, roster_id, method, outcome, note, recorded_by
  ) values (
    v_exam.id, v_roster.id, p_method, p_outcome, coalesce(p_note, ''), p_actor_user_id
  ) returning * into v_verification;
  perform public.exam_room_append_audit_v2(
    p_actor_user_id, v_exam.id, null, 'identity_verification', v_verification.id,
    'identity_verification_recorded', p_request_key,
    jsonb_build_object('candidateNumber', v_roster.candidate_number, 'method', p_method, 'outcome', p_outcome)
  );
  v_response := jsonb_build_object(
    'ok', true, 'candidateNumber', v_roster.candidate_number,
    'method', p_method, 'outcome', p_outcome, 'recordedAt', v_verification.recorded_at
  );
  return public.exam_room_command_complete_v2(
    p_actor_user_id, 'record_verification_v2', p_request_key, v_request, v_response
  );
end;
$$;

-- Preserve the legacy start-attempt signature while enforcing the v2
-- publication, admission, and individual accommodation gates.
create or replace function public.exam_room_start_attempt(
  p_student_user_id uuid,
  p_exam_public_id uuid,
  p_student_key_hash text,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_roster public.exam_room_roster%rowtype;
  v_attempt public.exam_room_attempts%rowtype;
  v_publication public.exam_room_publications%rowtype;
  v_email text;
  v_credential jsonb;
  v_accommodation jsonb := '{}'::jsonb;
  v_admission text := 'eligible';
  v_window_open timestamptz;
  v_window_close timestamptz;
  v_entry_closes timestamptz;
  v_deadline timestamptz;
  v_extra integer := 0;
  v_late_minutes integer := 0;
  v_verification text;
begin
  select lower(u.email) into v_email from auth.users u where u.id = p_student_user_id;
  if v_email is null then raise exception 'EXAM_ROOM_AUTH_REQUIRED'; end if;
  select * into v_exam from public.exam_room_exams e
  where e.public_id = p_exam_public_id for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.current_publication_id is null then
    return jsonb_build_object('ok', false, 'code', 'EXAM_NOT_PUBLISHED');
  end if;
  select * into v_publication from public.exam_room_publications p
  where p.id = v_exam.current_publication_id;
  select * into v_roster from public.exam_room_roster r
  where r.classroom_id = v_exam.classroom_id and r.status = 'active'
    and (r.student_user_id = p_student_user_id or r.canonical_email = v_email)
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'ROSTER_REQUIRED'); end if;
  if v_roster.student_user_id is null then
    update public.exam_room_roster
    set student_user_id = p_student_user_id, updated_at = now()
    where id = v_roster.id;
    v_roster.student_user_id := p_student_user_id;
  elsif v_roster.student_user_id <> p_student_user_id then
    return jsonb_build_object('ok', false, 'code', 'ROSTER_ACCOUNT_MISMATCH');
  end if;
  select * into v_attempt from public.exam_room_attempts a
  where a.exam_id = v_exam.id and a.student_user_id = p_student_user_id;
  if found then
    return jsonb_build_object(
      'ok', true, 'resumed', true, 'attemptId', v_attempt.public_id,
      'status', v_attempt.status, 'serverDeadline', v_attempt.server_deadline,
      'publicationId', v_publication.public_id
    );
  end if;
  select coalesce(a.status, 'eligible') into v_admission
  from (select 1) seed
  left join public.exam_room_admissions a on a.exam_id = v_exam.id and a.roster_id = v_roster.id;
  if v_admission in ('denied', 'withdrawn')
    or (
      v_publication.rules_snapshot ->> 'admissionMode' = 'beadle_approval'
      and v_admission <> 'admitted'
    )
  then return jsonb_build_object('ok', false, 'code', 'ADMISSION_REQUIRED'); end if;
  select i.outcome into v_verification
  from public.exam_room_identity_verifications i
  where i.exam_id = v_exam.id and i.roster_id = v_roster.id
  order by i.recorded_at desc limit 1;
  if v_verification = 'blocked' then
    return jsonb_build_object('ok', false, 'code', 'IDENTITY_VERIFICATION_BLOCKED');
  end if;
  select a.configuration into v_accommodation
  from public.exam_room_accommodations a
  where a.exam_id = v_exam.id and a.roster_id = v_roster.id and a.status = 'active';
  v_accommodation := coalesce(v_accommodation, '{}'::jsonb);
  v_late_minutes := coalesce((v_publication.rules_snapshot ->> 'lateAdmissionMinutes')::integer, 0);
  v_window_open := coalesce(
    nullif(v_accommodation ->> 'individualOpensAt', '')::timestamptz,
    v_exam.opens_at
  );
  v_window_close := coalesce(
    nullif(v_accommodation ->> 'individualHardClosesAt', '')::timestamptz,
    v_exam.hard_closes_at
  );
  v_entry_closes := least(
    v_window_close,
    v_window_open + make_interval(mins => greatest(v_late_minutes, 1))
  );
  if now() < v_window_open then return jsonb_build_object('ok', false, 'code', 'EXAM_NOT_OPEN'); end if;
  if now() >= v_entry_closes then return jsonb_build_object('ok', false, 'code', 'LATE_ADMISSION_CLOSED'); end if;
  if v_exam.status in ('grading', 'sealed') then return jsonb_build_object('ok', false, 'code', 'EXAM_CLOSED'); end if;

  -- Authentication, roster/account matching, publication, and admission are
  -- mandatory in both modes. Only the separately frozen access-code rule is
  -- optional; false means the credential hashes are deliberately ignored.
  if coalesce(
    (v_publication.rules_snapshot ->> 'studentAccessCodeRequired')::boolean,
    true
  ) then
    v_credential := public.exam_room_check_credential(
      p_student_user_id, v_exam.id, 'student_exam', p_student_key_hash, p_rate_key_hash
    );
    if not (v_credential ->> 'ok')::boolean then return v_credential; end if;
  end if;
  v_extra := coalesce((v_accommodation ->> 'extraMinutes')::integer, 0)
    + coalesce((v_accommodation ->> 'incidentExtensionMinutes')::integer, 0);
  v_deadline := v_window_close + make_interval(mins => v_extra);
  if v_exam.duration_minutes is not null then
    v_deadline := least(
      v_deadline,
      now() + make_interval(mins => v_exam.duration_minutes + v_extra)
    );
  end if;
  insert into public.exam_room_attempts (
    exam_id, question_version_id, publication_id, roster_id,
    student_user_id, candidate_number, server_deadline
  ) values (
    v_exam.id, v_publication.question_version_id, v_publication.id,
    v_roster.id, p_student_user_id, v_roster.candidate_number, v_deadline
  ) returning * into v_attempt;
  update public.exam_room_exams set status = 'open', updated_at = now()
  where id = v_exam.id and status = 'scheduled';
  insert into public.exam_room_audit_log (
    actor_user_id, exam_id, classroom_id, attempt_id, action, metadata
  ) values (
    p_student_user_id, v_exam.id, v_exam.classroom_id, v_attempt.id,
    'attempt_started', jsonb_build_object(
      'candidateNumber', v_roster.candidate_number,
      'serverDeadline', v_deadline,
      'publicationId', v_publication.public_id
    )
  );
  perform public.exam_room_append_audit_v2(
    p_student_user_id, v_exam.id, v_attempt.id, 'attempt', v_attempt.id,
    'attempt_started', null,
    jsonb_build_object('candidateNumber', v_roster.candidate_number, 'serverDeadline', v_deadline)
  );
  return jsonb_build_object(
    'ok', true, 'resumed', false, 'attemptId', v_attempt.public_id,
    'status', v_attempt.status, 'serverDeadline', v_attempt.server_deadline,
    'publicationId', v_publication.public_id
  );
exception
  when unique_violation then
    select * into v_attempt from public.exam_room_attempts a
    where a.exam_id = v_exam.id and a.student_user_id = p_student_user_id;
    return jsonb_build_object(
      'ok', true, 'resumed', true, 'attemptId', v_attempt.public_id,
      'status', v_attempt.status, 'serverDeadline', v_attempt.server_deadline,
      'publicationId', v_publication.public_id
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Session epochs and approved device transfer
-- ---------------------------------------------------------------------------

create or replace function public.exam_room_open_session_v2(
  p_student_user_id uuid,
  p_attempt_public_id uuid,
  p_device_instance_hash text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_session public.exam_room_sessions%rowtype;
  v_epoch integer;
  v_resumed boolean := false;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object(
    'attemptId', p_attempt_public_id, 'deviceInstanceHash', p_device_instance_hash
  );
  v_response := public.exam_room_command_begin_v2(
    p_student_user_id, 'open_session_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  if p_device_instance_hash !~ '^[0-9a-f]{64}$' then raise exception 'EXAM_ROOM_DEVICE_HASH_INVALID'; end if;
  select * into v_attempt from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id and a.student_user_id = p_student_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.status <> 'in_progress' or now() >= v_attempt.server_deadline then
    return public.exam_room_command_complete_v2(
      p_student_user_id, 'open_session_v2', p_request_key, v_request,
      jsonb_build_object('ok', false, 'code', 'ATTEMPT_CLOSED', 'status', v_attempt.status)
    );
  end if;
  select * into v_session from public.exam_room_sessions s
  where s.attempt_id = v_attempt.id and s.status = 'active'
  for update;
  if found and v_session.device_instance_hash <> p_device_instance_hash then
    return public.exam_room_command_complete_v2(
      p_student_user_id, 'open_session_v2', p_request_key, v_request,
      jsonb_build_object(
        'ok', false, 'code', 'SESSION_ACTIVE_ELSEWHERE',
        'activeEpoch', v_session.epoch, 'requiresOperatorTransfer', true
      )
    );
  end if;
  if found then
    v_resumed := true;
    update public.exam_room_sessions set last_seen_at = now() where id = v_session.id;
    insert into public.exam_room_session_events (
      session_id, attempt_id, actor_user_id, event_type, epoch
    ) values (v_session.id, v_attempt.id, p_student_user_id, 'resumed', v_session.epoch);
  else
    select coalesce(max(s.epoch), 0) + 1 into v_epoch
    from public.exam_room_sessions s where s.attempt_id = v_attempt.id;
    insert into public.exam_room_sessions (
      attempt_id, student_user_id, epoch, device_instance_hash
    ) values (
      v_attempt.id, p_student_user_id, v_epoch, p_device_instance_hash
    ) returning * into v_session;
    insert into public.exam_room_session_events (
      session_id, attempt_id, actor_user_id, event_type, epoch
    ) values (v_session.id, v_attempt.id, p_student_user_id, 'opened', v_session.epoch);
  end if;
  update public.exam_room_attempts
  set publication_id = coalesce(publication_id, (
        select e.current_publication_id from public.exam_room_exams e where e.id = v_attempt.exam_id
      )),
      last_heartbeat_at = now(), updated_at = now()
  where id = v_attempt.id;
  perform public.exam_room_append_audit_v2(
    p_student_user_id, v_attempt.exam_id, v_attempt.id, 'session', v_session.id,
    case when v_resumed then 'session_resumed' else 'session_opened' end,
    p_request_key, jsonb_build_object('epoch', v_session.epoch)
  );
  v_response := jsonb_build_object(
    'ok', true,
    'sessionId', v_session.public_id,
    'epoch', v_session.epoch,
    'status', v_session.status,
    'serverNow', now(),
    'serverDeadline', v_attempt.server_deadline,
    'answerSetHash', public.exam_room_answer_set_hash_v2(v_attempt.id)
  );
  return public.exam_room_command_complete_v2(
    p_student_user_id, 'open_session_v2', p_request_key, v_request, v_response
  );
end;
$$;

create or replace function public.exam_room_transfer_session_v2(
  p_actor_user_id uuid,
  p_attempt_public_id uuid,
  p_expected_epoch integer,
  p_device_instance_hash text,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_old public.exam_room_sessions%rowtype;
  v_new public.exam_room_sessions%rowtype;
  v_verification public.exam_room_identity_verifications%rowtype;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object(
    'attemptId', p_attempt_public_id, 'expectedEpoch', p_expected_epoch,
    'deviceInstanceHash', p_device_instance_hash, 'reason', p_reason
  );
  v_response := public.exam_room_command_begin_v2(
    p_actor_user_id, 'transfer_session_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  if p_expected_epoch is null or p_expected_epoch < 1
    or p_device_instance_hash !~ '^[0-9a-f]{64}$'
    or char_length(btrim(p_reason)) not between 5 and 1000
  then raise exception 'EXAM_ROOM_SESSION_TRANSFER_INVALID'; end if;
  select * into v_attempt from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if not public.exam_room_is_operator_v2(p_actor_user_id, v_attempt.exam_id, true) then
    raise exception 'EXAM_ROOM_OPERATOR_REQUIRED';
  end if;
  if v_attempt.status <> 'in_progress' or now() >= v_attempt.server_deadline then
    raise exception 'EXAM_ROOM_ATTEMPT_CLOSED';
  end if;
  select * into v_verification
  from public.exam_room_identity_verifications v
  where v.exam_id = v_attempt.exam_id and v.roster_id = v_attempt.roster_id
  order by v.recorded_at desc
  limit 1;
  if not found
    or v_verification.recorded_at < now() - interval '30 minutes'
    or not (
      (v_verification.method in ('physical', 'institutional') and v_verification.outcome = 'verified')
      or (v_verification.method = 'manual_exception' and v_verification.outcome = 'exception_approved')
    )
  then
    raise exception 'EXAM_ROOM_RECENT_VERIFICATION_REQUIRED';
  end if;
  select * into v_old from public.exam_room_sessions s
  where s.attempt_id = v_attempt.id and s.status = 'active'
  for update;
  if not found then raise exception 'EXAM_ROOM_ACTIVE_SESSION_NOT_FOUND'; end if;
  if v_old.epoch <> p_expected_epoch then raise exception 'EXAM_ROOM_SESSION_EPOCH_CONFLICT'; end if;
  if v_old.device_instance_hash = p_device_instance_hash then
    raise exception 'EXAM_ROOM_SESSION_TRANSFER_SAME_DEVICE';
  end if;
  insert into public.exam_room_session_events (
    session_id, attempt_id, actor_user_id, event_type, epoch, metadata
  ) values (
    v_old.id, v_attempt.id, p_actor_user_id, 'transfer_approved', v_old.epoch,
    jsonb_build_object(
      'reason', p_reason,
      'verificationId', v_verification.id,
      'verificationMethod', v_verification.method,
      'verificationOutcome', v_verification.outcome,
      'verificationRecordedAt', v_verification.recorded_at
    )
  );
  update public.exam_room_sessions
  set status = 'transferred', ended_at = now(), ended_by = p_actor_user_id,
      end_reason = p_reason, last_seen_at = now()
  where id = v_old.id;
  insert into public.exam_room_sessions (
    attempt_id, student_user_id, epoch, device_instance_hash
  ) values (
    v_attempt.id, v_attempt.student_user_id, v_old.epoch + 1, p_device_instance_hash
  ) returning * into v_new;
  insert into public.exam_room_session_events (
    session_id, attempt_id, actor_user_id, event_type, epoch,
    metadata
  ) values (
    v_new.id, v_attempt.id, p_actor_user_id, 'transferred', v_new.epoch,
    jsonb_build_object('previousEpoch', v_old.epoch)
  );
  perform public.exam_room_append_audit_v2(
    p_actor_user_id, v_attempt.exam_id, v_attempt.id, 'session', v_new.id,
    'session_transferred', p_request_key,
    jsonb_build_object(
      'previousEpoch', v_old.epoch,
      'newEpoch', v_new.epoch,
      'reason', p_reason,
      'verificationId', v_verification.id,
      'verificationMethod', v_verification.method,
      'verificationOutcome', v_verification.outcome,
      'verificationRecordedAt', v_verification.recorded_at
    )
  );
  v_response := jsonb_build_object(
    'ok', true, 'sessionId', v_new.public_id,
    'epoch', v_new.epoch, 'previousEpoch', v_old.epoch,
    'status', v_new.status
  );
  return public.exam_room_command_complete_v2(
    p_actor_user_id, 'transfer_session_v2', p_request_key, v_request, v_response
  );
end;
$$;

create or replace function public.exam_room_heartbeat_v2(
  p_student_user_id uuid,
  p_attempt_public_id uuid,
  p_session_public_id uuid,
  p_session_epoch integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_session public.exam_room_sessions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_attempt from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id and a.student_user_id = p_student_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.publication_id is null then
    raise exception 'EXAM_ROOM_PUBLICATION_REQUIRED';
  end if;
  v_session := public.exam_room_assert_session_v2(
    p_student_user_id, v_attempt.id, p_session_public_id, p_session_epoch
  );
  if v_attempt.status <> 'in_progress' then
    return jsonb_build_object(
      'ok', false,
      'code', 'ATTEMPT_CLOSED',
      'status', v_attempt.status,
      'serverNow', v_now,
      'serverDeadline', v_attempt.server_deadline
    );
  end if;
  if v_now >= v_attempt.server_deadline then
    return jsonb_build_object(
      'ok', false,
      'code', 'DEADLINE_REACHED',
      'status', v_attempt.status,
      'serverNow', v_now,
      'serverDeadline', v_attempt.server_deadline
    );
  end if;
  update public.exam_room_sessions s
  set last_seen_at = v_now
  where s.id = v_session.id;
  update public.exam_room_attempts a
  set last_heartbeat_at = v_now, updated_at = v_now
  where a.id = v_attempt.id;
  return jsonb_build_object(
    'ok', true,
    'status', v_attempt.status,
    'serverNow', v_now,
    'serverDeadline', v_attempt.server_deadline
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Idempotent local-first answer operation journal
-- ---------------------------------------------------------------------------

create or replace function public.exam_room_answer_set_hash_v2(p_attempt_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.exam_room_hash_json(coalesce(jsonb_agg(jsonb_build_object(
    'questionId', q.id,
    'revision', coalesce(a.revision, 0),
    'contentHash', encode(extensions.digest(
      pg_catalog.convert_to(coalesce(a.answer_text, ''), 'UTF8'), 'sha256'
    ), 'hex')
  ) order by q.ordinal), '[]'::jsonb))
  from public.exam_room_attempts at
  join public.exam_room_questions q on q.question_version_id = at.question_version_id
  left join public.exam_room_answers a on a.attempt_id = at.id and a.question_id = q.id
  where at.id = p_attempt_id;
$$;

create or replace function public.exam_room_save_answer_operation_v2(
  p_student_user_id uuid,
  p_attempt_public_id uuid,
  p_session_public_id uuid,
  p_session_epoch integer,
  p_operation_id uuid,
  p_question_id uuid,
  p_local_sequence bigint,
  p_answer_text text,
  p_base_revision integer,
  p_content_hash text,
  p_client_saved_at timestamptz,
  p_outage_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_session public.exam_room_sessions%rowtype;
  v_answer public.exam_room_answers%rowtype;
  v_existing public.exam_room_answer_operations%rowtype;
  v_answer_found boolean := false;
  v_server_hash text;
  v_current_hash text;
  v_current_revision integer := 0;
  v_new_revision integer;
  v_disposition text;
  v_branch_id uuid;
  v_result jsonb;
  v_publication public.exam_room_publications%rowtype;
  v_grace_minutes integer := 0;
  v_late_evidence boolean := false;
begin
  if p_operation_id is null or p_question_id is null
    or p_local_sequence is null or p_local_sequence < 1
    or p_base_revision is null or p_base_revision < 0
    or char_length(coalesce(p_answer_text, '')) > 20000
    or p_content_hash !~ '^[0-9a-f]{64}$'
    or p_client_saved_at is null
    or jsonb_typeof(coalesce(p_outage_evidence, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_outage_evidence, '{}'::jsonb)::text) > 8000
    or public.exam_room_json_has_forbidden_key(coalesce(p_outage_evidence, '{}'::jsonb))
  then raise exception 'EXAM_ROOM_ANSWER_OPERATION_INVALID'; end if;
  v_server_hash := encode(extensions.digest(
    pg_catalog.convert_to(coalesce(p_answer_text, ''), 'UTF8'), 'sha256'
  ), 'hex');
  if v_server_hash <> p_content_hash then raise exception 'EXAM_ROOM_ANSWER_HASH_MISMATCH'; end if;

  select * into v_attempt from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id and a.student_user_id = p_student_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  select * into v_existing from public.exam_room_answer_operations o
  where o.operation_id = p_operation_id;
  if found then
    if v_existing.attempt_id <> v_attempt.id
      or v_existing.question_id <> p_question_id
      or v_existing.session_id is distinct from (
        select s.id from public.exam_room_sessions s where s.public_id = p_session_public_id
      )
      or v_existing.session_epoch <> p_session_epoch
      or v_existing.local_sequence <> p_local_sequence
      or v_existing.base_revision <> p_base_revision
      or v_existing.content_hash <> p_content_hash
    then raise exception 'EXAM_ROOM_OPERATION_ID_REUSED'; end if;
    return v_existing.result_json || jsonb_build_object(
      'serverNow', now(),
      'answerSetHash', public.exam_room_answer_set_hash_v2(v_attempt.id),
      'serverAnswerSetHash', public.exam_room_answer_set_hash_v2(v_attempt.id)
    );
  end if;
  if p_client_saved_at > now() + interval '1 day'
    or p_client_saved_at < v_attempt.started_at - interval '30 days'
  then raise exception 'EXAM_ROOM_CLIENT_TIMESTAMP_INVALID'; end if;
  if now() >= v_attempt.server_deadline then
    select * into v_publication from public.exam_room_publications p
    where p.id = coalesce(v_attempt.publication_id, (
      select e.current_publication_id from public.exam_room_exams e where e.id = v_attempt.exam_id
    ));
    v_grace_minutes := coalesce((v_publication.rules_snapshot ->> 'submissionGraceMinutes')::integer, 0);
    if now() > v_attempt.server_deadline + make_interval(mins => v_grace_minutes)
      or v_attempt.status = 'sealed'
      or p_client_saved_at > v_attempt.server_deadline
      or p_client_saved_at < v_attempt.started_at
      or coalesce(p_outage_evidence, '{}'::jsonb) = '{}'::jsonb
    then
      return jsonb_build_object(
        'ok', false, 'code', 'ATTEMPT_CLOSED', 'status', v_attempt.status,
        'serverAnswerSetHash', public.exam_room_answer_set_hash_v2(v_attempt.id)
      );
    end if;
    select * into v_session from public.exam_room_sessions s
    where s.public_id = p_session_public_id
      and s.attempt_id = v_attempt.id
      and s.student_user_id = p_student_user_id
      and s.epoch = p_session_epoch
    for update;
    if not found
      or v_session.opened_at > v_attempt.server_deadline
      or (v_session.ended_at is not null and v_session.ended_at < v_attempt.server_deadline)
    then raise exception 'EXAM_ROOM_SESSION_STALE'; end if;
    v_late_evidence := true;
  else
    if v_attempt.status <> 'in_progress' then
      return jsonb_build_object('ok', false, 'code', 'ATTEMPT_CLOSED', 'status', v_attempt.status);
    end if;
    v_session := public.exam_room_assert_session_v2(
      p_student_user_id, v_attempt.id, p_session_public_id, p_session_epoch
    );
  end if;
  if not exists (
    select 1 from public.exam_room_questions q
    where q.id = p_question_id and q.question_version_id = v_attempt.question_version_id
  ) then raise exception 'EXAM_ROOM_QUESTION_NOT_FOUND'; end if;

  if exists (
    select 1 from public.exam_room_answer_operations o
    where o.session_id = v_session.id and o.question_id = p_question_id
      and o.local_sequence >= p_local_sequence
  ) then raise exception 'EXAM_ROOM_LOCAL_SEQUENCE_REUSED'; end if;

  select * into v_answer from public.exam_room_answers a
  where a.attempt_id = v_attempt.id and a.question_id = p_question_id
  for update;
  v_answer_found := found;
  if v_answer_found then
    v_current_revision := v_answer.revision;
    v_current_hash := encode(extensions.digest(
      pg_catalog.convert_to(v_answer.answer_text, 'UTF8'), 'sha256'
    ), 'hex');
  else
    v_current_revision := 0;
    v_current_hash := encode(extensions.digest(pg_catalog.convert_to('', 'UTF8'), 'sha256'), 'hex');
  end if;

  if v_late_evidence and p_content_hash <> v_current_hash then
    v_disposition := 'late_evidence';
    v_new_revision := v_current_revision;
    v_branch_id := extensions.gen_random_uuid();
    v_result := jsonb_build_object(
      'ok', true,
      'code', 'LATE_OPERATION_QUARANTINED',
      'operationId', p_operation_id,
      'disposition', v_disposition,
      'conflictBranchId', v_branch_id,
      'acceptedAsAnswer', false,
      'clientTimestampAuthoritative', false,
      'serverRevision', v_current_revision,
      'serverContentHash', v_current_hash
    );
  elsif p_content_hash = v_current_hash then
    v_disposition := 'duplicate_content';
    v_new_revision := v_current_revision;
    v_result := jsonb_build_object(
      'ok', true, 'operationId', p_operation_id,
      'disposition', v_disposition, 'revision', v_new_revision,
      'savedAt', now(), 'contentHash', p_content_hash
    );
  elsif p_base_revision <> v_current_revision then
    v_disposition := 'conflict';
    v_new_revision := v_current_revision;
    v_branch_id := extensions.gen_random_uuid();
    v_result := jsonb_build_object(
      'ok', false, 'code', 'ANSWER_CONFLICT',
      'operationId', p_operation_id, 'conflictBranchId', v_branch_id,
      'serverRevision', v_current_revision,
      'serverContentHash', v_current_hash,
      'serverAnswerText', case when v_answer_found then v_answer.answer_text else '' end
    );
  else
    v_disposition := 'applied';
    v_new_revision := v_current_revision + 1;
    v_result := jsonb_build_object(
      'ok', true, 'operationId', p_operation_id,
      'disposition', v_disposition, 'revision', v_new_revision,
      'savedAt', now(), 'contentHash', p_content_hash
    );
  end if;

  insert into public.exam_room_answer_operations (
    operation_id, exam_id, attempt_id, question_version_id, question_id,
    student_user_id, session_id, session_epoch, local_sequence,
    base_revision, answer_text, content_hash, disposition,
    resulting_revision, client_saved_at, result_json
  ) values (
    p_operation_id, v_attempt.exam_id, v_attempt.id, v_attempt.question_version_id, p_question_id,
    p_student_user_id, v_session.id, p_session_epoch, p_local_sequence,
    p_base_revision, coalesce(p_answer_text, ''), p_content_hash, v_disposition,
    v_new_revision, p_client_saved_at, v_result
  );

  if v_disposition in ('conflict', 'late_evidence') then
    insert into public.exam_room_answer_conflict_branches (
      id, operation_id, attempt_id, question_id, base_revision, server_revision,
      incoming_answer_text, incoming_content_hash, server_answer_text, server_content_hash,
      branch_reason, client_saved_at, outage_evidence
    ) values (
      v_branch_id, p_operation_id, v_attempt.id, p_question_id,
      p_base_revision, v_current_revision, coalesce(p_answer_text, ''), p_content_hash,
      case when v_answer_found then v_answer.answer_text else '' end, v_current_hash,
      case when v_disposition = 'late_evidence' then 'post_deadline_recovery' else 'stale_revision' end,
      p_client_saved_at,
      case when v_disposition = 'late_evidence' then coalesce(p_outage_evidence, '{}'::jsonb) else '{}'::jsonb end
    );
  elsif v_disposition = 'applied' then
    insert into public.exam_room_answers (
      attempt_id, question_id, answer_text, revision, saved_at
    ) values (
      v_attempt.id, p_question_id, coalesce(p_answer_text, ''), v_new_revision, now()
    )
    on conflict (attempt_id, question_id) do update
    set answer_text = excluded.answer_text,
        revision = excluded.revision,
        saved_at = excluded.saved_at;
    insert into public.exam_room_answer_revisions (
      exam_id, attempt_id, question_version_id, question_id,
      operation_id, revision, answer_text, content_hash,
      session_epoch, client_saved_at
    ) values (
      v_attempt.exam_id, v_attempt.id, v_attempt.question_version_id, p_question_id,
      p_operation_id, v_new_revision, coalesce(p_answer_text, ''), p_content_hash,
      p_session_epoch, p_client_saved_at
    );
  end if;
  if not v_late_evidence then
    update public.exam_room_sessions set last_seen_at = now()
    where id = v_session.id and status = 'active';
    update public.exam_room_attempts
    set last_heartbeat_at = now(), updated_at = now() where id = v_attempt.id;
  elsif v_disposition = 'late_evidence' then
    perform public.exam_room_append_audit_v2(
      p_student_user_id, v_attempt.exam_id, v_attempt.id,
      'answer_conflict_branch', v_branch_id, 'late_answer_evidence_preserved', null,
      jsonb_build_object(
        'operationId', p_operation_id,
        'questionId', p_question_id,
        'clientTimestampAuthoritative', false,
        'receivedAt', now()
      )
    );
    perform public.exam_room_append_incident_v2(
      v_attempt.id, p_student_user_id, v_session.id, p_session_epoch,
      null, 'recovery', 'technical', 'warning',
      'Post-deadline local answer evidence was preserved for review.',
      jsonb_build_object('operationId', p_operation_id, 'clientTimestampAuthoritative', false)
    );
  end if;
  v_result := v_result || jsonb_build_object(
    'serverNow', now(),
    'answerSetHash', public.exam_room_answer_set_hash_v2(v_attempt.id),
    'serverAnswerSetHash', public.exam_room_answer_set_hash_v2(v_attempt.id)
  );
  -- The immutable operation keeps the original acknowledgement. The returned
  -- answerSetHash is derived after commit and is not needed to replay the op.
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Submission commit, immutable snapshot generations, and stable receipts
-- ---------------------------------------------------------------------------

create or replace function public.exam_room_reopen_submission_generation_v2(
  p_actor_user_id uuid,
  p_attempt_public_id uuid,
  p_new_deadline timestamptz,
  p_reason text,
  p_grading_key_hash text,
  p_rate_key_hash text,
  p_admin_break_glass_grant_public_id uuid,
  p_verified_aal text,
  p_verified_session_id uuid,
  p_verified_authentication_at timestamptz,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam_id uuid;
  v_exam public.exam_room_exams%rowtype;
  v_attempt public.exam_room_attempts%rowtype;
  v_prior_submission public.exam_room_submissions%rowtype;
  v_prior_receipt public.exam_room_submission_receipts%rowtype;
  v_reopening public.exam_room_submission_reopenings%rowtype;
  v_grant public.exam_room_admin_break_glass_grants%rowtype;
  v_credential jsonb;
  v_authority text;
  v_generation integer;
  v_notification_count integer := 0;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object(
    'attemptId', p_attempt_public_id,
    'newDeadline', p_new_deadline,
    'reason', p_reason,
    'gradingCredentialSupplied', p_grading_key_hash is not null,
    'rateKeySupplied', p_rate_key_hash is not null,
    'gradingCredentialHash', p_grading_key_hash,
    'rateKeyHash', p_rate_key_hash,
    'adminBreakGlassGrantId', p_admin_break_glass_grant_public_id,
    'verifiedAal', p_verified_aal,
    'verifiedSessionId', p_verified_session_id,
    'verifiedAuthenticationAt', p_verified_authentication_at
  );
  v_response := public.exam_room_command_begin_v2(
    p_actor_user_id, 'reopen_submission_generation_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000
    or p_new_deadline is null
    or p_new_deadline <= clock_timestamp() + interval '1 minute'
    or p_new_deadline > clock_timestamp() + interval '4 hours'
  then raise exception 'EXAM_ROOM_REOPEN_REQUEST_INVALID'; end if;

  select a.exam_id into v_exam_id
  from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id;
  if v_exam_id is null then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  select * into v_exam
  from public.exam_room_exams e
  where e.id = v_exam_id
  for update;
  select * into v_attempt
  from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id and a.exam_id = v_exam.id
  for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if v_exam.release_id is not null
    or v_exam.status in ('grading', 'sealed')
    or v_attempt.status not in ('submitted', 'auto_submitted')
  then raise exception 'EXAM_ROOM_REOPEN_NOT_ALLOWED'; end if;
  if exists (
    select 1 from public.exam_room_grades g where g.attempt_id = v_attempt.id
  ) then raise exception 'EXAM_ROOM_REOPEN_GRADING_ALREADY_STARTED'; end if;
  if exists (
    select 1 from public.exam_room_sessions s
    where s.attempt_id = v_attempt.id and s.status = 'active'
  ) then raise exception 'EXAM_ROOM_REOPEN_ACTIVE_SESSION_INVALID'; end if;
  if exists (
    select 1 from public.exam_room_submission_reopenings ro
    where ro.attempt_id = v_attempt.id
      and ro.expires_at > clock_timestamp()
      and not exists (
        select 1 from public.exam_room_submissions reopened_submission
        where reopened_submission.reopening_id = ro.id
      )
  ) then raise exception 'EXAM_ROOM_REOPENING_ALREADY_ACTIVE'; end if;
  select * into v_prior_submission
  from public.exam_room_submissions s
  where s.attempt_id = v_attempt.id
  order by s.generation desc
  limit 1;
  if not found then raise exception 'EXAM_ROOM_REOPEN_PRIOR_SUBMISSION_REQUIRED'; end if;
  select * into v_prior_receipt
  from public.exam_room_submission_receipts receipt
  where receipt.submission_id = v_prior_submission.id;
  if not found then raise exception 'EXAM_ROOM_REOPEN_PRIOR_RECEIPT_REQUIRED'; end if;

  if v_exam.owner_professor_id = p_actor_user_id then
    if p_admin_break_glass_grant_public_id is not null
      or p_verified_aal is not null
      or p_verified_session_id is not null
      or p_verified_authentication_at is not null
      or p_grading_key_hash is null
      or p_rate_key_hash is null
      or p_grading_key_hash !~ '^[0-9a-f]{64}$'
      or p_rate_key_hash !~ '^[0-9a-f]{64}$'
    then raise exception 'EXAM_ROOM_REOPEN_AUTHORITY_INVALID'; end if;
    v_credential := public.exam_room_check_credential(
      p_actor_user_id, v_exam.id, 'professor_grading',
      p_grading_key_hash, p_rate_key_hash
    );
    if not coalesce((v_credential ->> 'ok')::boolean, false) then
      return v_credential;
    end if;
    v_authority := 'owner_professor';
  else
    if p_grading_key_hash is not null or p_rate_key_hash is not null
      or p_admin_break_glass_grant_public_id is null
    then raise exception 'EXAM_ROOM_REOPEN_AUTHORITY_INVALID'; end if;
    v_grant := public.exam_room_assert_admin_break_glass_active_v2(
      p_actor_user_id, p_admin_break_glass_grant_public_id,
      v_exam.public_id, v_attempt.public_id, v_attempt.candidate_number,
      p_verified_aal, p_verified_session_id, p_verified_authentication_at
    );
    v_authority := 'admin_break_glass';
  end if;

  v_generation := v_prior_submission.generation + 1;
  insert into public.exam_room_submission_reopenings (
    attempt_id, prior_submission_id, prior_receipt_id,
    authorized_generation, authority_type, authorized_by,
    admin_break_glass_grant_id, reason, request_key,
    new_deadline, expires_at
  ) values (
    v_attempt.id, v_prior_submission.id, v_prior_receipt.id,
    v_generation, v_authority, p_actor_user_id,
    case when v_authority = 'admin_break_glass' then v_grant.id else null end,
    btrim(p_reason), p_request_key, p_new_deadline, p_new_deadline
  ) returning * into v_reopening;

  -- Direct terminal->in_progress mutation remains blocked by the table trigger;
  -- only this exact immutable authorization may open the new generation.
  perform set_config('app.exam_room_reopen_attempt', v_attempt.id::text, true);
  update public.exam_room_attempts
  set status = 'in_progress',
      server_deadline = p_new_deadline,
      last_heartbeat_at = now(),
      updated_at = now()
  where id = v_attempt.id;
  perform set_config('app.exam_room_reopen_attempt', '', true);

  insert into public.exam_room_email_jobs (
    exam_id, recipient_user_id, recipient_email, email_type,
    event_key, payload, status, next_attempt_at
  )
  select
    v_exam.id,
    v_attempt.student_user_id,
    lower(u.email),
    'submission_reopened',
    v_reopening.public_id::text,
    jsonb_build_object(
      'examId', v_exam.public_id,
      'title', v_exam.title,
      'attemptId', v_attempt.public_id,
      'candidateNumber', v_attempt.candidate_number,
      'reopeningId', v_reopening.public_id,
      'generation', v_reopening.authorized_generation,
      'priorReceiptId', v_prior_receipt.public_id,
      'newDeadline', v_reopening.new_deadline,
      'notice', 'A new submission generation was authorized. The original receipt and answer snapshot remain preserved.'
    ),
    'pending',
    now()
  from auth.users u
  where u.id = v_attempt.student_user_id
    and u.email is not null
  on conflict (exam_id, email_type, recipient_email, event_key) do nothing;
  get diagnostics v_notification_count = row_count;

  perform public.exam_room_queue_backup(
    v_exam.id, 'submission_reopened',
    jsonb_build_object(
      'examId', v_exam.public_id,
      'attemptId', v_attempt.public_id,
      'candidateNumber', v_attempt.candidate_number,
      'reopeningId', v_reopening.public_id,
      'generation', v_reopening.authorized_generation,
      'priorGeneration', v_prior_submission.generation,
      'priorReceiptId', v_prior_receipt.public_id,
      'priorSnapshotHash', v_prior_receipt.snapshot_hash,
      'newDeadline', v_reopening.new_deadline,
      'authority', v_authority,
      'notificationStatus', case when v_notification_count > 0 then 'queued' else 'suppressed' end,
      'notificationCount', v_notification_count
    )
  );
  perform public.exam_room_append_audit_v2(
    p_actor_user_id, v_exam.id, v_attempt.id,
    'submission_reopening', v_reopening.id,
    'submission_generation_reopened', p_request_key,
    jsonb_build_object(
      'reopeningId', v_reopening.public_id,
      'generation', v_reopening.authorized_generation,
      'priorGeneration', v_prior_submission.generation,
      'priorReceiptId', v_prior_receipt.public_id,
      'priorSnapshotHash', v_prior_receipt.snapshot_hash,
      'newDeadline', v_reopening.new_deadline,
      'authority', v_authority,
      'verifiedAuthenticationAt', case
        when v_authority = 'admin_break_glass' then p_verified_authentication_at
        else null
      end,
      'notificationStatus', case when v_notification_count > 0 then 'queued' else 'suppressed' end,
      'notificationCount', v_notification_count
    )
  );
  if v_authority = 'admin_break_glass' then
    insert into public.exam_room_admin_break_glass_events (
      grant_id, actor_user_id, event_type, verified_aal,
      verified_session_id, verified_authentication_at,
      request_key, reason, metadata
    ) values (
      v_grant.id, p_actor_user_id, 'submission_reopened', p_verified_aal,
      p_verified_session_id, p_verified_authentication_at,
      p_request_key, btrim(p_reason),
      jsonb_build_object(
        'reopeningId', v_reopening.public_id,
        'generation', v_reopening.authorized_generation,
        'priorReceiptId', v_prior_receipt.public_id,
        'caseReference', v_grant.case_reference,
        'verifiedAuthenticationAt', p_verified_authentication_at
      )
    );
  end if;
  v_response := jsonb_build_object(
    'ok', true,
    'attemptId', v_attempt.public_id,
    'reopeningId', v_reopening.public_id,
    'generation', v_reopening.authorized_generation,
    'priorGeneration', v_prior_submission.generation,
    'priorReceiptId', v_prior_receipt.public_id,
    'priorSnapshotHash', v_prior_receipt.snapshot_hash,
    'serverDeadline', v_reopening.new_deadline,
    'expiresAt', v_reopening.expires_at,
    'requiresNewSession', true,
    'authority', v_authority,
    'notificationStatus', case when v_notification_count > 0 then 'queued' else 'suppressed' end,
    'notificationCount', v_notification_count
  );
  return public.exam_room_command_complete_v2(
    p_actor_user_id, 'reopen_submission_generation_v2',
    p_request_key, v_request, v_response
  );
end;
$$;

create or replace function public.exam_room_commit_submission_v2(
  p_attempt_id uuid,
  p_automatic boolean,
  p_request_key text,
  p_client_answer_set_hash text default null,
  p_client_pending_at timestamptz default null,
  p_offline_since timestamptz default null,
  p_outage_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_exam public.exam_room_exams%rowtype;
  v_submission public.exam_room_submissions%rowtype;
  v_prior_submission public.exam_room_submissions%rowtype;
  v_receipt public.exam_room_submission_receipts%rowtype;
  v_reopening public.exam_room_submission_reopenings%rowtype;
  v_snapshot jsonb;
  v_snapshot_hash text;
  v_answer_set_hash text;
  v_generation integer;
  v_status text;
  v_effective_request_key text := p_request_key;
  v_committed_at timestamptz := clock_timestamp();
begin
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
    or (p_client_answer_set_hash is not null and p_client_answer_set_hash !~ '^[0-9a-f]{64}$')
    or jsonb_typeof(coalesce(p_outage_evidence, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_outage_evidence, '{}'::jsonb)::text) > 8000
    or public.exam_room_json_has_forbidden_key(coalesce(p_outage_evidence, '{}'::jsonb))
    or (p_offline_since is not null and p_client_pending_at is null)
    or (p_offline_since is not null and p_offline_since > p_client_pending_at)
  then raise exception 'EXAM_ROOM_SUBMISSION_REQUEST_INVALID'; end if;
  select * into v_attempt from public.exam_room_attempts a where a.id = p_attempt_id for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if p_client_pending_at is not null and (
    p_client_pending_at > clock_timestamp() + interval '5 minutes'
    or p_client_pending_at < v_attempt.started_at - interval '1 day'
  ) then raise exception 'EXAM_ROOM_CLIENT_TIMESTAMP_INVALID'; end if;
  select * into v_submission from public.exam_room_submissions s
  where s.attempt_id = v_attempt.id
  order by s.generation desc limit 1;
  if found then
    v_prior_submission := v_submission;
    select * into v_reopening
    from public.exam_room_submission_reopenings ro
    where ro.attempt_id = v_attempt.id
      and ro.prior_submission_id = v_prior_submission.id
      and ro.authorized_generation = v_prior_submission.generation + 1
      and not exists (
        select 1 from public.exam_room_submissions reopened_submission
        where reopened_submission.reopening_id = ro.id
      )
    order by ro.opened_at desc
    limit 1;
    if not found then
      if v_submission.request_key = p_request_key
        and p_client_answer_set_hash is not null
        and v_submission.client_answer_set_hash is distinct from p_client_answer_set_hash
      then raise exception 'EXAM_ROOM_SUBMISSION_REQUEST_CONFLICT'; end if;
      select * into v_receipt from public.exam_room_submission_receipts r
      where r.submission_id = v_submission.id;
      return jsonb_build_object(
        'ok', true, 'alreadySubmitted', true,
        'status', v_attempt.status, 'submittedAt', v_attempt.submitted_at,
        'generation', v_submission.generation,
        'receiptId', v_receipt.public_id,
        'attemptId', v_attempt.public_id,
        'examVersionId', (
          select p.public_id from public.exam_room_publications p where p.id = v_submission.publication_id
        ),
        'receivedAt', v_receipt.issued_at,
        'snapshotHash', v_receipt.snapshot_hash,
        'answerSetHash', coalesce(v_submission.client_answer_set_hash, public.exam_room_answer_set_hash_v2(v_attempt.id)),
        'serverNow', clock_timestamp()
      );
    end if;
    if v_attempt.status not in ('in_progress', 'locked') then
      raise exception 'EXAM_ROOM_REOPENING_ATTEMPT_STATE_INVALID';
    end if;
    if p_request_key = 'deadline-auto-submit' then
      v_effective_request_key := 'deadline-auto-submit-g' || v_reopening.authorized_generation::text;
    end if;
  end if;
  select * into v_exam from public.exam_room_exams e where e.id = v_attempt.exam_id;
  v_answer_set_hash := public.exam_room_answer_set_hash_v2(v_attempt.id);
  if p_client_answer_set_hash is not null and p_client_answer_set_hash <> v_answer_set_hash then
    return jsonb_build_object(
      'ok', false, 'code', 'ANSWER_SET_MISMATCH',
      'serverAnswerSetHash', v_answer_set_hash,
      'serverNow', clock_timestamp()
    );
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'questionId', q.id,
    'ordinal', q.ordinal,
    'promptHash', q.prompt_hash,
    'answerText', coalesce(a.answer_text, ''),
    'revision', coalesce(a.revision, 0),
    'contentHash', encode(extensions.digest(
      pg_catalog.convert_to(coalesce(a.answer_text, ''), 'UTF8'), 'sha256'
    ), 'hex'),
    'savedAt', a.saved_at
  ) order by q.ordinal), '[]'::jsonb)
  into v_snapshot
  from public.exam_room_questions q
  left join public.exam_room_answers a
    on a.attempt_id = v_attempt.id and a.question_id = q.id
  where q.question_version_id = v_attempt.question_version_id;
  v_snapshot_hash := public.exam_room_hash_json(v_snapshot);
  if v_reopening.id is not null then
    v_generation := v_reopening.authorized_generation;
  else
    select coalesce(max(s.generation), 0) + 1 into v_generation
    from public.exam_room_submissions s where s.attempt_id = v_attempt.id;
  end if;
  v_status := case when p_automatic then 'auto_submitted' else 'submitted' end;

  if v_attempt.status not in ('submitted', 'auto_submitted', 'sealed') then
    update public.exam_room_attempts
    set status = v_status,
        submitted_at = v_committed_at,
        submission_request_key = v_effective_request_key,
        updated_at = v_committed_at
    where id = v_attempt.id;
    v_attempt.status := v_status;
    v_attempt.submitted_at := v_committed_at;
  end if;
  insert into public.exam_room_submissions (
    attempt_id, publication_id, generation, request_key,
    answer_snapshot, answer_snapshot_hash, client_answer_set_hash,
    automatic, client_pending_at, offline_since, outage_evidence,
    reopening_id, prior_submission_id, committed_at
  ) values (
    v_attempt.id, coalesce(v_attempt.publication_id, v_exam.current_publication_id),
    v_generation, v_effective_request_key, v_snapshot, v_snapshot_hash,
    coalesce(p_client_answer_set_hash, v_answer_set_hash), p_automatic,
    p_client_pending_at, p_offline_since, coalesce(p_outage_evidence, '{}'::jsonb),
    v_reopening.id, v_prior_submission.id,
    v_committed_at
  ) returning * into v_submission;
  insert into public.exam_room_submission_receipts (
    submission_id, attempt_id, generation, snapshot_hash, issued_at
  ) values (
    v_submission.id, v_attempt.id, v_submission.generation,
    v_snapshot_hash, v_committed_at
  ) returning * into v_receipt;

  update public.exam_room_sessions
  set status = 'closed', ended_at = v_committed_at,
      ended_by = v_attempt.student_user_id,
      end_reason = case when p_automatic then 'deadline-auto-submit' else 'submission-committed' end,
      last_seen_at = v_committed_at
  where attempt_id = v_attempt.id and status = 'active';
  perform public.exam_room_queue_backup(
    v_exam.id,
    'attempt_submitted',
    jsonb_build_object(
      'attemptId', v_attempt.public_id,
      'candidateNumber', v_attempt.candidate_number,
      'studentUserId', v_attempt.student_user_id,
      'publicationId', (select p.public_id from public.exam_room_publications p where p.id = coalesce(v_attempt.publication_id, v_exam.current_publication_id)),
      'generation', v_submission.generation,
      'reopeningId', v_reopening.public_id,
      'priorGeneration', v_prior_submission.generation,
      'receiptId', v_receipt.public_id,
      'startedAt', v_attempt.started_at,
      'serverDeadline', v_attempt.server_deadline,
      'submittedAt', v_committed_at,
      'automatic', p_automatic,
      'answerSetHash', v_answer_set_hash,
      'snapshotHash', v_snapshot_hash,
      'answers', v_snapshot,
      'clientPendingAt', p_client_pending_at,
      'offlineSince', p_offline_since,
      'outageEvidence', coalesce(p_outage_evidence, '{}'::jsonb),
      'integrityIncidentCount', (
        select count(*) from public.exam_room_integrity_events i where i.attempt_id = v_attempt.id
      )
    )
  );
  insert into public.exam_room_audit_log (
    actor_user_id, exam_id, classroom_id, attempt_id, action, metadata
  ) values (
    v_attempt.student_user_id, v_exam.id, v_exam.classroom_id, v_attempt.id,
    case when p_automatic then 'attempt_auto_submitted' else 'attempt_submitted' end,
    jsonb_build_object(
      'candidateNumber', v_attempt.candidate_number,
      'generation', v_submission.generation,
      'receiptId', v_receipt.public_id
    )
  );
  perform public.exam_room_append_audit_v2(
    v_attempt.student_user_id, v_exam.id, v_attempt.id, 'submission', v_submission.id,
    case when p_automatic then 'attempt_auto_submitted' else 'attempt_submitted' end,
    v_effective_request_key,
    jsonb_build_object(
      'generation', v_submission.generation,
      'reopeningId', v_reopening.public_id,
      'priorGeneration', v_prior_submission.generation,
      'receiptId', v_receipt.public_id,
      'snapshotHash', v_snapshot_hash,
      'offlinePending', p_client_pending_at is not null
    )
  );
  return jsonb_build_object(
    'ok', true, 'alreadySubmitted', false,
    'status', v_attempt.status, 'submittedAt', v_attempt.submitted_at,
    'generation', v_submission.generation,
    'reopeningId', v_reopening.public_id,
    'priorGeneration', v_prior_submission.generation,
    'priorReceiptId', (
      select prior_receipt.public_id
      from public.exam_room_submission_receipts prior_receipt
      where prior_receipt.submission_id = v_prior_submission.id
    ),
    'receiptId', v_receipt.public_id,
    'attemptId', v_attempt.public_id,
    'examVersionId', (
      select p.public_id from public.exam_room_publications p where p.id = v_submission.publication_id
    ),
    'receivedAt', v_receipt.issued_at,
    'snapshotHash', v_receipt.snapshot_hash,
    'answerSetHash', v_answer_set_hash,
    'serverNow', clock_timestamp()
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
set search_path = ''
as $$
begin
  return public.exam_room_commit_submission_v2(
    p_attempt_id, p_automatic, p_request_key,
    null, null, null, '{}'::jsonb
  );
end;
$$;

create or replace function public.exam_room_submit_attempt_generation_v2(
  p_student_user_id uuid,
  p_attempt_public_id uuid,
  p_session_public_id uuid,
  p_session_epoch integer,
  p_client_answer_set_hash text,
  p_request_key text,
  p_client_pending_at timestamptz default null,
  p_offline_since timestamptz default null,
  p_outage_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_submission public.exam_room_submissions%rowtype;
  v_receipt public.exam_room_submission_receipts%rowtype;
  v_publication public.exam_room_publications%rowtype;
  v_reopening public.exam_room_submission_reopenings%rowtype;
  v_grace integer := 0;
  v_after_deadline boolean;
begin
  if p_client_answer_set_hash !~ '^[0-9a-f]{64}$'
    or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
  then
    raise exception 'EXAM_ROOM_SUBMISSION_REQUEST_INVALID';
  end if;
  select * into v_attempt from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id and a.student_user_id = p_student_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  select * into v_submission from public.exam_room_submissions s
  where s.attempt_id = v_attempt.id order by s.generation desc limit 1;
  if found then
    select * into v_reopening
    from public.exam_room_submission_reopenings ro
    where ro.attempt_id = v_attempt.id
      and ro.prior_submission_id = v_submission.id
      and ro.authorized_generation = v_submission.generation + 1
      and not exists (
        select 1 from public.exam_room_submissions reopened_submission
        where reopened_submission.reopening_id = ro.id
      )
    order by ro.opened_at desc limit 1;
    if not found then
      if v_submission.request_key = p_request_key
        and v_submission.client_answer_set_hash is distinct from p_client_answer_set_hash
      then raise exception 'EXAM_ROOM_SUBMISSION_REQUEST_CONFLICT'; end if;
      select * into v_receipt from public.exam_room_submission_receipts r
      where r.submission_id = v_submission.id;
      return jsonb_build_object(
        'ok', true, 'alreadySubmitted', true,
        'status', v_attempt.status, 'submittedAt', v_attempt.submitted_at,
        'generation', v_submission.generation, 'receiptId', v_receipt.public_id,
        'attemptId', v_attempt.public_id,
        'examVersionId', (
          select p.public_id from public.exam_room_publications p where p.id = v_submission.publication_id
        ),
        'receivedAt', v_receipt.issued_at,
        'snapshotHash', v_receipt.snapshot_hash,
        'answerSetHash', v_submission.client_answer_set_hash,
        'serverNow', clock_timestamp()
      );
    end if;
  end if;
  perform public.exam_room_assert_session_v2(
    p_student_user_id, v_attempt.id, p_session_public_id, p_session_epoch
  );
  select * into v_publication from public.exam_room_publications p
  where p.id = coalesce(v_attempt.publication_id, (
    select e.current_publication_id from public.exam_room_exams e where e.id = v_attempt.exam_id
  ));
  v_grace := coalesce((v_publication.rules_snapshot ->> 'submissionGraceMinutes')::integer, 0);
  v_after_deadline := clock_timestamp() >= v_attempt.server_deadline;
  if v_after_deadline then
    if clock_timestamp() > v_attempt.server_deadline + make_interval(mins => v_grace)
      or p_client_pending_at is null
      or p_client_pending_at > v_attempt.server_deadline
      or p_offline_since is null
      or p_offline_since > p_client_pending_at
      or coalesce(p_outage_evidence, '{}'::jsonb) = '{}'::jsonb
    then
      return public.exam_room_commit_submission_v2(
        v_attempt.id, true, 'deadline-auto-submit',
        null, null, null, '{}'::jsonb
      ) || jsonb_build_object('latePendingAccepted', false);
    end if;
  end if;
  return public.exam_room_commit_submission_v2(
    v_attempt.id, false, p_request_key, p_client_answer_set_hash,
    p_client_pending_at, p_offline_since, coalesce(p_outage_evidence, '{}'::jsonb)
  ) || jsonb_build_object('latePendingAccepted', v_after_deadline);
end;
$$;


-- Student-owned attempt bundle. Private model-answer material is intentionally
-- absent even when the professor configured it for manual grading.
create or replace function public.exam_room_attempt_view(
  p_student_user_id uuid,
  p_attempt_public_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_exam public.exam_room_exams%rowtype;
  v_publication public.exam_room_publications%rowtype;
  v_session public.exam_room_sessions%rowtype;
  v_questions jsonb;
  v_errata jsonb;
  v_accommodation jsonb;
begin
  select * into v_attempt from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id and a.student_user_id = p_student_user_id;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.publication_id is not null
    and coalesce(current_setting('app.exam_room_v2_view', true), '')
      <> v_attempt.id::text
  then
    return jsonb_build_object('ok', false, 'code', 'EXAM_ROOM_V2_SESSION_REQUIRED');
  end if;
  select * into v_exam from public.exam_room_exams e where e.id = v_attempt.exam_id;
  select * into v_publication from public.exam_room_publications p
  where p.id = coalesce(v_attempt.publication_id, v_exam.current_publication_id);
  select * into v_session from public.exam_room_sessions s
  where s.attempt_id = v_attempt.id and s.status = 'active';
  select a.configuration into v_accommodation
  from public.exam_room_accommodations a
  where a.exam_id = v_exam.id and a.roster_id = v_attempt.roster_id and a.status = 'active';
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'ordinal', q.ordinal,
    'prompt', q.prompt_text,
    'maximumPoints', q.maximum_points,
    'promptHash', q.prompt_hash,
    'answer', coalesce(a.answer_text, ''),
    'revision', coalesce(a.revision, 0),
    'contentHash', encode(extensions.digest(
      pg_catalog.convert_to(coalesce(a.answer_text, ''), 'UTF8'), 'sha256'
    ), 'hex'),
    'savedAt', a.saved_at
  ) order by q.ordinal), '[]'::jsonb)
  into v_questions
  from public.exam_room_questions q
  left join public.exam_room_answers a
    on a.question_id = q.id and a.attempt_id = v_attempt.id
  where q.question_version_id = v_attempt.question_version_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'erratumId', er.public_id,
    'number', er.erratum_number,
    'type', er.erratum_type,
    'affectedQuestionIds', er.affected_question_ids,
    'body', er.body,
    'effectiveAt', er.effective_at,
    'issuedAt', er.issued_at
  ) order by er.erratum_number), '[]'::jsonb)
  into v_errata
  from public.exam_room_errata er
  where er.exam_id = v_exam.id and er.effective_at <= now();
  return jsonb_build_object(
    'ok', true,
    'attemptId', v_attempt.public_id,
    'examId', v_exam.public_id,
    'examVersionId', v_publication.public_id,
    'questionVersionId', v_attempt.question_version_id,
    'publicationId', v_publication.public_id,
    'title', v_publication.title_snapshot,
    'instructions', v_publication.instructions_snapshot,
    'rules', v_publication.rules_snapshot,
    'integrityPreset', v_exam.integrity_preset,
    'integrityDisclosure', 'Browser signals are limited operational evidence. They do not prove misconduct and never automatically fail or lock a candidate.',
    'status', v_attempt.status,
    'serverNow', now(),
    'serverDeadline', v_attempt.server_deadline,
    'hardClosesAt', v_exam.hard_closes_at,
    'sessionId', v_session.public_id,
    'sessionEpoch', v_session.epoch,
    'answerSetHash', public.exam_room_answer_set_hash_v2(v_attempt.id),
    'accommodation', coalesce(v_accommodation, '{}'::jsonb),
    'errata', v_errata,
    'questions', v_questions
  );
end;
$$;

create or replace function public.exam_room_attempt_view_v2(
  p_student_user_id uuid,
  p_attempt_public_id uuid,
  p_session_public_id uuid,
  p_session_epoch integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_session public.exam_room_sessions%rowtype;
  v_response jsonb;
begin
  select * into v_attempt from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id and a.student_user_id = p_student_user_id;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  v_session := public.exam_room_assert_session_v2(
    p_student_user_id, v_attempt.id, p_session_public_id, p_session_epoch
  );
  perform set_config('app.exam_room_v2_view', v_attempt.id::text, true);
  v_response := public.exam_room_attempt_view(p_student_user_id, p_attempt_public_id);
  perform set_config('app.exam_room_v2_view', '', true);
  return v_response || jsonb_build_object(
    'sessionId', v_session.public_id,
    'sessionEpoch', v_session.epoch,
    'activeLeave', (
      select jsonb_build_object(
        'leaveId', l.public_id,
        'departedAt', l.started_at,
        'status', l.status,
        'acknowledgmentRequired',
          coalesce((v_response #>> '{rules,temporaryLeaveAcknowledgment}')::boolean, false)
          and l.status = 'open'
      )
      from public.exam_room_temporary_leaves l
      where l.attempt_id = v_attempt.id and l.status in ('open', 'acknowledged')
      order by l.started_at desc
      limit 1
    )
  );
exception when others then
  perform set_config('app.exam_room_v2_view', '', true);
  raise;
end;
$$;

create or replace function public.exam_room_submission_status_v2(
  p_student_user_id uuid,
  p_attempt_public_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_exam public.exam_room_exams%rowtype;
  v_publication public.exam_room_publications%rowtype;
  v_submission public.exam_room_submissions%rowtype;
  v_receipt public.exam_room_submission_receipts%rowtype;
begin
  select * into v_attempt from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id and a.student_user_id = p_student_user_id;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  select * into v_exam from public.exam_room_exams e where e.id = v_attempt.exam_id;
  select * into v_publication from public.exam_room_publications p
  where p.id = coalesce(v_attempt.publication_id, v_exam.current_publication_id);
  select * into v_submission from public.exam_room_submissions s
  where s.attempt_id = v_attempt.id order by s.generation desc limit 1;
  if v_submission.id is not null then
    select * into v_receipt from public.exam_room_submission_receipts r
    where r.submission_id = v_submission.id;
  end if;
  return jsonb_build_object(
    'ok', true,
    'attemptId', v_attempt.public_id,
    'examId', v_exam.public_id,
    'examVersionId', v_publication.public_id,
    'status', v_attempt.status,
    'submittedAt', v_attempt.submitted_at,
    'generation', v_submission.generation,
    'receiptId', v_receipt.public_id,
    'reopeningId', (
      select reopening.public_id
      from public.exam_room_submission_reopenings reopening
      where reopening.id = v_submission.reopening_id
    ),
    'priorReceiptId', (
      select prior_receipt.public_id
      from public.exam_room_submissions prior_submission
      join public.exam_room_submission_receipts prior_receipt
        on prior_receipt.submission_id = prior_submission.id
      where prior_submission.id = v_submission.prior_submission_id
    ),
    'receivedAt', v_receipt.issued_at,
    'snapshotHash', v_receipt.snapshot_hash,
    'answerSetHash', coalesce(
      v_submission.client_answer_set_hash,
      public.exam_room_answer_set_hash_v2(v_attempt.id)
    ),
    'activeReopening', (
      select jsonb_build_object(
        'reopeningId', reopening.public_id,
        'generation', reopening.authorized_generation,
        'priorReceiptId', prior_receipt.public_id,
        'serverDeadline', reopening.new_deadline,
        'expiresAt', reopening.expires_at,
        'requiresNewSession', not exists (
          select 1 from public.exam_room_sessions active_session
          where active_session.attempt_id = v_attempt.id
            and active_session.status = 'active'
        )
      )
      from public.exam_room_submission_reopenings reopening
      join public.exam_room_submission_receipts prior_receipt
        on prior_receipt.id = reopening.prior_receipt_id
      where reopening.attempt_id = v_attempt.id
        and not exists (
          select 1 from public.exam_room_submissions completed
          where completed.reopening_id = reopening.id
        )
      order by reopening.opened_at desc limit 1
    ),
    'submissionHistory', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'generation', submission.generation,
        'receiptId', receipt.public_id,
        'receivedAt', receipt.issued_at,
        'snapshotHash', receipt.snapshot_hash,
        'automatic', submission.automatic,
        'reopeningId', reopening.public_id,
        'priorGeneration', prior_submission.generation
      ) order by submission.generation), '[]'::jsonb)
      from public.exam_room_submissions submission
      join public.exam_room_submission_receipts receipt
        on receipt.submission_id = submission.id
      left join public.exam_room_submission_reopenings reopening
        on reopening.id = submission.reopening_id
      left join public.exam_room_submissions prior_submission
        on prior_submission.id = submission.prior_submission_id
      where submission.attempt_id = v_attempt.id
    ),
    'lateRecoveryEvidenceCount', (
      select count(*) from public.exam_room_answer_operations o
      where o.attempt_id = v_attempt.id and o.disposition = 'late_evidence'
    ),
    'serverNow', now()
  );
end;
$$;

create or replace function public.exam_room_issue_erratum_v2(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_erratum_type text,
  p_body text,
  p_affected_question_ids jsonb,
  p_effective_at timestamptz,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_publication public.exam_room_publications%rowtype;
  v_erratum public.exam_room_errata%rowtype;
  v_number integer;
  v_content jsonb;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id, 'type', p_erratum_type, 'body', p_body,
    'affectedQuestionIds', p_affected_question_ids, 'effectiveAt', p_effective_at
  );
  v_response := public.exam_room_command_begin_v2(
    p_professor_user_id, 'issue_erratum_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  select * into v_exam from public.exam_room_exams e
  where e.public_id = p_exam_public_id
    and e.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.current_publication_id is null or v_exam.status = 'sealed' then
    raise exception 'EXAM_ROOM_ERRATUM_NOT_ALLOWED';
  end if;
  if p_erratum_type not in ('clarification', 'correction', 'stop_notice', 'replacement_notice')
    or char_length(btrim(p_body)) not between 3 and 5000
    or jsonb_typeof(p_affected_question_ids) <> 'array'
    or octet_length(p_affected_question_ids::text) > 16384
    or p_effective_at is null
    or p_effective_at < now() - interval '5 minutes'
  then raise exception 'EXAM_ROOM_ERRATUM_INVALID'; end if;
  select * into v_publication from public.exam_room_publications p
  where p.id = v_exam.current_publication_id;
  begin
    if exists (
      select 1 from jsonb_array_elements_text(p_affected_question_ids) x(question_id)
      where not exists (
        select 1 from public.exam_room_questions q
        where q.id = x.question_id::uuid and q.question_version_id = v_publication.question_version_id
      )
    ) then raise exception 'EXAM_ROOM_ERRATUM_QUESTION_INVALID'; end if;
  exception when invalid_text_representation then
    raise exception 'EXAM_ROOM_ERRATUM_QUESTION_INVALID';
  end;
  select coalesce(max(e.erratum_number), 0) + 1 into v_number
  from public.exam_room_errata e where e.exam_id = v_exam.id;
  v_content := jsonb_build_object(
    'examId', v_exam.public_id, 'publicationId', v_publication.public_id,
    'number', v_number, 'type', p_erratum_type,
    'affectedQuestionIds', p_affected_question_ids,
    'body', p_body, 'effectiveAt', p_effective_at
  );
  insert into public.exam_room_errata (
    exam_id, publication_id, erratum_number, erratum_type,
    affected_question_ids, body, content_hash, effective_at, issued_by
  ) values (
    v_exam.id, v_publication.id, v_number, p_erratum_type,
    p_affected_question_ids, p_body, public.exam_room_hash_json(v_content),
    p_effective_at, p_professor_user_id
  ) returning * into v_erratum;
  perform public.exam_room_append_audit_v2(
    p_professor_user_id, v_exam.id, null, 'erratum', v_erratum.id,
    'erratum_issued', p_request_key,
    jsonb_build_object('number', v_erratum.erratum_number, 'contentHash', v_erratum.content_hash)
  );
  perform public.exam_room_queue_backup(
    v_exam.id, 'exam_erratum',
    jsonb_build_object(
      'erratumId', v_erratum.public_id, 'number', v_erratum.erratum_number,
      'type', v_erratum.erratum_type, 'affectedQuestionIds', v_erratum.affected_question_ids,
      'body', v_erratum.body, 'effectiveAt', v_erratum.effective_at,
      'contentHash', v_erratum.content_hash
    )
  );
  v_response := jsonb_build_object(
    'ok', true, 'erratumId', v_erratum.public_id,
    'number', v_erratum.erratum_number, 'issuedAt', v_erratum.issued_at,
    'effectiveAt', v_erratum.effective_at
  );
  return public.exam_room_command_complete_v2(
    p_professor_user_id, 'issue_erratum_v2', p_request_key, v_request, v_response
  );
end;
$$;

create or replace function public.exam_room_start_temporary_leave_v2(
  p_student_user_id uuid,
  p_attempt_public_id uuid,
  p_session_public_id uuid,
  p_session_epoch integer,
  p_reason_code text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_session public.exam_room_sessions%rowtype;
  v_leave public.exam_room_temporary_leaves%rowtype;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object(
    'attemptId', p_attempt_public_id, 'sessionId', p_session_public_id,
    'sessionEpoch', p_session_epoch, 'reasonCode', p_reason_code
  );
  v_response := public.exam_room_command_begin_v2(
    p_student_user_id, 'start_temporary_leave_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  if p_reason_code not in ('comfort_room', 'medical', 'technical', 'other') then
    raise exception 'EXAM_ROOM_LEAVE_REASON_INVALID';
  end if;
  select * into v_attempt from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id and a.student_user_id = p_student_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.status <> 'in_progress' or now() >= v_attempt.server_deadline then
    raise exception 'EXAM_ROOM_ATTEMPT_CLOSED';
  end if;
  v_session := public.exam_room_assert_session_v2(
    p_student_user_id, v_attempt.id, p_session_public_id, p_session_epoch
  );
  select * into v_leave from public.exam_room_temporary_leaves l
  where l.attempt_id = v_attempt.id and l.status in ('open', 'acknowledged')
  for update;
  if not found then
    insert into public.exam_room_temporary_leaves (
      attempt_id, session_id, reason_code, started_by
    ) values (
      v_attempt.id, v_session.id, p_reason_code, p_student_user_id
    ) returning * into v_leave;
    insert into public.exam_room_leave_events (
      leave_id, attempt_id, actor_user_id, event_type
    ) values (v_leave.id, v_attempt.id, p_student_user_id, 'started');
    perform public.exam_room_append_incident_v2(
      v_attempt.id, p_student_user_id, v_session.id, p_session_epoch,
      null, 'temporary_leave', 'leave', 'info',
      'Candidate began a temporary leave.', jsonb_build_object('reasonCode', p_reason_code)
    );
    perform public.exam_room_append_audit_v2(
      p_student_user_id, v_attempt.exam_id, v_attempt.id, 'temporary_leave', v_leave.id,
      'temporary_leave_started', p_request_key, jsonb_build_object('reasonCode', p_reason_code)
    );
  end if;
  v_response := jsonb_build_object(
    'ok', true, 'leaveId', v_leave.public_id, 'status', v_leave.status,
    'startedAt', v_leave.started_at, 'timerPaused', false,
    'serverDeadline', v_attempt.server_deadline
  );
  return public.exam_room_command_complete_v2(
    p_student_user_id, 'start_temporary_leave_v2', p_request_key, v_request, v_response
  );
end;
$$;

create or replace function public.exam_room_end_temporary_leave_v2(
  p_student_user_id uuid,
  p_attempt_public_id uuid,
  p_session_public_id uuid,
  p_session_epoch integer,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_session public.exam_room_sessions%rowtype;
  v_leave public.exam_room_temporary_leaves%rowtype;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object(
    'attemptId', p_attempt_public_id, 'sessionId', p_session_public_id,
    'sessionEpoch', p_session_epoch
  );
  v_response := public.exam_room_command_begin_v2(
    p_student_user_id, 'end_temporary_leave_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  select * into v_attempt from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id and a.student_user_id = p_student_user_id for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  v_session := public.exam_room_assert_session_v2(
    p_student_user_id, v_attempt.id, p_session_public_id, p_session_epoch
  );
  select * into v_leave from public.exam_room_temporary_leaves l
  where l.attempt_id = v_attempt.id and l.status in ('open', 'acknowledged') for update;
  if not found then raise exception 'EXAM_ROOM_ACTIVE_LEAVE_NOT_FOUND'; end if;
  update public.exam_room_temporary_leaves
  set status = 'returned', returned_at = now(), returned_by = p_student_user_id
  where id = v_leave.id returning * into v_leave;
  insert into public.exam_room_leave_events (
    leave_id, attempt_id, actor_user_id, event_type
  ) values (v_leave.id, v_attempt.id, p_student_user_id, 'student_returned');
  perform public.exam_room_append_audit_v2(
    p_student_user_id, v_attempt.exam_id, v_attempt.id, 'temporary_leave', v_leave.id,
    'temporary_leave_ended', p_request_key, '{}'::jsonb
  );
  v_response := jsonb_build_object(
    'ok', true, 'leaveId', v_leave.public_id, 'status', v_leave.status,
    'returnedAt', v_leave.returned_at, 'timerPaused', false,
    'serverDeadline', v_attempt.server_deadline
  );
  return public.exam_room_command_complete_v2(
    p_student_user_id, 'end_temporary_leave_v2', p_request_key, v_request, v_response
  );
end;
$$;

create or replace function public.exam_room_acknowledge_temporary_leave_v2(
  p_actor_user_id uuid,
  p_attempt_public_id uuid,
  p_leave_public_id uuid,
  p_action text,
  p_note text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_leave public.exam_room_temporary_leaves%rowtype;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object(
    'attemptId', p_attempt_public_id, 'leaveId', p_leave_public_id,
    'action', p_action, 'note', coalesce(p_note, '')
  );
  v_response := public.exam_room_command_begin_v2(
    p_actor_user_id, 'acknowledge_temporary_leave_v2', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  if p_action not in ('acknowledge', 'record_return') or char_length(coalesce(p_note, '')) > 1000 then
    raise exception 'EXAM_ROOM_LEAVE_ACTION_INVALID';
  end if;
  select * into v_attempt from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if not public.exam_room_is_operator_v2(p_actor_user_id, v_attempt.exam_id, true) then
    raise exception 'EXAM_ROOM_OPERATOR_REQUIRED';
  end if;
  select * into v_leave from public.exam_room_temporary_leaves l
  where l.public_id = p_leave_public_id and l.attempt_id = v_attempt.id for update;
  if not found then raise exception 'EXAM_ROOM_LEAVE_NOT_FOUND'; end if;
  if p_action = 'acknowledge' then
    if v_leave.status = 'open' then
      update public.exam_room_temporary_leaves
      set status = 'acknowledged', acknowledged_at = now(),
          acknowledged_by = p_actor_user_id, operational_note = coalesce(p_note, '')
      where id = v_leave.id returning * into v_leave;
      insert into public.exam_room_leave_events (
        leave_id, attempt_id, actor_user_id, event_type, note
      ) values (v_leave.id, v_attempt.id, p_actor_user_id, 'acknowledged', coalesce(p_note, ''));
    end if;
  elsif v_leave.status in ('open', 'acknowledged') then
    update public.exam_room_temporary_leaves
    set status = 'returned', returned_at = now(), returned_by = p_actor_user_id,
        operational_note = coalesce(p_note, '')
    where id = v_leave.id returning * into v_leave;
    insert into public.exam_room_leave_events (
      leave_id, attempt_id, actor_user_id, event_type, note
    ) values (v_leave.id, v_attempt.id, p_actor_user_id, 'beadle_recorded_return', coalesce(p_note, ''));
  end if;
  perform public.exam_room_append_audit_v2(
    p_actor_user_id, v_attempt.exam_id, v_attempt.id, 'temporary_leave', v_leave.id,
    case when p_action = 'acknowledge' then 'temporary_leave_acknowledged' else 'temporary_leave_return_recorded' end,
    p_request_key, '{}'::jsonb
  );
  v_response := jsonb_build_object(
    'ok', true, 'leaveId', v_leave.public_id, 'status', v_leave.status,
    'acknowledgedAt', v_leave.acknowledged_at, 'returnedAt', v_leave.returned_at,
    'timerPaused', false, 'serverDeadline', v_attempt.server_deadline
  );
  return public.exam_room_command_complete_v2(
    p_actor_user_id, 'acknowledge_temporary_leave_v2', p_request_key, v_request, v_response
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Truthful, grouped incidents. Browser signals are evidence, not proof.
-- No event count in this migration automatically locks or fails a candidate.
-- ---------------------------------------------------------------------------

create or replace function public.exam_room_append_incident_v2(
  p_attempt_id uuid,
  p_student_user_id uuid,
  p_session_id uuid,
  p_session_epoch integer,
  p_client_event_id uuid,
  p_event_type text,
  p_category text,
  p_severity text,
  p_summary text,
  p_details jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_group public.exam_room_incident_groups%rowtype;
  v_event_id bigint;
begin
  select * into v_attempt from public.exam_room_attempts a where a.id = p_attempt_id for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.student_user_id <> p_student_user_id then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if p_category not in ('attention', 'network', 'session', 'leave', 'verification', 'technical')
    or p_severity not in ('info', 'warning', 'critical')
    or char_length(btrim(p_summary)) not between 3 and 500
    or jsonb_typeof(coalesce(p_details, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_details, '{}'::jsonb)::text) > 4000
    or public.exam_room_json_has_forbidden_key(coalesce(p_details, '{}'::jsonb))
  then raise exception 'EXAM_ROOM_INTEGRITY_EVENT_INVALID'; end if;
  if p_client_event_id is not null then
    select g.* into v_group
    from public.exam_room_integrity_events i
    join public.exam_room_incident_groups g on g.id = i.group_id
    where i.attempt_id = v_attempt.id and i.client_event_id = p_client_event_id;
    if found then
      return jsonb_build_object(
        'ok', true, 'duplicate', true, 'incidentId', v_group.public_id,
        'eventCount', v_group.event_count, 'locked', false, 'threshold', null
      );
    end if;
  end if;
  select * into v_group from public.exam_room_incident_groups g
  where g.attempt_id = v_attempt.id and g.category = p_category and g.status = 'open'
  for update;
  if found and v_group.last_occurred_at < now() - interval '5 minutes' then
    update public.exam_room_incident_groups
    set status = 'closed', updated_at = now() where id = v_group.id;
    v_group.id := null;
  end if;
  if v_group.id is null then
    insert into public.exam_room_incident_groups (
      exam_id, attempt_id, category, severity, event_count,
      first_occurred_at, last_occurred_at, summary
    ) values (
      v_attempt.exam_id, v_attempt.id, p_category, p_severity, 1,
      now(), now(), p_summary
    ) returning * into v_group;
  else
    update public.exam_room_incident_groups
    set event_count = event_count + 1,
        severity = case
          when severity = 'critical' or p_severity = 'critical' then 'critical'
          when severity = 'warning' or p_severity = 'warning' then 'warning'
          else 'info'
        end,
        last_occurred_at = now(),
        summary = p_summary,
        updated_at = now()
    where id = v_group.id
    returning * into v_group;
  end if;
  insert into public.exam_room_integrity_events (
    exam_id, attempt_id, student_user_id, event_type, details,
    group_id, session_id, session_epoch, client_event_id, severity
  ) values (
    v_attempt.exam_id, v_attempt.id, p_student_user_id, p_event_type,
    coalesce(p_details, '{}'::jsonb), v_group.id, p_session_id,
    p_session_epoch, p_client_event_id, p_severity
  ) returning id into v_event_id;
  return jsonb_build_object(
    'ok', true,
    'eventId', v_event_id,
    'incidentId', v_group.public_id,
    'eventCount', v_group.event_count,
    'severity', v_group.severity,
    'locked', false,
    'threshold', null
  );
end;
$$;

create or replace function public.exam_room_record_integrity_event_v2(
  p_student_user_id uuid,
  p_attempt_public_id uuid,
  p_session_public_id uuid,
  p_session_epoch integer,
  p_client_event_id uuid,
  p_event_type text,
  p_details jsonb,
  p_client_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_publication public.exam_room_publications%rowtype;
  v_session public.exam_room_sessions%rowtype;
  v_integrity_mode text;
  v_integrity_exempt boolean := false;
  v_category text;
  v_severity text;
  v_summary text;
  v_details jsonb;
begin
  if p_client_event_id is null
    or p_event_type not in (
      'visibility_exit', 'visibility_resume', 'focus_exit', 'focus_return',
      'fullscreen_enter', 'fullscreen_exit', 'reload_resume',
      'copy_attempt', 'paste_attempt', 'context_menu_attempt',
      'network_gap', 'network_restored', 'heartbeat_gap',
      'sync_failed', 'sync_restored', 'second_session_attempt', 'session_transfer'
    )
    or p_client_occurred_at is null
    or p_client_occurred_at > now() + interval '1 day'
    or p_client_occurred_at < now() - interval '30 days'
    or jsonb_typeof(coalesce(p_details, '{}'::jsonb)) <> 'object'
    or octet_length(coalesce(p_details, '{}'::jsonb)::text) > 4000
    or public.exam_room_json_has_forbidden_key(coalesce(p_details, '{}'::jsonb))
  then raise exception 'EXAM_ROOM_INTEGRITY_EVENT_INVALID'; end if;

  select * into v_attempt from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id and a.student_user_id = p_student_user_id;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.publication_id is null then
    raise exception 'EXAM_ROOM_PUBLICATION_REQUIRED';
  end if;
  v_session := public.exam_room_assert_session_v2(
    p_student_user_id, v_attempt.id, p_session_public_id, p_session_epoch
  );
  if v_attempt.status <> 'in_progress' then
    return jsonb_build_object(
      'ok', false, 'code', 'ATTEMPT_CLOSED', 'status', v_attempt.status,
      'recorded', false, 'locked', false, 'threshold', null
    );
  end if;

  select * into v_publication from public.exam_room_publications p
  where p.id = v_attempt.publication_id;
  if not found then raise exception 'EXAM_ROOM_PUBLICATION_REQUIRED'; end if;
  v_integrity_mode := coalesce(v_publication.rules_snapshot ->> 'integrityMode', 'off');
  select coalesce((a.configuration ->> 'integrityExempt')::boolean, false)
  into v_integrity_exempt
  from public.exam_room_accommodations a
  where a.exam_id = v_attempt.exam_id
    and a.roster_id = v_attempt.roster_id
    and a.status = 'active';

  if v_integrity_mode = 'off' or coalesce(v_integrity_exempt, false) then
    return jsonb_build_object(
      'ok', true,
      'ignored', true,
      'recorded', false,
      'reason', case
        when coalesce(v_integrity_exempt, false) then 'integrity_exempt'
        else 'integrity_off'
      end,
      'integrityMode', v_integrity_mode,
      'locked', false,
      'threshold', null
    );
  end if;

  v_category := case
    when p_event_type in (
      'network_gap', 'network_restored', 'heartbeat_gap',
      'sync_failed', 'sync_restored'
    ) then 'network'
    when p_event_type in ('reload_resume', 'second_session_attempt', 'session_transfer') then 'session'
    else 'attention'
  end;
  v_severity := case
    when p_event_type in (
      'copy_attempt', 'paste_attempt', 'context_menu_attempt',
      'sync_failed', 'second_session_attempt'
    ) then 'warning'
    else 'info'
  end;
  v_summary := case v_category
    when 'network' then 'Connectivity or answer-sync signal reported.'
    when 'session' then 'Examination-session signal reported.'
    else 'Browser attention signal reported.'
  end;
  v_details := coalesce(p_details, '{}'::jsonb) || jsonb_build_object(
    'clientOccurredAt', p_client_occurred_at
  );
  return public.exam_room_append_incident_v2(
    v_attempt.id, p_student_user_id, v_session.id, v_session.epoch,
    p_client_event_id, p_event_type, v_category, v_severity,
    v_summary, v_details
  ) || jsonb_build_object(
    'ignored', false,
    'recorded', true,
    'integrityMode', v_integrity_mode
  );
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
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_category text;
  v_severity text;
begin
  if p_event_type not in (
    'fullscreen_exit', 'visibility_exit', 'focus_exit', 'copy_attempt',
    'paste_attempt', 'context_menu_attempt', 'heartbeat_gap', 'network_gap'
  ) then raise exception 'EXAM_ROOM_INTEGRITY_EVENT_INVALID'; end if;
  select * into v_attempt from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id and a.student_user_id = p_student_user_id;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.publication_id is not null then
    return jsonb_build_object('ok', false, 'code', 'EXAM_ROOM_V2_SESSION_REQUIRED');
  end if;
  if v_attempt.status <> 'in_progress' then
    return jsonb_build_object('ok', false, 'code', 'ATTEMPT_CLOSED', 'status', v_attempt.status);
  end if;
  v_category := case
    when p_event_type in ('heartbeat_gap', 'network_gap') then 'network'
    else 'attention'
  end;
  -- A single focus/visibility/fullscreen signal is informational. Repetition is
  -- grouped for human review; it is never treated as proof of misconduct.
  v_severity := case
    when p_event_type in ('copy_attempt', 'paste_attempt', 'context_menu_attempt') then 'warning'
    else 'info'
  end;
  return public.exam_room_append_incident_v2(
    v_attempt.id, p_student_user_id, null, null, null,
    p_event_type, v_category, v_severity,
    case p_event_type
      when 'network_gap' then 'Connectivity interruption reported.'
      when 'heartbeat_gap' then 'Heartbeat interruption reported.'
      else 'Browser attention signal reported.'
    end,
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

create or replace function public.exam_room_record_technical_incident_v2(
  p_student_user_id uuid,
  p_attempt_public_id uuid,
  p_session_public_id uuid,
  p_session_epoch integer,
  p_client_event_id uuid,
  p_event_type text,
  p_details jsonb,
  p_client_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_session public.exam_room_sessions%rowtype;
  v_stored_type text;
  v_category text;
  v_severity text;
  v_summary text;
  v_details jsonb;
begin
  if p_client_event_id is null
    or p_event_type not in (
      'connectivity_lost', 'connectivity_restored', 'sync_problem',
      'device_problem', 'browser_problem', 'session_conflict',
      'support_requested', 'other'
    )
    or p_client_occurred_at is null
    or p_client_occurred_at > now() + interval '1 day'
    or p_client_occurred_at < now() - interval '30 days'
  then raise exception 'EXAM_ROOM_TECHNICAL_INCIDENT_INVALID'; end if;
  select * into v_attempt from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id and a.student_user_id = p_student_user_id;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  v_session := public.exam_room_assert_session_v2(
    p_student_user_id, v_attempt.id, p_session_public_id, p_session_epoch
  );
  v_stored_type := case p_event_type
    when 'connectivity_lost' then 'network_gap'
    when 'connectivity_restored' then 'sync_recovered'
    when 'session_conflict' then 'multi_tab_detected'
    else 'technical_error'
  end;
  v_category := case
    when p_event_type in ('connectivity_lost', 'connectivity_restored') then 'network'
    when p_event_type = 'session_conflict' then 'session'
    else 'technical'
  end;
  v_severity := case
    when p_event_type in ('connectivity_lost', 'sync_problem', 'device_problem', 'browser_problem', 'session_conflict') then 'warning'
    else 'info'
  end;
  v_summary := case p_event_type
    when 'connectivity_lost' then 'Connectivity interruption reported.'
    when 'connectivity_restored' then 'Connectivity recovery reported.'
    when 'session_conflict' then 'Concurrent-session signal reported.'
    when 'support_requested' then 'Candidate requested technical support.'
    else 'Technical issue reported.'
  end;
  v_details := coalesce(p_details, '{}'::jsonb) || jsonb_build_object(
    'clientOccurredAt', p_client_occurred_at, 'reportedType', p_event_type
  );
  return public.exam_room_append_incident_v2(
    v_attempt.id, p_student_user_id, v_session.id, p_session_epoch,
    p_client_event_id, v_stored_type, v_category, v_severity,
    v_summary, v_details
  );
end;
$$;

-- Recoverable scheduling: before publication and before any attempt, a
-- professor may safely rotate leaked/lost credentials by scheduling again.
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
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_unlock_hash text;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam from public.exam_room_exams e
  where e.public_id = p_exam_public_id and e.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.status not in ('confirmed', 'scheduled')
    or v_exam.active_question_version_id is null
    or v_exam.current_publication_id is not null
    or exists (select 1 from public.exam_room_attempts a where a.exam_id = v_exam.id)
  then raise exception 'EXAM_ROOM_EXAM_NOT_SCHEDULABLE'; end if;
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
  v_unlock_hash := encode(extensions.digest(
    pg_catalog.convert_to(p_grading_key_hash || ':attempt_unlock', 'UTF8'), 'sha256'
  ), 'hex');
  update public.exam_room_credentials
  set status = 'revoked', revoked_by = p_professor_user_id,
      revoked_at = now(), revoke_reason = 'Replaced during pre-publication scheduling.'
  where exam_id = v_exam.id and status = 'active'
    and credential_type in ('student_exam', 'professor_grading', 'attempt_unlock');
  update public.exam_room_exams
  set opens_at = p_opens_at,
      hard_closes_at = p_hard_closes_at,
      duration_minutes = p_duration_minutes,
      status = 'scheduled',
      updated_at = now()
  where id = v_exam.id;
  insert into public.exam_room_credentials (
    exam_id, credential_type, token_hash, scoped_user_id, status,
    valid_from, expires_at, created_by
  ) values
    (v_exam.id, 'student_exam', p_student_key_hash, null, 'active', p_opens_at, p_hard_closes_at, p_professor_user_id),
    (v_exam.id, 'professor_grading', p_grading_key_hash, p_professor_user_id, 'active', p_hard_closes_at, p_hard_closes_at + interval '180 days', p_professor_user_id),
    (v_exam.id, 'attempt_unlock', v_unlock_hash, p_professor_user_id, 'active', p_opens_at, p_hard_closes_at, p_professor_user_id);
  insert into public.exam_room_audit_log (
    actor_user_id, exam_id, classroom_id, action, metadata
  ) values (
    p_professor_user_id, v_exam.id, v_exam.classroom_id, 'exam_scheduled',
    jsonb_build_object(
      'opensAt', p_opens_at, 'hardClosesAt', p_hard_closes_at,
      'durationMinutes', p_duration_minutes, 'credentialRotation', v_exam.status = 'scheduled'
    )
  );
  perform public.exam_room_append_audit_v2(
    p_professor_user_id, v_exam.id, null, 'exam', v_exam.id,
    case when v_exam.status = 'scheduled' then 'exam_rescheduled' else 'exam_scheduled' end,
    null, jsonb_build_object('opensAt', p_opens_at, 'hardClosesAt', p_hard_closes_at)
  );
  return jsonb_build_object(
    'ok', true, 'examId', v_exam.public_id, 'status', 'scheduled',
    'opensAt', p_opens_at, 'hardClosesAt', p_hard_closes_at,
    'credentialsRotated', v_exam.status = 'scheduled'
  );
end;
$$;

-- Legacy mutation RPCs remain available only for attempts that genuinely
-- predate publication/session epochs. V2 attempts must use device-bound RPCs.
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
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_exam public.exam_room_exams%rowtype;
  v_credential jsonb;
  v_unlock_hash text;
begin
  if char_length(btrim(p_reason)) not between 5 and 1000 then
    raise exception 'EXAM_ROOM_REASON_REQUIRED';
  end if;
  select * into v_attempt from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id
  for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.publication_id is not null then
    return jsonb_build_object('ok', false, 'code', 'EXAM_ROOM_V2_SESSION_REQUIRED');
  end if;
  select * into v_exam from public.exam_room_exams e
  where e.id = v_attempt.exam_id and e.owner_professor_id = p_actor_user_id;
  if not found then raise exception 'EXAM_ROOM_PROFESSOR_REQUIRED'; end if;
  if v_exam.status = 'sealed' then raise exception 'EXAM_ROOM_SEALED'; end if;
  if p_grading_key_hash !~ '^[0-9a-f]{64}$' or p_rate_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'EXAM_ROOM_CREDENTIAL_INPUT_INVALID';
  end if;
  v_unlock_hash := encode(extensions.digest(
    pg_catalog.convert_to(p_grading_key_hash || ':attempt_unlock', 'UTF8'), 'sha256'
  ), 'hex');
  v_credential := public.exam_room_check_credential(
    p_actor_user_id, v_exam.id, 'attempt_unlock', v_unlock_hash, p_rate_key_hash
  );
  if not coalesce((v_credential ->> 'ok')::boolean, false) then return v_credential; end if;
  if v_attempt.status <> 'locked' then
    return jsonb_build_object('ok', true, 'status', v_attempt.status);
  end if;
  if now() >= v_attempt.server_deadline then
    return public.exam_room_submit_attempt_internal(v_attempt.id, true, 'deadline-auto-submit');
  end if;
  update public.exam_room_attempts a
  set status = 'in_progress', locked_at = null, lock_reason = null, updated_at = now()
  where a.id = v_attempt.id;
  insert into public.exam_room_integrity_events (
    exam_id, attempt_id, student_user_id, event_type, details
  ) values (
    v_exam.id, v_attempt.id, v_attempt.student_user_id, 'unlock',
    jsonb_build_object('reason', p_reason)
  );
  insert into public.exam_room_audit_log (
    actor_user_id, exam_id, classroom_id, attempt_id, action, reason
  ) values (
    p_actor_user_id, v_exam.id, v_exam.classroom_id,
    v_attempt.id, 'attempt_unlocked', p_reason
  );
  return jsonb_build_object('ok', true, 'status', 'in_progress');
end;
$$;

create or replace function public.exam_room_heartbeat(
  p_student_user_id uuid,
  p_attempt_public_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
begin
  select * into v_attempt from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id and a.student_user_id = p_student_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.publication_id is not null then
    return jsonb_build_object('ok', false, 'code', 'EXAM_ROOM_V2_SESSION_REQUIRED');
  end if;
  if v_attempt.status in ('submitted', 'auto_submitted', 'sealed') then
    return jsonb_build_object('ok', false, 'code', 'ATTEMPT_CLOSED', 'status', v_attempt.status);
  end if;
  if now() >= v_attempt.server_deadline then
    return public.exam_room_submit_attempt_internal(v_attempt.id, true, 'deadline-auto-submit');
  end if;
  update public.exam_room_attempts a
  set last_heartbeat_at = now(), updated_at = now()
  where a.id = v_attempt.id;
  return jsonb_build_object(
    'ok', true, 'serverNow', now(),
    'serverDeadline', v_attempt.server_deadline, 'status', v_attempt.status
  );
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
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_answer public.exam_room_answers%rowtype;
begin
  if char_length(coalesce(p_answer_text, '')) > 20000 then raise exception 'EXAM_ROOM_ANSWER_TOO_LONG'; end if;
  if p_expected_revision is null or p_expected_revision < 0 then raise exception 'EXAM_ROOM_REVISION_INVALID'; end if;
  select * into v_attempt from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id and a.student_user_id = p_student_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.publication_id is not null then
    return jsonb_build_object('ok', false, 'code', 'EXAM_ROOM_V2_SESSION_REQUIRED');
  end if;
  if v_attempt.status <> 'in_progress' then
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
  select * into v_answer from public.exam_room_answers a
  where a.attempt_id = v_attempt.id and a.question_id = p_question_id
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

create or replace function public.exam_room_submit_attempt(
  p_student_user_id uuid,
  p_attempt_public_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
begin
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then raise exception 'EXAM_ROOM_REQUEST_KEY_INVALID'; end if;
  select * into v_attempt from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id and a.student_user_id = p_student_user_id;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.publication_id is not null then
    return jsonb_build_object('ok', false, 'code', 'EXAM_ROOM_V2_SESSION_REQUIRED');
  end if;
  if v_attempt.status = 'locked' then return jsonb_build_object('ok', false, 'code', 'ATTEMPT_LOCKED'); end if;
  return public.exam_room_submit_attempt_internal(v_attempt.id, false, p_request_key);
end;
$$;

-- ---------------------------------------------------------------------------
-- Candidate-specific close, grace, grading, and accommodation seal guards
-- ---------------------------------------------------------------------------

-- Accommodation rows are operational evidence. They may be amended only while
-- an exam can still lawfully change, and they may never be deleted. This guard
-- also protects against an accidental direct service-role table mutation after
-- the higher-level command has been closed or the evidence has been sealed.
create or replace function public.exam_room_guard_accommodation_state_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_exam_id uuid;
  v_roster_id uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'EXAM_ROOM_ACCOMMODATION_EVIDENCE_DELETE_FORBIDDEN';
  end if;
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.exam_id is distinct from old.exam_id
    or new.roster_id is distinct from old.roster_id
  ) then
    raise exception 'EXAM_ROOM_ACCOMMODATION_IDENTITY_IMMUTABLE';
  end if;
  v_exam_id := new.exam_id;
  v_roster_id := new.roster_id;
  select * into v_exam from public.exam_room_exams e where e.id = v_exam_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.status = 'sealed' or v_exam.release_id is not null then
    raise exception 'EXAM_ROOM_SEALED';
  end if;
  if v_exam.status not in ('draft', 'confirmed', 'scheduled', 'open') then
    raise exception 'EXAM_ROOM_ACCOMMODATION_STATE_CLOSED';
  end if;
  if exists (
    select 1 from public.exam_room_attempts a
    where a.exam_id = v_exam_id
      and a.roster_id = v_roster_id
      and a.status in ('submitted', 'auto_submitted', 'sealed')
  ) then
    raise exception 'EXAM_ROOM_ACCOMMODATION_ATTEMPT_CLOSED';
  end if;
  return new;
end;
$$;

drop trigger if exists exam_room_accommodation_state_guard_v2
  on public.exam_room_accommodations;
create trigger exam_room_accommodation_state_guard_v2
before insert or update or delete on public.exam_room_accommodations
for each row execute function public.exam_room_guard_accommodation_state_v2();

-- A v2 exam becomes gradeable only after all candidate-specific windows and
-- each attempt's frozen publication grace have elapsed, and every attempt is
-- terminal. The helper is read-only/stable; callers perform auto-submission
-- first and then use this result as the common fail-closed decision.
create or replace function public.exam_room_grading_readiness_v2(p_exam_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_publication public.exam_room_publications%rowtype;
  v_grace_minutes integer;
  v_base_wait_until timestamptz;
  v_candidate_wait_until timestamptz;
  v_attempt_wait_until timestamptz;
  v_wait_until timestamptz;
  v_relevant_candidates integer := 0;
  v_attempt_count integer := 0;
  v_nonterminal_attempts integer := 0;
begin
  select * into v_exam from public.exam_room_exams e where e.id = p_exam_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.current_publication_id is null then
    raise exception 'EXAM_ROOM_PUBLICATION_REQUIRED';
  end if;
  select * into v_publication from public.exam_room_publications p
  where p.id = v_exam.current_publication_id and p.exam_id = v_exam.id;
  if not found then raise exception 'EXAM_ROOM_PUBLICATION_REQUIRED'; end if;
  v_grace_minutes :=
    (v_publication.rules_snapshot ->> 'submissionGraceMinutes')::integer;
  if v_grace_minutes is null
    or v_grace_minutes not between 0 and 120
    or v_exam.hard_closes_at is null
  then
    raise exception 'EXAM_ROOM_PUBLICATION_RULES_INVALID';
  end if;
  v_base_wait_until := v_exam.hard_closes_at
    + make_interval(mins => v_grace_minutes);

  select count(*)::integer,
    max(
      coalesce(
        nullif(ac.configuration ->> 'individualHardClosesAt', '')::timestamptz,
        v_exam.hard_closes_at
      ) + make_interval(mins =>
        coalesce((ac.configuration ->> 'extraMinutes')::integer, 0)
        + coalesce((ac.configuration ->> 'incidentExtensionMinutes')::integer, 0)
        + v_grace_minutes
      )
    )
  into v_relevant_candidates, v_candidate_wait_until
  from public.exam_room_roster r
  left join public.exam_room_admissions ad
    on ad.exam_id = v_exam.id and ad.roster_id = r.id
  left join public.exam_room_accommodations ac
    on ac.exam_id = v_exam.id and ac.roster_id = r.id and ac.status = 'active'
  where r.classroom_id = v_exam.classroom_id
    and r.status = 'active'
    and coalesce(ad.status, 'eligible') not in ('denied', 'withdrawn', 'no_show');

  select count(*)::integer,
    count(*) filter (
      where a.status not in ('submitted', 'auto_submitted', 'sealed')
    )::integer,
    max(
      a.server_deadline + make_interval(mins => coalesce(
        (ap.rules_snapshot ->> 'submissionGraceMinutes')::integer,
        v_grace_minutes
      ))
    )
  into v_attempt_count, v_nonterminal_attempts, v_attempt_wait_until
  from public.exam_room_attempts a
  left join public.exam_room_publications ap on ap.id = a.publication_id
  where a.exam_id = v_exam.id;

  v_wait_until := greatest(
    v_base_wait_until,
    coalesce(v_candidate_wait_until, v_base_wait_until),
    coalesce(v_attempt_wait_until, v_base_wait_until)
  );
  return jsonb_build_object(
    'ready', now() >= v_wait_until and v_nonterminal_attempts = 0,
    'waitUntil', v_wait_until,
    'submissionGraceMinutes', v_grace_minutes,
    'relevantCandidateCount', v_relevant_candidates,
    'attemptCount', v_attempt_count,
    'nonTerminalAttemptCount', v_nonterminal_attempts,
    'serverNow', now()
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'EXAM_ROOM_PUBLICATION_RULES_INVALID';
end;
$$;

-- Defense in depth for service-side table mistakes: v2 grades and state
-- transitions cannot bypass the same readiness decision used by the RPCs.
create or replace function public.exam_room_guard_grade_write_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_exam public.exam_room_exams%rowtype;
  v_readiness jsonb;
begin
  if tg_op = 'UPDATE' and (
    new.attempt_id is distinct from old.attempt_id
    or new.question_id is distinct from old.question_id
  ) then raise exception 'EXAM_ROOM_GRADE_IDENTITY_IMMUTABLE'; end if;
  if tg_op = 'DELETE' then
    select * into v_attempt from public.exam_room_attempts a
    where a.id = old.attempt_id;
  else
    select * into v_attempt from public.exam_room_attempts a
    where a.id = new.attempt_id;
  end if;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  select * into v_exam from public.exam_room_exams e
  where e.id = v_attempt.exam_id;
  if v_exam.current_publication_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if v_exam.status = 'sealed' or v_exam.release_id is not null then
    raise exception 'EXAM_ROOM_SEALED';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'EXAM_ROOM_GRADE_EVIDENCE_DELETE_FORBIDDEN';
  end if;
  v_readiness := public.exam_room_grading_readiness_v2(v_exam.id);
  if not (v_readiness ->> 'ready')::boolean
    or v_attempt.status not in ('submitted', 'auto_submitted', 'sealed')
  then raise exception 'EXAM_ROOM_GRADING_NOT_OPEN'; end if;
  return new;
end;
$$;

drop trigger if exists exam_room_grade_write_guard_v2
  on public.exam_room_grades;
create trigger exam_room_grade_write_guard_v2
before insert or update or delete on public.exam_room_grades
for each row execute function public.exam_room_guard_grade_write_v2();

create or replace function public.exam_room_guard_attempt_terminal_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('submitted', 'auto_submitted')
    and new.status = 'in_progress'
    and (
      coalesce(current_setting('app.exam_room_reopen_attempt', true), '') <> old.id::text
      or new.server_deadline <= old.server_deadline
    )
  then raise exception 'EXAM_ROOM_REOPEN_AUTHORIZATION_REQUIRED'; end if;
  if old.publication_id is not null
    and new.publication_id is distinct from old.publication_id
  then raise exception 'EXAM_ROOM_ATTEMPT_PUBLICATION_IMMUTABLE'; end if;
  if old.publication_id is not null
    and old.status in ('in_progress', 'locked')
    and new.server_deadline < old.server_deadline
  then raise exception 'EXAM_ROOM_ATTEMPT_DEADLINE_REDUCTION_FORBIDDEN'; end if;
  if new.publication_id is not null
    and new.status = 'sealed'
    and old.status not in ('submitted', 'auto_submitted', 'sealed')
  then raise exception 'EXAM_ROOM_ACTIVE_ATTEMPT_CANNOT_BE_SEALED'; end if;
  return new;
end;
$$;

drop trigger if exists exam_room_attempt_terminal_guard_v2
  on public.exam_room_attempts;
create trigger exam_room_attempt_terminal_guard_v2
before update of status, publication_id, server_deadline on public.exam_room_attempts
for each row execute function public.exam_room_guard_attempt_terminal_v2();

create or replace function public.exam_room_guard_exam_grading_state_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_readiness jsonb;
begin
  if new.current_publication_id is null then return new; end if;
  if new.release_id is not null and new.status <> 'sealed' then
    raise exception 'EXAM_ROOM_RELEASE_REQUIRES_SEAL';
  end if;
  if new.status = 'sealed'
    and (new.release_id is null or new.sealed_at is null)
  then raise exception 'EXAM_ROOM_SEAL_REQUIRES_RELEASE'; end if;
  if new.status not in ('grading', 'sealed')
    or (
      new.status is not distinct from old.status
      and new.release_id is not distinct from old.release_id
    )
  then return new; end if;
  v_readiness := public.exam_room_grading_readiness_v2(new.id);
  if not (v_readiness ->> 'ready')::boolean then
    raise exception 'EXAM_ROOM_GRADING_NOT_OPEN';
  end if;
  if new.status = 'sealed' and exists (
    select 1 from public.exam_room_attempts a
    where a.exam_id = new.id
      and a.status not in ('submitted', 'auto_submitted', 'sealed')
  ) then raise exception 'EXAM_ROOM_ACTIVE_ATTEMPT_CANNOT_BE_SEALED'; end if;
  return new;
end;
$$;

drop trigger if exists exam_room_grading_state_guard_v2
  on public.exam_room_exams;
create trigger exam_room_grading_state_guard_v2
before update of status, release_id on public.exam_room_exams
for each row execute function public.exam_room_guard_exam_grading_state_v2();

-- Legacy attempts remain due at server_deadline. Published v2 attempts remain
-- open through their frozen submission grace, then commit through the immutable
-- v2 snapshot-and-receipt path. A v2 exam itself cannot close before the shared
-- readiness helper says all relevant candidate windows and attempts are done.
create or replace function public.exam_room_auto_submit_due(p_exam_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam_id uuid;
  v_exam public.exam_room_exams%rowtype;
  v_attempt record;
  v_count integer := 0;
  v_closed_count integer := 0;
begin
  -- Lock one exam at a time, in UUID order, before locking its attempts. The
  -- accommodation and release commands use the same exam-then-attempt order.
  for v_exam_id in
    select e.id from public.exam_room_exams e
    where (p_exam_id is null or e.id = p_exam_id)
      and (
        e.status in ('scheduled', 'open')
        or exists (
          select 1 from public.exam_room_attempts pending
          where pending.exam_id = e.id
            and pending.status in ('in_progress', 'locked')
        )
      )
    order by e.id
  loop
    select * into v_exam from public.exam_room_exams e
    where e.id = v_exam_id for update;
    for v_attempt in
      select a.id, a.publication_id
      from public.exam_room_attempts a
      left join public.exam_room_publications p on p.id = a.publication_id
      where a.exam_id = v_exam.id
        and a.status in ('in_progress', 'locked')
        and (
          (a.publication_id is null and a.server_deadline <= now())
          or (
            a.publication_id is not null
            and a.server_deadline + make_interval(mins =>
              (p.rules_snapshot ->> 'submissionGraceMinutes')::integer
            ) <= now()
          )
        )
      for update of a skip locked
    loop
      if v_attempt.publication_id is null then
        perform public.exam_room_submit_attempt_internal(
          v_attempt.id, true, 'deadline-auto-submit'
        );
      else
        perform public.exam_room_commit_submission_v2(
          v_attempt.id, true, 'deadline-auto-submit',
          null, null, null, '{}'::jsonb
        );
      end if;
      v_count := v_count + 1;
    end loop;

    -- Genuine legacy exams keep their original hard-close transition.
    if v_exam.current_publication_id is null
      and v_exam.status in ('scheduled', 'open')
      and v_exam.hard_closes_at <= now()
    then
      update public.exam_room_exams
      set status = 'closed', updated_at = now()
      where id = v_exam.id;
      v_closed_count := v_closed_count + 1;
    elsif v_exam.current_publication_id is not null
      and v_exam.status in ('scheduled', 'open')
      and (
        public.exam_room_grading_readiness_v2(v_exam.id) ->> 'ready'
      )::boolean
    then
      update public.exam_room_exams
      set status = 'closed', updated_at = now()
      where id = v_exam.id;
      v_closed_count := v_closed_count + 1;
    end if;
  end loop;
  return jsonb_build_object(
    'autoSubmitted', v_count,
    'closedExams', v_closed_count
  );
end;
$$;

create or replace function public.exam_room_grading_workspace(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_grading_key_hash text,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_credential jsonb;
  v_candidates jsonb;
  v_readiness jsonb;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam from public.exam_room_exams e
  where e.public_id = p_exam_public_id
    and e.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;

  if v_exam.current_publication_id is null then
    if now() < v_exam.hard_closes_at then
      return jsonb_build_object('ok', false, 'code', 'GRADING_NOT_OPEN');
    end if;
    perform public.exam_room_auto_submit_due(v_exam.id);
  else
    perform public.exam_room_auto_submit_due(v_exam.id);
    v_readiness := public.exam_room_grading_readiness_v2(v_exam.id);
    if not (v_readiness ->> 'ready')::boolean then
      return jsonb_build_object(
        'ok', false,
        'code', 'GRADING_NOT_OPEN',
        'readyAt', v_readiness -> 'waitUntil',
        'nonTerminalAttemptCount', v_readiness -> 'nonTerminalAttemptCount'
      );
    end if;
    if exists (
      select 1 from public.exam_room_attempts a
      where a.exam_id = v_exam.id
        and a.status not in ('submitted', 'auto_submitted', 'sealed')
    ) then
      return jsonb_build_object('ok', false, 'code', 'GRADING_NOT_OPEN');
    end if;
  end if;

  v_credential := public.exam_room_check_credential(
    p_professor_user_id, v_exam.id, 'professor_grading',
    p_grading_key_hash, p_rate_key_hash
  );
  if not (v_credential ->> 'ok')::boolean then return v_credential; end if;
  update public.exam_room_exams
  set status = 'grading', updated_at = now()
  where id = v_exam.id and status <> 'sealed';

  select coalesce(jsonb_agg(candidate_data order by candidate_number), '[]'::jsonb)
  into v_candidates
  from (
    select a.candidate_number,
      jsonb_build_object(
        'attemptId', a.public_id,
        'candidateNumber', a.candidate_number,
        'status', a.status,
        'submittedAt', a.submitted_at,
        'incidentCount', (
          select count(*) from public.exam_room_integrity_events ie
          where ie.attempt_id = a.id
        ),
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
          left join public.exam_room_answers ans
            on ans.attempt_id = a.id and ans.question_id = q.id
          left join public.exam_room_grades g
            on g.attempt_id = a.id and g.question_id = q.id
          where q.question_version_id = a.question_version_id
        )
      ) candidate_data
    from public.exam_room_attempts a
    where a.exam_id = v_exam.id
      and (
        v_exam.current_publication_id is null
        or a.status in ('submitted', 'auto_submitted', 'sealed')
      )
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
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_attempt public.exam_room_attempts%rowtype;
  v_question public.exam_room_questions%rowtype;
  v_grade public.exam_room_grades%rowtype;
  v_credential jsonb;
  v_readiness jsonb;
  v_revision integer;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam from public.exam_room_exams e
  where e.public_id = p_exam_public_id
    and e.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.status = 'sealed' or v_exam.release_id is not null then
    raise exception 'EXAM_ROOM_SEALED';
  end if;
  if v_exam.current_publication_id is null then
    if now() < v_exam.hard_closes_at then
      raise exception 'EXAM_ROOM_GRADING_NOT_OPEN';
    end if;
  else
    perform public.exam_room_auto_submit_due(v_exam.id);
    v_readiness := public.exam_room_grading_readiness_v2(v_exam.id);
    if not (v_readiness ->> 'ready')::boolean then
      raise exception 'EXAM_ROOM_GRADING_NOT_OPEN';
    end if;
  end if;
  if char_length(coalesce(p_comment, '')) > 5000
    or p_grade_state not in ('draft', 'final')
    or p_expected_revision is null or p_expected_revision < 0
    or char_length(btrim(p_change_reason)) not between 5 and 1000
  then raise exception 'EXAM_ROOM_GRADE_INVALID'; end if;
  v_credential := public.exam_room_check_credential(
    p_professor_user_id, v_exam.id, 'professor_grading',
    p_grading_key_hash, p_rate_key_hash
  );
  if not (v_credential ->> 'ok')::boolean then return v_credential; end if;
  select * into v_attempt from public.exam_room_attempts a
  where a.public_id = p_attempt_public_id and a.exam_id = v_exam.id
  for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if v_exam.current_publication_id is not null
    and v_attempt.status not in ('submitted', 'auto_submitted', 'sealed')
  then raise exception 'EXAM_ROOM_GRADING_NOT_OPEN'; end if;
  select * into v_question from public.exam_room_questions q
  where q.id = p_question_id
    and q.question_version_id = v_attempt.question_version_id;
  if not found then raise exception 'EXAM_ROOM_QUESTION_NOT_FOUND'; end if;
  if p_score < 0 or p_score > v_question.maximum_points then
    raise exception 'EXAM_ROOM_SCORE_INVALID';
  end if;

  select * into v_grade from public.exam_room_grades g
  where g.attempt_id = v_attempt.id and g.question_id = p_question_id
  for update;
  if found and v_grade.revision <> p_expected_revision then
    return jsonb_build_object(
      'ok', false, 'code', 'GRADE_CONFLICT', 'revision', v_grade.revision
    );
  end if;
  if not found and p_expected_revision <> 0 then
    return jsonb_build_object(
      'ok', false, 'code', 'GRADE_CONFLICT', 'revision', 0
    );
  end if;
  v_revision := case when found then v_grade.revision + 1 else 1 end;
  insert into public.exam_room_grades (
    attempt_id, question_id, score, maximum_points, professor_comment,
    grade_state, revision, graded_by, graded_at, finalized_at
  ) values (
    v_attempt.id, p_question_id, p_score, v_question.maximum_points,
    coalesce(p_comment, ''), p_grade_state, v_revision,
    p_professor_user_id, now(),
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
    v_attempt.id, p_question_id, v_revision, p_score,
    v_question.maximum_points, coalesce(p_comment, ''),
    p_grade_state, p_professor_user_id, p_change_reason
  );
  return jsonb_build_object(
    'ok', true, 'revision', v_revision,
    'gradeState', p_grade_state, 'savedAt', now()
  );
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
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_release public.exam_room_releases%rowtype;
  v_credential jsonb;
  v_readiness jsonb;
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
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'EXAM_ROOM_REQUEST_KEY_INVALID';
  end if;
  select * into v_exam from public.exam_room_exams e
  where e.public_id = p_exam_public_id
    and e.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.release_id is not null then
    select * into v_release from public.exam_room_releases r
    where r.id = v_exam.release_id;
    return jsonb_build_object(
      'ok', true, 'alreadyReleased', true,
      'releaseId', v_release.id, 'releasedAt', v_release.released_at
    );
  end if;

  if v_exam.current_publication_id is null then
    if now() < v_exam.hard_closes_at then
      raise exception 'EXAM_ROOM_RELEASE_TOO_EARLY';
    end if;
    perform public.exam_room_auto_submit_due(v_exam.id);
  else
    perform public.exam_room_auto_submit_due(v_exam.id);
    v_readiness := public.exam_room_grading_readiness_v2(v_exam.id);
    if not (v_readiness ->> 'ready')::boolean then
      raise exception 'EXAM_ROOM_RELEASE_TOO_EARLY';
    end if;
    if exists (
      select 1 from public.exam_room_attempts a
      where a.exam_id = v_exam.id
        and a.status not in ('submitted', 'auto_submitted', 'sealed')
    ) then raise exception 'EXAM_ROOM_RELEASE_TOO_EARLY'; end if;
  end if;

  v_credential := public.exam_room_check_credential(
    p_professor_user_id, v_exam.id, 'professor_grading',
    p_grading_key_hash, p_rate_key_hash
  );
  if not (v_credential ->> 'ok')::boolean then return v_credential; end if;
  if exists (
    select 1 from public.exam_room_attempts a
    join public.exam_room_questions q
      on q.question_version_id = a.question_version_id
    left join public.exam_room_grades g
      on g.attempt_id = a.id and g.question_id = q.id
    where a.exam_id = v_exam.id
      and (g.attempt_id is null or g.grade_state <> 'final')
  ) then raise exception 'EXAM_ROOM_FINAL_GRADES_REQUIRED'; end if;

  -- Recheck immediately before sealing so no non-terminal attempt can ever be
  -- transformed into sealed evidence by a broad UPDATE.
  if v_exam.current_publication_id is not null and exists (
    select 1 from public.exam_room_attempts a
    where a.exam_id = v_exam.id
      and a.status not in ('submitted', 'auto_submitted', 'sealed')
  ) then raise exception 'EXAM_ROOM_RELEASE_TOO_EARLY'; end if;

  select count(*) into v_expected from public.exam_room_roster r
  where r.classroom_id = v_exam.classroom_id and r.status = 'active';
  select count(*) into v_started from public.exam_room_attempts a
  where a.exam_id = v_exam.id;
  select count(*) into v_submitted from public.exam_room_attempts a
  where a.exam_id = v_exam.id and a.status = 'submitted';
  select count(*) into v_auto from public.exam_room_attempts a
  where a.exam_id = v_exam.id and a.status = 'auto_submitted';
  select count(*) into v_locked from public.exam_room_integrity_events i
  where i.exam_id = v_exam.id and i.event_type = 'lock';

  insert into public.exam_room_releases (
    exam_id, request_key, released_by, include_questionnaire,
    expected_count, started_count, submitted_count,
    auto_submitted_count, locked_count
  ) values (
    v_exam.id, p_request_key, p_professor_user_id,
    coalesce(p_include_questionnaire, false),
    v_expected, v_started, v_submitted, v_auto, v_locked
  ) returning * into v_release;

  if v_exam.current_publication_id is null then
    update public.exam_room_attempts
    set status = 'sealed', updated_at = now()
    where exam_id = v_exam.id;
  else
    update public.exam_room_attempts
    set status = 'sealed', updated_at = now()
    where exam_id = v_exam.id
      and status in ('submitted', 'auto_submitted', 'sealed');
  end if;
  update public.exam_room_credentials
  set status = 'revoked', revoked_by = p_professor_user_id,
      revoked_at = now(), revoke_reason = 'Exam released and sealed.'
  where exam_id = v_exam.id and status = 'active';
  update public.exam_room_exams
  set status = 'sealed', release_id = v_release.id, sealed_at = now(),
      include_questionnaire = coalesce(p_include_questionnaire, false),
      updated_at = now()
  where id = v_exam.id;

  select lower(u.email) into v_professor_email
  from auth.users u where u.id = p_professor_user_id;
  insert into public.exam_room_email_jobs (
    exam_id, release_id, recipient_user_id, recipient_email,
    email_type, payload
  ) values (
    v_exam.id, v_release.id, p_professor_user_id, v_professor_email,
    'professor_release_summary',
    jsonb_build_object(
      'examId', v_exam.public_id, 'title', v_exam.title,
      'expected', v_expected, 'started', v_started,
      'submitted', v_submitted, 'autoSubmitted', v_auto,
      'locked', v_locked
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
    ) order by q.ordinal), '[]'::jsonb)
    into v_questions
    from public.exam_room_questions q
    where q.question_version_id = v_attempt.question_version_id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'questionId', g.question_id,
      'score', g.score,
      'maximumPoints', g.maximum_points,
      'comment', g.professor_comment
    ) order by q.ordinal), '[]'::jsonb)
    into v_grades
    from public.exam_room_grades g
    join public.exam_room_questions q on q.id = g.question_id
    where g.attempt_id = v_attempt.id;
    insert into public.exam_room_email_jobs (
      exam_id, release_id, recipient_user_id, recipient_email,
      email_type, payload
    ) values (
      v_exam.id, v_release.id, v_attempt.student_user_id,
      v_attempt.recipient_email, 'student_result',
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
        'expected', v_expected, 'started', v_started,
        'submitted', v_submitted, 'autoSubmitted', v_auto,
        'locked', v_locked
      ),
      'grades', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'attemptId', a.public_id,
          'candidateNumber', a.candidate_number,
          'questionId', g.question_id,
          'score', g.score,
          'maximumPoints', g.maximum_points,
          'comment', g.professor_comment,
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
    p_professor_user_id, v_exam.id, v_exam.classroom_id,
    'results_released_and_sealed',
    jsonb_build_object(
      'releaseId', v_release.id,
      'includeQuestionnaire', p_include_questionnaire
    )
  );
  return jsonb_build_object(
    'ok', true, 'releaseId', v_release.id,
    'releasedAt', v_release.released_at, 'sealed', true
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Supporting constraints, private storage, and least privilege
-- ---------------------------------------------------------------------------

alter table public.exam_room_exams
  drop constraint if exists exam_room_exams_beta_question_count_check;
alter table public.exam_room_exams
  add constraint exam_room_exams_beta_question_count_check
  check (requested_question_count between 1 and 200) not valid;

alter table public.exam_room_question_versions
  drop constraint if exists exam_room_question_versions_beta_count_check;
alter table public.exam_room_question_versions
  add constraint exam_room_question_versions_beta_count_check
  check (question_count between 1 and 200) not valid;

-- Preserve the confirmation implementation from 029 while aligning it with
-- the v2 content-addressed private-storage contract. Each exact replacement
-- is asserted so upstream drift fails closed instead of weakening validation.
do $exam_room_confirm_questions_contract$
declare
  v_definition text;
  v_updated text;
  v_previous text;
  v_old_mime text := 'p_mime_type not in (''text/plain'', ''application/vnd.openxmlformats-officedocument.wordprocessingml.document'')';
  v_new_mime text := 'p_mime_type not in (''text/plain'', ''application/pdf'', ''application/vnd.openxmlformats-officedocument.wordprocessingml.document'')';
  v_old_path text := $old_path$p_object_path !~ (
      '^' || p_professor_user_id::text || '/' || v_exam.public_id::text
      || '/[0-9a-f]{64}-[A-Za-z0-9_.-]+$'
    )$old_path$;
  v_new_path text := $new_path$p_object_path <> (
      v_exam.id::text || '/' || p_content_hash || '/' || p_safe_file_name
    )
    or p_safe_file_name !~ '^[A-Za-z0-9_.-]+$'$new_path$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.exam_room_confirm_questions(uuid,uuid,text,text,text,integer,integer,text,jsonb,jsonb)'::regprocedure
  ) into v_definition;
  if v_definition is null then
    raise exception 'EXAM_ROOM_CONFIRM_QUESTIONS_DEFINITION_MISSING';
  end if;

  v_updated := replace(v_definition, v_old_mime, v_new_mime);
  if v_updated = v_definition then
    raise exception 'EXAM_ROOM_CONFIRM_QUESTIONS_MIME_DRIFT';
  end if;
  v_previous := v_updated;
  v_updated := replace(v_updated, v_old_path, v_new_path);
  if v_updated = v_previous then
    raise exception 'EXAM_ROOM_CONFIRM_QUESTIONS_PATH_DRIFT';
  end if;
  v_previous := v_updated;
  v_updated := replace(v_updated, 'digest(', 'extensions.digest(');
  if v_updated = v_previous then
    raise exception 'EXAM_ROOM_CONFIRM_QUESTIONS_DIGEST_DRIFT';
  end if;
  execute v_updated;
end;
$exam_room_confirm_questions_contract$;

alter function public.exam_room_confirm_questions(
  uuid, uuid, text, text, text, integer, integer, text, jsonb, jsonb
) set search_path = '';

-- Keep the legacy Professor import compatible with optional display names as
-- well; the exam-scoped v2 import/upsert functions use the same NULL shape.
do $exam_room_optional_roster_name$
declare
  v_definition text;
  v_updated text;
  v_previous text;
  v_old text := 'btrim(v_row ->> ''displayName'')';
  v_new text := 'nullif(btrim(v_row ->> ''displayName''), '''')';
  v_old_authority text := 'and (owner_professor_id = p_professor_user_id or public.exam_room_is_admin(p_professor_user_id))';
  v_new_authority text := 'and owner_professor_id = p_professor_user_id';
begin
  select pg_catalog.pg_get_functiondef(
    'public.exam_room_import_roster(uuid,uuid,jsonb,text,text)'::regprocedure
  ) into v_definition;
  v_updated := replace(v_definition, v_old, v_new);
  if v_definition is null or v_updated = v_definition then
    raise exception 'EXAM_ROOM_IMPORT_ROSTER_DISPLAY_NAME_DRIFT';
  end if;
  v_previous := v_updated;
  v_updated := replace(v_updated, v_old_authority, v_new_authority);
  if v_updated = v_previous then
    raise exception 'EXAM_ROOM_IMPORT_ROSTER_AUTHORITY_DRIFT';
  end if;
  execute v_updated;
end;
$exam_room_optional_roster_name$;

alter function public.exam_room_import_roster(uuid, uuid, jsonb, text, text)
  set search_path = '';

-- The founder Admin dashboard is metadata-only, but the inherited snapshot
-- accidentally left a pure Admin's class list empty. Permit the existing safe
-- class/exam summary projection without granting any operational capability,
-- candidate answers, credentials, or keys.
do $exam_room_admin_metadata_snapshot$
declare
  v_definition text;
  v_updated text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.exam_room_portal_snapshot(uuid)'::regprocedure
  ) into v_definition;
  v_updated := replace(
    v_definition,
    'if v_is_professor then',
    'if v_is_professor or v_is_admin then'
  );
  if v_definition is null or v_updated = v_definition then
    raise exception 'EXAM_ROOM_ADMIN_METADATA_SNAPSHOT_DRIFT';
  end if;
  execute v_updated;
end;
$exam_room_admin_metadata_snapshot$;

alter function public.exam_room_portal_snapshot(uuid)
  set search_path = '';

alter table public.exam_room_backup_outbox
  drop constraint if exists exam_room_backup_outbox_event_type_check;
alter table public.exam_room_backup_outbox
  add constraint exam_room_backup_outbox_event_type_check
  check (event_type in (
    'exam_confirmed', 'roster_imported', 'attempt_submitted', 'grades_released',
    'dispute_opened', 'dispute_closed', 'admin_correction', 'exam_erratum',
    'publication_replaced', 'submission_reopened', 'admin_break_glass'
  ));

alter table public.exam_room_question_sources
  drop constraint if exists exam_room_question_sources_mime_type_check;
alter table public.exam_room_question_sources
  add constraint exam_room_question_sources_mime_type_check
  check (mime_type in (
    'text/plain',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ));

update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array[
      'text/plain',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]::text[]
where id = 'exam-room-sources';

comment on table public.exam_room_publications is
  'Immutable student-safe publication snapshot. Private model answers are stored separately.';
comment on table public.exam_room_publication_model_answers is
  'Private professor model-answer material. Never expose through student or Beadle projections.';
comment on table public.exam_room_answer_operations is
  'Append-only idempotent client operation journal with server-derived exam and version scope.';
comment on table public.exam_room_answer_conflict_branches is
  'Append-only preservation of stale answer branches; conflicts are never silently overwritten.';
comment on table public.exam_room_submission_receipts is
  'Immutable server-issued receipt for a committed answer snapshot generation.';
comment on table public.exam_room_integrity_events is
  'Limited browser/technical signals for operational review; events are not proof of misconduct.';
comment on column public.exam_room_temporary_leaves.started_at is
  'Operational leave evidence. The authoritative exam timer continues unless separately extended.';

do $$
declare
  v_table text;
  v_sequence text;
  v_function regprocedure;
begin
  for v_table in
    select t.tablename from pg_catalog.pg_tables t
    where t.schemaname = 'public' and t.tablename like 'exam_room_%'
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', v_table);
    execute format('grant select, insert, update, delete on table public.%I to service_role', v_table);
  end loop;
  for v_sequence in
    select s.sequence_name from information_schema.sequences s
    where s.sequence_schema = 'public' and s.sequence_name like 'exam_room_%'
  loop
    execute format('revoke all privileges on sequence public.%I from public, anon, authenticated', v_sequence);
    execute format('grant usage, select on sequence public.%I to service_role', v_sequence);
  end loop;
  for v_function in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'exam_room_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_function);
    execute format('grant execute on function %s to service_role', v_function);
  end loop;
end;
$$;

-- If a private beta rehearsal created an earlier overload while these
-- contracts were being tightened, do not let the generic service grant above
-- revive it. Current signatures remain service-callable; obsolete shapes are
-- explicitly dark.
do $exam_room_v2_obsolete_overloads$
declare
  v_signature text;
  v_procedure regprocedure;
begin
  foreach v_signature in array array[
    'public.exam_room_publish_exam_v2(uuid,uuid,jsonb,text)',
    'public.exam_room_replace_publication_v2(uuid,uuid,uuid,jsonb,text,text,text,text)',
    'public.exam_room_issue_admin_break_glass_v2(uuid,uuid,uuid,text,text,timestamptz,text,uuid,text)',
    'public.exam_room_issue_admin_break_glass_v2(uuid,uuid,uuid,text,text,text,timestamptz,text,uuid,text)',
    'public.exam_room_admin_break_glass_evidence_v2(uuid,uuid,uuid,text,uuid,text)',
    'public.exam_room_admin_break_glass_evidence_v2(uuid,uuid,uuid,uuid,text,text,uuid,text)',
    'public.exam_room_close_admin_break_glass_v2(uuid,uuid,text,text,uuid,text)',
    'public.exam_room_close_admin_break_glass_v2(uuid,uuid,text,text,uuid,timestamptz,text)',
    'public.exam_room_record_admin_break_glass_review_v2(uuid,uuid,text,text,text,uuid,text)',
    'public.exam_room_record_admin_break_glass_review_v2(uuid,uuid,text,text,text,uuid,timestamptz,text)'
  ]
  loop
    v_procedure := pg_catalog.to_regprocedure(v_signature);
    if v_procedure is not null then
      execute format('revoke all on function %s from public, anon, authenticated, service_role', v_procedure);
    end if;
  end loop;
end;
$exam_room_v2_obsolete_overloads$;

-- The inherited broad dispute endpoints predate the beta's candidate-scoped,
-- AAL2 break-glass requirement. Keep them installed for evidence/history
-- compatibility, but make them unreachable through the Worker service role.
-- Only the v2 candidate-scoped issue/evidence/close/post-review path above is
-- service-callable; it requires fresh supported MFA step-up, exact persisted
-- exam/attempt/candidate scope, expiry, terminal evidence, and per-read audit.
revoke execute on function public.exam_room_open_dispute(
  uuid, uuid, text, text, text, text, timestamptz
) from service_role;
revoke execute on function public.exam_room_dispute_view(
  uuid, uuid, text, text
) from service_role;
revoke execute on function public.exam_room_close_dispute(
  uuid, uuid, text
) from service_role;
revoke execute on function public.exam_room_admin_correct_grade(
  uuid, uuid, uuid, uuid, numeric, text, text, text, text
) from service_role;

commit;

begin;

-- Platform owners receive a complete, no-code examination command center.  The
-- browser still talks only to the Worker: these tables and functions remain
-- service-role-only and every entry point independently verifies the actor's
-- Founder/Super Admin role.

alter table examination_room_v1.student_identities
  alter column email_normalized drop not null;

comment on column examination_room_v1.student_identities.email_normalized is
  'Optional verified delivery address. A platform owner may explicitly clear a wrong address without weakening the institution-unique student number or real-name record.';

create table examination_room_v1.owner_key_envelopes (
  activation_id uuid primary key
    references examination_room_v1.room_activations(id) on delete restrict,
  exam_id uuid not null,
  institution_id uuid not null,
  envelope_algorithm text not null default 'aes-256-gcm-v1'
    check (envelope_algorithm = 'aes-256-gcm-v1'),
  key_version integer not null default 1 check (key_version > 0),
  ciphertext_base64 text not null check (length(ciphertext_base64) between 24 and 4096),
  iv_base64 text not null check (length(iv_base64) between 16 and 64),
  aad_sha256 text not null check (aad_sha256 ~ '^[0-9a-f]{64}$'),
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint owner_key_envelopes_exam_scope_fk
    foreign key (exam_id, institution_id)
    references examination_room_v1.exams (id, institution_id)
    on delete restrict
);

comment on table examination_room_v1.owner_key_envelopes is
  'Worker-encrypted room-key escrow. Only an authenticated Founder/Super Admin may request decryption through the Worker; the encryption key never enters Postgres or the browser.';

create table examination_room_v1.email_delivery_events (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references examination_room_v1.institutions(id) on delete restrict,
  exam_id uuid not null,
  activation_id uuid references examination_room_v1.room_activations(id) on delete restrict,
  request_hash text not null unique check (request_hash ~ '^[0-9a-f]{64}$'),
  delivery_kind text not null check (delivery_kind in ('activation_key', 'key_resend', 'key_rotation')),
  professor_recipient text not null check (
    professor_recipient = lower(btrim(professor_recipient))
    and position('@' in professor_recipient) > 1
    and length(professor_recipient) between 3 and 320
  ),
  owner_copy_recipients jsonb not null default '[]'::jsonb
    check (jsonb_typeof(owner_copy_recipients) = 'array'),
  provider_status text not null check (provider_status in ('sent', 'suppressed', 'not_configured', 'failed')),
  provider_id text check (provider_id is null or length(provider_id) between 1 and 240),
  safe_error_code text check (safe_error_code is null or safe_error_code ~ '^[a-z0-9_]{2,80}$'),
  attempted_by_user_id uuid not null,
  attempted_at timestamptz not null default now(),
  constraint email_delivery_events_exam_scope_fk
    foreign key (exam_id, institution_id)
    references examination_room_v1.exams (id, institution_id)
    on delete restrict
);

create index email_delivery_events_exam_time_idx
  on examination_room_v1.email_delivery_events (exam_id, attempted_at desc);

create table examination_room_v1.owner_identity_corrections (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references examination_room_v1.institutions(id) on delete restrict,
  exam_id uuid not null,
  student_identity_id uuid not null,
  request_hash text not null unique check (request_hash ~ '^[0-9a-f]{64}$'),
  before_record jsonb not null check (jsonb_typeof(before_record) = 'object'),
  after_record jsonb not null check (jsonb_typeof(after_record) = 'object'),
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  corrected_by_user_id uuid not null,
  corrected_at timestamptz not null default now(),
  constraint owner_identity_corrections_exam_scope_fk
    foreign key (exam_id, institution_id)
    references examination_room_v1.exams (id, institution_id)
    on delete restrict,
  constraint owner_identity_corrections_identity_scope_fk
    foreign key (student_identity_id, institution_id)
    references examination_room_v1.student_identities (id, institution_id)
    on delete restrict
);

comment on table examination_room_v1.owner_identity_corrections is
  'Append-only before/after evidence for platform-owner identity corrections. Recovery bundles include this history so an accidental edit can be reconstructed without trusting the mutable identity row.';

alter table examination_room_v1.result_releases
  add column batch_request_hash text
    check (batch_request_hash is null or batch_request_hash ~ '^[0-9a-f]{64}$');

create index result_releases_batch_request_idx
  on examination_room_v1.result_releases (batch_request_hash, occurred_at, id)
  where batch_request_hash is not null;

comment on column examination_room_v1.result_releases.batch_request_hash is
  'Common one-way request hash for an atomic multi-student release. It lets recovery materialize one exact release-batch event instead of one growing all-history object per student.';

alter table examination_room_v1.recovery_snapshots
  add column source_kind text,
  add column source_session_id uuid references examination_room_v1.student_sessions(id) on delete restrict,
  add column source_submission_id uuid references examination_room_v1.submissions(id) on delete restrict,
  add column source_grade_revision_id uuid references examination_room_v1.grade_revisions(id) on delete restrict,
  add column source_result_release_id uuid references examination_room_v1.result_releases(id) on delete restrict,
  add column materialization_attempts integer not null default 0 check (materialization_attempts >= 0),
  add column lease_id uuid,
  add column lease_expires_at timestamptz,
  add column next_retry_at timestamptz,
  add column available_at timestamptz,
  add column last_error_code text check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]{2,100}$'),
  add column last_error_at timestamptz,
  add column verified_at timestamptz,
  add column restored_record_count bigint not null default 0 check (restored_record_count >= 0),
  add column restore_verification_sha256 text
    check (restore_verification_sha256 is null or restore_verification_sha256 ~ '^[0-9a-f]{64}$');

alter table examination_room_v1.recovery_snapshots
  drop constraint recovery_snapshots_snapshot_status_check,
  drop constraint recovery_snapshots_materialization_check,
  drop constraint recovery_snapshots_restore_check;

-- Remove the original immutable-evidence trigger before the upgrade backfills.
-- The stricter replacement is recreated below after every legacy row conforms
-- to the expanded state machine.
drop trigger if exists recovery_snapshots_evidence_locked
  on examination_room_v1.recovery_snapshots;

-- Existing greenfield installations may already contain materialized recovery
-- rows. The new state machine requires an explicit availability timestamp, so
-- backfill it before validating the replacement constraint.
update examination_room_v1.recovery_snapshots
set available_at = coalesce(restored_at, updated_at, created_at)
where snapshot_status in ('available', 'restoring', 'restored', 'expired', 'superseded')
  and available_at is null;

alter table examination_room_v1.recovery_snapshots
  add constraint recovery_snapshots_snapshot_status_check
    check (snapshot_status in (
      'pending', 'materializing', 'available', 'failed', 'restoring',
      'restored', 'expired', 'superseded'
    )),
  add constraint recovery_snapshots_source_kind_check
    check (source_kind is null or source_kind in (
      'publication', 'submission', 'grade_revision', 'result_release', 'manual'
    )),
  add constraint recovery_snapshots_lease_check
    check (
      (snapshot_status = 'materializing' and lease_id is not null and lease_expires_at is not null)
      or (snapshot_status <> 'materializing' and lease_id is null and lease_expires_at is null)
    ),
  add constraint recovery_snapshots_materialization_check
    check (
      (
        snapshot_status in ('pending', 'materializing', 'failed')
        and encrypted_object_reference is null
        and snapshot_sha256 is null
        and encryption_key_reference is null
        and available_at is null
      )
      or (
        snapshot_status in ('available', 'restoring', 'restored', 'expired', 'superseded')
        and encrypted_object_reference is not null
        and snapshot_sha256 is not null
        and encryption_key_reference is not null
        and available_at is not null
      )
    ),
  add constraint recovery_snapshots_restore_check
    check (
      (snapshot_status <> 'restored' and restored_at is null and restored_by_user_id is null)
      or (snapshot_status = 'restored' and restored_at is not null and restored_by_user_id is not null)
    );

update examination_room_v1.recovery_snapshots snapshot
set source_kind = case snapshot.snapshot_scope
    when 'exam_definition' then 'publication'
    when 'answer_state' then 'submission'
    when 'grading_state' then 'grade_revision'
    else 'manual'
  end,
  source_submission_id = submission.id,
  source_session_id = submission.session_id
from examination_room_v1.submissions submission
where snapshot.snapshot_scope = 'answer_state'
  and snapshot.request_hash = submission.idempotency_key_hash;

update examination_room_v1.recovery_snapshots
set source_kind = case snapshot_scope
    when 'exam_definition' then 'publication'
    when 'answer_state' then 'submission'
    when 'grading_state' then 'grade_revision'
    else 'manual'
  end
where source_kind is null;

create or replace function examination_room_v1.protect_recovery_snapshot()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.id is distinct from old.id
     or new.exam_id is distinct from old.exam_id
     or new.exam_version_id is distinct from old.exam_version_id
     or new.snapshot_sequence is distinct from old.snapshot_sequence
     or new.snapshot_scope is distinct from old.snapshot_scope
     or new.request_hash is distinct from old.request_hash
     or new.record_count is distinct from old.record_count
     or new.created_by_user_id is distinct from old.created_by_user_id
     or new.created_at is distinct from old.created_at
     or new.retention_until is distinct from old.retention_until
     or new.source_kind is distinct from old.source_kind
     or new.source_session_id is distinct from old.source_session_id
     or new.source_submission_id is distinct from old.source_submission_id
     or new.source_grade_revision_id is distinct from old.source_grade_revision_id
     or new.source_result_release_id is distinct from old.source_result_release_id then
    raise exception using
      errcode = '55000',
      message = 'recovery snapshot request evidence is immutable';
  end if;

  if old.snapshot_status in ('pending', 'failed')
     and new.snapshot_status = 'materializing'
     and new.materialization_attempts = old.materialization_attempts + 1 then
    return new;
  end if;

  if old.snapshot_status = 'materializing'
     and old.lease_expires_at < clock_timestamp()
     and new.snapshot_status = 'materializing'
     and new.materialization_attempts = old.materialization_attempts + 1 then
    return new;
  end if;

  if old.snapshot_status = 'materializing'
     and new.snapshot_status in ('available', 'failed') then
    return new;
  end if;

  if old.snapshot_status = 'failed'
     and new.snapshot_status = 'pending'
     and new.last_error_code is null
     and new.last_error_at is null then
    return new;
  end if;

  if old.snapshot_status = 'available'
     and new.snapshot_status in ('restoring', 'expired', 'superseded')
     and new.encrypted_object_reference = old.encrypted_object_reference
     and new.snapshot_sha256 = old.snapshot_sha256
     and new.encryption_key_reference = old.encryption_key_reference then
    return new;
  end if;

  if old.snapshot_status = 'restoring'
     and new.snapshot_status in ('available', 'restored')
     and new.encrypted_object_reference = old.encrypted_object_reference
     and new.snapshot_sha256 = old.snapshot_sha256
     and new.encryption_key_reference = old.encryption_key_reference then
    return new;
  end if;

  if to_jsonb(new) - 'updated_at' = to_jsonb(old) - 'updated_at' then
    return new;
  end if;

  raise exception using
    errcode = '55000',
    message = 'recovery snapshot state may advance only through claim, materialization, retry, verification, restore, or retention states';
  return null;
end;
$$;

-- Delivery attempts are evidentiary records, but a retry that is eventually
-- accepted by the provider must be able to advance the one logical audit row
-- to its terminal success state.  All scope and recipient evidence remains
-- immutable, and a recorded success can never be downgraded.
create or replace function examination_room_v1.protect_email_delivery_event()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'examination_room_v1.email_delivery_events is append-only';
  end if;

  if new.id is distinct from old.id
     or new.institution_id is distinct from old.institution_id
     or new.exam_id is distinct from old.exam_id
     or new.activation_id is distinct from old.activation_id
     or new.request_hash is distinct from old.request_hash
     or new.delivery_kind is distinct from old.delivery_kind
     or new.professor_recipient is distinct from old.professor_recipient
     or new.owner_copy_recipients is distinct from old.owner_copy_recipients then
    raise exception using
      errcode = '55000',
      message = 'email delivery scope and recipient evidence is immutable';
  end if;

  if old.provider_status in ('failed', 'not_configured')
     and new.provider_status = 'sent'
     and new.safe_error_code is null
     and new.attempted_at >= old.attempted_at then
    return new;
  end if;

  if to_jsonb(new) = to_jsonb(old) then
    return new;
  end if;

  raise exception using
    errcode = '55000',
    message = 'email delivery status may advance only from failed or not configured to sent';
  return null;
end;
$$;

create trigger recovery_snapshots_evidence_locked
before update on examination_room_v1.recovery_snapshots
for each row execute function examination_room_v1.protect_recovery_snapshot();

create trigger owner_key_envelopes_immutable
before update or delete on examination_room_v1.owner_key_envelopes
for each row execute function examination_room_v1.prevent_mutation();

create trigger email_delivery_events_immutable
before update or delete on examination_room_v1.email_delivery_events
for each row execute function examination_room_v1.protect_email_delivery_event();

create trigger owner_identity_corrections_immutable
before update or delete on examination_room_v1.owner_identity_corrections
for each row execute function examination_room_v1.prevent_mutation();

alter table examination_room_v1.owner_key_envelopes enable row level security;
alter table examination_room_v1.owner_key_envelopes force row level security;
alter table examination_room_v1.email_delivery_events enable row level security;
alter table examination_room_v1.email_delivery_events force row level security;
alter table examination_room_v1.owner_identity_corrections enable row level security;
alter table examination_room_v1.owner_identity_corrections force row level security;
revoke all on table examination_room_v1.owner_key_envelopes from public, anon, authenticated, service_role;
revoke all on table examination_room_v1.email_delivery_events from public, anon, authenticated, service_role;
revoke all on table examination_room_v1.owner_identity_corrections from public, anon, authenticated, service_role;
grant select, insert, update, delete on table examination_room_v1.owner_key_envelopes to service_role;
grant select, insert, update, delete on table examination_room_v1.email_delivery_events to service_role;
grant select, insert, update, delete on table examination_room_v1.owner_identity_corrections to service_role;

create or replace function examination_room_v1.owner_authorized(p_actor_user_id uuid)
returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from public.user_roles owner_role
    where owner_role.user_id = p_actor_user_id
      and owner_role.role in ('founder_admin', 'super_admin')
  );
$$;

revoke all on function examination_room_v1.owner_authorized(uuid) from public, anon, authenticated, service_role;

-- Examination creation is available to every verified signed-in account in an
-- active law-school workspace.  Ownership remains the authorization boundary:
-- a creator can see and mutate only exams whose owner_user_id is their auth id;
-- only an exact Founder/Super Admin may cross that boundary for testing.
create or replace function examination_room_v1.creator_authorized(
  p_actor_user_id uuid,
  p_institution_id uuid
)
returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  select p_actor_user_id is not null
    and p_institution_id is not null
    and exists (
      select 1 from auth.users auth_user where auth_user.id = p_actor_user_id
    )
    and exists (
      select 1
      from examination_room_v1.institutions institution
      where institution.id = p_institution_id
        and institution.institution_status = 'active'
    );
$$;

revoke all on function examination_room_v1.creator_authorized(uuid, uuid)
  from public, anon, authenticated, service_role;

-- The original greenfield trigger required an active Professor/Admin staff
-- membership before an exam row could be created.  Creator access is now
-- intentionally broader, so the invariant becomes verified auth ownership in
-- an active workspace; all later reads and writes remain exact-owner bound.
create or replace function examination_room_v1.validate_exam_owner()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE'
     and (new.owner_user_id is distinct from old.owner_user_id
       or new.institution_id is distinct from old.institution_id) then
    raise exception using
      errcode = '55000',
      message = 'examination owner and workspace are immutable after creation';
  end if;
  if not examination_room_v1.creator_authorized(
    new.owner_user_id,
    new.institution_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'exam owner must be a verified account in an active examination workspace';
  end if;
  return new;
end;
$$;

revoke all on function examination_room_v1.validate_exam_owner()
  from public, anon, authenticated, service_role;

create or replace function public.examination_room_v1_staff_context(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  with actor as (
    select
      auth_user.id,
      lower(auth_user.email) as email,
      profile.commercial_category as profile_role,
      lower(btrim(coalesce(profile.law_school_id, ''))) as law_school_id,
      lower(btrim(coalesce(nullif(profile.law_school_other, ''), profile.school, ''))) as school_name,
      exists (
        select 1 from public.professor_license_declarations declaration
        where declaration.user_id = auth_user.id
      ) as professor_declared
    from auth.users auth_user
    left join public.profiles profile on profile.id = auth_user.id
    where auth_user.id = p_user_id
  ),
  workspaces as (
    select
      institution.id as institution_id,
      institution.institution_name,
      institution.institution_code,
      institution.institution_status,
      true as active,
      (
        institution.profile_school_id = actor.law_school_id
        or lower(institution.institution_name) = actor.school_name
      ) as profile_match
    from examination_room_v1.institutions institution
    cross join actor
    where institution.institution_status = 'active'
  ),
  memberships as (
    select
      membership.institution_id,
      membership.staff_role,
      institution.institution_name,
      institution.institution_code,
      institution.institution_status,
      bool_or(
        membership.membership_status = 'active'
        and institution.institution_status = 'active'
      ) as active
    from examination_room_v1.staff_memberships membership
    join examination_room_v1.institutions institution on institution.id = membership.institution_id
    where membership.user_id = p_user_id
    group by membership.institution_id, membership.staff_role,
      institution.institution_name, institution.institution_code, institution.institution_status
  ),
  active_membership_institutions as (
    select distinct membership.institution_id from memberships membership where membership.active
  ),
  preferred as (
    select case
      when (select count(*) from active_membership_institutions) = 1
        then (select institution_id from active_membership_institutions limit 1)
      when (select count(*) from workspaces where profile_match) = 1
        then (select institution_id from workspaces where profile_match limit 1)
      when (select count(*) from workspaces) = 1
        then (select institution_id from workspaces limit 1)
      else null
    end as institution_id
  )
  select jsonb_build_object(
    'authenticated', exists (select 1 from actor),
    'authorized', exists (select 1 from actor) and exists (select 1 from workspaces),
    'creatorAuthorized', exists (select 1 from actor) and exists (select 1 from workspaces),
    'profileRole', (select profile_role from actor),
    'professorRoleSelected', coalesce((
      select profile_role = 'professor' and professor_declared from actor
    ), false),
    'institutionId', (select institution_id from preferred),
    'creatorWorkspaces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'institutionId', workspace.institution_id,
        'institutionName', workspace.institution_name,
        'institutionCode', workspace.institution_code,
        'institutionStatus', workspace.institution_status,
        'active', workspace.active,
        'profileMatch', workspace.profile_match
      ) order by workspace.profile_match desc, workspace.institution_name, workspace.institution_id)
      from workspaces workspace
    ), '[]'::jsonb),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'institutionId', membership.institution_id,
        'institutionName', membership.institution_name,
        'institutionCode', membership.institution_code,
        'institutionStatus', membership.institution_status,
        'staffRole', membership.staff_role,
        'active', membership.active
      ) order by membership.active desc, (membership.staff_role = 'admin') desc,
        membership.institution_name, membership.institution_id)
      from memberships membership
    ), '[]'::jsonb)
  );
$$;

comment on function public.examination_room_v1_staff_context(uuid) is
  'Service-only creator context. Professor profile selection is informational; every verified auth user may choose an active workspace and remains bound to exams they own.';

revoke all on function public.examination_room_v1_staff_context(uuid)
  from public, anon, authenticated;
grant execute on function public.examination_room_v1_staff_context(uuid) to service_role;

create or replace function public.examination_room_v1_professor_access(
  p_operation text,
  p_actor_user_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  safe_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  context jsonb;
  requested_institution_id uuid;
begin
  if p_actor_user_id is null or not exists (
    select 1 from auth.users auth_user where auth_user.id = p_actor_user_id
  ) then
    return examination_room_v1.api_error(
      'PROFESSOR_SIGN_IN_REQUIRED', 'Sign in to create or manage an examination.', 401,
      'Sign in through Due Diligence, then reopen the Professor door.'
    );
  end if;
  if jsonb_typeof(safe_payload) <> 'object' then
    return examination_room_v1.api_error(
      'INVALID_REQUEST', 'Examination creator details must be an object.', 400,
      'Refresh the Professor door and try again.'
    );
  end if;
  if p_operation not in ('status', 'request') then
    return examination_room_v1.api_error(
      'UNKNOWN_OPERATION', 'That examination creator access action is unavailable.', 400,
      'Refresh the Professor door and try again.'
    );
  end if;

  context := public.examination_room_v1_staff_context(p_actor_user_id);
  if not coalesce((context ->> 'creatorAuthorized')::boolean, false) then
    return examination_room_v1.api_error(
      'CREATOR_WORKSPACE_REQUIRED', 'No active law-school workspace is available.', 403,
      'Ask the platform owner to create or reactivate a law-school workspace.'
    );
  end if;

  requested_institution_id := nullif(safe_payload ->> 'institutionId', '')::uuid;
  if requested_institution_id is not null
     and not examination_room_v1.creator_authorized(p_actor_user_id, requested_institution_id) then
    return examination_room_v1.api_error(
      'CREATOR_WORKSPACE_FORBIDDEN', 'That law-school workspace is unavailable.', 403,
      'Choose an active workspace listed on the Professor door.'
    );
  end if;

  return context || jsonb_build_object(
    'ok', true,
    'activeAssignment', true,
    'activeAssignments', context -> 'creatorWorkspaces',
    'availableInstitutions', context -> 'creatorWorkspaces',
    'request', null,
    'alreadyActive', p_operation = 'request',
    'duplicate', p_operation = 'request',
    'institutionId', coalesce(requested_institution_id::text, context ->> 'institutionId')
  );
exception
  when invalid_text_representation then
    return examination_room_v1.api_error(
      'CREATOR_WORKSPACE_INVALID', 'The selected workspace identifier is invalid.', 400,
      'Refresh the Professor door and choose a listed workspace.'
    );
end;
$$;

comment on function public.examination_room_v1_professor_access(text, uuid, jsonb) is
  'Service-only creator-door status bridge. Publishing an exam is the approval request; this function never creates a Professor role gate or self-grants platform-owner access.';

revoke all on function public.examination_room_v1_professor_access(text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.examination_room_v1_professor_access(text, uuid, jsonb)
  to service_role;

-- Tighten the legacy private Professor implementation without copying its
-- large append-only state machine.  Ordinary institution admins must never
-- inherit the platform-owner cross-exam bypass merely because they have an
-- institution staff row.
do $creator_professor_patch$
declare
  source_definition text;
  patched_definition text;
  old_admin_check text := $old_admin_check$  actor_is_admin := exists (
    select 1
    from examination_room_v1.staff_memberships m
    where m.institution_id = p_institution_id
      and m.user_id = p_actor_user_id
      and m.staff_role = 'admin'
      and m.membership_status = 'active'
  );$old_admin_check$;
  new_admin_check text := $new_admin_check$  actor_is_admin := examination_room_v1.owner_authorized(p_actor_user_id);$new_admin_check$;
  old_identity text := $old_identity$  select m.display_name, m.email_normalized
  into actor_name, actor_email
  from examination_room_v1.staff_memberships m
  where m.institution_id = p_institution_id
    and m.user_id = p_actor_user_id
    and m.membership_status = 'active'
  order by (m.staff_role = 'admin') desc, m.granted_at desc
  limit 1;$old_identity$;
  new_identity text := $new_identity$  select
    coalesce(
      nullif(btrim(membership.display_name), ''),
      nullif(btrim(profile.display_name), ''),
      nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(auth_user.raw_user_meta_data ->> 'name'), ''),
      nullif(pg_catalog.split_part(lower(auth_user.email), '@', 1), ''),
      'Examination creator'
    ),
    coalesce(membership.email_normalized, lower(auth_user.email))
  into actor_name, actor_email
  from auth.users auth_user
  left join public.profiles profile on profile.id = auth_user.id
  left join lateral (
    select row_value.display_name, row_value.email_normalized
    from examination_room_v1.staff_memberships row_value
    where row_value.institution_id = p_institution_id
      and row_value.user_id = p_actor_user_id
      and row_value.membership_status = 'active'
    order by (row_value.staff_role = 'admin') desc, row_value.granted_at desc
    limit 1
  ) membership on true
  where auth_user.id = p_actor_user_id;$new_identity$;
  old_release_start text := $old_release_start$  if p_operation = 'release_results' then
    request_hash := p_payload ->> 'requestHash';
    perform examination_room_v1.lock_request(p_institution_id, request_hash);$old_release_start$;
  new_release_start text := $new_release_start$  if p_operation = 'release_results' then
    request_hash := p_payload ->> 'requestHash';
    perform set_config('examination_room_v1.release_batch_request_hash', request_hash, true);
    perform set_config(
      'examination_room_v1.release_batch_count',
      coalesce(jsonb_array_length(p_payload -> 'releases'), 0)::text,
      true
    );
    perform examination_room_v1.lock_request(p_institution_id, request_hash);$new_release_start$;
  old_release_insert text := $old_release_insert$      insert into examination_room_v1.result_releases (
        id, submission_id, grade_revision_id, release_action, channel,
        idempotency_key_hash, manifest_sha256, release_manifest, performed_by_user_id, occurred_at
      ) values (
        ((release_item -> 'releaseManifest') ->> 'releaseId')::uuid,
        submission_id,
        grade_revision_id,
        'release',
        'student_portal',
        release_item ->> 'releaseRequestHash',
        release_item ->> 'releaseHash',
        release_item -> 'releaseManifest',
        p_actor_user_id,
        (((release_item -> 'releaseManifest') ->> 'releasedAt'))::timestamptz
      );$old_release_insert$;
  new_release_insert text := $new_release_insert$      insert into examination_room_v1.result_releases (
        id, submission_id, grade_revision_id, release_action, channel,
        idempotency_key_hash, batch_request_hash, manifest_sha256, release_manifest,
        performed_by_user_id, occurred_at
      ) values (
        ((release_item -> 'releaseManifest') ->> 'releaseId')::uuid,
        submission_id,
        grade_revision_id,
        'release',
        'student_portal',
        release_item ->> 'releaseRequestHash',
        request_hash,
        release_item ->> 'releaseHash',
        release_item -> 'releaseManifest',
        p_actor_user_id,
        (((release_item -> 'releaseManifest') ->> 'releasedAt'))::timestamptz
      );$new_release_insert$;
begin
  source_definition := pg_catalog.pg_get_functiondef(
    'examination_room_v1.api_professor(text,uuid,uuid,jsonb)'::regprocedure
  );
  patched_definition := replace(source_definition, old_admin_check, new_admin_check);
  if patched_definition = source_definition then
    raise exception 'creator migration could not locate api_professor admin authorization block';
  end if;
  source_definition := patched_definition;
  patched_definition := replace(source_definition, old_identity, new_identity);
  if patched_definition = source_definition then
    raise exception 'creator migration could not locate api_professor identity block';
  end if;
  source_definition := patched_definition;
  patched_definition := replace(source_definition, old_release_start, new_release_start);
  if patched_definition = source_definition then
    raise exception 'creator migration could not locate api_professor release batch start';
  end if;
  source_definition := patched_definition;
  patched_definition := replace(source_definition, old_release_insert, new_release_insert);
  if patched_definition = source_definition then
    raise exception 'creator migration could not locate api_professor release insert';
  end if;
  execute patched_definition;
end;
$creator_professor_patch$;

-- Key delivery resolves the creator directly from the immutable exam owner id.
-- A Professor staff membership may enrich the display name, but is never a
-- prerequisite for approving and emailing a published exam.
do $creator_admin_patch$
declare
  source_definition text;
  patched_definition text;
  old_contact text := $old_contact$    select m.display_name, m.email_normalized
    into professor_name, professor_email
    from examination_room_v1.staff_memberships m
    where m.institution_id = p_institution_id
      and m.user_id = exam_owner_id
      and m.membership_status = 'active'
    order by (m.staff_role = 'professor') desc, m.granted_at desc
    limit 1;$old_contact$;
  new_contact text := $new_contact$    select
      coalesce(
        nullif(btrim(membership.display_name), ''),
        nullif(btrim(profile.display_name), ''),
        nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
        nullif(btrim(auth_user.raw_user_meta_data ->> 'name'), ''),
        nullif(pg_catalog.split_part(lower(auth_user.email), '@', 1), ''),
        'Examination creator'
      ),
      coalesce(membership.email_normalized, lower(auth_user.email))
    into professor_name, professor_email
    from auth.users auth_user
    left join public.profiles profile on profile.id = auth_user.id
    left join lateral (
      select row_value.display_name, row_value.email_normalized
      from examination_room_v1.staff_memberships row_value
      where row_value.institution_id = p_institution_id
        and row_value.user_id = exam_owner_id
        and row_value.membership_status = 'active'
      order by (row_value.staff_role = 'professor') desc, row_value.granted_at desc
      limit 1
    ) membership on true
    where auth_user.id = exam_owner_id;$new_contact$;
begin
  source_definition := pg_catalog.pg_get_functiondef(
    'examination_room_v1.api_admin(text,uuid,uuid,jsonb)'::regprocedure
  );
  patched_definition := replace(source_definition, old_contact, new_contact);
  if patched_definition = source_definition then
    raise exception 'creator migration could not locate api_admin creator contact block';
  end if;
  execute patched_definition;
end;
$creator_admin_patch$;

create or replace function examination_room_v1.api_professor_view(
  p_operation text,
  p_actor_user_id uuid,
  p_institution_id uuid,
  p_exam_id uuid
)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  target_exam examination_room_v1.exams%rowtype;
  response jsonb;
begin
  select exam.* into target_exam
  from examination_room_v1.exams exam
  where exam.id = p_exam_id
    and exam.institution_id = p_institution_id;

  if target_exam.id is null then
    return examination_room_v1.api_error(
      'EXAM_NOT_FOUND', 'The examination does not exist in this workspace.', 404,
      'Return to the Examination Room list and choose an available examination.'
    );
  end if;
  if target_exam.owner_user_id <> p_actor_user_id
     and not examination_room_v1.owner_authorized(p_actor_user_id) then
    return examination_room_v1.api_error(
      'FORBIDDEN', 'Only the examination creator or a platform owner may open this examination.', 403,
      'Choose an examination created by your signed-in account.'
    );
  end if;

  if p_operation = 'monitor' then
    select jsonb_build_object(
      'ok', true,
      'exam', jsonb_build_object(
        'id', exam.id,
        'examId', exam.id,
        'title', exam.title,
        'description', exam.description,
        'status', exam.status,
        'anonymousGrading', exam.anonymous_grading,
        'currentPublishedVersionId', exam.current_published_version_id
      ),
      'activation', (
        select jsonb_build_object(
          'id', activation.id,
          'status', activation.activation_status,
          'opensAt', activation.opens_at,
          'closesAt', activation.closes_at,
          'expiresAt', activation.closes_at,
          'maxSessions', activation.max_sessions,
          'createdAt', activation.created_at
        )
        from examination_room_v1.room_activations activation
        where activation.exam_id = exam.id
        order by activation.created_at desc, activation.id desc
        limit 1
      ),
      'sessions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', session.id,
          'sessionId', session.id,
          'examId', session.exam_id,
          'fullName', identity.full_name,
          'studentNumber', identity.external_student_id,
          'yearLevel', roster.accommodations ->> 'yearLevel',
          'subject', roster.accommodations ->> 'subject',
          'status', session.session_status,
          'connected', coalesce((session.session_metadata ->> 'connected')::boolean, false),
          'currentQuestion', session.session_metadata -> 'currentQuestion',
          'consentVersion', (
            select notice.notice_code
            from examination_room_v1.privacy_acceptances acceptance
            join examination_room_v1.privacy_notice_versions notice
              on notice.id = acceptance.notice_version_id
            where acceptance.session_id = session.id
              and acceptance.decision = 'accepted'
            order by acceptance.recorded_at desc, acceptance.id desc
            limit 1
          ),
          'startedAt', session.started_at,
          'lastSeenAt', coalesce(session.last_heartbeat_at, session.updated_at, session.started_at),
          'endedAt', session.ended_at
        ) order by identity.full_name, session.started_at, session.id)
        from examination_room_v1.student_sessions session
        join examination_room_v1.exam_roster roster on roster.id = session.roster_id
        join examination_room_v1.student_identities identity on identity.id = roster.student_identity_id
        where session.exam_id = exam.id
      ), '[]'::jsonb),
      'submissions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', submission.id,
          'submissionId', submission.id,
          'sessionId', submission.session_id,
          'status', submission.submission_status,
          'submissionStatus', submission.submission_status,
          'submittedAt', submission.received_at,
          'receivedAt', submission.received_at,
          'receiptCode', receipt.receipt_code,
          'receiptId', receipt.id,
          'answerCount', submission.answer_count
        ) order by submission.received_at, submission.id)
        from examination_room_v1.submissions submission
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        left join examination_room_v1.submission_receipts receipt on receipt.submission_id = submission.id
        where session.exam_id = exam.id
      ), '[]'::jsonb),
      'incidents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', incident.id,
          'sessionId', incident.session_id,
          'type', incident.incident_kind,
          'severity', incident.severity,
          'occurredAt', incident.occurred_at,
          'durationMs', incident.duration_ms,
          'details', incident.details,
          'reviewStatus', incident.review_status
        ) order by incident.occurred_at, incident.id)
        from examination_room_v1.proctoring_incidents incident
        join examination_room_v1.student_sessions session on session.id = incident.session_id
        where session.exam_id = exam.id
      ), '[]'::jsonb),
      'generatedAt', clock_timestamp()
    ) into response
    from examination_room_v1.exams exam
    where exam.id = target_exam.id;
    return response;
  end if;

  if p_operation = 'grading' then
    select jsonb_build_object(
      'ok', true,
      'exam', jsonb_build_object(
        'id', exam.id,
        'examId', exam.id,
        'title', exam.title,
        'description', exam.description,
        'status', exam.status,
        'anonymousGrading', exam.anonymous_grading,
        'currentPublishedVersionId', exam.current_published_version_id
      ),
      'sessions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end,
          'sessionId', case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end,
          -- This view is already limited to the exact exam creator or a
          -- Founder/Super Admin. Return both real and grading identities so
          -- the Professor-controlled UI may mask or reveal them at any time.
          'fullName', identity.full_name,
          'studentNumber', identity.external_student_id,
          'realFullName', identity.full_name,
          'realStudentNumber', identity.external_student_id,
          'yearLevel', roster.accommodations ->> 'yearLevel',
          'subject', roster.accommodations ->> 'subject',
          'gradingAlias', roster.grading_alias,
          'identityMode', case when exam.anonymous_grading then 'anonymous_grading' else 'real_names' end,
          'status', session.session_status,
          'submittedAt', submission.received_at
        ) order by submission.received_at, submission.id)
        from examination_room_v1.submissions submission
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        join examination_room_v1.exam_roster roster on roster.id = session.roster_id
        join examination_room_v1.student_identities identity on identity.id = roster.student_identity_id
        where session.exam_id = exam.id
          and submission.submission_status = 'accepted'
      ), '[]'::jsonb),
      'submissions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', submission.id,
          'submissionId', submission.id,
          'sessionId', case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end,
          'status', submission.submission_status,
          'submissionStatus', submission.submission_status,
          'submittedAt', submission.received_at,
          'receivedAt', submission.received_at,
          'receiptCode', receipt.receipt_code,
          'receiptId', receipt.id,
          'answerCount', submission.answer_count
        ) order by submission.received_at, submission.id)
        from examination_room_v1.submissions submission
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        left join examination_room_v1.submission_receipts receipt on receipt.submission_id = submission.id
        where session.exam_id = exam.id
          and submission.submission_status = 'accepted'
      ), '[]'::jsonb),
      'answerRevisions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', answer.id,
          'sessionId', case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end,
          'questionId', question.question_key,
          'questionNumber', question.position,
          'revision', answer.revision_number,
          'answer', answer.answer_payload -> 'answer',
          'flagged', answer.is_flagged,
          'contentHash', answer.answer_sha256,
          'savedAt', answer.saved_at,
          'at', answer.saved_at,
          'source', answer.source
        ) order by submission.received_at, question.position, answer.revision_number, answer.id)
        from examination_room_v1.submission_answers selected_answer
        join examination_room_v1.submissions submission on submission.id = selected_answer.submission_id
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        join examination_room_v1.answer_revisions answer on answer.id = selected_answer.answer_revision_id
        join examination_room_v1.questions question on question.id = selected_answer.question_id
        where session.exam_id = exam.id
          and submission.submission_status = 'accepted'
      ), '[]'::jsonb),
      'gradeRevisions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', grade.id,
          'sessionId', case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end,
          'questionId', question.question_key,
          'questionNumber', question.position,
          'points', item.score,
          'feedback', coalesce(item.feedback, ''),
          'revision', grade.revision_number,
          'status', grade.grade_status,
          'source', grade.source,
          'at', grade.created_at,
          'gradedAt', grade.grading_manifest -> 'gradedAt'
        ) order by submission.received_at, grade.revision_number, question.position, grade.id)
        from examination_room_v1.grade_revisions grade
        join examination_room_v1.grade_revision_items item on item.grade_revision_id = grade.id
        join examination_room_v1.questions question on question.id = item.question_id
        join examination_room_v1.submissions submission on submission.id = grade.submission_id
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        where session.exam_id = exam.id
          and submission.submission_status = 'accepted'
      ), '[]'::jsonb),
      'releases', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', release.id,
          'sessionIds', jsonb_build_array(case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end),
          'releasedAt', release.occurred_at,
          'at', release.occurred_at,
          'status', 'released',
          'channel', release.channel
        ) order by release.occurred_at, release.id)
        from examination_room_v1.result_releases release
        join examination_room_v1.submissions submission on submission.id = release.submission_id
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        where session.exam_id = exam.id
          and release.release_action = 'release'
          and not exists (
            select 1
            from examination_room_v1.result_releases revoked
            where revoked.supersedes_release_id = release.id
              and revoked.release_action = 'revoke'
          )
      ), '[]'::jsonb),
      'generatedAt', clock_timestamp()
    ) into response
    from examination_room_v1.exams exam
    where exam.id = target_exam.id;
    return response;
  end if;

  return examination_room_v1.api_error(
    'UNKNOWN_OPERATION', 'That examination creator view is unavailable.', 400,
    'Refresh Examination Room and choose Monitor or Grade.'
  );
end;
$$;

revoke all on function examination_room_v1.api_professor_view(text, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.examination_room_v1_api(
  p_scope text,
  p_operation text,
  p_actor_user_id uuid,
  p_institution_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  safe_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  exam_id uuid;
begin
  if p_scope is null
     or p_operation is null
     or (p_scope <> 'student' and p_institution_id is null)
     or jsonb_typeof(safe_payload) <> 'object' then
    return examination_room_v1.api_error(
      'INVALID_REQUEST', 'Scope, operation, an object payload, and workspace for creator views are required.', 400,
      'Refresh Examination Room and try again.'
    );
  end if;

  if safe_payload::text ~* '"(key|token|raw[ _-]?key|room[ _-]?(key|code)|activation[ _-]?(key|code)|exam[ _-]?(key|code)|api[ _-]?key|session[ _-]?token|idempotency[ _-]?key|access[ _-]?(token|code)|refresh[ _-]?token|bearer[ _-]?token|one[ _-]?time[ _-]?code|password|secret|authorization|credential)"[[:space:]]*:' then
    return examination_room_v1.api_error(
      'RAW_SECRET_REJECTED', 'Only one-way hashes or opaque identifiers may reach examination persistence.', 400,
      'Refresh the page and repeat the action without raw credentials.'
    );
  end if;

  if not (
    (p_scope = 'professor' and p_operation in (
      'session', 'exam', 'monitor', 'grading', 'grading_context', 'release_context',
      'save_draft', 'publish', 'open_room', 'close_room', 'save_grade', 'release_results'
    ))
    or (p_scope = 'student' and p_operation in (
      'preview', 'consent', 'resume', 'result', 'session_context', 'save_answer',
      'record_event', 'heartbeat', 'submit'
    ))
    or (p_scope = 'admin' and p_operation in (
      'overview', 'activate_exam', 'email_key', 'revoke_key', 'create_snapshot'
    ))
  ) then
    return examination_room_v1.api_error(
      'UNKNOWN_OPERATION', 'The requested Examination Room operation is not registered.', 400,
      'Refresh Examination Room and choose a listed action.'
    );
  end if;

  if p_scope = 'professor' then
    if not examination_room_v1.creator_authorized(p_actor_user_id, p_institution_id) then
      return examination_room_v1.api_error(
        'CREATOR_WORKSPACE_REQUIRED', 'A verified account and active law-school workspace are required.', 403,
        'Sign in, choose an active workspace, then retry.'
      );
    end if;
    if p_operation in ('monitor', 'grading') then
      exam_id := nullif(safe_payload ->> 'examId', '')::uuid;
      return examination_room_v1.api_professor_view(
        p_operation, p_actor_user_id, p_institution_id, exam_id
      );
    end if;
    return examination_room_v1.api_professor(
      p_operation, p_actor_user_id, p_institution_id, safe_payload
    );
  elsif p_scope = 'admin' then
    if not examination_room_v1.owner_authorized(p_actor_user_id)
       or not exists (
         select 1 from examination_room_v1.institutions institution
         where institution.id = p_institution_id
           and institution.institution_status = 'active'
       ) then
      return examination_room_v1.api_error(
        'PLATFORM_OWNER_REQUIRED', 'Only a Founder or Super Admin may use examination administration.', 403,
        'Sign in with a platform-owner account.'
      );
    end if;
    return examination_room_v1.api_admin(
      p_operation, p_actor_user_id, p_institution_id, safe_payload
    );
  end if;
  return examination_room_v1.api_student(p_operation, safe_payload);
exception
  when invalid_text_representation or datetime_field_overflow then
    return examination_room_v1.api_error(
      'INVALID_REQUEST', 'A supplied identifier, number, or timestamp is invalid.', 400,
      'Refresh the page, correct the highlighted value, and try again.'
    );
  when unique_violation then
    return examination_room_v1.api_error(
      'PERSISTENCE_CONFLICT', 'A newer or duplicate record already exists for this action.', 409,
      'Refresh the current server-backed state, then repeat the action only if still needed.'
    );
  when foreign_key_violation or check_violation or not_null_violation then
    return examination_room_v1.api_error(
      'PERSISTENCE_STATE_INVALID', 'The action does not match the current immutable examination state.', 409,
      'Refresh the examination and retry from the latest saved state.'
    );
  when object_not_in_prerequisite_state then
    return examination_room_v1.api_error(
      'IMMUTABLE_RECORD_SEALED', 'That evidence record is already sealed and cannot be changed.', 409,
      'Refresh the view and create a new revision instead of overwriting sealed evidence.'
    );
  when serialization_failure or deadlock_detected then
    return examination_room_v1.api_error(
      'RETRY_REQUIRED', 'Another examination action completed at the same time.', 409,
      'Refresh the current state and retry the action once.'
    );
  when others then
    return examination_room_v1.api_error(
      'PERSISTENCE_INTERNAL_ERROR', 'The database could not complete the examination action safely.', 500,
      'Your prior server-backed work is preserved. Try again; if it continues, contact support.'
    );
end;
$$;

comment on function public.examination_room_v1_api(text, text, uuid, uuid, jsonb) is
  'Service-only atomic dispatcher. Any verified account may create exams in an active workspace, but non-owner operations are bound to exams owned by that exact auth user; only Founder/Super Admin has a cross-owner testing override.';

revoke all on function public.examination_room_v1_api(text, text, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.examination_room_v1_api(text, text, uuid, uuid, jsonb)
  to service_role;

create or replace function examination_room_v1.json_rows(p_value jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(p_value, '[]'::jsonb);
$$;

revoke all on function examination_room_v1.json_rows(jsonb) from public, anon, authenticated, service_role;

create or replace function examination_room_v1.owner_exam_bundle(p_exam_id uuid)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  v_institution_id uuid;
  v_current_version_id uuid;
  bundle jsonb;
begin
  select exam.institution_id, exam.current_published_version_id
  into v_institution_id, v_current_version_id
  from examination_room_v1.exams exam
  where exam.id = p_exam_id;

  if v_institution_id is null then
    return null;
  end if;

  select jsonb_build_object(
    'schemaVersion', 'examination-room/owner-bundle/v1',
    'generatedAt', clock_timestamp(),
    'institutionId', v_institution_id,
    'examId', p_exam_id,
    'currentPublishedVersionId', v_current_version_id,
    'tables', jsonb_build_object(
      'institutions', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.created_at)
        from examination_room_v1.institutions row_value
        where row_value.id = v_institution_id
      )),
      'privacyNoticeVersions', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.version_number)
        from examination_room_v1.privacy_notice_versions row_value
        where row_value.institution_id = v_institution_id
          and exists (
            select 1 from examination_room_v1.exam_versions version
            where version.exam_id = p_exam_id
              and version.privacy_notice_version_id = row_value.id
          )
      )),
      'staffMemberships', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.granted_at, row_value.id)
        from examination_room_v1.staff_memberships row_value
        where row_value.institution_id = v_institution_id
          and (
            row_value.user_id = (select owner_user_id from examination_room_v1.exams where id = p_exam_id)
            or row_value.staff_role = 'admin'
          )
      )),
      'professorAccessRequests', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.requested_at, row_value.id)
        from examination_room_v1.professor_access_requests row_value
        where row_value.requested_institution_id = v_institution_id
          and row_value.user_id = (select owner_user_id from examination_room_v1.exams where id = p_exam_id)
      )),
      'exams', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value))
        from examination_room_v1.exams row_value
        where row_value.id = p_exam_id
      )),
      'examVersions', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.version_number)
        from examination_room_v1.exam_versions row_value
        where row_value.exam_id = p_exam_id
      )),
      'questions', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.exam_version_id, row_value.position)
        from examination_room_v1.questions row_value
        where exists (
          select 1 from examination_room_v1.exam_versions version
          where version.exam_id = p_exam_id and version.id = row_value.exam_version_id
        )
      )),
      'studentIdentities', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.full_name, row_value.id)
        from examination_room_v1.student_identities row_value
        where exists (
          select 1 from examination_room_v1.exam_roster roster
          where roster.exam_id = p_exam_id and roster.student_identity_id = row_value.id
        )
      )),
      'ownerIdentityCorrections', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.corrected_at, row_value.id)
        from examination_room_v1.owner_identity_corrections row_value
        where row_value.exam_id = p_exam_id
      )),
      'examRoster', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.created_at desc, row_value.id desc)
        from examination_room_v1.exam_roster row_value
        where row_value.exam_id = p_exam_id
      )),
      'roomActivations', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.created_at, row_value.id)
        from examination_room_v1.room_activations row_value
        where row_value.exam_id = p_exam_id
      )),
      'ownerKeyEnvelopes', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.created_at desc, row_value.activation_id desc)
        from examination_room_v1.owner_key_envelopes row_value
        where row_value.exam_id = p_exam_id
      )),
      'studentSessions', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.started_at, row_value.id)
        from examination_room_v1.student_sessions row_value
        where row_value.exam_id = p_exam_id
      )),
      'privacyAcceptances', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.recorded_at, row_value.id)
        from examination_room_v1.privacy_acceptances row_value
        join examination_room_v1.student_sessions session on session.id = row_value.session_id
        where session.exam_id = p_exam_id
      )),
      'answerRevisions', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.session_id, row_value.question_id, row_value.revision_number)
        from examination_room_v1.answer_revisions row_value
        join examination_room_v1.student_sessions session on session.id = row_value.session_id
        where session.exam_id = p_exam_id
      )),
      'submissions', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.received_at, row_value.id)
        from examination_room_v1.submissions row_value
        join examination_room_v1.student_sessions session on session.id = row_value.session_id
        where session.exam_id = p_exam_id
      )),
      'submissionAnswers', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.submission_id, row_value.question_id)
        from examination_room_v1.submission_answers row_value
        join examination_room_v1.student_sessions session on session.id = row_value.session_id
        where session.exam_id = p_exam_id
      )),
      'submissionReceipts', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.issued_at, row_value.id)
        from examination_room_v1.submission_receipts row_value
        join examination_room_v1.submissions submission on submission.id = row_value.submission_id
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        where session.exam_id = p_exam_id
      )),
      'proctoringIncidents', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.occurred_at, row_value.id)
        from examination_room_v1.proctoring_incidents row_value
        join examination_room_v1.student_sessions session on session.id = row_value.session_id
        where session.exam_id = p_exam_id
      )),
      'proctoringArtifacts', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.captured_from, row_value.id)
        from examination_room_v1.proctoring_artifacts row_value
        join examination_room_v1.student_sessions session on session.id = row_value.session_id
        where session.exam_id = p_exam_id
      )),
      'gradeRevisions', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.submission_id, row_value.revision_number)
        from examination_room_v1.grade_revisions row_value
        join examination_room_v1.submissions submission on submission.id = row_value.submission_id
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        where session.exam_id = p_exam_id
      )),
      'gradeRevisionItems', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.grade_revision_id, row_value.question_id)
        from examination_room_v1.grade_revision_items row_value
        join examination_room_v1.grade_revisions grade on grade.id = row_value.grade_revision_id
        join examination_room_v1.submissions submission on submission.id = grade.submission_id
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        where session.exam_id = p_exam_id
      )),
      'resultReleases', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.occurred_at, row_value.id)
        from examination_room_v1.result_releases row_value
        join examination_room_v1.submissions submission on submission.id = row_value.submission_id
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        where session.exam_id = p_exam_id
      )),
      'auditEvents', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.occurred_at, row_value.id)
        from examination_room_v1.audit_events row_value
        where row_value.exam_id = p_exam_id
      )),
      'recoverySnapshots', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.snapshot_sequence)
        from examination_room_v1.recovery_snapshots row_value
        where row_value.exam_id = p_exam_id
      )),
      'emailDeliveryEvents', examination_room_v1.json_rows((
        select jsonb_agg(to_jsonb(row_value) order by row_value.attempted_at desc, row_value.id desc)
        from examination_room_v1.email_delivery_events row_value
        where row_value.exam_id = p_exam_id
      ))
    )
  ) into bundle;

  return bundle;
end;
$$;

revoke all on function examination_room_v1.owner_exam_bundle(uuid) from public, anon, authenticated, service_role;

create or replace function examination_room_v1.owner_snapshot_event_bundle(
  p_snapshot examination_room_v1.recovery_snapshots
)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  v_institution_id uuid;
  v_submission_id uuid := p_snapshot.source_submission_id;
  bundle jsonb;
begin
  select exam.institution_id into v_institution_id
  from examination_room_v1.exams exam
  where exam.id = p_snapshot.exam_id;

  if p_snapshot.source_kind = 'publication' then
    select jsonb_build_object(
      'schemaVersion', 'examination-room/recovery-event/v1',
      'capturedAt', p_snapshot.created_at,
      'eventKind', 'publication',
      'institutionId', v_institution_id,
      'examId', p_snapshot.exam_id,
      'tables', jsonb_build_object(
        'examVersions', examination_room_v1.json_rows(jsonb_build_array(to_jsonb(version))),
        'questions', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(question) order by question.position)
          from examination_room_v1.questions question
          where question.exam_version_id = p_snapshot.exam_version_id
        )),
        'privacyNoticeVersions', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(notice))
          from examination_room_v1.privacy_notice_versions notice
          where notice.id = version.privacy_notice_version_id
        ))
      )
    ) into bundle
    from examination_room_v1.exam_versions version
    where version.id = p_snapshot.exam_version_id
      and version.exam_id = p_snapshot.exam_id;
  elsif p_snapshot.source_kind = 'submission' and v_submission_id is not null then
    select jsonb_build_object(
      'schemaVersion', 'examination-room/recovery-event/v1',
      'capturedAt', p_snapshot.created_at,
      'eventKind', 'submission',
      'institutionId', v_institution_id,
      'examId', p_snapshot.exam_id,
      'tables', jsonb_build_object(
        'submissions', examination_room_v1.json_rows(jsonb_build_array(jsonb_build_object(
          'id', submission.id,
          'session_id', submission.session_id,
          'exam_version_id', submission.exam_version_id,
          'idempotency_key_hash', submission.idempotency_key_hash,
          'manifest_sha256', submission.manifest_sha256,
          'submission_manifest', submission.submission_manifest,
          'answer_count', submission.answer_count,
          'submitted_at_client', submission.submitted_at_client,
          'received_at', submission.received_at
        ))),
        'answerRevisions', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(answer) order by answer.question_id, answer.revision_number)
          from examination_room_v1.answer_revisions answer
          where answer.session_id = submission.session_id
            and answer.received_at <= p_snapshot.created_at
        )),
        'submissionAnswers', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(answer) order by answer.question_id)
          from examination_room_v1.submission_answers answer
          where answer.submission_id = submission.id
        )),
        'submissionReceipts', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(receipt) order by receipt.issued_at, receipt.id)
          from examination_room_v1.submission_receipts receipt
          where receipt.submission_id = submission.id
        )),
        'privacyAcceptances', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(acceptance) order by acceptance.recorded_at, acceptance.id)
          from examination_room_v1.privacy_acceptances acceptance
          where acceptance.session_id = submission.session_id
            and acceptance.recorded_at <= p_snapshot.created_at
        ))
      )
    ) into bundle
    from examination_room_v1.submissions submission
    where submission.id = v_submission_id;
  elsif p_snapshot.source_kind = 'grade_revision' and p_snapshot.source_grade_revision_id is not null then
    select jsonb_build_object(
      'schemaVersion', 'examination-room/recovery-event/v1',
      'capturedAt', p_snapshot.created_at,
      'eventKind', 'grade_revision',
      'institutionId', v_institution_id,
      'examId', p_snapshot.exam_id,
      'tables', jsonb_build_object(
        'gradeRevisions', examination_room_v1.json_rows(jsonb_build_array(to_jsonb(grade))),
        'gradeRevisionItems', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(item) order by item.question_id)
          from examination_room_v1.grade_revision_items item
          where item.grade_revision_id = grade.id
        )),
        'submissions', examination_room_v1.json_rows((
          select jsonb_agg(jsonb_build_object(
            'id', submission.id,
            'session_id', submission.session_id,
            'exam_version_id', submission.exam_version_id,
            'manifest_sha256', submission.manifest_sha256,
            'submission_manifest', submission.submission_manifest,
            'received_at', submission.received_at
          ))
          from examination_room_v1.submissions submission
          where submission.id = grade.submission_id
        ))
      )
    ) into bundle
    from examination_room_v1.grade_revisions grade
    where grade.id = p_snapshot.source_grade_revision_id;
  elsif p_snapshot.source_kind = 'result_release' then
    bundle := jsonb_build_object(
      'schemaVersion', 'examination-room/recovery-event/v1',
      'capturedAt', p_snapshot.created_at,
      'eventKind', 'result_release_batch',
      'institutionId', v_institution_id,
      'examId', p_snapshot.exam_id,
      'tables', jsonb_build_object(
        'gradeRevisions', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(grade) order by grade.created_at, grade.id)
          from examination_room_v1.grade_revisions grade
          where grade.id in (
            select release.grade_revision_id
            from examination_room_v1.result_releases release
            where release.batch_request_hash = p_snapshot.request_hash
              or (release.batch_request_hash is null and release.id = p_snapshot.source_result_release_id)
          )
        )),
        'gradeRevisionItems', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(item) order by item.created_at, item.grade_revision_id, item.question_id)
          from examination_room_v1.grade_revision_items item
          where item.grade_revision_id in (
            select release.grade_revision_id
            from examination_room_v1.result_releases release
            where release.batch_request_hash = p_snapshot.request_hash
              or (release.batch_request_hash is null and release.id = p_snapshot.source_result_release_id)
          )
        )),
        'resultReleases', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(release) order by release.occurred_at, release.id)
          from examination_room_v1.result_releases release
          where release.batch_request_hash = p_snapshot.request_hash
            or (release.batch_request_hash is null and release.id = p_snapshot.source_result_release_id)
        )),
        'submissions', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(submission) order by submission.received_at, submission.id)
          from examination_room_v1.submissions submission
          where submission.id in (
            select release.submission_id
            from examination_room_v1.result_releases release
            where release.batch_request_hash = p_snapshot.request_hash
              or (release.batch_request_hash is null and release.id = p_snapshot.source_result_release_id)
          )
        )),
        'studentSessions', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(session) order by session.started_at, session.id)
          from examination_room_v1.student_sessions session
          where session.id in (
            select submission.session_id
            from examination_room_v1.submissions submission
            join examination_room_v1.result_releases release on release.submission_id = submission.id
            where release.batch_request_hash = p_snapshot.request_hash
              or (release.batch_request_hash is null and release.id = p_snapshot.source_result_release_id)
          )
        )),
        'examRoster', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(roster) order by roster.id)
          from examination_room_v1.exam_roster roster
          where roster.id in (
            select session.roster_id
            from examination_room_v1.student_sessions session
            join examination_room_v1.submissions submission on submission.session_id = session.id
            join examination_room_v1.result_releases release on release.submission_id = submission.id
            where release.batch_request_hash = p_snapshot.request_hash
              or (release.batch_request_hash is null and release.id = p_snapshot.source_result_release_id)
          )
        )),
        'studentIdentities', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(identity) order by identity.id)
          from examination_room_v1.student_identities identity
          where identity.id in (
            select roster.student_identity_id
            from examination_room_v1.exam_roster roster
            join examination_room_v1.student_sessions session on session.roster_id = roster.id
            join examination_room_v1.submissions submission on submission.session_id = session.id
            join examination_room_v1.result_releases release on release.submission_id = submission.id
            where release.batch_request_hash = p_snapshot.request_hash
              or (release.batch_request_hash is null and release.id = p_snapshot.source_result_release_id)
          )
        )),
        'questions', examination_room_v1.json_rows((
          select jsonb_agg(to_jsonb(question) order by question.position, question.id)
          from examination_room_v1.questions question
          where question.exam_version_id = p_snapshot.exam_version_id
        ))
      )
    );
  else
    bundle := examination_room_v1.owner_exam_bundle(p_snapshot.exam_id);
  end if;

  return bundle;
end;
$$;

revoke all on function examination_room_v1.owner_snapshot_event_bundle(examination_room_v1.recovery_snapshots)
  from public, anon, authenticated, service_role;

create or replace function examination_room_v1.owner_snapshot_payload(p_snapshot_id uuid)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  snapshot examination_room_v1.recovery_snapshots%rowtype;
  bundle jsonb;
begin
  select * into snapshot
  from examination_room_v1.recovery_snapshots row_value
  where row_value.id = p_snapshot_id;
  if snapshot.id is null then return null; end if;

  bundle := case
    when snapshot.snapshot_scope = 'full_recovery' or snapshot.source_kind = 'manual'
      then examination_room_v1.owner_exam_bundle(snapshot.exam_id)
    else examination_room_v1.owner_snapshot_event_bundle(snapshot)
  end;
  return jsonb_build_object(
    'schemaVersion', 'examination-room/recovery-bundle/v1',
    'snapshot', to_jsonb(snapshot),
    'institutionId', (bundle ->> 'institutionId')::uuid,
    'examId', snapshot.exam_id,
    'examVersionId', snapshot.exam_version_id,
    'scope', snapshot.snapshot_scope,
    'sourceKind', snapshot.source_kind,
    'bundle', bundle
  );
end;
$$;

revoke all on function examination_room_v1.owner_snapshot_payload(uuid) from public, anon, authenticated, service_role;

create or replace function public.examination_room_v1_owner_query(
  p_operation text,
  p_actor_user_id uuid,
  p_institution_id uuid default null,
  p_exam_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  safe_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  row_limit integer := least(greatest(coalesce((p_payload ->> 'limit')::integer, 100), 1), 500);
  row_offset integer := greatest(coalesce((p_payload ->> 'offset')::integer, 0), 0);
  requested_snapshot_id uuid := nullif(p_payload ->> 'snapshotId', '')::uuid;
  bundle jsonb;
  response jsonb;
begin
  if not examination_room_v1.owner_authorized(p_actor_user_id) then
    return examination_room_v1.api_error(
      'PLATFORM_OWNER_REQUIRED',
      'Only a Founder or Super Admin can open the Examination Room command center.',
      403,
      'Sign in with a platform-owner account.'
    );
  end if;

  if jsonb_typeof(safe_payload) <> 'object' then
    return examination_room_v1.api_error(
      'INVALID_REQUEST', 'Command-center filters must be an object.', 400,
      'Refresh Admin and try again.'
    );
  end if;

  if p_operation = 'access' then
    return jsonb_build_object(
      'ok', true,
      'ownerOnly', true,
      'role', (select role from public.user_roles where user_id = p_actor_user_id),
      'institutions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'institutionId', institution.id,
          'institutionCode', institution.institution_code,
          'profileSchoolId', institution.profile_school_id,
          'institutionName', institution.institution_name,
          'institutionStatus', institution.institution_status,
          'professorCount', (
            select count(*) from examination_room_v1.staff_memberships membership
            where membership.institution_id = institution.id
              and membership.staff_role = 'professor'
              and membership.membership_status = 'active'
          ),
          'adminCount', (
            select count(*) from examination_room_v1.staff_memberships membership
            where membership.institution_id = institution.id
              and membership.staff_role = 'admin'
              and membership.membership_status = 'active'
          ),
          'examCount', (
            select count(*) from examination_room_v1.exams exam
            where exam.institution_id = institution.id
          )
        ) order by institution.institution_name)
        from examination_room_v1.institutions institution
      ), '[]'::jsonb)
    );
  end if;

  if p_operation in ('command_center', 'overview') then
    select jsonb_build_object(
      'ok', true,
      'ownerOnly', true,
      'institutionId', p_institution_id,
      'counts', jsonb_build_object(
        'institutions', (select count(*) from examination_room_v1.institutions),
        'exams', (
          select count(*) from examination_room_v1.exams exam
          where p_institution_id is null or exam.institution_id = p_institution_id
        ),
        'professorRequests', (
          select count(*) from examination_room_v1.professor_access_requests request
          where request.request_status = 'pending'
            and (p_institution_id is null or request.requested_institution_id = p_institution_id)
        ),
        'awaitingActivation', (
          select count(*) from examination_room_v1.exams exam
          where exam.status = 'published'
            and (p_institution_id is null or exam.institution_id = p_institution_id)
            and not exists (
              select 1 from examination_room_v1.room_activations activation
              where activation.exam_id = exam.id
                and activation.activation_status in ('scheduled', 'open')
            )
        ),
        'open', (
          select count(distinct activation.exam_id)
          from examination_room_v1.room_activations activation
          where activation.activation_status = 'open'
            and (p_institution_id is null or activation.institution_id = p_institution_id)
        ),
        'grading', (
          select count(*) from examination_room_v1.exams exam
          where exam.status = 'closed'
            and (p_institution_id is null or exam.institution_id = p_institution_id)
        ),
        'sessions', (
          select count(*) from examination_room_v1.student_sessions session
          where p_institution_id is null or session.institution_id = p_institution_id
        ),
        'submissions', (
          select count(*)
          from examination_room_v1.submissions submission
          join examination_room_v1.student_sessions session on session.id = submission.session_id
          where p_institution_id is null or session.institution_id = p_institution_id
        ),
        'failedBackups', (
          select count(*)
          from examination_room_v1.recovery_snapshots snapshot
          join examination_room_v1.exams exam on exam.id = snapshot.exam_id
          where snapshot.snapshot_status = 'failed'
            and (p_institution_id is null or exam.institution_id = p_institution_id)
        )
      ),
      'exams', coalesce((
        select jsonb_agg(
          item order by (item ->> 'updatedAt')::timestamptz desc, item ->> 'examId' desc
        )
        from (
          select jsonb_build_object(
            'examId', exam.id,
            'institutionId', exam.institution_id,
            'institutionName', institution.institution_name,
            'title', exam.title,
            'description', exam.description,
            'status', exam.status,
            'ownerUserId', exam.owner_user_id,
            'professorName', coalesce(professor.display_name, professor.email_normalized, 'Professor'),
            'professorEmail', professor.email_normalized,
            'anonymousGrading', exam.anonymous_grading,
            'questionCount', (
              select count(*) from examination_room_v1.questions question
              where question.exam_version_id = exam.current_published_version_id
            ),
            'rosterCount', (
              select count(*) from examination_room_v1.exam_roster roster where roster.exam_id = exam.id
            ),
            'sessionCount', (
              select count(*) from examination_room_v1.student_sessions session where session.exam_id = exam.id
            ),
            'submissionCount', (
              select count(*) from examination_room_v1.submissions submission
              join examination_room_v1.student_sessions session on session.id = submission.session_id
              where session.exam_id = exam.id
            ),
            'ungradedCount', (
              select count(*) from examination_room_v1.submissions submission
              join examination_room_v1.student_sessions session on session.id = submission.session_id
              where session.exam_id = exam.id
                and not exists (
                  select 1 from examination_room_v1.grade_revisions grade
                  where grade.submission_id = submission.id
                )
            ),
            'activation', activation.item,
            'keyAvailable', activation.key_available,
            'latestEmail', email_event.item,
            'backupStatus', backup.item,
            'createdAt', exam.created_at,
            'updatedAt', exam.updated_at
          ) item
          from examination_room_v1.exams exam
          join examination_room_v1.institutions institution on institution.id = exam.institution_id
          left join lateral (
            select
              jsonb_build_object(
                'id', room.id,
                'status', room.activation_status,
                'opensAt', room.opens_at,
                'closesAt', room.closes_at,
                'maxSessions', room.max_sessions,
                'createdAt', room.created_at
              ) item,
              exists (
                select 1 from examination_room_v1.owner_key_envelopes envelope
                where envelope.activation_id = room.id
              ) key_available
            from examination_room_v1.room_activations room
            where room.exam_id = exam.id
            order by room.created_at desc
            limit 1
          ) activation on true
          left join lateral (
            select jsonb_build_object(
              'status', event.provider_status,
              'attemptedAt', event.attempted_at,
              'professorRecipient', event.professor_recipient,
              'ownerCopyRecipients', event.owner_copy_recipients
            ) item
            from examination_room_v1.email_delivery_events event
            where event.exam_id = exam.id
            order by event.attempted_at desc
            limit 1
          ) email_event on true
          left join lateral (
            select jsonb_build_object(
              'id', snapshot.id,
              'status', snapshot.snapshot_status,
              'scope', snapshot.snapshot_scope,
              'sequence', snapshot.snapshot_sequence,
              'recordCount', snapshot.record_count,
              'updatedAt', snapshot.updated_at,
              'lastErrorCode', snapshot.last_error_code
            ) item
            from examination_room_v1.recovery_snapshots snapshot
            where snapshot.exam_id = exam.id
            order by snapshot.snapshot_sequence desc
            limit 1
          ) backup on true
          left join lateral (
            select
              coalesce(
                nullif(btrim(membership.display_name), ''),
                nullif(btrim(profile.display_name), ''),
                nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
                nullif(btrim(auth_user.raw_user_meta_data ->> 'name'), ''),
                nullif(pg_catalog.split_part(lower(auth_user.email), '@', 1), ''),
                'Examination creator'
              ) as display_name,
              coalesce(membership.email_normalized, lower(auth_user.email)) as email_normalized
            from auth.users auth_user
            left join public.profiles profile on profile.id = auth_user.id
            left join lateral (
              select row_value.display_name, row_value.email_normalized
              from examination_room_v1.staff_memberships row_value
              where row_value.institution_id = exam.institution_id
                and row_value.user_id = exam.owner_user_id
              order by (row_value.membership_status = 'active') desc,
                (row_value.staff_role = 'professor') desc,
                row_value.granted_at desc
              limit 1
            ) membership on true
            where auth_user.id = exam.owner_user_id
          ) professor on true
          where (p_institution_id is null or exam.institution_id = p_institution_id)
            and (p_exam_id is null or exam.id = p_exam_id)
          order by exam.updated_at desc
          limit row_limit offset row_offset
        ) listed
      ), '[]'::jsonb),
      'examTotal', (
        select count(*) from examination_room_v1.exams exam
        where (p_institution_id is null or exam.institution_id = p_institution_id)
          and (p_exam_id is null or exam.id = p_exam_id)
      ),
      'examHasMore', row_offset + row_limit < (
        select count(*) from examination_room_v1.exams exam
        where (p_institution_id is null or exam.institution_id = p_institution_id)
          and (p_exam_id is null or exam.id = p_exam_id)
      ),
      'examNextOffset', case
        when row_offset + row_limit < (
          select count(*) from examination_room_v1.exams exam
          where (p_institution_id is null or exam.institution_id = p_institution_id)
            and (p_exam_id is null or exam.id = p_exam_id)
        ) then row_offset + row_limit
        else null
      end,
      'limit', row_limit,
      'offset', row_offset,
      'professorRequests', coalesce((
        select jsonb_agg(jsonb_build_object(
          'requestId', request.id,
          'userId', request.user_id,
          'email', request.email_normalized,
          'displayName', request.display_name,
          'claimedSchoolId', request.claimed_school_id,
          'claimedSchoolName', request.claimed_school_name,
          'institutionId', request.requested_institution_id,
          'institutionName', institution.institution_name,
          'status', request.request_status,
          'requestedAt', request.requested_at
        ) order by request.requested_at)
        from examination_room_v1.professor_access_requests request
        join examination_room_v1.institutions institution on institution.id = request.requested_institution_id
        where request.request_status = 'pending'
          and (p_institution_id is null or request.requested_institution_id = p_institution_id)
      ), '[]'::jsonb),
      'snapshots', coalesce((
        select jsonb_agg(to_jsonb(snapshot) order by snapshot.updated_at desc)
        from (
          select recovery.*
          from examination_room_v1.recovery_snapshots recovery
          join examination_room_v1.exams exam on exam.id = recovery.exam_id
          where p_institution_id is null or exam.institution_id = p_institution_id
          order by recovery.updated_at desc
          limit 100
        ) snapshot
      ), '[]'::jsonb)
    ) into response;
    return response;
  end if;

  if p_operation in ('exam_detail', 'export_exam_bundle') then
    if p_exam_id is null then
      return examination_room_v1.api_error(
        'EXAM_NOT_FOUND', 'Choose an examination to inspect.', 404,
        'Return to the examination list and choose an exam.'
      );
    end if;
    bundle := examination_room_v1.owner_exam_bundle(p_exam_id);
    if bundle is null
       or (p_institution_id is not null and bundle ->> 'institutionId' <> p_institution_id::text) then
      return examination_room_v1.api_error(
        'EXAM_NOT_FOUND', 'That examination is not available in the selected school.', 404,
        'Refresh the school and examination lists.'
      );
    end if;
    return jsonb_build_object('ok', true, 'bundle', bundle);
  end if;

  if p_operation = 'key_envelope' then
    return coalesce((
      select jsonb_build_object(
        'ok', true,
        'activationId', envelope.activation_id,
        'examId', envelope.exam_id,
        'institutionId', envelope.institution_id,
        'algorithm', envelope.envelope_algorithm,
        'keyVersion', envelope.key_version,
        'ciphertext', envelope.ciphertext_base64,
        'iv', envelope.iv_base64,
        'aadSha256', envelope.aad_sha256,
        'createdAt', envelope.created_at
      )
      from examination_room_v1.owner_key_envelopes envelope
      join examination_room_v1.room_activations activation on activation.id = envelope.activation_id
      where (p_exam_id is null or envelope.exam_id = p_exam_id)
        and (p_institution_id is null or envelope.institution_id = p_institution_id)
        and activation.activation_status in ('scheduled', 'open')
      order by activation.created_at desc
      limit 1
    ), examination_room_v1.api_error(
      'ROOM_KEY_NOT_RECOVERABLE',
      'This activation predates owner key escrow or no current activation exists.', 409,
      'Choose Replace and email key once. The new key will remain viewable to platform owners.'
    ));
  end if;

  if p_operation = 'recovery_detail' then
    return jsonb_build_object(
      'ok', true,
      'snapshots', coalesce((
        select jsonb_agg(to_jsonb(listed) order by listed.snapshot_sequence desc, listed.id desc)
        from (
          select snapshot.*
          from examination_room_v1.recovery_snapshots snapshot
          join examination_room_v1.exams exam on exam.id = snapshot.exam_id
          where (p_exam_id is null or snapshot.exam_id = p_exam_id)
            and (p_institution_id is null or exam.institution_id = p_institution_id)
            and (requested_snapshot_id is null or snapshot.id = requested_snapshot_id)
          order by snapshot.snapshot_sequence desc, snapshot.id desc
          limit row_limit offset row_offset
        ) listed
      ), '[]'::jsonb),
      'total', (
        select count(*)
        from examination_room_v1.recovery_snapshots snapshot
        join examination_room_v1.exams exam on exam.id = snapshot.exam_id
        where (p_exam_id is null or snapshot.exam_id = p_exam_id)
          and (p_institution_id is null or exam.institution_id = p_institution_id)
          and (requested_snapshot_id is null or snapshot.id = requested_snapshot_id)
      ),
      'hasMore', row_offset + row_limit < (
        select count(*)
        from examination_room_v1.recovery_snapshots snapshot
        join examination_room_v1.exams exam on exam.id = snapshot.exam_id
        where (p_exam_id is null or snapshot.exam_id = p_exam_id)
          and (p_institution_id is null or exam.institution_id = p_institution_id)
          and (requested_snapshot_id is null or snapshot.id = requested_snapshot_id)
      ),
      'nextOffset', case when row_offset + row_limit < (
        select count(*)
        from examination_room_v1.recovery_snapshots snapshot
        join examination_room_v1.exams exam on exam.id = snapshot.exam_id
        where (p_exam_id is null or snapshot.exam_id = p_exam_id)
          and (p_institution_id is null or exam.institution_id = p_institution_id)
          and (requested_snapshot_id is null or snapshot.id = requested_snapshot_id)
      ) then row_offset + row_limit else null end,
      'limit', row_limit,
      'offset', row_offset
    );
  end if;

  if p_operation = 'audit_log' then
    return jsonb_build_object(
      'ok', true,
      'items', coalesce((
        select jsonb_agg(to_jsonb(event) order by event.occurred_at desc, event.id desc)
        from (
          select audit.*
          from examination_room_v1.audit_events audit
          where (p_exam_id is null or audit.exam_id = p_exam_id)
            and (p_institution_id is null or audit.institution_id = p_institution_id)
          order by audit.occurred_at desc, audit.id desc
          limit row_limit offset row_offset
        ) event
      ), '[]'::jsonb),
      'total', (
        select count(*) from examination_room_v1.audit_events audit
        where (p_exam_id is null or audit.exam_id = p_exam_id)
          and (p_institution_id is null or audit.institution_id = p_institution_id)
      ),
      'hasMore', row_offset + row_limit < (
        select count(*) from examination_room_v1.audit_events audit
        where (p_exam_id is null or audit.exam_id = p_exam_id)
          and (p_institution_id is null or audit.institution_id = p_institution_id)
      ),
      'nextOffset', case when row_offset + row_limit < (
        select count(*) from examination_room_v1.audit_events audit
        where (p_exam_id is null or audit.exam_id = p_exam_id)
          and (p_institution_id is null or audit.institution_id = p_institution_id)
      ) then row_offset + row_limit else null end,
      'limit', row_limit,
      'offset', row_offset
    );
  end if;

  return examination_room_v1.api_error(
    'UNKNOWN_OPERATION', 'That owner command-center view is not available.', 400,
    'Refresh Admin and choose a listed view.'
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return examination_room_v1.api_error(
      'INVALID_REQUEST', 'A command-center filter is invalid.', 400,
      'Clear the filters and try again.'
    );
end;
$$;

revoke all on function public.examination_room_v1_owner_query(text, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.examination_room_v1_owner_query(text, uuid, uuid, uuid, jsonb)
  to service_role;

create or replace function public.examination_room_v1_owner_ensure_membership(
  p_actor_user_id uuid,
  p_institution_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  membership_id uuid;
  actor_email text;
  actor_name text;
begin
  if not examination_room_v1.owner_authorized(p_actor_user_id) then
    return examination_room_v1.api_error(
      'PLATFORM_OWNER_REQUIRED', 'Only a Founder or Super Admin can administer Examination Room.', 403,
      'Sign in with a platform-owner account.'
    );
  end if;
  if not exists (
    select 1 from examination_room_v1.institutions institution
    where institution.id = p_institution_id and institution.institution_status = 'active'
  ) then
    return examination_room_v1.api_error(
      'INSTITUTION_NOT_FOUND', 'That law-school workspace is unavailable.', 404,
      'Refresh the institution list and choose an active school.'
    );
  end if;

  select membership.id into membership_id
  from examination_room_v1.staff_memberships membership
  where membership.institution_id = p_institution_id
    and membership.user_id = p_actor_user_id
    and membership.staff_role = 'admin'
    and membership.membership_status = 'active'
  order by membership.granted_at desc
  limit 1;
  if membership_id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'membershipId', membership_id);
  end if;

  select lower(auth_user.email), coalesce(profile.display_name, auth_user.raw_user_meta_data ->> 'full_name', auth_user.email)
  into actor_email, actor_name
  from auth.users auth_user
  left join public.profiles profile on profile.id = auth_user.id
  where auth_user.id = p_actor_user_id;

  insert into examination_room_v1.staff_memberships (
    institution_id, user_id, staff_role, display_name, email_normalized,
    membership_status, grant_reason, granted_by_user_id
  ) values (
    p_institution_id, p_actor_user_id, 'admin', actor_name, actor_email,
    'active', 'Platform owner command-center access.', p_actor_user_id
  ) returning id into membership_id;

  return jsonb_build_object('ok', true, 'duplicate', false, 'membershipId', membership_id);
end;
$$;

revoke all on function public.examination_room_v1_owner_ensure_membership(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.examination_room_v1_owner_ensure_membership(uuid, uuid)
  to service_role;

create or replace function public.examination_room_v1_owner_command(
  p_operation text,
  p_actor_user_id uuid,
  p_institution_id uuid,
  p_exam_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  safe_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  request_hash text := p_payload ->> 'requestHash';
  event_time timestamptz := clock_timestamp();
  activation_id uuid;
  target_identity_id uuid;
  correction_id uuid;
  target_submission_id uuid;
  snapshot_id uuid;
  snapshot_status text;
  response jsonb;
  before_record jsonb;
  after_record jsonb;
  persisted_delivery examination_room_v1.email_delivery_events%rowtype;
  restored_count bigint := 0;
  affected_count bigint := 0;
  replay jsonb;
begin
  if not examination_room_v1.owner_authorized(p_actor_user_id) then
    return examination_room_v1.api_error(
      'PLATFORM_OWNER_REQUIRED', 'Only a Founder or Super Admin can control Examination Room.', 403,
      'Sign in with a platform-owner account.'
    );
  end if;
  if jsonb_typeof(safe_payload) <> 'object' then
    return examination_room_v1.api_error(
      'INVALID_REQUEST', 'Owner command details must be an object.', 400,
      'Refresh Admin and try again.'
    );
  end if;

  if p_operation = 'store_key_envelope' then
    activation_id := nullif(safe_payload ->> 'activationId', '')::uuid;
    if not exists (
      select 1 from examination_room_v1.room_activations activation
      where activation.id = activation_id
        and activation.exam_id = p_exam_id
        and activation.institution_id = p_institution_id
    ) then
      return examination_room_v1.api_error(
        'ROOM_ACTIVATION_NOT_FOUND', 'The key cannot be bound to that room activation.', 409,
        'Refresh the examination and issue a new key.'
      );
    end if;

    insert into examination_room_v1.owner_key_envelopes (
      activation_id, exam_id, institution_id, envelope_algorithm, key_version,
      ciphertext_base64, iv_base64, aad_sha256, created_by_user_id
    ) values (
      activation_id, p_exam_id, p_institution_id,
      coalesce(safe_payload ->> 'algorithm', 'aes-256-gcm-v1'),
      coalesce((safe_payload ->> 'keyVersion')::integer, 1),
      safe_payload ->> 'ciphertext', safe_payload ->> 'iv', safe_payload ->> 'aadSha256',
      p_actor_user_id
    ) on conflict on constraint owner_key_envelopes_pkey do nothing;

    if not exists (
      select 1 from examination_room_v1.owner_key_envelopes envelope
      where envelope.activation_id = activation_id
        and envelope.ciphertext_base64 = safe_payload ->> 'ciphertext'
        and envelope.iv_base64 = safe_payload ->> 'iv'
        and envelope.aad_sha256 = safe_payload ->> 'aadSha256'
    ) then
      return examination_room_v1.api_error(
        'KEY_ESCROW_CONFLICT', 'A different encrypted key is already bound to this activation.', 409,
        'Refresh Admin. Replace the room key only through the Rotate action.'
      );
    end if;
    return jsonb_build_object('ok', true, 'activationId', activation_id, 'escrowed', true);
  end if;

  if p_operation = 'record_email_delivery' then
    activation_id := nullif(safe_payload ->> 'activationId', '')::uuid;
    insert into examination_room_v1.email_delivery_events as persisted (
      institution_id, exam_id, activation_id, request_hash, delivery_kind,
      professor_recipient, owner_copy_recipients, provider_status, provider_id,
      safe_error_code, attempted_by_user_id, attempted_at
    ) values (
      p_institution_id, p_exam_id, activation_id, request_hash,
      coalesce(safe_payload ->> 'deliveryKind', 'activation_key'),
      lower(safe_payload ->> 'professorRecipient'),
      coalesce(safe_payload -> 'ownerCopyRecipients', '[]'::jsonb),
      safe_payload ->> 'providerStatus',
      nullif(safe_payload ->> 'providerId', ''),
      nullif(safe_payload ->> 'safeErrorCode', ''),
      p_actor_user_id,
      coalesce((safe_payload ->> 'attemptedAt')::timestamptz, event_time)
    ) on conflict on constraint email_delivery_events_request_hash_key do update
      set provider_status = excluded.provider_status,
          provider_id = excluded.provider_id,
          safe_error_code = excluded.safe_error_code,
          attempted_by_user_id = excluded.attempted_by_user_id,
          attempted_at = excluded.attempted_at
      where persisted.institution_id = excluded.institution_id
        and persisted.exam_id = excluded.exam_id
        and persisted.activation_id is not distinct from excluded.activation_id
        and persisted.delivery_kind = excluded.delivery_kind
        and persisted.professor_recipient = excluded.professor_recipient
        and persisted.owner_copy_recipients = excluded.owner_copy_recipients
        and persisted.provider_status in ('failed', 'not_configured')
        and excluded.provider_status = 'sent'
      returning persisted.* into persisted_delivery;

    -- ON CONFLICT ... WHERE intentionally returns no row for a no-op retry or
    -- an attempted downgrade. Read the already-persisted evidence so the
    -- Worker reports database truth rather than the latest transport attempt.
    if persisted_delivery.id is null then
      select event.*
      into persisted_delivery
      from examination_room_v1.email_delivery_events event
      where event.request_hash = request_hash;
    end if;

    if persisted_delivery.id is null then
      return examination_room_v1.api_error(
        'EMAIL_DELIVERY_AUDIT_NOT_RECORDED', 'The email-delivery audit result could not be recorded.', 409,
        'Retry Resend existing key. The room key itself has not changed.'
      );
    end if;

    if persisted_delivery.institution_id is distinct from p_institution_id
       or persisted_delivery.exam_id is distinct from p_exam_id
       or persisted_delivery.activation_id is distinct from activation_id
       or persisted_delivery.delivery_kind is distinct from coalesce(safe_payload ->> 'deliveryKind', 'activation_key')
       or persisted_delivery.professor_recipient is distinct from lower(safe_payload ->> 'professorRecipient')
       or persisted_delivery.owner_copy_recipients is distinct from coalesce(safe_payload -> 'ownerCopyRecipients', '[]'::jsonb) then
      return examination_room_v1.api_error(
        'EMAIL_DELIVERY_AUDIT_CONFLICT', 'That retry identifier is already bound to different email-delivery evidence.', 409,
        'Refresh Admin and retry Resend existing key with the current examination record.'
      );
    end if;

    return jsonb_build_object(
      'ok', true,
      'recorded', true,
      'requestHash', request_hash,
      'providerStatus', persisted_delivery.provider_status,
      'providerId', persisted_delivery.provider_id,
      'safeErrorCode', persisted_delivery.safe_error_code,
      'attemptedAt', persisted_delivery.attempted_at
    );
  end if;

  if p_operation = 'correct_student_identity' then
    target_identity_id := nullif(safe_payload ->> 'studentIdentityId', '')::uuid;
    if safe_payload ? 'clearEmail'
       and jsonb_typeof(safe_payload -> 'clearEmail') <> 'boolean' then
      return examination_room_v1.api_error(
        'STUDENT_EMAIL_CLEAR_INVALID', 'The remove-email choice must be true or false.', 400,
        'Refresh Students and choose the explicit Remove stored student email option again.'
      );
    end if;
    if coalesce((safe_payload ->> 'clearEmail')::boolean, false)
       and nullif(btrim(safe_payload ->> 'email'), '') is not null then
      return examination_room_v1.api_error(
        'STUDENT_EMAIL_ACTION_CONFLICT', 'A corrected email and remove-email choice cannot be applied together.', 400,
        'Choose either the corrected email or Remove stored student email.'
      );
    end if;
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(
      p_institution_id, request_hash, 'owner.correct_student_identity'
    );
    if replay is not null then return replay; end if;
    select jsonb_build_object(
      'fullName', identity.full_name,
      'studentNumber', identity.external_student_id,
      'email', identity.email_normalized,
      'verificationMethod', identity.verification_method,
      'verifiedAt', identity.verified_at
    ) into before_record
    from examination_room_v1.student_identities identity
    where identity.id = target_identity_id
      and identity.institution_id = p_institution_id
      and exists (
        select 1 from examination_room_v1.exam_roster roster
        where roster.exam_id = p_exam_id and roster.student_identity_id = identity.id
      )
    for update;
    if before_record is null then
      return examination_room_v1.api_error(
        'STUDENT_NOT_FOUND', 'That student record is no longer in this examination.', 404,
        'Refresh Students and choose the current record.'
      );
    end if;
    update examination_room_v1.student_identities identity
    set full_name = coalesce(nullif(btrim(safe_payload ->> 'fullName'), ''), identity.full_name),
        external_student_id = coalesce(nullif(btrim(safe_payload ->> 'studentNumber'), ''), identity.external_student_id),
        email_normalized = case
          when coalesce((safe_payload ->> 'clearEmail')::boolean, false) then null
          else coalesce(nullif(lower(btrim(safe_payload ->> 'email')), ''), identity.email_normalized)
        end,
        verification_method = 'admin_review',
        verified_at = event_time
    where identity.id = target_identity_id
      and identity.institution_id = p_institution_id
      and exists (
        select 1 from examination_room_v1.exam_roster roster
        where roster.exam_id = p_exam_id and roster.student_identity_id = identity.id
      );
    get diagnostics affected_count = row_count;
    if affected_count = 0 then
      return examination_room_v1.api_error(
        'STUDENT_NOT_FOUND', 'That student record is no longer in this examination.', 404,
        'Refresh Students and choose the current record.'
      );
    end if;
    select jsonb_build_object(
      'fullName', identity.full_name,
      'studentNumber', identity.external_student_id,
      'email', identity.email_normalized,
      'verificationMethod', identity.verification_method,
      'verifiedAt', identity.verified_at
    ) into after_record
    from examination_room_v1.student_identities identity
    where identity.id = target_identity_id;

    correction_id := gen_random_uuid();
    insert into examination_room_v1.owner_identity_corrections (
      id, institution_id, exam_id, student_identity_id, request_hash,
      before_record, after_record, reason, corrected_by_user_id, corrected_at
    ) values (
      correction_id, p_institution_id, p_exam_id, target_identity_id, request_hash,
      before_record, after_record,
      coalesce(nullif(btrim(safe_payload ->> 'reason'), ''), 'Platform owner corrected examination identity data.'),
      p_actor_user_id, event_time
    );

    insert into examination_room_v1.recovery_snapshots (
      id, exam_id, exam_version_id, snapshot_sequence, snapshot_scope, request_hash,
      record_count, snapshot_status, created_by_user_id, retention_until, source_kind
    )
    select
      gen_random_uuid(), exam.id, exam.current_published_version_id,
      examination_room_v1.next_snapshot_sequence(exam.id),
      'full_recovery', request_hash, 1, 'pending', p_actor_user_id,
      event_time + interval '365 days', 'manual'
    from examination_room_v1.exams exam
    where exam.id = p_exam_id
      and exam.institution_id = p_institution_id
      and exam.current_published_version_id is not null;
    get diagnostics affected_count = row_count;

    response := jsonb_build_object(
      'ok', true,
      'studentIdentityId', target_identity_id,
      'correctionId', correction_id,
      'corrected', true,
      'before', before_record,
      'after', after_record,
      'emailCleared', coalesce((safe_payload ->> 'clearEmail')::boolean, false),
      'recoveryQueued', affected_count = 1,
      'reason', coalesce(nullif(btrim(safe_payload ->> 'reason'), ''), 'Platform owner corrected examination identity data.')
    );
    perform examination_room_v1.api_record_audit(
      p_institution_id, p_exam_id, null, p_actor_user_id, 'admin',
      'owner.correct_student_identity', 'student_identity', target_identity_id,
      request_hash, event_time, response, correction_id
    );
    return response;
  end if;

  if p_operation = 'set_submission_status' then
    target_submission_id := nullif(safe_payload ->> 'submissionId', '')::uuid;
    if coalesce(safe_payload ->> 'status', '') not in ('accepted', 'under_review', 'voided') then
      return examination_room_v1.api_error(
        'SUBMISSION_STATUS_INVALID', 'Choose Accepted, Under review, or Voided.', 400,
        'Choose one listed submission status.'
      );
    end if;
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(
      p_institution_id, request_hash, 'owner.set_submission_status'
    );
    if replay is not null then return replay; end if;
    update examination_room_v1.submissions submission
    set submission_status = safe_payload ->> 'status',
        status_reason = case when safe_payload ->> 'status' = 'accepted'
          then null else coalesce(nullif(btrim(safe_payload ->> 'reason'), ''), 'Platform owner review.') end,
        status_changed_by_user_id = p_actor_user_id
    from examination_room_v1.student_sessions session
    where submission.id = target_submission_id
      and session.id = submission.session_id
      and session.exam_id = p_exam_id
      and session.institution_id = p_institution_id;
    get diagnostics affected_count = row_count;
    if affected_count = 0 then
      return examination_room_v1.api_error(
        'SUBMISSION_NOT_FOUND', 'That submission is no longer available.', 404,
        'Refresh Answers and choose the current submission.'
      );
    end if;
    response := jsonb_build_object(
      'ok', true, 'submissionId', target_submission_id,
      'status', safe_payload ->> 'status',
      'reason', coalesce(safe_payload ->> 'reason', 'Platform owner review.')
    );
    perform examination_room_v1.api_record_audit(
      p_institution_id, p_exam_id, null, p_actor_user_id, 'admin',
      'owner.set_submission_status', 'submission', target_submission_id,
      request_hash, event_time, response, null
    );
    return response;
  end if;

  if p_operation = 'room_control' then
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(
      p_institution_id, request_hash, 'owner.room_' || coalesce(safe_payload ->> 'action', '')
    );
    if replay is not null then return replay; end if;
    if safe_payload ->> 'action' = 'open' then
      update examination_room_v1.room_activations activation
      set activation_status = 'open', opens_at = least(activation.opens_at, event_time)
      where activation.exam_id = p_exam_id
        and activation.institution_id = p_institution_id
        and activation.activation_status = 'scheduled'
        and activation.closes_at > event_time;
      get diagnostics affected_count = row_count;
      if affected_count = 0 then
        return examination_room_v1.api_error(
          'ROOM_OPEN_STATE_INVALID', 'The room could not be opened from its current state.', 409,
          'Refresh Examinations. Issue a current key first, or confirm that the scheduled closing time has not passed.'
        );
      end if;
      response := jsonb_build_object('ok', true, 'examId', p_exam_id, 'status', 'open');
    elsif safe_payload ->> 'action' = 'close' then
      update examination_room_v1.room_activations activation
      set activation_status = 'closed',
          deactivated_at = event_time,
          deactivated_by_user_id = p_actor_user_id,
          deactivation_reason = coalesce(nullif(btrim(safe_payload ->> 'reason'), ''), 'Platform owner closed the room.')
      where activation.exam_id = p_exam_id
        and activation.institution_id = p_institution_id
        and activation.activation_status in ('scheduled', 'open');
      get diagnostics affected_count = row_count;
      if affected_count = 0 then
        return examination_room_v1.api_error(
          'ROOM_CLOSE_STATE_INVALID', 'The room is already closed or has no active key.', 409,
          'Refresh Examinations to see the current room state.'
        );
      end if;
      update examination_room_v1.student_sessions session
      set session_status = 'expired', ended_at = coalesce(session.ended_at, event_time)
      where session.exam_id = p_exam_id
        and session.institution_id = p_institution_id
        and session.session_status in ('created', 'active');
      update examination_room_v1.exams exam
      set status = 'closed', closed_at = event_time
      where exam.id = p_exam_id and exam.institution_id = p_institution_id
        and exam.status in ('published', 'closed');
      response := jsonb_build_object('ok', true, 'examId', p_exam_id, 'status', 'closed');
    else
      return examination_room_v1.api_error(
        'ROOM_ACTION_INVALID', 'Choose Open room or Close room.', 400,
        'Choose one listed room control.'
      );
    end if;
    perform examination_room_v1.api_record_audit(
      p_institution_id, p_exam_id, null, p_actor_user_id, 'admin',
      'owner.room_' || (safe_payload ->> 'action'), 'exam', p_exam_id,
      request_hash, event_time, response, null
    );
    return response;
  end if;

  if p_operation = 'retry_snapshot' then
    snapshot_id := nullif(safe_payload ->> 'snapshotId', '')::uuid;
    update examination_room_v1.recovery_snapshots snapshot
    set snapshot_status = 'pending',
        next_retry_at = null,
        last_error_code = null,
        last_error_at = null
    from examination_room_v1.exams exam
    where snapshot.id = snapshot_id
      and snapshot.snapshot_status = 'failed'
      and exam.id = snapshot.exam_id
      and exam.institution_id = p_institution_id
      and (p_exam_id is null or exam.id = p_exam_id);
    get diagnostics affected_count = row_count;
    return jsonb_build_object('ok', true, 'snapshotId', snapshot_id, 'queued', affected_count = 1);
  end if;

  if p_operation = 'begin_restore' then
    snapshot_id := nullif(safe_payload ->> 'snapshotId', '')::uuid;
    update examination_room_v1.recovery_snapshots snapshot
    set snapshot_status = 'restoring', verified_at = event_time
    from examination_room_v1.exams exam
    where snapshot.id = snapshot_id
      and snapshot.snapshot_status = 'available'
      and exam.id = snapshot.exam_id
      and exam.institution_id = p_institution_id
      and (p_exam_id is null or exam.id = p_exam_id);
    get diagnostics affected_count = row_count;
    if affected_count = 0 then
      return examination_room_v1.api_error(
        'SNAPSHOT_NOT_AVAILABLE', 'That recovery snapshot is not available to restore.', 409,
        'Refresh Recovery, retry any failed backup, then verify it again.'
      );
    end if;
    return jsonb_build_object('ok', true, 'snapshotId', snapshot_id, 'status', 'restoring');
  end if;

  if p_operation = 'complete_restore' then
    snapshot_id := nullif(safe_payload ->> 'snapshotId', '')::uuid;
    update examination_room_v1.recovery_snapshots snapshot
    set snapshot_status = 'restored',
        restored_at = event_time,
        restored_by_user_id = p_actor_user_id,
        restored_record_count = coalesce((safe_payload ->> 'restoredRecordCount')::bigint, 0),
        restore_verification_sha256 = safe_payload ->> 'verificationSha256'
    from examination_room_v1.exams exam
    where snapshot.id = snapshot_id
      and snapshot.snapshot_status = 'restoring'
      and exam.id = snapshot.exam_id
      and exam.institution_id = p_institution_id
      and (p_exam_id is null or exam.id = p_exam_id);
    get diagnostics affected_count = row_count;
    if affected_count = 0 then
      return examination_room_v1.api_error(
        'SNAPSHOT_RESTORE_STATE_INVALID', 'The restore state changed before completion.', 409,
        'Refresh Recovery and verify the current snapshot state.'
      );
    end if;
    return jsonb_build_object(
      'ok', true, 'snapshotId', snapshot_id, 'status', 'restored',
      'restoredRecordCount', coalesce((safe_payload ->> 'restoredRecordCount')::bigint, 0)
    );
  end if;

  return examination_room_v1.api_error(
    'UNKNOWN_OPERATION', 'That owner command-center action is not available.', 400,
    'Refresh Admin and choose a listed action.'
  );
exception
  when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    return examination_room_v1.api_error(
      'INVALID_REQUEST', 'One or more owner command values are invalid.', 400,
      'Refresh the record, correct the highlighted value, and try again.'
    );
  when unique_violation then
    return examination_room_v1.api_error(
      'PERSISTENCE_CONFLICT', 'A newer record already uses that value.', 409,
      'Refresh the command center before applying the correction again.'
    );
end;
$$;

revoke all on function public.examination_room_v1_owner_command(text, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.examination_room_v1_owner_command(text, uuid, uuid, uuid, jsonb)
  to service_role;

-- Resolve every student context for an offline grade import in one database
-- call. This keeps large classes within Cloudflare's free-tier subrequest
-- budget while retaining the same examination, submission, question, and
-- grading-history validation used by online grading.
create or replace function public.examination_room_v1_grading_contexts(
  p_actor_user_id uuid,
  p_institution_id uuid,
  p_exam_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  safe_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  requests jsonb;
  request_item jsonb;
  request_count integer;
  reference_count integer := 0;
  actor_is_platform_owner boolean;
  actor_is_creator boolean;
  response jsonb;
begin
  if jsonb_typeof(safe_payload) <> 'object'
     or jsonb_typeof(safe_payload -> 'requests') <> 'array' then
    return examination_room_v1.api_error(
      'GRADING_CONTEXT_REQUEST_INVALID',
      'The offline grading context request is incomplete.', 400,
      'Export a new graded copy from the Due Diligence offline grader, then import it again.'
    );
  end if;

  requests := safe_payload -> 'requests';
  request_count := jsonb_array_length(requests);
  if request_count < 1 or request_count > 1000 then
    return examination_room_v1.api_error(
      'GRADING_CONTEXT_SIZE_INVALID',
      'Request between 1 and 1,000 student grading contexts at a time.', 400,
      'Import the graded copy for one examination and class section.'
    );
  end if;

  for request_item in select item.value from jsonb_array_elements(requests) item(value)
  loop
    if jsonb_typeof(request_item) <> 'object'
       or nullif(request_item ->> 'sessionId', '') is null
       or jsonb_typeof(request_item -> 'questionReferences') <> 'array'
       or jsonb_array_length(request_item -> 'questionReferences') < 1 then
      return examination_room_v1.api_error(
        'GRADING_CONTEXT_REQUEST_INVALID',
        'Each offline grading context needs one student and at least one question.', 400,
        'Export the graded copy again from the Due Diligence offline grader.'
      );
    end if;
    perform (request_item ->> 'sessionId')::uuid;
    if exists (
      select 1
      from jsonb_array_elements(request_item -> 'questionReferences') reference(value)
      where jsonb_typeof(reference.value) <> 'string'
        or nullif(btrim(reference.value #>> '{}'), '') is null
    ) then
      return examination_room_v1.api_error(
        'GRADING_CONTEXT_REQUEST_INVALID',
        'One or more offline grade entries has no valid question reference.', 400,
        'Export the graded copy again after saving complete grades.'
      );
    end if;
    reference_count := reference_count + jsonb_array_length(request_item -> 'questionReferences');
  end loop;

  if reference_count > 1000 then
    return examination_room_v1.api_error(
      'GRADING_CONTEXT_SIZE_INVALID',
      'An offline import may contain at most 1,000 question grades.', 400,
      'Import the graded copy for one examination and class section.'
    );
  end if;

  if (
    select count(distinct item.value ->> 'sessionId')
    from jsonb_array_elements(requests) item(value)
  ) <> request_count then
    return examination_room_v1.api_error(
      'GRADING_CONTEXT_DUPLICATE_STUDENT',
      'The offline import lists the same student more than once.', 409,
      'Export a fresh graded copy and retry the complete import.'
    );
  end if;

  actor_is_platform_owner := examination_room_v1.owner_authorized(p_actor_user_id);
  actor_is_creator := examination_room_v1.creator_authorized(
    p_actor_user_id, p_institution_id
  );

  if not (actor_is_creator or actor_is_platform_owner) then
    return examination_room_v1.api_error(
      'CREATOR_WORKSPACE_REQUIRED',
      'This signed-in account has no active examination workspace.', 403,
      'Choose an active law-school workspace, then retry the import.'
    );
  end if;

  if not exists (
    select 1
    from examination_room_v1.exams exam
    where exam.id = p_exam_id
      and exam.institution_id = p_institution_id
      and (
        (actor_is_creator and exam.owner_user_id = p_actor_user_id)
        or actor_is_platform_owner
      )
  ) then
    return examination_room_v1.api_error(
      'EXAM_NOT_FOUND',
      'That examination is not available to this Professor or platform owner.', 404,
      'Open the matching examination and import its graded copy again.'
    );
  end if;

  select jsonb_build_object(
    'ok', true,
    'contexts', coalesce(jsonb_agg(context.item order by context.ordinality), '[]'::jsonb)
  )
  into response
  from (
    select
      requested.ordinality,
      jsonb_build_object(
        'sessionId', requested.value ->> 'sessionId',
        'publicationManifest', version.publication_manifest,
        'submissionManifest', examination_room_v1.grader_safe_submission_manifest(
          submission.submission_manifest,
          exam.anonymous_grading,
          roster.grading_alias,
          examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
        ) || jsonb_build_object('idempotencyKey', submission.idempotency_key_hash),
        'scores', coalesce(latest_grade.scores, '[]'::jsonb),
        'nextRevision', coalesce(latest_grade.revision_number, 0) + 1,
        'overallFeedback', coalesce(latest_grade.general_feedback, '')
      ) as item
    from jsonb_array_elements(requests) with ordinality requested(value, ordinality)
    join examination_room_v1.student_sessions session on true
    join examination_room_v1.submissions submission
      on submission.session_id = session.id
     and submission.submission_status = 'accepted'
    join examination_room_v1.exams exam
      on exam.id = session.exam_id
     and exam.id = p_exam_id
     and exam.institution_id = p_institution_id
    join examination_room_v1.exam_versions version
      on version.id = submission.exam_version_id
     and version.publication_status = 'published'
    join examination_room_v1.exam_roster roster on roster.id = session.roster_id
    left join lateral (
      select
        grade.revision_number,
        grade.general_feedback,
        (
          select jsonb_agg(jsonb_build_object(
            'questionNumber', question.position,
            'pointsAwarded', item.score,
            'feedback', coalesce(item.feedback, '')
          ) order by question.position)
          from examination_room_v1.grade_revision_items item
          join examination_room_v1.questions question on question.id = item.question_id
          where item.grade_revision_id = grade.id
        ) as scores
      from examination_room_v1.grade_revisions grade
      where grade.submission_id = submission.id
      order by grade.revision_number desc
      limit 1
    ) latest_grade on true
    where session.institution_id = p_institution_id
      and (
        (not exam.anonymous_grading and session.id = (requested.value ->> 'sessionId')::uuid)
        or (
          exam.anonymous_grading
          and examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            = (requested.value ->> 'sessionId')::uuid
        )
      )
      and not exists (
        select 1
        from jsonb_array_elements_text(requested.value -> 'questionReferences') reference(value)
        where not exists (
          select 1
          from examination_room_v1.questions question
          where question.exam_version_id = submission.exam_version_id
            and (
              question.question_key = reference.value
              or question.position::text = reference.value
              or 'q-' || question.position::text = reference.value
            )
        )
      )
  ) context;

  if jsonb_array_length(response -> 'contexts') <> request_count then
    return examination_room_v1.api_error(
      'GRADING_CONTEXT_INVALID',
      'One or more students, submissions, or questions does not belong to this examination.', 409,
      'Refresh online grading, export a new offline copy, then import that matching copy.'
    );
  end if;

  return response;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return examination_room_v1.api_error(
      'GRADING_CONTEXT_REQUEST_INVALID',
      'One or more offline grading identifiers is invalid.', 400,
      'Export the graded copy again from the matching examination.'
    );
end;
$$;

revoke all on function public.examination_room_v1_grading_contexts(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.examination_room_v1_grading_contexts(uuid, uuid, uuid, jsonb)
  to service_role;

-- A Professor's offline grading import is one database transaction.  Every
-- entry is first normalized and cryptographically bound by the Worker using
-- the same manifest path as an online save_grade command.  Any rejected entry
-- rolls the entire batch back, so a connection failure can never leave an
-- unknowable partially imported package.
create or replace function public.examination_room_v1_import_grades(
  p_actor_user_id uuid,
  p_institution_id uuid,
  p_exam_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  safe_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  grade_entries jsonb;
  grade_entry jsonb;
  grade_response jsonb;
  receipts jsonb := '[]'::jsonb;
  batch_request_hash text := p_payload ->> 'requestHash';
  failed_code text;
  failed_index integer;
  grade_count integer;
  grade_index integer;
  actor_is_platform_owner boolean;
  actor_is_creator boolean;
begin
  if jsonb_typeof(safe_payload) <> 'object' then
    return examination_room_v1.api_error(
      'GRADE_IMPORT_INVALID', 'The offline grading import must be a structured package.', 400,
      'Export the graded copy again from the Due Diligence offline grader.'
    );
  end if;
  actor_is_platform_owner := examination_room_v1.owner_authorized(p_actor_user_id);
  actor_is_creator := examination_room_v1.creator_authorized(
    p_actor_user_id, p_institution_id
  );

  if not (actor_is_creator or actor_is_platform_owner) then
    return examination_room_v1.api_error(
      'CREATOR_WORKSPACE_REQUIRED', 'This signed-in account has no active examination workspace.', 403,
      'Choose an active law-school workspace, then retry the import.'
    );
  end if;
  if not exists (
    select 1 from examination_room_v1.exams exam
    where exam.id = p_exam_id
      and exam.institution_id = p_institution_id
      and (
        (actor_is_creator and exam.owner_user_id = p_actor_user_id)
        or actor_is_platform_owner
      )
  ) then
    return examination_room_v1.api_error(
      'EXAM_NOT_FOUND', 'That examination is not available to this Professor.', 404,
      'Open the matching examination and import its graded copy again.'
    );
  end if;
  if batch_request_hash is null or batch_request_hash !~ '^[0-9a-f]{64}$' then
    return examination_room_v1.api_error(
      'REQUEST_HASH_INVALID', 'The offline import receipt is missing or invalid.', 400,
      'Choose Import again so the page can create a fresh retry-safe receipt.'
    );
  end if;

  grade_entries := safe_payload -> 'grades';
  if jsonb_typeof(grade_entries) <> 'array' then
    return examination_room_v1.api_error(
      'GRADE_IMPORT_INVALID', 'The offline copy does not contain a grade list.', 400,
      'Export a completed graded copy from the Due Diligence offline grader.'
    );
  end if;
  grade_count := jsonb_array_length(grade_entries);
  if grade_count < 1 or grade_count > 1000 then
    return examination_room_v1.api_error(
      'GRADE_IMPORT_SIZE_INVALID', 'Import between 1 and 1,000 grade entries at a time.', 400,
      'Choose the graded copy for one examination and try again.'
    );
  end if;

  perform examination_room_v1.lock_request(p_institution_id, batch_request_hash);
  begin
    for grade_index in 0..grade_count - 1 loop
      failed_index := grade_index;
      grade_entry := grade_entries -> grade_index;
      if jsonb_typeof(grade_entry) <> 'object'
         or coalesce(grade_entry ->> 'examId', '') <> p_exam_id::text then
        failed_code := 'GRADE_IMPORT_EXAM_MISMATCH';
        raise exception using errcode = 'P0001', message = 'atomic grade import rejected';
      end if;
      grade_response := examination_room_v1.api_professor(
        'save_grade', p_actor_user_id, p_institution_id, grade_entry
      );
      if coalesce((grade_response ->> 'ok')::boolean, false) is not true then
        failed_code := coalesce(grade_response ->> 'errorCode', 'GRADE_IMPORT_ENTRY_REJECTED');
        raise exception using errcode = 'P0001', message = 'atomic grade import rejected';
      end if;
      receipts := receipts || jsonb_build_array(grade_response);
    end loop;
  exception
    when others then
      return examination_room_v1.api_error(
        'GRADE_IMPORT_ATOMIC_FAILURE',
        'No offline grades were imported because one entry could not be saved.',
        409,
        'Refresh grading, verify the matching examination version, then import the same graded copy again.'
      ) || jsonb_build_object(
        'failedIndex', failed_index,
        'failedCode', coalesce(failed_code, 'GRADE_IMPORT_INTERNAL')
      );
  end;

  return jsonb_build_object(
    'ok', true,
    'examId', p_exam_id,
    'importedCount', grade_count,
    'atomic', true,
    'batchRequestHash', batch_request_hash,
    'receipts', receipts
  );
end;
$$;

revoke all on function public.examination_room_v1_import_grades(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.examination_room_v1_import_grades(uuid, uuid, uuid, jsonb)
  to service_role;

create or replace function examination_room_v1.set_snapshot_source()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.source_kind is null then
    new.source_kind := case new.snapshot_scope
      when 'exam_definition' then 'publication'
      when 'answer_state' then 'submission'
      when 'grading_state' then 'grade_revision'
      else 'manual'
    end;
  end if;
  if new.snapshot_scope = 'answer_state' and new.source_submission_id is null then
    select submission.id, submission.session_id
    into new.source_submission_id, new.source_session_id
    from examination_room_v1.submissions submission
    where submission.idempotency_key_hash = new.request_hash;
  end if;
  return new;
end;
$$;

create trigger recovery_snapshots_bind_source
before insert on examination_room_v1.recovery_snapshots
for each row execute function examination_room_v1.set_snapshot_source();

create or replace function examination_room_v1.queue_grading_snapshot()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  exam_id uuid;
  exam_version_id uuid;
  grade_revision_id uuid;
  result_release_id uuid;
  request_hash text;
  record_count bigint;
  actor_user_id uuid;
  release_batch_hash text := nullif(current_setting('examination_room_v1.release_batch_request_hash', true), '');
  release_batch_count integer := coalesce(
    nullif(current_setting('examination_room_v1.release_batch_count', true), '')::integer,
    0
  );
begin
  if tg_table_name = 'grade_revisions' then
    if new.grade_status not in ('final', 'corrected') then
      return new;
    end if;
    -- release_results writes one final grade per student in the same atomic
    -- batch.  The matching result-release trigger below queues one exact batch
    -- event, so per-grade jobs would only amplify the same durable evidence.
    if release_batch_hash ~ '^[0-9a-f]{64}$' then
      return new;
    end if;
    grade_revision_id := new.id;
    exam_version_id := new.exam_version_id;
    actor_user_id := new.grader_user_id;
    select session.exam_id into exam_id
    from examination_room_v1.submissions submission
    join examination_room_v1.student_sessions session on session.id = submission.session_id
    where submission.id = new.submission_id;
    request_hash := encode(sha256(convert_to('grade-revision:' || new.id::text, 'UTF8')), 'hex');
  else
    result_release_id := new.id;
    grade_revision_id := new.grade_revision_id;
    actor_user_id := new.performed_by_user_id;
    select session.exam_id, submission.exam_version_id into exam_id, exam_version_id
    from examination_room_v1.submissions submission
    join examination_room_v1.student_sessions session on session.id = submission.session_id
    where submission.id = new.submission_id;
    request_hash := case
      when new.batch_request_hash ~ '^[0-9a-f]{64}$' then new.batch_request_hash
      else encode(sha256(convert_to('result-release:' || new.id::text, 'UTF8')), 'hex')
    end;
  end if;

  select 1
    + (select count(*) from examination_room_v1.grade_revisions grade where grade.submission_id = new.submission_id)
    + (select count(*) from examination_room_v1.grade_revision_items item
       join examination_room_v1.grade_revisions grade on grade.id = item.grade_revision_id
       where grade.submission_id = new.submission_id)
    + (select count(*) from examination_room_v1.result_releases release where release.submission_id = new.submission_id)
  into record_count;
  if tg_table_name = 'result_releases' and new.batch_request_hash ~ '^[0-9a-f]{64}$' then
    record_count := greatest(record_count, release_batch_count);
  end if;

  insert into examination_room_v1.recovery_snapshots (
    exam_id, exam_version_id, snapshot_sequence, snapshot_scope, request_hash,
    record_count, snapshot_status, created_by_user_id, retention_until,
    source_kind, source_grade_revision_id, source_result_release_id
  ) values (
    exam_id, exam_version_id, examination_room_v1.next_snapshot_sequence(exam_id),
    'grading_state', request_hash, record_count, 'pending',
    actor_user_id,
    clock_timestamp() + interval '365 days',
    case when tg_table_name = 'grade_revisions' then 'grade_revision' else 'result_release' end,
    grade_revision_id, result_release_id
  ) on conflict on constraint recovery_snapshots_request_hash_key do nothing;
  return new;
end;
$$;

create trigger grade_revisions_queue_recovery
after insert on examination_room_v1.grade_revisions
for each row execute function examination_room_v1.queue_grading_snapshot();

create trigger result_releases_queue_recovery
after insert on examination_room_v1.result_releases
for each row execute function examination_room_v1.queue_grading_snapshot();

create or replace function examination_room_v1.normalize_default_student_warning()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  warning_body constant text :=
    'This examination records your identity, answers, submission status, grades, and any examination-integrity features enabled by your Professor. These records can be viewed by your Professor and the platform owner.';
begin
  if new.notice_code = 'exam-room-v1' then
    new.title := 'Student privacy warning';
    new.notice_body := warning_body;
    new.body_sha256 := encode(sha256(convert_to(warning_body, 'UTF8')), 'hex');
    new.processing_purposes := '["examination_administration","answer_persistence","grading","integrity_review"]'::jsonb;
  end if;
  return new;
end;
$$;

create trigger privacy_notice_versions_minimal_warning
before insert on examination_room_v1.privacy_notice_versions
for each row execute function examination_room_v1.normalize_default_student_warning();

insert into examination_room_v1.privacy_notice_versions (
  institution_id, notice_code, version_number, title, notice_body, body_sha256,
  processing_purposes, effective_at, created_by_user_id
)
select
  institution.id,
  'exam-room-v1',
  coalesce((
    select max(existing.version_number) + 1
    from examination_room_v1.privacy_notice_versions existing
    where existing.institution_id = institution.id and existing.notice_code = 'exam-room-v1'
  ), 1),
  'Student privacy warning',
  'This examination records your identity, answers, submission status, grades, and any examination-integrity features enabled by your Professor. These records can be viewed by your Professor and the platform owner.',
  encode(sha256(convert_to(
    'This examination records your identity, answers, submission status, grades, and any examination-integrity features enabled by your Professor. These records can be viewed by your Professor and the platform owner.',
    'UTF8'
  )), 'hex'),
  '["examination_administration","answer_persistence","grading","integrity_review"]'::jsonb,
  clock_timestamp(),
  institution.created_by_user_id
from examination_room_v1.institutions institution
where not exists (
  select 1 from examination_room_v1.privacy_notice_versions existing
  where existing.institution_id = institution.id
    and existing.notice_code = 'exam-room-v1'
    and existing.body_sha256 = encode(sha256(convert_to(
      'This examination records your identity, answers, submission status, grades, and any examination-integrity features enabled by your Professor. These records can be viewed by your Professor and the platform owner.',
      'UTF8'
    )), 'hex')
);

create or replace function public.examination_room_v1_claim_recovery_snapshot(
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  claimed_id uuid;
  claimed_lease_id uuid := gen_random_uuid();
  safe_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 120), 30), 900);
  payload jsonb;
begin
  select snapshot.id into claimed_id
  from examination_room_v1.recovery_snapshots snapshot
  where (
      snapshot.snapshot_status = 'pending'
      or (
        snapshot.snapshot_status = 'failed'
        and snapshot.materialization_attempts < 8
        and coalesce(snapshot.next_retry_at, '-infinity'::timestamptz) <= clock_timestamp()
      )
      or (
        snapshot.snapshot_status = 'materializing'
        and snapshot.lease_expires_at < clock_timestamp()
        and snapshot.materialization_attempts < 8
      )
    )
    and snapshot.retention_until > clock_timestamp()
  order by snapshot.created_at, snapshot.snapshot_sequence
  for update skip locked
  limit 1;

  if claimed_id is null then
    return jsonb_build_object('ok', true, 'job', null);
  end if;

  update examination_room_v1.recovery_snapshots snapshot
  set snapshot_status = 'materializing',
      materialization_attempts = snapshot.materialization_attempts + 1,
      lease_id = claimed_lease_id,
      lease_expires_at = clock_timestamp() + make_interval(secs => safe_lease_seconds),
      next_retry_at = null,
      last_error_code = null,
      last_error_at = null
  where snapshot.id = claimed_id;

  payload := examination_room_v1.owner_snapshot_payload(claimed_id);
  return jsonb_build_object(
    'ok', true,
    'job', jsonb_build_object(
      'snapshotId', claimed_id,
      'leaseId', claimed_lease_id,
      'payload', payload
    )
  );
end;
$$;

revoke all on function public.examination_room_v1_claim_recovery_snapshot(integer)
  from public, anon, authenticated;
grant execute on function public.examination_room_v1_claim_recovery_snapshot(integer)
  to service_role;

create or replace function public.examination_room_v1_complete_recovery_snapshot(
  p_snapshot_id uuid,
  p_lease_id uuid,
  p_object_reference text,
  p_snapshot_sha256 text,
  p_encryption_key_reference text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  affected_count integer;
begin
  update examination_room_v1.recovery_snapshots snapshot
  set snapshot_status = 'available',
      encrypted_object_reference = p_object_reference,
      snapshot_sha256 = lower(p_snapshot_sha256),
      encryption_key_reference = p_encryption_key_reference,
      available_at = clock_timestamp(),
      -- A successful R2 write is "Stored", not "Verified". Only a later
      -- authenticated read-back may set verified_at.
      verified_at = null,
      lease_id = null,
      lease_expires_at = null,
      next_retry_at = null,
      last_error_code = null,
      last_error_at = null
  where snapshot.id = p_snapshot_id
    and snapshot.snapshot_status = 'materializing'
    and snapshot.lease_id = p_lease_id;
  get diagnostics affected_count = row_count;
  return jsonb_build_object('ok', affected_count = 1, 'snapshotId', p_snapshot_id, 'status', case when affected_count = 1 then 'available' else 'lease_lost' end);
end;
$$;

revoke all on function public.examination_room_v1_complete_recovery_snapshot(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.examination_room_v1_complete_recovery_snapshot(uuid, uuid, text, text, text)
  to service_role;

create or replace function public.examination_room_v1_verify_recovery_snapshot(
  p_snapshot_id uuid,
  p_snapshot_sha256 text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  affected_count integer;
  expected_sha256 text := lower(coalesce(p_snapshot_sha256, ''));
begin
  if expected_sha256 !~ '^[0-9a-f]{64}$' then
    return examination_room_v1.api_error(
      'RECOVERY_CHECKSUM_INVALID',
      'The verified recovery checksum is invalid.', 409,
      'Download and verify the checkpoint again before marking it Verified.'
    );
  end if;

  update examination_room_v1.recovery_snapshots snapshot
  set verified_at = clock_timestamp()
  where snapshot.id = p_snapshot_id
    and snapshot.snapshot_status in ('available', 'restoring', 'restored')
    and snapshot.encrypted_object_reference is not null
    and snapshot.snapshot_sha256 = expected_sha256;
  get diagnostics affected_count = row_count;

  if affected_count = 0 then
    return examination_room_v1.api_error(
      'RECOVERY_VERIFICATION_MISMATCH',
      'The read-back checksum does not match the stored recovery checkpoint.', 409,
      'Refresh Recovery, then download and verify the exact checkpoint again.'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'snapshotId', p_snapshot_id,
    'verified', true,
    'verifiedAt', (
      select snapshot.verified_at
      from examination_room_v1.recovery_snapshots snapshot
      where snapshot.id = p_snapshot_id
    )
  );
end;
$$;

revoke all on function public.examination_room_v1_verify_recovery_snapshot(uuid, text)
  from public, anon, authenticated;
grant execute on function public.examination_room_v1_verify_recovery_snapshot(uuid, text)
  to service_role;

create or replace function public.examination_room_v1_fail_recovery_snapshot(
  p_snapshot_id uuid,
  p_lease_id uuid,
  p_error_code text,
  p_retry_after_seconds integer default 60
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  affected_count integer;
  safe_retry integer := least(greatest(coalesce(p_retry_after_seconds, 60), 15), 86400);
begin
  update examination_room_v1.recovery_snapshots snapshot
  set snapshot_status = 'failed',
      lease_id = null,
      lease_expires_at = null,
      next_retry_at = clock_timestamp() + make_interval(secs => safe_retry),
      last_error_code = upper(regexp_replace(coalesce(p_error_code, 'BACKUP_FAILED'), '[^A-Za-z0-9_]', '_', 'g')),
      last_error_at = clock_timestamp()
  where snapshot.id = p_snapshot_id
    and snapshot.snapshot_status = 'materializing'
    and snapshot.lease_id = p_lease_id;
  get diagnostics affected_count = row_count;
  return jsonb_build_object('ok', affected_count = 1, 'snapshotId', p_snapshot_id, 'status', case when affected_count = 1 then 'failed' else 'lease_lost' end);
end;
$$;

revoke all on function public.examination_room_v1_fail_recovery_snapshot(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.examination_room_v1_fail_recovery_snapshot(uuid, uuid, text, integer)
  to service_role;

revoke all on function examination_room_v1.set_snapshot_source() from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.queue_grading_snapshot() from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.normalize_default_student_warning() from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.protect_email_delivery_event() from public, anon, authenticated, service_role;

commit;

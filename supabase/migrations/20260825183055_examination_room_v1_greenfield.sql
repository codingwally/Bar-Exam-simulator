begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create schema examination_room_v1 authorization postgres;

comment on schema examination_room_v1 is
  'Private persistence boundary for the greenfield Examination Room v1. Application access is service-mediated.';

revoke all on schema examination_room_v1 from public;
revoke all on schema examination_room_v1 from anon, authenticated;
grant usage on schema examination_room_v1 to service_role;

alter default privileges in schema examination_room_v1 revoke all on tables from public, anon, authenticated;
alter default privileges in schema examination_room_v1 revoke all on sequences from public, anon, authenticated;
alter default privileges in schema examination_room_v1 revoke all on functions from public, anon, authenticated;
alter default privileges in schema examination_room_v1 revoke all on types from public, anon, authenticated;
alter default privileges in schema examination_room_v1 grant select, insert, update, delete on tables to service_role;
alter default privileges in schema examination_room_v1 grant usage, select on sequences to service_role;

create function examination_room_v1.prevent_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I.%I is append-only', tg_table_schema, tg_table_name);
  return null;
end;
$$;

create function examination_room_v1.prevent_delete()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I.%I rows cannot be deleted', tg_table_schema, tg_table_name);
  return null;
end;
$$;

create function examination_room_v1.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

create function examination_room_v1.seal_exam_version()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' and old.publication_status = 'building' then
    return old;
  end if;

  if tg_op = 'UPDATE'
     and old.publication_status = 'building'
     and new.id = old.id
     and new.exam_id = old.exam_id
     and new.institution_id = old.institution_id
     and new.version_number = old.version_number
     and new.created_at = old.created_at then
    if new.publication_status = 'building' then
      return new;
    end if;

    if new.publication_status = 'published'
       and (
         to_jsonb(new)
           - 'publication_status'
           - 'published_by_user_id'
           - 'published_at'
           - 'publication_manifest'
           - 'content_sha256'
       ) = (
         to_jsonb(old)
           - 'publication_status'
           - 'published_by_user_id'
           - 'published_at'
           - 'publication_manifest'
           - 'content_sha256'
       ) then
      return new;
    end if;
  end if;

  raise exception using
    errcode = '55000',
    message = 'examination_room_v1.exam_versions is immutable except for its one-way publication seal';
  return null;
end;
$$;

create function examination_room_v1.protect_published_question()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  target_version_id uuid;
begin
  if tg_op = 'UPDATE' and exists (
    select 1
    from examination_room_v1.exam_versions v
    where v.id = old.exam_version_id
      and v.publication_status = 'published'
  ) then
    raise exception using
      errcode = '55000',
      message = 'published exam questions are immutable';
  end if;

  if tg_op = 'DELETE' then
    target_version_id = old.exam_version_id;
  else
    target_version_id = new.exam_version_id;
  end if;

  if exists (
    select 1
    from examination_room_v1.exam_versions v
    where v.id = target_version_id
      and v.publication_status = 'published'
  ) then
    raise exception using
      errcode = '55000',
      message = 'published exam questions are immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create function examination_room_v1.ensure_exam_current_version_published()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.current_published_version_id is not null
     and not exists (
       select 1
       from examination_room_v1.exam_versions v
       where v.id = new.current_published_version_id
         and v.exam_id = new.id
         and v.publication_status = 'published'
         and v.anonymous_grading_snapshot = new.anonymous_grading
     ) then
    raise exception using
      errcode = '23514',
      message = 'current_published_version_id must reference a sealed published version of this exam';
  end if;

  return new;
end;
$$;

create function examination_room_v1.validate_room_activation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1
    from examination_room_v1.exam_versions v
    where v.id = new.exam_version_id
      and v.exam_id = new.exam_id
      and v.institution_id = new.institution_id
      and v.publication_status = 'published'
  ) then
    raise exception using
      errcode = '23514',
      message = 'room activations must reference a sealed published exam version';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.exam_id is distinct from old.exam_id
       or new.institution_id is distinct from old.institution_id
       or new.exam_version_id is distinct from old.exam_version_id
       or new.request_hash is distinct from old.request_hash
       or new.key_hash_algorithm is distinct from old.key_hash_algorithm
       or new.activated_by_user_id is distinct from old.activated_by_user_id
       or new.created_at is distinct from old.created_at then
      raise exception using
        errcode = '55000',
        message = 'room activation identity and request binding are immutable';
    end if;

    if new.key_hash is distinct from old.key_hash
       and not (
         old.activation_status = 'scheduled'
         and new.activation_status = 'scheduled'
         and not exists (
           select 1
           from examination_room_v1.student_sessions s
           where s.activation_id = old.id
         )
       ) then
      raise exception using
        errcode = '55000',
        message = 'an issued room-key verifier can rotate only before the room opens or any session exists';
    end if;
  end if;

  return new;
end;
$$;

create function examination_room_v1.protect_student_session_binding()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.id is distinct from old.id
     or new.activation_id is distinct from old.activation_id
     or new.exam_id is distinct from old.exam_id
     or new.institution_id is distinct from old.institution_id
     or new.exam_version_id is distinct from old.exam_version_id
     or new.roster_id is distinct from old.roster_id
     or new.consent_request_hash is distinct from old.consent_request_hash
     or new.client_instance_id is distinct from old.client_instance_id
     or new.started_at is distinct from old.started_at
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '55000',
      message = 'student session identity and consent binding are immutable';
  end if;

  if new.session_token_hash is distinct from old.session_token_hash
     and not (
       old.session_status in ('created', 'active')
       and new.session_status = old.session_status
       and not exists (
         select 1 from examination_room_v1.answer_revisions a where a.session_id = old.id
       )
       and not exists (
         select 1 from examination_room_v1.submissions s where s.session_id = old.id
       )
     ) then
    raise exception using
      errcode = '55000',
      message = 'student session tokens can rotate only before any answer or submission exists';
  end if;

  return new;
end;
$$;

create function examination_room_v1.protect_recovery_snapshot()
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
     or new.retention_until is distinct from old.retention_until then
    raise exception using
      errcode = '55000',
      message = 'recovery snapshot request evidence is immutable';
  end if;

  if old.snapshot_status = 'pending'
     and new.snapshot_status in ('available', 'failed') then
    return new;
  end if;

  if old.snapshot_status = 'available'
     and new.snapshot_status in ('restored', 'expired', 'superseded')
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
    message = 'recovery snapshot state may advance only through materialization, restore, or retention states';
  return null;
end;
$$;

create function examination_room_v1.ensure_releasable_grade()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  revision_status text;
  expected_item_count integer;
  expected_total numeric(12, 2);
  expected_maximum numeric(12, 2);
  current_item_count integer;
  current_total numeric(12, 2);
  current_maximum numeric(12, 2);
begin
  if new.release_action = 'release' then
    select g.grade_status, g.item_count, g.total_score, g.maximum_score
    into revision_status, expected_item_count, expected_total, expected_maximum
    from examination_room_v1.grade_revisions g
    where g.id = new.grade_revision_id
      and g.submission_id = new.submission_id
    for update;

    select count(*)::integer, coalesce(sum(i.score), 0), coalesce(sum(i.maximum_score), 0)
    into current_item_count, current_total, current_maximum
    from examination_room_v1.grade_revision_items i
    where i.grade_revision_id = new.grade_revision_id;

    if revision_status is null
       or revision_status not in ('final', 'corrected')
       or current_item_count <> expected_item_count
       or current_total <> expected_total
       or current_maximum <> expected_maximum then
      raise exception using
        errcode = '23514',
        message = 'release requires a complete final or corrected grade revision';
    end if;
  elsif new.release_action = 'revoke'
        and (
          new.supersedes_release_id = new.id
          or not exists (
            select 1
            from examination_room_v1.result_releases prior
            where prior.id = new.supersedes_release_id
              and prior.submission_id = new.submission_id
              and prior.release_action = 'release'
              and prior.occurred_at < new.occurred_at
          )
        ) then
    raise exception using
      errcode = '23514',
      message = 'a result revocation must reference an earlier release for the same submission';
  end if;

  return new;
end;
$$;

create function examination_room_v1.protect_grade_revision_item_set()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  expected_item_count integer;
  current_item_count integer;
begin
  if tg_op <> 'INSERT' then
    raise exception using
      errcode = '55000',
      message = 'grade revision items are append-only';
  end if;

  select g.item_count
  into expected_item_count
  from examination_room_v1.grade_revisions g
  where g.id = new.grade_revision_id
  for update;

  if expected_item_count is null then
    raise exception using
      errcode = '23503',
      message = 'grade item references an unknown grade revision';
  end if;

  if exists (
    select 1
    from examination_room_v1.result_releases r
    where r.grade_revision_id = new.grade_revision_id
      and r.release_action = 'release'
  ) then
    raise exception using
      errcode = '55000',
      message = 'released grade revision items are sealed';
  end if;

  select count(*)::integer
  into current_item_count
  from examination_room_v1.grade_revision_items i
  where i.grade_revision_id = new.grade_revision_id;

  if current_item_count >= expected_item_count then
    raise exception using
      errcode = '23514',
      message = 'grade item exceeds the declared item count';
  end if;

  return new;
end;
$$;

create function examination_room_v1.validate_privacy_acceptance()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.decision = 'withdrawn'
     and (
       new.prior_acceptance_id = new.id
       or not exists (
         select 1
         from examination_room_v1.privacy_acceptances prior
         where prior.id = new.prior_acceptance_id
           and prior.roster_id = new.roster_id
           and prior.notice_version_id = new.notice_version_id
           and prior.session_id = new.session_id
           and prior.exam_version_id = new.exam_version_id
           and prior.decision = 'accepted'
           and prior.recorded_at < new.recorded_at
           and prior.created_at <= new.created_at
       )
     ) then
    raise exception using
      errcode = '23514',
      message = 'a withdrawal must reference an earlier accepted event for the same session and notice';
  end if;

  return new;
end;
$$;

create function examination_room_v1.protect_submission_answer_set()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  expected_answer_count integer;
  current_answer_count integer;
begin
  if tg_op <> 'INSERT' then
    raise exception using
      errcode = '55000',
      message = 'submission answer mappings are append-only';
  end if;

  select s.answer_count
  into expected_answer_count
  from examination_room_v1.submissions s
  where s.id = new.submission_id
  for update;

  if expected_answer_count is null then
    raise exception using
      errcode = '23503',
      message = 'submission answer mapping references an unknown submission';
  end if;

  if exists (
    select 1
    from examination_room_v1.submission_receipts r
    where r.submission_id = new.submission_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'submission answer set is sealed by its receipt';
  end if;

  select count(*)::integer
  into current_answer_count
  from examination_room_v1.submission_answers a
  where a.submission_id = new.submission_id;

  if current_answer_count >= expected_answer_count then
    raise exception using
      errcode = '23514',
      message = 'submission answer mapping exceeds the declared answer count';
  end if;

  return new;
end;
$$;

create function examination_room_v1.validate_submission_receipt()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  expected_answer_count integer;
  current_answer_count integer;
begin
  select s.answer_count
  into expected_answer_count
  from examination_room_v1.submissions s
  where s.id = new.submission_id
  for update;

  select count(*)::integer
  into current_answer_count
  from examination_room_v1.submission_answers a
  where a.submission_id = new.submission_id;

  if expected_answer_count is null or current_answer_count <> expected_answer_count then
    raise exception using
      errcode = '23514',
      message = 'a receipt requires the complete declared submission answer set';
  end if;

  return new;
end;
$$;

create function examination_room_v1.validate_exam_owner()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1
    from examination_room_v1.staff_memberships m
    where m.institution_id = new.institution_id
      and m.user_id = new.owner_user_id
      and m.staff_role in ('professor', 'admin')
      and m.membership_status = 'active'
  ) then
    raise exception using
      errcode = '42501',
      message = 'exam owner must be an active professor or administrator for the institution';
  end if;

  return new;
end;
$$;

create function examination_room_v1.protect_staff_membership_history()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.id is distinct from old.id
     or new.institution_id is distinct from old.institution_id
     or new.user_id is distinct from old.user_id
     or new.staff_role is distinct from old.staff_role
     or new.grant_reason is distinct from old.grant_reason
     or new.granted_by_user_id is distinct from old.granted_by_user_id
     or new.granted_at is distinct from old.granted_at then
    raise exception using
      errcode = '55000',
      message = 'staff membership grant identity is immutable';
  end if;

  if old.membership_status = new.membership_status
     and (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
    return new;
  end if;

  if old.membership_status = 'active'
     and new.membership_status in ('suspended', 'revoked') then
    return new;
  end if;

  if old.membership_status = 'suspended'
     and new.membership_status = 'revoked' then
    return new;
  end if;

  raise exception using
    errcode = '55000',
    message = 'staff membership history cannot be reactivated or rewritten; create a new grant row';
  return null;
end;
$$;

create function examination_room_v1.protect_professor_access_request_history()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    if new.request_status <> 'pending' then
      raise exception using
        errcode = '55000',
        message = 'Professor access requests must begin in pending state';
    end if;
    new.updated_at = clock_timestamp();
    return new;
  end if;

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.email_normalized is distinct from old.email_normalized
     or new.display_name is distinct from old.display_name
     or new.claimed_school_id is distinct from old.claimed_school_id
     or new.claimed_school_name is distinct from old.claimed_school_name
     or new.requested_institution_id is distinct from old.requested_institution_id
     or new.requested_at is distinct from old.requested_at then
    raise exception using
      errcode = '55000',
      message = 'Professor access request identity and school binding are immutable';
  end if;

  if old.request_status <> 'pending'
     or new.request_status not in ('approved', 'rejected', 'cancelled') then
    raise exception using
      errcode = '55000',
      message = 'Professor access request history cannot be reopened or rewritten';
  end if;

  if new.request_status = 'approved'
     and not exists (
       select 1
       from examination_room_v1.staff_memberships membership
       where membership.id = new.approved_membership_id
         and membership.institution_id = new.requested_institution_id
         and membership.user_id = new.user_id
         and membership.staff_role = 'professor'
         and membership.membership_status = 'active'
     ) then
    raise exception using
      errcode = '23514',
      message = 'Professor request approval must reference the active matching Professor membership';
  end if;

  new.updated_at = clock_timestamp();
  return new;
end;
$$;

revoke all on function examination_room_v1.prevent_mutation() from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.prevent_delete() from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.touch_updated_at() from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.seal_exam_version() from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.protect_published_question() from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.ensure_exam_current_version_published() from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.validate_room_activation() from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.protect_student_session_binding() from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.protect_recovery_snapshot() from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.ensure_releasable_grade() from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.protect_grade_revision_item_set() from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.validate_privacy_acceptance() from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.protect_submission_answer_set() from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.validate_submission_receipt() from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.validate_exam_owner() from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.protect_staff_membership_history() from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.protect_professor_access_request_history() from public, anon, authenticated, service_role;

create table examination_room_v1.institutions (
  id uuid primary key default gen_random_uuid(),
  institution_code text not null unique check (
    institution_code = lower(btrim(institution_code))
    and institution_code ~ '^[a-z0-9][a-z0-9._-]{1,63}$'
  ),
  profile_school_id text not null unique check (
    profile_school_id = lower(btrim(profile_school_id))
    and profile_school_id ~ '^[a-z0-9][a-z0-9-]{1,179}$'
  ),
  institution_name text not null check (length(btrim(institution_name)) between 2 and 240),
  institution_status text not null default 'active' check (institution_status in ('active', 'suspended')),
  bootstrap_request_hash text not null unique check (bootstrap_request_hash ~ '^[0-9a-f]{64}$'),
  created_by_user_id uuid not null,
  created_at timestamptz not null default now()
);

comment on table examination_room_v1.institutions is
  'Private law-school directory created only by an existing platform administrator with role-management authority.';

create table examination_room_v1.privacy_notice_versions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references examination_room_v1.institutions(id) on delete restrict,
  notice_code text not null check (notice_code = lower(btrim(notice_code)) and notice_code ~ '^[a-z0-9][a-z0-9._-]{1,63}$'),
  version_number integer not null check (version_number > 0),
  title text not null check (length(btrim(title)) between 1 and 240),
  notice_body text not null check (length(btrim(notice_body)) > 0),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  processing_purposes jsonb not null default '[]'::jsonb check (jsonb_typeof(processing_purposes) = 'array'),
  effective_at timestamptz not null,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  constraint privacy_notice_versions_institution_code_version_key unique (institution_id, notice_code, version_number),
  constraint privacy_notice_versions_id_institution_key unique (id, institution_id)
);

comment on table examination_room_v1.privacy_notice_versions is
  'Immutable text and purpose snapshot for each privacy-notice version presented to examinees.';

create table examination_room_v1.staff_memberships (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references examination_room_v1.institutions(id) on delete restrict,
  user_id uuid not null,
  staff_role text not null check (staff_role in ('professor', 'admin')),
  display_name text check (display_name is null or length(btrim(display_name)) between 1 and 240),
  email_normalized text check (
    email_normalized is null
    or (
      email_normalized = lower(btrim(email_normalized))
      and length(email_normalized) between 3 and 320
      and position('@' in email_normalized) > 1
    )
  ),
  membership_status text not null default 'active' check (membership_status in ('active', 'suspended', 'revoked')),
  grant_reason text not null default 'Institution examination access approved.' check (length(btrim(grant_reason)) between 5 and 1000),
  granted_by_user_id uuid not null,
  granted_at timestamptz not null default now(),
  revoked_by_user_id uuid,
  revoked_at timestamptz,
  revocation_reason text,
  updated_at timestamptz not null default now(),
  constraint staff_memberships_revocation_check check (
    (membership_status <> 'revoked' and revoked_by_user_id is null and revoked_at is null and revocation_reason is null)
    or (membership_status = 'revoked' and revoked_by_user_id is not null and revoked_at is not null and revocation_reason is not null)
  )
);

comment on table examination_room_v1.staff_memberships is
  'Greenfield institution authorization for signed-in professors and administrators; user_id must come from a verified server-side identity.';

create table examination_room_v1.professor_access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email_normalized text not null check (
    email_normalized = lower(btrim(email_normalized))
    and length(email_normalized) between 3 and 320
    and position('@' in email_normalized) > 1
  ),
  display_name text not null check (length(btrim(display_name)) between 2 and 240),
  claimed_school_id text not null check (
    claimed_school_id = lower(btrim(claimed_school_id))
    and length(claimed_school_id) between 1 and 180
  ),
  claimed_school_name text not null check (length(btrim(claimed_school_name)) between 2 and 240),
  requested_institution_id uuid not null references examination_room_v1.institutions(id) on delete restrict,
  request_status text not null default 'pending' check (request_status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_at timestamptz not null default now(),
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  review_reason text check (
    review_reason is null or length(btrim(review_reason)) between 5 and 1000
  ),
  assigned_institution_id uuid references examination_room_v1.institutions(id) on delete restrict,
  approved_membership_id uuid references examination_room_v1.staff_memberships(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint professor_access_requests_review_check check (
    (
      request_status = 'pending'
      and reviewed_by_user_id is null
      and reviewed_at is null
      and review_reason is null
      and assigned_institution_id is null
      and approved_membership_id is null
    )
    or (
      request_status = 'rejected'
      and reviewed_by_user_id is not null
      and reviewed_at is not null
      and review_reason is not null
      and assigned_institution_id = requested_institution_id
      and approved_membership_id is null
    )
    or (
      request_status = 'cancelled'
      and reviewed_by_user_id is not null
      and reviewed_at is not null
      and review_reason is not null
      and assigned_institution_id is null
      and approved_membership_id is null
    )
    or (
      request_status = 'approved'
      and reviewed_by_user_id is not null
      and reviewed_at is not null
      and review_reason is not null
      and assigned_institution_id = requested_institution_id
      and approved_membership_id is not null
    )
  )
);

create unique index professor_access_requests_one_pending_per_user
  on examination_room_v1.professor_access_requests (user_id)
  where request_status = 'pending';

create index professor_access_requests_school_queue
  on examination_room_v1.professor_access_requests (requested_institution_id, request_status, requested_at);

comment on table examination_room_v1.professor_access_requests is
  'Private bridge between a signed-in Professor profile and protected institution approval. A profile choice never grants access to examination or student data by itself.';

create table examination_room_v1.exams (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references examination_room_v1.institutions(id) on delete restrict,
  owner_user_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 300),
  description text,
  status text not null default 'draft' check (status in ('draft', 'published', 'closed', 'archived')),
  anonymous_grading boolean not null default false,
  current_published_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  archived_at timestamptz,
  constraint exams_publish_state_check check (
    (status = 'draft' and current_published_version_id is null)
    or (status <> 'draft' and current_published_version_id is not null)
  ),
  constraint exams_lifecycle_timestamps_check check (
    (closed_at is null or closed_at >= created_at)
    and (archived_at is null or archived_at >= created_at)
  ),
  constraint exams_id_institution_key unique (id, institution_id)
);

comment on column examination_room_v1.exams.anonymous_grading is
  'Optional professor control. False is the default so verified real-name identity remains the normal workflow.';

create table examination_room_v1.exam_versions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null,
  institution_id uuid not null,
  version_number integer not null check (version_number > 0),
  title_snapshot text not null check (length(btrim(title_snapshot)) between 1 and 300),
  instructions text not null default '',
  duration_seconds integer not null check (duration_seconds between 60 and 86400),
  anonymous_grading_snapshot boolean not null default false,
  privacy_notice_version_id uuid not null,
  controls jsonb not null default '{}'::jsonb check (jsonb_typeof(controls) = 'object'),
  publication_manifest jsonb not null default '{}'::jsonb check (jsonb_typeof(publication_manifest) = 'object'),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  publication_status text not null default 'building' check (publication_status in ('building', 'published')),
  published_by_user_id uuid,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  constraint exam_versions_exam_institution_fk
    foreign key (exam_id, institution_id)
    references examination_room_v1.exams (id, institution_id)
    on delete restrict,
  constraint exam_versions_notice_institution_fk
    foreign key (privacy_notice_version_id, institution_id)
    references examination_room_v1.privacy_notice_versions (id, institution_id)
    on delete restrict,
  constraint exam_versions_exam_version_key unique (exam_id, version_number),
  constraint exam_versions_id_exam_key unique (id, exam_id),
  constraint exam_versions_id_exam_institution_key unique (id, exam_id, institution_id),
  constraint exam_versions_id_notice_key unique (id, privacy_notice_version_id),
  constraint exam_versions_publication_state_check check (
    (
      publication_status = 'building'
      and published_by_user_id is null
      and published_at is null
      and publication_manifest = '{}'::jsonb
    )
    or (
      publication_status = 'published'
      and published_by_user_id is not null
      and published_at is not null
      and published_at >= created_at
      and publication_manifest ->> 'schemaVersion' = 'examination-room/publication/v1'
    )
  )
);

alter table examination_room_v1.exams
  add constraint exams_current_published_version_fk
  foreign key (current_published_version_id, id)
  references examination_room_v1.exam_versions (id, exam_id)
  on delete restrict
  deferrable initially deferred;

comment on table examination_room_v1.exam_versions is
  'A publication bundle is assembled in building state, then sealed once; sealed versions are immutable.';

create table examination_room_v1.questions (
  id uuid primary key default gen_random_uuid(),
  exam_version_id uuid not null references examination_room_v1.exam_versions(id) on delete restrict,
  position integer not null check (position > 0),
  question_key text not null check (question_key ~ '^q[0-9]{3}$'),
  question_kind text not null check (question_kind in ('essay', 'short_answer', 'multiple_choice', 'true_false', 'file_upload')),
  prompt text not null check (length(btrim(prompt)) > 0),
  points numeric(10, 2) not null default 0 check (points >= 0),
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint questions_version_position_key unique (exam_version_id, position),
  constraint questions_version_key_key unique (exam_version_id, question_key),
  constraint questions_id_version_key unique (id, exam_version_id)
);

comment on column examination_room_v1.questions.position is
  'Canonical published numbering assigned during import/authoring; unique within an immutable exam version.';

comment on column examination_room_v1.questions.question_key is
  'Stable canonical question key used by browser, submission, offline-grading, and recovery manifests.';

create table examination_room_v1.student_identities (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references examination_room_v1.institutions(id) on delete restrict,
  auth_user_id uuid,
  external_student_id text not null check (length(btrim(external_student_id)) between 1 and 128),
  full_name text not null check (length(btrim(full_name)) between 1 and 240),
  email_normalized text not null check (
    email_normalized = lower(btrim(email_normalized))
    and length(email_normalized) between 3 and 320
    and position('@' in email_normalized) > 1
  ),
  identity_status text not null default 'active' check (identity_status in ('active', 'inactive', 'merged')),
  verified_at timestamptz,
  verification_method text check (verification_method is null or verification_method in ('institution_sso', 'registrar_import', 'admin_review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_identities_external_key unique (institution_id, external_student_id),
  constraint student_identities_id_institution_key unique (id, institution_id)
);

comment on table examination_room_v1.student_identities is
  'Verified real-name identity is stored separately from optional anonymous grading aliases.';

create table examination_room_v1.exam_roster (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null,
  institution_id uuid not null,
  student_identity_id uuid not null,
  grading_alias text check (grading_alias is null or length(btrim(grading_alias)) between 1 and 80),
  roster_status text not null default 'eligible' check (roster_status in ('invited', 'eligible', 'withdrawn', 'completed')),
  accommodations jsonb not null default '{}'::jsonb check (jsonb_typeof(accommodations) = 'object'),
  added_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_roster_exam_institution_fk
    foreign key (exam_id, institution_id)
    references examination_room_v1.exams (id, institution_id)
    on delete restrict,
  constraint exam_roster_identity_institution_fk
    foreign key (student_identity_id, institution_id)
    references examination_room_v1.student_identities (id, institution_id)
    on delete restrict,
  constraint exam_roster_exam_student_key unique (exam_id, student_identity_id),
  constraint exam_roster_id_exam_key unique (id, exam_id),
  constraint exam_roster_id_exam_institution_key unique (id, exam_id, institution_id)
);

create table examination_room_v1.room_activations (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null,
  institution_id uuid not null,
  exam_version_id uuid not null,
  key_hash text not null,
  key_hash_algorithm text not null check (key_hash_algorithm in ('hmac-sha256-v1', 'argon2id-v1')),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  activation_status text not null default 'scheduled' check (activation_status in ('scheduled', 'open', 'closed', 'revoked')),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  max_sessions integer check (max_sessions is null or max_sessions > 0),
  activated_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  deactivated_at timestamptz,
  deactivated_by_user_id uuid,
  deactivation_reason text,
  constraint room_activations_version_exam_fk
    foreign key (exam_version_id, exam_id, institution_id)
    references examination_room_v1.exam_versions (id, exam_id, institution_id)
    on delete restrict,
  constraint room_activations_id_exam_version_key unique (id, exam_id, exam_version_id, institution_id),
  constraint room_activations_key_hash_key unique (key_hash),
  constraint room_activations_request_hash_key unique (request_hash),
  constraint room_activations_window_check check (closes_at > opens_at),
  constraint room_activations_deactivation_check check (
    (deactivated_at is null and deactivated_by_user_id is null)
    or (deactivated_at is not null and deactivated_by_user_id is not null and deactivated_at >= created_at)
  ),
  constraint room_activations_key_hash_format_check check (
    (key_hash_algorithm = 'hmac-sha256-v1' and key_hash ~ '^[0-9a-f]{64}$')
    or (key_hash_algorithm = 'argon2id-v1' and key_hash like '$argon2id$%' and length(key_hash) between 40 and 255)
  )
);

comment on column examination_room_v1.room_activations.key_hash is
  'One-way verifier only. Raw room keys must never be persisted or included in logs/audit payloads.';

comment on column examination_room_v1.room_activations.request_hash is
  'HMAC-SHA-256 command receipt. A replay may rotate an unused scheduled verifier so the newly issued one-time key remains valid.';

create table examination_room_v1.student_sessions (
  id uuid primary key default gen_random_uuid(),
  activation_id uuid not null,
  exam_id uuid not null,
  institution_id uuid not null,
  exam_version_id uuid not null,
  roster_id uuid not null,
  session_token_hash text not null check (session_token_hash ~ '^[0-9a-f]{64}$'),
  consent_request_hash text not null check (consent_request_hash ~ '^[0-9a-f]{64}$'),
  client_instance_id uuid not null,
  session_status text not null default 'created' check (session_status in ('created', 'active', 'submitted', 'expired', 'revoked')),
  identity_verified_at timestamptz,
  identity_verification_method text check (
    identity_verification_method is null
    or identity_verification_method in ('signed_in_account', 'room_key_roster_match', 'admin_override')
  ),
  started_at timestamptz not null default now(),
  last_heartbeat_at timestamptz,
  lease_expires_at timestamptz not null,
  ended_at timestamptz,
  session_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(session_metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_sessions_activation_fk
    foreign key (activation_id, exam_id, exam_version_id, institution_id)
    references examination_room_v1.room_activations (id, exam_id, exam_version_id, institution_id)
    on delete restrict,
  constraint student_sessions_roster_fk
    foreign key (roster_id, exam_id, institution_id)
    references examination_room_v1.exam_roster (id, exam_id, institution_id)
    on delete restrict,
  constraint student_sessions_id_version_key unique (id, exam_version_id),
  constraint student_sessions_id_roster_key unique (id, roster_id),
  constraint student_sessions_id_institution_exam_key unique (id, institution_id, exam_id),
  constraint student_sessions_id_roster_version_key unique (id, roster_id, exam_version_id),
  constraint student_sessions_token_hash_key unique (session_token_hash),
  constraint student_sessions_consent_request_hash_key unique (consent_request_hash),
  constraint student_sessions_activation_roster_key unique (activation_id, roster_id),
  constraint student_sessions_timestamps_check check (
    lease_expires_at > started_at
    and (last_heartbeat_at is null or last_heartbeat_at >= started_at)
    and (ended_at is null or ended_at >= started_at)
  )
);

comment on column examination_room_v1.student_sessions.session_token_hash is
  'HMAC-SHA-256 token verifier. The bearer token itself must never be stored.';

comment on column examination_room_v1.student_sessions.consent_request_hash is
  'HMAC-SHA-256 consent command receipt used to recover safely from a lost first response without storing the request key.';

create table examination_room_v1.privacy_acceptances (
  id uuid primary key default gen_random_uuid(),
  notice_version_id uuid not null references examination_room_v1.privacy_notice_versions(id) on delete restrict,
  roster_id uuid not null references examination_room_v1.exam_roster(id) on delete restrict,
  session_id uuid not null,
  exam_version_id uuid not null,
  client_event_id uuid not null,
  decision text not null check (decision in ('accepted', 'withdrawn')),
  prior_acceptance_id uuid,
  accepted_features jsonb not null default '{}'::jsonb check (jsonb_typeof(accepted_features) = 'object'),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  capture_method text not null check (capture_method in ('checkbox', 'signed_notice', 'admin_recorded')),
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint privacy_acceptances_session_roster_fk
    foreign key (session_id, roster_id, exam_version_id)
    references examination_room_v1.student_sessions (id, roster_id, exam_version_id)
    on delete restrict,
  constraint privacy_acceptances_version_notice_fk
    foreign key (exam_version_id, notice_version_id)
    references examination_room_v1.exam_versions (id, privacy_notice_version_id)
    on delete restrict,
  constraint privacy_acceptances_session_event_key unique (session_id, client_event_id),
  constraint privacy_acceptances_id_subject_key unique (id, roster_id, notice_version_id, session_id, exam_version_id),
  constraint privacy_acceptances_prior_same_subject_fk
    foreign key (prior_acceptance_id, roster_id, notice_version_id, session_id, exam_version_id)
    references examination_room_v1.privacy_acceptances (id, roster_id, notice_version_id, session_id, exam_version_id)
    on delete restrict,
  constraint privacy_acceptances_prior_required_check check (
    (decision = 'accepted' and prior_acceptance_id is null)
    or (decision = 'withdrawn' and prior_acceptance_id is not null)
  )
);

comment on table examination_room_v1.privacy_acceptances is
  'Append-only acceptance/withdrawal evidence tied to the exact notice version and selected proctoring features.';

create table examination_room_v1.answer_revisions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  exam_version_id uuid not null,
  question_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  client_revision_id uuid not null,
  idempotency_key_hash text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  answer_format text not null check (answer_format in ('rich_text', 'plain_text', 'choice', 'boolean', 'file_reference')),
  answer_payload jsonb not null check (jsonb_typeof(answer_payload) = 'object'),
  answer_sha256 text not null check (answer_sha256 ~ '^[0-9a-f]{64}$'),
  is_flagged boolean not null default false,
  word_count integer check (word_count is null or word_count >= 0),
  source text not null check (source in ('autosave', 'manual_save', 'recovery', 'submission')),
  saved_at timestamptz not null,
  received_at timestamptz not null default now(),
  constraint answer_revisions_session_version_fk
    foreign key (session_id, exam_version_id)
    references examination_room_v1.student_sessions (id, exam_version_id)
    on delete restrict,
  constraint answer_revisions_question_version_fk
    foreign key (question_id, exam_version_id)
    references examination_room_v1.questions (id, exam_version_id)
    on delete restrict,
  constraint answer_revisions_session_question_number_key unique (session_id, question_id, revision_number),
  constraint answer_revisions_session_client_key unique (session_id, client_revision_id),
  constraint answer_revisions_idempotency_key_hash_key unique (idempotency_key_hash),
  constraint answer_revisions_id_session_question_key unique (id, session_id, question_id),
  constraint answer_revisions_clock_skew_check check (saved_at <= received_at + interval '24 hours')
);

create table examination_room_v1.submissions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  exam_version_id uuid not null,
  idempotency_key_hash text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  submission_manifest jsonb not null check (
    jsonb_typeof(submission_manifest) = 'object'
    and submission_manifest ->> 'schemaVersion' = 'examination-room/submission/v1'
  ),
  answer_count integer not null check (answer_count >= 0),
  submitted_at_client timestamptz not null,
  received_at timestamptz not null default now(),
  submission_status text not null default 'accepted' check (submission_status in ('accepted', 'under_review', 'voided')),
  status_reason text,
  status_changed_by_user_id uuid,
  updated_at timestamptz not null default now(),
  constraint submissions_session_version_fk
    foreign key (session_id, exam_version_id)
    references examination_room_v1.student_sessions (id, exam_version_id)
    on delete restrict,
  constraint submissions_session_key unique (session_id),
  constraint submissions_id_session_key unique (id, session_id),
  constraint submissions_id_version_key unique (id, exam_version_id),
  constraint submissions_idempotency_key_hash_key unique (idempotency_key_hash),
  constraint submissions_status_reason_check check (
    (submission_status = 'accepted' and status_reason is null)
    or (submission_status <> 'accepted' and status_reason is not null)
  ),
  constraint submissions_clock_skew_check check (submitted_at_client <= received_at + interval '24 hours')
);

comment on column examination_room_v1.submissions.idempotency_key_hash is
  'HMAC-SHA-256 of the client idempotency key; the raw key is never persisted.';

create table examination_room_v1.submission_answers (
  submission_id uuid not null,
  session_id uuid not null,
  question_id uuid not null,
  answer_revision_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (submission_id, question_id),
  constraint submission_answers_submission_session_fk
    foreign key (submission_id, session_id)
    references examination_room_v1.submissions (id, session_id)
    on delete restrict,
  constraint submission_answers_revision_session_question_fk
    foreign key (answer_revision_id, session_id, question_id)
    references examination_room_v1.answer_revisions (id, session_id, question_id)
    on delete restrict,
  constraint submission_answers_revision_key unique (answer_revision_id)
);

create table examination_room_v1.submission_receipts (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references examination_room_v1.submissions(id) on delete restrict,
  receipt_code uuid not null default gen_random_uuid() unique,
  receipt_sha256 text not null check (receipt_sha256 ~ '^[0-9a-f]{64}$'),
  receipt_payload jsonb not null check (jsonb_typeof(receipt_payload) = 'object'),
  issued_at timestamptz not null default now()
);

comment on table examination_room_v1.submission_receipts is
  'Immutable server receipt for an idempotently accepted submission and its frozen answer manifest.';

create table examination_room_v1.proctoring_incidents (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references examination_room_v1.student_sessions(id) on delete restrict,
  client_event_id uuid not null,
  incident_kind text not null check (incident_kind in (
    'focus_lost', 'fullscreen_exit', 'camera_interrupted', 'microphone_interrupted',
    'network_disconnected', 'device_changed', 'clock_anomaly', 'other'
  )),
  source text not null check (source in ('browser_signal', 'proctor_report', 'system_rule', 'student_report')),
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  occurred_at timestamptz not null,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  details jsonb not null default '{}'::jsonb check (
    jsonb_typeof(details) = 'object'
    and details::text !~* '"(key|token|raw[ _-]?key|room[ _-]?(key|code)|activation[ _-]?(key|code)|exam[ _-]?(key|code)|api[ _-]?key|session[ _-]?token|idempotency[ _-]?key|access[ _-]?(token|code)|refresh[ _-]?token|bearer[ _-]?token|one[ _-]?time[ _-]?code|password|secret|authorization|credential)"[[:space:]]*:'
  ),
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed', 'benign', 'escalated', 'dismissed')),
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proctoring_incidents_session_event_key unique (session_id, client_event_id),
  constraint proctoring_incidents_id_session_key unique (id, session_id),
  constraint proctoring_incidents_review_check check (
    (review_status = 'unreviewed' and reviewed_by_user_id is null and reviewed_at is null)
    or (review_status <> 'unreviewed' and reviewed_by_user_id is not null and reviewed_at is not null)
  )
);

comment on table examination_room_v1.proctoring_incidents is
  'Browser/proctor signals are evidence for review, not automatic proof of misconduct.';

create table examination_room_v1.proctoring_artifacts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references examination_room_v1.student_sessions(id) on delete restrict,
  incident_id uuid,
  artifact_kind text not null check (artifact_kind in ('camera_chunk', 'microphone_chunk', 'screen_chunk', 'still_image')),
  encrypted_object_reference text not null check (length(btrim(encrypted_object_reference)) between 1 and 1024),
  object_sha256 text not null check (object_sha256 ~ '^[0-9a-f]{64}$'),
  encryption_key_reference text not null check (length(btrim(encryption_key_reference)) between 1 and 512),
  captured_from timestamptz not null,
  captured_to timestamptz not null,
  retention_until timestamptz not null,
  artifact_status text not null default 'available' check (artifact_status in ('uploading', 'available', 'quarantined', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proctoring_artifacts_incident_session_fk
    foreign key (incident_id, session_id)
    references examination_room_v1.proctoring_incidents (id, session_id)
    on delete restrict,
  constraint proctoring_artifacts_capture_window_check check (captured_to >= captured_from),
  constraint proctoring_artifacts_retention_check check (retention_until > captured_to),
  constraint proctoring_artifacts_object_reference_key unique (encrypted_object_reference)
);

comment on table examination_room_v1.proctoring_artifacts is
  'Metadata for encrypted external recording chunks; no camera, microphone, or screen media is stored in Postgres.';

create table examination_room_v1.grade_revisions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null,
  exam_version_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  client_revision_id uuid not null,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  grading_manifest jsonb not null check (
    jsonb_typeof(grading_manifest) = 'object'
    and grading_manifest ->> 'schemaVersion' = 'examination-room/grading/v1'
  ),
  grader_user_id uuid not null,
  source text not null check (source in ('online', 'offline_import', 'recovery')),
  grade_status text not null check (grade_status in ('draft', 'final', 'corrected')),
  item_count integer not null check (item_count >= 0),
  total_score numeric(12, 2) not null check (total_score >= 0),
  maximum_score numeric(12, 2) not null check (maximum_score >= 0 and total_score <= maximum_score),
  general_feedback text,
  private_notes text,
  rubric_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(rubric_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  constraint grade_revisions_submission_version_fk
    foreign key (submission_id, exam_version_id)
    references examination_room_v1.submissions (id, exam_version_id)
    on delete restrict,
  constraint grade_revisions_submission_revision_key unique (submission_id, revision_number),
  constraint grade_revisions_submission_client_key unique (submission_id, client_revision_id),
  constraint grade_revisions_id_version_key unique (id, exam_version_id),
  constraint grade_revisions_id_submission_key unique (id, submission_id)
);

create table examination_room_v1.grade_revision_items (
  grade_revision_id uuid not null,
  exam_version_id uuid not null,
  question_id uuid not null,
  score numeric(12, 2) not null check (score >= 0),
  maximum_score numeric(12, 2) not null check (maximum_score >= 0 and score <= maximum_score),
  feedback text,
  rubric_marks jsonb not null default '{}'::jsonb check (jsonb_typeof(rubric_marks) = 'object'),
  created_at timestamptz not null default now(),
  primary key (grade_revision_id, question_id),
  constraint grade_revision_items_revision_version_fk
    foreign key (grade_revision_id, exam_version_id)
    references examination_room_v1.grade_revisions (id, exam_version_id)
    on delete restrict,
  constraint grade_revision_items_question_version_fk
    foreign key (question_id, exam_version_id)
    references examination_room_v1.questions (id, exam_version_id)
    on delete restrict
);

comment on table examination_room_v1.grade_revisions is
  'Append-only grading history. Corrections create a new revision instead of overwriting an earlier grade.';

create table examination_room_v1.result_releases (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references examination_room_v1.submissions(id) on delete restrict,
  grade_revision_id uuid,
  release_action text not null check (release_action in ('release', 'revoke')),
  supersedes_release_id uuid,
  channel text not null check (channel in ('student_portal', 'email_notice', 'offline_export')),
  idempotency_key_hash text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  delivery_reference_hash text check (delivery_reference_hash is null or delivery_reference_hash ~ '^[0-9a-f]{64}$'),
  manifest_sha256 text check (manifest_sha256 is null or manifest_sha256 ~ '^[0-9a-f]{64}$'),
  release_manifest jsonb check (
    release_manifest is null
    or (
      jsonb_typeof(release_manifest) = 'object'
      and release_manifest ->> 'schemaVersion' = 'examination-room/result-release/v1'
    )
  ),
  reason text,
  performed_by_user_id uuid not null,
  occurred_at timestamptz not null default now(),
  constraint result_releases_idempotency_hash_key unique (idempotency_key_hash),
  constraint result_releases_id_submission_key unique (id, submission_id),
  constraint result_releases_grade_same_submission_fk
    foreign key (grade_revision_id, submission_id)
    references examination_room_v1.grade_revisions (id, submission_id)
    on delete restrict,
  constraint result_releases_supersedes_same_submission_fk
    foreign key (supersedes_release_id, submission_id)
    references examination_room_v1.result_releases (id, submission_id)
    on delete restrict,
  constraint result_releases_action_check check (
    (
      release_action = 'release'
      and grade_revision_id is not null
      and supersedes_release_id is null
      and manifest_sha256 is not null
      and release_manifest is not null
    )
    or (
      release_action = 'revoke'
      and grade_revision_id is null
      and supersedes_release_id is not null
      and reason is not null
      and manifest_sha256 is null
      and release_manifest is null
    )
  )
);

create table examination_room_v1.audit_events (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references examination_room_v1.institutions(id) on delete restrict,
  exam_id uuid,
  session_id uuid references examination_room_v1.student_sessions(id) on delete restrict,
  actor_user_id uuid,
  actor_role text not null check (actor_role in ('professor', 'admin', 'student', 'system', 'service')),
  event_type text not null check (length(btrim(event_type)) between 1 and 120),
  subject_type text not null check (length(btrim(subject_type)) between 1 and 80),
  subject_id uuid,
  correlation_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  ip_hash text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent_hash text check (user_agent_hash is null or user_agent_hash ~ '^[0-9a-f]{64}$'),
  event_data jsonb not null default '{}'::jsonb check (
    jsonb_typeof(event_data) = 'object'
    and event_data::text !~* '"(key|token|raw[ _-]?key|room[ _-]?(key|code)|activation[ _-]?(key|code)|exam[ _-]?(key|code)|api[ _-]?key|session[ _-]?token|idempotency[ _-]?key|access[ _-]?(token|code)|refresh[ _-]?token|bearer[ _-]?token|one[ _-]?time[ _-]?code|password|secret|authorization|credential)"[[:space:]]*:'
  ),
  previous_event_hash text check (previous_event_hash is null or previous_event_hash ~ '^[0-9a-f]{64}$'),
  event_hash text not null check (event_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  constraint audit_events_session_requires_exam_check check (session_id is null or exam_id is not null),
  constraint audit_events_exam_institution_fk
    foreign key (exam_id, institution_id)
    references examination_room_v1.exams (id, institution_id)
    on delete restrict,
  constraint audit_events_session_context_fk
    foreign key (session_id, institution_id, exam_id)
    references examination_room_v1.student_sessions (id, institution_id, exam_id)
    on delete restrict,
  constraint audit_events_institution_request_key unique (institution_id, request_hash),
  constraint audit_events_institution_hash_key unique (institution_id, event_hash),
  constraint audit_events_previous_hash_fk
    foreign key (institution_id, previous_event_hash)
    references examination_room_v1.audit_events (institution_id, event_hash)
    on delete restrict
    deferrable initially deferred
);

comment on column examination_room_v1.audit_events.event_data is
  'Structured metadata only. A constraint rejects common raw secret/key field names; callers must log hashes or opaque IDs instead.';

create table examination_room_v1.recovery_snapshots (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null,
  exam_version_id uuid not null,
  snapshot_sequence integer not null check (snapshot_sequence > 0),
  snapshot_scope text not null check (snapshot_scope in ('exam_definition', 'answer_state', 'grading_state', 'full_recovery')),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  encrypted_object_reference text check (encrypted_object_reference is null or length(btrim(encrypted_object_reference)) between 1 and 1024),
  snapshot_sha256 text check (snapshot_sha256 is null or snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  encryption_key_reference text check (encryption_key_reference is null or length(btrim(encryption_key_reference)) between 1 and 512),
  record_count bigint not null check (record_count >= 0),
  snapshot_status text not null default 'pending' check (snapshot_status in ('pending', 'available', 'failed', 'restored', 'expired', 'superseded')),
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  retention_until timestamptz not null,
  restored_at timestamptz,
  restored_by_user_id uuid,
  updated_at timestamptz not null default now(),
  constraint recovery_snapshots_version_exam_fk
    foreign key (exam_version_id, exam_id)
    references examination_room_v1.exam_versions (id, exam_id)
    on delete restrict,
  constraint recovery_snapshots_exam_sequence_key unique (exam_id, snapshot_sequence),
  constraint recovery_snapshots_request_hash_key unique (request_hash),
  constraint recovery_snapshots_object_reference_key unique (encrypted_object_reference),
  constraint recovery_snapshots_retention_check check (retention_until > created_at),
  constraint recovery_snapshots_materialization_check check (
    (snapshot_status in ('pending', 'failed') and encrypted_object_reference is null and snapshot_sha256 is null and encryption_key_reference is null)
    or (snapshot_status not in ('pending', 'failed') and encrypted_object_reference is not null and snapshot_sha256 is not null and encryption_key_reference is not null)
  ),
  constraint recovery_snapshots_restore_check check (
    (snapshot_status <> 'restored' and restored_at is null and restored_by_user_id is null)
    or (snapshot_status = 'restored' and restored_at is not null and restored_by_user_id is not null)
  )
);

comment on table examination_room_v1.recovery_snapshots is
  'Independent encrypted recovery artifacts for exam definitions, answers, and grading state; only object and KMS references are stored.';

create unique index student_identities_institution_auth_key
  on examination_room_v1.student_identities (institution_id, auth_user_id)
  where auth_user_id is not null;
create index staff_memberships_active_user_idx
  on examination_room_v1.staff_memberships (user_id, institution_id, staff_role)
  where membership_status = 'active';
create unique index staff_memberships_one_active_role_idx
  on examination_room_v1.staff_memberships (institution_id, user_id, staff_role)
  where membership_status = 'active';
create index student_identities_email_idx
  on examination_room_v1.student_identities (institution_id, email_normalized);
create index exams_owner_status_idx
  on examination_room_v1.exams (institution_id, owner_user_id, status);
create index exam_versions_published_idx
  on examination_room_v1.exam_versions (exam_id, published_at desc);
create index exam_roster_status_idx
  on examination_room_v1.exam_roster (exam_id, roster_status);
create unique index exam_roster_grading_alias_key
  on examination_room_v1.exam_roster (exam_id, grading_alias)
  where grading_alias is not null;
create index room_activations_window_idx
  on examination_room_v1.room_activations (exam_id, activation_status, opens_at, closes_at);
create unique index student_sessions_one_open_per_roster_idx
  on examination_room_v1.student_sessions (activation_id, roster_id)
  where session_status in ('created', 'active');
create index student_sessions_heartbeat_idx
  on examination_room_v1.student_sessions (activation_id, session_status, last_heartbeat_at);
create index privacy_acceptances_roster_notice_idx
  on examination_room_v1.privacy_acceptances (roster_id, notice_version_id, recorded_at desc);
create unique index privacy_acceptances_one_withdrawal_idx
  on examination_room_v1.privacy_acceptances (prior_acceptance_id)
  where decision = 'withdrawn';
create index answer_revisions_latest_idx
  on examination_room_v1.answer_revisions (session_id, question_id, revision_number desc);
create index submissions_status_received_idx
  on examination_room_v1.submissions (submission_status, received_at desc);
create index proctoring_incidents_review_idx
  on examination_room_v1.proctoring_incidents (session_id, review_status, occurred_at desc);
create index proctoring_artifacts_session_idx
  on examination_room_v1.proctoring_artifacts (session_id, artifact_kind, captured_from);
create index grade_revisions_latest_idx
  on examination_room_v1.grade_revisions (submission_id, revision_number desc);
create index result_releases_submission_idx
  on examination_room_v1.result_releases (submission_id, occurred_at desc);
create unique index result_releases_one_revocation_per_release_idx
  on examination_room_v1.result_releases (supersedes_release_id)
  where release_action = 'revoke';
create index audit_events_institution_idx
  on examination_room_v1.audit_events (institution_id, recorded_at desc);
create index audit_events_exam_idx
  on examination_room_v1.audit_events (exam_id, occurred_at desc)
  where exam_id is not null;
create index audit_events_session_idx
  on examination_room_v1.audit_events (session_id, occurred_at desc)
  where session_id is not null;
create index recovery_snapshots_status_idx
  on examination_room_v1.recovery_snapshots (exam_id, snapshot_status, created_at desc);

create trigger exams_touch_updated_at
before update on examination_room_v1.exams
for each row execute function examination_room_v1.touch_updated_at();
create trigger staff_memberships_touch_updated_at
before update on examination_room_v1.staff_memberships
for each row execute function examination_room_v1.touch_updated_at();
create trigger staff_memberships_history_locked
before update on examination_room_v1.staff_memberships
for each row execute function examination_room_v1.protect_staff_membership_history();
create trigger professor_access_requests_history_locked
before insert or update on examination_room_v1.professor_access_requests
for each row execute function examination_room_v1.protect_professor_access_request_history();
create trigger student_identities_touch_updated_at
before update on examination_room_v1.student_identities
for each row execute function examination_room_v1.touch_updated_at();
create trigger exam_roster_touch_updated_at
before update on examination_room_v1.exam_roster
for each row execute function examination_room_v1.touch_updated_at();
create trigger student_sessions_touch_updated_at
before update on examination_room_v1.student_sessions
for each row execute function examination_room_v1.touch_updated_at();
create trigger submissions_touch_updated_at
before update on examination_room_v1.submissions
for each row execute function examination_room_v1.touch_updated_at();
create trigger proctoring_incidents_touch_updated_at
before update on examination_room_v1.proctoring_incidents
for each row execute function examination_room_v1.touch_updated_at();
create trigger proctoring_artifacts_touch_updated_at
before update on examination_room_v1.proctoring_artifacts
for each row execute function examination_room_v1.touch_updated_at();
create trigger recovery_snapshots_touch_updated_at
before update on examination_room_v1.recovery_snapshots
for each row execute function examination_room_v1.touch_updated_at();

create trigger exams_current_version_must_be_published
before insert or update on examination_room_v1.exams
for each row execute function examination_room_v1.ensure_exam_current_version_published();
create trigger exams_owner_must_be_authorized
before insert or update of institution_id, owner_user_id on examination_room_v1.exams
for each row execute function examination_room_v1.validate_exam_owner();
create trigger room_activations_validate
before insert or update on examination_room_v1.room_activations
for each row execute function examination_room_v1.validate_room_activation();
create trigger result_releases_validate_grade
before insert on examination_room_v1.result_releases
for each row execute function examination_room_v1.ensure_releasable_grade();
create trigger privacy_acceptances_validate
before insert on examination_room_v1.privacy_acceptances
for each row execute function examination_room_v1.validate_privacy_acceptance();
create trigger submission_receipts_validate
before insert on examination_room_v1.submission_receipts
for each row execute function examination_room_v1.validate_submission_receipt();

create trigger exams_identity_locked
before update of id, institution_id, created_at on examination_room_v1.exams
for each row execute function examination_room_v1.prevent_mutation();
create trigger exam_roster_binding_locked
before update of id, exam_id, institution_id, student_identity_id, created_at on examination_room_v1.exam_roster
for each row execute function examination_room_v1.prevent_mutation();
create trigger student_sessions_binding_locked
before update of id, activation_id, exam_id, institution_id, exam_version_id, roster_id, session_token_hash, consent_request_hash, client_instance_id, started_at, created_at
on examination_room_v1.student_sessions
for each row execute function examination_room_v1.protect_student_session_binding();
create trigger submissions_evidence_locked
before update of id, session_id, exam_version_id, idempotency_key_hash, manifest_sha256, submission_manifest, answer_count, submitted_at_client, received_at
on examination_room_v1.submissions
for each row execute function examination_room_v1.prevent_mutation();
create trigger proctoring_incidents_evidence_locked
before update of id, session_id, client_event_id, incident_kind, source, severity, occurred_at, duration_ms, details, created_at
on examination_room_v1.proctoring_incidents
for each row execute function examination_room_v1.prevent_mutation();
create trigger proctoring_artifacts_evidence_locked
before update of id, session_id, incident_id, artifact_kind, encrypted_object_reference, object_sha256, encryption_key_reference, captured_from, captured_to, retention_until, created_at
on examination_room_v1.proctoring_artifacts
for each row execute function examination_room_v1.prevent_mutation();
create trigger recovery_snapshots_evidence_locked
before update
on examination_room_v1.recovery_snapshots
for each row execute function examination_room_v1.protect_recovery_snapshot();

create trigger privacy_notice_versions_immutable
before update or delete on examination_room_v1.privacy_notice_versions
for each row execute function examination_room_v1.prevent_mutation();
create trigger institutions_immutable
before update or delete on examination_room_v1.institutions
for each row execute function examination_room_v1.prevent_mutation();
create trigger exam_versions_immutable
before update or delete on examination_room_v1.exam_versions
for each row execute function examination_room_v1.seal_exam_version();
create trigger questions_immutable
before insert or update or delete on examination_room_v1.questions
for each row execute function examination_room_v1.protect_published_question();
create trigger privacy_acceptances_immutable
before update or delete on examination_room_v1.privacy_acceptances
for each row execute function examination_room_v1.prevent_mutation();
create trigger answer_revisions_immutable
before update or delete on examination_room_v1.answer_revisions
for each row execute function examination_room_v1.prevent_mutation();
create trigger submission_answers_immutable
before insert or update or delete on examination_room_v1.submission_answers
for each row execute function examination_room_v1.protect_submission_answer_set();
create trigger submission_receipts_immutable
before update or delete on examination_room_v1.submission_receipts
for each row execute function examination_room_v1.prevent_mutation();
create trigger grade_revisions_immutable
before update or delete on examination_room_v1.grade_revisions
for each row execute function examination_room_v1.prevent_mutation();
create trigger grade_revision_items_immutable
before insert or update or delete on examination_room_v1.grade_revision_items
for each row execute function examination_room_v1.protect_grade_revision_item_set();
create trigger result_releases_immutable
before update or delete on examination_room_v1.result_releases
for each row execute function examination_room_v1.prevent_mutation();
create trigger audit_events_immutable
before update or delete on examination_room_v1.audit_events
for each row execute function examination_room_v1.prevent_mutation();

create trigger submissions_no_delete
before delete on examination_room_v1.submissions
for each row execute function examination_room_v1.prevent_delete();
create trigger staff_memberships_no_delete
before delete on examination_room_v1.staff_memberships
for each row execute function examination_room_v1.prevent_delete();
create trigger professor_access_requests_no_delete
before delete on examination_room_v1.professor_access_requests
for each row execute function examination_room_v1.prevent_delete();
create trigger room_activations_no_delete
before delete on examination_room_v1.room_activations
for each row execute function examination_room_v1.prevent_delete();
create trigger student_sessions_no_delete
before delete on examination_room_v1.student_sessions
for each row execute function examination_room_v1.prevent_delete();
create trigger proctoring_incidents_no_delete
before delete on examination_room_v1.proctoring_incidents
for each row execute function examination_room_v1.prevent_delete();
create trigger proctoring_artifacts_no_delete
before delete on examination_room_v1.proctoring_artifacts
for each row execute function examination_room_v1.prevent_delete();
create trigger recovery_snapshots_no_delete
before delete on examination_room_v1.recovery_snapshots
for each row execute function examination_room_v1.prevent_delete();

create function examination_room_v1.api_error(
  p_code text,
  p_message text,
  p_status integer default 409,
  p_recovery text default 'Refresh the view and try again. Your saved work remains preserved.'
)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'ok', false,
    'errorCode', p_code,
    'message', p_message,
    'error', jsonb_build_object(
      'code', p_code,
      'message', p_message,
      'status', p_status,
      'recovery', p_recovery
    )
  );
$$;

create function examination_room_v1.jsonb_sha256(p_value jsonb)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select encode(sha256(convert_to(p_value::text, 'UTF8')), 'hex');
$$;

create function examination_room_v1.lock_request(
  p_institution_id uuid,
  p_request_hash text
)
returns void
language sql
volatile
strict
set search_path = pg_catalog
as $$
  select pg_advisory_xact_lock(
    hashtextextended(
      'examination-room-v1:request:' || p_institution_id::text || ':' || p_request_hash,
      20260826
    )
  );
$$;

create function examination_room_v1.next_snapshot_sequence(p_exam_id uuid)
returns integer
language plpgsql
volatile
strict
set search_path = pg_catalog
as $$
declare
  next_sequence integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('examination-room-v1:snapshot:' || p_exam_id::text, 20260826)
  );
  select coalesce(max(s.snapshot_sequence), 0) + 1
  into next_sequence
  from examination_room_v1.recovery_snapshots s
  where s.exam_id = p_exam_id;
  return next_sequence;
end;
$$;

create function examination_room_v1.uuid_from_hash(p_hash text)
returns uuid
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select (
    substr(p_hash, 1, 8) || '-' ||
    substr(p_hash, 9, 4) || '-' ||
    '4' || substr(p_hash, 14, 3) || '-' ||
    '8' || substr(p_hash, 18, 3) || '-' ||
    substr(p_hash, 21, 12)
  )::uuid;
$$;

create function examination_room_v1.grader_safe_submission_manifest(
  p_manifest jsonb,
  p_anonymous_grading boolean,
  p_grading_alias text,
  p_opaque_session_id uuid
)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when not p_anonymous_grading then p_manifest
    else p_manifest || jsonb_build_object(
      'attemptId', p_opaque_session_id,
      'studentIdentity', jsonb_build_object(
        'realName', p_grading_alias,
        'studentNumber', p_grading_alias,
        'subject', p_manifest ->> 'subject',
        'yearLevel', p_manifest ->> 'yearLevel'
      ),
      'gradingIdentity', jsonb_build_object(
        'mode', 'anonymous_grading',
        'anonymousCandidateId', p_grading_alias
      )
    )
  end;
$$;

create function examination_room_v1.api_replay(
  p_institution_id uuid,
  p_request_hash text,
  p_event_type text
)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  stored_event_type text;
  stored_response jsonb;
begin
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    return examination_room_v1.api_error(
      'REQUEST_HASH_INVALID',
      'The command fingerprint is missing or invalid.',
      400,
      'Refresh the page so a new secure request can be created.'
    );
  end if;

  select a.event_type, a.event_data -> 'response'
  into stored_event_type, stored_response
  from examination_room_v1.audit_events a
  where a.institution_id = p_institution_id
    and a.request_hash = p_request_hash;

  if stored_event_type is null then
    return null;
  end if;

  if stored_event_type <> p_event_type then
    return examination_room_v1.api_error(
      'IDEMPOTENCY_KEY_REUSED',
      'That request fingerprint was already used for a different action.',
      409,
      'Refresh the page and repeat the action once with a new request.'
    );
  end if;

  return coalesce(stored_response, jsonb_build_object('ok', true, 'duplicate', true));
end;
$$;

create function examination_room_v1.api_record_audit(
  p_institution_id uuid,
  p_exam_id uuid,
  p_session_id uuid,
  p_actor_user_id uuid,
  p_actor_role text,
  p_event_type text,
  p_subject_type text,
  p_subject_id uuid,
  p_request_hash text,
  p_occurred_at timestamptz,
  p_response jsonb,
  p_correlation_id uuid default null
)
returns void
language plpgsql
volatile
set search_path = pg_catalog
as $$
declare
  prior_hash text;
  audit_payload jsonb;
  computed_event_hash text;
  audit_occurred_at timestamptz;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('examination-room-v1:audit:' || p_institution_id::text, 20260826)
  );

  select a.event_hash
  into prior_hash
  from examination_room_v1.audit_events a
  where a.institution_id = p_institution_id
  order by a.recorded_at desc, a.id desc
  limit 1;

  audit_payload := jsonb_build_object(
    'response', coalesce(p_response, jsonb_build_object('ok', true)) - 'publicationManifest'
  );
  audit_occurred_at := coalesce(p_occurred_at, clock_timestamp());
  computed_event_hash := examination_room_v1.jsonb_sha256(jsonb_build_object(
    'institutionId', p_institution_id,
    'examId', p_exam_id,
    'sessionId', p_session_id,
    'actorUserId', p_actor_user_id,
    'actorRole', p_actor_role,
    'eventType', p_event_type,
    'subjectType', p_subject_type,
    'subjectId', p_subject_id,
    'correlationId', coalesce(p_correlation_id, examination_room_v1.uuid_from_hash(p_request_hash)),
    'requestHash', p_request_hash,
    'eventData', audit_payload,
    'previousEventHash', prior_hash,
    'occurredAt', audit_occurred_at
  ));

  insert into examination_room_v1.audit_events (
    institution_id,
    exam_id,
    session_id,
    actor_user_id,
    actor_role,
    event_type,
    subject_type,
    subject_id,
    correlation_id,
    request_hash,
    event_data,
    previous_event_hash,
    event_hash,
    occurred_at
  ) values (
    p_institution_id,
    p_exam_id,
    p_session_id,
    p_actor_user_id,
    p_actor_role,
    p_event_type,
    p_subject_type,
    p_subject_id,
    coalesce(p_correlation_id, examination_room_v1.uuid_from_hash(p_request_hash)),
    p_request_hash,
    audit_payload,
    prior_hash,
    computed_event_hash,
    audit_occurred_at
  );
end;
$$;

create function examination_room_v1.build_publication_manifest(
  p_exam_version_id uuid,
  p_published_at timestamptz
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'schemaVersion', 'examination-room/publication/v1',
    'examinationId', v.exam_id,
    'version', v.version_number,
    'publishedAt', to_char(p_published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'title', v.title_snapshot,
    'subject', coalesce(v.controls ->> 'subject', ''),
    'yearLevel', coalesce(v.controls ->> 'yearLevel', ''),
    'instructions', v.instructions,
    'identityMode', coalesce(v.controls ->> 'identityMode', 'real_names'),
    'integrityTier', coalesce(v.controls ->> 'integrityTier', 'standard'),
    'privacyNoticeVersion', coalesce(v.controls ->> 'privacyNoticeVersion', n.notice_code),
    'questions', coalesce(q.questions, '[]'::jsonb),
    'questionCount', coalesce(q.question_count, 0),
    'totalPoints', coalesce(q.total_points, 0)
  )
  from examination_room_v1.exam_versions v
  join examination_room_v1.privacy_notice_versions n on n.id = v.privacy_notice_version_id
  left join lateral (
    select
      jsonb_agg(
        jsonb_build_object(
          'number', questions.position,
          'key', questions.question_key,
          'type', coalesce(questions.configuration ->> 'type', replace(questions.question_kind, '_', '-')),
          'prompt', questions.prompt,
          'points', questions.points,
          'gradingGuidance', coalesce(questions.configuration ->> 'gradingGuidance', ''),
          'wordLimit', case when questions.configuration ? 'wordLimit' then questions.configuration -> 'wordLimit' else 'null'::jsonb end,
          'choices', coalesce(questions.configuration -> 'choices', '[]'::jsonb),
          'correctOptionIndex', coalesce(questions.configuration -> 'correctOptionIndex', 'null'::jsonb),
          'acceptedAnswers', coalesce(questions.configuration -> 'acceptedAnswers', '[]'::jsonb)
        )
        order by questions.position
      ) as questions,
      count(*)::integer as question_count,
      coalesce(sum(questions.points), 0) as total_points
    from examination_room_v1.questions
    where questions.exam_version_id = v.id
  ) q on true
  where v.id = p_exam_version_id;
$$;

revoke all on function examination_room_v1.api_error(text, text, integer, text) from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.jsonb_sha256(jsonb) from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.lock_request(uuid, text) from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.next_snapshot_sequence(uuid) from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.uuid_from_hash(text) from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.grader_safe_submission_manifest(jsonb, boolean, text, uuid) from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.api_replay(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.api_record_audit(uuid, uuid, uuid, uuid, text, text, text, uuid, text, timestamptz, jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.build_publication_manifest(uuid, timestamptz) from public, anon, authenticated, service_role;

create function examination_room_v1.api_professor(
  p_operation text,
  p_actor_user_id uuid,
  p_institution_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  actor_is_admin boolean;
  actor_name text;
  actor_email text;
  exam_id uuid;
  exam_owner_id uuid;
  version_id uuid;
  version_number integer;
  notice_id uuid;
  request_hash text;
  requested_at timestamptz;
  exam_payload jsonb;
  draft_payload jsonb;
  controls_payload jsonb;
  publication_bundle jsonb;
  publication_hash text;
  response jsonb;
  replay jsonb;
  roster_item jsonb;
  student_identity_id uuid;
  roster_row_id uuid;
  use_anonymous_grading boolean;
  question_count integer;
  roster_count integer;
  submission_id uuid;
  student_session_id uuid;
  exam_version_id uuid;
  grading_manifest jsonb;
  release_manifest jsonb;
  expected_result jsonb;
  release_item jsonb;
  score_item jsonb;
  grade_revision_id uuid;
  grade_revision_number integer;
  question_id uuid;
  score_count integer;
  distinct_score_count integer;
  total_score numeric(12, 2);
  maximum_score numeric(12, 2);
  event_time timestamptz;
begin
  actor_is_admin := exists (
    select 1
    from examination_room_v1.staff_memberships m
    where m.institution_id = p_institution_id
      and m.user_id = p_actor_user_id
      and m.staff_role = 'admin'
      and m.membership_status = 'active'
  );

  select m.display_name, m.email_normalized
  into actor_name, actor_email
  from examination_room_v1.staff_memberships m
  where m.institution_id = p_institution_id
    and m.user_id = p_actor_user_id
    and m.membership_status = 'active'
  order by (m.staff_role = 'admin') desc, m.granted_at desc
  limit 1;

  if p_operation = 'session' then
    select jsonb_build_object(
      'ok', true,
      'professor', jsonb_build_object(
        'id', p_actor_user_id,
        'authorized', true,
        'displayName', coalesce(actor_name, 'Professor'),
        'email', actor_email,
        'institutionId', p_institution_id,
        'adminTesting', actor_is_admin
      ),
      'exam', coalesce(exams.items -> 0, 'null'::jsonb),
      'exams', exams.items
    )
    into response
    from lateral (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'title', e.title,
          'status', e.status,
          'anonymousGrading', e.anonymous_grading,
          'currentVersionId', e.current_published_version_id,
          'updatedAt', e.updated_at
        ) order by e.updated_at desc
      ), '[]'::jsonb) as items
      from examination_room_v1.exams e
      where e.institution_id = p_institution_id
        and (actor_is_admin or e.owner_user_id = p_actor_user_id)
    ) exams;
    return response;
  end if;

  if p_operation in ('exam', 'monitor', 'grading', 'grading_context') then
    exam_id := nullif(p_payload ->> 'examId', '')::uuid;
  end if;

  if p_operation = 'release_context' then
    exam_id := nullif(p_payload ->> 'examId', '')::uuid;
  end if;

  if p_operation in ('exam', 'monitor', 'grading', 'grading_context', 'release_context', 'open_room', 'close_room', 'save_grade', 'release_results') then
    if exam_id is null then
      exam_id := nullif(p_payload ->> 'examId', '')::uuid;
    end if;

    select e.owner_user_id
    into exam_owner_id
    from examination_room_v1.exams e
    where e.id = exam_id
      and e.institution_id = p_institution_id;

    if exam_owner_id is null then
      return examination_room_v1.api_error(
        'EXAM_NOT_FOUND', 'The examination does not exist in this institution.', 404,
        'Return to the Examination Room list and choose an available examination.'
      );
    end if;

    if not actor_is_admin and exam_owner_id <> p_actor_user_id then
      return examination_room_v1.api_error(
        'FORBIDDEN', 'Only the examination owner or an administrator may access this examination.', 403,
        'Choose an examination assigned to your account.'
      );
    end if;
  end if;

  if p_operation = 'exam' then
    select coalesce(
      (
        select v.id
        from examination_room_v1.exam_versions v
        where v.exam_id = exam_id
        order by (v.publication_status = 'building') desc, v.version_number desc
        limit 1
      ),
      e.current_published_version_id
    )
    into version_id
    from examination_room_v1.exams e
    where e.id = exam_id;

    select jsonb_build_object(
      'ok', true,
      'exam', jsonb_build_object(
        'id', e.id,
        'examId', e.id,
        'title', e.title,
        'description', e.description,
        'status', e.status,
        'anonymousGrading', e.anonymous_grading,
        'currentPublishedVersionId', e.current_published_version_id,
        'versionId', v.id,
        'version', v.version_number,
        'publicationStatus', v.publication_status,
        'instructions', v.instructions,
        'durationMinutes', v.duration_seconds / 60,
        'controls', v.controls,
        'questions', coalesce(q.items, '[]'::jsonb),
        'roster', coalesce(r.items, '[]'::jsonb)
      ),
      'publicationManifest', case when v.publication_status = 'published' then v.publication_manifest else null end
    )
    into response
    from examination_room_v1.exams e
    left join examination_room_v1.exam_versions v on v.id = version_id
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'questionNumber', q.position,
          'questionKey', q.question_key,
          'questionKind', q.question_kind,
          'type', coalesce(q.configuration ->> 'type', replace(q.question_kind, '_', '-')),
          'prompt', q.prompt,
          'points', q.points,
          'gradingGuidance', coalesce(q.configuration ->> 'gradingGuidance', ''),
          'wordLimit', q.configuration -> 'wordLimit',
          'choices', coalesce(q.configuration -> 'choices', '[]'::jsonb),
          'correctOptionIndex', q.configuration -> 'correctOptionIndex',
          'acceptedAnswers', coalesce(q.configuration -> 'acceptedAnswers', '[]'::jsonb)
        ) order by q.position
      ) as items
      from examination_room_v1.questions q
      where q.exam_version_id = v.id
    ) q on true
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'id', er.id,
          'fullName', si.full_name,
          'studentNumber', si.external_student_id,
          'email', si.email_normalized,
          'yearLevel', er.accommodations ->> 'yearLevel',
          'subject', er.accommodations ->> 'subject',
          'extraMinutes', coalesce((er.accommodations ->> 'extraMinutes')::integer, 0),
          'status', er.roster_status,
          'gradingAlias', er.grading_alias
        ) order by si.full_name
      ) as items
      from examination_room_v1.exam_roster er
      join examination_room_v1.student_identities si on si.id = er.student_identity_id
      where er.exam_id = e.id
    ) r on true
    where e.id = exam_id;
    return response;
  end if;

  if p_operation = 'monitor' then
    select jsonb_build_object(
      'ok', true,
      'examId', e.id,
      'title', e.title,
      'status', e.status,
      'activation', a.item,
      'students', coalesce(s.items, '[]'::jsonb)
    )
    into response
    from examination_room_v1.exams e
    left join lateral (
      select jsonb_build_object(
        'id', ra.id,
        'status', ra.activation_status,
        'opensAt', ra.opens_at,
        'closesAt', ra.closes_at,
        'maxSessions', ra.max_sessions
      ) as item
      from examination_room_v1.room_activations ra
      where ra.exam_id = e.id
      order by ra.created_at desc
      limit 1
    ) a on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'sessionId', ss.id,
        'fullName', si.full_name,
        'studentNumber', si.external_student_id,
        'gradingAlias', case when e.anonymous_grading then null else er.grading_alias end,
        'status', ss.session_status,
        'startedAt', ss.started_at,
        'lastHeartbeatAt', ss.last_heartbeat_at,
        'currentQuestion', ss.session_metadata -> 'currentQuestion',
        'connected', coalesce((ss.session_metadata ->> 'connected')::boolean, false),
        'incidentCount', (select count(*) from examination_room_v1.proctoring_incidents pi where pi.session_id = ss.id),
        'submitted', exists (select 1 from examination_room_v1.submissions sub where sub.session_id = ss.id)
      ) order by si.full_name) as items
      from examination_room_v1.exam_roster er
      join examination_room_v1.student_identities si on si.id = er.student_identity_id
      left join examination_room_v1.student_sessions ss on ss.roster_id = er.id
      where er.exam_id = e.id
        and ss.id is not null
    ) s on true
    where e.id = exam_id;
    return response;
  end if;

  if p_operation = 'grading' then
    select jsonb_build_object(
      'ok', true,
      'examId', e.id,
      'title', e.title,
      'students', coalesce(g.items, '[]'::jsonb)
    )
    into response
    from examination_room_v1.exams e
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'sessionId', case
          when e.anonymous_grading then examination_room_v1.uuid_from_hash(sub.idempotency_key_hash)
          else ss.id
        end,
        'submissionId', sub.id,
        'displayName', case when e.anonymous_grading then er.grading_alias else si.full_name end,
        'studentNumber', case when e.anonymous_grading then null else si.external_student_id end,
        'submittedAt', sub.received_at,
        'submissionStatus', sub.submission_status,
        'latestGrade', gr.grading_manifest,
        'released', exists (
          select 1 from examination_room_v1.result_releases rr
          where rr.submission_id = sub.id
            and rr.release_action = 'release'
            and not exists (
              select 1 from examination_room_v1.result_releases rv
              where rv.supersedes_release_id = rr.id and rv.release_action = 'revoke'
            )
        )
      ) order by sub.received_at) as items
      from examination_room_v1.submissions sub
      join examination_room_v1.student_sessions ss on ss.id = sub.session_id
      join examination_room_v1.exam_roster er on er.id = ss.roster_id
      join examination_room_v1.student_identities si on si.id = er.student_identity_id
      left join lateral (
        select grades.grading_manifest
        from examination_room_v1.grade_revisions grades
        where grades.submission_id = sub.id
        order by grades.revision_number desc
        limit 1
      ) gr on true
      where ss.exam_id = e.id
    ) g on true
    where e.id = exam_id;
    return response;
  end if;

  if p_operation = 'grading_context' then
    select
      sub.id,
      sub.exam_version_id,
      examination_room_v1.grader_safe_submission_manifest(
        sub.submission_manifest,
        e.anonymous_grading,
        er.grading_alias,
        examination_room_v1.uuid_from_hash(sub.idempotency_key_hash)
      ) || jsonb_build_object('idempotencyKey', sub.idempotency_key_hash)
    into submission_id, exam_version_id, draft_payload
    from examination_room_v1.student_sessions ss
    join examination_room_v1.submissions sub on sub.session_id = ss.id
    join examination_room_v1.exams e on e.id = ss.exam_id
    join examination_room_v1.exam_roster er on er.id = ss.roster_id
    where (
        (not e.anonymous_grading and ss.id = (p_payload ->> 'sessionId')::uuid)
        or (
          e.anonymous_grading
          and examination_room_v1.uuid_from_hash(sub.idempotency_key_hash) = (p_payload ->> 'sessionId')::uuid
        )
      )
      and ss.exam_id = exam_id
      and ss.institution_id = p_institution_id;

    if submission_id is null then
      return examination_room_v1.api_error(
        'SUBMISSION_NOT_FOUND', 'The student has not submitted this examination.', 409,
        'Refresh grading after the student submits.'
      );
    end if;

    select q.position
    into question_count
    from examination_room_v1.questions q
    where q.exam_version_id = exam_version_id
      and (
        q.question_key = p_payload ->> 'questionReference'
        or q.position::text = p_payload ->> 'questionReference'
        or 'q-' || q.position::text = p_payload ->> 'questionReference'
      );

    if question_count is null then
      return examination_room_v1.api_error(
        'QUESTION_NOT_FOUND', 'That question is not part of the submitted examination version.', 409,
        'Refresh grading and choose a listed question.'
      );
    end if;

    select jsonb_build_object(
      'ok', true,
      'publicationManifest', v.publication_manifest,
      'submissionManifest', draft_payload,
      'questionNumber', question_count,
      'scores', coalesce(gr.scores, '[]'::jsonb),
      'nextRevision', coalesce(gr.revision_number, 0) + 1,
      'overallFeedback', coalesce(gr.general_feedback, '')
    )
    into response
    from examination_room_v1.exam_versions v
    left join lateral (
      select
        grades.revision_number,
        grades.general_feedback,
        (
          select jsonb_agg(jsonb_build_object(
            'questionNumber', q.position,
            'pointsAwarded', item.score,
            'feedback', coalesce(item.feedback, '')
          ) order by q.position)
          from examination_room_v1.grade_revision_items item
          join examination_room_v1.questions q on q.id = item.question_id
          where item.grade_revision_id = grades.id
        ) as scores
      from examination_room_v1.grade_revisions grades
      where grades.submission_id = submission_id
      order by grades.revision_number desc
      limit 1
    ) gr on true
    where v.id = exam_version_id;
    return response;
  end if;

  if p_operation = 'release_context' then
    if jsonb_typeof(p_payload -> 'sessionIds') <> 'array'
       or jsonb_array_length(p_payload -> 'sessionIds') = 0 then
      return examination_room_v1.api_error(
        'RESULT_RECIPIENT_REQUIRED', 'Select at least one submitted student.', 400,
        'Select the intended students, then release again.'
      );
    end if;

    select jsonb_build_object('ok', true, 'entries', coalesce(jsonb_agg(entry.item order by entry.session_id), '[]'::jsonb))
    into response
    from (
      select
        case
          when e.anonymous_grading then examination_room_v1.uuid_from_hash(sub.idempotency_key_hash)
          else ss.id
        end as session_id,
        jsonb_build_object(
          'sessionId', case
            when e.anonymous_grading then examination_room_v1.uuid_from_hash(sub.idempotency_key_hash)
            else ss.id
          end,
          'nextRevision', coalesce(gr.revision_number, 0) + 1,
          'submissionManifest', examination_room_v1.grader_safe_submission_manifest(
            sub.submission_manifest,
            e.anonymous_grading,
            er.grading_alias,
            examination_room_v1.uuid_from_hash(sub.idempotency_key_hash)
          ) || jsonb_build_object('idempotencyKey', sub.idempotency_key_hash),
          'scores', coalesce(gr.scores, '[]'::jsonb),
          'overallFeedback', coalesce(gr.general_feedback, '')
        ) as item
      from jsonb_array_elements_text(p_payload -> 'sessionIds') requested(session_id)
      join examination_room_v1.student_sessions ss on true
      join examination_room_v1.submissions sub on sub.session_id = ss.id and sub.submission_status = 'accepted'
      join examination_room_v1.exams e on e.id = ss.exam_id
      join examination_room_v1.exam_roster er on er.id = ss.roster_id
      left join lateral (
        select
          grades.revision_number,
          grades.general_feedback,
          (
            select jsonb_agg(jsonb_build_object(
              'questionNumber', q.position,
              'pointsAwarded', item.score,
              'feedback', coalesce(item.feedback, '')
            ) order by q.position)
            from examination_room_v1.grade_revision_items item
            join examination_room_v1.questions q on q.id = item.question_id
            where item.grade_revision_id = grades.id
          ) as scores
        from examination_room_v1.grade_revisions grades
        where grades.submission_id = sub.id
        order by grades.revision_number desc
        limit 1
      ) gr on true
      where ss.exam_id = exam_id
        and ss.institution_id = p_institution_id
        and (
          (not e.anonymous_grading and ss.id = requested.session_id::uuid)
          or (
            e.anonymous_grading
            and examination_room_v1.uuid_from_hash(sub.idempotency_key_hash) = requested.session_id::uuid
          )
        )
    ) entry;

    if jsonb_array_length(response -> 'entries') <> jsonb_array_length(p_payload -> 'sessionIds') then
      return examination_room_v1.api_error(
        'GRADING_CONTEXT_INVALID', 'One or more selected students does not have an accepted submission.', 409,
        'Refresh grading, review the selected students, then release again.'
      );
    end if;
    return response;
  end if;

  if p_operation in ('save_draft', 'publish') then
    request_hash := p_payload ->> 'requestHash';
    requested_at := coalesce((p_payload ->> 'requestedAt')::timestamptz, clock_timestamp());
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(p_institution_id, request_hash, 'professor.' || p_operation);
    if replay is not null then
      if p_operation = 'publish' and replay ->> 'ok' = 'true' then
        select v.publication_manifest
        into publication_bundle
        from examination_room_v1.exam_versions v
        where v.id = (replay ->> 'versionId')::uuid
          and v.exam_id = (replay ->> 'examId')::uuid
          and v.institution_id = p_institution_id
          and v.publication_status = 'published';
        replay := replay || jsonb_build_object('publicationManifest', publication_bundle);
      end if;
      return replay;
    end if;

    exam_payload := p_payload -> 'exam';
    draft_payload := p_payload -> 'draft';
    if jsonb_typeof(exam_payload) <> 'object' or jsonb_typeof(draft_payload) <> 'object' then
      return examination_room_v1.api_error(
        'EXAM_PAYLOAD_INVALID', 'The normalized examination draft is missing.', 400,
        'Refresh the creator and save the examination again.'
      );
    end if;

    exam_id := nullif(exam_payload ->> 'examId', '')::uuid;
    if exam_id is null then
      exam_id := gen_random_uuid();
    end if;

    select e.owner_user_id
    into exam_owner_id
    from examination_room_v1.exams e
    where e.id = exam_id
      and e.institution_id = p_institution_id
    for update;

    if exam_owner_id is not null and not actor_is_admin and exam_owner_id <> p_actor_user_id then
      return examination_room_v1.api_error(
        'FORBIDDEN', 'Only the examination owner or an administrator may change this examination.', 403,
        'Choose an examination assigned to your account.'
      );
    end if;

    select n.id
    into notice_id
    from examination_room_v1.privacy_notice_versions n
    where n.institution_id = p_institution_id
      and n.notice_code = lower(exam_payload ->> 'privacyNoticeVersion')
      and n.effective_at <= requested_at
    order by n.version_number desc
    limit 1;

    if notice_id is null then
      return examination_room_v1.api_error(
        'PRIVACY_NOTICE_NOT_CONFIGURED',
        'The selected privacy notice has not been approved for this institution.',
        409,
        'Ask the administrator to publish the exact privacy notice version, then save or publish again.'
      );
    end if;

    if p_operation = 'publish'
       and (
         jsonb_array_length(coalesce(exam_payload -> 'questions', '[]'::jsonb)) = 0
         or jsonb_array_length(coalesce(exam_payload -> 'roster', '[]'::jsonb)) = 0
       ) then
      return examination_room_v1.api_error(
        'PUBLICATION_NOT_READY', 'Publishing requires at least one question and one eligible student.', 409,
        'Complete the questions and roster, then publish again.'
      );
    end if;

    use_anonymous_grading := coalesce(exam_payload ->> 'identityMode', 'real_names') = 'anonymous_grading';
    controls_payload := jsonb_build_object(
      'subject', coalesce(exam_payload ->> 'subject', ''),
      'yearLevel', coalesce(exam_payload ->> 'yearLevel', ''),
      'jurisdiction', coalesce(exam_payload ->> 'jurisdiction', 'Philippines'),
      'startsAt', exam_payload -> 'startsAt',
      'lateSubmissions', coalesce(exam_payload ->> 'lateSubmissions', 'not_allowed'),
      'navigation', coalesce(exam_payload ->> 'navigation', 'free'),
      'identityMode', coalesce(exam_payload ->> 'identityMode', 'real_names'),
      'integrityTier', coalesce(exam_payload ->> 'integrityTier', 'standard'),
      'cameraRequired', coalesce((exam_payload ->> 'cameraRequired')::boolean, false),
      'microphoneRequired', coalesce((exam_payload ->> 'microphoneRequired')::boolean, false),
      'privacyNoticeVersion', lower(exam_payload ->> 'privacyNoticeVersion'),
      'privacyController', coalesce(exam_payload ->> 'privacyController', ''),
      'retentionSummary', coalesce(exam_payload ->> 'retentionSummary', ''),
      'sourceFileName', exam_payload -> 'sourceFileName',
      'sourceFileSize', exam_payload -> 'sourceFileSize'
    );

    if exam_owner_id is null then
      insert into examination_room_v1.exams (
        id, institution_id, owner_user_id, title, description, status, anonymous_grading
      ) values (
        exam_id,
        p_institution_id,
        p_actor_user_id,
        exam_payload ->> 'title',
        nullif(exam_payload ->> 'instructions', ''),
        'draft',
        use_anonymous_grading
      );
    else
      update examination_room_v1.exams e
      set title = exam_payload ->> 'title',
          description = nullif(exam_payload ->> 'instructions', '')
      where e.id = exam_id;
    end if;

    select v.id, v.version_number
    into version_id, version_number
    from examination_room_v1.exam_versions v
    where v.exam_id = exam_id
      and v.publication_status = 'building'
    order by v.version_number desc
    limit 1
    for update;

    if version_id is null then
      select coalesce(max(v.version_number), 0) + 1
      into version_number
      from examination_room_v1.exam_versions v
      where v.exam_id = exam_id;
      version_id := gen_random_uuid();
      insert into examination_room_v1.exam_versions (
        id, exam_id, institution_id, version_number, title_snapshot, instructions,
        duration_seconds, anonymous_grading_snapshot, privacy_notice_version_id,
        controls, content_sha256
      ) values (
        version_id,
        exam_id,
        p_institution_id,
        version_number,
        exam_payload ->> 'title',
        coalesce(exam_payload ->> 'instructions', ''),
        greatest(60, least(86400, coalesce((exam_payload ->> 'durationMinutes')::integer, 120) * 60)),
        use_anonymous_grading,
        notice_id,
        controls_payload,
        examination_room_v1.jsonb_sha256(draft_payload)
      );
    else
      update examination_room_v1.exam_versions v
      set title_snapshot = exam_payload ->> 'title',
          instructions = coalesce(exam_payload ->> 'instructions', ''),
          duration_seconds = greatest(60, least(86400, coalesce((exam_payload ->> 'durationMinutes')::integer, 120) * 60)),
          anonymous_grading_snapshot = use_anonymous_grading,
          privacy_notice_version_id = notice_id,
          controls = controls_payload,
          content_sha256 = examination_room_v1.jsonb_sha256(draft_payload)
      where v.id = version_id;
      delete from examination_room_v1.questions q where q.exam_version_id = version_id;
    end if;

    insert into examination_room_v1.questions (
      exam_version_id, position, question_key, question_kind, prompt, points, configuration, content_sha256
    )
    select
      version_id,
      coalesce((item.value ->> 'questionNumber')::integer, item.ordinality::integer),
      item.value ->> 'questionKey',
      item.value ->> 'questionKind',
      item.value ->> 'prompt',
      coalesce((item.value ->> 'points')::numeric, 0),
      jsonb_build_object(
        'type', coalesce(item.value ->> 'type', replace(item.value ->> 'questionKind', '_', '-')),
        'gradingGuidance', coalesce(item.value ->> 'gradingGuidance', ''),
        'wordLimit', item.value -> 'wordLimit',
        'choices', coalesce(item.value -> 'choices', '[]'::jsonb),
        'correctOptionIndex', item.value -> 'correctOptionIndex',
        'acceptedAnswers', coalesce(item.value -> 'acceptedAnswers', '[]'::jsonb)
      ),
      examination_room_v1.jsonb_sha256(item.value)
    from jsonb_array_elements(coalesce(exam_payload -> 'questions', '[]'::jsonb)) with ordinality item(value, ordinality);

    update examination_room_v1.exam_roster er
    set roster_status = 'withdrawn'
    from examination_room_v1.student_identities si
    where er.exam_id = exam_id
      and er.student_identity_id = si.id
      and er.roster_status in ('invited', 'eligible')
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(exam_payload -> 'roster', '[]'::jsonb)) incoming(value)
        where upper(incoming.value ->> 'studentNumber') = si.external_student_id
      );

    for roster_item in
      select value from jsonb_array_elements(coalesce(exam_payload -> 'roster', '[]'::jsonb))
    loop
      insert into examination_room_v1.student_identities (
        institution_id, external_student_id, full_name, email_normalized,
        identity_status, verified_at, verification_method
      ) values (
        p_institution_id,
        upper(roster_item ->> 'studentNumber'),
        roster_item ->> 'fullName',
        lower(roster_item ->> 'email'),
        'active',
        requested_at,
        'registrar_import'
      )
      on conflict (institution_id, external_student_id) do update
      set full_name = excluded.full_name,
          email_normalized = excluded.email_normalized,
          identity_status = 'active',
          verified_at = excluded.verified_at,
          verification_method = excluded.verification_method
      returning id into student_identity_id;

      roster_row_id := gen_random_uuid();
      insert into examination_room_v1.exam_roster (
        id, exam_id, institution_id, student_identity_id, grading_alias,
        roster_status, accommodations, added_by_user_id
      ) values (
        roster_row_id,
        exam_id,
        p_institution_id,
        student_identity_id,
        case when use_anonymous_grading then 'CAND-' || upper(substr(replace(roster_row_id::text, '-', ''), 1, 8)) else null end,
        'eligible',
        jsonb_build_object(
          'clientId', roster_item -> 'clientId',
          'subject', roster_item ->> 'subject',
          'yearLevel', roster_item ->> 'yearLevel',
          'extraMinutes', coalesce((roster_item ->> 'extraMinutes')::integer, 0)
        ),
        p_actor_user_id
      )
      on conflict on constraint exam_roster_exam_student_key do update
      set roster_status = 'eligible',
          grading_alias = coalesce(examination_room_v1.exam_roster.grading_alias, excluded.grading_alias),
          accommodations = excluded.accommodations;
    end loop;

    select count(*) into question_count
    from examination_room_v1.questions q where q.exam_version_id = version_id;
    select count(*) into roster_count
    from examination_room_v1.exam_roster er
    where er.exam_id = exam_id and er.roster_status in ('invited', 'eligible');

    if p_operation = 'publish' then
      if question_count = 0 or roster_count = 0 then
        return examination_room_v1.api_error(
          'PUBLICATION_NOT_READY', 'Publishing requires at least one question and one eligible student.', 409,
          'Complete the questions and roster, then publish again.'
        );
      end if;

      publication_bundle := examination_room_v1.build_publication_manifest(version_id, requested_at);
      publication_hash := examination_room_v1.jsonb_sha256(publication_bundle);
      update examination_room_v1.exam_versions v
      set publication_manifest = publication_bundle,
          content_sha256 = publication_hash,
          publication_status = 'published',
          published_by_user_id = p_actor_user_id,
          published_at = requested_at
      where v.id = version_id;

      update examination_room_v1.exams e
      set status = 'published',
          anonymous_grading = use_anonymous_grading,
          current_published_version_id = version_id,
          closed_at = null
      where e.id = exam_id;

      insert into examination_room_v1.recovery_snapshots (
        exam_id, exam_version_id, snapshot_sequence, snapshot_scope, request_hash,
        record_count, snapshot_status, created_by_user_id, retention_until
      ) values (
        exam_id,
        version_id,
        examination_room_v1.next_snapshot_sequence(exam_id),
        'exam_definition',
        request_hash,
        question_count + roster_count,
        'pending',
        p_actor_user_id,
        requested_at + interval '365 days'
      );

      response := jsonb_build_object(
        'ok', true,
        'examId', exam_id,
        'versionId', version_id,
        'version', version_number,
        'status', 'published',
        'publicationHash', publication_hash,
        'publicationManifest', publication_bundle
      );
    else
      response := jsonb_build_object(
        'ok', true,
        'examId', exam_id,
        'versionId', version_id,
        'version', version_number,
        'status', 'draft',
        'questionCount', question_count,
        'rosterCount', roster_count
      );
    end if;

    perform examination_room_v1.api_record_audit(
      p_institution_id, exam_id, null, p_actor_user_id, 'professor',
      'professor.' || p_operation, 'exam', exam_id, request_hash,
      requested_at, response, null
    );
    return response;
  end if;

  if p_operation in ('open_room', 'close_room') then
    request_hash := p_payload ->> 'requestHash';
    event_time := coalesce(
      (p_payload ->> case when p_operation = 'open_room' then 'openedAt' else 'closedAt' end)::timestamptz,
      clock_timestamp()
    );
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(p_institution_id, request_hash, 'professor.' || p_operation);
    if replay is not null then return replay; end if;

    if p_operation = 'open_room' then
      update examination_room_v1.room_activations a
      set activation_status = 'open',
          opens_at = least(a.opens_at, event_time, clock_timestamp()),
          deactivated_at = null,
          deactivated_by_user_id = null,
          deactivation_reason = null
      where a.exam_id = exam_id
        and a.institution_id = p_institution_id
        and a.key_hash = p_payload ->> 'roomKeyHash'
        and a.activation_status = 'scheduled'
        and a.closes_at > event_time
      returning a.id into version_id;

      if version_id is null then
        select a.id into version_id
        from examination_room_v1.room_activations a
        where a.exam_id = exam_id
          and a.institution_id = p_institution_id
          and a.key_hash = p_payload ->> 'roomKeyHash'
          and a.activation_status = 'open';
      end if;

      if version_id is null then
        return examination_room_v1.api_error(
          'ROOM_ACTIVATION_NOT_FOUND', 'No current room activation matches that key.', 409,
          'Ask the administrator to issue the current key, then open the room again.'
        );
      end if;
      response := jsonb_build_object('ok', true, 'examId', exam_id, 'activationId', version_id, 'status', 'open');
    else
      update examination_room_v1.room_activations a
      set activation_status = 'closed',
          deactivated_at = event_time,
          deactivated_by_user_id = p_actor_user_id,
          deactivation_reason = 'Professor closed the examination room.'
      where a.exam_id = exam_id
        and a.institution_id = p_institution_id
        and a.activation_status in ('scheduled', 'open');

      update examination_room_v1.student_sessions s
      set session_status = 'expired', ended_at = coalesce(s.ended_at, event_time)
      where s.exam_id = exam_id
        and s.institution_id = p_institution_id
        and s.session_status in ('created', 'active');

      update examination_room_v1.exams e
      set status = 'closed', closed_at = event_time
      where e.id = exam_id and e.status in ('published', 'closed');
      response := jsonb_build_object('ok', true, 'examId', exam_id, 'status', 'closed');
    end if;

    perform examination_room_v1.api_record_audit(
      p_institution_id, exam_id, null, p_actor_user_id, 'professor',
      'professor.' || p_operation, 'exam', exam_id, request_hash, event_time, response, null
    );
    return response;
  end if;

  if p_operation = 'save_grade' then
    request_hash := p_payload ->> 'requestHash';
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(p_institution_id, request_hash, 'professor.save_grade');
    if replay is not null then return replay; end if;
    grading_manifest := p_payload -> 'gradingManifest';

    select sub.id, sub.exam_version_id, sub.submission_manifest ->> 'publicationHash', ss.id
    into submission_id, exam_version_id, publication_hash, student_session_id
    from examination_room_v1.student_sessions ss
    join examination_room_v1.submissions sub on sub.session_id = ss.id
    join examination_room_v1.exams e on e.id = ss.exam_id
    where (
        (not e.anonymous_grading and ss.id = (p_payload ->> 'sessionId')::uuid)
        or (
          e.anonymous_grading
          and examination_room_v1.uuid_from_hash(sub.idempotency_key_hash) = (p_payload ->> 'sessionId')::uuid
        )
      )
      and ss.exam_id = exam_id
      and ss.institution_id = p_institution_id
      and sub.submission_status = 'accepted'
    for update of sub;

    if submission_id is null then
      return examination_room_v1.api_error(
        'SUBMISSION_NOT_FOUND', 'The student has no accepted submission to grade.', 409,
        'Refresh grading after the student submits.'
      );
    end if;

    if jsonb_typeof(grading_manifest) is distinct from 'object'
       or coalesce(grading_manifest ->> 'schemaVersion', '') <> 'examination-room/grading/v1'
       or grading_manifest ->> 'submissionId' is null
       or (grading_manifest ->> 'submissionId')::uuid <> submission_id
       or grading_manifest ->> 'publicationHash' <> publication_hash
       or grading_manifest ->> 'graderId' is null
       or (grading_manifest ->> 'graderId')::uuid <> p_actor_user_id
       or coalesce(grading_manifest ->> 'status', '') <> 'draft' then
      return examination_room_v1.api_error(
        'GRADING_MANIFEST_INVALID', 'The grading evidence is not bound to this submission and signed-in professor.', 409,
        'Refresh grading, review the scores, then save again.'
      );
    end if;

    grade_revision_number := (grading_manifest ->> 'revision')::integer;
    if grade_revision_number <> coalesce((select max(g.revision_number) from examination_room_v1.grade_revisions g where g.submission_id = submission_id), 0) + 1 then
      return examination_room_v1.api_error(
        'GRADE_REVISION_CONFLICT', 'A newer grading revision already exists.', 409,
        'Refresh the grading view, review the latest scores, then save again.'
      );
    end if;

    score_count := jsonb_array_length(coalesce(grading_manifest -> 'scores', '[]'::jsonb));
    total_score := coalesce((grading_manifest ->> 'totalPointsAwarded')::numeric, 0);
    maximum_score := coalesce((grading_manifest ->> 'maxPoints')::numeric, 0);
    select
      count(*)::integer,
      count(distinct q.id)::integer,
      coalesce(sum((score.value ->> 'pointsAwarded')::numeric), 0),
      coalesce(sum(q.points), 0)
    into question_count, distinct_score_count, total_score, maximum_score
    from jsonb_array_elements(coalesce(grading_manifest -> 'scores', '[]'::jsonb)) score(value)
    join examination_room_v1.questions q
      on q.exam_version_id = exam_version_id
     and q.position = (score.value ->> 'questionNumber')::integer
     and q.question_key = score.value ->> 'questionKey'
     and q.points = (score.value ->> 'maxPoints')::numeric
    where (score.value ->> 'pointsAwarded')::numeric between 0 and q.points;

    if question_count <> score_count
       or distinct_score_count <> score_count
       or coalesce((grading_manifest ->> 'scoreCount')::integer, -1) <> score_count
       or total_score <> coalesce((grading_manifest ->> 'totalPointsAwarded')::numeric, 0)
       or maximum_score <> coalesce((grading_manifest ->> 'maxPoints')::numeric, 0) then
      return examination_room_v1.api_error(
        'GRADING_MANIFEST_INVALID', 'The grading manifest does not match this examination version.', 409,
        'Refresh grading, review the scores, then save again.'
      );
    end if;
    grade_revision_id := (grading_manifest ->> 'revisionId')::uuid;
    insert into examination_room_v1.grade_revisions (
      id, submission_id, exam_version_id, revision_number, client_revision_id,
      manifest_sha256, grading_manifest, grader_user_id, source, grade_status,
      item_count, total_score, maximum_score, general_feedback
    ) values (
      grade_revision_id,
      submission_id,
      exam_version_id,
      grade_revision_number,
      (p_payload ->> 'clientRevisionId')::uuid,
      p_payload ->> 'gradingHash',
      grading_manifest,
      p_actor_user_id,
      'online',
      grading_manifest ->> 'status',
      score_count,
      total_score,
      maximum_score,
      grading_manifest ->> 'overallFeedback'
    );

    for score_item in select value from jsonb_array_elements(coalesce(grading_manifest -> 'scores', '[]'::jsonb))
    loop
      select q.id into question_id
      from examination_room_v1.questions q
      where q.exam_version_id = exam_version_id
        and q.position = (score_item ->> 'questionNumber')::integer
        and q.question_key = score_item ->> 'questionKey';
      insert into examination_room_v1.grade_revision_items (
        grade_revision_id, exam_version_id, question_id, score, maximum_score, feedback
      ) values (
        grade_revision_id,
        exam_version_id,
        question_id,
        (score_item ->> 'pointsAwarded')::numeric,
        (score_item ->> 'maxPoints')::numeric,
        score_item ->> 'feedback'
      );
    end loop;

    response := jsonb_build_object(
      'ok', true,
      'revision', jsonb_build_object(
        'id', grade_revision_id,
        'revision', grade_revision_number,
        'status', grading_manifest ->> 'status',
        'totalPointsAwarded', total_score,
        'maxPoints', maximum_score
      )
    );
    perform examination_room_v1.api_record_audit(
      p_institution_id, exam_id, student_session_id, p_actor_user_id, 'professor',
      'professor.save_grade', 'grade_revision', grade_revision_id, request_hash,
      clock_timestamp(), response, (p_payload ->> 'clientRevisionId')::uuid
    );
    return response;
  end if;

  if p_operation = 'release_results' then
    request_hash := p_payload ->> 'requestHash';
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(p_institution_id, request_hash, 'professor.release_results');
    if replay is not null then return replay; end if;

    if jsonb_typeof(p_payload -> 'releases') <> 'array'
       or jsonb_typeof(p_payload -> 'sessionIds') <> 'array'
       or jsonb_array_length(p_payload -> 'releases') = 0
       or jsonb_array_length(p_payload -> 'releases') <> jsonb_array_length(p_payload -> 'sessionIds')
       or (
         select count(distinct item.value ->> 'sessionId')
         from jsonb_array_elements(p_payload -> 'releases') item(value)
       ) <> jsonb_array_length(p_payload -> 'releases')
       or exists (
         select 1
         from jsonb_array_elements(p_payload -> 'releases') item(value)
         where not exists (
           select 1
           from jsonb_array_elements_text(p_payload -> 'sessionIds') selected(value)
           where selected.value = item.value ->> 'sessionId'
         )
       ) then
      return examination_room_v1.api_error(
        'GRADING_CONTEXT_INVALID', 'The release set does not match the selected students.', 409,
        'Refresh grading, review the recipient list, then release again.'
      );
    end if;

    -- Validate and lock the complete batch before the first append-only write.
    for release_item in select value from jsonb_array_elements(p_payload -> 'releases')
    loop
      grading_manifest := release_item -> 'gradingManifest';
      release_manifest := release_item -> 'releaseManifest';
      select sub.id, sub.exam_version_id, sub.submission_manifest ->> 'publicationHash'
      into submission_id, exam_version_id, publication_hash
      from examination_room_v1.student_sessions ss
      join examination_room_v1.submissions sub on sub.session_id = ss.id
      join examination_room_v1.exams e on e.id = ss.exam_id
      where (
          (not e.anonymous_grading and ss.id = (release_item ->> 'sessionId')::uuid)
          or (
            e.anonymous_grading
            and examination_room_v1.uuid_from_hash(sub.idempotency_key_hash) = (release_item ->> 'sessionId')::uuid
          )
        )
        and ss.exam_id = exam_id
        and ss.institution_id = p_institution_id
        and sub.submission_status = 'accepted'
      for update of sub;

      if submission_id is null
         or coalesce(grading_manifest ->> 'schemaVersion', '') <> 'examination-room/grading/v1'
         or coalesce(grading_manifest ->> 'status', '') <> 'final'
         or grading_manifest ->> 'submissionId' is null
         or (grading_manifest ->> 'submissionId')::uuid <> submission_id
         or grading_manifest ->> 'graderId' is null
         or (grading_manifest ->> 'graderId')::uuid <> p_actor_user_id
         or grading_manifest ->> 'publicationHash' <> publication_hash
         or coalesce(release_manifest ->> 'schemaVersion', '') <> 'examination-room/result-release/v1'
         or release_manifest ->> 'submissionId' is null
         or (release_manifest ->> 'submissionId')::uuid <> submission_id
         or release_manifest ->> 'publicationHash' <> publication_hash
         or release_manifest ->> 'selectedRevisionId' is null
         or (release_manifest ->> 'selectedRevisionId')::uuid <> (grading_manifest ->> 'revisionId')::uuid
         or coalesce((release_manifest ->> 'selectedRevision')::integer, -1) <> (grading_manifest ->> 'revision')::integer
         or release_manifest ->> 'releasedBy' is null
         or (release_manifest ->> 'releasedBy')::uuid <> p_actor_user_id
         or (release_manifest ->> 'releasedAt')::timestamptz < (grading_manifest ->> 'gradedAt')::timestamptz then
        return examination_room_v1.api_error(
          'GRADING_CONTEXT_INVALID', 'A selected student has invalid release or grading evidence.', 409,
          'Refresh grading and review the recipient list.'
        );
      end if;

      grade_revision_number := (grading_manifest ->> 'revision')::integer;
      if grade_revision_number <> coalesce((select max(g.revision_number) from examination_room_v1.grade_revisions g where g.submission_id = submission_id), 0) + 1 then
        return examination_room_v1.api_error(
          'GRADE_REVISION_CONFLICT', 'A selected submission changed after release preparation.', 409,
          'Refresh grading, review the latest scores, then release again.'
        );
      end if;

      score_count := jsonb_array_length(coalesce(grading_manifest -> 'scores', '[]'::jsonb));
      select
        count(*)::integer,
        count(distinct q.id)::integer,
        coalesce(sum((score.value ->> 'pointsAwarded')::numeric), 0),
        coalesce(sum(q.points), 0)
      into question_count, distinct_score_count, total_score, maximum_score
      from jsonb_array_elements(coalesce(grading_manifest -> 'scores', '[]'::jsonb)) score(value)
      join examination_room_v1.questions q
        on q.exam_version_id = exam_version_id
       and q.position = (score.value ->> 'questionNumber')::integer
       and q.question_key = score.value ->> 'questionKey'
       and q.points = (score.value ->> 'maxPoints')::numeric
      where (score.value ->> 'pointsAwarded')::numeric between 0 and q.points;

      if question_count <> score_count
         or distinct_score_count <> score_count
         or question_count <> (select count(*) from examination_room_v1.questions q where q.exam_version_id = exam_version_id)
         or coalesce((grading_manifest ->> 'scoreCount')::integer, -1) <> score_count
         or total_score <> (grading_manifest ->> 'totalPointsAwarded')::numeric
         or maximum_score <> (grading_manifest ->> 'maxPoints')::numeric then
        return examination_room_v1.api_error(
          'GRADING_INCOMPLETE', 'Every question must have a valid final score before release.', 409,
          'Score every question, review the totals, then release again.'
        );
      end if;

      expected_result := jsonb_build_object(
        'gradedAt', grading_manifest -> 'gradedAt',
        'scores', grading_manifest -> 'scores',
        'totalPointsAwarded', grading_manifest -> 'totalPointsAwarded',
        'maxPoints', grading_manifest -> 'maxPoints',
        'overallFeedback', grading_manifest -> 'overallFeedback'
      );
      if release_manifest -> 'result' is distinct from expected_result then
        return examination_room_v1.api_error(
          'RESULT_RELEASE_MISMATCH', 'The student-facing result does not exactly match the final grade revision.', 409,
          'Refresh grading, review the final scores, then release again.'
        );
      end if;
    end loop;

    score_count := 0;

    for release_item in select value from jsonb_array_elements(coalesce(p_payload -> 'releases', '[]'::jsonb))
    loop
      grading_manifest := release_item -> 'gradingManifest';
      select sub.id, sub.exam_version_id, sub.submission_manifest ->> 'publicationHash'
      into submission_id, exam_version_id, publication_hash
      from examination_room_v1.student_sessions ss
      join examination_room_v1.submissions sub on sub.session_id = ss.id
      join examination_room_v1.exams e on e.id = ss.exam_id
      where (
          (not e.anonymous_grading and ss.id = (release_item ->> 'sessionId')::uuid)
          or (
            e.anonymous_grading
            and examination_room_v1.uuid_from_hash(sub.idempotency_key_hash) = (release_item ->> 'sessionId')::uuid
          )
        )
        and ss.exam_id = exam_id
        and ss.institution_id = p_institution_id
        and sub.submission_status = 'accepted'
      for update of sub;

      if submission_id is null then
        return examination_room_v1.api_error(
          'GRADING_CONTEXT_INVALID', 'A selected student has no accepted submission.', 409,
          'Refresh grading and review the recipient list.'
        );
      end if;

      grade_revision_number := (grading_manifest ->> 'revision')::integer;
      if grade_revision_number <> coalesce((select max(g.revision_number) from examination_room_v1.grade_revisions g where g.submission_id = submission_id), 0) + 1 then
        return examination_room_v1.api_error(
          'GRADE_REVISION_CONFLICT', 'A selected submission changed after release preparation.', 409,
          'Refresh grading, review the latest scores, then release again.'
        );
      end if;

      grade_revision_id := (grading_manifest ->> 'revisionId')::uuid;
      insert into examination_room_v1.grade_revisions (
        id, submission_id, exam_version_id, revision_number, client_revision_id,
        manifest_sha256, grading_manifest, grader_user_id, source, grade_status,
        item_count, total_score, maximum_score, general_feedback
      ) values (
        grade_revision_id,
        submission_id,
        exam_version_id,
        grade_revision_number,
        examination_room_v1.uuid_from_hash(release_item ->> 'releaseRequestHash'),
        release_item ->> 'gradingHash',
        grading_manifest,
        p_actor_user_id,
        'online',
        'final',
        jsonb_array_length(coalesce(grading_manifest -> 'scores', '[]'::jsonb)),
        (grading_manifest ->> 'totalPointsAwarded')::numeric,
        (grading_manifest ->> 'maxPoints')::numeric,
        grading_manifest ->> 'overallFeedback'
      );

      for score_item in select value from jsonb_array_elements(coalesce(grading_manifest -> 'scores', '[]'::jsonb))
      loop
        select q.id into question_id
        from examination_room_v1.questions q
        where q.exam_version_id = exam_version_id
          and q.position = (score_item ->> 'questionNumber')::integer
          and q.question_key = score_item ->> 'questionKey';
        insert into examination_room_v1.grade_revision_items (
          grade_revision_id, exam_version_id, question_id, score, maximum_score, feedback
        ) values (
          grade_revision_id,
          exam_version_id,
          question_id,
          (score_item ->> 'pointsAwarded')::numeric,
          (score_item ->> 'maxPoints')::numeric,
          score_item ->> 'feedback'
        );
      end loop;

      insert into examination_room_v1.result_releases (
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
      );
      score_count := score_count + 1;
    end loop;

    if score_count <> jsonb_array_length(coalesce(p_payload -> 'sessionIds', '[]'::jsonb)) then
      return examination_room_v1.api_error(
        'GRADING_CONTEXT_INVALID', 'The release set does not match the selected students.', 409,
        'Refresh grading, review the recipient list, then release again.'
      );
    end if;

    response := jsonb_build_object('ok', true, 'released', score_count);
    perform examination_room_v1.api_record_audit(
      p_institution_id, exam_id, null, p_actor_user_id, 'professor',
      'professor.release_results', 'exam', exam_id, request_hash,
      clock_timestamp(), response, null
    );
    return response;
  end if;

  return examination_room_v1.api_error(
    'UNKNOWN_OPERATION', 'The professor operation is not implemented.', 400,
    'Refresh Examination Room and try a listed action.'
  );
end;
$$;

revoke all on function examination_room_v1.api_professor(text, uuid, uuid, jsonb) from public, anon, authenticated, service_role;

create function examination_room_v1.api_admin(
  p_operation text,
  p_actor_user_id uuid,
  p_institution_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  exam_id uuid;
  exam_version_id uuid;
  exam_owner_id uuid;
  exam_title text;
  professor_name text;
  professor_email text;
  request_hash text;
  event_time timestamptz;
  activation_id uuid;
  activation_status text;
  stored_key_hash text;
  snapshot_id uuid;
  affected_count integer;
  record_count bigint;
  replay jsonb;
  response jsonb;
begin
  if p_operation = 'overview' then
    select jsonb_build_object(
      'ok', true,
      'institutionId', p_institution_id,
      'exams', coalesce(jsonb_agg(jsonb_build_object(
        'examId', e.id,
        'title', e.title,
        'status', e.status,
        'ownerUserId', e.owner_user_id,
        'anonymousGrading', e.anonymous_grading,
        'activation', a.item,
        'sessionCount', (select count(*) from examination_room_v1.student_sessions ss where ss.exam_id = e.id),
        'submissionCount', (
          select count(*)
          from examination_room_v1.submissions sub
          join examination_room_v1.student_sessions ss on ss.id = sub.session_id
          where ss.exam_id = e.id
        ),
        'pendingSnapshotCount', (
          select count(*) from examination_room_v1.recovery_snapshots rs
          where rs.exam_id = e.id and rs.snapshot_status = 'pending'
        )
      ) order by e.updated_at desc), '[]'::jsonb)
    )
    into response
    from examination_room_v1.exams e
    left join lateral (
      select jsonb_build_object(
        'id', ra.id,
        'status', ra.activation_status,
        'opensAt', ra.opens_at,
        'closesAt', ra.closes_at,
        'maxSessions', ra.max_sessions
      ) as item
      from examination_room_v1.room_activations ra
      where ra.exam_id = e.id
      order by ra.created_at desc
      limit 1
    ) a on true
    where e.institution_id = p_institution_id;
    return response;
  end if;

  exam_id := nullif(p_payload ->> 'examId', '')::uuid;
  request_hash := p_payload ->> 'requestHash';
  if exam_id is null then
    return examination_room_v1.api_error(
      'EXAM_NOT_FOUND', 'Choose a valid examination.', 404,
      'Return to Admin and choose an available examination.'
    );
  end if;

  select e.current_published_version_id, e.owner_user_id, e.title
  into exam_version_id, exam_owner_id, exam_title
  from examination_room_v1.exams e
  where e.id = exam_id
    and e.institution_id = p_institution_id
  for update;

  if exam_owner_id is null then
    return examination_room_v1.api_error(
      'EXAM_NOT_FOUND', 'The examination does not exist in this institution.', 404,
      'Return to Admin and choose an available examination.'
    );
  end if;

  if p_operation in ('activate_exam', 'email_key') then
    if exam_version_id is null then
      return examination_room_v1.api_error(
        'PUBLICATION_REQUIRED', 'Publish the examination before issuing a room key.', 409,
        'Ask the professor to publish the completed examination, then issue the key.'
      );
    end if;

    select m.display_name, m.email_normalized
    into professor_name, professor_email
    from examination_room_v1.staff_memberships m
    where m.institution_id = p_institution_id
      and m.user_id = exam_owner_id
      and m.membership_status = 'active'
    order by (m.staff_role = 'professor') desc, m.granted_at desc
    limit 1;

    if p_operation = 'email_key' and professor_email is null then
      return examination_room_v1.api_error(
        'PROFESSOR_CONTACT_REQUIRED', 'The professor account has no verified delivery email.', 409,
        'Add the professor contact through institution onboarding, then issue and email the key again.'
      );
    end if;

    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(p_institution_id, request_hash, 'admin.' || p_operation);
    if replay is not null then
      if replay ->> 'ok' = 'false' then return replay; end if;
      select a.id, a.activation_status, a.key_hash
      into activation_id, activation_status, stored_key_hash
      from examination_room_v1.room_activations a
      where a.request_hash = request_hash
        and a.institution_id = p_institution_id
        and a.exam_id = exam_id
      for update;

      if activation_id is null then
        return examination_room_v1.api_error(
          'ACTIVATION_REPLAY_INVALID', 'The prior activation receipt cannot be recovered.', 409,
          'Create a new request before issuing another room key.'
        );
      end if;

      if stored_key_hash <> p_payload ->> 'roomKeyHash' then
        if activation_status = 'scheduled'
           and not exists (select 1 from examination_room_v1.student_sessions s where s.activation_id = activation_id) then
          update examination_room_v1.room_activations a
          set key_hash = p_payload ->> 'roomKeyHash'
          where a.id = activation_id;
        else
          return examination_room_v1.api_error(
            'ACTIVATION_REPLAY_REQUIRES_NEW_REQUEST',
            'The prior room-key request is already open or in use and cannot be reissued with a different key.',
            409,
            'Create a new administrator request and revoke the old key if replacement is required.'
          );
        end if;
      end if;
      return replay;
    end if;

    event_time := clock_timestamp();
    if coalesce((p_payload ->> 'replaceCurrent')::boolean, false) then
      update examination_room_v1.room_activations a
      set activation_status = 'revoked',
          deactivated_at = event_time,
          deactivated_by_user_id = p_actor_user_id,
          deactivation_reason = 'Administrator issued a replacement room key.'
      where a.exam_id = exam_id
        and a.institution_id = p_institution_id
        and a.activation_status in ('scheduled', 'open');
    elsif exists (
      select 1
      from examination_room_v1.room_activations a
      where a.exam_id = exam_id
        and a.institution_id = p_institution_id
        and a.activation_status in ('scheduled', 'open')
    ) then
      return examination_room_v1.api_error(
        'ACTIVE_KEY_EXISTS', 'This examination already has a current room key.', 409,
        'Use Email key to replace it deliberately, or revoke the current key first.'
      );
    end if;

    activation_id := gen_random_uuid();
    insert into examination_room_v1.room_activations (
      id, exam_id, institution_id, exam_version_id, key_hash, key_hash_algorithm,
      request_hash, activation_status, opens_at, closes_at, max_sessions, activated_by_user_id
    ) values (
      activation_id,
      exam_id,
      p_institution_id,
      exam_version_id,
      p_payload ->> 'roomKeyHash',
      coalesce(p_payload ->> 'keyHashAlgorithm', 'hmac-sha256-v1'),
      request_hash,
      'scheduled',
      (p_payload ->> 'opensAt')::timestamptz,
      (p_payload ->> 'closesAt')::timestamptz,
      nullif(p_payload ->> 'maxSessions', '')::integer,
      p_actor_user_id
    );

    response := jsonb_build_object(
      'ok', true,
      'activation', jsonb_build_object(
        'id', activation_id,
        'status', 'scheduled',
        'opensAt', (p_payload ->> 'opensAt')::timestamptz,
        'expiresAt', (p_payload ->> 'closesAt')::timestamptz,
        'maxSessions', p_payload -> 'maxSessions'
      ),
      'professorEmail', professor_email,
      'professorName', coalesce(professor_name, 'Professor'),
      'examTitle', exam_title
    );
    perform examination_room_v1.api_record_audit(
      p_institution_id, exam_id, null, p_actor_user_id, 'admin',
      'admin.' || p_operation, 'room_activation', activation_id, request_hash,
      event_time, response, null
    );
    return response;
  end if;

  if p_operation = 'revoke_key' then
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(p_institution_id, request_hash, 'admin.revoke_key');
    if replay is not null then return replay; end if;
    event_time := coalesce((p_payload ->> 'revokedAt')::timestamptz, clock_timestamp());
    update examination_room_v1.room_activations a
    set activation_status = 'revoked',
        deactivated_at = event_time,
        deactivated_by_user_id = p_actor_user_id,
        deactivation_reason = p_payload ->> 'reason'
    where a.exam_id = exam_id
      and a.institution_id = p_institution_id
      and a.activation_status in ('scheduled', 'open');
    get diagnostics affected_count = row_count;
    response := jsonb_build_object('ok', true, 'examId', exam_id, 'revoked', affected_count);
    perform examination_room_v1.api_record_audit(
      p_institution_id, exam_id, null, p_actor_user_id, 'admin',
      'admin.revoke_key', 'exam', exam_id, request_hash, event_time, response, null
    );
    return response;
  end if;

  if p_operation = 'create_snapshot' then
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(p_institution_id, request_hash, 'admin.create_snapshot');
    if replay is not null then return replay; end if;
    if exam_version_id is null then
      return examination_room_v1.api_error(
        'PUBLICATION_REQUIRED', 'A recovery snapshot requires a published examination version.', 409,
        'Publish the examination before requesting a recovery snapshot.'
      );
    end if;
    event_time := coalesce((p_payload ->> 'requestedAt')::timestamptz, clock_timestamp());
    select
      (select count(*) from examination_room_v1.questions q where q.exam_version_id = exam_version_id)
      + (select count(*) from examination_room_v1.answer_revisions ar join examination_room_v1.student_sessions ss on ss.id = ar.session_id where ss.exam_id = exam_id)
      + (select count(*) from examination_room_v1.grade_revisions gr join examination_room_v1.submissions sub on sub.id = gr.submission_id join examination_room_v1.student_sessions ss on ss.id = sub.session_id where ss.exam_id = exam_id)
    into record_count;

    snapshot_id := gen_random_uuid();
    insert into examination_room_v1.recovery_snapshots (
      id, exam_id, exam_version_id, snapshot_sequence, snapshot_scope, request_hash,
      record_count, snapshot_status, created_by_user_id, retention_until
    ) values (
      snapshot_id,
      exam_id,
      exam_version_id,
      examination_room_v1.next_snapshot_sequence(exam_id),
      coalesce(p_payload ->> 'scope', 'full_recovery'),
      request_hash,
      record_count,
      'pending',
      p_actor_user_id,
      event_time + interval '365 days'
    );
    response := jsonb_build_object(
      'ok', true,
      'snapshot', jsonb_build_object(
        'id', snapshot_id,
        'status', 'pending',
        'scope', coalesce(p_payload ->> 'scope', 'full_recovery'),
        'recordCount', record_count,
        'requestedAt', event_time
      )
    );
    perform examination_room_v1.api_record_audit(
      p_institution_id, exam_id, null, p_actor_user_id, 'admin',
      'admin.create_snapshot', 'recovery_snapshot', snapshot_id, request_hash,
      event_time, response, null
    );
    return response;
  end if;

  return examination_room_v1.api_error(
    'UNKNOWN_OPERATION', 'The administrator operation is not implemented.', 400,
    'Refresh Admin and try a listed action.'
  );
end;
$$;

revoke all on function examination_room_v1.api_admin(text, uuid, uuid, jsonb) from public, anon, authenticated, service_role;

create function examination_room_v1.api_student(
  p_operation text,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  institution_id uuid;
  exam_id uuid;
  exam_version_id uuid;
  activation_id uuid;
  roster_id uuid;
  student_identity_id uuid;
  session_id uuid;
  submission_id uuid;
  question_id uuid;
  answer_revision_id uuid;
  notice_version_id uuid;
  activation_status text;
  session_status text;
  notice_code text;
  full_name text;
  student_number text;
  grading_alias text;
  subject_name text;
  year_level text;
  professor_name text;
  request_hash text;
  session_token_hash text;
  stored_token_hash text;
  publication_hash text;
  integrity_tier text;
  controls_payload jsonb;
  publication_manifest jsonb;
  submission_manifest jsonb;
  response jsonb;
  replay jsonb;
  answer_item jsonb;
  answer_selection jsonb;
  result_manifest jsonb;
  activation_opens_at timestamptz;
  activation_closes_at timestamptz;
  lease_expires_at timestamptz;
  occurred_at timestamptz;
  duration_seconds integer;
  extra_minutes integer;
  maximum_sessions integer;
  next_revision integer;
  expected_count integer;
  matched_count integer;
  affected_count integer;
  recording_required boolean;
  recording_accepted boolean;
  accepted_at timestamptz;
  accepted_features jsonb;
  expected_question_type text;
begin
  if p_operation in ('preview', 'consent') then
    select
      a.id,
      a.institution_id,
      a.exam_id,
      a.exam_version_id,
      a.activation_status,
      a.opens_at,
      a.closes_at,
      a.max_sessions,
      v.controls,
      v.publication_manifest,
      v.content_sha256,
      v.duration_seconds,
      v.privacy_notice_version_id,
      n.notice_code,
      er.id,
      er.student_identity_id,
      si.full_name,
      si.external_student_id,
      er.grading_alias,
      er.accommodations ->> 'subject',
      er.accommodations ->> 'yearLevel',
      coalesce((er.accommodations ->> 'extraMinutes')::integer, 0),
      sm.display_name
    into
      activation_id,
      institution_id,
      exam_id,
      exam_version_id,
      activation_status,
      activation_opens_at,
      activation_closes_at,
      maximum_sessions,
      controls_payload,
      publication_manifest,
      publication_hash,
      duration_seconds,
      notice_version_id,
      notice_code,
      roster_id,
      student_identity_id,
      full_name,
      student_number,
      grading_alias,
      subject_name,
      year_level,
      extra_minutes,
      professor_name
    from examination_room_v1.room_activations a
    join examination_room_v1.exam_versions v on v.id = a.exam_version_id
    join examination_room_v1.exams e on e.id = a.exam_id
    join examination_room_v1.privacy_notice_versions n on n.id = v.privacy_notice_version_id
    join examination_room_v1.exam_roster er on er.exam_id = a.exam_id and er.roster_status in ('invited', 'eligible', 'completed')
    join examination_room_v1.student_identities si on si.id = er.student_identity_id and si.identity_status = 'active'
    left join lateral (
      select m.display_name
      from examination_room_v1.staff_memberships m
      where m.institution_id = a.institution_id
        and m.user_id = e.owner_user_id
        and m.membership_status = 'active'
      order by (m.staff_role = 'professor') desc, m.granted_at desc
      limit 1
    ) sm on true
    where a.key_hash = p_payload ->> 'roomKeyHash'
      and a.activation_status in ('scheduled', 'open')
      and a.closes_at > clock_timestamp()
      and upper(si.external_student_id) = upper(p_payload #>> '{identity,studentNumber}')
      and lower(btrim(si.full_name)) = lower(btrim(p_payload #>> '{identity,realName}'))
      and lower(btrim(er.accommodations ->> 'subject')) = lower(btrim(p_payload #>> '{identity,subject}'))
      and lower(btrim(er.accommodations ->> 'yearLevel')) = lower(btrim(p_payload #>> '{identity,yearLevel}'))
    order by a.created_at desc
    limit 1;

    if activation_id is null then
      if exists (
        select 1
        from examination_room_v1.room_activations a
        where a.key_hash = p_payload ->> 'roomKeyHash'
          and a.activation_status in ('scheduled', 'open')
          and a.closes_at > clock_timestamp()
      ) then
        return examination_room_v1.api_error(
          'STUDENT_IDENTITY_INVALID', 'The entered identity does not exactly match the examination roster.', 400,
          'Use the complete registered name, student number, subject, and year level.'
        );
      end if;
      return examination_room_v1.api_error(
        'ROOM_KEY_INVALID', 'The room key is expired, revoked, or not recognized.', 401,
        'Copy the complete current key from the administrator message and try again.'
      );
    end if;

    if p_operation = 'preview' then
      select jsonb_build_object(
        'ok', true,
        'metadata', jsonb_build_object(
          'examId', e.id,
          'title', e.title,
          'subject', subject_name,
          'yearLevel', year_level,
          'durationMinutes', duration_seconds / 60,
          'startsAt', controls_payload -> 'startsAt',
          'professor', coalesce(professor_name, 'Professor'),
          'questionCount', jsonb_array_length(publication_manifest -> 'questions'),
          'integrityTier', coalesce(controls_payload ->> 'integrityTier', 'standard'),
          'cameraRequired', coalesce((controls_payload ->> 'cameraRequired')::boolean, false),
          'microphoneRequired', coalesce((controls_payload ->> 'microphoneRequired')::boolean, false),
          'privacyNoticeVersion', notice_code,
          'privacyController', coalesce(controls_payload ->> 'privacyController', ''),
          'retentionSummary', coalesce(controls_payload ->> 'retentionSummary', ''),
          'activationStatus', activation_status,
          'safeguards', jsonb_build_array(
            'Fullscreen may be requested by the examination settings.',
            'Focus and connection changes are recorded for professor review.',
            'Browser signals are review evidence, not automatic proof of misconduct.'
          )
        ),
        'identity', jsonb_build_object(
          'fullName', full_name,
          'studentNumber', student_number,
          'yearLevel', year_level
        ),
        'notice', jsonb_build_object(
          'version', n.notice_code,
          'title', n.title,
          'body', n.notice_body,
          'purposes', n.processing_purposes
        )
      )
      into response
      from examination_room_v1.exams e
      join examination_room_v1.privacy_notice_versions n on n.id = notice_version_id
      where e.id = exam_id;
      return response;
    end if;

    -- Consent creation and capacity checks serialize on the chosen activation;
    -- read-only previews never take this shared hot-row lock.
    perform 1
    from examination_room_v1.room_activations a
    where a.id = activation_id
    for update;
    perform 1
    from examination_room_v1.exam_roster er
    where er.id = roster_id
    for update;

    request_hash := p_payload ->> 'requestHash';
    session_token_hash := p_payload ->> 'sessionTokenHash';
    recording_required := coalesce(controls_payload ->> 'integrityTier', 'standard') = 'recorded_proctoring'
      or coalesce((controls_payload ->> 'cameraRequired')::boolean, false)
      or coalesce((controls_payload ->> 'microphoneRequired')::boolean, false);
    recording_accepted := coalesce((p_payload #>> '{consent,recordingAccepted}')::boolean, false);

    if activation_status <> 'open' or clock_timestamp() < activation_opens_at then
      return examination_room_v1.api_error(
        'ROOM_NOT_OPEN', 'The professor has not opened this examination room yet.', 409,
        'Wait for the professor to open the room, then choose Agree and begin again.'
      );
    end if;
    if p_payload #>> '{consent,noticeVersion}' <> notice_code
       or not coalesce((p_payload #>> '{consent,accepted}')::boolean, false) then
      return examination_room_v1.api_error(
        'PRIVACY_CONSENT_VERSION_MISMATCH', 'Consent must accept the exact current privacy notice.', 412,
        'Review the current notice shown on screen and agree again.'
      );
    end if;
    if recording_required and not recording_accepted then
      return examination_room_v1.api_error(
        'RECORDING_CONSENT_REQUIRED', 'This examination requires separate recording consent.', 412,
        'Agree to recording or ask the professor for another permitted arrangement.'
      );
    end if;

    replay := examination_room_v1.api_replay(institution_id, request_hash, 'student.consent');
    if replay is not null then
      if replay ->> 'ok' = 'false' then return replay; end if;
      select s.id, s.session_token_hash
      into session_id, stored_token_hash
      from examination_room_v1.student_sessions s
      where s.consent_request_hash = request_hash
        and s.activation_id = activation_id
        and s.roster_id = roster_id
      for update;
      if session_id is null then
        return examination_room_v1.api_error(
          'CONSENT_REPLAY_INVALID', 'The prior consent receipt cannot be recovered.', 409,
          'Return to the join page and create a new consent request.'
        );
      end if;
      if stored_token_hash <> session_token_hash then
        update examination_room_v1.student_sessions s
        set session_token_hash = session_token_hash
        where s.id = session_id;
      end if;
      select v.publication_manifest, v.content_sha256
      into publication_manifest, publication_hash
      from examination_room_v1.student_sessions s
      join examination_room_v1.exam_versions v on v.id = s.exam_version_id
      where s.id = session_id;
      replay := replay || jsonb_build_object(
        'publicationManifest', publication_manifest,
        'publicationHash', publication_hash
      );
      return replay;
    end if;

    if maximum_sessions is not null
       and (select count(*) from examination_room_v1.student_sessions s where s.activation_id = activation_id) >= maximum_sessions then
      return examination_room_v1.api_error(
        'ROOM_SESSION_LIMIT_REACHED', 'This room has reached its configured session limit.', 409,
        'Ask the professor or administrator to review the room capacity.'
      );
    end if;
    if exists (
      select 1 from examination_room_v1.student_sessions s
      where s.activation_id = activation_id and s.roster_id = roster_id
    ) then
      return examination_room_v1.api_error(
        'SESSION_ALREADY_EXISTS', 'A session already exists for this student and room.', 409,
        'Resume the existing session with its issued session token.'
      );
    end if;

    session_id := gen_random_uuid();
    lease_expires_at := least(
      activation_closes_at,
      clock_timestamp() + make_interval(secs => duration_seconds + extra_minutes * 60)
    );
    insert into examination_room_v1.student_sessions (
      id, activation_id, exam_id, institution_id, exam_version_id, roster_id,
      session_token_hash, consent_request_hash, client_instance_id, session_status,
      identity_verified_at, identity_verification_method, started_at,
      last_heartbeat_at, lease_expires_at, session_metadata
    ) values (
      session_id,
      activation_id,
      exam_id,
      institution_id,
      exam_version_id,
      roster_id,
      session_token_hash,
      request_hash,
      (p_payload ->> 'clientInstanceId')::uuid,
      'active',
      clock_timestamp(),
      'room_key_roster_match',
      clock_timestamp(),
      clock_timestamp(),
      lease_expires_at,
      jsonb_build_object('connected', true, 'currentQuestion', 1)
    );

    insert into examination_room_v1.privacy_acceptances (
      notice_version_id, roster_id, session_id, exam_version_id, client_event_id,
      decision, accepted_features, evidence_sha256, capture_method, recorded_at
    ) values (
      notice_version_id,
      roster_id,
      session_id,
      exam_version_id,
      (p_payload ->> 'clientEventId')::uuid,
      'accepted',
      jsonb_build_object(
        'recordingAccepted', recording_accepted,
        'cameraRequired', coalesce((controls_payload ->> 'cameraRequired')::boolean, false),
        'microphoneRequired', coalesce((controls_payload ->> 'microphoneRequired')::boolean, false),
        'integrityTier', coalesce(controls_payload ->> 'integrityTier', 'standard')
      ),
      request_hash,
      'checkbox',
      (p_payload #>> '{consent,acceptedAt}')::timestamptz
    );

    response := jsonb_build_object(
      'ok', true,
      'session', jsonb_build_object(
        'id', session_id,
        'status', 'active',
        'startedAt', clock_timestamp(),
        'leaseExpiresAt', lease_expires_at,
        'anonymousCandidateId', grading_alias
      ),
      'publicationManifest', publication_manifest,
      'publicationHash', publication_hash
    );
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, 'student', 'student.consent',
      'student_session', session_id, request_hash, clock_timestamp(), response,
      (p_payload ->> 'clientEventId')::uuid
    );
    return response;
  end if;

  session_id := nullif(p_payload ->> 'sessionId', '')::uuid;
  session_token_hash := p_payload ->> 'sessionTokenHash';
  select
    s.institution_id,
    s.exam_id,
    s.exam_version_id,
    s.activation_id,
    s.roster_id,
    er.student_identity_id,
    s.session_status,
    s.lease_expires_at,
    a.activation_status,
    a.opens_at,
    a.closes_at,
    v.controls,
    v.publication_manifest,
    v.content_sha256,
    v.privacy_notice_version_id,
    n.notice_code,
    si.full_name,
    si.external_student_id,
    er.grading_alias,
    er.accommodations ->> 'subject',
    er.accommodations ->> 'yearLevel'
  into
    institution_id,
    exam_id,
    exam_version_id,
    activation_id,
    roster_id,
    student_identity_id,
    session_status,
    lease_expires_at,
    activation_status,
    activation_opens_at,
    activation_closes_at,
    controls_payload,
    publication_manifest,
    publication_hash,
    notice_version_id,
    notice_code,
    full_name,
    student_number,
    grading_alias,
    subject_name,
    year_level
  from examination_room_v1.student_sessions s
  join examination_room_v1.room_activations a on a.id = s.activation_id
  join examination_room_v1.exam_versions v on v.id = s.exam_version_id
  join examination_room_v1.privacy_notice_versions n on n.id = v.privacy_notice_version_id
  join examination_room_v1.exam_roster er on er.id = s.roster_id
  join examination_room_v1.student_identities si on si.id = er.student_identity_id
  where s.id = session_id
    and s.session_token_hash = session_token_hash
  for update of s;

  if institution_id is null then
    return examination_room_v1.api_error(
      'SESSION_INVALID', 'The examination session could not be verified.', 401,
      'Return to the join page and enter the same room key and student details.'
    );
  end if;

  if p_operation = 'result' and session_status = 'revoked' then
    return examination_room_v1.api_error(
      'SESSION_REVOKED', 'This examination credential has been revoked.', 401,
      'Ask the examination administrator to review access to the released result.'
    );
  end if;

  if p_operation in ('resume', 'session_context') then
    select jsonb_build_object(
      'ok', true,
      'session', jsonb_build_object(
        'id', s.id,
        'status', s.session_status,
        'startedAt', s.started_at,
        'lastHeartbeatAt', s.last_heartbeat_at,
        'leaseExpiresAt', s.lease_expires_at,
        'submittedAt', s.ended_at
      ),
      'publicationManifest', publication_manifest,
      'publicationHash', publication_hash,
      'studentIdentity', jsonb_build_object(
        'realName', full_name,
        'studentNumber', student_number,
        'subject', subject_name,
        'yearLevel', year_level
      ),
      'privacyConsent', consent.item,
      'answerRevisions', coalesce(answers.items, '[]'::jsonb),
      'nextRevisionByQuestion', coalesce(answers.next_revisions, '{}'::jsonb),
      'anonymousCandidateId', grading_alias
    )
    into response
    from examination_room_v1.student_sessions s
    left join lateral (
      select jsonb_build_object(
        'noticeVersion', notice_code,
        'accepted', true,
        'acceptedAt', to_char(pa.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'recordingAccepted', coalesce((pa.accepted_features ->> 'recordingAccepted')::boolean, false)
      ) as item
      from examination_room_v1.privacy_acceptances pa
      where pa.session_id = s.id
        and pa.decision = 'accepted'
        and not exists (
          select 1 from examination_room_v1.privacy_acceptances withdrawal
          where withdrawal.prior_acceptance_id = pa.id and withdrawal.decision = 'withdrawn'
        )
      order by pa.recorded_at desc
      limit 1
    ) consent on true
    left join lateral (
      with latest as (
        select distinct on (ar.question_id)
          ar.question_id,
          ar.answer_payload,
          ar.idempotency_key_hash,
          ar.revision_number
        from examination_room_v1.answer_revisions ar
        where ar.session_id = s.id
        order by ar.question_id, ar.revision_number desc
      ), next_values as (
        select q.question_key, coalesce(max(ar.revision_number), 0) + 1 as next_revision
        from examination_room_v1.questions q
        left join examination_room_v1.answer_revisions ar
          on ar.question_id = q.id and ar.session_id = s.id
        where q.exam_version_id = s.exam_version_id
        group by q.question_key
      )
      select
        coalesce((
          select jsonb_agg(
            latest.answer_payload || jsonb_build_object('idempotencyKey', latest.idempotency_key_hash)
            order by q.position
          )
          from latest
          join examination_room_v1.questions q on q.id = latest.question_id
        ), '[]'::jsonb) as items,
        coalesce((select jsonb_object_agg(next_values.question_key, next_values.next_revision) from next_values), '{}'::jsonb) as next_revisions
    ) answers on true
    where s.id = session_id;

    if p_operation = 'session_context' and response -> 'privacyConsent' = 'null'::jsonb then
      return examination_room_v1.api_error(
        'PRIVACY_CONSENT_REQUIRED', 'The exact current privacy consent is missing or withdrawn.', 412,
        'Return to the join page and review the current notice.'
      );
    end if;
    return response;
  end if;

  if p_operation = 'result' then
    select rr.release_manifest
    into result_manifest
    from examination_room_v1.submissions sub
    join examination_room_v1.result_releases rr
      on rr.submission_id = sub.id and rr.release_action = 'release'
    where sub.session_id = session_id
      and not exists (
        select 1 from examination_room_v1.result_releases revoked
        where revoked.supersedes_release_id = rr.id and revoked.release_action = 'revoke'
      )
    order by rr.occurred_at desc
    limit 1;

    if result_manifest is null then
      return jsonb_build_object('ok', true, 'available', false, 'status', 'awaiting_release');
    end if;
    return jsonb_build_object(
      'ok', true,
      'available', true,
      'releasedAt', result_manifest -> 'releasedAt',
      'result', result_manifest -> 'result'
    );
  end if;

  if p_operation in ('heartbeat', 'record_event', 'save_answer', 'submit')
     and not exists (
       select 1
       from examination_room_v1.privacy_acceptances pa
       where pa.session_id = session_id
         and pa.notice_version_id = notice_version_id
         and pa.decision = 'accepted'
         and not exists (
           select 1
           from examination_room_v1.privacy_acceptances withdrawn
           where withdrawn.prior_acceptance_id = pa.id
             and withdrawn.decision = 'withdrawn'
         )
     ) then
    return examination_room_v1.api_error(
      'PRIVACY_CONSENT_REQUIRED', 'The exact current privacy consent is missing or withdrawn.', 412,
      'Return to the join page and review the current notice.'
    );
  end if;

  request_hash := p_payload ->> 'requestHash';
  replay := examination_room_v1.api_replay(institution_id, request_hash, 'student.' || p_operation);
  if replay is not null then
    if p_operation = 'submit' and replay ->> 'ok' = 'true' then
      return jsonb_set(replay, '{duplicate}', 'true'::jsonb, true);
    end if;
    return replay;
  end if;

  if session_status not in ('created', 'active')
     or lease_expires_at <= clock_timestamp()
     or activation_status <> 'open'
     or clock_timestamp() > activation_closes_at then
    return examination_room_v1.api_error(
      'SESSION_NOT_ACTIVE', 'This examination session is no longer active.', 409,
      'Reconnect or ask the professor to review the session. Server-backed answers remain preserved.'
    );
  end if;

  occurred_at := coalesce((p_payload ->> 'occurredAt')::timestamptz, clock_timestamp());

  if p_operation = 'heartbeat' then
    update examination_room_v1.student_sessions s
    set last_heartbeat_at = greatest(coalesce(s.last_heartbeat_at, s.started_at), occurred_at),
        session_metadata = s.session_metadata || jsonb_build_object(
          'connected', coalesce((p_payload ->> 'connected')::boolean, true),
          'currentQuestion', coalesce((p_payload ->> 'currentQuestion')::integer, 1)
        )
    where s.id = session_id;
    response := jsonb_build_object(
      'ok', true,
      'sessionId', session_id,
      'receivedAt', clock_timestamp(),
      'connected', coalesce((p_payload ->> 'connected')::boolean, true)
    );
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, 'student', 'student.heartbeat',
      'student_session', session_id, request_hash, occurred_at, response,
      (p_payload ->> 'clientEventId')::uuid
    );
    return response;
  end if;

  if p_operation = 'record_event' then
    insert into examination_room_v1.proctoring_incidents (
      session_id, client_event_id, incident_kind, source, severity,
      occurred_at, duration_ms, details
    ) values (
      session_id,
      (p_payload ->> 'clientEventId')::uuid,
      p_payload ->> 'incidentKind',
      'browser_signal',
      coalesce(p_payload ->> 'severity', 'info'),
      occurred_at,
      nullif(p_payload ->> 'durationMs', '')::integer,
      coalesce(p_payload -> 'details', '{}'::jsonb)
    )
    returning id into answer_revision_id;
    response := jsonb_build_object('ok', true, 'incidentId', answer_revision_id, 'recordedAt', clock_timestamp());
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, 'student', 'student.record_event',
      'proctoring_incident', answer_revision_id, request_hash, occurred_at, response,
      (p_payload ->> 'clientEventId')::uuid
    );
    return response;
  end if;

  if p_operation = 'save_answer' then
    if not exists (
      select 1
      from examination_room_v1.privacy_acceptances pa
      where pa.session_id = session_id
        and pa.notice_version_id = notice_version_id
        and pa.decision = 'accepted'
        and not exists (
          select 1 from examination_room_v1.privacy_acceptances withdrawn
          where withdrawn.prior_acceptance_id = pa.id and withdrawn.decision = 'withdrawn'
        )
    ) then
      return examination_room_v1.api_error(
        'PRIVACY_CONSENT_REQUIRED', 'The exact current privacy consent is missing or withdrawn.', 412,
        'Return to the join page and review the current notice.'
      );
    end if;

    answer_item := p_payload -> 'answerRevision';
    select q.id, coalesce(q.configuration ->> 'type', replace(q.question_kind, '_', '-'))
    into question_id, expected_question_type
    from examination_room_v1.questions q
    where q.exam_version_id = exam_version_id
      and q.position = (answer_item ->> 'questionNumber')::integer
      and q.question_key = answer_item ->> 'questionKey';
    if question_id is null
       or (answer_item ->> 'attemptId')::uuid <> session_id
       or (answer_item ->> 'examinationId')::uuid <> exam_id
       or coalesce((answer_item ->> 'examinationVersion')::integer, -1) <> (publication_manifest ->> 'version')::integer
       or answer_item ->> 'questionType' <> expected_question_type
       or answer_item ->> 'publicationHash' <> publication_hash then
      return examination_room_v1.api_error(
        'ANSWER_BINDING_MISMATCH', 'The answer does not belong to this exact examination session and version.', 409,
        'Refresh the examination. Your other saved answers remain preserved.'
      );
    end if;
    select coalesce(max(ar.revision_number), 0) + 1
    into next_revision
    from examination_room_v1.answer_revisions ar
    where ar.session_id = session_id and ar.question_id = question_id;
    if (answer_item ->> 'revision')::integer <> next_revision then
      return examination_room_v1.api_error(
        'ANSWER_REVISION_CONFLICT', 'A newer answer revision already exists for this question.', 409,
        'Refresh the saved answer state, then save again.'
      );
    end if;

    answer_revision_id := gen_random_uuid();
    insert into examination_room_v1.answer_revisions (
      id, session_id, exam_version_id, question_id, revision_number,
      client_revision_id, idempotency_key_hash, answer_format, answer_payload,
      answer_sha256, is_flagged, source, saved_at
    ) values (
      answer_revision_id,
      session_id,
      exam_version_id,
      question_id,
      next_revision,
      (p_payload ->> 'clientEventId')::uuid,
      request_hash,
      case
        when answer_item ->> 'questionType' = 'multiple-choice' then 'choice'
        when answer_item ->> 'questionType' = 'true-false' then 'boolean'
        else 'plain_text'
      end,
      answer_item,
      p_payload ->> 'answerHash',
      coalesce((p_payload ->> 'flagged')::boolean, false),
      coalesce(p_payload ->> 'source', 'autosave'),
      (p_payload ->> 'savedAt')::timestamptz
    );
    response := jsonb_build_object(
      'ok', true,
      'revision', jsonb_build_object(
        'id', answer_revision_id,
        'questionKey', answer_item ->> 'questionKey',
        'revision', next_revision,
        'savedAt', p_payload -> 'savedAt',
        'flagged', coalesce((p_payload ->> 'flagged')::boolean, false)
      )
    );
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, 'student', 'student.save_answer',
      'answer_revision', answer_revision_id, request_hash,
      (p_payload ->> 'savedAt')::timestamptz, response,
      (p_payload ->> 'clientEventId')::uuid
    );
    return response;
  end if;

  if p_operation = 'submit' then
    submission_manifest := p_payload -> 'submissionManifest';

    select pa.recorded_at, pa.accepted_features
    into accepted_at, accepted_features
    from examination_room_v1.privacy_acceptances pa
    where pa.session_id = session_id
      and pa.notice_version_id = notice_version_id
      and pa.decision = 'accepted'
      and not exists (
        select 1
        from examination_room_v1.privacy_acceptances withdrawn
        where withdrawn.prior_acceptance_id = pa.id
          and withdrawn.decision = 'withdrawn'
      )
    order by pa.recorded_at desc
    limit 1;

    if coalesce(submission_manifest ->> 'schemaVersion', '') <> 'examination-room/submission/v1'
       or (submission_manifest ->> 'attemptId')::uuid <> session_id
       or (submission_manifest ->> 'examinationId')::uuid <> exam_id
       or coalesce((submission_manifest ->> 'examinationVersion')::integer, -1) <> (publication_manifest ->> 'version')::integer
       or submission_manifest ->> 'publicationHash' <> publication_hash
       or submission_manifest ->> 'identityMode' <> coalesce(controls_payload ->> 'identityMode', 'real_names')
       or submission_manifest -> 'studentIdentity' is distinct from jsonb_build_object(
         'realName', full_name,
         'studentNumber', student_number,
         'subject', subject_name,
         'yearLevel', year_level
       )
       or submission_manifest -> 'gradingIdentity' is distinct from (case
         when coalesce(controls_payload ->> 'identityMode', 'real_names') = 'anonymous_grading' then
           jsonb_build_object('mode', 'anonymous_grading', 'anonymousCandidateId', grading_alias)
         else
           jsonb_build_object('mode', 'real_names', 'displayName', full_name, 'studentNumber', student_number)
       end)
       or submission_manifest #>> '{privacyConsent,noticeVersion}' <> notice_code
       or not coalesce((submission_manifest #>> '{privacyConsent,accepted}')::boolean, false) then
      return examination_room_v1.api_error(
        'SUBMISSION_BINDING_MISMATCH', 'The submission does not match this exact session, publication, and consent.', 409,
        'Reconnect to the examination and submit the server-backed answers again.'
      );
    end if;

    if submission_manifest -> 'privacyConsent' is distinct from jsonb_build_object(
         'noticeVersion', notice_code,
         'accepted', true,
         'acceptedAt', to_char(accepted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'recordingAccepted', coalesce((accepted_features ->> 'recordingAccepted')::boolean, false)
       ) then
      return examination_room_v1.api_error(
        'SUBMISSION_CONSENT_MISMATCH', 'The submission consent evidence does not match the immutable server receipt.', 409,
        'Reconnect to the examination and submit the server-backed consent receipt again.'
      );
    end if;

    if not exists (
      select 1
      from examination_room_v1.privacy_acceptances pa
      where pa.session_id = session_id
        and pa.notice_version_id = notice_version_id
        and pa.decision = 'accepted'
        and not exists (
          select 1 from examination_room_v1.privacy_acceptances withdrawn
          where withdrawn.prior_acceptance_id = pa.id and withdrawn.decision = 'withdrawn'
        )
    ) then
      return examination_room_v1.api_error(
        'PRIVACY_CONSENT_REQUIRED', 'The exact current privacy consent is missing or withdrawn.', 412,
        'Return to the join page and review the current notice.'
      );
    end if;

    expected_count := jsonb_array_length(coalesce(p_payload -> 'answerSelections', '[]'::jsonb));
    if expected_count <> (select count(*) from examination_room_v1.questions q where q.exam_version_id = exam_version_id)
       or expected_count <> jsonb_array_length(coalesce(submission_manifest -> 'questions', '[]'::jsonb))
       or coalesce((submission_manifest ->> 'questionCount')::integer, -1) <> expected_count
       or coalesce((submission_manifest ->> 'maxPoints')::numeric, -1) <>
          (select coalesce(sum(q.points), 0) from examination_room_v1.questions q where q.exam_version_id = exam_version_id) then
      return examination_room_v1.api_error(
        'SUBMISSION_ANSWER_MISSING', 'Every question must have one saved answer revision before submission.', 400,
        'Return to the listed question, save an answer, then submit again.'
      );
    end if;

    select count(*)::integer
    into matched_count
    from jsonb_array_elements(p_payload -> 'answerSelections') selected(value)
    join examination_room_v1.questions q
      on q.exam_version_id = exam_version_id
     and q.position = (selected.value ->> 'questionNumber')::integer
     and q.question_key = selected.value ->> 'questionKey'
    join examination_room_v1.answer_revisions ar
      on ar.session_id = session_id
     and ar.question_id = q.id
     and ar.revision_number = (selected.value ->> 'revision')::integer
    join lateral (
      select manifest_question.value
      from jsonb_array_elements(submission_manifest -> 'questions') manifest_question(value)
      where (manifest_question.value ->> 'questionNumber')::integer = q.position
        and manifest_question.value ->> 'questionKey' = q.question_key
        and (manifest_question.value ->> 'revision')::integer = ar.revision_number
        and manifest_question.value -> 'answer' = ar.answer_payload -> 'answer'
    ) bound on true;

    if matched_count <> expected_count then
      return examination_room_v1.api_error(
        'ANSWER_BINDING_MISMATCH', 'One or more submitted answers does not match its saved server revision.', 409,
        'Refresh the saved-answer state and submit again.'
      );
    end if;

    submission_id := (submission_manifest ->> 'submissionId')::uuid;
    insert into examination_room_v1.submissions (
      id, session_id, exam_version_id, idempotency_key_hash, manifest_sha256,
      submission_manifest, answer_count, submitted_at_client
    ) values (
      submission_id,
      session_id,
      exam_version_id,
      request_hash,
      p_payload ->> 'manifestHash',
      submission_manifest,
      expected_count,
      (submission_manifest ->> 'submittedAt')::timestamptz
    );

    for answer_selection in select value from jsonb_array_elements(p_payload -> 'answerSelections')
    loop
      select q.id, ar.id
      into question_id, answer_revision_id
      from examination_room_v1.questions q
      join examination_room_v1.answer_revisions ar
        on ar.question_id = q.id
       and ar.session_id = session_id
       and ar.revision_number = (answer_selection ->> 'revision')::integer
      where q.exam_version_id = exam_version_id
        and q.position = (answer_selection ->> 'questionNumber')::integer
        and q.question_key = answer_selection ->> 'questionKey';
      insert into examination_room_v1.submission_answers (
        submission_id, session_id, question_id, answer_revision_id
      ) values (
        submission_id, session_id, question_id, answer_revision_id
      );
    end loop;

    insert into examination_room_v1.submission_receipts (
      submission_id, receipt_sha256, receipt_payload
    ) values (
      submission_id,
      p_payload ->> 'manifestHash',
      jsonb_build_object(
        'schemaVersion', 'examination-room/submission-receipt/v1',
        'submissionId', submission_id,
        'manifestHash', p_payload ->> 'manifestHash',
        'answerCount', expected_count,
        'receivedAt', clock_timestamp()
      )
    ) returning id into answer_revision_id;

    update examination_room_v1.student_sessions s
    set session_status = 'submitted', ended_at = clock_timestamp()
    where s.id = session_id;
    update examination_room_v1.exam_roster er
    set roster_status = 'completed'
    where er.id = roster_id;

    insert into examination_room_v1.recovery_snapshots (
      exam_id, exam_version_id, snapshot_sequence, snapshot_scope, request_hash,
      record_count, snapshot_status, retention_until
    ) values (
      exam_id,
      exam_version_id,
      examination_room_v1.next_snapshot_sequence(exam_id),
      'answer_state',
      request_hash,
      expected_count,
      'pending',
      clock_timestamp() + interval '365 days'
    );

    response := jsonb_build_object(
      'ok', true,
      'submission', jsonb_build_object(
        'id', submission_id,
        'status', 'accepted',
        'receiptId', answer_revision_id,
        'receivedAt', clock_timestamp()
      ),
      'duplicate', false
    );
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, 'student', 'student.submit',
      'submission', submission_id, request_hash,
      (submission_manifest ->> 'submittedAt')::timestamptz, response,
      (p_payload ->> 'clientEventId')::uuid
    );
    return response;
  end if;

  return examination_room_v1.api_error(
    'UNKNOWN_OPERATION', 'The student operation is not implemented.', 400,
    'Refresh the examination and try a listed action.'
  );
end;
$$;

revoke all on function examination_room_v1.api_student(text, jsonb) from public, anon, authenticated, service_role;

create function public.examination_room_v1_authorize_staff(
  p_user_id uuid,
  p_institution_id uuid,
  p_required_role text default 'professor'
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select p_user_id is not null
    and p_institution_id is not null
    and p_required_role is not null
    and p_required_role in ('professor', 'admin')
    and exists (
      select 1
      from examination_room_v1.staff_memberships m
      join examination_room_v1.institutions i
        on i.id = m.institution_id
       and i.institution_status = 'active'
      where m.user_id = p_user_id
        and m.institution_id = p_institution_id
        and m.membership_status = 'active'
        and (
          (
            p_required_role = 'professor'
            and m.staff_role = 'professor'
            and exists (
              select 1
              from public.profiles profile
              join public.professor_license_declarations declaration
                on declaration.user_id = profile.id
              where profile.id = p_user_id
                and profile.commercial_category = 'professor'
            )
          )
          or (
            p_required_role = 'professor'
            and m.staff_role = 'admin'
            and coalesce(public.admin_has_capability(p_user_id, 'role_admin'), false)
          )
          or (
            p_required_role = 'admin'
            and m.staff_role = 'admin'
            and coalesce(public.admin_has_capability(p_user_id, 'role_admin'), false)
          )
        )
    );
$$;

comment on function public.examination_room_v1_authorize_staff(uuid, uuid, text) is
  'Service-only authorization check. p_user_id must be derived from a verified signed-in identity, never accepted from an untrusted request body.';

alter function public.examination_room_v1_authorize_staff(uuid, uuid, text) owner to postgres;
revoke all on function public.examination_room_v1_authorize_staff(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.examination_room_v1_authorize_staff(uuid, uuid, text) to service_role;

create function public.examination_room_v1_staff_context(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  with memberships as (
    select
      m.institution_id,
      m.staff_role,
      max(i.institution_name) as institution_name,
      max(i.institution_code) as institution_code,
      bool_or(
        m.membership_status = 'active'
        and i.institution_status = 'active'
        and (
          (
            m.staff_role = 'professor'
            and exists (
              select 1
              from public.profiles profile
              join public.professor_license_declarations declaration
                on declaration.user_id = profile.id
              where profile.id = p_user_id
                and profile.commercial_category = 'professor'
            )
          )
          or (
            m.staff_role = 'admin'
            and coalesce(public.admin_has_capability(p_user_id, 'role_admin'), false)
          )
        )
      ) as active,
      max(i.institution_status) as institution_status
    from examination_room_v1.staff_memberships m
    left join examination_room_v1.institutions i on i.id = m.institution_id
    where m.user_id = p_user_id
    group by m.institution_id, m.staff_role
  ),
  active_institutions as (
    select distinct m.institution_id
    from memberships m
    where m.active
  )
  select jsonb_build_object(
    'authorized', exists (select 1 from memberships m where m.active),
    'profileRole', (
      select profile.commercial_category from public.profiles profile where profile.id = p_user_id
    ),
    'professorRoleSelected', exists (
      select 1
      from public.profiles profile
      join public.professor_license_declarations declaration on declaration.user_id = profile.id
      where profile.id = p_user_id
        and profile.commercial_category = 'professor'
    ),
    'institutionId', case
      when (select count(*) from active_institutions) = 1
        then (select a.institution_id from active_institutions a limit 1)
      else null
    end,
    'memberships', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'institutionId', m.institution_id,
            'institutionName', m.institution_name,
            'institutionCode', m.institution_code,
            'institutionStatus', m.institution_status,
            'staffRole', m.staff_role,
            'active', m.active
          )
          order by m.active desc, (m.staff_role = 'admin') desc, m.institution_id::text
        )
        from memberships m
      ),
      '[]'::jsonb
    )
  );
$$;

comment on function public.examination_room_v1_staff_context(uuid) is
  'Service-only staff context. A null institutionId with authorized=true means the user has multiple active institutions and must choose explicitly.';

alter function public.examination_room_v1_staff_context(uuid) owner to postgres;
revoke all on function public.examination_room_v1_staff_context(uuid) from public, anon, authenticated;
grant execute on function public.examination_room_v1_staff_context(uuid) to service_role;

create function public.examination_room_v1_professor_access(
  p_operation text,
  p_actor_user_id uuid,
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
  profile_role text;
  school_id text;
  school_name text;
  professor_declared boolean := false;
  actor_email text;
  actor_name text;
  pending_request examination_room_v1.professor_access_requests%rowtype;
  active_membership_id uuid;
  requested_institution_id uuid;
  replaced_request_id uuid;
  explicit_institution_selection boolean := false;
  matching_institution_count integer := 0;
begin
  if jsonb_typeof(safe_payload) <> 'object' then
    return examination_room_v1.api_error(
      'INVALID_REQUEST', 'Provide Professor access details as an object.', 400,
      'Refresh the Professor card and try again.'
    );
  end if;
  if p_actor_user_id is null then
    return examination_room_v1.api_error(
      'PROFESSOR_SIGN_IN_REQUIRED', 'Professor sign-in is required.', 401,
      'Sign in through Due Diligence, then reopen the Professor Examination Room card.'
    );
  end if;

  select
    lower(btrim(coalesce(profile.commercial_category, ''))),
    lower(btrim(coalesce(profile.law_school_id, ''))),
    btrim(coalesce(
      nullif(profile.law_school_other, ''),
      nullif(profile.school, ''),
      initcap(replace(coalesce(profile.law_school_id, ''), '-', ' '))
    )),
    exists (
      select 1 from public.professor_license_declarations declaration
      where declaration.user_id = p_actor_user_id
        and length(btrim(declaration.license_number)) between 3 and 80
    ),
    lower(auth_user.email),
    coalesce(
      nullif(btrim(profile.display_name), ''),
      nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(auth_user.raw_user_meta_data ->> 'name'), ''),
      nullif(pg_catalog.split_part(lower(auth_user.email), '@', 1), ''),
      'Professor'
    )
  into profile_role, school_id, school_name, professor_declared, actor_email, actor_name
  from auth.users auth_user
  left join public.profiles profile on profile.id = auth_user.id
  where auth_user.id = p_actor_user_id;

  if actor_email is null then
    return examination_room_v1.api_error(
      'PROFESSOR_ACCOUNT_NOT_FOUND', 'The signed-in Professor account could not be verified.', 409,
      'Sign out, sign in again with the same account, and retry.'
    );
  end if;

  select request.* into pending_request
  from examination_room_v1.professor_access_requests request
  where request.user_id = p_actor_user_id
  order by (request.request_status = 'pending') desc, request.requested_at desc
  limit 1;

  select membership.id into active_membership_id
  from examination_room_v1.staff_memberships membership
  join examination_room_v1.institutions institution
    on institution.id = membership.institution_id
   and institution.institution_status = 'active'
  where membership.user_id = p_actor_user_id
    and membership.staff_role = 'professor'
    and membership.membership_status = 'active'
  order by membership.granted_at desc
  limit 1;

  if p_operation = 'status' then
    return jsonb_build_object(
      'ok', true,
      'profileRole', nullif(profile_role, ''),
      'professorRoleSelected', profile_role = 'professor',
      'declarationOnFile', professor_declared,
      'school', jsonb_build_object('id', nullif(school_id, ''), 'name', nullif(school_name, '')),
      'activeAssignment', profile_role = 'professor' and professor_declared and active_membership_id is not null,
      'activeAssignments', case
        when profile_role = 'professor' and professor_declared then coalesce((
          select jsonb_agg(jsonb_build_object(
            'institutionId', membership.institution_id,
            'institutionName', institution.institution_name,
            'institutionCode', institution.institution_code
          ) order by institution.institution_name)
          from examination_room_v1.staff_memberships membership
          join examination_room_v1.institutions institution
            on institution.id = membership.institution_id
           and institution.institution_status = 'active'
          where membership.user_id = p_actor_user_id
            and membership.staff_role = 'professor'
            and membership.membership_status = 'active'
        ), '[]'::jsonb)
        else '[]'::jsonb
      end,
      'availableInstitutions', case
        when profile_role = 'professor' and professor_declared then coalesce((
          select jsonb_agg(jsonb_build_object(
            'institutionId', institution.id,
            'institutionName', institution.institution_name,
            'institutionCode', institution.institution_code,
            'profileMatch', institution.profile_school_id = school_id
              or lower(institution.institution_name) = lower(school_name)
          ) order by (
            institution.profile_school_id = school_id
            or lower(institution.institution_name) = lower(school_name)
          ) desc, institution.institution_name)
          from examination_room_v1.institutions institution
          where institution.institution_status = 'active'
        ), '[]'::jsonb)
        else '[]'::jsonb
      end,
      'request', case when pending_request.id is null then null else jsonb_build_object(
        'id', pending_request.id,
        'status', pending_request.request_status,
        'institutionId', pending_request.requested_institution_id,
        'institutionName', (
          select institution.institution_name
          from examination_room_v1.institutions institution
          where institution.id = pending_request.requested_institution_id
        ),
        'requestedAt', pending_request.requested_at,
        'reviewedAt', pending_request.reviewed_at,
        'reason', pending_request.review_reason
      ) end
    );
  end if;

  if p_operation = 'request' then
    if profile_role <> 'professor' or not professor_declared then
      return examination_room_v1.api_error(
        'PROFESSOR_ROLE_REQUIRED', 'Select Professor during account setup before requesting access.', 409,
        'Open Profile, choose Professor, provide the private declaration, save, and return to this card.'
      );
    end if;
    if char_length(school_id) not between 1 and 180
       or char_length(school_name) not between 2 and 240 then
      return examination_room_v1.api_error(
        'PROFESSOR_SCHOOL_REQUIRED', 'A law school is required for Professor access.', 409,
        'Open Profile, save your law school, then return to this card.'
      );
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'examination-room-v1:professor-access-request:' || p_actor_user_id::text,
        20260826
      )
    );

    pending_request := null;
    select request.* into pending_request
    from examination_room_v1.professor_access_requests request
    where request.user_id = p_actor_user_id
      and request.request_status = 'pending'
    order by request.requested_at desc
    limit 1
    for update;

    explicit_institution_selection := nullif(safe_payload ->> 'institutionId', '') is not null;
    begin
      requested_institution_id := nullif(safe_payload ->> 'institutionId', '')::uuid;
    exception when invalid_text_representation then
      requested_institution_id := null;
    end;
    if explicit_institution_selection and requested_institution_id is null then
      return examination_room_v1.api_error(
        'PROFESSOR_INSTITUTION_SELECTION_REQUIRED', 'Choose a valid law-school workspace for the Professor request.', 400,
        'Refresh the Professor card and choose the school again.'
      );
    end if;
    if not explicit_institution_selection and pending_request.id is not null then
      requested_institution_id := pending_request.requested_institution_id;
    end if;
    if requested_institution_id is null then
      select count(*), (array_agg(institution.id order by institution.id))[1]
      into matching_institution_count, requested_institution_id
      from examination_room_v1.institutions institution
      where institution.institution_status = 'active'
        and (
          institution.profile_school_id = school_id
          or lower(institution.institution_name) = lower(school_name)
        );
      if matching_institution_count <> 1 then requested_institution_id := null; end if;
    end if;
    if requested_institution_id is null or not exists (
      select 1 from examination_room_v1.institutions institution
      where institution.id = requested_institution_id
        and institution.institution_status = 'active'
    ) then
      return examination_room_v1.api_error(
        'PROFESSOR_INSTITUTION_SELECTION_REQUIRED', 'Choose the law-school workspace that should review your Professor request.', 409,
        'Choose your school from the Professor card. If it is not listed, ask the school administrator to create its workspace first.'
      );
    end if;
    if pending_request.id is not null
       and pending_request.requested_institution_id = requested_institution_id then
      return jsonb_build_object(
        'ok', true, 'duplicate', true,
        'request', jsonb_build_object(
          'id', pending_request.id,
          'status', 'pending',
          'institutionId', pending_request.requested_institution_id,
          'requestedAt', pending_request.requested_at
        )
      );
    end if;

    if pending_request.id is not null then
      replaced_request_id := pending_request.id;
      update examination_room_v1.professor_access_requests request
      set request_status = 'cancelled',
          reviewed_by_user_id = p_actor_user_id,
          reviewed_at = clock_timestamp(),
          review_reason = 'Replaced by the Professor with a request for a different law-school workspace.',
          assigned_institution_id = null
      where request.id = pending_request.id
        and request.user_id = p_actor_user_id
        and request.request_status = 'pending';
      if not found then
        return examination_room_v1.api_error(
          'PROFESSOR_REQUEST_RETRY_REQUIRED', 'The pending Professor request changed while the replacement was being saved.', 409,
          'Refresh the Professor card, confirm the school, and try once more.'
        );
      end if;
    end if;

    if exists (
      select 1
      from examination_room_v1.staff_memberships membership
      join examination_room_v1.institutions institution
        on institution.id = membership.institution_id
       and institution.institution_status = 'active'
      where membership.user_id = p_actor_user_id
        and membership.institution_id = requested_institution_id
        and membership.staff_role = 'professor'
        and membership.membership_status = 'active'
    ) then
      return jsonb_build_object(
        'ok', true,
        'alreadyActive', true,
        'institutionId', requested_institution_id,
        'replacedRequestId', replaced_request_id,
        'request', null
      );
    end if;

    insert into examination_room_v1.professor_access_requests (
      user_id, email_normalized, display_name, claimed_school_id, claimed_school_name,
      requested_institution_id
    ) values (
      p_actor_user_id, actor_email, actor_name, school_id, school_name,
      requested_institution_id
    ) returning * into pending_request;

    return jsonb_build_object(
      'ok', true, 'duplicate', false,
      'replacedRequestId', replaced_request_id,
      'request', jsonb_build_object(
        'id', pending_request.id,
        'status', 'pending',
        'institutionId', pending_request.requested_institution_id,
        'requestedAt', pending_request.requested_at
      )
    );
  end if;

  return examination_room_v1.api_error(
    'UNKNOWN_OPERATION', 'That Professor access operation is not available.', 400,
    'Refresh the Professor Examination Room card and try again.'
  );
end;
$$;

comment on function public.examination_room_v1_professor_access(text, uuid, jsonb) is
  'Service-only Professor-role bridge. The Worker supplies verified identity; the function keeps at most one pending request, preserves wrong-school corrections as cancelled history, and never self-grants institution access.';

alter function public.examination_room_v1_professor_access(text, uuid, jsonb) owner to postgres;
revoke all on function public.examination_room_v1_professor_access(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.examination_room_v1_professor_access(text, uuid, jsonb) to service_role;

create function public.examination_room_v1_manage_staff(
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
  institution_id uuid;
  institution_code text;
  profile_school_id text;
  institution_name text;
  membership_id uuid;
  target_membership_id uuid;
  professor_request_id uuid;
  target_user_id uuid;
  submitted_email text;
  submitted_name text;
  target_email text;
  target_name text;
  target_role text;
  reason text;
  request_hash text;
  actor_email text;
  actor_name text;
  notice_body text;
  existing_role text;
  membership_already_active boolean := false;
  response jsonb;
  replay jsonb;
begin
  if p_actor_user_id is null
     or not coalesce(public.admin_has_capability(p_actor_user_id, 'role_admin'), false) then
    return examination_room_v1.api_error(
      'ROLE_ADMIN_REQUIRED', 'Role-management authorization is required.', 403,
      'Sign in with a Founder, Super Admin, or an administrator who has Role admin access.'
    );
  end if;

  if jsonb_typeof(safe_payload) <> 'object' then
    return examination_room_v1.api_error(
      'INVALID_REQUEST', 'Provide the role-management details as an object.', 400,
      'Refresh the administrator page and try again.'
    );
  end if;

  if p_operation = 'access' then
    select jsonb_build_object(
      'ok', true,
      'canManageRoles', true,
      'institutions', coalesce(jsonb_agg(jsonb_build_object(
        'institutionId', i.id,
        'institutionCode', i.institution_code,
        'profileSchoolId', i.profile_school_id,
        'institutionName', i.institution_name,
        'institutionStatus', i.institution_status,
        'membershipId', self_membership.id,
        'staffRole', self_membership.staff_role,
        'active', coalesce(self_membership.membership_status = 'active' and i.institution_status = 'active', false),
        'professorCount', (
          select count(*) from examination_room_v1.staff_memberships professor_membership
          where professor_membership.institution_id = i.id
            and professor_membership.staff_role = 'professor'
            and professor_membership.membership_status = 'active'
        ),
        'adminCount', (
          select count(*) from examination_room_v1.staff_memberships admin_membership
          where admin_membership.institution_id = i.id
            and admin_membership.staff_role = 'admin'
            and admin_membership.membership_status = 'active'
        )
      ) order by i.institution_name), '[]'::jsonb)
    )
    into response
    from examination_room_v1.institutions i
    left join lateral (
      select membership.id, membership.staff_role, membership.membership_status
      from examination_room_v1.staff_memberships membership
      where membership.institution_id = i.id
        and membership.user_id = p_actor_user_id
      order by (membership.membership_status = 'active') desc,
               (membership.staff_role = 'admin') desc,
               membership.granted_at desc
      limit 1
    ) self_membership on true;
    return response;
  end if;

  if p_operation = 'bootstrap_institution' then
    institution_code := lower(btrim(coalesce(safe_payload ->> 'institutionCode', '')));
    profile_school_id := lower(btrim(coalesce(safe_payload ->> 'profileSchoolId', '')));
    institution_name := btrim(coalesce(safe_payload ->> 'institutionName', ''));
    request_hash := safe_payload ->> 'requestHash';
    if institution_code !~ '^[a-z0-9][a-z0-9._-]{1,63}$'
       or profile_school_id !~ '^[a-z0-9][a-z0-9-]{1,179}$'
       or char_length(institution_name) not between 2 and 240
       or request_hash !~ '^[0-9a-f]{64}$' then
      return examination_room_v1.api_error(
        'INSTITUTION_DETAILS_INVALID', 'Enter a school name and a valid profile-school match.', 400,
        'Use the exact law-school name shown during account setup; Due Diligence creates its matching profile identifier automatically.'
      );
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('examination-room-v1:institution:' || request_hash, 20260826)
    );

    select i.id into institution_id
    from examination_room_v1.institutions i
    where i.bootstrap_request_hash = request_hash;
    if institution_id is not null then
      select m.id into membership_id
      from examination_room_v1.staff_memberships m
      where m.institution_id = institution_id
        and m.user_id = p_actor_user_id
        and m.staff_role = 'admin'
        and m.membership_status = 'active'
      order by m.granted_at desc
      limit 1;
      if membership_id is null then
        return examination_room_v1.api_error(
          'INSTITUTION_REPLAY_FORBIDDEN', 'That institution setup request belongs to another administrator.', 409,
          'Refresh the administrator page and start a new institution setup request.'
        );
      end if;
      return jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'institution', (
          select jsonb_build_object('id', i.id, 'code', i.institution_code, 'profileSchoolId', i.profile_school_id, 'name', i.institution_name)
          from examination_room_v1.institutions i where i.id = institution_id
        ),
        'membershipId', membership_id
      );
    end if;

    if exists (
      select 1 from examination_room_v1.institutions i
      where i.institution_code = institution_code
    ) then
      return examination_room_v1.api_error(
        'INSTITUTION_CODE_EXISTS', 'That school code is already in use.', 409,
        'Choose the existing school from the list or enter a different short code.'
      );
    end if;

    select
      lower(u.email),
      coalesce(
        nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
        nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
        nullif(pg_catalog.split_part(lower(u.email), '@', 1), ''),
        'Administrator'
      )
    into actor_email, actor_name
    from auth.users u
    where u.id = p_actor_user_id;
    if actor_email is null then
      return examination_room_v1.api_error(
        'ADMIN_ACCOUNT_NOT_FOUND', 'The signed-in administrator account could not be verified.', 409,
        'Sign out, sign in again with the administrator account, and retry.'
      );
    end if;

    institution_id := gen_random_uuid();
    insert into examination_room_v1.institutions (
      id, institution_code, profile_school_id, institution_name, bootstrap_request_hash, created_by_user_id
    ) values (
      institution_id, institution_code, profile_school_id, institution_name, request_hash, p_actor_user_id
    );

    membership_id := gen_random_uuid();
    insert into examination_room_v1.staff_memberships (
      id, institution_id, user_id, staff_role, display_name, email_normalized,
      membership_status, grant_reason, granted_by_user_id
    ) values (
      membership_id, institution_id, p_actor_user_id, 'admin', actor_name, actor_email,
      'active', 'Initial institution administrator created through the protected bootstrap workflow.', p_actor_user_id
    );

    notice_body :=
      'The law school and Due Diligence process the student''s verified name, student number, year level, examination answers, save and submission records, and integrity events to administer and safeguard this examination. '
      || 'Camera or microphone recordings are processed only when the professor enables an approved recorded-proctoring arrangement and the student separately consents before the examination begins. '
      || 'Access is limited to authorized school personnel and service providers acting under documented instructions. Retention, access, correction, objection, withdrawal, and deletion requests are handled under the school''s published policy and Republic Act No. 10173, its implementing rules, and applicable education and examination requirements. '
      || 'The persistent notice must be accepted before the examination opens; declining leaves the examination unopened so the student can contact the professor for an authorized accommodation.';

    insert into examination_room_v1.privacy_notice_versions (
      institution_id, notice_code, version_number, title, notice_body, body_sha256,
      processing_purposes, effective_at, created_by_user_id
    ) values (
      institution_id, 'exam-room-v1', 1, 'Examination Room Privacy Notice', notice_body,
      encode(sha256(convert_to(notice_body, 'UTF8')), 'hex'),
      '["identity_verification","examination_administration","answer_persistence","integrity_review","result_release"]'::jsonb,
      clock_timestamp(), p_actor_user_id
    );

    return jsonb_build_object(
      'ok', true,
      'duplicate', false,
      'institution', jsonb_build_object(
        'id', institution_id,
        'code', institution_code,
        'profileSchoolId', profile_school_id,
        'name', institution_name
      ),
      'membershipId', membership_id
    );
  end if;

  if p_institution_id is null or not exists (
    select 1
    from examination_room_v1.staff_memberships actor_membership
    join examination_room_v1.institutions actor_institution
      on actor_institution.id = actor_membership.institution_id
     and actor_institution.institution_status = 'active'
    where actor_membership.institution_id = p_institution_id
      and actor_membership.user_id = p_actor_user_id
      and actor_membership.staff_role = 'admin'
      and actor_membership.membership_status = 'active'
  ) then
    return examination_room_v1.api_error(
      'INSTITUTION_ADMIN_REQUIRED', 'Active institution-administrator access is required.', 403,
      'Choose a school where your administrator assignment is active.'
    );
  end if;

  if p_operation = 'directory' then
    return jsonb_build_object(
      'ok', true,
      'institution', (
        select jsonb_build_object('id', i.id, 'code', i.institution_code, 'profileSchoolId', i.profile_school_id, 'name', i.institution_name)
        from examination_room_v1.institutions i where i.id = p_institution_id
      ),
      'staff', coalesce(
        (
          select jsonb_agg(jsonb_build_object(
            'membershipId', m.id,
            'userId', m.user_id,
            'staffRole', m.staff_role,
            'displayName', m.display_name,
            'email', m.email_normalized,
            'status', m.membership_status,
            'grantedAt', m.granted_at,
            'isCurrentAdministrator', m.user_id = p_actor_user_id
          ) order by (m.membership_status = 'active') desc, (m.staff_role = 'admin') desc, m.display_name, m.email_normalized)
          from examination_room_v1.staff_memberships m
          where m.institution_id = p_institution_id
        ),
        '[]'::jsonb
      ),
      'professorRequests', coalesce(
        (
          select jsonb_agg(jsonb_build_object(
            'requestId', request.id,
            'userId', request.user_id,
            'email', request.email_normalized,
            'displayName', request.display_name,
            'schoolId', request.claimed_school_id,
            'schoolName', request.claimed_school_name,
            'status', request.request_status,
            'requestedAt', request.requested_at
          ) order by request.requested_at)
          from examination_room_v1.professor_access_requests request
          where request.request_status = 'pending'
            and request.requested_institution_id = p_institution_id
        ),
        '[]'::jsonb
      )
    );
  end if;

  request_hash := safe_payload ->> 'requestHash';
  reason := btrim(coalesce(safe_payload ->> 'reason', ''));
  if request_hash !~ '^[0-9a-f]{64}$' or char_length(reason) not between 5 and 1000 then
    return examination_room_v1.api_error(
      'ROLE_CHANGE_DETAILS_INVALID', 'A reason is required for every staff-access change.', 400,
      'Enter a reason from 5 to 1,000 characters, then try again.'
    );
  end if;

  perform examination_room_v1.lock_request(p_institution_id, request_hash);
  replay := examination_room_v1.api_replay(p_institution_id, request_hash, 'admin.' || p_operation);
  if replay is not null then return replay; end if;

  if p_operation = 'assign_staff' then
    submitted_email := lower(btrim(coalesce(safe_payload ->> 'email', '')));
    submitted_name := btrim(coalesce(safe_payload ->> 'displayName', ''));
    target_email := submitted_email;
    target_name := submitted_name;
    target_role := lower(btrim(coalesce(safe_payload ->> 'staffRole', '')));
    if submitted_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       or target_role not in ('professor', 'admin')
       or (submitted_name <> '' and char_length(submitted_name) not between 2 and 240) then
      return examination_room_v1.api_error(
        'STAFF_DETAILS_INVALID', 'Enter a valid signed-in user email, display name, and staff role.', 400,
        'Correct the highlighted staff-access fields, then try again.'
      );
    end if;

    if target_role = 'professor' then
      select request.id, request.user_id,
             coalesce(nullif(submitted_name, ''), request.display_name)
      into professor_request_id, target_user_id, target_name
      from examination_room_v1.professor_access_requests request
      where request.requested_institution_id = p_institution_id
        and request.request_status = 'pending'
        and request.email_normalized = submitted_email
      order by request.requested_at desc, request.id desc
      limit 1
      for update;
    end if;

    if professor_request_id is not null then
      target_email := null;
      select
        lower(u.email),
        coalesce(
          nullif(target_name, ''),
          nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
          nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
          pg_catalog.split_part(lower(u.email), '@', 1)
        )
      into target_email, target_name
      from auth.users u
      where u.id = target_user_id;
    else
      select
        u.id,
        coalesce(
          nullif(submitted_name, ''),
          nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
          nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
          pg_catalog.split_part(lower(u.email), '@', 1)
        ),
        lower(u.email)
      into target_user_id, target_name, target_email
      from auth.users u
      where lower(u.email) = submitted_email
      order by u.created_at
      limit 1;
    end if;

    if target_user_id is null or target_email is null then
      return examination_room_v1.api_error(
        'STAFF_ACCOUNT_NOT_FOUND', 'No signed-in Due Diligence account matches that email.', 404,
        'Ask the professor to sign in to Due Diligence once, then assign the same verified email.'
      );
    end if;

    if target_role = 'professor' and not exists (
      select 1
      from public.profiles profile
      join public.professor_license_declarations declaration
        on declaration.user_id = profile.id
      where profile.id = target_user_id
        and profile.commercial_category = 'professor'
        and length(btrim(declaration.license_number)) between 3 and 80
    ) then
      return examination_room_v1.api_error(
        'PROFESSOR_PROFILE_REQUIRED', 'That account has not selected Professor during account setup.', 409,
        'Ask the user to open Profile, choose Professor, save the private declaration, and then approve the request again.'
      );
    end if;

    if target_role = 'admin'
       and not coalesce(public.admin_has_capability(target_user_id, 'role_admin'), false) then
      return examination_room_v1.api_error(
        'PLATFORM_ROLE_ADMIN_REQUIRED', 'Institution-admin access requires an existing platform Role admin.', 409,
        'Grant the protected platform administrator role first, or assign this account as Professor.'
      );
    end if;

    select m.id into target_membership_id
    from examination_room_v1.staff_memberships m
    where m.institution_id = p_institution_id
      and m.user_id = target_user_id
      and m.staff_role = target_role
      and m.membership_status = 'active'
    order by m.granted_at desc
    limit 1;
    membership_already_active := target_membership_id is not null;

    if target_membership_id is null then
      target_membership_id := gen_random_uuid();
      insert into examination_room_v1.staff_memberships (
        id, institution_id, user_id, staff_role, display_name, email_normalized,
        membership_status, grant_reason, granted_by_user_id
      ) values (
        target_membership_id, p_institution_id, target_user_id, target_role,
        target_name, target_email, 'active', reason, p_actor_user_id
      );
    end if;

    if target_role = 'professor' then
      update examination_room_v1.professor_access_requests request
      set request_status = 'approved',
          reviewed_by_user_id = p_actor_user_id,
          reviewed_at = clock_timestamp(),
          review_reason = reason,
          assigned_institution_id = p_institution_id,
          approved_membership_id = target_membership_id,
          updated_at = clock_timestamp()
      where request.user_id = target_user_id
        and request.request_status = 'pending'
        and request.requested_institution_id = p_institution_id;
    end if;

    response := jsonb_build_object(
      'ok', true,
      'duplicate', membership_already_active,
      'membership', jsonb_build_object(
        'id', target_membership_id,
        'institutionId', p_institution_id,
        'userId', target_user_id,
        'staffRole', target_role,
        'displayName', target_name,
        'email', target_email,
        'status', 'active'
      )
    );
    perform examination_room_v1.api_record_audit(
      p_institution_id, null, null, p_actor_user_id, 'admin', 'admin.assign_staff',
      'staff_membership', target_membership_id, request_hash, clock_timestamp(), response, null
    );
    return response;
  end if;

  if p_operation = 'reject_professor_request' then
    begin
      professor_request_id := nullif(safe_payload ->> 'requestId', '')::uuid;
    exception when invalid_text_representation then
      professor_request_id := null;
    end;
    if professor_request_id is null then
      return examination_room_v1.api_error(
        'PROFESSOR_REQUEST_INVALID', 'Choose a valid pending Professor request.', 400,
        'Refresh the Professor request queue and choose the request again.'
      );
    end if;

    update examination_room_v1.professor_access_requests request
    set request_status = 'rejected',
        reviewed_by_user_id = p_actor_user_id,
        reviewed_at = clock_timestamp(),
        review_reason = reason,
        assigned_institution_id = p_institution_id,
        updated_at = clock_timestamp()
    where request.id = professor_request_id
      and request.request_status = 'pending'
      and request.requested_institution_id = p_institution_id;
    if not found then
      return examination_room_v1.api_error(
        'PROFESSOR_REQUEST_NOT_PENDING', 'That Professor request is no longer pending for this school.', 409,
        'Refresh the Professor request queue before taking another action.'
      );
    end if;

    response := jsonb_build_object('ok', true, 'requestId', professor_request_id, 'status', 'rejected');
    perform examination_room_v1.api_record_audit(
      p_institution_id, null, null, p_actor_user_id, 'admin', 'admin.reject_professor_request',
      'professor_access_request', professor_request_id, request_hash, clock_timestamp(), response, null
    );
    return response;
  end if;

  if p_operation = 'revoke_staff' then
    begin
      target_membership_id := nullif(safe_payload ->> 'membershipId', '')::uuid;
    exception when invalid_text_representation then
      target_membership_id := null;
    end;
    if target_membership_id is null then
      return examination_room_v1.api_error(
        'STAFF_MEMBERSHIP_INVALID', 'Choose a valid active staff assignment.', 400,
        'Refresh the staff directory and choose the assignment again.'
      );
    end if;

    select m.user_id, m.staff_role
    into target_user_id, existing_role
    from examination_room_v1.staff_memberships m
    where m.id = target_membership_id
      and m.institution_id = p_institution_id
      and m.membership_status = 'active'
    for update;
    if target_user_id is null then
      return examination_room_v1.api_error(
        'STAFF_MEMBERSHIP_NOT_ACTIVE', 'That staff assignment is no longer active.', 409,
        'Refresh the staff directory before taking another action.'
      );
    end if;
    if target_user_id = p_actor_user_id then
      return examination_room_v1.api_error(
        'SELF_REVOCATION_BLOCKED', 'You cannot revoke your own active institution-admin assignment here.', 409,
        'Ask another active institution administrator to transfer responsibility first.'
      );
    end if;
    if existing_role = 'admin' and (
      select count(*) from examination_room_v1.staff_memberships m
      where m.institution_id = p_institution_id
        and m.staff_role = 'admin'
        and m.membership_status = 'active'
    ) <= 1 then
      return examination_room_v1.api_error(
        'LAST_ADMIN_REVOCATION_BLOCKED', 'The final active institution administrator cannot be revoked.', 409,
        'Assign another authorized institution administrator before revoking this access.'
      );
    end if;

    update examination_room_v1.staff_memberships m
    set membership_status = 'revoked',
        revoked_by_user_id = p_actor_user_id,
        revoked_at = clock_timestamp(),
        revocation_reason = reason
    where m.id = target_membership_id;

    response := jsonb_build_object(
      'ok', true,
      'membershipId', target_membership_id,
      'status', 'revoked'
    );
    perform examination_room_v1.api_record_audit(
      p_institution_id, null, null, p_actor_user_id, 'admin', 'admin.revoke_staff',
      'staff_membership', target_membership_id, request_hash, clock_timestamp(), response, null
    );
    return response;
  end if;

  return examination_room_v1.api_error(
    'UNKNOWN_OPERATION', 'That staff-management operation is not registered.', 400,
    'Refresh the administrator page and use one of the available staff actions.'
  );
exception
  when unique_violation then
    return examination_room_v1.api_error(
      'PERSISTENCE_CONFLICT', 'A matching institution or active staff assignment already exists.', 409,
      'Refresh the administrator page and use the current record.'
    );
  when foreign_key_violation or check_violation or not_null_violation then
    return examination_room_v1.api_error(
      'PERSISTENCE_STATE_INVALID', 'The staff-access change did not match the protected data rules.', 409,
      'Refresh the administrator page, correct the details, and try again.'
    );
  when others then
    return examination_room_v1.api_error(
      'STAFF_MANAGEMENT_INTERNAL_ERROR', 'Staff access could not be changed safely.', 500,
      'No partial access change was kept. Try again; if it continues, contact support.'
    );
end;
$$;

comment on function public.examination_room_v1_manage_staff(text, uuid, uuid, jsonb) is
  'Service-only institution bootstrap and staff access management. The actor is rechecked against protected platform Role admin authority and active institution-admin membership.';

alter function public.examination_room_v1_manage_staff(text, uuid, uuid, jsonb) owner to postgres;
revoke all on function public.examination_room_v1_manage_staff(text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.examination_room_v1_manage_staff(text, uuid, uuid, jsonb) to service_role;

create function public.examination_room_v1_api(
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
  required_staff_role text;
  safe_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if p_scope is null
     or p_operation is null
     or (p_scope <> 'student' and p_institution_id is null)
     or jsonb_typeof(safe_payload) <> 'object' then
    return jsonb_build_object(
      'ok', false,
      'errorCode', 'INVALID_REQUEST',
      'message', 'Scope, operation, an object payload, and institution for staff scopes are required.'
    );
  end if;

  if safe_payload::text ~* '"(key|token|raw[ _-]?key|room[ _-]?(key|code)|activation[ _-]?(key|code)|exam[ _-]?(key|code)|api[ _-]?key|session[ _-]?token|idempotency[ _-]?key|access[ _-]?(token|code)|refresh[ _-]?token|bearer[ _-]?token|one[ _-]?time[ _-]?code|password|secret|authorization|credential)"[[:space:]]*:' then
    return jsonb_build_object(
      'ok', false,
      'errorCode', 'RAW_SECRET_REJECTED',
      'message', 'Only one-way hashes or opaque identifiers may be sent to the persistence API.'
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
    return jsonb_build_object(
      'ok', false,
      'errorCode', 'UNKNOWN_OPERATION',
      'message', 'The requested Examination Room operation is not registered.'
    );
  end if;

  if p_scope in ('professor', 'admin') then
    required_staff_role := case when p_scope = 'admin' then 'admin' else 'professor' end;

    if p_actor_user_id is null
       or not exists (
         select 1
         from examination_room_v1.staff_memberships m
         join examination_room_v1.institutions i
           on i.id = m.institution_id
          and i.institution_status = 'active'
         where m.user_id = p_actor_user_id
           and m.institution_id = p_institution_id
           and m.membership_status = 'active'
           and (
             (
               required_staff_role = 'professor'
               and m.staff_role = 'professor'
               and exists (
                 select 1
                 from public.profiles profile
                 join public.professor_license_declarations declaration
                   on declaration.user_id = profile.id
                 where profile.id = p_actor_user_id
                   and profile.commercial_category = 'professor'
               )
             )
             or (
               required_staff_role = 'professor'
               and m.staff_role = 'admin'
               and coalesce(public.admin_has_capability(p_actor_user_id, 'role_admin'), false)
             )
              or (
                required_staff_role = 'admin'
                and m.staff_role = 'admin'
                and coalesce(public.admin_has_capability(p_actor_user_id, 'role_admin'), false)
              )
           )
       ) then
      return jsonb_build_object(
        'ok', false,
        'errorCode', 'FORBIDDEN',
        'message', 'An active institution staff authorization is required.'
      );
    end if;
  end if;

  if p_scope = 'professor' then
    return examination_room_v1.api_professor(
      p_operation, p_actor_user_id, p_institution_id, safe_payload
    );
  elsif p_scope = 'admin' then
    return examination_room_v1.api_admin(
      p_operation, p_actor_user_id, p_institution_id, safe_payload
    );
  else
    return examination_room_v1.api_student(p_operation, safe_payload);
  end if;
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
  'Service-only atomic Examination Room v1 dispatcher. Staff identity comes only from the verified worker; student scope derives institution from hashed room/session credentials.';

alter function public.examination_room_v1_api(text, text, uuid, uuid, jsonb) owner to postgres;
revoke all on function public.examination_room_v1_api(text, text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.examination_room_v1_api(text, text, uuid, uuid, jsonb) to service_role;

do $security$
declare
  table_name text;
begin
  for table_name in
    select c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'examination_room_v1'
      and c.relkind in ('r', 'p')
  loop
    execute format('alter table examination_room_v1.%I enable row level security', table_name);
    execute format('alter table examination_room_v1.%I force row level security', table_name);
    execute format('revoke all on table examination_room_v1.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table examination_room_v1.%I to service_role', table_name);
  end loop;
end;
$security$;

commit;

begin;

-- Result release is already atomic and idempotent. This durable outbox extends
-- the same guarantee to the optional student notification: a provider-accepted
-- message can never be sent again merely because the browser retries later.
create table examination_room_v1.result_email_delivery_events (
  release_id uuid primary key
    references examination_room_v1.result_releases(id) on delete restrict,
  institution_id uuid not null references examination_room_v1.institutions(id) on delete restrict,
  exam_id uuid not null,
  student_session_id uuid not null
    references examination_room_v1.student_sessions(id) on delete restrict,
  batch_request_hash text not null check (batch_request_hash ~ '^[0-9a-f]{64}$'),
  recipient_email text check (
    recipient_email is null
    or (
      recipient_email = lower(btrim(recipient_email))
      and position('@' in recipient_email) > 1
      and length(recipient_email) between 3 and 320
    )
  ),
  recipient_name text not null check (length(btrim(recipient_name)) between 1 and 240),
  exam_title text not null check (length(btrim(exam_title)) between 1 and 300),
  subject_name text not null check (length(btrim(subject_name)) between 1 and 200),
  total_score numeric(10,2) not null check (total_score >= 0),
  maximum_score numeric(10,2) not null check (maximum_score >= total_score),
  released_at timestamptz not null,
  delivery_status text not null
    check (delivery_status in ('pending', 'sent', 'suppressed', 'not_configured', 'failed', 'skipped')),
  provider_id text check (provider_id is null or length(provider_id) between 1 and 240),
  safe_error_code text check (safe_error_code is null or safe_error_code ~ '^[a-z0-9_]{2,80}$'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claim_token uuid,
  lease_expires_at timestamptz,
  attempted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint result_email_delivery_exam_scope_fk
    foreign key (exam_id, institution_id)
    references examination_room_v1.exams (id, institution_id)
    on delete restrict,
  constraint result_email_delivery_batch_release_unique
    unique (batch_request_hash, release_id),
  constraint result_email_delivery_claim_shape check (
    (delivery_status = 'pending' and claim_token is not null and lease_expires_at is not null)
    or (delivery_status <> 'pending' and claim_token is null and lease_expires_at is null)
  )
);

create index result_email_delivery_exam_time_idx
  on examination_room_v1.result_email_delivery_events (exam_id, released_at desc, release_id);

create index result_email_delivery_retry_idx
  on examination_room_v1.result_email_delivery_events (lease_expires_at, updated_at)
  where delivery_status in ('pending', 'failed', 'not_configured', 'suppressed');

comment on table examination_room_v1.result_email_delivery_events is
  'Durable, service-only per-student result-email outbox and provider evidence. Sent is terminal; failed or interrupted attempts can be claimed again without resending an already accepted result.';

alter table examination_room_v1.result_email_delivery_events enable row level security;
alter table examination_room_v1.result_email_delivery_events force row level security;
revoke all on table examination_room_v1.result_email_delivery_events from public, anon, authenticated, service_role;
grant select, insert, update, delete on table examination_room_v1.result_email_delivery_events to service_role;

create or replace function public.examination_room_v1_claim_result_email_deliveries(
  p_actor_user_id uuid,
  p_institution_id uuid,
  p_exam_id uuid,
  p_request_hash text,
  p_items jsonb,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  claim_id uuid := gen_random_uuid();
  lease_seconds integer := least(900, greatest(30, coalesce(p_lease_seconds, 300)));
  item jsonb;
  target_release_id uuid;
  target_session_id uuid;
  target_email text;
  target_name text;
  target_exam_title text;
  target_subject text;
  target_total numeric(10,2);
  target_maximum numeric(10,2);
  target_released_at timestamptz;
  existing examination_room_v1.result_email_delivery_events%rowtype;
  persisted examination_room_v1.result_email_delivery_events%rowtype;
  items_result jsonb := '[]'::jsonb;
  should_send boolean;
begin
  if p_actor_user_id is null
     or p_institution_id is null
     or p_exam_id is null
     or p_request_hash !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 1000 then
    return examination_room_v1.api_error(
      'RESULT_EMAIL_CLAIM_INVALID', 'The result-email delivery batch is invalid.', 400,
      'Refresh grading and release the selected results again.'
    );
  end if;

  if not exists (
    select 1
    from examination_room_v1.exams exam
    where exam.id = p_exam_id
      and exam.institution_id = p_institution_id
      and (
        exam.owner_user_id = p_actor_user_id
        or examination_room_v1.owner_authorized(p_actor_user_id)
        or exists (
          select 1
          from examination_room_v1.staff_memberships membership
          where membership.institution_id = p_institution_id
            and membership.user_id = p_actor_user_id
            and membership.staff_role = 'admin'
            and membership.membership_status = 'active'
        )
      )
  ) then
    return examination_room_v1.api_error(
      'RESULT_EMAIL_FORBIDDEN', 'Only the examination creator or an authorized administrator can notify students.', 403,
      'Open an examination owned by this account, then retry result release.'
    );
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(item) <> 'object'
       or coalesce(item ->> 'releaseId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return examination_room_v1.api_error(
        'RESULT_EMAIL_RELEASE_INVALID', 'A result-email entry does not identify a released result.', 409,
        'Refresh grading and release the selected results again.'
      );
    end if;
    target_release_id := (item ->> 'releaseId')::uuid;

    select
      session.id,
      lower(nullif(btrim(identity.email_normalized), '')),
      coalesce(nullif(btrim(identity.full_name), ''), 'Student'),
      exam.title,
      coalesce(nullif(btrim(version.publication_manifest ->> 'subject'), ''), 'Subject not specified'),
      grade.total_score,
      grade.maximum_score,
      release.occurred_at
    into
      target_session_id,
      target_email,
      target_name,
      target_exam_title,
      target_subject,
      target_total,
      target_maximum,
      target_released_at
    from examination_room_v1.result_releases release
    join examination_room_v1.grade_revisions grade on grade.id = release.grade_revision_id
    join examination_room_v1.submissions submission on submission.id = release.submission_id
    join examination_room_v1.student_sessions session on session.id = submission.session_id
    join examination_room_v1.exam_roster roster on roster.id = session.roster_id
    join examination_room_v1.student_identities identity on identity.id = roster.student_identity_id
    join examination_room_v1.exams exam on exam.id = session.exam_id
    join examination_room_v1.exam_versions version on version.id = submission.exam_version_id
    where release.id = target_release_id
      and release.release_action = 'release'
      and release.batch_request_hash = p_request_hash
      and session.exam_id = p_exam_id
      and session.institution_id = p_institution_id;

    if target_session_id is null then
      return examination_room_v1.api_error(
        'RESULT_EMAIL_RELEASE_NOT_FOUND', 'A selected result is no longer available for email delivery.', 409,
        'Refresh grading and retry only the currently released students.'
      );
    end if;

    select event.*
    into existing
    from examination_room_v1.result_email_delivery_events event
    where event.release_id = target_release_id
    for update;

    should_send := false;
    if target_email is null then
      insert into examination_room_v1.result_email_delivery_events (
        release_id, institution_id, exam_id, student_session_id, batch_request_hash,
        recipient_email, recipient_name, exam_title, subject_name, total_score,
        maximum_score, released_at, delivery_status, safe_error_code,
        attempt_count, completed_at, updated_at
      ) values (
        target_release_id, p_institution_id, p_exam_id, target_session_id, p_request_hash,
        null, target_name, target_exam_title, target_subject, target_total,
        target_maximum, target_released_at, 'skipped', 'recipient_missing',
        0, clock_timestamp(), clock_timestamp()
      ) on conflict (release_id) do update
        set delivery_status = case
              when result_email_delivery_events.delivery_status = 'sent' then 'sent'
              else 'skipped'
            end,
            safe_error_code = case
              when result_email_delivery_events.delivery_status = 'sent' then result_email_delivery_events.safe_error_code
              else 'recipient_missing'
            end,
            claim_token = null,
            lease_expires_at = null,
            completed_at = case
              when result_email_delivery_events.delivery_status = 'sent' then result_email_delivery_events.completed_at
              else clock_timestamp()
            end,
            updated_at = clock_timestamp()
      returning * into persisted;
    elsif existing.release_id is not null
          and existing.delivery_status = 'sent' then
      persisted := existing;
    elsif existing.release_id is not null
          and existing.delivery_status = 'pending'
          and existing.lease_expires_at > clock_timestamp() then
      persisted := existing;
    else
      insert into examination_room_v1.result_email_delivery_events (
        release_id, institution_id, exam_id, student_session_id, batch_request_hash,
        recipient_email, recipient_name, exam_title, subject_name, total_score,
        maximum_score, released_at, delivery_status, provider_id, safe_error_code,
        attempt_count, claim_token, lease_expires_at, attempted_at, completed_at, updated_at
      ) values (
        target_release_id, p_institution_id, p_exam_id, target_session_id, p_request_hash,
        target_email, target_name, target_exam_title, target_subject, target_total,
        target_maximum, target_released_at, 'pending', null, null,
        1, claim_id, clock_timestamp() + make_interval(secs => lease_seconds),
        clock_timestamp(), null, clock_timestamp()
      ) on conflict (release_id) do update
        set recipient_email = excluded.recipient_email,
            recipient_name = excluded.recipient_name,
            exam_title = excluded.exam_title,
            subject_name = excluded.subject_name,
            total_score = excluded.total_score,
            maximum_score = excluded.maximum_score,
            delivery_status = 'pending',
            provider_id = null,
            safe_error_code = null,
            attempt_count = result_email_delivery_events.attempt_count + 1,
            claim_token = claim_id,
            lease_expires_at = clock_timestamp() + make_interval(secs => lease_seconds),
            attempted_at = clock_timestamp(),
            completed_at = null,
            updated_at = clock_timestamp()
        where result_email_delivery_events.delivery_status <> 'sent'
          and (
            result_email_delivery_events.delivery_status <> 'pending'
            or result_email_delivery_events.lease_expires_at <= clock_timestamp()
          )
      returning * into persisted;
      if persisted.release_id is null then
        select event.* into persisted
        from examination_room_v1.result_email_delivery_events event
        where event.release_id = target_release_id;
      end if;
      should_send := persisted.delivery_status = 'pending' and persisted.claim_token = claim_id;
    end if;

    items_result := items_result || jsonb_build_array(jsonb_build_object(
      'releaseId', persisted.release_id,
      'sessionId', persisted.student_session_id,
      'recipient', persisted.recipient_email,
      'studentName', persisted.recipient_name,
      'examTitle', persisted.exam_title,
      'subject', persisted.subject_name,
      'totalScore', persisted.total_score,
      'maximumScore', persisted.maximum_score,
      'releasedAt', persisted.released_at,
      'status', persisted.delivery_status,
      'providerId', persisted.provider_id,
      'safeErrorCode', persisted.safe_error_code,
      'attemptCount', persisted.attempt_count,
      'shouldSend', should_send
    ));
    existing := null;
    persisted := null;
    target_session_id := null;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'claimToken', claim_id,
    'leaseSeconds', lease_seconds,
    'items', items_result
  );
end;
$$;

comment on function public.examination_room_v1_claim_result_email_deliveries(uuid,uuid,uuid,text,jsonb,integer) is
  'Service-role-only claim for a creator-authorized result-email batch. Returns canonical student delivery facts from released database rows and never reclaims a provider-accepted message.';

revoke all on function public.examination_room_v1_claim_result_email_deliveries(uuid,uuid,uuid,text,jsonb,integer) from public, anon, authenticated;
grant execute on function public.examination_room_v1_claim_result_email_deliveries(uuid,uuid,uuid,text,jsonb,integer) to service_role;

create or replace function public.examination_room_v1_complete_result_email_deliveries(
  p_claim_token uuid,
  p_outcomes jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  outcome jsonb;
  target_release_id uuid;
  target_status text;
  persisted examination_room_v1.result_email_delivery_events%rowtype;
  items_result jsonb := '[]'::jsonb;
begin
  if p_claim_token is null
     or jsonb_typeof(p_outcomes) <> 'array'
     or jsonb_array_length(p_outcomes) < 1
     or jsonb_array_length(p_outcomes) > 1000 then
    return examination_room_v1.api_error(
      'RESULT_EMAIL_COMPLETION_INVALID', 'The result-email completion batch is invalid.', 400,
      'Retry result release. Provider-accepted messages remain protected by their idempotency key.'
    );
  end if;

  for outcome in select value from jsonb_array_elements(p_outcomes)
  loop
    target_release_id := nullif(outcome ->> 'releaseId', '')::uuid;
    target_status := outcome ->> 'status';
    if target_release_id is null
       or target_status not in ('sent', 'suppressed', 'not_configured', 'failed') then
      return examination_room_v1.api_error(
        'RESULT_EMAIL_OUTCOME_INVALID', 'A result-email provider outcome is invalid.', 400,
        'Retry result release. Already accepted messages will not be sent again.'
      );
    end if;

    update examination_room_v1.result_email_delivery_events event
    set delivery_status = target_status,
        provider_id = case when target_status = 'sent' then nullif(outcome ->> 'providerId', '') else null end,
        safe_error_code = nullif(outcome ->> 'safeErrorCode', ''),
        claim_token = null,
        lease_expires_at = null,
        completed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where event.release_id = target_release_id
      and event.delivery_status = 'pending'
      and event.claim_token = p_claim_token
    returning event.* into persisted;

    if persisted.release_id is null then
      select event.* into persisted
      from examination_room_v1.result_email_delivery_events event
      where event.release_id = target_release_id;
    end if;
    if persisted.release_id is null then
      return examination_room_v1.api_error(
        'RESULT_EMAIL_OUTBOX_NOT_FOUND', 'The result-email outbox record could not be completed.', 409,
        'Retry result release. Already accepted messages remain protected by their idempotency key.'
      );
    end if;

    items_result := items_result || jsonb_build_array(jsonb_build_object(
      'releaseId', persisted.release_id,
      'sessionId', persisted.student_session_id,
      'recipient', persisted.recipient_email,
      'status', persisted.delivery_status,
      'providerId', persisted.provider_id,
      'safeErrorCode', persisted.safe_error_code,
      'attemptCount', persisted.attempt_count,
      'completedAt', persisted.completed_at
    ));
    persisted := null;
  end loop;

  return jsonb_build_object('ok', true, 'items', items_result);
end;
$$;

comment on function public.examination_room_v1_complete_result_email_deliveries(uuid,jsonb) is
  'Service-role-only terminal provider evidence for a claimed result-email batch. A sent row is never claimed again.';

revoke all on function public.examination_room_v1_complete_result_email_deliveries(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.examination_room_v1_complete_result_email_deliveries(uuid,jsonb) to service_role;

-- PostgreSQL records expose only the columns of the trigger's current table.
-- Keep the result-release-only batch field inside a result-release branch so
-- final grade inserts can enqueue recovery snapshots without resolving a
-- nonexistent grade_revisions.batch_request_hash field.
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
  if tg_table_name = 'result_releases' then
    if new.batch_request_hash ~ '^[0-9a-f]{64}$' then
      record_count := greatest(record_count, release_batch_count);
    end if;
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

-- Preserve the established owner bundle contract and add the new per-student
-- delivery evidence without duplicating the large, audited base function.
alter function examination_room_v1.owner_exam_bundle(uuid)
  rename to owner_exam_bundle_before_result_email;

create or replace function examination_room_v1.owner_exam_bundle(p_exam_id uuid)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  bundle jsonb;
begin
  bundle := examination_room_v1.owner_exam_bundle_before_result_email(p_exam_id);
  return jsonb_set(
    bundle,
    '{tables,resultEmailDeliveryEvents}',
    examination_room_v1.json_rows((
      select jsonb_agg(to_jsonb(event) order by event.released_at, event.release_id)
      from examination_room_v1.result_email_delivery_events event
      where event.exam_id = p_exam_id
    )),
    true
  );
end;
$$;

comment on function examination_room_v1.owner_exam_bundle(uuid) is
  'Complete Founder/Super Admin examination bundle including exact per-student result-email provider outcomes.';

revoke all on function examination_room_v1.owner_exam_bundle_before_result_email(uuid) from public, anon, authenticated, service_role;
revoke all on function examination_room_v1.owner_exam_bundle(uuid) from public, anon, authenticated, service_role;

commit;

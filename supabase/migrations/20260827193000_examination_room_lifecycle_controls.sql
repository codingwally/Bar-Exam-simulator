begin;

alter table examination_room_v1.exams
  add column if not exists blocked_at timestamptz,
  add column if not exists blocked_by_user_id uuid,
  add column if not exists block_reason text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_user_id uuid,
  add column if not exists delete_reason text,
  add column if not exists lifecycle_prior_status text;

alter table examination_room_v1.exams
  drop constraint if exists exams_block_state_check,
  add constraint exams_block_state_check check (
    (blocked_at is null and blocked_by_user_id is null and block_reason is null)
    or (blocked_at is not null and blocked_by_user_id is not null and nullif(btrim(block_reason), '') is not null)
  ),
  drop constraint if exists exams_delete_state_check,
  add constraint exams_delete_state_check check (
    (deleted_at is null and deleted_by_user_id is null and delete_reason is null)
    or (deleted_at is not null and deleted_by_user_id is not null and nullif(btrim(delete_reason), '') is not null)
  ),
  drop constraint if exists exams_lifecycle_prior_status_check,
  add constraint exams_lifecycle_prior_status_check check (
    lifecycle_prior_status is null
    or lifecycle_prior_status in ('draft', 'published', 'closed', 'archived')
  );

create index if not exists exams_owner_active_lifecycle_idx
  on examination_room_v1.exams (owner_user_id, updated_at desc)
  where deleted_at is null;

create index if not exists exams_admin_lifecycle_idx
  on examination_room_v1.exams (institution_id, deleted_at, blocked_at, updated_at desc);

comment on column examination_room_v1.exams.deleted_at is
  'Recoverable creator/Admin removal marker. Examination evidence is retained; Admin can restore the complete record.';
comment on column examination_room_v1.exams.blocked_at is
  'Owner admission block. New keyed admission is denied while existing answers and evidence remain preserved.';

create or replace function public.examination_room_v1_lifecycle_query(
  p_actor_user_id uuid,
  p_institution_id uuid default null,
  p_exam_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  actor_is_owner boolean := examination_room_v1.owner_authorized(p_actor_user_id);
begin
  if p_actor_user_id is null then
    return examination_room_v1.api_error(
      'SIGN_IN_REQUIRED', 'Sign in before opening examination records.', 401,
      'Sign in through Due Diligence, then reopen Examination Room.'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'examId', exam.id,
        'institutionId', exam.institution_id,
        'status', exam.status,
        'blocked', exam.blocked_at is not null,
        'blockedAt', exam.blocked_at,
        'blockedByUserId', exam.blocked_by_user_id,
        'blockReason', exam.block_reason,
        'deleted', exam.deleted_at is not null,
        'deletedAt', exam.deleted_at,
        'deletedByUserId', exam.deleted_by_user_id,
        'deleteReason', exam.delete_reason,
        'priorStatus', exam.lifecycle_prior_status,
        'canRestore', actor_is_owner and exam.deleted_at is not null,
        'needsNewKey', exam.current_published_version_id is not null
          and not exists (
            select 1
            from examination_room_v1.room_activations activation
            where activation.exam_id = exam.id
              and activation.activation_status in ('scheduled', 'open')
          ),
        'updatedAt', exam.updated_at
      ) order by exam.updated_at desc)
      from examination_room_v1.exams exam
      where (p_institution_id is null or exam.institution_id = p_institution_id)
        and (p_exam_id is null or exam.id = p_exam_id)
        and (actor_is_owner or exam.owner_user_id = p_actor_user_id)
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.examination_room_v1_lifecycle_query(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.examination_room_v1_lifecycle_query(uuid, uuid, uuid)
  to service_role;

create or replace function public.examination_room_v1_lifecycle_guard(p_exam_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select case
    when exam.id is null then examination_room_v1.api_error(
      'EXAM_NOT_FOUND', 'That examination is no longer available.', 404,
      'Ask the examination creator or administrator for the current room key.'
    )
    when exam.deleted_at is not null then examination_room_v1.api_error(
      'EXAMINATION_ARCHIVED', 'This examination is not accepting new students.', 409,
      'Ask the examination creator or administrator to restore the room or provide another key.'
    )
    when exam.blocked_at is not null then examination_room_v1.api_error(
      'EXAMINATION_BLOCKED', 'This examination is temporarily blocked by the administrator.', 409,
      'Wait for the administrator to reopen admission, then enter the same key again.'
    )
    else jsonb_build_object('ok', true, 'examId', exam.id)
  end
  from (select p_exam_id as requested_id) requested
  left join examination_room_v1.exams exam on exam.id = requested.requested_id;
$$;

revoke all on function public.examination_room_v1_lifecycle_guard(uuid)
  from public, anon, authenticated;
grant execute on function public.examination_room_v1_lifecycle_guard(uuid)
  to service_role;

create or replace function public.examination_room_v1_lifecycle_command(
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
  actor_is_owner boolean := examination_room_v1.owner_authorized(p_actor_user_id);
  exam_record examination_room_v1.exams%rowtype;
  replay jsonb;
  response jsonb;
  event_type text := 'lifecycle.' || coalesce(p_operation, 'unknown');
  reason text;
begin
  if p_actor_user_id is null or p_institution_id is null or p_exam_id is null
     or jsonb_typeof(safe_payload) <> 'object' then
    return examination_room_v1.api_error(
      'INVALID_REQUEST', 'The examination lifecycle request is incomplete.', 400,
      'Refresh Examination Room and repeat the action.'
    );
  end if;
  if request_hash is null or request_hash !~ '^[0-9a-f]{64}$' then
    return examination_room_v1.api_error(
      'REQUEST_HASH_INVALID', 'The command fingerprint is missing or invalid.', 400,
      'Refresh the page so a new secure request can be created.'
    );
  end if;
  if p_operation not in (
    'archive_exam', 'delete_draft', 'restore_exam',
    'block_exam', 'unblock_exam', 'reopen_exam'
  ) then
    return examination_room_v1.api_error(
      'UNKNOWN_OPERATION', 'That examination lifecycle action is not available.', 400,
      'Refresh Examination Room and choose a listed action.'
    );
  end if;

  perform examination_room_v1.lock_request(p_institution_id, request_hash);
  replay := examination_room_v1.api_replay(p_institution_id, request_hash, event_type);
  if replay is not null then return replay; end if;

  select exam.* into exam_record
  from examination_room_v1.exams exam
  where exam.id = p_exam_id
    and exam.institution_id = p_institution_id
  for update;
  if exam_record.id is null then
    return examination_room_v1.api_error(
      'EXAM_NOT_FOUND', 'That examination no longer exists in this workspace.', 404,
      'Refresh the examination list and choose an available record.'
    );
  end if;
  if not actor_is_owner and exam_record.owner_user_id <> p_actor_user_id then
    return examination_room_v1.api_error(
      'FORBIDDEN', 'Only the examination creator or platform owner can change this record.', 403,
      'Choose an examination created by this account.'
    );
  end if;
  if p_operation in ('restore_exam', 'block_exam', 'unblock_exam', 'reopen_exam')
     and not actor_is_owner then
    return examination_room_v1.api_error(
      'PLATFORM_OWNER_REQUIRED', 'Only a Founder or Super Admin can perform this recovery action.', 403,
      'Ask the platform owner to use the Examination Room command center.'
    );
  end if;

  if p_operation = 'delete_draft' then
    if exam_record.status <> 'draft' or exam_record.current_published_version_id is not null then
      return examination_room_v1.api_error(
        'DRAFT_DELETE_STATE_INVALID', 'Only an unpublished draft can be deleted from the creator workspace.', 409,
        'Archive a published examination instead.'
      );
    end if;
    reason := coalesce(nullif(btrim(safe_payload ->> 'reason'), ''), 'Creator deleted an unpublished draft.');
    update examination_room_v1.exams exam
    set deleted_at = coalesce(exam.deleted_at, event_time),
        deleted_by_user_id = coalesce(exam.deleted_by_user_id, p_actor_user_id),
        delete_reason = coalesce(exam.delete_reason, reason),
        lifecycle_prior_status = coalesce(exam.lifecycle_prior_status, 'draft')
    where exam.id = p_exam_id;
    response := jsonb_build_object(
      'ok', true, 'examId', p_exam_id, 'deleted', true,
      'recoverable', true, 'status', 'draft', 'deletedAt', event_time
    );
  elsif p_operation = 'archive_exam' then
    reason := coalesce(nullif(btrim(safe_payload ->> 'reason'), ''), 'Creator archived the examination.');
    update examination_room_v1.room_activations activation
    set activation_status = 'closed',
        deactivated_at = coalesce(activation.deactivated_at, event_time),
        deactivated_by_user_id = coalesce(activation.deactivated_by_user_id, p_actor_user_id),
        deactivation_reason = coalesce(activation.deactivation_reason, reason)
    where activation.exam_id = p_exam_id
      and activation.institution_id = p_institution_id
      and activation.activation_status in ('scheduled', 'open');
    update examination_room_v1.student_sessions session
    set session_status = 'expired', ended_at = coalesce(session.ended_at, event_time)
    where session.exam_id = p_exam_id
      and session.institution_id = p_institution_id
      and session.session_status in ('created', 'active');
    update examination_room_v1.exams exam
    set lifecycle_prior_status = coalesce(exam.lifecycle_prior_status, exam.status),
        status = case when exam.current_published_version_id is null then 'draft' else 'archived' end,
        archived_at = case when exam.current_published_version_id is null then exam.archived_at else coalesce(exam.archived_at, event_time) end,
        deleted_at = coalesce(exam.deleted_at, event_time),
        deleted_by_user_id = coalesce(exam.deleted_by_user_id, p_actor_user_id),
        delete_reason = coalesce(exam.delete_reason, reason)
    where exam.id = p_exam_id;
    response := jsonb_build_object(
      'ok', true, 'examId', p_exam_id, 'archived', true,
      'recoverable', true, 'status', case when exam_record.current_published_version_id is null then 'draft' else 'archived' end,
      'archivedAt', event_time
    );
  elsif p_operation = 'restore_exam' then
    if exam_record.deleted_at is null then
      response := jsonb_build_object(
        'ok', true, 'examId', p_exam_id, 'restored', true,
        'duplicate', true, 'status', exam_record.status,
        'needsNewKey', exam_record.current_published_version_id is not null
      );
    else
      update examination_room_v1.exams exam
      set deleted_at = null,
          deleted_by_user_id = null,
          delete_reason = null,
          status = case when exam.current_published_version_id is null then 'draft' else 'closed' end,
          closed_at = case when exam.current_published_version_id is null then null else coalesce(exam.closed_at, event_time) end,
          archived_at = null,
          lifecycle_prior_status = null
      where exam.id = p_exam_id;
      response := jsonb_build_object(
        'ok', true, 'examId', p_exam_id, 'restored', true,
        'status', case when exam_record.current_published_version_id is null then 'draft' else 'closed' end,
        'needsNewKey', exam_record.current_published_version_id is not null
      );
    end if;
  elsif p_operation = 'block_exam' then
    reason := coalesce(nullif(btrim(safe_payload ->> 'reason'), ''), 'Platform owner temporarily blocked new admission.');
    update examination_room_v1.exams exam
    set blocked_at = coalesce(exam.blocked_at, event_time),
        blocked_by_user_id = coalesce(exam.blocked_by_user_id, p_actor_user_id),
        block_reason = coalesce(exam.block_reason, reason)
    where exam.id = p_exam_id;
    response := jsonb_build_object(
      'ok', true, 'examId', p_exam_id, 'blocked', true,
      'blockReason', reason, 'existingAnswersPreserved', true
    );
  elsif p_operation = 'unblock_exam' then
    update examination_room_v1.exams exam
    set blocked_at = null, blocked_by_user_id = null, block_reason = null
    where exam.id = p_exam_id;
    response := jsonb_build_object('ok', true, 'examId', p_exam_id, 'blocked', false);
  else
    if exam_record.current_published_version_id is null then
      return examination_room_v1.api_error(
        'PUBLICATION_REQUIRED', 'Publish this examination before reopening it.', 409,
        'Open the creator workspace, review the draft, then publish and request a key.'
      );
    end if;
    update examination_room_v1.exams exam
    set deleted_at = null,
        deleted_by_user_id = null,
        delete_reason = null,
        blocked_at = null,
        blocked_by_user_id = null,
        block_reason = null,
        status = 'published',
        closed_at = null,
        archived_at = null,
        lifecycle_prior_status = null
    where exam.id = p_exam_id;
    response := jsonb_build_object(
      'ok', true, 'examId', p_exam_id, 'reopened', true,
      'status', 'published', 'needsNewKey', true,
      'nextAction', 'issue_and_email_key'
    );
  end if;

  perform examination_room_v1.api_record_audit(
    p_institution_id, p_exam_id, null, p_actor_user_id,
    case when actor_is_owner then 'admin' else 'professor' end,
    event_type, 'exam', p_exam_id, request_hash, event_time, response, null
  );
  return response;
exception
  when invalid_text_representation or datetime_field_overflow then
    return examination_room_v1.api_error(
      'INVALID_REQUEST', 'One or more lifecycle values are invalid.', 400,
      'Refresh the examination and repeat the action.'
    );
  when unique_violation then
    return examination_room_v1.api_error(
      'PERSISTENCE_CONFLICT', 'A newer lifecycle action completed first.', 409,
      'Refresh the examination and review its current state.'
    );
end;
$$;

revoke all on function public.examination_room_v1_lifecycle_command(text, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.examination_room_v1_lifecycle_command(text, uuid, uuid, uuid, jsonb)
  to service_role;

commit;

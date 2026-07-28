-- Phase 4 Release 3: timer provenance, unanswered expirations, and user history.
-- Apply after 20260730_006_phase4_exam_reliability.sql.

begin;

alter table public.exam_attempts
  drop constraint if exists exam_attempts_answer_text_check;
alter table public.exam_attempts
  add constraint exam_attempts_answer_text_check
  check (char_length(answer_text) between 0 and 12000);

alter table public.exam_attempts
  drop constraint if exists exam_attempts_status_check;
alter table public.exam_attempts
  add constraint exam_attempts_status_check
  check (status in (
    'pending', 'grading', 'capacity', 'completed', 'failed', 'cancelled', 'unanswered'
  ));

alter table public.exam_attempts
  add column if not exists timer_mode text,
  add column if not exists elapsed_seconds integer,
  add column if not exists submission_reason text,
  add column if not exists expired boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.exam_attempts'::regclass
      and conname = 'exam_attempts_timer_mode_check'
  ) then
    alter table public.exam_attempts
      add constraint exam_attempts_timer_mode_check
      check (timer_mode is null or timer_mode in ('strict', 'selfPaced', 'none'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.exam_attempts'::regclass
      and conname = 'exam_attempts_elapsed_seconds_check'
  ) then
    alter table public.exam_attempts
      add constraint exam_attempts_elapsed_seconds_check
      check (elapsed_seconds is null or elapsed_seconds between 0 and 86400);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.exam_attempts'::regclass
      and conname = 'exam_attempts_submission_reason_check'
  ) then
    alter table public.exam_attempts
      add constraint exam_attempts_submission_reason_check
      check (submission_reason is null or submission_reason in ('manual', 'strict_expiry'));
  end if;
end
$$;

create or replace function public.phase4_prepare_exam_attempt_v2(
  p_user_id uuid,
  p_reservation_id uuid,
  p_request_key text,
  p_question_bank_id text,
  p_subject text,
  p_answer_text text,
  p_timer_mode text,
  p_elapsed_seconds integer,
  p_submission_reason text,
  p_expired boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.exam_attempts%rowtype;
begin
  if char_length(p_answer_text) not between 1 and 12000 then
    raise exception 'Invalid answer length';
  end if;
  if p_timer_mode not in ('strict', 'selfPaced', 'none')
     or p_elapsed_seconds not between 0 and 86400
     or p_submission_reason not in ('manual', 'strict_expiry') then
    raise exception 'Invalid timer provenance';
  end if;
  if p_submission_reason = 'strict_expiry'
     and (p_timer_mode <> 'strict' or not p_expired) then
    raise exception 'Invalid expiration provenance';
  end if;
  if not exists (
    select 1 from public.grade_reservations
    where id = p_reservation_id
      and user_id = p_user_id
      and request_key = p_request_key
      and question_bank_id = btrim(p_question_bank_id)
      and status = 'reserved'
  ) then
    raise exception 'Active grade reservation not found';
  end if;

  insert into public.exam_attempts (
    user_id, reservation_id, request_key, question_bank_id, subject,
    answer_text, status, timer_mode, elapsed_seconds, submission_reason,
    expired, submitted_at, updated_at
  )
  values (
    p_user_id, p_reservation_id, p_request_key, btrim(p_question_bank_id),
    btrim(p_subject), p_answer_text, 'grading', p_timer_mode,
    p_elapsed_seconds, p_submission_reason, p_expired, now(), now()
  )
  on conflict (request_key) do update
  set reservation_id = excluded.reservation_id,
      status = 'grading',
      safe_error_code = null,
      timer_mode = excluded.timer_mode,
      elapsed_seconds = excluded.elapsed_seconds,
      submission_reason = excluded.submission_reason,
      expired = excluded.expired,
      updated_at = now()
  where public.exam_attempts.user_id = excluded.user_id
    and public.exam_attempts.question_bank_id = excluded.question_bank_id
    and public.exam_attempts.answer_text = excluded.answer_text
  returning * into v_attempt;

  if v_attempt.id is null then raise exception 'Exam attempt replay conflict'; end if;
  update public.grade_reservations
  set exam_attempt_id = v_attempt.id
  where id = p_reservation_id;
  return jsonb_build_object('attemptId', v_attempt.id, 'status', v_attempt.status);
end;
$$;

create or replace function public.phase4_record_unanswered_attempt(
  p_user_id uuid,
  p_request_key text,
  p_question_bank_id text,
  p_subject text,
  p_elapsed_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.exam_attempts%rowtype;
  v_existing_id uuid;
begin
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
     or char_length(btrim(coalesce(p_question_bank_id, ''))) not between 3 and 100
     or char_length(btrim(coalesce(p_subject, ''))) not between 2 and 100
     or p_elapsed_seconds not between 720 and 86400 then
    raise exception 'Invalid unanswered attempt';
  end if;

  select id into v_existing_id
  from public.exam_attempts
  where request_key = p_request_key;

  insert into public.exam_attempts (
    user_id, request_key, question_bank_id, subject, answer_text, status,
    timer_mode, elapsed_seconds, submission_reason, expired,
    submitted_at, completed_at, updated_at
  )
  values (
    p_user_id, p_request_key, btrim(p_question_bank_id), btrim(p_subject),
    '', 'unanswered', 'strict', p_elapsed_seconds, 'strict_expiry', true,
    now(), now(), now()
  )
  on conflict (request_key) do update
  set updated_at = public.exam_attempts.updated_at
  where public.exam_attempts.user_id = excluded.user_id
    and public.exam_attempts.question_bank_id = excluded.question_bank_id
    and public.exam_attempts.status = 'unanswered'
  returning * into v_attempt;

  if v_attempt.id is null then raise exception 'Unanswered attempt replay conflict'; end if;
  return jsonb_build_object(
    'attemptId', v_attempt.id,
    'status', v_attempt.status,
    'replayed', v_existing_id is not null
  );
end;
$$;

create or replace function public.phase4_exam_history(
  p_user_id uuid,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
begin
  return jsonb_build_object(
    'items',
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'questionId', a.question_bank_id,
        'subject', a.subject,
        'answerText', a.answer_text,
        'status', a.status,
        'score', a.score,
        'assessment', a.assessment,
        'timerMode', a.timer_mode,
        'elapsedSeconds', a.elapsed_seconds,
        'submissionReason', a.submission_reason,
        'expired', a.expired,
        'submittedAt', a.submitted_at,
        'completedAt', a.completed_at
      ) order by a.submitted_at desc)
      from (
        select *
        from public.exam_attempts
        where user_id = p_user_id
        order by submitted_at desc
        limit v_limit offset v_offset
      ) a
    ), '[]'::jsonb),
    'limit', v_limit,
    'offset', v_offset
  );
end;
$$;

revoke all on function public.phase4_prepare_exam_attempt_v2(
  uuid, uuid, text, text, text, text, text, integer, text, boolean
) from public, anon, authenticated;
revoke all on function public.phase4_record_unanswered_attempt(
  uuid, text, text, text, integer
) from public, anon, authenticated;
revoke all on function public.phase4_exam_history(uuid, integer, integer)
  from public, anon, authenticated;

grant execute on function public.phase4_prepare_exam_attempt_v2(
  uuid, uuid, text, text, text, text, text, integer, text, boolean
) to service_role;
grant execute on function public.phase4_record_unanswered_attempt(
  uuid, text, text, text, integer
) to service_role;
grant execute on function public.phase4_exam_history(uuid, integer, integer)
  to service_role;

commit;

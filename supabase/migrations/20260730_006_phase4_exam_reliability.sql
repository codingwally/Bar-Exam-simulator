-- Phase 4 Release 2: private exam-attempt persistence and provider reliability.
-- Apply after 20260730_005_phase4_access_subscriptions.sql.

begin;

create table if not exists public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reservation_id uuid unique references public.grade_reservations(id) on delete set null,
  request_key text not null unique
    check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  question_bank_id text not null
    check (char_length(btrim(question_bank_id)) between 3 and 100),
  subject text not null check (char_length(btrim(subject)) between 2 and 100),
  answer_text text not null check (char_length(answer_text) between 1 and 12000),
  status text not null default 'pending'
    check (status in ('pending', 'grading', 'capacity', 'completed', 'failed', 'cancelled')),
  score numeric(2,1) check (score is null or (score >= 0 and score <= 5)),
  assessment jsonb,
  provider_model text,
  safe_error_code text,
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists exam_attempts_user_submitted_idx
  on public.exam_attempts (user_id, submitted_at desc);
create index if not exists exam_attempts_status_updated_idx
  on public.exam_attempts (status, updated_at desc);

create table if not exists public.provider_incidents (
  id uuid primary key default gen_random_uuid(),
  incident_key text not null unique
    check (incident_key ~ '^[a-z0-9_:-]{3,100}$'),
  category text not null check (category in ('capacity', 'rate_limit', 'timeout', 'unavailable')),
  status text not null default 'open' check (status in ('open', 'resolved', 'cleared')),
  safe_message text not null check (char_length(btrim(safe_message)) between 5 and 500),
  occurrences bigint not null default 1 check (occurrences > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  cleared_at timestamptz,
  cleared_by uuid references auth.users(id),
  clear_reason text,
  metadata jsonb not null default '{}'::jsonb,
  constraint provider_incidents_metadata_safe_check check (
    not public.jsonb_has_forbidden_keys(
      metadata,
      array[
        'answer', 'answer_text', 'student_answer', 'prompt', 'email',
        'raw_ip', 'ip', 'token', 'access_token', 'refresh_token',
        'api_key', 'authorization', 'cookie', 'password', 'secret'
      ]::text[]
    )
  )
);

create index if not exists provider_incidents_status_last_seen_idx
  on public.provider_incidents (status, last_seen_at desc);

alter table public.exam_attempts enable row level security;
alter table public.provider_incidents enable row level security;

revoke all on public.exam_attempts from public, anon, authenticated;
revoke all on public.provider_incidents from public, anon, authenticated;
grant select, insert, update, delete on public.exam_attempts to service_role;
grant select, insert, update, delete on public.provider_incidents to service_role;
grant select on public.exam_attempts to authenticated;

drop policy if exists exam_attempts_select_own on public.exam_attempts;
create policy exam_attempts_select_own
  on public.exam_attempts
  for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.phase4_reserve_grade_v2(
  p_user_id uuid,
  p_request_key text,
  p_question_bank_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_access jsonb;
  v_existing public.grade_reservations%rowtype;
  v_reservation_id uuid;
  v_used integer := 0;
  v_active_reservations integer := 0;
  v_basis text;
begin
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Invalid grading request key';
  end if;
  if char_length(btrim(coalesce(p_question_bank_id, ''))) not between 3 and 100 then
    raise exception 'Invalid question identifier';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 401));

  select * into v_existing
  from public.grade_reservations
  where request_key = p_request_key
  for update;

  if v_existing.id is not null then
    if v_existing.user_id <> p_user_id
       or v_existing.question_bank_id <> btrim(p_question_bank_id) then
      raise exception 'Grading request key conflict';
    end if;
    if v_existing.status = 'reserved' then
      return jsonb_build_object(
        'allowed', false, 'reason', 'duplicate_active',
        'reservationId', v_existing.id, 'replayed', true
      );
    end if;
    if v_existing.status = 'completed' then
      return jsonb_build_object(
        'allowed', false, 'reason', 'duplicate_completed',
        'reservationId', v_existing.id, 'replayed', true
      );
    end if;
    if v_existing.status in ('released', 'expired')
       and coalesce(v_existing.release_reason, '') not in (
         'provider_capacity', 'provider_rate_limit', 'provider_timeout', 'provider_unavailable'
       ) then
      return jsonb_build_object(
        'allowed', false, 'reason', 'duplicate_closed',
        'reservationId', v_existing.id, 'replayed', true
      );
    end if;
  end if;

  update public.grade_reservations
  set status = 'expired',
      released_at = now(),
      release_reason = 'reservation_timeout'
  where user_id = p_user_id
    and status = 'reserved'
    and reservation_expires_at <= now();

  v_access := public.phase4_access_snapshot(p_user_id, false, null);
  if not coalesce((v_access->>'allowed')::boolean, false) then
    return v_access || jsonb_build_object('reservationId', null, 'replayed', false);
  end if;
  v_basis := v_access->>'basis';

  insert into public.lifetime_grade_usage (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
  select successful_grades into v_used
  from public.lifetime_grade_usage
  where user_id = p_user_id
  for update;

  if v_basis = 'lifetime_free' then
    select count(*) into v_active_reservations
    from public.grade_reservations
    where user_id = p_user_id
      and status = 'reserved'
      and reservation_expires_at > now();
    if v_used + v_active_reservations >= 3 then
      return jsonb_build_object(
        'allowed', false,
        'basis', 'locked',
        'reason', 'lifetime_free_grades_exhausted',
        'termsRequired', false,
        'freeGrades', jsonb_build_object(
          'limit', 3,
          'used', v_used,
          'remaining', greatest(0, 3 - v_used)
        )
      );
    end if;
  end if;

  if v_existing.id is not null
     and v_existing.status in ('released', 'expired')
     and v_existing.release_reason in (
       'provider_capacity', 'provider_rate_limit', 'provider_timeout', 'provider_unavailable'
     ) then
    update public.grade_reservations
    set status = 'reserved',
        access_basis = v_basis,
        reserved_at = now(),
        reservation_expires_at = now() + interval '20 minutes',
        completed_at = null,
        released_at = null,
        release_reason = null
    where id = v_existing.id
    returning id into v_reservation_id;
  else
    insert into public.grade_reservations (
      user_id, request_key, question_bank_id, access_basis
    )
    values (
      p_user_id, p_request_key, btrim(p_question_bank_id), v_basis
    )
    returning id into v_reservation_id;
  end if;

  return v_access || jsonb_build_object(
    'reservationId', v_reservation_id,
    'status', 'reserved',
    'accessBasis', v_basis,
    'replayed', v_existing.id is not null
  );
end;
$$;

create or replace function public.phase4_prepare_exam_attempt(
  p_user_id uuid,
  p_reservation_id uuid,
  p_request_key text,
  p_question_bank_id text,
  p_subject text,
  p_answer_text text
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
    answer_text, status, submitted_at, updated_at
  )
  values (
    p_user_id, p_reservation_id, p_request_key, btrim(p_question_bank_id),
    btrim(p_subject), p_answer_text, 'grading', now(), now()
  )
  on conflict (request_key) do update
  set reservation_id = excluded.reservation_id,
      status = 'grading',
      safe_error_code = null,
      updated_at = now()
  where public.exam_attempts.user_id = excluded.user_id
    and public.exam_attempts.question_bank_id = excluded.question_bank_id
    and public.exam_attempts.answer_text = excluded.answer_text
  returning * into v_attempt;

  if v_attempt.id is null then
    raise exception 'Exam attempt replay conflict';
  end if;
  update public.grade_reservations
  set exam_attempt_id = v_attempt.id
  where id = p_reservation_id;
  return jsonb_build_object(
    'attemptId', v_attempt.id,
    'status', v_attempt.status
  );
end;
$$;

alter table public.grade_reservations
  add column if not exists exam_attempt_id uuid
    references public.exam_attempts(id) on delete set null;
create unique index if not exists grade_reservations_exam_attempt_uidx
  on public.grade_reservations (exam_attempt_id)
  where exam_attempt_id is not null;

create or replace function public.phase4_mark_exam_capacity(
  p_user_id uuid,
  p_attempt_id uuid,
  p_category text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_category text := case
    when p_category in ('capacity', 'rate_limit', 'timeout', 'unavailable') then p_category
    else 'unavailable'
  end;
  v_code text := 'ai_grading_' || v_category;
begin
  update public.exam_attempts
  set status = 'capacity',
      safe_error_code = v_code,
      updated_at = now()
  where id = p_attempt_id
    and user_id = p_user_id
    and status in ('pending', 'grading', 'capacity');
  if not found then raise exception 'Exam attempt not found'; end if;

  insert into public.provider_incidents (
    incident_key, category, status, safe_message, occurrences,
    first_seen_at, last_seen_at, metadata
  )
  values (
    v_code, v_category, 'open',
    'AI grading is temporarily at capacity.', 1, now(), now(),
    jsonb_build_object('service', 'exam_grading')
  )
  on conflict (incident_key) do update
  set category = excluded.category,
      status = 'open',
      safe_message = excluded.safe_message,
      occurrences = public.provider_incidents.occurrences + 1,
      last_seen_at = now(),
      resolved_at = null;
end;
$$;

create or replace function public.phase4_complete_exam_attempt(
  p_user_id uuid,
  p_attempt_id uuid,
  p_score numeric,
  p_assessment jsonb,
  p_provider_model text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_score < 0 or p_score > 5 or round(p_score, 1) <> p_score then
    raise exception 'Invalid score';
  end if;
  update public.exam_attempts
  set status = 'completed',
      score = p_score,
      assessment = p_assessment,
      provider_model = left(nullif(btrim(p_provider_model), ''), 100),
      safe_error_code = null,
      completed_at = now(),
      updated_at = now()
  where id = p_attempt_id
    and user_id = p_user_id
    and status in ('grading', 'capacity');
  if not found then raise exception 'Exam attempt not found'; end if;

  update public.provider_incidents
  set status = 'resolved',
      resolved_at = now(),
      last_seen_at = now()
  where status = 'open'
    and category in ('capacity', 'rate_limit', 'timeout', 'unavailable');
end;
$$;

create or replace function public.phase4_fail_exam_attempt(
  p_user_id uuid,
  p_attempt_id uuid,
  p_safe_error_code text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.exam_attempts
  set status = 'failed',
      safe_error_code = left(
        regexp_replace(lower(coalesce(p_safe_error_code, 'grading_failed')), '[^a-z0-9_:-]', '', 'g'),
        100
      ),
      updated_at = now()
  where id = p_attempt_id
    and user_id = p_user_id
    and status in ('pending', 'grading');
end;
$$;

create or replace function public.phase4_finalize_exam_grade(
  p_user_id uuid,
  p_reservation_id uuid,
  p_attempt_id uuid,
  p_score numeric,
  p_assessment jsonb,
  p_provider_model text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usage jsonb;
begin
  perform public.phase4_complete_exam_attempt(
    p_user_id,
    p_attempt_id,
    p_score,
    p_assessment,
    p_provider_model
  );
  v_usage := public.phase4_finalize_grade(p_user_id, p_reservation_id);
  return v_usage;
end;
$$;

revoke all on function public.phase4_reserve_grade_v2(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.phase4_prepare_exam_attempt(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.phase4_mark_exam_capacity(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.phase4_complete_exam_attempt(uuid, uuid, numeric, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.phase4_fail_exam_attempt(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.phase4_finalize_exam_grade(uuid, uuid, uuid, numeric, jsonb, text)
  from public, anon, authenticated;

grant execute on function public.phase4_reserve_grade_v2(uuid, text, text) to service_role;
grant execute on function public.phase4_prepare_exam_attempt(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.phase4_mark_exam_capacity(uuid, uuid, text) to service_role;
grant execute on function public.phase4_complete_exam_attempt(uuid, uuid, numeric, jsonb, text) to service_role;
grant execute on function public.phase4_fail_exam_attempt(uuid, uuid, text) to service_role;
grant execute on function public.phase4_finalize_exam_grade(uuid, uuid, uuid, numeric, jsonb, text)
  to service_role;

commit;

-- Per-user removal of completed Examination Room entries.
--
-- This intentionally does not delete an examination, attempt, answer, grade,
-- receipt, publication, or audit record. It records only that an authorized
-- participant no longer wants a completed examination shown in their own
-- Past Exams view.

begin;

create table if not exists public.exam_room_user_exam_dismissals (
  user_id uuid not null references auth.users(id) on delete cascade,
  exam_id uuid not null references public.exam_room_exams(id) on delete cascade,
  dismissed_as text not null check (dismissed_as in ('professor', 'beadle', 'student')),
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  dismissed_at timestamptz not null default now(),
  primary key (user_id, exam_id),
  unique (user_id, request_key)
);

create index if not exists exam_room_user_exam_dismissals_exam_idx
  on public.exam_room_user_exam_dismissals (exam_id, dismissed_at desc);

alter table public.exam_room_user_exam_dismissals enable row level security;
alter table public.exam_room_user_exam_dismissals force row level security;

revoke all privileges on table public.exam_room_user_exam_dismissals
  from public, anon, authenticated;
grant select, insert, update, delete on table public.exam_room_user_exam_dismissals
  to service_role;

create or replace function public.exam_room_dismissed_past_exam_ids_v1(
  p_user_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'ok', true,
    'examIds', coalesce(
      jsonb_agg(e.public_id order by d.dismissed_at desc),
      '[]'::jsonb
    )
  )
  from public.exam_room_user_exam_dismissals d
  join public.exam_room_exams e on e.id = d.exam_id
  where d.user_id = p_user_id
    and exists (select 1 from auth.users u where u.id = p_user_id);
$$;

create or replace function public.exam_room_dismiss_past_exam_v1(
  p_user_id uuid,
  p_exam_public_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_user_email text;
  v_scope text;
  v_attempt_status text;
  v_is_past boolean := false;
  v_dismissed_at timestamptz;
begin
  if p_request_key is null
    or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
  then
    raise exception 'EXAM_ROOM_REQUEST_KEY_INVALID';
  end if;

  select lower(u.email) into v_user_email
  from auth.users u
  where u.id = p_user_id;
  if v_user_email is null then
    raise exception 'EXAM_ROOM_AUTH_REQUIRED';
  end if;

  select e.* into v_exam
  from public.exam_room_exams e
  where e.public_id = p_exam_public_id;
  if not found then
    raise exception 'EXAM_ROOM_EXAM_NOT_FOUND';
  end if;

  if v_exam.owner_professor_id = p_user_id then
    v_scope := 'professor';
  elsif exists (
    select 1
    from public.exam_room_beadle_assignments b
    where b.exam_id = v_exam.id
      and b.beadle_user_id = p_user_id
      and b.status = 'active'
  ) then
    v_scope := 'beadle';
  elsif exists (
    select 1
    from public.exam_room_attempts a
    where a.exam_id = v_exam.id
      and a.student_user_id = p_user_id
  ) or exists (
    select 1
    from public.exam_room_roster r
    where r.classroom_id = v_exam.classroom_id
      and r.status = 'active'
      and (r.student_user_id = p_user_id or r.canonical_email = v_user_email)
  ) then
    v_scope := 'student';
  else
    raise exception 'EXAM_ROOM_PAST_EXAM_ACCESS_REQUIRED';
  end if;

  select a.status into v_attempt_status
  from public.exam_room_attempts a
  where a.exam_id = v_exam.id
    and a.student_user_id = p_user_id;

  v_is_past := v_exam.status in ('closed', 'grading', 'sealed')
    or (v_exam.hard_closes_at is not null and v_exam.hard_closes_at <= now())
    or (
      v_scope = 'student'
      and coalesce(v_attempt_status in ('submitted', 'auto_submitted', 'sealed'), false)
    );

  if not v_is_past then
    raise exception 'EXAM_ROOM_PAST_EXAM_REQUIRED';
  end if;

  insert into public.exam_room_user_exam_dismissals (
    user_id,
    exam_id,
    dismissed_as,
    request_key
  ) values (
    p_user_id,
    v_exam.id,
    v_scope,
    p_request_key
  )
  on conflict (user_id, exam_id) do nothing;

  select d.dismissed_at into v_dismissed_at
  from public.exam_room_user_exam_dismissals d
  where d.user_id = p_user_id
    and d.exam_id = v_exam.id;

  return jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'removedFromPastExams', true,
    'scope', v_scope,
    'removedAt', v_dismissed_at
  );
end;
$$;

revoke all on function public.exam_room_dismissed_past_exam_ids_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.exam_room_dismissed_past_exam_ids_v1(uuid)
  to service_role;

revoke all on function public.exam_room_dismiss_past_exam_v1(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.exam_room_dismiss_past_exam_v1(uuid, uuid, text)
  to service_role;

commit;

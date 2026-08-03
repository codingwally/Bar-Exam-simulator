-- DueDiligence 2026: Worker-only delivery context for the Examination Room
-- Google backup outbox and feature-flag-controlled processors.

begin;

create or replace function public.dd2026_service_flag_enabled(p_flag_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select enabled
    from public.dd2026_feature_flags
    where flag_key = p_flag_key
  ), false);
$$;

create or replace function public.exam_room_backup_context(p_exam_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_context jsonb;
begin
  select jsonb_build_object(
    'examId', e.id,
    'examPublicId', e.public_id,
    'title', e.title,
    'status', e.status,
    'schoolName', c.school_name,
    'academicTerm', c.academic_term,
    'professorUserId', e.owner_professor_id,
    'professorEmail', lower(u.email),
    'googleSheetId', e.google_sheet_id,
    'professorAccessRemovedAt', e.google_professor_access_removed_at,
    'opensAt', e.opens_at,
    'hardClosesAt', e.hard_closes_at,
    'durationMinutes', e.duration_minutes,
    'questionCount', e.requested_question_count,
    'includeQuestionnaire', e.include_questionnaire
  ) into v_context
  from public.exam_room_exams e
  join public.exam_room_classrooms c on c.id = e.classroom_id
  join auth.users u on u.id = e.owner_professor_id
  where e.id = p_exam_id;

  if v_context is null then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  return v_context;
end;
$$;

revoke all on function public.dd2026_service_flag_enabled(text)
  from public, anon, authenticated;
revoke all on function public.exam_room_backup_context(uuid)
  from public, anon, authenticated;
grant execute on function public.dd2026_service_flag_enabled(text) to service_role;
grant execute on function public.exam_room_backup_context(uuid) to service_role;

commit;

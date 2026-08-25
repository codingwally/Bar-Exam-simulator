-- Keep Examination Room provisioning behind the same active Professor registry
-- that authorizes the Professor workspace. The Worker supplies the authenticated
-- user id; this function remains service-role only.
begin;

create or replace function public.exam_room_submit_request(
  p_user_id uuid,
  p_professor_name text,
  p_school_name text,
  p_course_subject text,
  p_examination_title text,
  p_examination_date date,
  p_start_time time without time zone,
  p_time_zone text,
  p_expected_duration_minutes integer,
  p_estimated_student_count integer,
  p_examination_type text,
  p_beadle_name text,
  p_beadle_email text,
  p_quotation_recipient text,
  p_notes text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_beadle_email text := nullif(lower(btrim(coalesce(p_beadle_email, ''))), '');
  v_request public.exam_room_requests%rowtype;
  v_created boolean := false;
begin
  perform public.exam_room_require_professor(p_user_id);
  v_email := public.exam_room_request_actor_email(p_user_id);
  if v_email is null then raise exception 'EXAM_ROOM_AUTH_REQUIRED'; end if;
  if p_request_key is null or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
    or char_length(btrim(coalesce(p_professor_name, ''))) not between 2 and 200
    or char_length(btrim(coalesce(p_school_name, ''))) not between 2 and 300
    or char_length(btrim(coalesce(p_course_subject, ''))) not between 2 and 200
    or char_length(btrim(coalesce(p_examination_title, ''))) not between 2 and 200
    or p_examination_date is null
    or p_examination_date < current_date
    or p_examination_date > current_date + 730
    or p_start_time is null
    or char_length(btrim(coalesce(p_time_zone, ''))) not between 3 and 80
    or p_expected_duration_minutes not between 15 and 480
    or p_estimated_student_count not between 1 and 500
    or p_examination_type <> 'essay'
    or p_quotation_recipient not in ('professor', 'beadle')
    or char_length(coalesce(p_notes, '')) > 3000
    or (
      p_quotation_recipient = 'beadle'
      and (
        char_length(btrim(coalesce(p_beadle_name, ''))) not between 2 and 200
        or v_beadle_email is null
        or v_beadle_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
      )
    )
  then raise exception 'EXAM_ROOM_REQUEST_INVALID'; end if;

  insert into public.exam_room_requests (
    professor_user_id, professor_name, professor_email, school_name,
    course_subject, examination_title, examination_date, start_time,
    time_zone, expected_duration_minutes, estimated_student_count,
    examination_type, beadle_name, beadle_email, quotation_recipient,
    notes, request_key
  ) values (
    p_user_id, btrim(p_professor_name), v_email, btrim(p_school_name),
    btrim(p_course_subject), btrim(p_examination_title), p_examination_date,
    p_start_time, btrim(p_time_zone), p_expected_duration_minutes,
    p_estimated_student_count, p_examination_type,
    nullif(btrim(coalesce(p_beadle_name, '')), ''), v_beadle_email,
    p_quotation_recipient, coalesce(p_notes, ''), p_request_key
  )
  on conflict (professor_user_id, request_key) do nothing
  returning * into v_request;

  if found then
    v_created := true;
  else
    select * into v_request
    from public.exam_room_requests r
    where r.professor_user_id = p_user_id
      and r.request_key = p_request_key;
    if not found
      or v_request.professor_name <> btrim(p_professor_name)
      or v_request.school_name <> btrim(p_school_name)
      or v_request.course_subject <> btrim(p_course_subject)
      or v_request.examination_title <> btrim(p_examination_title)
      or v_request.examination_date <> p_examination_date
      or v_request.start_time <> p_start_time
      or v_request.time_zone <> btrim(p_time_zone)
      or v_request.expected_duration_minutes <> p_expected_duration_minutes
      or v_request.estimated_student_count <> p_estimated_student_count
      or v_request.examination_type <> p_examination_type
      or v_request.beadle_name is distinct from nullif(btrim(coalesce(p_beadle_name, '')), '')
      or v_request.beadle_email is distinct from v_beadle_email
      or v_request.quotation_recipient <> p_quotation_recipient
      or v_request.notes <> coalesce(p_notes, '')
    then raise exception 'EXAM_ROOM_REQUEST_IDEMPOTENCY_CONFLICT'; end if;
  end if;

  if v_created then
    insert into public.exam_room_audit_log (actor_user_id, action, metadata)
    values (
      p_user_id, 'room_request_submitted',
      jsonb_build_object('requestId', v_request.public_id, 'examinationType', v_request.examination_type)
    );
  end if;
  return jsonb_build_object(
    'ok', true, 'requestId', v_request.public_id,
    'status', v_request.status, 'createdAt', v_request.created_at,
    'replayed', not v_created
  );
end;
$$;

revoke all on function public.exam_room_submit_request(
  uuid, text, text, text, text, date, time without time zone, text,
  integer, integer, text, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.exam_room_submit_request(
  uuid, text, text, text, text, date, time without time zone, text,
  integer, integer, text, text, text, text, text, text
) to service_role;

commit;

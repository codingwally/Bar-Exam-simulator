begin;

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise exception 'Supabase Storage is unavailable; refusing to configure Examination Room submission PDFs';
  end if;
end;
$$;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) values (
  'examination-room-submissions',
  'examination-room-submissions',
  false,
  10485760,
  array['application/pdf']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.examination_room_v1_submission_delivery_context(
  p_session_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'ok', true,
    'institutionId', ss.institution_id,
    'examId', ss.exam_id,
    'sessionId', ss.id,
    'submissionId', sub.id,
    'receiptCode', receipt.receipt_code,
    'submittedAt', sub.received_at,
    'professorName', coalesce(
      nullif(btrim(owner_membership.display_name), ''),
      nullif(btrim(owner_user.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(owner_user.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(lower(owner_user.email), '@', 1), ''),
      'Professor'
    ),
    'professorEmail', coalesce(owner_membership.email_normalized, lower(owner_user.email)),
    'studentName', si.full_name,
    'studentNumber', coalesce(nullif(er.accommodations ->> 'enteredStudentNumber', ''), si.external_student_id),
    'studentEmail', si.email_normalized,
    'subject', er.accommodations ->> 'subject',
    'yearLevel', er.accommodations ->> 'yearLevel',
    'submissionManifest', sub.submission_manifest
  )
  from examination_room_v1.student_sessions ss
  join examination_room_v1.submissions sub on sub.session_id = ss.id
  join examination_room_v1.exams e on e.id = ss.exam_id
  join examination_room_v1.exam_roster er on er.id = ss.roster_id
  join examination_room_v1.student_identities si on si.id = er.student_identity_id
  left join auth.users owner_user on owner_user.id = e.owner_user_id
  left join lateral (
    select m.display_name, m.email_normalized
    from examination_room_v1.staff_memberships m
    where m.institution_id = e.institution_id
      and m.user_id = e.owner_user_id
      and m.membership_status = 'active'
    order by (m.staff_role = 'professor') desc, m.granted_at desc
    limit 1
  ) owner_membership on true
  left join lateral (
    select r.receipt_code
    from examination_room_v1.submission_receipts r
    where r.submission_id = sub.id
    order by r.issued_at desc
    limit 1
  ) receipt on true
  where ss.id = p_session_id
    and sub.submission_status = 'accepted'
  limit 1
$function$;

create or replace function public.examination_room_v1_professor_submission_artifact_context(
  p_actor_user_id uuid,
  p_institution_id uuid,
  p_exam_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'ok', true,
    'institutionId', ss.institution_id,
    'examId', ss.exam_id,
    'sessionId', ss.id,
    'submissionId', sub.id,
    'receiptCode', receipt.receipt_code,
    'submittedAt', sub.received_at,
    'professorName', coalesce(
      nullif(btrim(owner_membership.display_name), ''),
      nullif(btrim(owner_user.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(owner_user.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(lower(owner_user.email), '@', 1), ''),
      'Professor'
    ),
    'professorEmail', coalesce(owner_membership.email_normalized, lower(owner_user.email)),
    'studentName', si.full_name,
    'studentNumber', coalesce(nullif(er.accommodations ->> 'enteredStudentNumber', ''), si.external_student_id),
    'studentEmail', si.email_normalized,
    'subject', er.accommodations ->> 'subject',
    'yearLevel', er.accommodations ->> 'yearLevel',
    'submissionManifest', sub.submission_manifest
  )
  into result
  from examination_room_v1.student_sessions ss
  join examination_room_v1.submissions sub on sub.session_id = ss.id
  join examination_room_v1.exams e on e.id = ss.exam_id
  join examination_room_v1.exam_roster er on er.id = ss.roster_id
  join examination_room_v1.student_identities si on si.id = er.student_identity_id
  left join auth.users owner_user on owner_user.id = e.owner_user_id
  left join lateral (
    select m.display_name, m.email_normalized
    from examination_room_v1.staff_memberships m
    where m.institution_id = e.institution_id
      and m.user_id = e.owner_user_id
      and m.membership_status = 'active'
    order by (m.staff_role = 'professor') desc, m.granted_at desc
    limit 1
  ) owner_membership on true
  left join lateral (
    select r.receipt_code
    from examination_room_v1.submission_receipts r
    where r.submission_id = sub.id
    order by r.issued_at desc
    limit 1
  ) receipt on true
  where ss.institution_id = p_institution_id
    and ss.exam_id = p_exam_id
    and sub.submission_status = 'accepted'
    and (
      (not e.anonymous_grading and ss.id = p_session_id)
      or (
        e.anonymous_grading
        and examination_room_v1.uuid_from_hash(sub.idempotency_key_hash) = p_session_id
      )
    )
    and (
      e.owner_user_id = p_actor_user_id
      or examination_room_v1.owner_authorized(p_actor_user_id)
    )
  limit 1;

  if result is null then
    return examination_room_v1.api_error(
      'SUBMISSION_NOT_FOUND',
      'The submitted examination PDF is not available for this professor and examination.',
      404,
      'Refresh grading and choose a submitted student.'
    );
  end if;

  return result;
end
$function$;

revoke all on function public.examination_room_v1_submission_delivery_context(uuid)
  from public, anon, authenticated;
revoke all on function public.examination_room_v1_professor_submission_artifact_context(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.examination_room_v1_submission_delivery_context(uuid)
  to service_role;
grant execute on function public.examination_room_v1_professor_submission_artifact_context(uuid, uuid, uuid, uuid)
  to service_role;

commit;

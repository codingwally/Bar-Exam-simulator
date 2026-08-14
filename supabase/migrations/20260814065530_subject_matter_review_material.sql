-- Subject Matter review material is intentionally separated from the general
-- examination payload. The Worker calls this service-role-only function only
-- after authenticating the browser user. The function independently verifies
-- attempt ownership, the current entitlement, the Subject Matter track, and
-- exact content-revision integrity before returning a narrow allowlisted shape.

create or replace function public.subject_matter_review_material(
  p_user_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version_id uuid;
  v_attempt_status text;
  v_track text;
  v_assessment_kind text;
  v_question_count integer;
  v_question_id uuid;
  v_legal_basis text;
  v_why_this_applies text;
  v_sources jsonb;
begin
  perform public.examination_authorize_access(
    p_user_id,
    'per_subject',
    null,
    p_attempt_id,
    false
  );

  select
    attempt.version_id,
    attempt.status,
    definition.track,
    definition.assessment_kind
  into
    v_version_id,
    v_attempt_status,
    v_track,
    v_assessment_kind
  from public.examination_attempts_multi attempt
  join public.examination_versions version on version.id = attempt.version_id
  join public.examination_definitions definition on definition.id = version.exam_id
  where attempt.id = p_attempt_id
    and attempt.user_id = p_user_id;

  if v_version_id is null
     or v_track <> 'per_subject'
     or v_assessment_kind <> 'quiz'
     or v_attempt_status not in ('in_progress', 'submitted', 'expired')
  then
    raise exception 'EXAM_SUBJECT_REVIEW_MATERIAL_UNAVAILABLE';
  end if;

  select count(*)
  into v_question_count
  from public.examination_version_questions version_question
  where version_question.version_id = v_version_id;

  if v_question_count <> 1 then
    raise exception 'EXAM_SUBJECT_REVIEW_MATERIAL_UNAVAILABLE';
  end if;

  select
    version_question.question_id,
    nullif(btrim(version_question.legal_basis_snapshot), ''),
    nullif(btrim(question.doctrine), ''),
    version_question.source_urls_snapshot
  into
    v_question_id,
    v_legal_basis,
    v_why_this_applies,
    v_sources
  from public.examination_version_questions version_question
  join public.examination_questions question
    on question.id = version_question.question_id
   and question.content_hash = version_question.snapshot_hash
  where version_question.version_id = v_version_id
    and question.publication_ready is true
    and lower(question.review_status) in ('approved', 'owner_override');

  if v_question_id is null
     or v_legal_basis is null
     or v_why_this_applies is null
     or jsonb_typeof(v_sources) <> 'array'
     or jsonb_array_length(v_sources) < 1
     or jsonb_array_length(v_sources) > 12
     or exists (
       select 1
       from jsonb_array_elements_text(v_sources) as source(url)
       where source.url !~ '^https://'
          or char_length(source.url) > 2048
     )
  then
    raise exception 'EXAM_SUBJECT_REVIEW_MATERIAL_UNAVAILABLE';
  end if;

  return jsonb_build_object(
    'status', 'available',
    'attemptId', p_attempt_id,
    'questionId', v_question_id,
    'legalBasis', v_legal_basis,
    'whyThisApplies', v_why_this_applies,
    'sources', v_sources
  );
end;
$$;

revoke all on function public.subject_matter_review_material(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.subject_matter_review_material(uuid, uuid)
  to service_role;

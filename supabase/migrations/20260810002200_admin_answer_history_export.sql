-- Founder-only, audited answer-history export across every persisted answer store.
-- This is an additive administrator data layer. It does not change questions,
-- model answers, grading, AI model, entitlements, or learner-facing behavior.

begin;

create index if not exists exam_attempts_answer_history_export_idx
  on public.exam_attempts (submitted_at desc, user_id)
  where nullif(btrim(answer_text), '') is not null;
create index if not exists examination_responses_answer_history_export_idx
  on public.examination_responses (saved_at desc, attempt_id)
  where nullif(btrim(answer_text), '') is not null;

create or replace function public.admin_export_answer_history(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total bigint := 0;
  v_items jsonb := '[]'::jsonb;
  v_scope text := case
    when p_target_user_id is null then 'all_users'
    else 'single_user'
  end;
  v_date_scope text := case
    when p_from is null and p_to is null then 'all_time'
    else 'bounded_range'
  end;
  v_request_fingerprint text;
  v_existing_fingerprint text;
begin
  perform public.phase4_require_founder(p_actor_user_id);

  if p_target_user_id is not null
     and not exists (
       select 1
       from auth.users u
       where u.id = p_target_user_id
     ) then
    raise exception 'Target user not found';
  end if;
  if (p_from is null) <> (p_to is null) then
    raise exception 'Both export dates must be supplied or both omitted';
  end if;
  if p_from is not null
     and (p_from >= p_to or p_to - p_from > interval '366 days') then
    raise exception 'Valid export window of at most 366 days required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'Valid export row limit required';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000 then
    raise exception 'Export reason must be 5 to 1000 characters';
  end if;
  if coalesce(p_request_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid export request key required';
  end if;

  v_request_fingerprint := encode(extensions.digest(
    jsonb_build_object(
      'targetUserId', p_target_user_id,
      'from', p_from,
      'to', p_to,
      'limit', p_limit,
      'reason', btrim(p_reason)
    )::text,
    'sha256'
  ), 'hex');

  with response_rows as (
    select
      'practice'::text as record_source,
      a.user_id,
      case when coalesce(u.is_anonymous, false) then null
        else u.email end::text as user_email,
      case
        when coalesce(u.is_anonymous, false)
          then 'anonymous_no_registered_email'
        when nullif(btrim(coalesce(u.email, '')), '') is null
          then 'not_available'
        else 'available'
      end::text as email_status,
      a.id as attempt_id,
      a.question_bank_id::text as question_id,
      null::text as question_text,
      'external_question_bank_not_persisted'::text as question_text_source,
      'unavailable_exact_historic_text'::text as question_text_status,
      a.answer_text as submitted_answer,
      'available'::text as answer_status,
      a.score,
      case
        when a.score is not null
             or (a.assessment is not null and a.assessment <> '{}'::jsonb)
          then 'ai'
        else 'ungraded'
      end::text as grade_source,
      a.score as ai_score,
      null::numeric as human_score,
      nullif(concat_ws(
        E'\n\n',
        nullif(a.assessment->>'rationale', ''),
        nullif(a.assessment->>'legalExplanation', '')
      ), '')::text as feedback_text,
      a.assessment as ai_feedback,
      null::text as human_feedback,
      case when a.assessment is null then 'not_persisted'
        when a.assessment = '{}'::jsonb then 'present_but_empty'
        else 'ai_assessment_available' end::text
        as feedback_status,
      null::text as suggested_answer,
      'external_question_bank_not_persisted'::text as suggested_answer_source,
      'not_persisted_with_practice_attempt'::text as suggested_answer_status,
      case
        when a.assessment ? 'modelAnswerALAC'
             and a.assessment->'modelAnswerALAC' <> 'null'::jsonb
             and case jsonb_typeof(a.assessment->'modelAnswerALAC')
               when 'string' then nullif(btrim(a.assessment->>'modelAnswerALAC'), '') is not null
               when 'object' then a.assessment->'modelAnswerALAC' <> '{}'::jsonb
               when 'array' then a.assessment->'modelAnswerALAC' <> '[]'::jsonb
               else true
             end
          then case jsonb_typeof(a.assessment->'modelAnswerALAC')
            when 'string' then a.assessment->>'modelAnswerALAC'
            else (a.assessment->'modelAnswerALAC')::text
          end
        else null
      end::text as model_answer,
      case
        when a.assessment ? 'modelAnswerALAC'
             and a.assessment->'modelAnswerALAC' <> 'null'::jsonb
             and case jsonb_typeof(a.assessment->'modelAnswerALAC')
               when 'string' then nullif(btrim(a.assessment->>'modelAnswerALAC'), '') is not null
               when 'object' then a.assessment->'modelAnswerALAC' <> '{}'::jsonb
               when 'array' then a.assessment->'modelAnswerALAC' <> '[]'::jsonb
               else true
             end
          then 'persisted_ai_assessment_model_answer_alac'
        else null
      end::text as model_answer_source,
      case
        when a.assessment ? 'modelAnswerALAC'
             and a.assessment->'modelAnswerALAC' <> 'null'::jsonb
             and case jsonb_typeof(a.assessment->'modelAnswerALAC')
               when 'string' then nullif(btrim(a.assessment->>'modelAnswerALAC'), '') is not null
               when 'object' then a.assessment->'modelAnswerALAC' <> '{}'::jsonb
               when 'array' then a.assessment->'modelAnswerALAC' <> '[]'::jsonb
               else true
             end
          then 'available_generated_assessment'
        else 'not_persisted'
      end::text as model_answer_status,
      a.subject::text as subject,
      'Mock Bar'::text as exam_title,
      'mock_bar'::text as exam_track,
      'single_question'::text as assessment_kind,
      null::text as exam_version_label,
      null::integer as exam_version_number,
      null::integer as question_ordinal,
      null::text as topic,
      null::integer as bar_year,
      null::text as question_number,
      null::text as difficulty,
      a.status::text as attempt_status,
      a.timer_mode::text as timer_mode,
      a.elapsed_seconds::integer as elapsed_seconds,
      null::boolean as flagged,
      null::integer as revision,
      null::text as human_review_status,
      a.provider_model::text as provider_or_grader_model,
      a.safe_error_code::text as safe_error_code,
      null::timestamptz as started_at,
      a.submitted_at as answer_saved_at,
      a.submitted_at,
      case when a.score is not null
             or (a.assessment is not null and a.assessment <> '{}'::jsonb)
        then a.completed_at else null end::timestamptz as graded_at,
      a.completed_at
    from public.exam_attempts a
    join auth.users u on u.id = a.user_id
    where nullif(btrim(a.answer_text), '') is not null
      and (p_from is null or a.submitted_at >= p_from)
      and (p_to is null or a.submitted_at < p_to)
      and (p_target_user_id is null or a.user_id = p_target_user_id)

    union all

    select
      'formal_exam'::text,
      a.user_id,
      case when coalesce(u.is_anonymous, false) then null
        else u.email end::text,
      case
        when coalesce(u.is_anonymous, false)
          then 'anonymous_no_registered_email'
        when nullif(btrim(coalesce(u.email, '')), '') is null
          then 'not_available'
        else 'available'
      end::text,
      a.id,
      coalesce(nullif(q.source_key, ''), q.id::text)::text,
      vq.prompt_snapshot::text,
      'immutable_exam_snapshot'::text,
      'available_exact_attempt_snapshot'::text,
      r.answer_text,
      'available'::text,
      case
        when hr.finalized_at is not null then hr.score
        else aa.score
      end::numeric,
      case
        when hr.finalized_at is not null and aa.id is not null then 'human_and_ai'
        when hr.finalized_at is not null then 'human'
        when aa.id is not null then 'ai'
        when hr.assignment_id is not null then 'human_draft'
        else 'ungraded'
      end::text,
      aa.score::numeric,
      hr.score::numeric,
      coalesce(
        case when nullif(btrim(hr.comments), '') is null then null
          else hr.comments end,
        nullif(concat_ws(
          E'\n\n',
          nullif(aa.assessment_json->>'rationale', ''),
          nullif(aa.assessment_json->>'legalExplanation', '')
        ), '')
      )::text,
      aa.assessment_json,
      case when nullif(btrim(hr.comments), '') is null then null
        else hr.comments end::text,
      case
        when aa.id is not null and aa.assessment_json <> '{}'::jsonb
             and nullif(btrim(coalesce(hr.comments, '')), '') is not null
          then 'ai_and_human_feedback_available'
        when nullif(btrim(coalesce(hr.comments, '')), '') is not null
          then 'human_feedback_available'
        when aa.id is not null and aa.assessment_json <> '{}'::jsonb
          then 'ai_assessment_available'
        when aa.id is not null or hr.assignment_id is not null
          then 'present_but_empty'
        else 'not_persisted'
      end::text,
      case when nullif(btrim(vq.model_answer_snapshot), '') is null then null
        else vq.model_answer_snapshot end::text,
      case when nullif(btrim(vq.model_answer_snapshot), '') is null then null
        else 'immutable_exam_snapshot' end::text,
      case when vq.model_answer_snapshot is null then 'not_persisted'
        when nullif(btrim(vq.model_answer_snapshot), '') is null then 'present_but_empty'
        else 'available_exact_attempt_snapshot' end::text,
      case
        when aa.assessment_json ? 'modelAnswerALAC'
             and aa.assessment_json->'modelAnswerALAC' <> 'null'::jsonb
             and case jsonb_typeof(aa.assessment_json->'modelAnswerALAC')
               when 'string' then nullif(btrim(aa.assessment_json->>'modelAnswerALAC'), '') is not null
               when 'object' then aa.assessment_json->'modelAnswerALAC' <> '{}'::jsonb
               when 'array' then aa.assessment_json->'modelAnswerALAC' <> '[]'::jsonb
               else true
             end
          then case jsonb_typeof(aa.assessment_json->'modelAnswerALAC')
            when 'string' then aa.assessment_json->>'modelAnswerALAC'
            else (aa.assessment_json->'modelAnswerALAC')::text
          end
        else null
      end::text,
      case
        when aa.assessment_json ? 'modelAnswerALAC'
             and aa.assessment_json->'modelAnswerALAC' <> 'null'::jsonb
             and case jsonb_typeof(aa.assessment_json->'modelAnswerALAC')
               when 'string' then nullif(btrim(aa.assessment_json->>'modelAnswerALAC'), '') is not null
               when 'object' then aa.assessment_json->'modelAnswerALAC' <> '{}'::jsonb
               when 'array' then aa.assessment_json->'modelAnswerALAC' <> '[]'::jsonb
               else true
             end
          then 'persisted_ai_assessment_model_answer_alac'
        else null
      end::text,
      case
        when aa.assessment_json ? 'modelAnswerALAC'
             and aa.assessment_json->'modelAnswerALAC' <> 'null'::jsonb
             and case jsonb_typeof(aa.assessment_json->'modelAnswerALAC')
               when 'string' then nullif(btrim(aa.assessment_json->>'modelAnswerALAC'), '') is not null
               when 'object' then aa.assessment_json->'modelAnswerALAC' <> '{}'::jsonb
               when 'array' then aa.assessment_json->'modelAnswerALAC' <> '[]'::jsonb
               else true
             end
          then 'available_generated_assessment'
        else 'not_persisted'
      end::text,
      coalesce(d.subject, q.subject)::text,
      d.title::text,
      d.track::text,
      d.assessment_kind::text,
      v.label::text,
      v.version_number::integer,
      vq.ordinal::integer,
      q.topic::text,
      q.bar_year::integer,
      q.question_number::text,
      q.difficulty::text,
      a.status::text,
      a.timer_mode::text,
      a.elapsed_seconds::integer,
      r.flagged::boolean,
      r.revision::integer,
      hr.assignment_status::text,
      aa.grader_model::text,
      gj.safe_error_code::text,
      a.started_at,
      r.saved_at,
      a.submitted_at,
      greatest(aa.finalized_at, hr.finalized_at),
      null::timestamptz
    from public.examination_responses r
    join public.examination_attempts_multi a on a.id = r.attempt_id
    join auth.users u on u.id = a.user_id
    join public.examination_versions v on v.id = a.version_id
    join public.examination_definitions d on d.id = v.exam_id
    join public.examination_version_questions vq
      on vq.version_id = a.version_id
     and vq.question_id = r.question_id
    join public.examination_questions q on q.id = r.question_id
    left join public.examination_ai_assessments aa
      on aa.attempt_id = a.id
     and aa.question_id = r.question_id
    left join lateral (
      select
        ea.id as assignment_id,
        ea.status as assignment_status,
        er.score,
        er.comments,
        er.saved_at,
        er.finalized_at
      from public.examination_examiner_assignments ea
      join public.examination_examiner_reviews er
        on er.assignment_id = ea.id
       and er.question_id = r.question_id
      where ea.attempt_id = a.id
      order by
        (er.finalized_at is not null) desc,
        er.finalized_at desc nulls last,
        er.saved_at desc,
        ea.created_at desc
      limit 1
    ) hr on true
    left join lateral (
      select j.safe_error_code
      from public.examination_grading_jobs j
      where j.attempt_id = a.id
        and j.route = 'ai'
      order by j.completed_at desc nulls last, j.created_at desc
      limit 1
    ) gj on true
    where nullif(btrim(r.answer_text), '') is not null
      and (p_from is null or r.saved_at >= p_from)
      and (p_to is null or r.saved_at < p_to)
      and (p_target_user_id is null or a.user_id = p_target_user_id)
  ), ordered_rows as (
    select
      rr.*,
      count(*) over () as total_count,
      row_number() over (
        order by rr.answer_saved_at desc, rr.record_source,
                 rr.attempt_id, rr.question_id
      ) as row_number
    from response_rows rr
  )
  select
    coalesce(max(o.total_count), 0),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'recordSource', o.record_source,
          'userId', o.user_id,
          'userEmail', o.user_email,
          'emailStatus', o.email_status,
          'attemptId', o.attempt_id,
          'questionId', o.question_id,
          'questionText', o.question_text,
          'questionTextSource', o.question_text_source,
          'questionTextStatus', o.question_text_status,
          'submittedAnswer', o.submitted_answer,
          'answerStatus', o.answer_status,
          'score', o.score,
          'gradeSource', o.grade_source,
          'aiScore', o.ai_score,
          'humanScore', o.human_score,
          'feedbackText', o.feedback_text,
          'aiFeedback', o.ai_feedback,
          'humanFeedback', o.human_feedback,
          'feedbackStatus', o.feedback_status,
          'suggestedAnswer', o.suggested_answer,
          'suggestedAnswerSource', o.suggested_answer_source,
          'suggestedAnswerStatus', o.suggested_answer_status,
          'modelAnswer', o.model_answer,
          'modelAnswerSource', o.model_answer_source,
          'modelAnswerStatus', o.model_answer_status,
          'subject', o.subject,
          'examTitle', o.exam_title,
          'examTrack', o.exam_track,
          'assessmentKind', o.assessment_kind,
          'examVersionLabel', o.exam_version_label,
          'examVersionNumber', o.exam_version_number,
          'questionOrdinal', o.question_ordinal,
          'topic', o.topic,
          'barYear', o.bar_year,
          'questionNumber', o.question_number,
          'difficulty', o.difficulty,
          'attemptStatus', o.attempt_status,
          'timerMode', o.timer_mode,
          'elapsedSeconds', o.elapsed_seconds,
          'flagged', o.flagged,
          'revision', o.revision,
          'humanReviewStatus', o.human_review_status,
          'providerOrGraderModel', o.provider_or_grader_model,
          'safeErrorCode', o.safe_error_code,
          'startedAt', o.started_at,
          'answerSavedAt', o.answer_saved_at,
          'submittedAt', o.submitted_at,
          'gradedAt', o.graded_at,
          'completedAt', o.completed_at
        ) order by o.row_number
      ) filter (where o.row_number <= p_limit),
      '[]'::jsonb
    )
  into v_total, v_items
  from ordered_rows o;

  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 1822));
  select a.details->>'requestFingerprint'
    into v_existing_fingerprint
    from public.admin_audit_log a
    where a.actor_user_id = p_actor_user_id
      and a.action_type = 'sensitive_data_viewed'
      and a.target_resource_type = 'answer_history_export'
      and a.details->>'requestKey' = p_request_key;

  if found and v_existing_fingerprint is distinct from v_request_fingerprint then
    raise exception 'Export request key conflict';
  end if;

  if not found then
    insert into public.admin_audit_log (
      actor_user_id,
      action_type,
      target_user_id,
      target_resource_type,
      target_resource_id,
      reason,
      details
    ) values (
      p_actor_user_id,
      'sensitive_data_viewed',
      p_target_user_id,
      'answer_history_export',
      coalesce(p_target_user_id::text, 'all_users'),
      btrim(p_reason),
      jsonb_build_object(
        'requestKey', p_request_key,
        'scope', v_scope,
        'dateScope', v_date_scope,
        'from', p_from,
        'to', p_to,
        'resultCount', v_total,
        'tooMany', v_total > p_limit,
        'requestFingerprint', v_request_fingerprint
      )
    );
  end if;

  if v_total > p_limit then
    return jsonb_build_object(
      'items', '[]'::jsonb,
      'total', v_total,
      'tooMany', true,
      'scope', v_scope,
      'dateScope', v_date_scope
    );
  end if;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'tooMany', false,
    'scope', v_scope,
    'dateScope', v_date_scope
  );
end;
$$;

revoke all on function public.admin_export_answer_history(
  uuid, uuid, timestamptz, timestamptz, integer, text, text
) from public, anon, authenticated;
grant execute on function public.admin_export_answer_history(
  uuid, uuid, timestamptz, timestamptz, integer, text, text
) to service_role;

comment on function public.admin_export_answer_history(
  uuid, uuid, timestamptz, timestamptz, integer, text, text
) is 'Founder-only, reason-required, audited answer-history export with explicit provenance for unavailable source fields.';

commit;

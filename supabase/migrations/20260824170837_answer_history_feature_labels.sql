-- Present answer history by website feature instead of the legacy technical
-- storage split (practice/formal_exam). The storage discriminator remains
-- internal for backward compatibility and source reconstruction.

begin;

create or replace function public.admin_answer_feature_context(
  p_record_source text,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_track text;
begin
  if p_record_source = 'practice' then
    return jsonb_build_object(
      'featureKey', 'bar_question_practice',
      'feature', 'Bar Question Practice'
    );
  end if;

  if p_record_source = 'formal_exam' then
    select d.track
    into v_track
    from public.examination_attempts_multi a
    join public.examination_versions v on v.id = a.version_id
    join public.examination_definitions d on d.id = v.exam_id
    where a.id = p_attempt_id;

    return case v_track
      when 'per_subject' then jsonb_build_object(
        'featureKey', 'syllabus_based_review',
        'feature', 'Syllabus-Based Review'
      )
      when 'bar_feels' then jsonb_build_object(
        'featureKey', 'bar_exam_simulation',
        'feature', 'Bar Exam Simulation'
      )
      else jsonb_build_object(
        'featureKey', 'unclassified_feature',
        'feature', 'Feature not recorded'
      )
    end;
  end if;

  return jsonb_build_object(
    'featureKey', 'unclassified_feature',
    'feature', 'Feature not recorded'
  );
end;
$$;

create or replace function public.admin_preview_answer_history_with_sources(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_search text,
  p_record_source text,
  p_limit integer,
  p_offset integer,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_items jsonb := '[]'::jsonb;
begin
  perform public.phase4_require_founder(p_actor_user_id);
  v_result := public.admin_preview_answer_history(
    p_actor_user_id, p_target_user_id, p_from, p_to, p_search,
    p_record_source, p_limit, p_offset, p_request_key
  );

  select coalesce(
    jsonb_agg(
      e.item
      || public.admin_answer_source_context(
        e.item->>'recordSource',
        (e.item->>'attemptId')::uuid,
        e.item->>'questionId'
      )
      || public.admin_answer_feature_context(
        e.item->>'recordSource',
        (e.item->>'attemptId')::uuid
      )
      order by e.ordinality
    ),
    '[]'::jsonb
  )
  into v_items
  from jsonb_array_elements(coalesce(v_result->'items', '[]'::jsonb))
    with ordinality as e(item, ordinality);

  return jsonb_set(v_result, '{items}', v_items, true);
end;
$$;

create or replace function public.admin_export_answer_history_with_sources(
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
set search_path = ''
as $$
declare
  v_result jsonb;
  v_items jsonb := '[]'::jsonb;
begin
  perform public.phase4_require_founder(p_actor_user_id);
  v_result := public.admin_export_answer_history_with_context(
    p_actor_user_id, p_target_user_id, p_from, p_to,
    p_limit, p_reason, p_request_key
  );

  select coalesce(
    jsonb_agg(
      e.item
      || public.admin_answer_source_context(
        e.item->>'recordSource',
        (e.item->>'attemptId')::uuid,
        e.item->>'questionId'
      )
      || public.admin_answer_feature_context(
        e.item->>'recordSource',
        (e.item->>'attemptId')::uuid
      )
      order by e.ordinality
    ),
    '[]'::jsonb
  )
  into v_items
  from jsonb_array_elements(coalesce(v_result->'items', '[]'::jsonb))
    with ordinality as e(item, ordinality);

  return jsonb_set(v_result, '{items}', v_items, true);
end;
$$;

revoke all on function public.admin_answer_feature_context(text, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_answer_feature_context(text, uuid)
  to service_role;

revoke all on function public.admin_preview_answer_history_with_sources(
  uuid, uuid, timestamptz, timestamptz, text, text, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.admin_preview_answer_history_with_sources(
  uuid, uuid, timestamptz, timestamptz, text, text, integer, integer, text
) to service_role;

revoke all on function public.admin_export_answer_history_with_sources(
  uuid, uuid, timestamptz, timestamptz, integer, text, text
) from public, anon, authenticated;
grant execute on function public.admin_export_answer_history_with_sources(
  uuid, uuid, timestamptz, timestamptz, integer, text, text
) to service_role;

comment on function public.admin_answer_feature_context(text, uuid) is
  'Maps internal answer storage provenance to the exact learner-facing website feature.';

commit;

-- Replace the legacy Practice/Formal presentation with exact website-feature
-- filtering. Storage provenance remains intact internally for compatibility.

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

create or replace function public.admin_preview_answer_history_by_feature_v1(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_search text,
  p_feature_key text,
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
  v_feature_key text := lower(btrim(coalesce(p_feature_key, 'all')));
  v_result jsonb;
  v_page jsonb;
  v_page_items jsonb;
  v_matching_items jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_source_offset integer := 0;
  v_total integer := 0;
  v_scan_cap integer := 25000;
  v_too_many boolean := false;
  v_derived_request_key text;
  v_feature_totals jsonb;
begin
  perform public.phase4_require_founder(p_actor_user_id);

  if v_feature_key not in (
    'all',
    'bar_question_practice',
    'syllabus_based_review',
    'bar_exam_simulation'
  ) then
    raise exception 'Valid answer-history feature required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Answer-history preview limit must be between 1 and 100';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > 1000000 then
    raise exception 'Answer-history preview offset is invalid';
  end if;
  if coalesce(p_request_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid answer-history preview request key required';
  end if;

  if v_feature_key in ('all', 'bar_question_practice') then
    v_result := public.admin_preview_answer_history_with_sources(
      p_actor_user_id,
      p_target_user_id,
      p_from,
      p_to,
      p_search,
      case when v_feature_key = 'all' then 'all' else 'practice' end,
      p_limit,
      p_offset,
      p_request_key
    );
  else
    loop
      v_derived_request_key := encode(extensions.digest(
        p_request_key || ':' || v_feature_key || ':' || v_source_offset::text,
        'sha256'
      ), 'hex');

      v_page := public.admin_preview_answer_history_with_sources(
        p_actor_user_id,
        p_target_user_id,
        p_from,
        p_to,
        p_search,
        'formal_exam',
        100,
        v_source_offset,
        v_derived_request_key
      );
      v_page_items := coalesce(v_page->'items', '[]'::jsonb);

      for v_item in
        select item.value
        from jsonb_array_elements(v_page_items) item(value)
      loop
        if v_item->>'featureKey' = v_feature_key then
          v_matching_items := v_matching_items || jsonb_build_array(v_item);
        end if;
      end loop;

      exit when coalesce((v_page->>'hasMore')::boolean, false) is false;
      v_source_offset := v_source_offset + 100;
      if v_source_offset >= v_scan_cap then
        v_too_many := true;
        exit;
      end if;
    end loop;

    v_total := jsonb_array_length(v_matching_items);
    select coalesce(jsonb_agg(item.value order by item.ordinality), '[]'::jsonb)
    into v_items
    from jsonb_array_elements(v_matching_items) with ordinality
      as item(value, ordinality)
    where item.ordinality > p_offset
      and item.ordinality <= p_offset + p_limit;

    v_result := jsonb_build_object(
      'items', v_items,
      'total', v_total,
      'limit', p_limit,
      'offset', p_offset,
      'hasMore', p_offset + jsonb_array_length(v_items) < v_total,
      'tooMany', v_too_many,
      'scope', case when p_target_user_id is null then 'all_users' else 'single_user' end,
      'dateScope', case when p_from is null then 'all_time' else 'bounded_range' end
    );
  end if;

  select jsonb_build_object(
    'bar_question_practice', (
      select count(*)
      from public.exam_attempts attempt
      where nullif(btrim(attempt.answer_text), '') is not null
    ),
    'syllabus_based_review', (
      select count(*)
      from public.examination_responses response
      join public.examination_attempts_multi attempt
        on attempt.id = response.attempt_id
      join public.examination_versions version
        on version.id = attempt.version_id
      join public.examination_definitions definition
        on definition.id = version.exam_id
      where nullif(btrim(response.answer_text), '') is not null
        and definition.track = 'per_subject'
    ),
    'bar_exam_simulation', (
      select count(*)
      from public.examination_responses response
      join public.examination_attempts_multi attempt
        on attempt.id = response.attempt_id
      join public.examination_versions version
        on version.id = attempt.version_id
      join public.examination_definitions definition
        on definition.id = version.exam_id
      where nullif(btrim(response.answer_text), '') is not null
        and definition.track = 'bar_feels'
    )
  )
  into v_feature_totals;

  return v_result || jsonb_build_object(
    'featureFilter', v_feature_key,
    'featureTotals', v_feature_totals,
    'tooMany', coalesce((v_result->>'tooMany')::boolean, false)
  );
end;
$$;

revoke all on function public.admin_answer_feature_context(text, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_answer_feature_context(text, uuid)
  to service_role;

revoke all on function public.admin_preview_answer_history_by_feature_v1(
  uuid, uuid, timestamptz, timestamptz, text, text, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.admin_preview_answer_history_by_feature_v1(
  uuid, uuid, timestamptz, timestamptz, text, text, integer, integer, text
) to service_role;

comment on function public.admin_preview_answer_history_by_feature_v1(
  uuid, uuid, timestamptz, timestamptz, text, text, integer, integer, text
) is 'Founder-only answer-history preview filtered by exact website feature; legacy storage provenance remains internal.';

commit;

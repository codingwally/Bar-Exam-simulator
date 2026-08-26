-- Independent, non-scoring writing diagnostics.
-- This schema does not reference or update official assessment scores, pass/fail
-- state, grading payloads, or examination rubric fields.

begin;

create table public.auxiliary_writing_diagnostic_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (source_type in (
    'phase4_exam_attempt',
    'examination_attempt',
    'legacy_grading_result'
  )),
  source_id uuid not null,
  question_id text not null check (length(btrim(question_id)) between 1 and 160),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  diagnostic_version text not null check (length(btrim(diagnostic_version)) between 1 and 80),
  expected_questions integer not null check (expected_questions between 1 and 100),
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  attempt_count integer not null default 1 check (attempt_count between 1 and 20),
  failure_code text check (failure_code is null or length(failure_code) between 1 and 80),
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_type, source_id, question_id, input_hash, diagnostic_version)
);

create index auxiliary_writing_diagnostic_jobs_user_source_idx
  on public.auxiliary_writing_diagnostic_jobs (user_id, source_type, source_id, updated_at desc);

create table public.auxiliary_writing_diagnostics (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.auxiliary_writing_diagnostic_jobs(id) on delete cascade,
  diagnostic_kind text not null check (diagnostic_kind in ('grammar_strength', 'issue_spotting')),
  auxiliary_points numeric(2,1) not null check (auxiliary_points between 0 and 5),
  maximum_points numeric(2,1) not null default 5 check (maximum_points = 5),
  brief_coaching text not null check (length(btrim(brief_coaching)) between 1 and 180),
  rubric_id text not null check (length(btrim(rubric_id)) between 1 and 80),
  evaluator_model text not null check (length(btrim(evaluator_model)) between 1 and 120),
  finalized_at timestamptz not null default now(),
  unique (job_id, diagnostic_kind)
);

create index auxiliary_writing_diagnostics_job_kind_idx
  on public.auxiliary_writing_diagnostics (job_id, diagnostic_kind);

alter table public.auxiliary_writing_diagnostic_jobs enable row level security;
alter table public.auxiliary_writing_diagnostics enable row level security;

revoke all on table public.auxiliary_writing_diagnostic_jobs from public, anon, authenticated;
revoke all on table public.auxiliary_writing_diagnostics from public, anon, authenticated;
grant select, insert, update on table public.auxiliary_writing_diagnostic_jobs to service_role;
grant select, insert on table public.auxiliary_writing_diagnostics to service_role;

create or replace function public.dd2026_auxiliary_diagnostic_source(
  p_user_id uuid,
  p_source_type text,
  p_source_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_source jsonb;
begin
  perform public.dd2026_require_user(p_user_id);

  if p_source_type = 'phase4_exam_attempt' then
    select jsonb_build_object(
      'sourceType', p_source_type,
      'sourceId', a.id,
      'questions', jsonb_build_array(jsonb_build_object(
        'questionId', a.question_bank_id,
        'question', null,
        'answer', a.answer_text
      ))
    ) into v_source
    from public.exam_attempts a
    where a.id = p_source_id
      and a.user_id = p_user_id
      and a.status = 'completed';
  elsif p_source_type = 'examination_attempt' then
    select jsonb_build_object(
      'sourceType', p_source_type,
      'sourceId', a.id,
      'questions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'questionId', vq.question_id::text,
          'question', vq.prompt_snapshot,
          'answer', coalesce(r.answer_text, '')
        ) order by vq.ordinal)
        from public.examination_version_questions vq
        left join public.examination_responses r
          on r.attempt_id = a.id
         and r.question_id = vq.question_id
        where vq.version_id = a.version_id
      ), '[]'::jsonb)
    ) into v_source
    from public.examination_attempts_multi a
    where a.id = p_source_id
      and a.user_id = p_user_id
      and a.status in ('submitted', 'expired')
      and exists (
        select 1
        from public.examination_grading_jobs j
        where j.attempt_id = a.id
          and j.route = 'ai'
          and j.status = 'completed'
      );
  elsif p_source_type = 'legacy_grading_result' then
    select jsonb_build_object(
      'sourceType', p_source_type,
      'sourceId', g.id,
      'questions', jsonb_build_array(jsonb_build_object(
        'questionId', q.id::text,
        'question', q.prompt_text,
        'answer', s.answer_text
      ))
    ) into v_source
    from public.grading_results g
    join public.submissions s on s.id = g.submission_id
    join public.questions q on q.id = s.question_id
    where g.id = p_source_id
      and s.user_id = p_user_id;
  end if;

  if v_source is null then
    raise exception 'AUXILIARY_DIAGNOSTIC_SOURCE_NOT_FOUND';
  end if;
  return v_source;
end;
$$;

create or replace function public.dd2026_auxiliary_diagnostic_claim(
  p_user_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_question_id text,
  p_input_hash text,
  p_diagnostic_version text,
  p_expected_questions integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source jsonb;
  v_job public.auxiliary_writing_diagnostic_jobs%rowtype;
begin
  v_source := public.dd2026_auxiliary_diagnostic_source(p_user_id, p_source_type, p_source_id);
  if not exists (
    select 1
    from jsonb_array_elements(coalesce(v_source->'questions', '[]'::jsonb)) q
    where q->>'questionId' = btrim(p_question_id)
  ) then
    raise exception 'AUXILIARY_DIAGNOSTIC_QUESTION_NOT_FOUND';
  end if;
  if p_input_hash is null or p_input_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'AUXILIARY_DIAGNOSTIC_HASH_INVALID';
  end if;
  if length(btrim(coalesce(p_diagnostic_version, ''))) not between 1 and 80 then
    raise exception 'AUXILIARY_DIAGNOSTIC_VERSION_INVALID';
  end if;
  if p_expected_questions is null or p_expected_questions not between 1 and 100 then
    raise exception 'AUXILIARY_DIAGNOSTIC_EXPECTED_COUNT_INVALID';
  end if;

  insert into public.auxiliary_writing_diagnostic_jobs (
    user_id, source_type, source_id, question_id, input_hash, diagnostic_version,
    expected_questions
  ) values (
    p_user_id, p_source_type, p_source_id, btrim(p_question_id), p_input_hash,
    btrim(p_diagnostic_version), p_expected_questions
  )
  on conflict (user_id, source_type, source_id, question_id, input_hash, diagnostic_version)
  do nothing
  returning * into v_job;
  if found then
    return jsonb_build_object('claimed', true, 'jobId', v_job.id, 'status', v_job.status);
  end if;

  select * into v_job
  from public.auxiliary_writing_diagnostic_jobs
  where user_id = p_user_id
    and source_type = p_source_type
    and source_id = p_source_id
    and question_id = btrim(p_question_id)
    and input_hash = p_input_hash
    and diagnostic_version = btrim(p_diagnostic_version)
  for update;
  if not found then raise exception 'AUXILIARY_DIAGNOSTIC_CLAIM_CONFLICT'; end if;

  if v_job.status = 'completed' then
    return jsonb_build_object('claimed', false, 'jobId', v_job.id, 'status', v_job.status);
  end if;
  if v_job.status = 'processing' and v_job.updated_at > now() - interval '15 minutes' then
    return jsonb_build_object('claimed', false, 'jobId', v_job.id, 'status', v_job.status);
  end if;
  if v_job.attempt_count >= 20 then
    return jsonb_build_object('claimed', false, 'jobId', v_job.id, 'status', 'failed');
  end if;

  update public.auxiliary_writing_diagnostic_jobs
  set status = 'processing',
      attempt_count = attempt_count + 1,
      failure_code = null,
      claimed_at = now(),
      updated_at = now()
  where id = v_job.id
  returning * into v_job;
  return jsonb_build_object('claimed', true, 'jobId', v_job.id, 'status', v_job.status);
end;
$$;

create or replace function public.dd2026_auxiliary_diagnostic_finish(
  p_user_id uuid,
  p_job_id uuid,
  p_grammar_points numeric,
  p_grammar_coaching text,
  p_grammar_rubric_id text,
  p_issue_points numeric,
  p_issue_coaching text,
  p_issue_rubric_id text,
  p_evaluator_model text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.auxiliary_writing_diagnostic_jobs%rowtype;
begin
  perform public.dd2026_require_user(p_user_id);
  select * into v_job
  from public.auxiliary_writing_diagnostic_jobs
  where id = p_job_id and user_id = p_user_id
  for update;
  if not found then raise exception 'AUXILIARY_DIAGNOSTIC_JOB_NOT_FOUND'; end if;
  if v_job.status = 'completed' then
    return jsonb_build_object('jobId', v_job.id, 'status', 'completed');
  end if;
  if p_grammar_points is null or p_issue_points is null
     or p_grammar_points not between 0 and 5 or p_issue_points not between 0 and 5 then
    raise exception 'AUXILIARY_DIAGNOSTIC_POINTS_INVALID';
  end if;

  insert into public.auxiliary_writing_diagnostics (
    job_id, diagnostic_kind, auxiliary_points, maximum_points,
    brief_coaching, rubric_id, evaluator_model
  ) values
    (
      v_job.id, 'grammar_strength', round(p_grammar_points, 1), 5,
      btrim(p_grammar_coaching), btrim(p_grammar_rubric_id), btrim(p_evaluator_model)
    ),
    (
      v_job.id, 'issue_spotting', round(p_issue_points, 1), 5,
      btrim(p_issue_coaching), btrim(p_issue_rubric_id), btrim(p_evaluator_model)
    )
  on conflict (job_id, diagnostic_kind) do nothing;

  update public.auxiliary_writing_diagnostic_jobs
  set status = 'completed', completed_at = now(), failure_code = null, updated_at = now()
  where id = v_job.id;
  return jsonb_build_object('jobId', v_job.id, 'status', 'completed');
end;
$$;

create or replace function public.dd2026_auxiliary_diagnostic_fail(
  p_user_id uuid,
  p_job_id uuid,
  p_failure_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  perform public.dd2026_require_user(p_user_id);
  update public.auxiliary_writing_diagnostic_jobs
  set status = 'failed',
      failure_code = left(coalesce(nullif(btrim(p_failure_code), ''), 'AUXILIARY_EVALUATION_FAILED'), 80),
      updated_at = now()
  where id = p_job_id
    and user_id = p_user_id
    and status = 'processing'
  returning status into v_status;
  return jsonb_build_object('jobId', p_job_id, 'status', coalesce(v_status, 'unchanged'));
end;
$$;

create or replace function public.dd2026_auxiliary_diagnostic_records(
  p_user_id uuid,
  p_records jsonb,
  p_diagnostic_version text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.dd2026_require_user(p_user_id);
  if jsonb_typeof(coalesce(p_records, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_records, '[]'::jsonb)) > 500 then
    raise exception 'AUXILIARY_DIAGNOSTIC_RECORDS_INVALID';
  end if;

  return jsonb_build_object('items', coalesce((
    with requested as (
      select distinct
        item->>'sourceType' as source_type,
        (item->>'sourceId')::uuid as source_id
      from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) item
      where item->>'sourceType' in (
        'phase4_exam_attempt', 'examination_attempt', 'legacy_grading_result'
      )
    ), latest_jobs as (
      select distinct on (j.source_type, j.source_id, j.question_id)
        j.*
      from public.auxiliary_writing_diagnostic_jobs j
      join requested r
        on r.source_type = j.source_type
       and r.source_id = j.source_id
      where j.user_id = p_user_id
        and j.diagnostic_version = p_diagnostic_version
      order by j.source_type, j.source_id, j.question_id,
        (j.status = 'completed') desc, j.updated_at desc, j.id desc
    )
    select jsonb_agg(jsonb_build_object(
      'sourceType', j.source_type,
      'sourceId', j.source_id,
      'questionId', j.question_id,
      'expectedQuestions', j.expected_questions,
      'status', case when g.id is not null and i.id is not null then 'completed' else j.status end,
      'grammarStrength', case when g.id is null then null else jsonb_build_object(
        'auxiliaryPoints', g.auxiliary_points,
        'maximumPoints', g.maximum_points,
        'briefCoaching', g.brief_coaching
      ) end,
      'issueSpotting', case when i.id is null then null else jsonb_build_object(
        'auxiliaryPoints', i.auxiliary_points,
        'maximumPoints', i.maximum_points,
        'briefCoaching', i.brief_coaching
      ) end,
      'updatedAt', j.updated_at
    ) order by j.updated_at desc, j.source_type, j.source_id, j.question_id)
    from latest_jobs j
    left join public.auxiliary_writing_diagnostics g
      on g.job_id = j.id and g.diagnostic_kind = 'grammar_strength'
    left join public.auxiliary_writing_diagnostics i
      on i.job_id = j.id and i.diagnostic_kind = 'issue_spotting'
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.dd2026_auxiliary_diagnostic_source(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.dd2026_auxiliary_diagnostic_source(uuid, text, uuid)
  to service_role;

revoke all on function public.dd2026_auxiliary_diagnostic_claim(uuid, text, uuid, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.dd2026_auxiliary_diagnostic_claim(uuid, text, uuid, text, text, text, integer)
  to service_role;

revoke all on function public.dd2026_auxiliary_diagnostic_finish(
  uuid, uuid, numeric, text, text, numeric, text, text, text
) from public, anon, authenticated;
grant execute on function public.dd2026_auxiliary_diagnostic_finish(
  uuid, uuid, numeric, text, text, numeric, text, text, text
) to service_role;

revoke all on function public.dd2026_auxiliary_diagnostic_fail(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.dd2026_auxiliary_diagnostic_fail(uuid, uuid, text)
  to service_role;

revoke all on function public.dd2026_auxiliary_diagnostic_records(uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.dd2026_auxiliary_diagnostic_records(uuid, jsonb, text)
  to service_role;

commit;

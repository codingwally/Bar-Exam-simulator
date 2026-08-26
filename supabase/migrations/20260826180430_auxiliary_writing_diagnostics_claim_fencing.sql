-- Fence stale background evaluators after a diagnostic job lease is reclaimed.

begin;

alter table public.auxiliary_writing_diagnostic_jobs
  add column if not exists claim_token uuid not null default gen_random_uuid();

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
    return jsonb_build_object(
      'claimed', true,
      'jobId', v_job.id,
      'claimToken', v_job.claim_token,
      'status', v_job.status
    );
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
      claim_token = gen_random_uuid(),
      claimed_at = now(),
      updated_at = now()
  where id = v_job.id
  returning * into v_job;
  return jsonb_build_object(
    'claimed', true,
    'jobId', v_job.id,
    'claimToken', v_job.claim_token,
    'status', v_job.status
  );
end;
$$;

drop function if exists public.dd2026_auxiliary_diagnostic_finish(
  uuid, uuid, numeric, text, text, numeric, text, text, text
);

create function public.dd2026_auxiliary_diagnostic_finish(
  p_user_id uuid,
  p_job_id uuid,
  p_claim_token uuid,
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
  if v_job.status <> 'processing' or v_job.claim_token is distinct from p_claim_token then
    raise exception 'AUXILIARY_DIAGNOSTIC_STALE_CLAIM';
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
  where id = v_job.id and claim_token = p_claim_token;
  return jsonb_build_object('jobId', v_job.id, 'status', 'completed');
end;
$$;

drop function if exists public.dd2026_auxiliary_diagnostic_fail(uuid, uuid, text);

create function public.dd2026_auxiliary_diagnostic_fail(
  p_user_id uuid,
  p_job_id uuid,
  p_claim_token uuid,
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
    and claim_token = p_claim_token
    and status = 'processing'
  returning status into v_status;
  return jsonb_build_object(
    'jobId', p_job_id,
    'status', coalesce(v_status, 'fenced')
  );
end;
$$;

revoke all on function public.dd2026_auxiliary_diagnostic_claim(uuid, text, uuid, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.dd2026_auxiliary_diagnostic_claim(uuid, text, uuid, text, text, text, integer)
  to service_role;

revoke all on function public.dd2026_auxiliary_diagnostic_finish(
  uuid, uuid, uuid, numeric, text, text, numeric, text, text, text
) from public, anon, authenticated;
grant execute on function public.dd2026_auxiliary_diagnostic_finish(
  uuid, uuid, uuid, numeric, text, text, numeric, text, text, text
) to service_role;

revoke all on function public.dd2026_auxiliary_diagnostic_fail(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.dd2026_auxiliary_diagnostic_fail(uuid, uuid, uuid, text)
  to service_role;

commit;

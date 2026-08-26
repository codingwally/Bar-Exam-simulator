-- Keep transient evaluator outages from consuming the diagnostic retry budget.

begin;

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
  v_retry_seconds integer;
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
  if v_job.status = 'failed' then
    v_retry_seconds := least(
      900,
      (15 * power(2, least(greatest(v_job.attempt_count - 1, 0), 6)))::integer
    );
    if v_job.updated_at > now() - make_interval(secs => v_retry_seconds) then
      return jsonb_build_object(
        'claimed', false,
        'jobId', v_job.id,
        'status', v_job.status,
        'retryAfter', v_job.updated_at + make_interval(secs => v_retry_seconds)
      );
    end if;
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

revoke all on function public.dd2026_auxiliary_diagnostic_claim(uuid, text, uuid, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.dd2026_auxiliary_diagnostic_claim(uuid, text, uuid, text, text, text, integer)
  to service_role;

commit;

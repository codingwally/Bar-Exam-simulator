-- CLI-generated 20260907223228; selectively carried forward after current access policy.
-- Future Bar Feels snapshots only. Original prompts, keys, answers and hashes stay intact.
begin;
set local lock_timeout = '250ms';
set local statement_timeout = '5s';

alter table public.examination_version_questions add column source_presentation jsonb
  check (source_presentation is null or jsonb_typeof(source_presentation) = 'object');
comment on column public.examination_version_questions.source_presentation is
  'Reviewed display metadata copied only into new Bar Feels snapshots; not a replacement grading prompt.';

-- Only these eight independently reviewed IDs share parent facts. No guessed-ID heuristic.
create function private.astra_simulator_parent_family(p_source_id text)
returns text language sql immutable parallel safe security invoker set search_path = ''
as $function$
  select case
    when p_source_id in ('REM-2022-II-Q01A', 'REM-2022-II-Q01B') then 'REM-2022-II-Q01'
    when p_source_id in ('REM-2019-A02A', 'REM-2019-A02B', 'REM-2019-A02C') then 'REM-2019-A02'
    when p_source_id in ('ETH-2019-A05A', 'ETH-2019-A05B', 'ETH-2019-A05C') then 'ETH-2019-A05'
    else null end;
$function$;
revoke all on function private.astra_simulator_parent_family(text) from public, anon, authenticated, service_role;

create function private.astra_simulator_snapshot_presentation()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare
  v_id text;
  v_expected text;
  v_part text;
  v_source_label text;
  v_weight numeric;
  v_prompt text;
  v_instruction text;
begin
  -- Updating an old row must never retroactively attach metadata. The existing
  -- published-version guard still rejects all published snapshot mutations.
  if tg_op = 'UPDATE' then
    if new.source_presentation is distinct from old.source_presentation
       or (old.source_presentation is not null and
           (new.prompt_snapshot is distinct from old.prompt_snapshot
            or new.snapshot_hash is distinct from old.snapshot_hash
            or new.question_id is distinct from old.question_id
            or new.version_id is distinct from old.version_id)) then
      raise exception 'BAR_SIMULATION_PRESENTATION_IMMUTABLE';
    end if;
    return new;
  end if;
  new.source_presentation := null;
  select substring(q.source_key from 11) into v_id
  from public.examination_questions q
  join public.examination_versions v on v.id = new.version_id
  join public.examination_definitions d on d.id = v.exam_id
  where q.id = new.question_id and q.source_key like 'bar-feels:%'
    and q.source_type = 'google_sheet' and d.track = 'bar_feels' and v.status = 'draft';
  case v_id
    when 'REM-2022-II-Q01A' then
      v_expected := 'f8814d5d4a68f571f8fbefc1b226c641329ae308792c0886da3abb8a8491ad34';
      v_part := 'a'; v_source_label := '2022 Bar · Remedial Law II · 1(a)';
    when 'REM-2022-II-Q01B' then
      v_expected := 'd4551d6a5bd1e1efff7693ba2ab478e2241f7e55486a04d44643fb0d1a2f1b5f';
      v_part := 'b'; v_source_label := '2022 Bar · Remedial Law II · 1(b)';
    when 'REM-2019-A02B' then
      v_expected := 'b56d2181728025005447ba64229204bafe8ecd8a1833798eb1fcca3e1b4a03aa';
      v_part := 'b'; v_source_label := '2019 Bar · Remedial Law · A.2(b)'; v_weight := 3;
    when 'ETH-2019-A05B' then
      v_expected := 'f4461b6053c1d62e69eee07ac07f935eec5d86d5dd437641f448501f155664ae';
      v_part := 'b'; v_source_label := '2019 Bar · Legal and Judicial Ethics · A.5(b)'; v_weight := 2.5;
    else return new;
  end case;
  if encode(extensions.digest(convert_to(new.prompt_snapshot, 'UTF8'), 'sha256'), 'hex') <> v_expected then
    -- A later editorial revision is deliberately unmodified/unreviewed here.
    -- Do not apply stale cleaned text, and do not create a new admission outage.
    return new;
  end if;
  if v_weight is null then
    -- Exact reviewed wrapper only; the entire parent stem and selected call survive.
    v_prompt := substring(new.prompt_snapshot from length('[This item has five questions.] ') + 1);
    v_instruction := 'Answer only part (' || v_part || ') shown below. The shared facts are included.';
  else
    -- Keep the historical weight as attributed metadata, separate from practice scoring.
    v_prompt := left(new.prompt_snapshot, length(new.prompt_snapshot) - length(' (' || v_weight::text || '%)'));
    v_instruction := null;
  end if;
  new.source_presentation := jsonb_build_object(
    'schemaVersion', 1, 'revision', 'astra-simulator-source-20260907-r1',
    'sourceQuestionId', v_id, 'parentFamily', private.astra_simulator_parent_family(v_id),
    'sourceYear', split_part(v_id, '-', 2)::integer,
    'originalQuestionNumber', case when v_weight is null then 'II-1(' || v_part || ')'
      when v_id = 'REM-2019-A02B' then 'A.2(b)' else 'A.5(b)' end,
    'sourceLabel', v_source_label, 'selectedPart', v_part,
    'originalWeightPercent', v_weight, 'practiceMaximum', 5,
    'originalPromptSha256', v_expected, 'originalSnapshotHash', new.snapshot_hash,
    'displayPrompt', v_prompt, 'instruction', v_instruction);
  return new;
end;
$function$;
revoke all on function private.astra_simulator_snapshot_presentation() from public, anon, authenticated, service_role;
create trigger astra_simulator_snapshot_presentation
before insert or update on public.examination_version_questions
for each row execute function private.astra_simulator_snapshot_presentation();

-- Same eligibility and lifetime question exposure predicates as the current
-- allocator. Group only within this selection; no broader lifetime-family ban.
create function private.astra_simulator_select_subject(
  p_user_id uuid, p_subject text, p_pool_digest text, p_quota integer
) returns table(question_id uuid) language sql volatile security invoker set search_path = ''
as $function$
  with eligible as materialized (
    select pool.question_id,
      coalesce('parent:' || private.astra_simulator_parent_family(pool.source_question_id),
        'question:' || pool.question_id::text) as family_key
    from public.bar_simulation_question_pool pool
    join public.examination_questions question on question.id = pool.question_id
    where pool.eligible
      and pool.subject = p_subject
      and pool.source_digest = p_pool_digest
      and question.publication_ready
      and question.review_status in ('approved', 'owner_override')
      and question.content_hash = pool.content_hash
      and not exists (
        select 1 from public.bar_simulation_answered_questions answered
        where answered.user_id = p_user_id and answered.question_id = pool.question_id
      )
  ), representatives as (
    select distinct on (family_key) question_id, family_key
    from eligible order by family_key, extensions.gen_random_bytes(16)
  )
  select question_id from representatives order by extensions.gen_random_bytes(16)
  limit case when p_quota between 1 and 20 then p_quota else 0 end;
$function$;
revoke all on function private.astra_simulator_select_subject(uuid,text,text,integer)
  from public, anon, authenticated, service_role;

do $patch$
declare
  v_target regprocedure;
  v_before text;
  v_after text;
  v_acl text;
  v_old text := $old$      select pool.question_id
      from public.bar_simulation_question_pool pool
      join public.examination_questions question on question.id = pool.question_id
      where pool.eligible
        and pool.subject = v_subject
        and pool.source_digest = v_pool_digest
        and question.publication_ready
        and question.review_status in ('approved', 'owner_override')
        and question.content_hash = pool.content_hash
        and not exists (
          select 1
          from public.bar_simulation_answered_questions answered
          where answered.user_id = p_user_id
            and answered.question_id = pool.question_id
        )
      order by extensions.gen_random_bytes(16)
      limit v_quota$old$;
  v_new text := $new$      -- astra-simulator-source-20260907-r1: one selected part per verified parent.
      select selected.question_id
      from private.astra_simulator_select_subject(p_user_id, v_subject, v_pool_digest, v_quota) selected$new$;
  v_spec record;
  v_count integer;
begin
  v_target := 'public.bar_simulation_start_attempt_v1(uuid,uuid,text,text,text)'::regprocedure;
  select pg_get_functiondef(v_target), proacl::text into v_before, v_acl from pg_proc where oid = v_target;
  if position('astra-simulator-access-20260907-r1' in v_before) = 0 then
    raise exception 'ASTRA_SIMULATOR_PRESENTATION_DEPENDENCY_REQUIRED';
  end if;
  if (length(v_before) - length(replace(v_before, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'ASTRA_SIMULATOR_PRESENTATION_ALLOCATOR_CHANGED';
  end if;
  v_after := replace(v_before, v_old, v_new);
  if replace(v_after, v_new, v_old) <> v_before then
    raise exception 'ASTRA_SIMULATOR_PRESENTATION_PATCH_NOT_REVERSIBLE';
  end if;
  execute v_after;
  if (select proacl::text from pg_proc where oid = v_target) is distinct from v_acl then
    raise exception 'ASTRA_SIMULATOR_PRESENTATION_ACL_CHANGED';
  end if;
  for v_spec in select * from (values
    ('public.examination_render_attempt(uuid,boolean)', 1),
    ('public.examination_query_pre_protected_review_release(uuid,text,jsonb)', 2)
  ) as s(signature, occurrences) loop
    v_target := v_spec.signature::regprocedure;
    select pg_get_functiondef(v_target), proacl::text into v_before, v_acl from pg_proc where oid = v_target;
    if v_spec.occurrences = 2 and position('astra-simulator-access-20260907-r1' in v_before) = 0 then
      raise exception 'ASTRA_SIMULATOR_PRESENTATION_DEPENDENCY_REQUIRED';
    end if;
    v_old := '''prompt'', vq.prompt_snapshot,';
    v_new := E'''prompt'', vq.prompt_snapshot,\n          ''sourcePresentation'', vq.source_presentation,';
    v_count := (length(v_before) - length(replace(v_before, v_old, ''))) / length(v_old);
    if v_count <> v_spec.occurrences or position('''sourcePresentation''' in v_before) > 0 then
      raise exception 'ASTRA_SIMULATOR_PRESENTATION_DTO_CHANGED';
    end if;
    v_after := replace(v_before, v_old, v_new);
    if replace(v_after, v_new, v_old) <> v_before then
      raise exception 'ASTRA_SIMULATOR_PRESENTATION_PATCH_NOT_REVERSIBLE';
    end if;
    execute v_after;
    if (select proacl::text from pg_proc where oid = v_target) is distinct from v_acl then
      raise exception 'ASTRA_SIMULATOR_PRESENTATION_ACL_CHANGED';
    end if;
  end loop;
end;
$patch$;
commit;

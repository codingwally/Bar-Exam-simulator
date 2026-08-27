-- Repair the incremental Syllabus-Based Review importer without deleting or
-- replacing any question, placement, attempt, response, submission, or grade.
--
-- The v1 importer stored the whole-version digest in
-- examination_version_questions.snapshot_hash.  The reveal contract correctly
-- expects that column to contain examination_questions.content_hash.  The
-- snapshots themselves are sound; this migration changes the hash metadata only
-- after every answer-bearing snapshot field is proven identical to the current
-- approved question.  Published rows are moved through draft inside this single
-- transaction solely so the existing immutability trigger can validate the
-- controlled repair.  Other sessions see either the complete old state or the
-- complete repaired state.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $subject_matter_incremental_preserve_v1$
begin
  if pg_catalog.to_regprocedure(
    'public.subject_matter_sync_incremental_v1_legacy_snapshot_hash(uuid,jsonb,text,text)'
  ) is null then
    if pg_catalog.to_regprocedure(
      'public.subject_matter_sync_incremental_v1(uuid,jsonb,text,text)'
    ) is null then
      raise exception 'SUBJECT_MATTER_INCREMENTAL_V1_REQUIRED';
    end if;

    alter function public.subject_matter_sync_incremental_v1(
      uuid, jsonb, text, text
    ) rename to subject_matter_sync_incremental_v1_legacy_snapshot_hash;
  end if;
end;
$subject_matter_incremental_preserve_v1$;

revoke all on function public.subject_matter_sync_incremental_v1_legacy_snapshot_hash(
  uuid, jsonb, text, text
) from public, anon, authenticated, service_role;

create or replace function public.subject_matter_repair_incremental_snapshot_hash_v1(
  p_source_digest text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $subject_matter_repair_incremental_snapshot_hash_v1$
declare
  v_version_ids uuid[];
  v_candidate_count integer := 0;
  v_version_count integer := 0;
  v_repaired_count integer := 0;
begin
  if p_source_digest is not null
     and pg_catalog.lower(pg_catalog.btrim(p_source_digest)) !~ '^[0-9a-f]{64}$'
  then
    raise exception 'SUBJECT_MATTER_INCREMENTAL_SOURCE_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'subject-matter-incremental-v1', 0
  ));

  -- Fail closed if any row bearing the known legacy signature does not have
  -- byte-for-byte equivalent snapshot content.  Such a row would need a new
  -- immutable version, not a metadata correction.
  if exists (
    select 1
    from public.subject_matter_placements placement
    join public.examination_definitions definition
      on definition.id = placement.exam_id
    join public.examination_versions version
      on version.exam_id = definition.id
    join public.examination_version_questions version_question
      on version_question.version_id = version.id
     and version_question.question_id = placement.question_id
    left join public.examination_questions question
      on question.id = version_question.question_id
    where version.label = 'Incremental reviewed question'
      and version.status = 'published'
      and version.question_count = 1
      and version_question.snapshot_hash = version.snapshot_hash
      and question.content_hash is distinct from version_question.snapshot_hash
      and (
        p_source_digest is null
        or placement.source_digest = pg_catalog.lower(pg_catalog.btrim(p_source_digest))
      )
      and not (
        definition.track = 'per_subject'
        and definition.assessment_kind = 'quiz'
        and definition.status = 'published'
        and question.id is not null
        and question.publication_ready is true
        and pg_catalog.lower(question.review_status) in ('approved', 'owner_override')
        and version_question.prompt_snapshot is not distinct from question.prompt_text
        and version_question.model_answer_snapshot is not distinct from question.model_answer
        and version_question.legal_basis_snapshot is not distinct from question.legal_basis
        and version_question.application_snapshot is not distinct from question.application_text
        and version_question.conclusion_snapshot is not distinct from question.conclusion_text
        and version_question.jurisprudence_snapshot is not distinct from question.jurisprudence
        and version_question.citation_snapshot is not distinct from question.citation
        and version_question.governing_provision_snapshot
          is not distinct from question.governing_provision
        and version_question.source_urls_snapshot is not distinct from question.source_urls
      )
  ) then
    raise exception 'SUBJECT_MATTER_INCREMENTAL_SNAPSHOT_REPAIR_INTEGRITY';
  end if;

  with candidates as (
    select distinct version.id as version_id, version_question.question_id
    from public.subject_matter_placements placement
    join public.examination_definitions definition
      on definition.id = placement.exam_id
    join public.examination_versions version
      on version.exam_id = definition.id
    join public.examination_version_questions version_question
      on version_question.version_id = version.id
     and version_question.question_id = placement.question_id
    join public.examination_questions question
      on question.id = version_question.question_id
    where version.label = 'Incremental reviewed question'
      and version.status = 'published'
      and version.question_count = 1
      and definition.track = 'per_subject'
      and definition.assessment_kind = 'quiz'
      and definition.status = 'published'
      and question.publication_ready is true
      and pg_catalog.lower(question.review_status) in ('approved', 'owner_override')
      and version_question.snapshot_hash = version.snapshot_hash
      and question.content_hash <> version_question.snapshot_hash
      and version_question.prompt_snapshot is not distinct from question.prompt_text
      and version_question.model_answer_snapshot is not distinct from question.model_answer
      and version_question.legal_basis_snapshot is not distinct from question.legal_basis
      and version_question.application_snapshot is not distinct from question.application_text
      and version_question.conclusion_snapshot is not distinct from question.conclusion_text
      and version_question.jurisprudence_snapshot is not distinct from question.jurisprudence
      and version_question.citation_snapshot is not distinct from question.citation
      and version_question.governing_provision_snapshot
        is not distinct from question.governing_provision
      and version_question.source_urls_snapshot is not distinct from question.source_urls
      and (
        p_source_digest is null
        or placement.source_digest = pg_catalog.lower(pg_catalog.btrim(p_source_digest))
      )
  )
  select
    pg_catalog.array_agg(distinct candidate.version_id),
    pg_catalog.count(*)::integer
  into v_version_ids, v_candidate_count
  from candidates candidate;

  if v_candidate_count = 0 then
    return 0;
  end if;

  update public.examination_versions version
  set status = 'draft'
  where version.id = any(v_version_ids)
    and version.status = 'published';
  get diagnostics v_version_count = row_count;

  if v_version_count <> pg_catalog.cardinality(v_version_ids) then
    raise exception 'SUBJECT_MATTER_INCREMENTAL_SNAPSHOT_REPAIR_VERSION_RACE';
  end if;

  update public.examination_version_questions version_question
  set snapshot_hash = question.content_hash
  from public.examination_questions question
  where version_question.version_id = any(v_version_ids)
    and question.id = version_question.question_id
    and version_question.snapshot_hash <> question.content_hash;
  get diagnostics v_repaired_count = row_count;

  if v_repaired_count <> v_candidate_count then
    raise exception 'SUBJECT_MATTER_INCREMENTAL_SNAPSHOT_REPAIR_COUNT_MISMATCH';
  end if;

  update public.examination_versions version
  set status = 'published'
  where version.id = any(v_version_ids)
    and version.status = 'draft';
  get diagnostics v_version_count = row_count;

  if v_version_count <> pg_catalog.cardinality(v_version_ids)
     or exists (
       select 1
       from public.examination_version_questions version_question
       join public.examination_questions question
         on question.id = version_question.question_id
       where version_question.version_id = any(v_version_ids)
         and version_question.snapshot_hash <> question.content_hash
     )
  then
    raise exception 'SUBJECT_MATTER_INCREMENTAL_SNAPSHOT_REPAIR_INCOMPLETE';
  end if;

  return v_repaired_count;
end;
$subject_matter_repair_incremental_snapshot_hash_v1$;

revoke all on function public.subject_matter_repair_incremental_snapshot_hash_v1(text)
  from public, anon, authenticated, service_role;

create or replace function public.subject_matter_sync_incremental_v1(
  p_actor_user_id uuid,
  p_rows jsonb,
  p_source_digest text,
  p_source_endpoint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $subject_matter_sync_incremental_v1$
declare
  v_result jsonb;
begin
  v_result := public.subject_matter_sync_incremental_v1_legacy_snapshot_hash(
    p_actor_user_id,
    p_rows,
    p_source_digest,
    p_source_endpoint
  );

  perform public.subject_matter_repair_incremental_snapshot_hash_v1(
    pg_catalog.lower(pg_catalog.btrim(p_source_digest))
  );

  return v_result;
end;
$subject_matter_sync_incremental_v1$;

revoke all on function public.subject_matter_sync_incremental_v1(
  uuid, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.subject_matter_sync_incremental_v1(
  uuid, jsonb, text, text
) to service_role;

do $subject_matter_repair_existing_incremental_rows$
begin
  perform public.subject_matter_repair_incremental_snapshot_hash_v1(null);
end;
$subject_matter_repair_existing_incremental_rows$;

comment on function public.subject_matter_sync_incremental_v1(
  uuid, jsonb, text, text
) is
  'Admin-only incremental Syllabus-Based Review sync with exact question-content snapshot hashes and fail-closed legacy metadata repair.';

comment on function public.subject_matter_repair_incremental_snapshot_hash_v1(text) is
  'Internal exact-match repair for the 20260824172933 incremental importer snapshot-hash metadata defect; not executable by API roles.';

commit;

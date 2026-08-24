-- Additive, chunked transport for reviewed Syllabus-Based Review placements.
-- It never deletes or rewrites an existing placement, version, attempt, answer,
-- submission, or grade. New one-question definitions become visible only after
-- their immutable snapshot is complete inside the finalization transaction.

begin;
set local lock_timeout = '250ms';
set local statement_timeout = '5s';

create table if not exists public.subject_matter_incremental_syncs_v1 (
  source_digest text primary key check (source_digest ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid not null,
  source_endpoint text not null,
  imported_count integer not null check (imported_count between 1 and 5000),
  response_json jsonb not null check (jsonb_typeof(response_json) = 'object'),
  created_at timestamptz not null default now()
);

alter table public.subject_matter_incremental_syncs_v1 enable row level security;
alter table public.subject_matter_incremental_syncs_v1 force row level security;
revoke all on public.subject_matter_incremental_syncs_v1
  from public, anon, authenticated;
grant select on public.subject_matter_incremental_syncs_v1 to service_role;

commit;

begin;
set local lock_timeout = '250ms';
set local statement_timeout = '5s';

create table if not exists public.subject_matter_incremental_staging_v1 (
  sync_id uuid not null,
  part_number smallint not null,
  actor_user_id uuid not null,
  total_parts smallint not null,
  source_digest text not null,
  source_endpoint text not null,
  payload_hash text not null,
  rows_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key (sync_id, part_number),
  constraint subject_matter_incremental_stage_part_check
    check (part_number between 1 and total_parts and total_parts between 1 and 200),
  constraint subject_matter_incremental_stage_digest_check
    check (source_digest ~ '^[0-9a-f]{64}$'),
  constraint subject_matter_incremental_stage_payload_hash_check
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint subject_matter_incremental_stage_rows_check
    check (jsonb_typeof(rows_json) = 'array'
      and jsonb_array_length(rows_json) between 1 and 100)
);

create index if not exists subject_matter_incremental_staging_created_idx
  on public.subject_matter_incremental_staging_v1(created_at);

alter table public.subject_matter_incremental_staging_v1 enable row level security;
alter table public.subject_matter_incremental_staging_v1 force row level security;
revoke all on public.subject_matter_incremental_staging_v1
  from public, anon, authenticated;
grant select on public.subject_matter_incremental_staging_v1 to service_role;

commit;

begin;
set local statement_timeout = '5min';

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
  v_row jsonb;
  v_existing public.subject_matter_incremental_syncs_v1%rowtype;
  v_source_kind text;
  v_source_question_id text;
  v_course_code text;
  v_course_name text;
  v_subject text;
  v_topic text;
  v_difficulty text;
  v_classification text;
  v_placement_type text;
  v_content_hash text;
  v_prompt text;
  v_answer text;
  v_legal_basis text;
  v_question_id uuid;
  v_exam_id uuid;
  v_exam_public_id uuid;
  v_version_id uuid;
  v_version_hash text;
  v_year smallint;
  v_term smallint;
  v_slot integer;
  v_imported integer := 0;
  v_response jsonb;
  v_total_placements integer;
  v_courses_at_100 integer;
begin
  perform public.examination_require_admin(p_actor_user_id);
  if jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) not between 1 and 5000
     or coalesce(p_source_digest, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_source_endpoint, '')
       not like 'https://docs.google.com/spreadsheets/%'
  then
    raise exception 'SUBJECT_MATTER_INCREMENTAL_SOURCE_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'subject-matter-incremental-v1', 0
  ));

  select * into v_existing
  from public.subject_matter_incremental_syncs_v1 sync
  where sync.source_digest = lower(p_source_digest)
  for update;
  if v_existing.source_digest is not null then
    if v_existing.actor_user_id <> p_actor_user_id
       or v_existing.source_endpoint <> p_source_endpoint
       or v_existing.imported_count <> jsonb_array_length(p_rows)
    then
      raise exception 'SUBJECT_MATTER_INCREMENTAL_SYNC_CONFLICT';
    end if;
    return v_existing.response_json || jsonb_build_object('replayed', true);
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) item(value)
    where jsonb_typeof(item.value) <> 'object'
       or item.value->>'sourceKind' not in ('canonical', 'authored')
       or char_length(btrim(coalesce(item.value->>'questionId', ''))) not between 3 and 200
       or char_length(btrim(coalesce(item.value->>'courseCode', ''))) not between 2 and 40
       or char_length(btrim(coalesce(item.value->>'courseName', ''))) not between 2 and 120
       or coalesce(item.value->>'yearLevel', '') !~ '^[1-4]$'
       or coalesce(item.value->>'term', '') !~ '^[1-3]$'
       or coalesce(item.value->>'slot', '') !~ '^[1-9][0-9]?$|^100$'
       or item.value->>'classification' not in ('major', 'minor')
       or item.value->>'placementType' not in ('direct', 'integration')
       or char_length(btrim(coalesce(item.value->>'subject', ''))) not between 2 and 120
       or item.value->>'difficulty' not in ('Easy', 'Medium', 'Hard')
       or lower(btrim(coalesce(item.value->>'publicationReady', ''))) not in ('yes', 'true')
       or lower(btrim(coalesce(item.value->>'contentHash', ''))) !~ '^[0-9a-f]{64}$'
       or (
         item.value->>'sourceKind' = 'authored'
         and (
           char_length(btrim(coalesce(item.value->>'prompt', ''))) < 20
           or char_length(btrim(coalesce(item.value->>'suggestedAnswer', ''))) < 20
           or char_length(btrim(coalesce(item.value->>'legalBasis', ''))) < 10
           or jsonb_typeof(coalesce(item.value->'jurisprudence', '[]'::jsonb)) <> 'array'
           or jsonb_typeof(coalesce(item.value->'sourceUrls', '[]'::jsonb)) <> 'array'
         )
       )
  ) then
    raise exception 'SUBJECT_MATTER_INCREMENTAL_ROW_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as incoming(
      "courseCode" text, slot integer, "questionId" text
    )
    group by incoming."courseCode", incoming.slot
    having count(*) <> 1
  ) or exists (
    select 1
    from jsonb_to_recordset(p_rows) as incoming(
      "courseCode" text, slot integer, "questionId" text
    )
    group by incoming."courseCode", incoming."questionId"
    having count(*) <> 1
  ) then
    raise exception 'SUBJECT_MATTER_INCREMENTAL_DUPLICATE';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as incoming(
      "courseCode" text, "courseName" text, "yearLevel" smallint,
      term smallint, classification text, "placementType" text
    )
    where not exists (
      select 1
      from public.subject_matter_placements existing
      where existing.course_code = incoming."courseCode"
        and existing.course_name = incoming."courseName"
        and existing.year_level = incoming."yearLevel"
        and existing.term = incoming.term
        and existing.classification = incoming.classification
    )
  ) then
    raise exception 'SUBJECT_MATTER_INCREMENTAL_COURSE_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as incoming(
      "courseCode" text, slot integer, "questionId" text
    )
    join public.subject_matter_placements existing
      on existing.course_code = incoming."courseCode"
     and (
       existing.slot = incoming.slot
       or existing.source_key = incoming."questionId"
     )
  ) then
    raise exception 'SUBJECT_MATTER_INCREMENTAL_PLACEMENT_CONFLICT';
  end if;

  if exists (
    with incoming as (
      select row."courseCode" as course_code, count(*)::integer as additions
      from jsonb_to_recordset(p_rows) as row("courseCode" text)
      group by row."courseCode"
    ), current_counts as (
      select placement.course_code, count(*)::integer as current_count
      from public.subject_matter_placements placement
      group by placement.course_code
    )
    select 1
    from incoming
    join current_counts using (course_code)
    where current_counts.current_count + incoming.additions > 100
  ) then
    raise exception 'SUBJECT_MATTER_INCREMENTAL_COURSE_LIMIT';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_source_kind := btrim(v_row->>'sourceKind');
    v_source_question_id := btrim(v_row->>'questionId');
    v_course_code := btrim(v_row->>'courseCode');
    v_course_name := btrim(v_row->>'courseName');
    v_year := (v_row->>'yearLevel')::smallint;
    v_term := (v_row->>'term')::smallint;
    v_slot := (v_row->>'slot')::integer;
    v_subject := btrim(v_row->>'subject');
    v_topic := nullif(btrim(coalesce(v_row->>'topic', '')), '');
    v_difficulty := btrim(v_row->>'difficulty');
    v_classification := btrim(v_row->>'classification');
    v_placement_type := btrim(v_row->>'placementType');
    v_content_hash := lower(btrim(v_row->>'contentHash'));

    if v_source_kind = 'canonical' then
      v_question_id := public.release_deterministic_uuid(
        'bar-feels-question:' || v_source_question_id
      );
      if not exists (
        select 1
        from public.examination_questions question
        where question.id = v_question_id
          and question.source_type = 'google_sheet'
          and question.source_key = 'bar-feels:' || v_source_question_id
          and question.owner_user_id is null
          and question.publication_ready
          and question.review_status in ('approved', 'owner_override')
          and question.content_hash = v_content_hash
      ) then
        raise exception 'SUBJECT_MATTER_INCREMENTAL_CANONICAL_INVALID:%', v_source_question_id;
      end if;
    else
      v_question_id := public.release_deterministic_uuid(
        'subject-matter-addition-question:' || v_source_question_id
      );
      v_prompt := btrim(v_row->>'prompt');
      v_answer := btrim(v_row->>'suggestedAnswer');
      v_legal_basis := btrim(v_row->>'legalBasis');

      insert into public.examination_questions (
        id, source_key, source_type, owner_user_id, subject, topic,
        difficulty, prompt_text, model_answer, legal_basis, doctrine,
        application_text, conclusion_text, jurisprudence, citation,
        governing_provision, source_urls, source_metadata, review_status,
        publication_ready, content_hash, source_updated_at, approved_at,
        approved_by
      ) values (
        v_question_id,
        'subject-matter-addition:' || v_source_question_id,
        'google_sheet',
        null,
        v_subject,
        v_topic,
        nullif(v_row->>'originalDifficulty', ''),
        v_prompt,
        v_answer,
        v_legal_basis,
        nullif(v_row->>'doctrine', ''),
        nullif(v_row->>'application', ''),
        nullif(v_row->>'conclusion', ''),
        coalesce(v_row->'jurisprudence', '[]'::jsonb),
        nullif(v_row->>'citation', ''),
        v_legal_basis,
        coalesce(v_row->'sourceUrls', '[]'::jsonb),
        jsonb_build_object(
          'spreadsheetId', '1DgDe_ObIoiTy9NJ3DmdM1ec7h7t0FS7RvFhBTjubZ8A',
          'sheetName', 'SBR Additions',
          'originalQuestionId', v_source_question_id,
          'feature', 'syllabus_based_review',
          'courseCode', v_course_code,
          'courseName', v_course_name,
          'yearLevel', v_year,
          'term', v_term,
          'sourceBatchId', nullif(v_row->>'sourceBatchId', ''),
          'publicationReady', 'Yes'
        ),
        'approved',
        true,
        v_content_hash,
        now(),
        now(),
        p_actor_user_id
      )
      on conflict (id) do nothing;

      if not exists (
        select 1
        from public.examination_questions question
        where question.id = v_question_id
          and question.source_key = 'subject-matter-addition:' || v_source_question_id
          and question.source_type = 'google_sheet'
          and question.owner_user_id is null
          and question.publication_ready
          and question.review_status = 'approved'
          and question.content_hash = v_content_hash
      ) then
        raise exception 'SUBJECT_MATTER_INCREMENTAL_AUTHORED_CONFLICT:%', v_source_question_id;
      end if;
    end if;

    v_exam_id := public.release_deterministic_uuid(
      'subject-matter-incremental-exam:' || v_course_code || ':' || v_source_question_id
    );
    v_exam_public_id := public.release_deterministic_uuid(
      'subject-matter-incremental-public:' || v_course_code || ':' || v_source_question_id
    );
    v_version_hash := encode(extensions.digest(
      v_course_code || ':' || v_source_question_id || ':' || v_content_hash,
      'sha256'
    ), 'hex');
    v_version_id := public.release_deterministic_uuid(
      'subject-matter-incremental-version:' || v_course_code || ':'
        || v_source_question_id || ':' || v_content_hash
    );

    insert into public.examination_definitions (
      id, public_id, track, assessment_kind, title, subject, year_level,
      semester, owner_user_id, test_only, status, active_version_id,
      created_by
    ) values (
      v_exam_id,
      v_exam_public_id,
      'per_subject',
      'quiz',
      left(v_course_name || ' — Syllabus Review ' || v_source_question_id, 180),
      v_course_name,
      v_year,
      v_term,
      null,
      false,
      'draft',
      null,
      p_actor_user_id
    )
    on conflict (id) do nothing;

    if not exists (
      select 1
      from public.examination_definitions definition
      where definition.id = v_exam_id
        and definition.public_id = v_exam_public_id
        and definition.track = 'per_subject'
        and definition.assessment_kind = 'quiz'
        and definition.subject = v_course_name
        and definition.year_level = v_year
        and definition.semester = v_term
        and definition.owner_user_id is null
        and not definition.test_only
    ) then
      raise exception 'SUBJECT_MATTER_INCREMENTAL_DEFINITION_CONFLICT:%', v_source_question_id;
    end if;

    insert into public.examination_versions (
      id, exam_id, version_number, label, duration_seconds,
      default_timer_mode, allowed_timer_modes, grading_route,
      answer_release_rule, release_at, instructions, syllabus,
      question_count, status, snapshot_hash, created_by, published_at
    ) values (
      v_version_id,
      v_exam_id,
      1,
      'Incremental reviewed question',
      720,
      'none',
      '["strict","selfPaced","none"]'::jsonb,
      'ai',
      'after_ai',
      null,
      'Answer using A.L.A.C.: Answer, Legal Basis, Application, and Conclusion.',
      jsonb_build_array(v_course_name, v_topic),
      1,
      'draft',
      v_version_hash,
      p_actor_user_id,
      null
    )
    on conflict (id) do nothing;

    if not exists (
      select 1
      from public.examination_versions version
      where version.id = v_version_id
        and version.exam_id = v_exam_id
        and version.version_number = 1
        and version.question_count = 1
        and version.snapshot_hash = v_version_hash
    ) then
      raise exception 'SUBJECT_MATTER_INCREMENTAL_VERSION_CONFLICT:%', v_source_question_id;
    end if;

    insert into public.examination_version_questions (
      version_id, question_id, ordinal, prompt_snapshot,
      model_answer_snapshot, legal_basis_snapshot, application_snapshot,
      conclusion_snapshot, jurisprudence_snapshot, citation_snapshot,
      governing_provision_snapshot, source_urls_snapshot, snapshot_hash
    )
    select
      v_version_id,
      question.id,
      1,
      question.prompt_text,
      question.model_answer,
      question.legal_basis,
      question.application_text,
      question.conclusion_text,
      question.jurisprudence,
      question.citation,
      question.governing_provision,
      question.source_urls,
      v_version_hash
    from public.examination_questions question
    where question.id = v_question_id
    on conflict (version_id, question_id) do nothing;

    if not exists (
      select 1
      from public.examination_version_questions version_question
      where version_question.version_id = v_version_id
        and version_question.question_id = v_question_id
        and version_question.ordinal = 1
        and version_question.snapshot_hash = v_version_hash
    ) then
      raise exception 'SUBJECT_MATTER_INCREMENTAL_SNAPSHOT_CONFLICT:%', v_source_question_id;
    end if;

    update public.examination_versions
    set status = 'published',
        published_at = coalesce(published_at, now())
    where id = v_version_id
      and status in ('draft', 'published');

    update public.examination_definitions
    set status = 'published',
        active_version_id = v_version_id,
        updated_at = now()
    where id = v_exam_id
      and status in ('draft', 'published');

    insert into public.subject_matter_placements (
      course_code, slot, course_name, year_level, term, classification,
      placement_type, feeder_subject, difficulty, source_key, question_id,
      exam_id, source_digest, placement_digest
    ) values (
      v_course_code,
      v_slot,
      v_course_name,
      v_year,
      v_term,
      v_classification,
      v_placement_type,
      v_subject,
      v_difficulty,
      v_source_question_id,
      v_question_id,
      v_exam_id,
      lower(p_source_digest),
      lower(p_source_digest)
    );
    v_imported := v_imported + 1;
  end loop;

  if v_imported <> jsonb_array_length(p_rows) then
    raise exception 'SUBJECT_MATTER_INCREMENTAL_COUNT_MISMATCH';
  end if;

  select count(*)::integer into v_total_placements
  from public.subject_matter_placements;
  select count(*)::integer into v_courses_at_100
  from (
    select placement.course_code
    from public.subject_matter_placements placement
    group by placement.course_code
    having count(*) = 100
  ) complete_courses;

  v_response := jsonb_build_object(
    'sourceDigest', lower(p_source_digest),
    'importedPlacements', v_imported,
    'totalPlacements', v_total_placements,
    'coursesAtOneHundred', v_courses_at_100,
    'replayed', false
  );
  insert into public.subject_matter_incremental_syncs_v1 (
    source_digest, actor_user_id, source_endpoint, imported_count, response_json
  ) values (
    lower(p_source_digest), p_actor_user_id, p_source_endpoint, v_imported, v_response
  );
  return v_response;
end;
$subject_matter_sync_incremental_v1$;

create or replace function public.subject_matter_stage_incremental_v1(
  p_actor_user_id uuid,
  p_sync_id uuid,
  p_part_number integer,
  p_total_parts integer,
  p_rows jsonb,
  p_source_digest text,
  p_source_endpoint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $subject_matter_stage_incremental_v1$
declare
  v_payload_hash text;
  v_existing public.subject_matter_incremental_staging_v1%rowtype;
  v_inserted boolean := false;
begin
  perform public.examination_require_admin(p_actor_user_id);
  if p_sync_id is null
     or p_part_number is null
     or p_total_parts is null
     or p_part_number not between 1 and p_total_parts
     or p_total_parts not between 1 and 200
     or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) not between 1 and 100
     or coalesce(p_source_digest, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_source_endpoint, '')
       not like 'https://docs.google.com/spreadsheets/%'
  then
    raise exception 'SUBJECT_MATTER_INCREMENTAL_STAGE_INVALID';
  end if;
  v_payload_hash := encode(extensions.digest(p_rows::text, 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'subject-matter-incremental-stage-v1:' || p_sync_id::text, 0
  ));

  if exists (
    select 1
    from public.subject_matter_incremental_staging_v1 staged
    where staged.sync_id = p_sync_id
      and (
        staged.actor_user_id <> p_actor_user_id
        or staged.total_parts <> p_total_parts
        or staged.source_digest <> lower(p_source_digest)
        or staged.source_endpoint <> p_source_endpoint
      )
  ) then
    raise exception 'SUBJECT_MATTER_INCREMENTAL_STAGE_CONFLICT';
  end if;

  insert into public.subject_matter_incremental_staging_v1 (
    sync_id, part_number, actor_user_id, total_parts, source_digest,
    source_endpoint, payload_hash, rows_json
  ) values (
    p_sync_id, p_part_number, p_actor_user_id, p_total_parts,
    lower(p_source_digest), p_source_endpoint, v_payload_hash, p_rows
  )
  on conflict (sync_id, part_number) do nothing
  returning true into v_inserted;

  select * into v_existing
  from public.subject_matter_incremental_staging_v1
  where sync_id = p_sync_id and part_number = p_part_number;
  if v_existing.payload_hash <> v_payload_hash or v_existing.rows_json <> p_rows then
    raise exception 'SUBJECT_MATTER_INCREMENTAL_STAGE_CONFLICT';
  end if;
  return jsonb_build_object(
    'syncId', p_sync_id,
    'partNumber', p_part_number,
    'totalParts', p_total_parts,
    'acceptedRows', jsonb_array_length(p_rows),
    'replayed', not coalesce(v_inserted, false)
  );
end;
$subject_matter_stage_incremental_v1$;

create or replace function public.subject_matter_finalize_incremental_v1(
  p_actor_user_id uuid,
  p_sync_id uuid,
  p_source_digest text,
  p_source_endpoint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $subject_matter_finalize_incremental_v1$
declare
  v_total_parts integer;
  v_received_parts integer;
  v_rows jsonb;
  v_result jsonb;
begin
  perform public.examination_require_admin(p_actor_user_id);
  if p_sync_id is null
     or coalesce(p_source_digest, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_source_endpoint, '')
       not like 'https://docs.google.com/spreadsheets/%'
  then
    raise exception 'SUBJECT_MATTER_INCREMENTAL_FINALIZE_INVALID';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'subject-matter-incremental-stage-v1:' || p_sync_id::text, 0
  ));

  select max(staged.total_parts), count(*)
  into v_total_parts, v_received_parts
  from public.subject_matter_incremental_staging_v1 staged
  where staged.sync_id = p_sync_id
    and staged.actor_user_id = p_actor_user_id
    and staged.source_digest = lower(p_source_digest)
    and staged.source_endpoint = p_source_endpoint;
  if v_total_parts is null
     or v_received_parts <> v_total_parts
     or exists (
       select 1
       from generate_series(1, v_total_parts) expected(part_number)
       where not exists (
         select 1
         from public.subject_matter_incremental_staging_v1 staged
         where staged.sync_id = p_sync_id
           and staged.part_number = expected.part_number
       )
     )
  then
    raise exception 'SUBJECT_MATTER_INCREMENTAL_STAGE_INCOMPLETE';
  end if;

  select jsonb_agg(item.value order by staged.part_number, item.ordinality)
  into v_rows
  from public.subject_matter_incremental_staging_v1 staged
  cross join lateral jsonb_array_elements(staged.rows_json)
    with ordinality as item(value, ordinality)
  where staged.sync_id = p_sync_id;

  v_result := public.subject_matter_sync_incremental_v1(
    p_actor_user_id,
    v_rows,
    lower(p_source_digest),
    p_source_endpoint
  );
  delete from public.subject_matter_incremental_staging_v1
  where sync_id = p_sync_id;
  return v_result || jsonb_build_object(
    'stagedParts', v_total_parts,
    'stagedRows', jsonb_array_length(v_rows)
  );
end;
$subject_matter_finalize_incremental_v1$;

revoke all on function public.subject_matter_sync_incremental_v1(
  uuid, jsonb, text, text
) from public, anon, authenticated;
revoke all on function public.subject_matter_stage_incremental_v1(
  uuid, uuid, integer, integer, jsonb, text, text
) from public, anon, authenticated;
revoke all on function public.subject_matter_finalize_incremental_v1(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.subject_matter_sync_incremental_v1(
  uuid, jsonb, text, text
) to service_role;
grant execute on function public.subject_matter_stage_incremental_v1(
  uuid, uuid, integer, integer, jsonb, text, text
) to service_role;
grant execute on function public.subject_matter_finalize_incremental_v1(
  uuid, uuid, text, text
) to service_role;

commit;

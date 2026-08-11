-- Due Diligence: exact two-bank Subject Matter curriculum consolidation.
--
-- Additive, zero-downtime migration. It introduces a protected placement layer
-- for 1,890 curriculum placements while preserving canonical questions,
-- immutable examination versions, attempts, responses, submissions, and grades.
-- The migration contains no question or answer text. The trusted Worker imports
-- the reviewed destination bank and the committed placement manifest afterward.

begin;

create table if not exists public.subject_matter_placements (
  course_code text not null
    check (char_length(btrim(course_code)) between 2 and 40),
  -- Legacy production pools briefly contain up to 60 rows. The trusted v2
  -- importer separately enforces the final reviewed 20/50 course targets.
  slot integer not null check (slot between 1 and 200),
  course_name text not null
    check (char_length(btrim(course_name)) between 2 and 120),
  year_level smallint not null check (year_level between 1 and 4),
  term smallint not null check (term between 1 and 3),
  classification text not null
    check (classification in ('major', 'minor', 'legacy')),
  placement_type text not null
    check (placement_type in ('direct', 'integration')),
  feeder_subject text not null
    check (char_length(btrim(feeder_subject)) between 2 and 160),
  difficulty text not null
    check (difficulty in ('Easy', 'Medium', 'Hard')),
  source_key text not null,
  question_id uuid not null
    references public.examination_questions(id) on delete restrict,
  exam_id uuid not null
    references public.examination_definitions(id) on delete restrict,
  source_digest text not null check (source_digest ~ '^[0-9a-f]{64}$'),
  placement_digest text not null check (placement_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (course_code, slot),
  unique (course_code, question_id),
  unique (exam_id)
);

create index if not exists subject_matter_placements_catalog_idx
  on public.subject_matter_placements (year_level, term, course_name, slot);
create index if not exists subject_matter_placements_question_idx
  on public.subject_matter_placements (question_id);

alter table public.subject_matter_placements enable row level security;
alter table public.subject_matter_placements force row level security;
revoke all on public.subject_matter_placements
  from public, anon, authenticated;
grant select, insert, update, delete on public.subject_matter_placements
  to service_role;

-- Preserve the currently published catalog during the database-first release.
-- These legacy placement rows are atomically replaced by the exact reviewed
-- manifest when release_sync_subject_matter_v2 succeeds.
with legacy_catalog as (
  select
    d.id as exam_id,
    d.subject as course_name,
    d.year_level,
    d.semester as term,
    q.id as question_id,
    q.source_key,
    q.subject as feeder_subject,
    case lower(btrim(coalesce(q.difficulty, '')))
      when 'easy' then 'Easy'
      when 'foundational' then 'Easy'
      when 'hard' then 'Hard'
      when 'advanced' then 'Hard'
      else 'Medium'
    end as difficulty,
    coalesce(
      nullif(btrim(q.source_metadata->>'courseCode'), ''),
      'LEGACY-' || upper(substr(md5(coalesce(d.subject, d.id::text)), 1, 10))
    ) as course_code,
    row_number() over (
      partition by coalesce(
        nullif(btrim(q.source_metadata->>'courseCode'), ''),
        'LEGACY-' || upper(substr(md5(coalesce(d.subject, d.id::text)), 1, 10))
      )
      order by q.source_key, d.id
    )::integer as slot
  from public.examination_definitions d
  join public.examination_versions ev on ev.id = d.active_version_id
  join public.examination_version_questions vq on vq.version_id = ev.id
  join public.examination_questions q on q.id = vq.question_id
  where d.track = 'per_subject'
    and d.assessment_kind = 'quiz'
    and d.status = 'published'
    and ev.status = 'published'
    and ev.question_count = 1
)
insert into public.subject_matter_placements (
  course_code, slot, course_name, year_level, term, classification,
  placement_type, feeder_subject, difficulty, source_key, question_id,
  exam_id, source_digest, placement_digest
)
select
  course_code, slot, course_name, year_level, term, 'legacy',
  'direct', feeder_subject, difficulty, source_key, question_id, exam_id,
  repeat('0', 64), repeat('0', 64)
from legacy_catalog
on conflict (course_code, slot) do nothing;

create or replace function public.release_sync_subject_matter_v2(
  p_actor_user_id uuid,
  p_rows jsonb,
  p_source_digest text,
  p_source_endpoint text,
  p_placements jsonb,
  p_placement_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_import_result jsonb;
  v_placement jsonb;
  v_row jsonb;
  v_course_code text;
  v_course_name text;
  v_classification text;
  v_placement_type text;
  v_feeder_subject text;
  v_difficulty text;
  v_source_key text;
  v_source_content_hash text;
  v_content_hash text;
  v_question_id uuid;
  v_exam_id uuid;
  v_exam_public_id uuid;
  v_version_id uuid;
  v_version_number integer;
  v_version_hash text;
  v_year smallint;
  v_term smallint;
  v_slot integer;
  v_placements integer;
  v_courses integer;
  v_direct integer;
  v_integration integer;
  v_canonical integer;
  v_major_courses integer;
  v_minor_courses integer;
begin
  perform public.examination_require_admin(p_actor_user_id);
  if jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) <> 1622
     or jsonb_typeof(p_placements) <> 'array'
     or jsonb_array_length(p_placements) <> 1890
     or p_source_digest !~ '^[0-9a-f]{64}$'
     or p_placement_digest !~ '^[0-9a-f]{64}$'
     or p_source_endpoint !~ '^https://docs\.google\.com/spreadsheets/'
  then
    raise exception 'SUBJECT_MATTER_V2_SOURCE_INVALID';
  end if;

  select
    count(*)::integer,
    count(distinct p."courseCode")::integer,
    count(*) filter (where p."placementType" = 'direct')::integer,
    count(*) filter (where p."placementType" = 'integration')::integer,
    count(distinct p."questionId")::integer,
    count(distinct p."courseCode")
      filter (where p.classification = 'major')::integer,
    count(distinct p."courseCode")
      filter (where p.classification = 'minor')::integer
  into
    v_placements, v_courses, v_direct, v_integration, v_canonical,
    v_major_courses, v_minor_courses
  from jsonb_to_recordset(p_placements) as p(
    "courseCode" text,
    "courseName" text,
    "yearLevel" smallint,
    term smallint,
    classification text,
    slot integer,
    "questionId" text,
    "feederSubject" text,
    difficulty text,
    "placementType" text,
    "sourceContentHash" text
  );

  if v_placements <> 1890
     or v_courses <> 42
     or v_direct <> 1490
     or v_integration <> 400
     or v_canonical <> 1490
     or v_major_courses <> 35
     or v_minor_courses <> 7
  then
    raise exception 'SUBJECT_MATTER_V2_TOTALS_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_placements) as p(
      "courseCode" text, "courseName" text, "yearLevel" smallint,
      term smallint, classification text, slot integer, "questionId" text,
      "feederSubject" text, difficulty text, "placementType" text,
      "sourceContentHash" text
    )
    where char_length(btrim(coalesce(p."courseCode", ''))) not between 2 and 40
       or char_length(btrim(coalesce(p."courseName", ''))) not between 2 and 120
       or p."yearLevel" not between 1 and 4
       or p.term not between 1 and 3
       or p.classification not in ('major', 'minor')
       or p.slot not between 1 and 50
       or char_length(btrim(coalesce(p."questionId", ''))) < 3
       or char_length(btrim(coalesce(p."feederSubject", ''))) not between 2 and 160
       or p.difficulty not in ('Easy', 'Medium', 'Hard')
       or p."placementType" not in ('direct', 'integration')
       or p."sourceContentHash" !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'SUBJECT_MATTER_V2_PLACEMENT_INVALID';
  end if;

  if exists (
    select 1
    from (
      select p."courseCode", count(*) as placement_count,
        min(p."courseName") as first_name,
        max(p."courseName") as last_name,
        min(p."yearLevel") as first_year,
        max(p."yearLevel") as last_year,
        min(p.term) as first_term,
        max(p.term) as last_term,
        min(p.classification) as first_classification,
        max(p.classification) as last_classification,
        count(distinct p.slot) as distinct_slots,
        count(distinct p."questionId") as distinct_questions
      from jsonb_to_recordset(p_placements) as p(
        "courseCode" text, "courseName" text, "yearLevel" smallint,
        term smallint, classification text, slot integer, "questionId" text,
        "feederSubject" text, difficulty text, "placementType" text,
        "sourceContentHash" text
      )
      group by p."courseCode"
    ) grouped
    where first_name <> last_name
       or first_year <> last_year
       or first_term <> last_term
       or first_classification <> last_classification
       or placement_count <> distinct_slots
       or placement_count <> distinct_questions
       or placement_count <> case first_classification when 'major' then 50 else 20 end
  ) then
    raise exception 'SUBJECT_MATTER_V2_COURSE_ALLOCATION_INVALID';
  end if;

  if exists (
    select 1
    from (
      select p."questionId", count(*) as reuse_count,
        count(*) filter (where p."placementType" = 'direct') as direct_count,
        count(*) filter (where p."placementType" = 'integration') as integration_count
      from jsonb_to_recordset(p_placements) as p(
        "courseCode" text, "courseName" text, "yearLevel" smallint,
        term smallint, classification text, slot integer, "questionId" text,
        "feederSubject" text, difficulty text, "placementType" text,
        "sourceContentHash" text
      )
      group by p."questionId"
    ) reused
    where reuse_count not between 1 and 2
       or direct_count <> 1
       or integration_count <> reuse_count - 1
  ) then
    raise exception 'SUBJECT_MATTER_V2_REUSE_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_placements) as p(
      "courseCode" text, "courseName" text, "yearLevel" smallint,
      term smallint, classification text, slot integer, "questionId" text,
      "feederSubject" text, difficulty text, "placementType" text,
      "sourceContentHash" text
    )
    left join lateral (
      select value as row_value
      from jsonb_array_elements(p_rows)
      where value->>'questionId' = p."questionId"
      limit 1
    ) source_row on true
    where source_row.row_value is null
       or lower(source_row.row_value->>'contentHash') <> lower(p."sourceContentHash")
  ) then
    raise exception 'SUBJECT_MATTER_V2_CANONICAL_REFERENCE_INVALID';
  end if;

  -- The existing importer remains the single canonical-question writer. It is
  -- additive and preserves every immutable version and user attempt.
  v_import_result := public.release_sync_subject_matter(
    p_actor_user_id,
    p_rows,
    p_source_digest,
    p_source_endpoint
  );

  for v_placement in select value from jsonb_array_elements(p_placements)
  loop
    v_course_code := btrim(v_placement->>'courseCode');
    v_course_name := btrim(v_placement->>'courseName');
    v_year := (v_placement->>'yearLevel')::smallint;
    v_term := (v_placement->>'term')::smallint;
    v_classification := btrim(v_placement->>'classification');
    v_slot := (v_placement->>'slot')::integer;
    v_source_key := btrim(v_placement->>'questionId');
    v_feeder_subject := btrim(v_placement->>'feederSubject');
    v_difficulty := btrim(v_placement->>'difficulty');
    v_placement_type := btrim(v_placement->>'placementType');
    v_source_content_hash := lower(btrim(v_placement->>'sourceContentHash'));

    select value into v_row
    from jsonb_array_elements(p_rows)
    where value->>'questionId' = v_source_key
    limit 1;

    select id, content_hash
    into v_question_id, v_content_hash
    from public.examination_questions
    where source_type = 'google_sheet'
      and source_key = v_source_key
      and owner_user_id is null;

    if v_question_id is null
       or v_content_hash <> v_source_content_hash
       or v_row is null
    then
      raise exception 'SUBJECT_MATTER_V2_QUESTION_IMPORT_INVALID:%', v_source_key;
    end if;

    if v_placement_type = 'direct' then
      v_exam_id := public.release_deterministic_uuid(
        'leb-exam:' || v_source_key
      );
      v_exam_public_id := public.release_deterministic_uuid(
        'leb-exam-public:' || v_source_key
      );
      v_version_id := public.release_deterministic_uuid(
        'leb-version:' || v_source_key || ':' || v_content_hash
      );
      update public.examination_questions
      set difficulty = v_difficulty,
          source_metadata = source_metadata || jsonb_build_object(
            'yearLevel', v_year,
            'term', v_term,
            'courseCode', v_course_code,
            'curriculumPlacement', 'direct'
          ),
          updated_at = now()
      where id = v_question_id;
    else
      v_exam_id := public.release_deterministic_uuid(
        'leb-placement-exam:' || v_course_code || ':' || v_source_key
      );
      v_exam_public_id := public.release_deterministic_uuid(
        'leb-placement-exam-public:' || v_course_code || ':' || v_source_key
      );
      v_version_id := public.release_deterministic_uuid(
        'leb-placement-version:' || v_course_code || ':' || v_source_key
          || ':' || v_content_hash
      );
    end if;

    v_version_hash := encode(extensions.digest(
      v_content_hash || ':' || v_version_id::text,
      'sha256'
    ), 'hex');

    insert into public.examination_definitions (
      id, public_id, track, assessment_kind, title, subject, year_level,
      semester, owner_user_id, test_only, status, active_version_id,
      created_by
    )
    values (
      v_exam_id,
      v_exam_public_id,
      'per_subject',
      'quiz',
      v_course_name || ' — Subject Matter Practice',
      v_course_name,
      v_year,
      v_term,
      null,
      false,
      'published',
      null,
      p_actor_user_id
    )
    on conflict (id) do update
    set title = excluded.title,
        subject = excluded.subject,
        year_level = excluded.year_level,
        semester = excluded.semester,
        test_only = false,
        status = 'published',
        updated_at = now();

    if not exists (
      select 1 from public.examination_versions where id = v_version_id
    ) then
      select coalesce(max(version_number), 0) + 1
      into v_version_number
      from public.examination_versions
      where exam_id = v_exam_id;

      insert into public.examination_versions (
        id, exam_id, version_number, label, duration_seconds,
        default_timer_mode, allowed_timer_modes, grading_route,
        answer_release_rule, release_at, instructions, syllabus,
        question_count, status, snapshot_hash, created_by, published_at
      )
      values (
        v_version_id,
        v_exam_id,
        v_version_number,
        'Two-bank Subject Matter curriculum release',
        420,
        'strict',
        '["strict","selfPaced","none"]'::jsonb,
        'ai',
        'after_ai',
        null,
        'Answer using A.L.A.C.: Answer, Legal Basis, Application, and Conclusion.',
        jsonb_build_array(nullif(v_row->>'topic', '')),
        1,
        'draft',
        v_version_hash,
        p_actor_user_id,
        null
      );

      insert into public.examination_version_questions (
        version_id, question_id, ordinal, prompt_snapshot,
        model_answer_snapshot, legal_basis_snapshot, application_snapshot,
        conclusion_snapshot, jurisprudence_snapshot, citation_snapshot,
        governing_provision_snapshot, source_urls_snapshot, snapshot_hash
      )
      values (
        v_version_id,
        v_question_id,
        1,
        btrim(v_row->>'prompt'),
        btrim(v_row->>'suggestedAnswer'),
        btrim(v_row->>'legalBasis'),
        nullif(v_row#>>'{alac,application}', ''),
        nullif(v_row#>>'{alac,conclusion}', ''),
        coalesce(v_row->'jurisprudence', '[]'::jsonb),
        nullif(v_row->>'citation', ''),
        btrim(v_row->>'legalBasis'),
        coalesce(v_row->'sourceUrls', '[]'::jsonb),
        v_content_hash
      );

      update public.examination_versions
      set status = 'published', published_at = now()
      where id = v_version_id;
    end if;

    update public.examination_definitions
    set active_version_id = v_version_id,
        status = 'published',
        updated_at = now()
    where id = v_exam_id;

    delete from public.subject_matter_placements
    where exam_id = v_exam_id
      and (course_code <> v_course_code or slot <> v_slot);

    insert into public.subject_matter_placements (
      course_code, slot, course_name, year_level, term, classification,
      placement_type, feeder_subject, difficulty, source_key, question_id,
      exam_id, source_digest, placement_digest
    )
    values (
      v_course_code, v_slot, v_course_name, v_year, v_term,
      v_classification, v_placement_type, v_feeder_subject, v_difficulty,
      v_source_key, v_question_id, v_exam_id, p_source_digest,
      p_placement_digest
    )
    on conflict (course_code, slot) do update
    set course_name = excluded.course_name,
        year_level = excluded.year_level,
        term = excluded.term,
        classification = excluded.classification,
        placement_type = excluded.placement_type,
        feeder_subject = excluded.feeder_subject,
        difficulty = excluded.difficulty,
        source_key = excluded.source_key,
        question_id = excluded.question_id,
        exam_id = excluded.exam_id,
        source_digest = excluded.source_digest,
        placement_digest = excluded.placement_digest,
        updated_at = now();
  end loop;

  delete from public.subject_matter_placements
  where placement_digest <> p_placement_digest;

  if (select count(*) from public.subject_matter_placements) <> 1890
     or (select count(distinct course_code) from public.subject_matter_placements) <> 42
     or (select count(distinct question_id) from public.subject_matter_placements) <> 1490
  then
    raise exception 'SUBJECT_MATTER_V2_FINAL_STATE_INVALID';
  end if;

  return jsonb_build_object(
    'rows', (v_import_result->>'rows')::integer,
    'canonicalQuestions', 1490,
    'placements', 1890,
    'directPlacements', 1490,
    'integrationPlacements', 400,
    'courses', 42,
    'sourceDigest', p_source_digest,
    'placementDigest', p_placement_digest
  );
end;
$$;

revoke all on function public.release_sync_subject_matter_v2(
  uuid, jsonb, text, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.release_sync_subject_matter_v2(
  uuid, jsonb, text, text, jsonb, text
) to service_role;

create or replace function public.release_sync_all_content_v2(
  p_actor_user_id uuid,
  p_subject_rows jsonb,
  p_subject_digest text,
  p_subject_endpoint text,
  p_subject_placements jsonb,
  p_placement_digest text,
  p_bar_groups jsonb,
  p_bar_digest text,
  p_bar_endpoint text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subject_result jsonb;
  v_bar_result jsonb;
begin
  v_subject_result := public.release_sync_subject_matter_v2(
    p_actor_user_id,
    p_subject_rows,
    p_subject_digest,
    p_subject_endpoint,
    p_subject_placements,
    p_placement_digest
  );
  v_bar_result := public.release_sync_bar_feels(
    p_actor_user_id,
    p_bar_groups,
    p_bar_digest,
    p_bar_endpoint
  );
  return jsonb_build_object(
    'subjectMatter', v_subject_result,
    'barFeels', v_bar_result
  );
end;
$$;

revoke all on function public.release_sync_all_content_v2(
  uuid, jsonb, text, text, jsonb, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.release_sync_all_content_v2(
  uuid, jsonb, text, text, jsonb, text, jsonb, text, text
) to service_role;

create or replace function public.subject_matter_catalog(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.examination_authorize_access(
    p_user_id, 'per_subject', null, null, false
  );
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(item order by year_level, term, course_code)
      from (
        select
          p.year_level,
          p.term,
          p.course_code,
          jsonb_build_object(
            'subject', p.course_name,
            'courseCode', p.course_code,
            'yearLevel', p.year_level,
            'term', p.term,
            'classification', p.classification,
            'questionCount', count(*),
            'completedCount', count(*) filter (
              where exists (
                select 1
                from public.examination_versions attempt_version
                join public.examination_attempts_multi a
                  on a.version_id = attempt_version.id
                join public.examination_submissions s on s.attempt_id = a.id
                where attempt_version.exam_id = p.exam_id
                  and a.user_id = p_user_id
              )
            )
          ) as item
        from public.subject_matter_placements p
        join public.examination_definitions d on d.id = p.exam_id
        join public.examination_versions v on v.id = d.active_version_id
        where d.track = 'per_subject'
          and d.assessment_kind = 'quiz'
          and d.status = 'published'
          and v.status = 'published'
          and v.question_count = 1
        group by p.year_level, p.term, p.course_code, p.course_name,
          p.classification
      ) grouped
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.subject_matter_next_question(
  p_user_id uuid,
  p_subject text,
  p_year_level smallint,
  p_term smallint,
  p_reset_cycle boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subject text := btrim(coalesce(p_subject, ''));
  v_cycle public.subject_matter_cycles%rowtype;
  v_question_id uuid;
  v_version_id uuid;
  v_version public.examination_versions%rowtype;
  v_definition public.examination_definitions%rowtype;
  v_total integer;
  v_completed integer;
begin
  perform public.examination_authorize_access(
    p_user_id, 'per_subject', null, null, false
  );
  if char_length(v_subject) not between 2 and 120
     or p_year_level not between 1 and 4
     or p_term not between 1 and 3
  then
    raise exception 'SUBJECT_MATTER_SELECTION_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'subject-cycle:' || p_user_id::text || ':' || v_subject
      || ':' || p_year_level::text || ':' || p_term::text,
    0
  ));

  insert into public.subject_matter_cycles (
    user_id, subject, year_level, term
  )
  values (p_user_id, v_subject, p_year_level, p_term)
  on conflict (user_id, subject, year_level, term) do nothing;

  select * into v_cycle
  from public.subject_matter_cycles
  where user_id = p_user_id
    and subject = v_subject
    and year_level = p_year_level
    and term = p_term
  for update;

  if p_reset_cycle then
    update public.subject_matter_cycles
    set seen_question_ids = '{}'::uuid[],
        active_version_id = null,
        cycle_number = cycle_number + 1,
        started_at = now(),
        updated_at = now()
    where user_id = p_user_id
      and subject = v_subject
      and year_level = p_year_level
      and term = p_term
    returning * into v_cycle;
  elsif v_cycle.active_version_id is not null
    and exists (
      select 1
      from public.examination_attempts_multi a
      join public.examination_submissions s on s.attempt_id = a.id
      where a.user_id = p_user_id
        and a.version_id = v_cycle.active_version_id
    )
  then
    select question_id into v_question_id
    from public.examination_version_questions
    where version_id = v_cycle.active_version_id
    limit 1;
    update public.subject_matter_cycles
    set seen_question_ids = case
          when v_question_id = any(seen_question_ids)
            then seen_question_ids
          else array_append(seen_question_ids, v_question_id)
        end,
        active_version_id = null,
        updated_at = now()
    where user_id = p_user_id
      and subject = v_subject
      and year_level = p_year_level
      and term = p_term
    returning * into v_cycle;
  end if;

  select count(*)::integer
  into v_total
  from public.subject_matter_placements p
  join public.examination_definitions d on d.id = p.exam_id
  join public.examination_versions ev on ev.id = d.active_version_id
  where p.course_name = v_subject
    and p.year_level = p_year_level
    and p.term = p_term
    and d.track = 'per_subject'
    and d.assessment_kind = 'quiz'
    and d.status = 'published'
    and ev.status = 'published'
    and ev.question_count = 1;

  if v_total = 0 then
    raise exception 'SUBJECT_MATTER_SUBJECT_NOT_FOUND';
  end if;

  if v_cycle.active_version_id is null then
    select ev.id
    into v_version_id
    from public.subject_matter_placements p
    join public.examination_definitions d on d.id = p.exam_id
    join public.examination_versions ev on ev.id = d.active_version_id
    join public.examination_version_questions vq on vq.version_id = ev.id
    where p.course_name = v_subject
      and p.year_level = p_year_level
      and p.term = p_term
      and d.track = 'per_subject'
      and d.assessment_kind = 'quiz'
      and d.status = 'published'
      and ev.status = 'published'
      and ev.question_count = 1
      and not (vq.question_id = any(v_cycle.seen_question_ids))
    order by random()
    limit 1;

    if v_version_id is null then
      return jsonb_build_object(
        'exhausted', true,
        'resetRequired', true,
        'subject', v_subject,
        'yearLevel', p_year_level,
        'term', p_term,
        'questionCount', v_total,
        'completedCount', cardinality(v_cycle.seen_question_ids),
        'cycleNumber', v_cycle.cycle_number
      );
    end if;

    select * into v_version
    from public.examination_versions
    where id = v_version_id;

    select * into v_definition
    from public.examination_definitions
    where active_version_id = v_version_id;

    update public.subject_matter_cycles
    set active_version_id = v_version_id,
        updated_at = now()
    where user_id = p_user_id
      and subject = v_subject
      and year_level = p_year_level
      and term = p_term
    returning * into v_cycle;
  else
    select * into v_version
    from public.examination_versions
    where id = v_cycle.active_version_id and status = 'published';
    select * into v_definition
    from public.examination_definitions
    where active_version_id = v_version.id and status = 'published';
    if v_version.id is null or v_definition.id is null then
      update public.subject_matter_cycles
      set active_version_id = null, updated_at = now()
      where user_id = p_user_id
        and subject = v_subject
        and year_level = p_year_level
        and term = p_term;
      raise exception 'SUBJECT_MATTER_SELECTION_STALE';
    end if;
  end if;

  v_completed := cardinality(v_cycle.seen_question_ids);
  return jsonb_build_object(
    'exhausted', false,
    'resetRequired', false,
    'subject', v_subject,
    'yearLevel', p_year_level,
    'term', p_term,
    'questionCount', v_total,
    'completedCount', v_completed,
    'cycleNumber', v_cycle.cycle_number,
    'setup', jsonb_build_object(
      'versionId', v_version.id,
      'track', 'per_subject',
      'assessmentKind', 'quiz',
      'title', v_definition.title,
      'subject', v_definition.subject,
      'questionCount', 1,
      'durationSeconds', v_version.duration_seconds,
      'timerMode', v_version.default_timer_mode,
      'allowedTimerModes', v_version.allowed_timer_modes,
      'instructions', v_version.instructions,
      'gradingRoute', v_version.grading_route,
      'answerReleaseRule', v_version.answer_release_rule
    )
  );
end;
$$;

revoke all on function public.subject_matter_catalog(uuid)
  from public, anon, authenticated;
revoke all on function public.subject_matter_next_question(
  uuid, text, smallint, smallint, boolean
) from public, anon, authenticated;
grant execute on function public.subject_matter_catalog(uuid)
  to service_role;
grant execute on function public.subject_matter_next_question(
  uuid, text, smallint, smallint, boolean
) to service_role;

commit;

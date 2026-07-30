-- Due Diligence complete beta release foundation.
--
-- This additive migration:
--   * imports owner-authorized Subject Matter content through trusted RPCs;
--   * publishes the deterministic six-destination Bar Feels manifest;
--   * adds server-side no-repeat Subject Matter selection and performance reads;
--   * extends Quorum with three atomic Affirm reactions and reference-faithful
--     supporting reads; and
--   * keeps all browser roles away from protected content and community tables.
--
-- The migration contains no examination answer content. The trusted Worker
-- imports the public source workbook after this schema is verified.

begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Shared release helpers
-- ---------------------------------------------------------------------------

create or replace function public.release_deterministic_uuid(p_seed text)
returns uuid
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select (
    substr(md5(coalesce(p_seed, '')), 1, 12)
    || '5'
    || substr(md5(coalesce(p_seed, '')), 14, 3)
    || '8'
    || substr(md5(coalesce(p_seed, '')), 18)
  )::uuid
$$;

revoke all on function public.release_deterministic_uuid(text)
  from public, anon, authenticated;
grant execute on function public.release_deterministic_uuid(text)
  to service_role;

-- Owner-authorized beta publication is not an editorial approval. Preserve the
-- source status and represent the explicit owner override truthfully.
alter table public.examination_questions
  drop constraint if exists examination_questions_review_status_check;
alter table public.examination_questions
  add constraint examination_questions_review_status_check
  check (review_status in ('pending', 'approved', 'rejected', 'owner_override'));

alter table public.examination_questions
  drop constraint if exists examination_questions_publication_truth_check;
alter table public.examination_questions
  add constraint examination_questions_publication_truth_check
  check (
    not publication_ready
    or (
      review_status in ('approved', 'owner_override')
      and model_answer is not null
      and char_length(btrim(model_answer)) >= 20
      and legal_basis is not null
      and char_length(btrim(legal_basis)) >= 10
      and source_type = 'google_sheet'
    )
  );

create table if not exists public.release_content_syncs (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  source_name text not null check (source_name in ('subject_matter', 'bar_feels')),
  source_digest text not null check (source_digest ~ '^[0-9a-f]{64}$'),
  source_endpoint text not null check (
    source_endpoint ~ '^https://docs\.google\.com/spreadsheets/'
  ),
  imported_count integer not null check (imported_count >= 0),
  subject_count integer not null check (subject_count >= 0),
  completed_at timestamptz not null default now(),
  unique (source_name, source_digest)
);

create table if not exists public.bar_feels_manifest (
  source_key text primary key,
  original_subject text not null,
  destination_subject text not null check (
    destination_subject in (
      'Political and Public International Law',
      'Commercial and Taxation Laws',
      'Civil Law',
      'Labor Law and Social Legislations',
      'Criminal Law',
      'Remedial Law, Legal and Judicial Ethics'
    )
  ),
  mapping_rationale text not null
    check (char_length(btrim(mapping_rationale)) between 20 and 1000),
  question_id uuid not null
    references public.examination_questions(id) on delete restrict,
  version_id uuid not null
    references public.examination_versions(id) on delete cascade,
  ordinal smallint not null check (ordinal between 1 and 20),
  source_digest text not null check (source_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (version_id, ordinal),
  unique (question_id)
);

create index if not exists bar_feels_manifest_destination_idx
  on public.bar_feels_manifest (destination_subject, ordinal);

create table if not exists public.subject_matter_cycles (
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null check (char_length(btrim(subject)) between 2 and 120),
  year_level smallint not null check (year_level between 1 and 4),
  term smallint not null check (term between 1 and 3),
  cycle_number integer not null default 1 check (cycle_number > 0),
  seen_question_ids uuid[] not null default '{}'::uuid[],
  active_version_id uuid references public.examination_versions(id)
    on delete set null,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, subject, year_level, term)
);

create index if not exists subject_matter_cycles_active_idx
  on public.subject_matter_cycles (user_id, active_version_id)
  where active_version_id is not null;

alter table public.release_content_syncs enable row level security;
alter table public.release_content_syncs force row level security;
alter table public.bar_feels_manifest enable row level security;
alter table public.bar_feels_manifest force row level security;
alter table public.subject_matter_cycles enable row level security;
alter table public.subject_matter_cycles force row level security;

revoke all on public.release_content_syncs
  from public, anon, authenticated;
revoke all on public.bar_feels_manifest
  from public, anon, authenticated;
revoke all on public.subject_matter_cycles
  from public, anon, authenticated;
grant select, insert on public.release_content_syncs to service_role;
grant usage, select on sequence public.release_content_syncs_id_seq
  to service_role;
grant select, insert, update, delete on public.bar_feels_manifest
  to service_role;
grant select, insert, update, delete on public.subject_matter_cycles
  to service_role;

-- ---------------------------------------------------------------------------
-- Trusted content import
-- ---------------------------------------------------------------------------

create or replace function public.release_sync_subject_matter(
  p_actor_user_id uuid,
  p_rows jsonb,
  p_source_digest text,
  p_source_endpoint text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row jsonb;
  v_source_key text;
  v_subject text;
  v_prompt text;
  v_answer text;
  v_legal_basis text;
  v_content_hash text;
  v_question_id uuid;
  v_exam_id uuid;
  v_exam_public_id uuid;
  v_version_id uuid;
  v_version_number integer;
  v_version_hash text;
  v_year smallint;
  v_term smallint;
  v_imported integer := 0;
  v_subjects integer;
begin
  perform public.examination_require_admin(p_actor_user_id);
  if jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) < 1
     or p_source_digest !~ '^[0-9a-f]{64}$'
     or p_source_endpoint !~ '^https://docs\.google\.com/spreadsheets/'
  then
    raise exception 'RELEASE_SUBJECT_SOURCE_INVALID';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_source_key := btrim(coalesce(v_row->>'questionId', ''));
    v_subject := btrim(coalesce(v_row->>'subject', ''));
    v_prompt := btrim(coalesce(v_row->>'prompt', ''));
    v_answer := btrim(coalesce(v_row->>'suggestedAnswer', ''));
    v_legal_basis := btrim(coalesce(v_row->>'legalBasis', ''));
    v_content_hash := lower(btrim(coalesce(v_row->>'contentHash', '')));
    v_year := coalesce(nullif(v_row->>'yearLevel', '')::smallint, 1);
    v_term := coalesce(nullif(v_row->>'term', '')::smallint, 1);

    if v_source_key = ''
       or char_length(v_subject) not between 2 and 120
       or char_length(v_prompt) < 20
       or char_length(v_answer) < 20
       or char_length(v_legal_basis) < 10
       or v_content_hash !~ '^[0-9a-f]{64}$'
       or v_year not between 1 and 4
       or v_term not between 1 and 3
    then
      raise exception 'RELEASE_SUBJECT_ROW_INVALID:%', v_source_key;
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended('release-subject:' || v_source_key, 0)
    );

    -- Reuse any previously published Subject Matter identity so this broader
    -- owner-authorized import remains additive and preserves existing attempts.
    select q.id, d.id, d.public_id
    into v_question_id, v_exam_id, v_exam_public_id
    from public.examination_questions q
    left join public.examination_version_questions vq
      on vq.question_id = q.id
    left join public.examination_versions ev
      on ev.id = vq.version_id
    left join public.examination_definitions d
      on d.id = ev.exam_id
     and d.track = 'per_subject'
     and d.assessment_kind = 'quiz'
    where q.source_type = 'google_sheet'
      and q.source_key = v_source_key
      and q.owner_user_id is null
    order by
      (d.active_version_id = ev.id) desc nulls last,
      ev.version_number desc nulls last
    limit 1;

    v_question_id := coalesce(
      v_question_id,
      public.release_deterministic_uuid('leb-question:' || v_source_key)
    );
    v_exam_id := coalesce(
      v_exam_id,
      public.release_deterministic_uuid('leb-exam:' || v_source_key)
    );
    v_exam_public_id := coalesce(
      v_exam_public_id,
      public.release_deterministic_uuid('leb-exam-public:' || v_source_key)
    );
    v_version_id := public.release_deterministic_uuid(
      'leb-version:' || v_source_key || ':' || v_content_hash
    );
    v_version_hash := encode(extensions.digest(
      v_content_hash || ':' || v_version_id::text,
      'sha256'
    ), 'hex');

    insert into public.examination_questions (
      id, source_key, source_type, owner_user_id, subject, topic, bar_year,
      question_number, difficulty, prompt_text, model_answer, legal_basis,
      doctrine, application_text, conclusion_text, jurisprudence, citation,
      governing_provision, source_urls, source_metadata, review_status,
      publication_ready, content_hash, source_updated_at, approved_at,
      approved_by
    )
    values (
      v_question_id,
      v_source_key,
      'google_sheet',
      null,
      v_subject,
      nullif(v_row->>'topic', ''),
      nullif(v_row->>'barYear', '')::integer,
      nullif(v_row->>'questionNumber', ''),
      nullif(v_row->>'difficulty', ''),
      v_prompt,
      v_answer,
      v_legal_basis,
      nullif(v_row->>'doctrine', ''),
      nullif(v_row#>>'{alac,application}', ''),
      nullif(v_row#>>'{alac,conclusion}', ''),
      coalesce(v_row->'jurisprudence', '[]'::jsonb),
      nullif(v_row->>'citation', ''),
      v_legal_basis,
      coalesce(v_row->'sourceUrls', '[]'::jsonb),
      jsonb_strip_nulls(jsonb_build_object(
        'spreadsheetId', '1DgDe_ObIoiTy9NJ3DmdM1ec7h7t0FS7RvFhBTjubZ8A',
        'sheetName', 'LEB Y1-Y2 Exam Bank',
        'sheetRow', nullif(v_row->>'sheetRow', '')::integer,
        'sheetRange', nullif(v_row->>'sheetRange', ''),
        'yearLevel', v_year,
        'term', v_term,
        'courseCode', nullif(v_row->>'courseCode', ''),
        'sourceVersion', nullif(v_row->>'version', ''),
        'lastUpdated', nullif(v_row->>'lastUpdated', ''),
        'sourceUrlText', nullif(v_row->>'sourceUrlText', ''),
        'editorialStatus', nullif(v_row->>'editorialStatus', ''),
        'publicationReadyInSource', nullif(v_row->>'publicationReady', ''),
        'ownerPublicationOverride', true
      )),
      case
        when lower(btrim(coalesce(v_row->>'editorialStatus', ''))) = 'approved'
          and lower(btrim(coalesce(v_row->>'publicationReady', ''))) = 'yes'
        then 'approved'
        else 'owner_override'
      end,
      true,
      v_content_hash,
      case
        when coalesce(v_row->>'lastUpdated', '') ~ '^\d{4}-\d{2}-\d{2}'
        then (v_row->>'lastUpdated')::date::timestamptz
        else null
      end,
      null,
      null
    )
    on conflict (id) do update
    set subject = excluded.subject,
        topic = excluded.topic,
        bar_year = excluded.bar_year,
        question_number = excluded.question_number,
        difficulty = excluded.difficulty,
        prompt_text = excluded.prompt_text,
        model_answer = excluded.model_answer,
        legal_basis = excluded.legal_basis,
        doctrine = excluded.doctrine,
        application_text = excluded.application_text,
        conclusion_text = excluded.conclusion_text,
        jurisprudence = excluded.jurisprudence,
        citation = excluded.citation,
        governing_provision = excluded.governing_provision,
        source_urls = excluded.source_urls,
        source_metadata = excluded.source_metadata,
        review_status = excluded.review_status,
        publication_ready = true,
        content_hash = excluded.content_hash,
        source_updated_at = excluded.source_updated_at,
        approved_at = null,
        approved_by = null,
        updated_at = now()
    where examination_questions.source_type = 'google_sheet'
      and examination_questions.source_key = excluded.source_key
      and examination_questions.owner_user_id is null;

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
      v_subject || ' — Subject Matter Practice',
      v_subject,
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
        'Owner-authorized source workbook release',
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
        v_prompt,
        v_answer,
        v_legal_basis,
        nullif(v_row#>>'{alac,application}', ''),
        nullif(v_row#>>'{alac,conclusion}', ''),
        coalesce(v_row->'jurisprudence', '[]'::jsonb),
        nullif(v_row->>'citation', ''),
        v_legal_basis,
        coalesce(v_row->'sourceUrls', '[]'::jsonb),
        v_content_hash
      );

      update public.examination_versions
      set status = 'published',
          published_at = now()
      where id = v_version_id;
    end if;

    update public.examination_definitions
    set active_version_id = v_version_id,
        status = 'published',
        updated_at = now()
    where id = v_exam_id;

    v_imported := v_imported + 1;
  end loop;

  if v_imported <> jsonb_array_length(p_rows) then
    raise exception 'RELEASE_SUBJECT_COUNT_MISMATCH';
  end if;

  select count(distinct value->>'subject')
  into v_subjects
  from jsonb_array_elements(p_rows);

  insert into public.release_content_syncs (
    actor_user_id, source_name, source_digest, source_endpoint,
    imported_count, subject_count
  )
  values (
    p_actor_user_id, 'subject_matter', p_source_digest, p_source_endpoint,
    v_imported, v_subjects
  )
  on conflict (source_name, source_digest) do nothing;

  return jsonb_build_object(
    'rows', v_imported,
    'subjects', v_subjects,
    'sourceDigest', p_source_digest
  );
end;
$$;

revoke all on function public.release_sync_subject_matter(
  uuid, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.release_sync_subject_matter(
  uuid, jsonb, text, text
) to service_role;

create or replace function public.release_sync_bar_feels(
  p_actor_user_id uuid,
  p_groups jsonb,
  p_source_digest text,
  p_source_endpoint text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_group jsonb;
  v_row jsonb;
  v_destination text;
  v_rationale text;
  v_source_key text;
  v_original_subject text;
  v_prompt text;
  v_answer text;
  v_legal_basis text;
  v_content_hash text;
  v_question_id uuid;
  v_exam_id uuid;
  v_exam_public_id uuid;
  v_version_id uuid;
  v_version_number integer;
  v_version_hash text;
  v_group_hash text;
  v_seen_source_keys text[] := '{}'::text[];
  v_ordinal integer;
  v_groups integer := 0;
  v_total integer := 0;
begin
  perform public.examination_require_admin(p_actor_user_id);
  if jsonb_typeof(p_groups) <> 'array'
     or jsonb_array_length(p_groups) <> 6
     or p_source_digest !~ '^[0-9a-f]{64}$'
     or p_source_endpoint !~ '^https://docs\.google\.com/spreadsheets/'
  then
    raise exception 'RELEASE_BAR_FEELS_SOURCE_INVALID';
  end if;

  -- A repeated sync of the same reviewed source is a true no-op. Published
  -- version snapshots are immutable once released, so verify the complete
  -- manifest instead of deleting and rebuilding an identical publication.
  if exists (
    select 1
    from public.release_content_syncs
    where source_name = 'bar_feels'
      and source_digest = p_source_digest
  )
  and (
    select count(*) = 120
       and count(distinct destination_subject) = 6
       and count(*) filter (where source_digest = p_source_digest) = 120
    from public.bar_feels_manifest
  )
  and not exists (
    select 1
    from public.bar_feels_manifest m
    join public.examination_versions ev on ev.id = m.version_id
    where ev.status <> 'published'
       or (
         select count(*)
         from public.examination_version_questions vq
         where vq.version_id = ev.id
       ) <> 20
  )
  then
    return jsonb_build_object(
      'assignments', 120,
      'destinations', 6,
      'sourceDigest', p_source_digest
    );
  end if;

  -- The six groups are validated in the same transaction. Any invalid or
  -- duplicate row rolls the entire manifest back.
  delete from public.bar_feels_manifest
  where source_key is not null;

  for v_group in select value from jsonb_array_elements(p_groups)
  loop
    v_destination := btrim(coalesce(v_group->>'destination', ''));
    v_rationale := btrim(coalesce(v_group->>'mappingRationale', ''));
    if v_destination not in (
      'Political and Public International Law',
      'Commercial and Taxation Laws',
      'Civil Law',
      'Labor Law and Social Legislations',
      'Criminal Law',
      'Remedial Law, Legal and Judicial Ethics'
    )
       or char_length(v_rationale) not between 20 and 1000
       or jsonb_typeof(v_group->'rows') <> 'array'
       or jsonb_array_length(v_group->'rows') <> 20
    then
      raise exception 'RELEASE_BAR_FEELS_GROUP_INVALID:%', v_destination;
    end if;

    v_exam_id := public.release_deterministic_uuid(
      'bar-feels-exam:' || v_destination
    );
    v_exam_public_id := public.release_deterministic_uuid(
      'bar-feels-exam-public:' || v_destination
    );
    v_group_hash := encode(extensions.digest(
      v_destination || ':' || p_source_digest,
      'sha256'
    ), 'hex');
    v_version_id := public.release_deterministic_uuid(
      'bar-feels-version:' || v_destination || ':' || v_group_hash
    );
    v_version_hash := encode(extensions.digest(
      v_group_hash || ':' || v_version_id::text,
      'sha256'
    ), 'hex');

    perform pg_advisory_xact_lock(
      hashtextextended('release-bar-feels:' || v_destination, 0)
    );

    insert into public.examination_definitions (
      id, public_id, track, assessment_kind, title, subject, year_level,
      semester, owner_user_id, test_only, status, active_version_id,
      created_by
    )
    values (
      v_exam_id,
      v_exam_public_id,
      'bar_feels',
      'curated',
      v_destination || ' — Bar Feels',
      v_destination,
      null,
      null,
      null,
      false,
      'published',
      null,
      p_actor_user_id
    )
    on conflict (id) do update
    set title = excluded.title,
        subject = excluded.subject,
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
        'Deterministic twenty-question beta manifest',
        14400,
        'strict',
        '["strict","selfPaced","none"]'::jsonb,
        'either',
        'after_ai',
        null,
        'Answer every essay using A.L.A.C.: Answer, Legal Basis, Application, and Conclusion.',
        jsonb_build_array(v_destination),
        20,
        'draft',
        v_version_hash,
        p_actor_user_id,
        null
      );
    else
      if not exists (
        select 1
        from public.examination_versions
        where id = v_version_id
          and exam_id = v_exam_id
          and question_count = 20
          and snapshot_hash = v_version_hash
      ) then
        raise exception 'RELEASE_BAR_FEELS_VERSION_CONFLICT:%', v_destination;
      end if;
      delete from public.examination_version_questions
      where version_id = v_version_id
        and not exists (
          select 1 from public.examination_attempts_multi
          where version_id = v_version_id
        );
    end if;

    v_ordinal := 0;
    for v_row in select value from jsonb_array_elements(v_group->'rows')
    loop
      v_ordinal := v_ordinal + 1;
      v_source_key := btrim(coalesce(v_row->>'questionId', ''));
      v_original_subject := btrim(coalesce(v_row->>'subject', ''));
      v_prompt := btrim(coalesce(v_row->>'prompt', ''));
      v_answer := btrim(coalesce(v_row->>'suggestedAnswer', ''));
      v_legal_basis := btrim(coalesce(v_row->>'legalBasis', ''));
      v_content_hash := lower(btrim(coalesce(v_row->>'contentHash', '')));

      if v_source_key = ''
         or v_source_key = any(v_seen_source_keys)
         or char_length(v_original_subject) not between 2 and 120
         or char_length(v_prompt) < 20
         or char_length(v_answer) < 20
         or char_length(v_legal_basis) < 10
         or v_content_hash !~ '^[0-9a-f]{64}$'
      then
        raise exception 'RELEASE_BAR_FEELS_ROW_INVALID:%', v_source_key;
      end if;
      v_seen_source_keys := array_append(v_seen_source_keys, v_source_key);
      v_question_id := public.release_deterministic_uuid(
        'bar-feels-question:' || v_source_key
      );

      insert into public.examination_questions (
        id, source_key, source_type, owner_user_id, subject, topic, bar_year,
        question_number, difficulty, prompt_text, model_answer, legal_basis,
        doctrine, application_text, conclusion_text, jurisprudence, citation,
        governing_provision, source_urls, source_metadata, review_status,
        publication_ready, content_hash, source_updated_at, approved_at,
        approved_by
      )
      values (
        v_question_id,
        'bar-feels:' || v_source_key,
        'google_sheet',
        null,
        v_original_subject,
        nullif(v_row->>'topic', ''),
        nullif(v_row->>'barYear', '')::integer,
        nullif(v_row->>'questionNumber', ''),
        nullif(v_row->>'difficulty', ''),
        v_prompt,
        v_answer,
        v_legal_basis,
        nullif(v_row->>'doctrine', ''),
        nullif(v_row#>>'{alac,application}', ''),
        nullif(v_row#>>'{alac,conclusion}', ''),
        coalesce(v_row->'jurisprudence', '[]'::jsonb),
        nullif(v_row->>'citation', ''),
        v_legal_basis,
        coalesce(v_row->'sourceUrls', '[]'::jsonb),
        jsonb_build_object(
          'spreadsheetId', '1DgDe_ObIoiTy9NJ3DmdM1ec7h7t0FS7RvFhBTjubZ8A',
          'sheetName', 'Website Upload',
          'sheetRow', nullif(v_row->>'sheetRow', '')::integer,
          'originalQuestionId', v_source_key,
          'destinationSubject', v_destination,
          'mappingRationale', v_rationale,
          'sourceUrlText', nullif(v_row->>'sourceUrlText', '')
        ),
        'approved',
        true,
        v_content_hash,
        now(),
        now(),
        p_actor_user_id
      )
      on conflict (id) do update
      set subject = excluded.subject,
          topic = excluded.topic,
          bar_year = excluded.bar_year,
          question_number = excluded.question_number,
          difficulty = excluded.difficulty,
          prompt_text = excluded.prompt_text,
          model_answer = excluded.model_answer,
          legal_basis = excluded.legal_basis,
          doctrine = excluded.doctrine,
          application_text = excluded.application_text,
          conclusion_text = excluded.conclusion_text,
          jurisprudence = excluded.jurisprudence,
          citation = excluded.citation,
          governing_provision = excluded.governing_provision,
          source_urls = excluded.source_urls,
          source_metadata = excluded.source_metadata,
          review_status = 'approved',
          publication_ready = true,
          content_hash = excluded.content_hash,
          source_updated_at = excluded.source_updated_at,
          approved_at = excluded.approved_at,
          approved_by = excluded.approved_by,
          updated_at = now()
      where examination_questions.source_type = 'google_sheet'
        and examination_questions.source_key = excluded.source_key
        and examination_questions.owner_user_id is null;

      if not exists (
        select 1
        from public.examination_version_questions
        where version_id = v_version_id and question_id = v_question_id
      ) then
        insert into public.examination_version_questions (
          version_id, question_id, ordinal, prompt_snapshot,
          model_answer_snapshot, legal_basis_snapshot, application_snapshot,
          conclusion_snapshot, jurisprudence_snapshot, citation_snapshot,
          governing_provision_snapshot, source_urls_snapshot, snapshot_hash
        )
        values (
          v_version_id,
          v_question_id,
          v_ordinal,
          v_prompt,
          v_answer,
          v_legal_basis,
          nullif(v_row#>>'{alac,application}', ''),
          nullif(v_row#>>'{alac,conclusion}', ''),
          coalesce(v_row->'jurisprudence', '[]'::jsonb),
          nullif(v_row->>'citation', ''),
          v_legal_basis,
          coalesce(v_row->'sourceUrls', '[]'::jsonb),
          v_content_hash
        );
      end if;

      insert into public.bar_feels_manifest (
        source_key, original_subject, destination_subject,
        mapping_rationale, question_id, version_id, ordinal, source_digest
      )
      values (
        v_source_key, v_original_subject, v_destination,
        v_rationale, v_question_id, v_version_id, v_ordinal, p_source_digest
      );
      v_total := v_total + 1;
    end loop;

    if (
      select count(*)
      from public.examination_version_questions
      where version_id = v_version_id
    ) <> 20 then
      raise exception 'RELEASE_BAR_FEELS_QUESTION_COUNT_MISMATCH:%', v_destination;
    end if;

    update public.examination_versions
    set status = 'published',
        published_at = coalesce(published_at, now())
    where id = v_version_id;
    update public.examination_definitions
    set active_version_id = v_version_id,
        status = 'published',
        updated_at = now()
    where id = v_exam_id;

    v_groups := v_groups + 1;
  end loop;

  if v_groups <> 6 or v_total <> 120
     or (select count(*) from public.bar_feels_manifest) <> 120
  then
    raise exception 'RELEASE_BAR_FEELS_FINAL_COUNT_MISMATCH';
  end if;

  insert into public.release_content_syncs (
    actor_user_id, source_name, source_digest, source_endpoint,
    imported_count, subject_count
  )
  values (
    p_actor_user_id, 'bar_feels', p_source_digest, p_source_endpoint,
    v_total, v_groups
  )
  on conflict (source_name, source_digest) do nothing;

  return jsonb_build_object(
    'assignments', v_total,
    'destinations', v_groups,
    'sourceDigest', p_source_digest
  );
end;
$$;

revoke all on function public.release_sync_bar_feels(
  uuid, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.release_sync_bar_feels(
  uuid, jsonb, text, text
) to service_role;

create or replace function public.release_sync_all_content(
  p_actor_user_id uuid,
  p_subject_rows jsonb,
  p_subject_digest text,
  p_subject_endpoint text,
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
  -- Both imports share this transaction. A failure in either source leaves the
  -- previously verified production content untouched.
  v_subject_result := public.release_sync_subject_matter(
    p_actor_user_id,
    p_subject_rows,
    p_subject_digest,
    p_subject_endpoint
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

revoke all on function public.release_sync_all_content(
  uuid, jsonb, text, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.release_sync_all_content(
  uuid, jsonb, text, text, jsonb, text, text
) to service_role;

-- ---------------------------------------------------------------------------
-- Subject Matter catalog, no-repeat selection, and grounded performance
-- ---------------------------------------------------------------------------

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
      select jsonb_agg(item order by year_level, term, subject)
      from (
        select
          d.year_level,
          d.semester as term,
          d.subject,
          jsonb_build_object(
            'subject', d.subject,
            'yearLevel', d.year_level,
            'term', d.semester,
            'questionCount', count(*),
            'completedCount', count(*) filter (
              where exists (
                select 1
                from public.examination_attempts_multi a
                join public.examination_submissions s on s.attempt_id = a.id
                where a.user_id = p_user_id
                  and a.version_id = d.active_version_id
              )
            )
          ) as item
        from public.examination_definitions d
        join public.examination_versions v on v.id = d.active_version_id
        where d.track = 'per_subject'
          and d.assessment_kind = 'quiz'
          and d.status = 'published'
          and v.status = 'published'
          and v.question_count = 1
        group by d.year_level, d.semester, d.subject
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
  from public.examination_definitions d
  join public.examination_versions ev on ev.id = d.active_version_id
  where d.track = 'per_subject'
    and d.assessment_kind = 'quiz'
    and d.subject = v_subject
    and d.year_level = p_year_level
    and d.semester = p_term
    and d.status = 'published'
    and ev.status = 'published'
    and ev.question_count = 1;

  if v_total = 0 then
    raise exception 'SUBJECT_MATTER_SUBJECT_NOT_FOUND';
  end if;

  if v_cycle.active_version_id is null then
    select ev.id
    into v_version_id
    from public.examination_definitions d
    join public.examination_versions ev on ev.id = d.active_version_id
    join public.examination_version_questions vq on vq.version_id = ev.id
    where d.track = 'per_subject'
      and d.assessment_kind = 'quiz'
      and d.subject = v_subject
      and d.year_level = p_year_level
      and d.semester = p_term
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

create or replace function public.subject_matter_performance(
  p_user_id uuid,
  p_subject text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_subject text := nullif(btrim(coalesce(p_subject, '')), '');
  v_limit integer := least(100, greatest(1, coalesce(p_limit, 50)));
begin
  perform public.examination_authorize_access(
    p_user_id, 'per_subject', null, null, true
  );
  return jsonb_build_object(
    'subject', v_subject,
    'attemptedQuestions', (
      select count(distinct a.id)
      from public.examination_attempts_multi a
      join public.examination_versions ev on ev.id = a.version_id
      join public.examination_definitions d on d.id = ev.exam_id
      where a.user_id = p_user_id
        and d.track = 'per_subject'
        and (v_subject is null or d.subject = v_subject)
    ),
    'completedQuestions', (
      select count(*)
      from public.examination_submissions s
      join public.examination_attempts_multi a on a.id = s.attempt_id
      join public.examination_versions ev on ev.id = a.version_id
      join public.examination_definitions d on d.id = ev.exam_id
      where a.user_id = p_user_id
        and d.track = 'per_subject'
        and (v_subject is null or d.subject = v_subject)
    ),
    'recentAttempts', coalesce((
      select jsonb_agg(item order by submitted_at desc)
      from (
        select
          s.submitted_at,
          jsonb_build_object(
            'subject', d.subject,
            'topic', q.topic,
            'submittedAt', s.submitted_at,
            'score', ai.score,
            'answerText', r.answer_text,
            'assessment', ai.assessment_json,
            'suggestedAnswer', case
              when mr.attempt_id is not null then vq.model_answer_snapshot
              else null
            end,
            'legalBasis', case
              when mr.attempt_id is not null then vq.legal_basis_snapshot
              else null
            end,
            'sources', case
              when mr.attempt_id is not null then vq.source_urls_snapshot
              else '[]'::jsonb
            end
          ) as item
        from public.examination_submissions s
        join public.examination_attempts_multi a on a.id = s.attempt_id
        join public.examination_versions ev on ev.id = a.version_id
        join public.examination_definitions d on d.id = ev.exam_id
        join public.examination_version_questions vq on vq.version_id = ev.id
        join public.examination_questions q on q.id = vq.question_id
        join public.examination_responses r
          on r.attempt_id = a.id and r.question_id = q.id
        left join public.examination_ai_assessments ai
          on ai.attempt_id = a.id and ai.question_id = q.id
        left join public.examination_model_releases mr on mr.attempt_id = a.id
        where a.user_id = p_user_id
          and d.track = 'per_subject'
          and (v_subject is null or d.subject = v_subject)
        order by s.submitted_at desc
        limit v_limit
      ) recent
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.subject_matter_catalog(uuid)
  from public, anon, authenticated;
revoke all on function public.subject_matter_next_question(
  uuid, text, smallint, smallint, boolean
) from public, anon, authenticated;
revoke all on function public.subject_matter_performance(
  uuid, text, integer
) from public, anon, authenticated;
grant execute on function public.subject_matter_catalog(uuid)
  to service_role;
grant execute on function public.subject_matter_next_question(
  uuid, text, smallint, smallint, boolean
) to service_role;
grant execute on function public.subject_matter_performance(
  uuid, text, integer
) to service_role;

-- ---------------------------------------------------------------------------
-- Quorum: three atomic Affirm reactions, simple voluntary posting, and
-- reference-faithful supporting information.
-- ---------------------------------------------------------------------------

alter table public.forum_reactions
  add column if not exists reaction_type text not null default 'hear';

alter table public.forum_reactions
  drop constraint if exists forum_reactions_type_check;
alter table public.forum_reactions
  add constraint forum_reactions_type_check
  check (reaction_type in ('hear', 'see', 'feel'));

alter table public.forum_post_attachments
  add column if not exists alt_text text;
alter table public.forum_post_attachments
  drop constraint if exists forum_post_attachments_alt_text_check;
alter table public.forum_post_attachments
  add constraint forum_post_attachments_alt_text_check
  check (
    alt_text is null
    or char_length(btrim(alt_text)) between 1 and 500
  );

-- Worker-only community tables are also FORCE RLS protected so ownership cannot
-- be bypassed accidentally by a future non-service database role.
alter table public.forum_posts force row level security;
alter table public.forum_comments force row level security;
alter table public.forum_reactions force row level security;
alter table public.forum_reposts force row level security;
alter table public.forum_reports force row level security;
alter table public.forum_user_restrictions force row level security;
alter table public.forum_action_events force row level security;
alter table public.forum_profile_settings force row level security;
alter table public.forum_study_circles force row level security;
alter table public.forum_circle_members force row level security;
alter table public.forum_saved_entries force row level security;
alter table public.forum_user_blocks force row level security;
alter table public.forum_entry_indicators force row level security;
alter table public.forum_post_attachments force row level security;
alter table public.forum_notifications force row level security;
alter table public.forum_telemetry_events force row level security;

create or replace function public.forum_render_entry(
  p_viewer_user_id uuid,
  p_post_id uuid,
  p_repost_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.forum_post_is_visible(p_viewer_user_id, p_post_id) then
    return null;
  end if;

  select jsonb_build_object(
    'kind', case when r.id is null then 'entry' else 'citation' end,
    'entryId', p.public_id,
    'body', p.body,
    'sourceUrl', p.source_url,
    'caseTitle', p.case_title,
    'entryType', p.entry_type,
    'subject', p.subject,
    'category', p.category,
    'lawSchoolYear', p.law_school_year,
    'createdAt', p.created_at,
    'updatedAt', p.updated_at,
    'edited', p.edited_at is not null,
    'commentsLocked', p.comments_locked_at is not null,
    'viewerOwns', p.author_user_id = p_viewer_user_id,
    'viewerHelpful', exists (
      select 1 from public.forum_reactions x
      where x.post_id = p.id and x.user_id = p_viewer_user_id
    ),
    'viewerReaction', (
      select x.reaction_type
      from public.forum_reactions x
      where x.post_id = p.id and x.user_id = p_viewer_user_id
    ),
    'viewerSaved', exists (
      select 1 from public.forum_saved_entries x
      where x.post_id = p.id and x.user_id = p_viewer_user_id
    ),
    'author', public.forum_safe_profile(p_viewer_user_id, p.author_user_id),
    'circle', case when c.id is null then null else jsonb_build_object(
      'circleId', c.public_id,
      'name', c.name,
      'subject', c.subject,
      'status', c.status
    ) end,
    'counts', jsonb_build_object(
      'helpful', (
        select count(*) from public.forum_reactions x where x.post_id = p.id
      ),
      'reactions', (
        select count(*) from public.forum_reactions x where x.post_id = p.id
      ),
      'hear', (
        select count(*) from public.forum_reactions x
        where x.post_id = p.id and x.reaction_type = 'hear'
      ),
      'see', (
        select count(*) from public.forum_reactions x
        where x.post_id = p.id and x.reaction_type = 'see'
      ),
      'feel', (
        select count(*) from public.forum_reactions x
        where x.post_id = p.id and x.reaction_type = 'feel'
      ),
      'comments', (
        select count(*) from public.forum_comments x
        where x.post_id = p.id
          and x.deleted_at is null
          and x.moderation_status = 'visible'
      ),
      'citations', (
        select count(*) from public.forum_reposts x
        where x.original_post_id = p.id and x.deleted_at is null
      )
    ),
    'indicators', (
      select coalesce(jsonb_agg(v.indicator order by v.ordinal), '[]'::jsonb)
      from (
        select 'Source Provided'::text as indicator, 1 as ordinal
        where p.source_url is not null
        union all
        select 'Opinion Only', 2 where p.opinion_only
        union all
        select case i.indicator
          when 'citation_checked' then 'Citation Checked'
          when 'community_correction' then 'Community Correction'
          when 'moderator_reviewed' then 'Moderator Reviewed'
        end,
        case i.indicator
          when 'citation_checked' then 3
          when 'community_correction' then 4
          else 5
        end
        from public.forum_entry_indicators i
        where i.post_id = p.id
      ) v
    ),
    'imagePath', a.object_path,
    'imageAlt', a.alt_text,
    'practiceQuestionId', p.mapped_question_id,
    'citation', case when r.id is null then null else jsonb_build_object(
      'citationId', r.public_id,
      'commentary', r.commentary,
      'createdAt', r.created_at,
      'viewerOwns', r.user_id = p_viewer_user_id,
      'author', public.forum_safe_profile(p_viewer_user_id, r.user_id)
    ) end
  )
  into v_result
  from public.forum_posts p
  left join public.forum_reposts r
    on r.id = p_repost_id
    and r.original_post_id = p.id
    and r.deleted_at is null
    and not public.forum_users_blocked(p_viewer_user_id, r.user_id)
  left join public.forum_study_circles c on c.id = p.circle_id
  left join public.forum_post_attachments a
    on a.post_id = p.id and a.deleted_at is null
  where p.id = p_post_id;

  if p_repost_id is not null and (v_result->'citation') = 'null'::jsonb then
    return null;
  end if;
  return v_result;
end;
$$;

create or replace function public.forum_set_affirm(
  p_user_id uuid,
  p_entry_id text,
  p_reaction_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_post_id uuid;
  v_author_user_id uuid;
  v_type text := nullif(lower(btrim(coalesce(p_reaction_type, ''))), '');
  v_previous text;
  v_total integer;
begin
  perform public.forum_assert_member(p_user_id);
  select id, author_user_id
  into v_post_id, v_author_user_id
  from public.forum_posts
  where public_id = p_entry_id;
  if v_post_id is null
     or not public.forum_post_is_visible(p_user_id, v_post_id)
  then
    raise exception 'FORUM_POST_NOT_FOUND';
  end if;
  if v_type is not null and v_type not in ('hear', 'see', 'feel') then
    raise exception 'FORUM_REACTION_INVALID';
  end if;

  perform public.forum_enforce_action_limit(
    p_user_id, 'reaction_toggle', 60, interval '10 minutes'
  );
  perform pg_advisory_xact_lock(
    hashtextextended(v_post_id::text || ':' || p_user_id::text, 0)
  );

  select reaction_type into v_previous
  from public.forum_reactions
  where post_id = v_post_id and user_id = p_user_id;

  if v_type is null or v_previous = v_type then
    delete from public.forum_reactions
    where post_id = v_post_id and user_id = p_user_id;
    v_type := null;
  else
    insert into public.forum_reactions (post_id, user_id, reaction_type)
    values (v_post_id, p_user_id, v_type)
    on conflict (post_id, user_id) do update
    set reaction_type = excluded.reaction_type,
        created_at = now();
    if v_previous is null and v_author_user_id <> p_user_id then
      perform public.forum_create_notification(
        v_author_user_id, p_user_id, 'helpful', v_post_id
      );
    end if;
  end if;

  select count(*)::integer into v_total
  from public.forum_reactions
  where post_id = v_post_id;

  return jsonb_build_object(
    'reaction', v_type,
    'count', v_total,
    'counts', jsonb_build_object(
      'hear', (
        select count(*) from public.forum_reactions
        where post_id = v_post_id and reaction_type = 'hear'
      ),
      'see', (
        select count(*) from public.forum_reactions
        where post_id = v_post_id and reaction_type = 'see'
      ),
      'feel', (
        select count(*) from public.forum_reactions
        where post_id = v_post_id and reaction_type = 'feel'
      )
    )
  );
end;
$$;

create or replace function public.forum_affirm_roster(
  p_user_id uuid,
  p_entry_id text,
  p_limit integer default 60
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_post_id uuid;
  v_limit integer := least(100, greatest(1, coalesce(p_limit, 60)));
begin
  perform public.forum_assert_member(p_user_id);
  select id into v_post_id from public.forum_posts where public_id = p_entry_id;
  if v_post_id is null
     or not public.forum_post_is_visible(p_user_id, v_post_id)
  then raise exception 'FORUM_POST_NOT_FOUND'; end if;

  return jsonb_build_object(
    'total', (
      select count(*) from public.forum_reactions where post_id = v_post_id
    ),
    'groups', jsonb_build_object(
      'hear', coalesce((
        select jsonb_agg(profile order by created_at desc)
        from (
          select r.created_at,
            public.forum_safe_profile(p_user_id, r.user_id) as profile
          from public.forum_reactions r
          where r.post_id = v_post_id and r.reaction_type = 'hear'
          order by r.created_at desc limit v_limit
        ) members where profile is not null
      ), '[]'::jsonb),
      'see', coalesce((
        select jsonb_agg(profile order by created_at desc)
        from (
          select r.created_at,
            public.forum_safe_profile(p_user_id, r.user_id) as profile
          from public.forum_reactions r
          where r.post_id = v_post_id and r.reaction_type = 'see'
          order by r.created_at desc limit v_limit
        ) members where profile is not null
      ), '[]'::jsonb),
      'feel', coalesce((
        select jsonb_agg(profile order by created_at desc)
        from (
          select r.created_at,
            public.forum_safe_profile(p_user_id, r.user_id) as profile
          from public.forum_reactions r
          where r.post_id = v_post_id and r.reaction_type = 'feel'
          order by r.created_at desc limit v_limit
        ) members where profile is not null
      ), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.forum_quorum_insights(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.forum_assert_member(p_user_id);
  return jsonb_build_object(
    'trending', coalesce((
      select jsonb_agg(
        jsonb_build_object('topic', topic, 'postCount', post_count)
        order by post_count desc, topic
      )
      from (
        select topic, count(*)::integer as post_count
        from (
          select coalesce(
            nullif(btrim(p.subject), ''),
            case p.category
              when 'philippine_legal_education' then 'Legal Education'
              when 'philippine_jurisprudence' then 'Jurisprudence'
              when 'bar_examination' then 'Bar Examination'
              when 'law_school_life' then 'Law School Life'
              when 'career_internship' then 'Careers and Internships'
              when 'student_support' then 'Student Support'
              when 'comparative_law' then 'Comparative Law'
              else 'Community'
            end
          ) as topic
          from public.forum_posts p
          where p.created_at >= now() - interval '30 days'
            and public.forum_post_is_visible(p_user_id, p.id)
        ) visible
        group by topic
        order by post_count desc, topic
        limit 5
      ) ranked
    ), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'entryId', p.public_id,
          'body', p.body,
          'answerCount', (
            select count(*) from public.forum_comments c
            where c.post_id = p.id
              and c.deleted_at is null
              and c.moderation_status = 'visible'
          ),
          'createdAt', p.created_at
        )
        order by p.created_at desc
      )
      from (
        select p.*
        from public.forum_posts p
        where p.entry_type in ('ask_community', 'request_study_help')
          and public.forum_post_is_visible(p_user_id, p.id)
        order by (
          select count(*) from public.forum_comments c
          where c.post_id = p.id
            and c.deleted_at is null
            and c.moderation_status = 'visible'
        ) asc, p.created_at desc
        limit 5
      ) p
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.forum_publish_simple(
  p_user_id uuid,
  p_operation text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation text := lower(btrim(coalesce(p_operation, '')));
  v_body text := btrim(coalesce(p_payload->>'body', ''));
  v_kind text := lower(btrim(coalesce(p_payload->>'kind', 'discussion')));
  v_subject text := nullif(btrim(coalesce(p_payload->>'subject', '')), '');
  v_year text := nullif(btrim(coalesce(p_payload->>'lawSchoolYear', '')), '');
  v_source_url text := nullif(btrim(coalesce(p_payload->>'sourceUrl', '')), '');
  v_post_id uuid;
  v_author uuid;
  v_public_id text;
begin
  perform public.forum_assert_can_publish(p_user_id);
  if jsonb_typeof(p_payload) <> 'object'
     or char_length(v_body) not between 1 and 4000
     or v_kind not in ('discussion', 'question')
     or (v_subject is not null and char_length(v_subject) > 120)
     or (v_year is not null and char_length(v_year) > 80)
     or (v_source_url is not null and (
       char_length(v_source_url) > 2000
       or v_source_url !~* '^https?://'
     ))
  then raise exception 'FORUM_POST_INVALID'; end if;

  if v_operation = 'create' then
    perform public.forum_enforce_action_limit(
      p_user_id, 'post_create', 5, interval '10 minutes'
    );
    if exists (
      select 1 from public.forum_posts
      where author_user_id = p_user_id
        and lower(btrim(body)) = lower(v_body)
        and created_at >= now() - interval '2 minutes'
        and deleted_at is null
    ) then raise exception 'FORUM_DUPLICATE_POST'; end if;

    insert into public.forum_posts (
      author_user_id, body, entry_type, category, subject, law_school_year,
      source_url, publication_status
    )
    values (
      p_user_id,
      v_body,
      case when v_kind = 'question'
        then 'ask_community' else 'student_support' end,
      'law_school_life',
      v_subject,
      v_year,
      v_source_url,
      'published'
    )
    returning id, public_id into v_post_id, v_public_id;
    return jsonb_build_object(
      'entryId', v_public_id,
      'publicationStatus', 'published',
      'message', 'Entry published in Quorum.'
    );
  elsif v_operation = 'update' then
    select id, author_user_id into v_post_id, v_author
    from public.forum_posts
    where public_id = p_payload->>'entryId'
    for update;
    if v_post_id is null then raise exception 'FORUM_POST_NOT_FOUND'; end if;
    if v_author <> p_user_id then raise exception 'FORUM_OWNERSHIP_REQUIRED'; end if;
    perform public.forum_enforce_action_limit(
      p_user_id, 'post_edit', 20, interval '10 minutes'
    );
    update public.forum_posts
    set body = v_body,
        entry_type = case when v_kind = 'question'
          then 'ask_community' else 'student_support' end,
        updated_at = now(),
        edited_at = now()
    where id = v_post_id
      and deleted_at is null
      and moderation_status = 'visible';
    if not found then raise exception 'FORUM_POST_NOT_EDITABLE'; end if;
    return jsonb_build_object(
      'entryId', p_payload->>'entryId',
      'edited', true
    );
  end if;
  raise exception 'FORUM_COMMAND_INVALID';
end;
$$;

create or replace function public.forum_set_attachment_alt(
  p_user_id uuid,
  p_entry_id text,
  p_alt_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_post_id uuid;
  v_alt text := nullif(btrim(coalesce(p_alt_text, '')), '');
begin
  perform public.forum_assert_member(p_user_id);
  if v_alt is not null and char_length(v_alt) > 500 then
    raise exception 'FORUM_ATTACHMENT_ALT_INVALID';
  end if;
  select id into v_post_id
  from public.forum_posts
  where public_id = p_entry_id and author_user_id = p_user_id;
  if v_post_id is null then raise exception 'FORUM_OWNERSHIP_REQUIRED'; end if;
  update public.forum_post_attachments
  set alt_text = v_alt
  where post_id = v_post_id
    and owner_user_id = p_user_id
    and deleted_at is null;
  if not found then raise exception 'FORUM_ATTACHMENT_NOT_FOUND'; end if;
  return jsonb_build_object('updated', true);
end;
$$;

revoke all on function public.forum_render_entry(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.forum_set_affirm(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.forum_affirm_roster(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.forum_quorum_insights(uuid)
  from public, anon, authenticated;
revoke all on function public.forum_publish_simple(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.forum_set_attachment_alt(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.forum_render_entry(uuid, uuid, uuid)
  to service_role;
grant execute on function public.forum_set_affirm(uuid, text, text)
  to service_role;
grant execute on function public.forum_affirm_roster(uuid, text, integer)
  to service_role;
grant execute on function public.forum_quorum_insights(uuid)
  to service_role;
grant execute on function public.forum_publish_simple(uuid, text, jsonb)
  to service_role;
grant execute on function public.forum_set_attachment_alt(uuid, text, text)
  to service_role;

commit;

-- Keep every active Syllabus-Based Review placement revealable after the
-- official-source output filter, and reject future placements that contain no
-- approved authority at all.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

create or replace function public.subject_matter_guard_official_placement_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sources jsonb;
begin
  select public.subject_matter_official_review_sources(
    version_question.source_urls_snapshot
  )
  into v_sources
  from public.examination_definitions definition
  join public.examination_versions version
    on version.id = definition.active_version_id
  join public.examination_version_questions version_question
    on version_question.version_id = version.id
   and version_question.question_id = new.question_id
  where definition.id = new.exam_id
    and definition.track = 'per_subject'
    and definition.assessment_kind = 'quiz'
    and version.question_count = 1;

  if pg_catalog.jsonb_typeof(v_sources) <> 'array'
     or pg_catalog.jsonb_array_length(v_sources) < 1
  then
    raise exception 'SUBJECT_MATTER_OFFICIAL_SOURCE_REQUIRED';
  end if;

  return new;
end;
$$;

revoke all on function public.subject_matter_guard_official_placement_source()
  from public, anon, authenticated, service_role;

drop trigger if exists subject_matter_guard_official_placement_source_trigger
  on public.subject_matter_placements;
create trigger subject_matter_guard_official_placement_source_trigger
before insert or update of exam_id, question_id
on public.subject_matter_placements
for each row execute function public.subject_matter_guard_official_placement_source();

-- Current selectors may issue any active placement. Refuse the release if even
-- one such row cannot satisfy the full protected-review contract after source
-- filtering. This is a deployment-time backstop, not a deletion or pool trim.
do $subject_matter_active_pool_must_be_revealable$
begin
  if exists (
    select 1
    from public.subject_matter_placements placement
    join public.examination_definitions definition
      on definition.id = placement.exam_id
    join public.examination_versions version
      on version.id = definition.active_version_id
    join public.examination_version_questions version_question
      on version_question.version_id = version.id
     and version_question.question_id = placement.question_id
    left join public.examination_questions question
      on question.id = version_question.question_id
    where definition.track = 'per_subject'
      and definition.assessment_kind = 'quiz'
      and definition.status = 'published'
      and version.status = 'published'
      and version.question_count = 1
      and not (
        question.id is not null
        and question.content_hash = version_question.snapshot_hash
        and question.publication_ready is true
        and pg_catalog.lower(question.review_status) in ('approved', 'owner_override')
        and pg_catalog.char_length(pg_catalog.btrim(version_question.prompt_snapshot)) >= 20
        and pg_catalog.char_length(
          pg_catalog.btrim(version_question.model_answer_snapshot)
        ) >= 20
        and pg_catalog.char_length(
          pg_catalog.btrim(version_question.legal_basis_snapshot)
        ) >= 10
        and pg_catalog.jsonb_typeof(version_question.jurisprudence_snapshot) = 'array'
        and pg_catalog.jsonb_array_length(
          version_question.jurisprudence_snapshot
        ) <= 24
        and not exists (
          select 1
          from pg_catalog.jsonb_array_elements(
            version_question.jurisprudence_snapshot
          ) jurisprudence(entry)
          where pg_catalog.jsonb_typeof(jurisprudence.entry)
            not in ('string', 'object')
        )
        and pg_catalog.jsonb_typeof(version_question.source_urls_snapshot) = 'array'
        and pg_catalog.jsonb_array_length(version_question.source_urls_snapshot)
          between 1 and 12
        and pg_catalog.jsonb_array_length(
          public.subject_matter_official_review_sources(
            version_question.source_urls_snapshot
          )
        ) >= 1
      )
  ) then
    raise exception 'SUBJECT_MATTER_ACTIVE_POOL_NOT_REVEALABLE';
  end if;
end;
$subject_matter_active_pool_must_be_revealable$;

comment on function public.subject_matter_guard_official_placement_source() is
  'Internal placement guard requiring at least one approved official HTTPS source in every new Syllabus-Based Review item.';

commit;

-- Preserve every approved Syllabus-Based Review item while returning only
-- official source links. Historical snapshots may contain supplemental study
-- links beside an official authority. The protected reveal must not expose
-- those supplemental links, but their presence must not make an otherwise
-- complete reviewed answer unavailable.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

create or replace function public.subject_matter_official_review_sources(
  p_sources jsonb
)
returns jsonb
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_agg(normalized.url order by source.ordinality),
    '[]'::jsonb
  )
  from pg_catalog.jsonb_array_elements(p_sources)
    with ordinality as source(entry, ordinality)
  cross join lateral (
    select case pg_catalog.jsonb_typeof(source.entry)
      when 'string' then pg_catalog.btrim(source.entry #>> '{}')
      when 'object' then pg_catalog.btrim(source.entry->>'url')
      else null
    end as url
  ) normalized
  where normalized.url is not null
    and pg_catalog.char_length(normalized.url) <= 2048
    and normalized.url ~* (
      '^https://(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*'
      || '(?:lawphil\.net|judiciary\.gov\.ph|officialgazette\.gov\.ph|'
      || 'leb\.gov\.ph|dole\.gov\.ph|bir\.gov\.ph|senate\.gov\.ph|'
      || 'legal\.un\.org)'
      || '(?::(?:[0-9]{1,4}|[0-5][0-9]{4}|6[0-4][0-9]{3}|'
      || '65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?(?:[/?#]|$)'
    );
$$;

revoke all on function public.subject_matter_official_review_sources(jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.subject_matter_reveal_review(
  p_user_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access jsonb;
  v_attempt public.examination_attempts_multi%rowtype;
  v_track text;
  v_assessment_kind text;
  v_question_count integer;
  v_question_id uuid;
  v_prompt text;
  v_suggested_answer text;
  v_legal_basis text;
  v_governing_provision text;
  v_doctrine text;
  v_jurisprudence jsonb;
  v_citation text;
  v_raw_sources jsonb;
  v_sources jsonb;
  v_release_authorized boolean := false;
  v_release_audit_count integer := 0;
  v_first_reveal boolean := false;
  v_release_at timestamptz;
begin
  -- Resolve the canonical access snapshot before taking the attempt row lock.
  -- The rollback-only subtransaction prevents a reveal check from changing the
  -- introductory-token ledger or claim state.
  begin
    v_access := public.phase4_access_snapshot(p_user_id, false, null);
    raise exception using
      errcode = 'ZX001',
      message = 'SYLLABUS_REVIEW_READ_ONLY_SNAPSHOT';
  exception
    when sqlstate 'ZX001' then
      null;
  end;

  if v_access is null or pg_catalog.jsonb_typeof(v_access) <> 'object' then
    raise exception 'SYLLABUS_REVIEW_RELEASE_INTEGRITY';
  end if;

  select attempt.*
  into v_attempt
  from public.examination_attempts_multi attempt
  where attempt.id = p_attempt_id
    and attempt.user_id = p_user_id
  for update of attempt;

  select definition.track, definition.assessment_kind
  into v_track, v_assessment_kind
  from public.examination_versions version
  join public.examination_definitions definition on definition.id = version.exam_id
  where version.id = v_attempt.version_id;

  if v_attempt.id is null
     or v_track <> 'per_subject'
     or v_assessment_kind <> 'quiz'
     or v_attempt.status not in ('in_progress', 'review', 'submitted', 'expired')
  then
    raise exception 'EXAM_SUBJECT_REVIEW_MATERIAL_UNAVAILABLE';
  end if;

  select pg_catalog.count(*)
  into v_question_count
  from public.examination_version_questions version_question
  where version_question.version_id = v_attempt.version_id;

  if v_question_count <> 1 then
    raise exception 'EXAM_SUBJECT_REVIEW_MATERIAL_UNAVAILABLE';
  end if;

  select
    version_question.question_id,
    nullif(pg_catalog.btrim(version_question.prompt_snapshot), ''),
    nullif(pg_catalog.btrim(version_question.model_answer_snapshot), ''),
    nullif(pg_catalog.btrim(version_question.legal_basis_snapshot), ''),
    nullif(pg_catalog.btrim(version_question.governing_provision_snapshot), ''),
    nullif(pg_catalog.btrim(question.doctrine), ''),
    version_question.jurisprudence_snapshot,
    nullif(pg_catalog.btrim(version_question.citation_snapshot), ''),
    version_question.source_urls_snapshot
  into
    v_question_id,
    v_prompt,
    v_suggested_answer,
    v_legal_basis,
    v_governing_provision,
    v_doctrine,
    v_jurisprudence,
    v_citation,
    v_raw_sources
  from public.examination_version_questions version_question
  join public.examination_questions question
    on question.id = version_question.question_id
   and question.content_hash = version_question.snapshot_hash
  where version_question.version_id = v_attempt.version_id
    and question.publication_ready is true
    and pg_catalog.lower(question.review_status) in ('approved', 'owner_override');

  if v_question_id is null
     or v_prompt is null
     or pg_catalog.char_length(v_prompt) < 20
     or v_suggested_answer is null
     or pg_catalog.char_length(v_suggested_answer) < 20
     or v_legal_basis is null
     or pg_catalog.char_length(v_legal_basis) < 10
     or pg_catalog.jsonb_typeof(v_jurisprudence) <> 'array'
     or pg_catalog.jsonb_array_length(v_jurisprudence) > 24
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_jurisprudence) jurisprudence(entry)
       where pg_catalog.jsonb_typeof(jurisprudence.entry) not in ('string', 'object')
     )
     or pg_catalog.jsonb_typeof(v_raw_sources) <> 'array'
     or pg_catalog.jsonb_array_length(v_raw_sources) < 1
     or pg_catalog.jsonb_array_length(v_raw_sources) > 12
  then
    raise exception 'EXAM_SUBJECT_REVIEW_MATERIAL_UNAVAILABLE';
  end if;

  v_sources := public.subject_matter_official_review_sources(v_raw_sources);

  if pg_catalog.jsonb_typeof(v_sources) <> 'array'
     or pg_catalog.jsonb_array_length(v_sources) < 1
     or pg_catalog.jsonb_array_length(v_sources) > 12
  then
    raise exception 'EXAM_SUBJECT_REVIEW_MATERIAL_UNAVAILABLE';
  end if;

  select pg_catalog.count(*)
  into v_release_audit_count
  from public.examination_audit_log audit
  where audit.action = 'subject_review_released'
    and audit.resource_type = 'examination_attempt'
    and audit.resource_id = v_attempt.id::text;

  v_release_authorized := public.subject_matter_review_release_authorized(
    v_attempt.id,
    p_user_id
  );

  if not v_release_authorized
     and (
       v_attempt.review_material_release_authorized_at is not null
       or v_attempt.review_material_release_access_basis is not null
       or v_attempt.review_material_release_access_allowed is not null
       or v_attempt.review_material_release_access_unlimited is not null
       or v_attempt.review_material_release_entitlement_ends_at is not null
       or v_attempt.review_material_release_policy_version is not null
       or v_release_audit_count <> 0
     )
  then
    raise exception 'SYLLABUS_REVIEW_RELEASE_INTEGRITY';
  end if;

  if not v_release_authorized then
    if not (
      coalesce((v_access->>'allowed')::boolean, false)
      and coalesce((v_access->>'unlimited')::boolean, false)
      and v_access->>'basis' in (
        'super_admin',
        'founder_admin',
        'founding_beta',
        'early_access',
        'paid_subscription'
      )
    )
    then
      raise exception 'SYLLABUS_REVIEW_SUBSCRIPTION_REQUIRED';
    end if;

    v_release_at := pg_catalog.clock_timestamp();

    update public.examination_attempts_multi attempt
    set review_material_revealed_at = coalesce(
          attempt.review_material_revealed_at,
          v_release_at
        ),
        review_material_revealed_before_submission = case
          when attempt.review_material_revealed_at is null
            then attempt.status in ('in_progress', 'review')
          else attempt.review_material_revealed_before_submission
        end,
        review_material_release_authorized_at = v_release_at,
        review_material_release_access_basis = v_access->>'basis',
        review_material_release_access_allowed = true,
        review_material_release_access_unlimited = true,
        review_material_release_entitlement_ends_at =
          nullif(v_access->>'entitlementEndsAt', '')::timestamptz,
        review_material_release_policy_version =
          'subject-review-unlimited-v1-2026-08-26',
        updated_at = v_release_at
    where attempt.id = v_attempt.id
      and attempt.user_id = p_user_id
      and attempt.review_material_release_authorized_at is null
    returning attempt.* into v_attempt;

    if v_attempt.review_material_release_authorized_at is null then
      raise exception 'SYLLABUS_REVIEW_RELEASE_INTEGRITY';
    end if;

    insert into public.examination_audit_log (
      actor_user_id,
      action,
      resource_type,
      resource_id,
      reason,
      metadata,
      created_at
    ) values (
      p_user_id,
      'subject_review_released',
      'examination_attempt',
      v_attempt.id::text,
      'First authorized Syllabus-Based Review protected answer release.',
      pg_catalog.jsonb_build_object(
        'accessBasis', v_attempt.review_material_release_access_basis,
        'entitlementEndsAt', v_attempt.review_material_release_entitlement_ends_at,
        'assisted', v_attempt.review_material_revealed_before_submission is true
      ),
      v_release_at
    );

    if not public.subject_matter_review_release_authorized(
      v_attempt.id,
      p_user_id
    ) then
      raise exception 'SYLLABUS_REVIEW_RELEASE_INTEGRITY';
    end if;

    v_release_authorized := true;
    v_first_reveal := true;
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'available',
    'attemptId', v_attempt.id,
    'questionId', v_question_id,
    'prompt', v_prompt,
    'suggestedAnswer', v_suggested_answer,
    'legalBasis', v_legal_basis,
    'governingProvision', v_governing_provision,
    'doctrine', v_doctrine,
    'jurisprudence', v_jurisprudence,
    'citation', v_citation,
    'sources', v_sources,
    'assisted', v_attempt.review_material_revealed_before_submission is true,
    'assistanceKnown',
      v_attempt.review_material_revealed_before_submission is not null,
    'reviewMaterialRevealedAt', v_attempt.review_material_revealed_at,
    'firstReveal', v_first_reveal,
    'releaseAuthorized', v_release_authorized,
    'releasePolicyVersion', v_attempt.review_material_release_policy_version,
    'access', v_access
  );
end;
$$;

revoke all on function public.subject_matter_reveal_review(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.subject_matter_reveal_review(uuid, uuid)
  to service_role;

comment on function public.subject_matter_official_review_sources(jsonb) is
  'Internal allowlist filter that preserves source order and returns only approved HTTPS authorities.';

comment on function public.subject_matter_reveal_review(uuid, uuid) is
  'Owner-bound protected review release with durable entitlement provenance and official-source-only output.';

commit;

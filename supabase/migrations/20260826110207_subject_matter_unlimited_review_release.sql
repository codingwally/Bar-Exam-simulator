-- Protect Syllabus-Based Review answers behind a durable, owner-bound,
-- unlimited-access release. The access snapshot is evaluated without a grade
-- reservation, so this transition never consumes an introductory token.

begin;

alter table public.examination_attempts_multi
  add column if not exists review_material_release_authorized_at timestamptz;

alter table public.examination_attempts_multi
  add column if not exists review_material_release_access_basis text;

alter table public.examination_attempts_multi
  add column if not exists review_material_release_access_allowed boolean;

alter table public.examination_attempts_multi
  add column if not exists review_material_release_access_unlimited boolean;

alter table public.examination_attempts_multi
  add column if not exists review_material_release_entitlement_ends_at timestamptz;

alter table public.examination_attempts_multi
  add column if not exists review_material_release_policy_version text;

-- The action and provenance fields are introduced together by this rollout.
-- Any pre-existing row means a reviewed draft or manual partial rollout is
-- present; stop before trusting, overwriting, or indexing that state.
do $$
begin
  if exists (
    select 1
    from public.examination_attempts_multi attempt
    where attempt.review_material_release_authorized_at is not null
       or attempt.review_material_release_access_basis is not null
       or attempt.review_material_release_access_allowed is not null
       or attempt.review_material_release_access_unlimited is not null
       or attempt.review_material_release_entitlement_ends_at is not null
       or attempt.review_material_release_policy_version is not null
  ) or exists (
    select 1
    from public.examination_audit_log audit
    where audit.action = 'subject_review_released'
  ) then
    raise exception 'SYLLABUS_REVIEW_RELEASE_PREFLIGHT_FAILED';
  end if;
end;
$$;

-- Do not backfill historical reveal timestamps. Only a release performed by
-- the function below may establish trusted post-rollout provenance.
alter table public.examination_attempts_multi
  drop constraint if exists examination_attempt_review_release_provenance_check;

alter table public.examination_attempts_multi
  add constraint examination_attempt_review_release_provenance_check check (
    (
      review_material_release_authorized_at is null
      and review_material_release_access_basis is null
      and review_material_release_access_allowed is null
      and review_material_release_access_unlimited is null
      and review_material_release_entitlement_ends_at is null
      and review_material_release_policy_version is null
    )
    or
    (
      review_material_revealed_at is not null
      and review_material_release_authorized_at is not null
      and review_material_release_access_allowed is true
      and review_material_release_access_unlimited is true
      and review_material_release_access_basis in (
        'super_admin',
        'founder_admin',
        'founding_beta',
        'early_access',
        'paid_subscription'
      )
      and review_material_release_policy_version =
        'subject-review-unlimited-v1-2026-08-26'
    )
  );

comment on column public.examination_attempts_multi.review_material_release_authorized_at is
  'First post-rollout authorization of protected Syllabus-Based Review material.';
comment on column public.examination_attempts_multi.review_material_release_access_basis is
  'Immutable allowlisted unlimited-access basis used for the protected review release.';
comment on column public.examination_attempts_multi.review_material_release_access_allowed is
  'Immutable allowed=true value from the server access snapshot used for release.';
comment on column public.examination_attempts_multi.review_material_release_access_unlimited is
  'Immutable unlimited=true value from the server access snapshot used for release.';
comment on column public.examination_attempts_multi.review_material_release_entitlement_ends_at is
  'Entitlement end captured from the server access snapshot; null for non-expiring access.';
comment on column public.examination_attempts_multi.review_material_release_policy_version is
  'Immutable release-policy identifier. Null means no trusted post-rollout release exists.';

-- Row locking in subject_matter_reveal_review makes the first transition
-- single-writer. This index is an independent database proof that at most one
-- release audit event can exist even if another writer is introduced later.
create unique index if not exists examination_audit_subject_review_release_once_idx
  on public.examination_audit_log (resource_type, resource_id)
  where action = 'subject_review_released';

create or replace function public.subject_matter_guard_review_release_provenance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.review_material_revealed_at is not null
     and (
       new.review_material_revealed_at is distinct from old.review_material_revealed_at
       or new.review_material_revealed_before_submission
         is distinct from old.review_material_revealed_before_submission
     )
  then
    raise exception 'SYLLABUS_REVIEW_RELEASE_INTEGRITY';
  end if;

  if old.review_material_release_authorized_at is not null
     and (
       new.review_material_release_authorized_at
         is distinct from old.review_material_release_authorized_at
       or new.review_material_release_access_basis
         is distinct from old.review_material_release_access_basis
       or new.review_material_release_access_allowed
         is distinct from old.review_material_release_access_allowed
       or new.review_material_release_access_unlimited
         is distinct from old.review_material_release_access_unlimited
       or new.review_material_release_entitlement_ends_at
         is distinct from old.review_material_release_entitlement_ends_at
       or new.review_material_release_policy_version
         is distinct from old.review_material_release_policy_version
     )
  then
    raise exception 'SYLLABUS_REVIEW_RELEASE_INTEGRITY';
  end if;

  return new;
end;
$$;

revoke all on function public.subject_matter_guard_review_release_provenance()
  from public, anon, authenticated, service_role;

drop trigger if exists subject_matter_review_release_provenance_guard
  on public.examination_attempts_multi;
create trigger subject_matter_review_release_provenance_guard
before update on public.examination_attempts_multi
for each row
execute function public.subject_matter_guard_review_release_provenance();

create or replace function public.subject_matter_review_release_authorized(
  p_attempt_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.examination_attempts_multi attempt
    where attempt.id = p_attempt_id
      and attempt.user_id = p_user_id
      and attempt.review_material_revealed_at is not null
      and attempt.review_material_release_authorized_at is not null
      and attempt.review_material_release_access_allowed is true
      and attempt.review_material_release_access_unlimited is true
      and attempt.review_material_release_access_basis in (
        'super_admin',
        'founder_admin',
        'founding_beta',
        'early_access',
        'paid_subscription'
      )
      and attempt.review_material_release_policy_version =
        'subject-review-unlimited-v1-2026-08-26'
      and 1 = (
        select pg_catalog.count(*)
        from public.examination_audit_log audit
        where audit.action = 'subject_review_released'
          and audit.resource_type = 'examination_attempt'
          and audit.resource_id = attempt.id::text
          and audit.actor_user_id = attempt.user_id
          and audit.created_at = attempt.review_material_release_authorized_at
          and audit.metadata = pg_catalog.jsonb_build_object(
            'accessBasis', attempt.review_material_release_access_basis,
            'entitlementEndsAt',
              attempt.review_material_release_entitlement_ends_at,
            'assisted',
              attempt.review_material_revealed_before_submission is true
          )
      )
  );
$$;

revoke all on function public.subject_matter_review_release_authorized(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.subject_matter_assessment_without_protected_review(
  p_assessment jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_assessment is null
     or pg_catalog.jsonb_typeof(p_assessment) <> 'object'
  then
    return null;
  end if;

  select pg_catalog.jsonb_object_agg(entry.key, entry.value)
  into v_result
  from pg_catalog.jsonb_each(p_assessment) entry
  where entry.key in (
    'label',
    'rationale',
    'strengths',
    'errors',
    'improvements',
    'sourceStatus',
    'reviewRequired',
    'authorityStatus',
    'scoreCeilingCode',
    'rubricBreakdown',
    'rubricVersion'
  );

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

revoke all on function public.subject_matter_assessment_without_protected_review(jsonb)
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
  -- phase4_access_snapshot also lazily ensures introductory grant rows. Run it
  -- inside a deliberately rolled-back subtransaction so the exact computed
  -- snapshot survives in v_access while every snapshot-only write and lock is
  -- discarded. Reveal therefore cannot change the token ledger or claim state,
  -- and it retains the access-before-attempt lock order used elsewhere.
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
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(v_raw_sources) source(entry)
       cross join lateral (
         select case pg_catalog.jsonb_typeof(source.entry)
           when 'string' then pg_catalog.btrim(source.entry #>> '{}')
           when 'object' then pg_catalog.btrim(source.entry->>'url')
           else null
         end as url
       ) normalized
       where normalized.url is null
          or pg_catalog.char_length(normalized.url) > 2048
          or normalized.url !~* (
            '^https://(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*'
            || '(?:lawphil\.net|judiciary\.gov\.ph|officialgazette\.gov\.ph|'
            || 'leb\.gov\.ph|dole\.gov\.ph|bir\.gov\.ph|senate\.gov\.ph|'
            || 'legal\.un\.org)'
            || '(?::(?:[0-9]{1,4}|[0-5][0-9]{4}|6[0-4][0-9]{3}|'
            || '65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?(?:[/?#]|$)'
          )
     )
  then
    raise exception 'EXAM_SUBJECT_REVIEW_MATERIAL_UNAVAILABLE';
  end if;

  select pg_catalog.jsonb_agg(normalized.url order by source.ordinality)
  into v_sources
  from pg_catalog.jsonb_array_elements(v_raw_sources)
    with ordinality as source(entry, ordinality)
  cross join lateral (
    select case pg_catalog.jsonb_typeof(source.entry)
      when 'string' then pg_catalog.btrim(source.entry #>> '{}')
      when 'object' then pg_catalog.btrim(source.entry->>'url')
      else null
    end as url
  ) normalized;

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

-- Retire the older service-role RPC that returned legal review material without
-- durable release provenance. Its definition remains for rollback diagnostics,
-- but no API role can execute it after this migration.
revoke all on function public.subject_matter_review_material(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Preserve the latest historical implementation behind an unexposed name, then
-- scrub answer-bearing fields unless the individual attempt has trusted release
-- provenance. The wrapper remains owner-bound through the original query.
do $$
begin
  if pg_catalog.to_regprocedure(
    'public.subject_matter_performance_pre_protected_review_release(uuid,text,integer)'
  ) is null then
    if pg_catalog.to_regprocedure(
      'public.subject_matter_performance(uuid,text,integer)'
    ) is null then
      raise exception 'SUBJECT_MATTER_PERFORMANCE_REQUIRED';
    end if;
    execute 'alter function public.subject_matter_performance(uuid, text, integer) '
      || 'rename to subject_matter_performance_pre_protected_review_release';
  end if;
end;
$$;

revoke all on function public.subject_matter_performance_pre_protected_review_release(
  uuid, text, integer
) from public, anon, authenticated, service_role;

create or replace function public.subject_matter_performance(
  p_user_id uuid,
  p_subject text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_recent jsonb := '[]'::jsonb;
  v_item jsonb;
begin
  v_result := public.subject_matter_performance_pre_protected_review_release(
    p_user_id,
    p_subject,
    p_limit
  );

  if pg_catalog.jsonb_typeof(v_result->'recentAttempts') <> 'array' then
    raise exception 'SYLLABUS_REVIEW_RELEASE_INTEGRITY';
  end if;

  for v_item in
    select item.value
    from pg_catalog.jsonb_array_elements(v_result->'recentAttempts')
      with ordinality item(value, position)
    order by item.position
  loop
    if not public.subject_matter_review_release_authorized(
      (v_item->>'attemptId')::uuid,
      p_user_id
    ) then
      v_item := v_item || pg_catalog.jsonb_build_object(
        'assessment', public.subject_matter_assessment_without_protected_review(
          v_item->'assessment'
        ),
        'suggestedAnswer', null,
        'legalBasis', null,
        'sources', '[]'::jsonb
      );
    end if;
    v_recent := v_recent || pg_catalog.jsonb_build_array(v_item);
  end loop;

  return pg_catalog.jsonb_set(
    v_result,
    '{recentAttempts}',
    v_recent,
    true
  );
end;
$$;

revoke all on function public.subject_matter_performance(uuid, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.subject_matter_performance(uuid, text, integer)
  to service_role;

-- Apply the same default-deny answer scrubbing to the generic verdict endpoint.
do $$
begin
  if pg_catalog.to_regprocedure(
    'public.examination_query_pre_protected_review_release(uuid,text,jsonb)'
  ) is null then
    if pg_catalog.to_regprocedure(
      'public.examination_query(uuid,text,jsonb)'
    ) is null then
      raise exception 'EXAMINATION_QUERY_REQUIRED';
    end if;
    execute 'alter function public.examination_query(uuid, text, jsonb) '
      || 'rename to examination_query_pre_protected_review_release';
  end if;
end;
$$;

revoke all on function public.examination_query_pre_protected_review_release(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.examination_query(
  p_user_id uuid,
  p_operation text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation text := pg_catalog.lower(
    pg_catalog.btrim(coalesce(p_operation, ''))
  );
  v_result jsonb;
  v_attempt_id uuid;
  v_track text;
  v_assessment_kind text;
  v_results jsonb := '[]'::jsonb;
  v_item jsonb;
begin
  v_result := public.examination_query_pre_protected_review_release(
    p_user_id,
    p_operation,
    p_payload
  );

  if v_operation <> 'verdict' then
    return v_result;
  end if;

  v_attempt_id := (p_payload->>'attemptId')::uuid;

  select definition.track, definition.assessment_kind
  into v_track, v_assessment_kind
  from public.examination_attempts_multi attempt
  join public.examination_versions version on version.id = attempt.version_id
  join public.examination_definitions definition on definition.id = version.exam_id
  where attempt.id = v_attempt_id
    and attempt.user_id = p_user_id;

  if v_track <> 'per_subject'
     or v_assessment_kind <> 'quiz'
     or public.subject_matter_review_release_authorized(
       v_attempt_id,
       p_user_id
     )
  then
    return v_result;
  end if;

  if pg_catalog.jsonb_typeof(v_result->'results') <> 'array' then
    raise exception 'SYLLABUS_REVIEW_RELEASE_INTEGRITY';
  end if;

  for v_item in
    select item.value
    from pg_catalog.jsonb_array_elements(v_result->'results')
      with ordinality item(value, position)
    order by item.position
  loop
    v_item := v_item || pg_catalog.jsonb_build_object(
      'aiAssessment', public.subject_matter_assessment_without_protected_review(
        v_item->'aiAssessment'
      ),
      'modelAnswer', null,
      'legalBasis', null,
      'application', null,
      'conclusion', null,
      'sources', '[]'::jsonb
    );
    v_results := v_results || pg_catalog.jsonb_build_array(v_item);
  end loop;

  return v_result || pg_catalog.jsonb_build_object(
    'released', false,
    'results', v_results
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'EXAM_QUERY_INVALID';
end;
$$;

revoke all on function public.examination_query(uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.examination_query(uuid, text, jsonb)
  to service_role;

commit;

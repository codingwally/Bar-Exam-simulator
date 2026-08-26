-- Staging-only structural/security coverage for the protected Syllabus-Based
-- Review release. No product rows are created and the transaction is rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;
select no_plan();

select has_column(
  'public', 'examination_attempts_multi', 'review_material_release_authorized_at',
  'attempts persist the trusted post-rollout release time'
);
select has_column(
  'public', 'examination_attempts_multi', 'review_material_release_access_basis',
  'attempts persist the exact server access basis used for release'
);
select has_column(
  'public', 'examination_attempts_multi', 'review_material_release_access_allowed',
  'attempts persist allowed=true release provenance'
);
select has_column(
  'public', 'examination_attempts_multi', 'review_material_release_access_unlimited',
  'attempts persist unlimited=true release provenance'
);
select has_column(
  'public', 'examination_attempts_multi', 'review_material_release_entitlement_ends_at',
  'attempts persist the entitlement end observed at release'
);
select has_column(
  'public', 'examination_attempts_multi', 'review_material_release_policy_version',
  'attempts persist an immutable release policy version'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.examination_attempts_multi'::regclass
      and conname = 'examination_attempt_review_release_provenance_check'
      and convalidated
  ),
  'trusted release provenance has a validated database constraint'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'examination_audit_log'
      and indexname = 'examination_audit_subject_review_release_once_idx'
      and indexdef ilike '%unique index%'
      and indexdef ilike '%subject_review_released%'
  ),
  'a partial unique index enforces at most one release audit per attempt'
);

select ok(
  has_function_privilege(
    'service_role', 'public.subject_matter_reveal_review(uuid,uuid)', 'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated', 'public.subject_matter_reveal_review(uuid,uuid)', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.subject_matter_reveal_review(uuid,uuid)', 'EXECUTE'
  )
  and not has_function_privilege(
    'public', 'public.subject_matter_reveal_review(uuid,uuid)', 'EXECUTE'
  ),
  'only service_role can execute the protected reveal RPC'
);

select ok(
  not has_function_privilege(
    'service_role', 'public.subject_matter_review_material(uuid,uuid)', 'EXECUTE'
  ),
  'the retired unproven legal-material RPC is no longer executable'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.subject_matter_performance_pre_protected_review_release(uuid,text,integer)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role', 'public.subject_matter_performance(uuid,text,integer)', 'EXECUTE'
  ),
  'only the protected Subject Matter performance wrapper is API-executable'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.examination_query_pre_protected_review_release(uuid,text,jsonb)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role', 'public.examination_query(uuid,text,jsonb)', 'EXECUTE'
  ),
  'only the protected generic examination query wrapper is API-executable'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.subject_matter_review_release_authorized(uuid,uuid)',
    'EXECUTE'
  ),
  'the provenance verifier is internal to database-owned wrappers'
);

select ok(
  position('FOR UPDATE' in upper(
    pg_get_functiondef('public.subject_matter_reveal_review(uuid,uuid)'::regprocedure)
  )) > 0,
  'the reveal transition locks its owner-bound attempt row'
);

select ok(
  position('SYLLABUS_REVIEW_SUBSCRIPTION_REQUIRED' in
    pg_get_functiondef('public.subject_matter_reveal_review(uuid,uuid)'::regprocedure)
  ) > 0,
  'the protected reveal has a dedicated fail-closed entitlement error'
);

select ok(
  position('subject_review_released' in
    pg_get_functiondef('public.subject_matter_reveal_review(uuid,uuid)'::regprocedure)
  ) > 0
  and position('firstReveal' in
    pg_get_functiondef('public.subject_matter_reveal_review(uuid,uuid)'::regprocedure)
  ) > 0,
  'the atomic transition emits its audit and first-release marker together'
);

select ok(
  position('introductory_token_ledger' in
    pg_get_functiondef('public.subject_matter_reveal_review(uuid,uuid)'::regprocedure)
  ) = 0
  and position('grade_reservations' in
    pg_get_functiondef('public.subject_matter_reveal_review(uuid,uuid)'::regprocedure)
  ) = 0,
  'the reveal function has no token consumption or reservation path'
);

select ok(
  position('errcode = ''zx001''' in lower(
    pg_get_functiondef('public.subject_matter_reveal_review(uuid,uuid)'::regprocedure)
  )) > 0
  and position('when sqlstate ''zx001''' in lower(
    pg_get_functiondef('public.subject_matter_reveal_review(uuid,uuid)'::regprocedure)
  )) > 0
  and position('when others' in lower(
    pg_get_functiondef('public.subject_matter_reveal_review(uuid,uuid)'::regprocedure)
  )) = 0,
  'snapshot-only grant, ledger, and reservation writes roll back under one dedicated sentinel'
);

select ok(
  'https://lawphil.net/statutes/repacts/ra1949/ra_386_1949.html'
    ~* '^https://(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*(?:lawphil\.net|judiciary\.gov\.ph|officialgazette\.gov\.ph|leb\.gov\.ph|dole\.gov\.ph|bir\.gov\.ph|senate\.gov\.ph|legal\.un\.org)(?:[/?#]|$)'
  and 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/12345'
    ~* '^https://(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*(?:lawphil\.net|judiciary\.gov\.ph|officialgazette\.gov\.ph|leb\.gov\.ph|dole\.gov\.ph|bir\.gov\.ph|senate\.gov\.ph|legal\.un\.org)(?:[/?#]|$)',
  'official base and subdomain review sources pass the PostgreSQL host predicate'
);

select ok(
  not (
    'https://lawphil.net.evil.example/statutes'
      ~* '^https://(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*(?:lawphil\.net|judiciary\.gov\.ph|officialgazette\.gov\.ph|leb\.gov\.ph|dole\.gov\.ph|bir\.gov\.ph|senate\.gov\.ph|legal\.un\.org)(?:[/?#]|$)'
  )
  and not (
    'https://user@lawphil.net/statutes'
      ~* '^https://(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*(?:lawphil\.net|judiciary\.gov\.ph|officialgazette\.gov\.ph|leb\.gov\.ph|dole\.gov\.ph|bir\.gov\.ph|senate\.gov\.ph|legal\.un\.org)(?:[/?#]|$)'
  ),
  'confused hosts and credential-bearing URLs fail the PostgreSQL host predicate'
);

select * from finish();
rollback;

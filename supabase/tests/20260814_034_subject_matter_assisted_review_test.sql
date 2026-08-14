-- Staging-only structural and security coverage for Subject Matter assisted review.
-- No records are created and the transaction is rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;
select no_plan();

select has_column(
  'public', 'examination_attempts_multi', 'review_material_revealed_at',
  'Subject Matter attempts persist the first pre-submission review reveal'
);

select col_type_is(
  'public', 'examination_attempts_multi', 'review_material_revealed_at',
  'timestamp with time zone',
  'the assisted-review timestamp uses timestamptz'
);

select has_column(
  'public', 'examination_attempts_multi', 'review_material_revealed_before_submission',
  'Subject Matter attempts persist whether the first reveal preceded submission'
);

select col_type_is(
  'public', 'examination_attempts_multi', 'review_material_revealed_before_submission',
  'boolean',
  'the durable Assisted classification uses a boolean'
);

select ok(
  (select is_nullable = 'YES'
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'examination_attempts_multi'
     and column_name = 'review_material_revealed_at'),
  'unassisted attempts retain a null review timestamp'
);

select function_returns(
  'public', 'subject_matter_reveal_review', array['uuid', 'uuid'], 'jsonb',
  'the owner-bound complete-review operation exists'
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
  ),
  'only the trusted service role can execute complete-review reveal'
);

select ok(
  not has_function_privilege(
    'public', 'public.subject_matter_reveal_review(uuid,uuid)', 'EXECUTE'
  ),
  'PUBLIC has no execute grant on complete-review reveal'
);

select ok(
  (select prosecdef
   from pg_proc
   where oid = 'public.subject_matter_reveal_review(uuid,uuid)'::regprocedure),
  'complete-review reveal is security definer'
);

select ok(
  position('attempt.user_id = p_user_id' in
    pg_get_functiondef('public.subject_matter_reveal_review(uuid,uuid)'::regprocedure)) > 0,
  'the reveal operation binds the attempt to the authenticated owner'
);

select ok(
  position('question.content_hash = version_question.snapshot_hash' in
    pg_get_functiondef('public.subject_matter_reveal_review(uuid,uuid)'::regprocedure)) > 0,
  'the reveal operation requires the current immutable question revision'
);

select ok(
  position('question.publication_ready is true' in
    pg_get_functiondef('public.subject_matter_reveal_review(uuid,uuid)'::regprocedure)) > 0,
  'only publication-ready questions can reveal review material'
);

select ok(
  position('review_material_revealed_at is null' in
    pg_get_functiondef('public.subject_matter_reveal_review(uuid,uuid)'::regprocedure)) > 0,
  'the first assisted classification is written idempotently'
);

select ok(
  position('review_material_revealed_before_submission' in
    pg_get_functiondef('public.subject_matter_reveal_review(uuid,uuid)'::regprocedure)) > 0,
  'post-submission reveal persists without retroactively making the attempt Assisted'
);

select ok(
  position('reviewMaterialRevealedAt' in pg_get_functiondef(
    'public.examination_attempt_summary(public.examination_attempts_multi)'::regprocedure
  )) > 0,
  'attempt summaries expose durable assisted-review state'
);

select ok(
  position('unassistedAverageScore' in
    pg_get_functiondef('public.subject_matter_performance(uuid,text,integer)'::regprocedure)) > 0,
  'Subject Matter performance reports an unassisted-only average'
);

select ok(
  position('a.review_material_revealed_before_submission is false' in
    pg_get_functiondef('public.subject_matter_performance(uuid,text,integer)'::regprocedure)) > 0,
  'assisted attempts are excluded from unassisted mastery calculations'
);

select * from finish();
rollback;

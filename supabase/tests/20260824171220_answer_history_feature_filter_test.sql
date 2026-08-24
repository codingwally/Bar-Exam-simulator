begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

select has_function(
  'public', 'admin_answer_feature_context', array['text', 'uuid'],
  'answer feature mapper exists'
);
select has_function(
  'public', 'admin_preview_answer_history_by_feature_v1',
  array['uuid', 'uuid', 'timestamptz', 'timestamptz', 'text', 'text', 'integer', 'integer', 'text'],
  'feature-filtered answer-history preview exists'
);
select is(
  public.admin_answer_feature_context('practice', null)->>'featureKey',
  'bar_question_practice',
  'Practice storage maps to Bar Question Practice'
);
select is(
  public.admin_answer_feature_context('practice', null)->>'feature',
  'Bar Question Practice',
  'Practice storage uses the exact website label'
);
select is(
  public.admin_answer_feature_context('formal_exam', null)->>'featureKey',
  'unclassified_feature',
  'an unknown formal track is not mislabeled as another website feature'
);
select is(
  public.admin_answer_feature_context('formal_exam', null)->>'feature',
  'Feature not recorded',
  'an unknown formal track receives a neutral label'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.admin_preview_answer_history_by_feature_v1(uuid,uuid,timestamptz,timestamptz,text,text,integer,integer,text)',
    'execute'
  ),
  false,
  'browser users cannot execute the feature-filtered history preview'
);
select is(
  has_function_privilege(
    'service_role',
    'public.admin_preview_answer_history_by_feature_v1(uuid,uuid,timestamptz,timestamptz,text,text,integer,integer,text)',
    'execute'
  ),
  true,
  'the Worker service role can execute the feature-filtered history preview'
);
select is(
  (select prosecdef from pg_proc where oid =
    'public.admin_preview_answer_history_by_feature_v1(uuid,uuid,timestamptz,timestamptz,text,text,integer,integer,text)'::regprocedure),
  true,
  'the founder-only wrapper owns its controlled query privileges'
);
select is(
  (select prosecdef from pg_proc where oid =
    'public.admin_answer_feature_context(text,uuid)'::regprocedure),
  false,
  'the feature mapper uses invoker rights'
);

select * from finish();
rollback;

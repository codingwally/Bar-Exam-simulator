-- Staging-only structural coverage for the additive DueDiligence 2026 release.
-- No synthetic rows persist.

begin;
set local search_path = public, extensions, auth, pg_temp;
select no_plan();

select is(
  (select count(*) from information_schema.tables
   where table_schema = 'public' and table_name = any(array[
     'dd2026_feature_flags', 'dd2026_content_roles', 'dd2026_content_items',
     'dd2026_content_versions', 'dd2026_content_audit', 'dd2026_bar_easy_usage',
     'dd2026_doctrine_mastery', 'dd2026_verdict_pdf_exports'
   ])),
  8::bigint,
  'all eight DueDiligence 2026 content and usage tables exist'
);

select ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'dd2026_%'
      and c.relkind in ('r', 'p') and (not c.relrowsecurity or not c.relforcerowsecurity)
  ),
  'every DueDiligence 2026 table has RLS enabled and forced'
);

select ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and c.relname like 'dd2026_%'
      and (
        has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
        or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
      )
  ),
  'browser roles have no direct privileges on DueDiligence 2026 protected tables'
);

select ok(
  not exists (
    select 1
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and c.relname like 'dd2026_%'
      and acl.grantee = 0
  ),
  'PUBLIC has no direct grants on DueDiligence 2026 protected tables'
);

select ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and c.relname like 'dd2026_%'
      and not has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
  ),
  'service role retains operational DML privileges on DueDiligence 2026 tables'
);

select is(
  (select count(*) from public.dd2026_feature_flags
   where flag_key = any(array[
     'CHAIR_CASES_ENABLED', 'BAR_EASY_ENABLED', 'VERDICT_PDF_ENABLED',
     'VERDICT_PDF_PREMIUM_REQUIRED', 'DOCTRINES_ENABLED',
     'ANCHOR_CASE_DIGESTS_ENABLED', 'AI_PREPARED_BETA_BADGE',
     'CONTENT_HUMAN_REVIEW_REQUIRED'
   ])),
  8::bigint,
  'the eight reviewed DueDiligence 2026 feature flags exist'
);

select is(
  (select enabled from public.dd2026_feature_flags where flag_key = 'CONTENT_HUMAN_REVIEW_REQUIRED'),
  false,
  'human editorial approval is disabled only for the current beta'
);

select is(
  (select enabled from public.dd2026_feature_flags where flag_key = 'AI_PREPARED_BETA_BADGE'),
  true,
  'the AI-prepared beta warning remains enabled'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.dd2026_verdict_pdf_exports'::regclass
      and pg_get_constraintdef(oid) ilike '%num_nonnulls(grading_result_id, exam_attempt_id) = 1%'
  ),
  'Verdict exports reference exactly one authorized result source'
);

select ok(
  (select count(*) from public.dd2026_content_items) = 240
  and (select count(*) from public.dd2026_content_versions) = 240,
  'staging contains the exact 240-row prepared content publication'
);

select is(
  (select jsonb_object_agg(content_type, item_count)
   from (
     select content_type, count(*) item_count
     from public.dd2026_content_items group by content_type
   ) counts),
  '{"anchor_case":60,"bar_easy":50,"chair_case":30,"doctrine":100}'::jsonb,
  'prepared content counts match the approved source sets'
);

select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('dd2026_bar_easy_usage', 'dd2026_doctrine_mastery')
      and column_name in ('answer', 'answer_text', 'student_answer', 'feedback', 'rationale')
  ),
  'non-retentive study tables have no answer or rationale columns'
);

do $dd2026_structural_finish$
declare
  v_result text;
begin
  for v_result in select * from finish() loop
    if v_result ilike '%failed%' or v_result ilike 'not ok%' then
      raise exception 'DD2026_STRUCTURAL_PGTAP_FAILED: %', v_result;
    end if;
  end loop;
end
$dd2026_structural_finish$;

rollback;

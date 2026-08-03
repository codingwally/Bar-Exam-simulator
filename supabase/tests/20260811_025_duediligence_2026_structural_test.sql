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

select is(
  (select count(*) from information_schema.tables
   where table_schema = 'public' and table_name = any(array[
     'exam_room_professors', 'exam_room_professor_activations',
     'exam_room_classrooms', 'exam_room_roster', 'exam_room_exams',
     'exam_room_question_sources', 'exam_room_question_versions',
     'exam_room_questions', 'exam_room_credentials',
     'exam_room_credential_windows', 'exam_room_attempts', 'exam_room_answers',
     'exam_room_integrity_events', 'exam_room_grades',
     'exam_room_grade_history', 'exam_room_releases',
     'exam_room_dispute_reviews', 'exam_room_backup_outbox',
     'exam_room_email_jobs', 'exam_room_audit_log',
     'exam_room_command_receipts'
   ])),
  21::bigint,
  'all twenty-one Examination Room tables exist'
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
    where n.nspname = 'public' and c.relname like 'exam_room_%'
      and c.relkind in ('r', 'p') and (not c.relrowsecurity or not c.relforcerowsecurity)
  ),
  'every Examination Room table has RLS enabled and forced'
);

select ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and (c.relname like 'dd2026_%' or c.relname like 'exam_room_%')
      and (
        has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
        or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
      )
  ),
  'browser roles have no direct privileges on new protected tables'
);

select ok(
  not exists (
    select 1
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and (c.relname like 'dd2026_%' or c.relname like 'exam_room_%')
      and acl.grantee = 0
  ),
  'PUBLIC has no direct grants on new protected tables'
);

select ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and (c.relname like 'dd2026_%' or c.relname like 'exam_room_%')
      and not has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
  ),
  'service role retains operational DML privileges on new tables'
);

select is(
  (select count(*) from public.dd2026_feature_flags),
  10::bigint,
  'the ten reviewed feature flags exist'
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
    select 1 from storage.buckets
    where id = 'exam-room-sources' and public = false
      and file_size_limit = 10485760
  ),
  'the Examination Room source bucket is private and limited to 10 MB'
);

select function_returns(
  'public', 'exam_room_live_status',
  array['uuid', 'uuid', 'text', 'text'], 'jsonb',
  'owning-professor live monitoring RPC exists'
);

select ok(
  has_function_privilege(
    'service_role', 'public.exam_room_live_status(uuid,uuid,text,text)', 'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated', 'public.exam_room_live_status(uuid,uuid,text,text)', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.exam_room_live_status(uuid,uuid,text,text)', 'EXECUTE'
  ),
  'live monitoring is Worker-only'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'exam_room_one_active_credential_idx'
      and indexdef ilike '%WHERE (status = ''active''%'
  ),
  'only one active credential exists for each exam/type/scope'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.exam_room_credentials'::regclass
      and pg_get_constraintdef(oid) ilike '%attempt_unlock%'
  ),
  'attempt-unlock is an explicit scoped credential type'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.exam_room_exams'::regclass
      and pg_get_constraintdef(oid) ilike '%requested_question_count > 0%'
  )
  and not exists (
    select 1 from pg_constraint
    where conrelid = 'public.exam_room_exams'::regclass
      and pg_get_constraintdef(oid) ~* 'requested_question_count\s*<=\s*20'
  ),
  'question count is positive without a hidden 20-question maximum'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.exam_room_answers'::regclass
      and pg_get_constraintdef(oid) ilike '%char_length(answer_text) <= 20000%'
  ),
  'answer storage enforces the 20,000-character limit'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.exam_room_grades'::regclass
      and pg_get_constraintdef(oid) ilike '%char_length(professor_comment) <= 5000%'
  ),
  'professor comments enforce the 5,000-character limit'
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

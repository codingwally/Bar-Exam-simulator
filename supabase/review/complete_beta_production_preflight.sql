-- Complete beta production preflight.
-- READ-ONLY and fail-fast. Run only after independently confirming that the
-- connected Supabase project is hbllomlijfznnuudpdvr.

begin;
set transaction read only;
set local search_path = public, extensions, pg_temp;

do $complete_beta_preflight$
declare
  v_name text;
  v_signature record;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception
      'COMPLETE_BETA_PREFLIGHT_FAILED: Supabase migration ledger is missing';
  end if;

  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260801010'
      and name = 'release_a_auth_submission_fix'
  ) then
    raise exception
      'COMPLETE_BETA_PREFLIGHT_FAILED: approved Release A ledger entry is missing';
  end if;

  if exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260805120000'
       or name = 'complete_beta_release_foundation'
  ) then
    raise exception
      'COMPLETE_BETA_PREFLIGHT_FAILED: complete beta migration already appears in the ledger';
  end if;

  foreach v_name in array array[
    'profiles',
    'user_roles',
    'subjects',
    'questions',
    'examination_definitions',
    'examination_versions',
    'examination_questions',
    'examination_version_questions',
    'examination_attempts_multi',
    'examination_responses',
    'examination_submissions',
    'examination_ai_assessments',
    'examination_model_releases',
    'forum_posts',
    'forum_comments',
    'forum_reactions',
    'forum_reposts',
    'forum_reports',
    'forum_user_restrictions',
    'forum_action_events',
    'forum_profile_settings',
    'forum_study_circles',
    'forum_circle_members',
    'forum_saved_entries',
    'forum_user_blocks',
    'forum_entry_indicators',
    'forum_post_attachments',
    'forum_notifications',
    'forum_telemetry_events'
  ]
  loop
    if to_regclass('public.' || v_name) is null then
      raise exception
        'COMPLETE_BETA_PREFLIGHT_FAILED: required table public.% is missing',
        v_name;
    end if;
  end loop;

  foreach v_name in array array[
    'release_content_syncs',
    'bar_feels_manifest',
    'subject_matter_cycles'
  ]
  loop
    if to_regclass('public.' || v_name) is not null then
      raise exception
        'COMPLETE_BETA_PREFLIGHT_FAILED: release table public.% already exists',
        v_name;
    end if;
  end loop;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'release_deterministic_uuid',
        'release_sync_subject_matter',
        'release_sync_bar_feels',
        'release_sync_all_content',
        'subject_matter_catalog',
        'subject_matter_next_question',
        'subject_matter_performance',
        'forum_quorum_insights',
        'forum_affirm_roster',
        'forum_set_affirm',
        'forum_publish_simple',
        'forum_set_attachment_alt'
      )
  ) then
    raise exception
      'COMPLETE_BETA_PREFLIGHT_FAILED: one or more release functions already exist';
  end if;

  foreach v_name in array array[
    'examination_require_admin',
    'forum_assert_member',
    'forum_assert_can_publish',
    'forum_enforce_action_limit',
    'forum_render_entry',
    'forum_create_notification',
    'forum_post_is_visible',
    'forum_users_blocked',
    'forum_safe_profile'
  ]
  loop
    if not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = v_name
    ) then
      raise exception
        'COMPLETE_BETA_PREFLIGHT_FAILED: required function public.% is missing',
        v_name;
    end if;
  end loop;

  for v_signature in
    select *
    from (
      values
        ('examination_definitions', 'id', 'uuid', 'NO'),
        ('examination_definitions', 'track', 'text', 'NO'),
        ('examination_definitions', 'assessment_kind', 'text', 'NO'),
        ('examination_definitions', 'subject', 'text', 'YES'),
        ('examination_definitions', 'year_level', 'int2', 'YES'),
        ('examination_definitions', 'semester', 'int2', 'YES'),
        ('examination_definitions', 'active_version_id', 'uuid', 'YES'),
        ('examination_versions', 'id', 'uuid', 'NO'),
        ('examination_versions', 'exam_id', 'uuid', 'NO'),
        ('examination_versions', 'allowed_timer_modes', 'jsonb', 'NO'),
        ('examination_versions', 'answer_release_rule', 'text', 'NO'),
        ('examination_questions', 'id', 'uuid', 'NO'),
        ('examination_questions', 'source_key', 'text', 'NO'),
        ('examination_questions', 'source_type', 'text', 'NO'),
        ('examination_questions', 'subject', 'text', 'NO'),
        ('examination_questions', 'prompt_text', 'text', 'NO'),
        ('examination_questions', 'model_answer', 'text', 'YES'),
        ('examination_questions', 'legal_basis', 'text', 'YES'),
        ('examination_questions', 'source_urls', 'jsonb', 'NO'),
        ('examination_questions', 'source_metadata', 'jsonb', 'NO'),
        ('examination_questions', 'review_status', 'text', 'NO'),
        ('examination_questions', 'publication_ready', 'bool', 'NO'),
        ('examination_questions', 'content_hash', 'text', 'NO'),
        ('examination_version_questions', 'version_id', 'uuid', 'NO'),
        ('examination_version_questions', 'question_id', 'uuid', 'NO'),
        ('examination_version_questions', 'ordinal', 'int2', 'NO'),
        ('examination_version_questions', 'prompt_snapshot', 'text', 'NO'),
        ('examination_version_questions', 'model_answer_snapshot', 'text', 'YES'),
        ('examination_version_questions', 'source_urls_snapshot', 'jsonb', 'NO')
    ) as expected(table_name, column_name, udt_name, is_nullable)
  loop
    if not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = v_signature.table_name
        and c.column_name = v_signature.column_name
        and c.udt_name = v_signature.udt_name
        and c.is_nullable = v_signature.is_nullable
    ) then
      raise exception
        'COMPLETE_BETA_PREFLIGHT_FAILED: column signature %.% % nullable=% differs',
        v_signature.table_name,
        v_signature.column_name,
        v_signature.udt_name,
        v_signature.is_nullable;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.examination_questions'::regclass
      and conname = 'examination_questions_review_status_check'
      and pg_get_constraintdef(oid, true)
        = 'CHECK (review_status = ANY (ARRAY[''pending''::text, ''approved''::text, ''rejected''::text]))'
  ) then
    raise exception
      'COMPLETE_BETA_PREFLIGHT_FAILED: examination review-status constraint differs';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.examination_questions'::regclass
      and conname = 'examination_questions_publication_truth_check'
      and pg_get_constraintdef(oid, true)
        = 'CHECK (NOT publication_ready OR review_status = ''approved''::text AND model_answer IS NOT NULL AND char_length(btrim(model_answer)) >= 20 AND legal_basis IS NOT NULL AND char_length(btrim(legal_basis)) >= 10 AND source_type = ''google_sheet''::text)'
  ) then
    raise exception
      'COMPLETE_BETA_PREFLIGHT_FAILED: examination publication constraint differs';
  end if;

  foreach v_name in array array[
    'examination_definitions',
    'examination_versions',
    'examination_questions',
    'examination_version_questions',
    'examination_attempts_multi',
    'examination_responses',
    'examination_submissions',
    'examination_ai_assessments',
    'examination_model_releases',
    'forum_posts',
    'forum_comments',
    'forum_reactions',
    'forum_reposts',
    'forum_reports',
    'forum_user_restrictions',
    'forum_action_events',
    'forum_profile_settings',
    'forum_study_circles',
    'forum_circle_members',
    'forum_saved_entries',
    'forum_user_blocks',
    'forum_entry_indicators',
    'forum_post_attachments',
    'forum_notifications',
    'forum_telemetry_events'
  ]
  loop
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_name
        and c.relrowsecurity
    ) then
      raise exception
        'COMPLETE_BETA_PREFLIGHT_FAILED: RLS is disabled on public.%', v_name;
    end if;

    if exists (
      select 1
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = v_name
        and grantee in ('PUBLIC', 'anon', 'authenticated')
    ) then
      raise exception
        'COMPLETE_BETA_PREFLIGHT_FAILED: browser grant exists on public.%', v_name;
    end if;
  end loop;

  if exists (
    select 1
    from auth.users
    where email like 'dd-complete-beta-%@duediligence.ph'
       or email like 'dd-exam-%@example.com'
       or email like 'visual-qa-%@duediligence.ph'
  ) or exists (
    select 1
    from public.forum_posts
    where body like '[SYNTHETIC VISUAL QA]%'
       or body like '[SYNTHETIC COMPLETE BETA]%'
  ) then
    raise exception
      'COMPLETE_BETA_PREFLIGHT_FAILED: synthetic release-test data exists in production';
  end if;

  raise notice
    'COMPLETE_BETA_PREFLIGHT_PASSED users=% profiles=% subjects=% questions=% examination_questions=% examination_attempts=% forum_posts=%',
    (select count(*) from auth.users),
    (select count(*) from public.profiles),
    (select count(*) from public.subjects),
    (select count(*) from public.questions),
    (select count(*) from public.examination_questions),
    (select count(*) from public.examination_attempts_multi),
    (select count(*) from public.forum_posts);
end
$complete_beta_preflight$;

select jsonb_build_object(
  'status', 'COMPLETE_BETA_PREFLIGHT_PASSED',
  'users', (select count(*) from auth.users),
  'profiles', (select count(*) from public.profiles),
  'subjects', (select count(*) from public.subjects),
  'questions', (select count(*) from public.questions),
  'examination_definitions', (select count(*) from public.examination_definitions),
  'examination_versions', (select count(*) from public.examination_versions),
  'examination_questions', (select count(*) from public.examination_questions),
  'examination_attempts', (select count(*) from public.examination_attempts_multi),
  'forum_posts', (select count(*) from public.forum_posts),
  'forum_comments', (select count(*) from public.forum_comments),
  'forum_reactions', (select count(*) from public.forum_reactions)
) as complete_beta_preflight;

rollback;

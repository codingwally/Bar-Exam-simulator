-- Lex Forum production preflight
-- READ-ONLY: performs catalog and aggregate checks, then returns one summary row.
-- It creates no objects and writes no data.

do $$
declare
  v_subjects bigint;
  v_questions bigint;
  v_forum_objects integer;
  v_latest_migration text;
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.user_roles') is null
     or to_regclass('public.admin_audit_log') is null
     or to_regclass('public.subjects') is null
     or to_regclass('public.questions') is null then
    raise exception 'LEX_FORUM_PREFLIGHT: required production foundation is missing';
  end if;

  if to_regprocedure('public.phase4_require_founder(uuid)') is null
     or to_regprocedure('public.admin_authorization_context(uuid)') is null then
    raise exception 'LEX_FORUM_PREFLIGHT: founder authorization foundation is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'school'
      and data_type = 'text'
  ) then
    raise exception 'LEX_FORUM_PREFLIGHT: profiles.school signature differs';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_roles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%founder_admin%'
      and pg_get_constraintdef(oid) like '%super_admin%'
  ) then
    raise exception 'LEX_FORUM_PREFLIGHT: administrator role constraint differs';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.admin_audit_log'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%content_management_action%'
  ) then
    raise exception 'LEX_FORUM_PREFLIGHT: audit action contract differs';
  end if;

  select count(*) into v_subjects from public.subjects;
  select count(*) into v_questions from public.questions;
  if v_subjects <> 8 then
    raise exception 'LEX_FORUM_PREFLIGHT: expected 8 subjects, found %', v_subjects;
  end if;
  if v_questions <> 2 then
    raise exception 'LEX_FORUM_PREFLIGHT: expected 2 existing database questions, found %', v_questions;
  end if;

  select count(*)::integer
  into v_forum_objects
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'forum_posts',
      'forum_comments',
      'forum_reactions',
      'forum_reposts',
      'forum_reports',
      'forum_user_restrictions',
      'forum_action_events'
    );
  if v_forum_objects <> 0 then
    raise exception 'LEX_FORUM_PREFLIGHT: forum tables already exist; reconcile before migration';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'forum_%'
  ) then
    raise exception 'LEX_FORUM_PREFLIGHT: forum functions already exist; reconcile before migration';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('profiles','user_roles','admin_audit_log')
      and grantee = 'PUBLIC'
  ) then
    raise exception 'LEX_FORUM_PREFLIGHT: unexpected PUBLIC grants exist on auth/admin foundation';
  end if;

  select version || ':' || name
  into v_latest_migration
  from supabase_migrations.schema_migrations
  order by version desc
  limit 1;
  if v_latest_migration is null
     or v_latest_migration not like '%release_a_auth_submission_fix%' then
    raise exception 'LEX_FORUM_PREFLIGHT: migration ledger latest entry differs: %',
      coalesce(v_latest_migration, 'missing');
  end if;
end
$$;

select
  'LEX_FORUM_PREFLIGHT_PASSED' as result,
  (select count(*) from public.subjects) as subjects_count,
  (select count(*) from public.questions) as database_questions_count,
  (select count(*) from auth.users) as auth_users_count,
  (select count(*) from public.profiles) as profiles_count,
  (select count(*) from public.submissions) as submissions_count,
  (select count(*) from public.grading_results) as grading_results_count,
  (
    select version || ':' || name
    from supabase_migrations.schema_migrations
    order by version desc
    limit 1
  ) as latest_migration;

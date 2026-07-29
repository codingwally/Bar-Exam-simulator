-- Quorum production preflight.
-- READ-ONLY and fail-fast. Run only after independently confirming that the
-- connected Supabase project is hbllomlijfznnuudpdvr.
--
-- This file makes no schema or data changes. It validates the deployed
-- Lex Forum beta foundation that migration 20260803_012 extends in place.

begin;
set transaction read only;
set local search_path = public, extensions, pg_temp;

do $quorum_preflight$
declare
  v_name text;
  v_signature record;
  v_constraint record;
  v_subjects text[];
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception
      'QUORUM_PREFLIGHT_FAILED: Supabase migration ledger is missing';
  end if;

  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260728233824'
      and name = 'lex_forum_social_beta_20260802'
  ) then
    raise exception
      'QUORUM_PREFLIGHT_FAILED: approved Lex Forum beta migration ledger entry is missing';
  end if;

  if exists (
    select 1
    from supabase_migrations.schema_migrations
    where name like 'quorum_complete%'
       or version = '20260803012'
  ) then
    raise exception
      'QUORUM_PREFLIGHT_FAILED: Quorum migration already appears in the ledger';
  end if;

  foreach v_name in array array[
    'profiles',
    'subjects',
    'questions',
    'submissions',
    'grading_results',
    'forum_posts',
    'forum_comments',
    'forum_reactions',
    'forum_reposts',
    'forum_reports',
    'forum_user_restrictions',
    'forum_action_events'
  ]
  loop
    if to_regclass('public.' || v_name) is null then
      raise exception 'QUORUM_PREFLIGHT_FAILED: required table public.% is missing', v_name;
    end if;
  end loop;

  foreach v_name in array array[
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
    if to_regclass('public.' || v_name) is not null then
      raise exception
        'QUORUM_PREFLIGHT_FAILED: Quorum table public.% already exists', v_name;
    end if;
  end loop;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'forum_quorum_query',
        'forum_quorum_command',
        'forum_quorum_admin'
      )
  ) then
    raise exception
      'QUORUM_PREFLIGHT_FAILED: Quorum RPC functions already exist';
  end if;

  if exists (
    select 1 from storage.buckets where id = 'quorum-images'
  ) then
    raise exception
      'QUORUM_PREFLIGHT_FAILED: quorum-images bucket already exists';
  end if;

  for v_signature in
    select *
    from (
      values
        ('forum_posts', 'id', 'uuid', 'NO'),
        ('forum_posts', 'author_user_id', 'uuid', 'NO'),
        ('forum_posts', 'body', 'text', 'NO'),
        ('forum_posts', 'source_url', 'text', 'YES'),
        ('forum_posts', 'moderation_status', 'text', 'NO'),
        ('forum_posts', 'created_at', 'timestamptz', 'NO'),
        ('forum_posts', 'updated_at', 'timestamptz', 'NO'),
        ('forum_comments', 'id', 'uuid', 'NO'),
        ('forum_comments', 'post_id', 'uuid', 'NO'),
        ('forum_comments', 'author_user_id', 'uuid', 'NO'),
        ('forum_comments', 'body', 'text', 'NO'),
        ('forum_comments', 'moderation_status', 'text', 'NO'),
        ('forum_reactions', 'post_id', 'uuid', 'NO'),
        ('forum_reactions', 'user_id', 'uuid', 'NO'),
        ('forum_reposts', 'id', 'uuid', 'NO'),
        ('forum_reposts', 'original_post_id', 'uuid', 'NO'),
        ('forum_reposts', 'user_id', 'uuid', 'NO'),
        ('forum_reposts', 'commentary', 'text', 'YES'),
        ('forum_reports', 'id', 'uuid', 'NO'),
        ('forum_reports', 'reporter_user_id', 'uuid', 'NO'),
        ('forum_reports', 'target_type', 'text', 'NO'),
        ('forum_reports', 'target_post_id', 'uuid', 'YES'),
        ('forum_reports', 'target_comment_id', 'uuid', 'YES'),
        ('forum_reports', 'category', 'text', 'NO'),
        ('forum_reports', 'status', 'text', 'NO'),
        ('forum_user_restrictions', 'id', 'uuid', 'NO'),
        ('forum_user_restrictions', 'user_id', 'uuid', 'NO'),
        ('forum_user_restrictions', 'created_by', 'uuid', 'NO'),
        ('forum_action_events', 'id', 'int8', 'NO'),
        ('forum_action_events', 'user_id', 'uuid', 'NO'),
        ('forum_action_events', 'action_type', 'text', 'NO')
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
        'QUORUM_PREFLIGHT_FAILED: column signature %.% % nullable=% differs',
        v_signature.table_name,
        v_signature.column_name,
        v_signature.udt_name,
        v_signature.is_nullable;
    end if;
  end loop;

  for v_constraint in
    select *
    from (
      values
        ('forum_posts', 'p', 'PRIMARY KEY (id)'),
        ('forum_posts', 'f', 'FOREIGN KEY (author_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT'),
        ('forum_comments', 'p', 'PRIMARY KEY (id)'),
        ('forum_comments', 'f', 'FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE'),
        ('forum_comments', 'f', 'FOREIGN KEY (author_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT'),
        ('forum_reactions', 'p', 'PRIMARY KEY (post_id, user_id)'),
        ('forum_reactions', 'f', 'FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE'),
        ('forum_reactions', 'f', 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
        ('forum_reposts', 'p', 'PRIMARY KEY (id)'),
        ('forum_reposts', 'f', 'FOREIGN KEY (original_post_id) REFERENCES forum_posts(id) ON DELETE CASCADE'),
        ('forum_reposts', 'f', 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
        ('forum_reports', 'p', 'PRIMARY KEY (id)'),
        ('forum_reports', 'f', 'FOREIGN KEY (reporter_user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
        ('forum_reports', 'f', 'FOREIGN KEY (target_post_id) REFERENCES forum_posts(id) ON DELETE CASCADE'),
        ('forum_reports', 'f', 'FOREIGN KEY (target_comment_id) REFERENCES forum_comments(id) ON DELETE CASCADE'),
        ('forum_user_restrictions', 'p', 'PRIMARY KEY (id)'),
        ('forum_user_restrictions', 'f', 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'),
        ('forum_user_restrictions', 'f', 'FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT'),
        ('forum_action_events', 'p', 'PRIMARY KEY (id)'),
        ('forum_action_events', 'f', 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE')
    ) as expected(table_name, constraint_type, definition)
  loop
    if not exists (
      select 1
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_constraint.table_name
        and con.contype = v_constraint.constraint_type::"char"
        and pg_get_constraintdef(con.oid, true) = v_constraint.definition
    ) then
      raise exception
        'QUORUM_PREFLIGHT_FAILED: constraint signature missing on %: %',
        v_constraint.table_name,
        v_constraint.definition;
    end if;
  end loop;

  foreach v_name in array array[
    'forum_posts',
    'forum_comments',
    'forum_reactions',
    'forum_reposts',
    'forum_reports',
    'forum_user_restrictions',
    'forum_action_events'
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
        'QUORUM_PREFLIGHT_FAILED: RLS is disabled on public.%', v_name;
    end if;

    if exists (
      select 1
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = v_name
        and grantee in ('PUBLIC', 'anon', 'authenticated')
    ) then
      raise exception
        'QUORUM_PREFLIGHT_FAILED: browser grant exists on public.%', v_name;
    end if;
  end loop;

  foreach v_name in array array[
    'forum_assert_member',
    'forum_assert_can_publish',
    'forum_enforce_action_limit',
    'forum_feed',
    'forum_create_post',
    'forum_update_post',
    'forum_delete_post',
    'forum_set_reaction',
    'forum_comments_for_post',
    'forum_create_comment',
    'forum_update_comment',
    'forum_delete_comment',
    'forum_create_repost',
    'forum_delete_repost',
    'forum_create_report',
    'forum_admin_queue',
    'forum_admin_action'
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
        'QUORUM_PREFLIGHT_FAILED: required beta function public.% is missing', v_name;
    end if;
  end loop;

  select array_agg(name order by sort_order)
  into v_subjects
  from public.subjects;

  if v_subjects is distinct from array[
    'Political and International Law',
    'Labor Law and Social Legislation',
    'Civil Law',
    'Taxation Law',
    'Commercial Law',
    'Criminal Law',
    'Remedial Law',
    'Legal and Judicial Ethics'
  ]::text[] then
    raise exception
      'QUORUM_PREFLIGHT_FAILED: approved eight-subject catalog differs';
  end if;

  if exists (
    select 1
    from auth.users
    where email like '%@example.invalid'
  ) or exists (
    select 1
    from public.forum_posts
    where body ilike '%synthetic%'
       or body ilike '%quorum test%'
  ) then
    raise exception
      'QUORUM_PREFLIGHT_FAILED: synthetic test data exists in production';
  end if;

  raise notice
    'QUORUM_PREFLIGHT_PASSED users=% profiles=% subjects=% questions=% forum_posts=% forum_reports=%',
    (select count(*) from auth.users),
    (select count(*) from public.profiles),
    (select count(*) from public.subjects),
    (select count(*) from public.questions),
    (select count(*) from public.forum_posts),
    (select count(*) from public.forum_reports);
end
$quorum_preflight$;

select jsonb_build_object(
  'status', 'QUORUM_PREFLIGHT_PASSED',
  'users', (select count(*) from auth.users),
  'profiles', (select count(*) from public.profiles),
  'subjects', (select count(*) from public.subjects),
  'questions', (select count(*) from public.questions),
  'submissions', (select count(*) from public.submissions),
  'grading_results', (select count(*) from public.grading_results),
  'forum_posts', (select count(*) from public.forum_posts),
  'forum_comments', (select count(*) from public.forum_comments),
  'forum_reactions', (select count(*) from public.forum_reactions),
  'forum_reposts', (select count(*) from public.forum_reposts),
  'forum_reports', (select count(*) from public.forum_reports),
  'forum_restrictions', (select count(*) from public.forum_user_restrictions),
  'forum_events', (select count(*) from public.forum_action_events)
) as quorum_preflight;

rollback;

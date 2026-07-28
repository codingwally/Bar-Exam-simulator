-- Lex Forum structural security contract.
-- Run only after the Lex Forum migration in local/disposable staging.

begin;
set local search_path = public, extensions, auth, pg_temp;
select plan(50);

select has_table('public', 'forum_posts', 'forum_posts exists');
select has_table('public', 'forum_comments', 'forum_comments exists');
select has_table('public', 'forum_reactions', 'forum_reactions exists');
select has_table('public', 'forum_reposts', 'forum_reposts exists');
select has_table('public', 'forum_reports', 'forum_reports exists');
select has_table('public', 'forum_user_restrictions', 'forum_user_restrictions exists');
select has_table('public', 'forum_action_events', 'forum_action_events exists');

select ok((select relrowsecurity from pg_class where oid = 'public.forum_posts'::regclass), 'forum_posts uses RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.forum_comments'::regclass), 'forum_comments uses RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.forum_reactions'::regclass), 'forum_reactions uses RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.forum_reposts'::regclass), 'forum_reposts uses RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.forum_reports'::regclass), 'forum_reports uses RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.forum_user_restrictions'::regclass), 'forum_user_restrictions uses RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.forum_action_events'::regclass), 'forum_action_events uses RLS');

select ok(
  not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'forum_posts' and grantee = 'PUBLIC')
  and not has_table_privilege('anon', 'public.forum_posts', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.forum_posts', 'select,insert,update,delete'),
  'forum_posts has no browser-facing direct grants'
);
select ok(
  not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'forum_comments' and grantee = 'PUBLIC')
  and not has_table_privilege('anon', 'public.forum_comments', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.forum_comments', 'select,insert,update,delete'),
  'forum_comments has no browser-facing direct grants'
);
select ok(
  not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'forum_reactions' and grantee = 'PUBLIC')
  and not has_table_privilege('anon', 'public.forum_reactions', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.forum_reactions', 'select,insert,update,delete'),
  'forum_reactions has no browser-facing direct grants'
);
select ok(
  not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'forum_reposts' and grantee = 'PUBLIC')
  and not has_table_privilege('anon', 'public.forum_reposts', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.forum_reposts', 'select,insert,update,delete'),
  'forum_reposts has no browser-facing direct grants'
);
select ok(
  not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'forum_reports' and grantee = 'PUBLIC')
  and not has_table_privilege('anon', 'public.forum_reports', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.forum_reports', 'select,insert,update,delete'),
  'forum_reports has no browser-facing direct grants'
);
select ok(
  not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'forum_user_restrictions' and grantee = 'PUBLIC')
  and not has_table_privilege('anon', 'public.forum_user_restrictions', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.forum_user_restrictions', 'select,insert,update,delete'),
  'forum_user_restrictions has no browser-facing direct grants'
);
select ok(
  not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'forum_action_events' and grantee = 'PUBLIC')
  and not has_table_privilege('anon', 'public.forum_action_events', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'public.forum_action_events', 'select,insert,update,delete'),
  'forum_action_events has no browser-facing direct grants'
);

select ok(
  has_table_privilege('service_role', 'public.forum_posts', 'select,insert,update,delete')
  and has_table_privilege('service_role', 'public.forum_comments', 'select,insert,update,delete')
  and has_table_privilege('service_role', 'public.forum_reactions', 'select,insert,update,delete')
  and has_table_privilege('service_role', 'public.forum_reposts', 'select,insert,update,delete')
  and has_table_privilege('service_role', 'public.forum_reports', 'select,insert,update,delete')
  and has_table_privilege('service_role', 'public.forum_user_restrictions', 'select,insert,update,delete')
  and has_table_privilege('service_role', 'public.forum_action_events', 'select,insert,delete'),
  'service_role has the reviewed Worker storage privileges'
);

select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'forum_posts', 'forum_comments', 'forum_reactions', 'forum_reposts',
        'forum_reports', 'forum_user_restrictions', 'forum_action_events'
      )
  ),
  'forum tables expose no direct browser RLS policies'
);

select has_function('public', 'forum_assert_member', array['uuid'], 'member assertion exists');
select has_function('public', 'forum_assert_can_publish', array['uuid'], 'publish assertion exists');
select has_function('public', 'forum_enforce_action_limit', array['uuid','text','integer','interval'], 'persistent rate limit exists');
select has_function('public', 'forum_feed', array['uuid','integer','timestamp with time zone','uuid','uuid'], 'authenticated feed exists');
select has_function('public', 'forum_comments_for_post', array['uuid','uuid','integer'], 'authenticated comments query exists');
select has_function('public', 'forum_create_post', array['uuid','text','text'], 'post create exists');
select has_function('public', 'forum_update_post', array['uuid','uuid','text','text'], 'post update exists');
select has_function('public', 'forum_delete_post', array['uuid','uuid'], 'post soft delete exists');
select has_function('public', 'forum_set_reaction', array['uuid','uuid','boolean'], 'idempotent reaction setter exists');
select has_function('public', 'forum_create_comment', array['uuid','uuid','text'], 'comment create exists');
select has_function('public', 'forum_update_comment', array['uuid','uuid','text'], 'comment update exists');
select has_function('public', 'forum_delete_comment', array['uuid','uuid'], 'comment soft delete exists');
select has_function('public', 'forum_create_repost', array['uuid','uuid','text'], 'repost create exists');
select has_function('public', 'forum_delete_repost', array['uuid','uuid'], 'repost soft delete exists');
select has_function('public', 'forum_create_report', array['uuid','text','uuid','text','text'], 'private report create exists');
select has_function('public', 'forum_admin_queue', array['uuid','text','integer','integer'], 'founder moderation queue exists');
select has_function('public', 'forum_admin_action', array['uuid','text','uuid','text','integer','text'], 'audited moderation action exists');

select ok(
  not exists (
    select 1
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name like 'forum_%'
      and grantee = 'PUBLIC'
  ),
  'PUBLIC cannot execute forum functions'
);
select ok(
  not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'forum_%'
      and has_function_privilege('anon', p.oid, 'execute')
  ),
  'anon cannot execute forum functions'
);
select ok(
  not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'forum_%'
      and has_function_privilege('authenticated', p.oid, 'execute')
  ),
  'authenticated cannot execute forum functions directly'
);
select ok(
  not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'forum_%'
      and not has_function_privilege('service_role', p.oid, 'execute')
  ),
  'service_role can execute every reviewed forum function'
);

select is(
  (
    select count(*)::integer
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'forum_posts_feed_idx', 'forum_posts_author_idx',
        'forum_comments_post_idx', 'forum_comments_author_idx',
        'forum_reactions_post_idx', 'forum_reactions_user_idx',
        'forum_reposts_feed_idx', 'forum_reposts_original_idx',
        'forum_reposts_active_user_post_uidx', 'forum_reports_queue_idx',
        'forum_reports_unique_post_uidx', 'forum_reports_unique_comment_uidx',
        'forum_restrictions_user_idx', 'forum_restrictions_active_user_uidx',
        'forum_action_events_rate_idx'
      )
  ),
  15,
  'all reviewed feed, ownership, count, queue, and rate-limit indexes exist'
);

select is(
  (
    select count(*)::integer
    from pg_constraint
    where contype = 'p'
      and conrelid in (
        'public.forum_posts'::regclass,
        'public.forum_comments'::regclass,
        'public.forum_reactions'::regclass,
        'public.forum_reposts'::regclass,
        'public.forum_reports'::regclass,
        'public.forum_user_restrictions'::regclass,
        'public.forum_action_events'::regclass
      )
  ),
  7,
  'every forum table has a reviewed primary key'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.forum_comments'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like '%FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE%'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = 'public.forum_reports'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like '%FOREIGN KEY (target_comment_id) REFERENCES forum_comments(id) ON DELETE CASCADE%'
  )
  and exists (
    select 1
    from pg_constraint c
    join pg_attribute source_column
      on source_column.attrelid = c.conrelid
     and source_column.attnum = c.conkey[1]
    join pg_attribute target_column
      on target_column.attrelid = c.confrelid
     and target_column.attnum = c.confkey[1]
    where c.conrelid = 'public.forum_user_restrictions'::regclass
      and c.contype = 'f'
      and c.confrelid = 'auth.users'::regclass
      and source_column.attname = 'created_by'
      and target_column.attname = 'id'
      and c.confdeltype = 'r'
  ),
  'reviewed cascade and restriction foreign-key actions exist'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.forum_posts'::regclass
      and contype = 'c'
      and conname = 'forum_posts_no_email_check'
  ),
  'forum posts reject stored email addresses'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.forum_comments'::regclass
      and contype = 'c'
      and conname = 'forum_comments_no_email_check'
  ),
  'forum comments reject stored email addresses'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.forum_reposts'::regclass
      and contype = 'c'
      and conname = 'forum_reposts_no_email_check'
  ),
  'forum repost commentary rejects stored email addresses'
);

select * from finish();
rollback;

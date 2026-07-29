-- Quorum structural and least-privilege contract.
-- Read-only assertions; safe for staging after the Quorum migration.

do $quorum_structural$
declare
  v_table text;
  v_function text;
  v_index text;
begin
  foreach v_table in array array[
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
    if to_regclass('public.' || v_table) is null then
      raise exception 'QUORUM_STRUCTURAL_FAILED: missing table %', v_table;
    end if;
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_table
        and c.relrowsecurity
    ) then
      raise exception 'QUORUM_STRUCTURAL_FAILED: RLS disabled on %', v_table;
    end if;
    if exists (
      select 1
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = v_table
        and grantee in ('PUBLIC', 'anon', 'authenticated')
    )
    then
      raise exception 'QUORUM_STRUCTURAL_FAILED: browser grant on %', v_table;
    end if;
  end loop;

  foreach v_function in array array[
    'forum_public_id',
    'forum_users_blocked',
    'forum_safe_profile',
    'forum_post_is_visible',
    'forum_create_notification',
    'forum_render_entry',
    'forum_quorum_query',
    'forum_quorum_command',
    'forum_quorum_admin'
  ]
  loop
    if not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_function
    ) then
      raise exception 'QUORUM_STRUCTURAL_FAILED: missing function %', v_function;
    end if;
    if exists (
      select 1
      from information_schema.routine_privileges
      where routine_schema = 'public'
        and routine_name = v_function
        and grantee in ('PUBLIC', 'anon', 'authenticated')
    ) then
      raise exception 'QUORUM_STRUCTURAL_FAILED: browser execute grant on %', v_function;
    end if;
  end loop;

  if not exists (
    select 1
    from storage.buckets
    where id = 'quorum-images'
      and public is false
      and file_size_limit = 3145728
      and allowed_mime_types @> array[
        'image/jpeg', 'image/png', 'image/webp'
      ]::text[]
  ) then
    raise exception 'QUORUM_STRUCTURAL_FAILED: private image bucket contract missing';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        coalesce(qual, '') ilike '%quorum-images%'
        or coalesce(with_check, '') ilike '%quorum-images%'
      )
      and roles && array['anon'::name, 'authenticated'::name, 'public'::name]
  ) then
    raise exception 'QUORUM_STRUCTURAL_FAILED: browser storage policy exposes Quorum images';
  end if;

  foreach v_index in array array[
    'forum_posts_search_gin_idx',
    'forum_study_circles_search_gin_idx',
    'forum_notifications_actor_idx',
    'forum_notifications_circle_idx',
    'forum_notifications_comment_idx',
    'forum_notifications_post_idx',
    'forum_reports_target_circle_idx',
    'forum_reports_target_comment_idx',
    'forum_reports_target_post_idx',
    'forum_saved_entries_post_idx',
    'forum_telemetry_events_user_idx'
  ]
  loop
    if not exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and indexname = v_index
    ) then
      raise exception 'QUORUM_STRUCTURAL_FAILED: required index % missing', v_index;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'forum_profile_settings_after_auth_user_insert'
      and not tgisinternal
  ) then
    raise exception 'QUORUM_STRUCTURAL_FAILED: profile-settings trigger missing';
  end if;
end
$quorum_structural$;

select 'Quorum structural contract passed.' as result;

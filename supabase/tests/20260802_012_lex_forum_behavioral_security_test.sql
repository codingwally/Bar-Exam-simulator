-- Lex Forum behavioral and authorization tests.
-- Disposable staging/local database only. Every synthetic record is rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values
  (
    'fa000000-0000-4000-8000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'lex-a@example.invalid',
    '{}'::jsonb, '{"full_name":"Lex Student A"}'::jsonb,
    now(), now(), false, false
  ),
  (
    'fa000000-0000-4000-8000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'lex-b@example.invalid',
    '{}'::jsonb, '{"full_name":"Lex Student B"}'::jsonb,
    now(), now(), false, false
  ),
  (
    'fa000000-0000-4000-8000-000000000003'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'lex-moderator@example.invalid',
    '{}'::jsonb, '{"full_name":"Lex Founder Moderator"}'::jsonb,
    now(), now(), false, false
  );

update public.profiles
set display_name = case id
      when 'fa000000-0000-4000-8000-000000000001'::uuid then 'Lex Student A'
      when 'fa000000-0000-4000-8000-000000000002'::uuid then 'Lex Student B'
      else 'Lex Founder Moderator'
    end,
    school = case id
      when 'fa000000-0000-4000-8000-000000000001'::uuid then 'Synthetic Law School A'
      when 'fa000000-0000-4000-8000-000000000002'::uuid then 'Synthetic Law School B'
      else 'Synthetic Review Board'
    end
where id in (
  'fa000000-0000-4000-8000-000000000001'::uuid,
  'fa000000-0000-4000-8000-000000000002'::uuid,
  'fa000000-0000-4000-8000-000000000003'::uuid
);

update public.user_roles
set role = 'founder_admin',
    assigned_by = 'fa000000-0000-4000-8000-000000000003'::uuid,
    updated_at = now()
where user_id = 'fa000000-0000-4000-8000-000000000003'::uuid;

do $lex_forum_test$
declare
  user_a constant uuid := 'fa000000-0000-4000-8000-000000000001'::uuid;
  user_b constant uuid := 'fa000000-0000-4000-8000-000000000002'::uuid;
  moderator constant uuid := 'fa000000-0000-4000-8000-000000000003'::uuid;
  post_a uuid;
  post_b uuid;
  comment_b uuid;
  repost_b uuid;
  report_b uuid;
  restriction_a uuid;
  result jsonb;
  feed_one jsonb;
  feed_two jsonb;
  queue jsonb;
  cursor_at timestamptz;
  cursor_id uuid;
  feed_ids uuid[];
  second_ids uuid[];
  idx integer;
begin
  if exists (
       select 1 from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'forum_posts' and grantee = 'PUBLIC'
     )
     or has_table_privilege('anon', 'public.forum_posts', 'select')
     or has_table_privilege('authenticated', 'public.forum_posts', 'select') then
    raise exception 'LEX_TEST_FAILED: browser roles received direct forum table access';
  end if;

  begin
    perform public.forum_feed(null, 10, null, null, null);
    raise exception 'LEX_TEST_FAILED: signed-out feed unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%FORUM_AUTHENTICATION_REQUIRED%' then raise; end if;
  end;

  result := public.forum_create_post(
    user_a,
    '<img src=x onerror=alert(1)> The NLRC doctrine should be verified from the official source.',
    'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/68904'
  );
  post_a := (result->>'id')::uuid;
  if (
    select body from public.forum_posts where id = post_a
  ) <> '<img src=x onerror=alert(1)> The NLRC doctrine should be verified from the official source.' then
    raise exception 'LEX_TEST_FAILED: plain text content changed unexpectedly';
  end if;

  begin
    perform public.forum_create_post(
      user_a,
      'Private contact must not be published: student@example.com.',
      null
    );
    raise exception 'LEX_TEST_FAILED: post containing an email unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%FORUM_PRIVATE_CONTACT%' then raise; end if;
  end;

  begin
    perform public.forum_create_post(
      user_a,
      'Unsafe source validation test.',
      'https://user:password@example.com/case'
    );
    raise exception 'LEX_TEST_FAILED: credentialed source URL unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%FORUM_SOURCE_URL_INVALID%' then raise; end if;
  end;

  begin
    perform public.forum_create_post(
      user_a,
      '<img src=x onerror=alert(1)> The NLRC doctrine should be verified from the official source.',
      null
    );
    raise exception 'LEX_TEST_FAILED: duplicate post unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%FORUM_DUPLICATE_POST%' then raise; end if;
  end;

  result := public.forum_create_post(
    user_b,
    'A second member asks how the doctrine applies to the stated labor facts.',
    null
  );
  post_b := (result->>'id')::uuid;

  begin
    perform public.forum_update_post(
      user_b,
      post_a,
      'Cross-user edit must never persist.',
      null
    );
    raise exception 'LEX_TEST_FAILED: cross-user post edit unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%FORUM_OWNERSHIP_REQUIRED%' then raise; end if;
  end;

  perform public.forum_update_post(
    user_a,
    post_a,
    '<img src=x onerror=alert(1)> The NLRC doctrine must be verified from the official source before reliance.',
    'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/68904'
  );
  if not exists (
    select 1 from public.forum_posts where id = post_a and edited_at is not null
  ) then
    raise exception 'LEX_TEST_FAILED: post edit marker was not recorded';
  end if;

  result := public.forum_set_reaction(user_b, post_a, true);
  result := public.forum_set_reaction(user_b, post_a, true);
  if (result->>'liked')::boolean is not true
     or (result->>'count')::integer <> 1 then
    raise exception 'LEX_TEST_FAILED: idempotent like did not retain exactly one reaction';
  end if;

  result := public.forum_create_comment(
    user_b,
    post_a,
    'The application should identify the employee facts that trigger the cited doctrine.'
  );
  comment_b := (result->>'id')::uuid;

  begin
    perform public.forum_update_comment(
      user_a,
      comment_b,
      'Cross-user comment edit must never persist.'
    );
    raise exception 'LEX_TEST_FAILED: cross-user comment edit unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%FORUM_OWNERSHIP_REQUIRED%' then raise; end if;
  end;

  perform public.forum_update_comment(
    user_b,
    comment_b,
    'The application must identify the employee facts that trigger the cited doctrine.'
  );
  if not exists (
    select 1 from public.forum_comments where id = comment_b and edited_at is not null
  ) then
    raise exception 'LEX_TEST_FAILED: comment edit marker was not recorded';
  end if;

  result := public.forum_create_repost(
    user_b,
    post_a,
    'A useful source-discipline reminder for Labor Law review.'
  );
  repost_b := (result->>'id')::uuid;
  result := public.forum_create_repost(
    user_b,
    post_a,
    'Opening the dialog twice must not create two reposts.'
  );
  if (result->>'id')::uuid <> repost_b
     or (select count(*) from public.forum_reposts
         where user_id = user_b and original_post_id = post_a and deleted_at is null) <> 1 then
    raise exception 'LEX_TEST_FAILED: repost idempotency failed';
  end if;

  result := public.forum_create_report(
    user_b,
    'post',
    post_a,
    'misinformation',
    'The doctrine should be checked against the linked official decision.'
  );
  report_b := (result->>'id')::uuid;
  begin
    perform public.forum_create_report(
      user_b,
      'post',
      post_a,
      'misinformation',
      'Duplicate report spam.'
    );
    raise exception 'LEX_TEST_FAILED: duplicate report unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%FORUM_DUPLICATE_REPORT%' then raise; end if;
  end;

  update public.profiles
  set display_name = 'private@example.com',
      school = 'registrar@example.com'
  where id = user_b;
  feed_one := public.forum_feed(user_b, 10, null, null, null);
  if jsonb_array_length(feed_one->'items') < 3 then
    raise exception 'LEX_TEST_FAILED: expected original posts and attributed repost';
  end if;
  if (feed_one::text like '%example.invalid%'
      or feed_one::text like '%' || user_a::text || '%'
      or feed_one::text like '%' || user_b::text || '%'
      or feed_one::text like '%private@example.com%'
      or feed_one::text like '%registrar@example.com%') then
    raise exception 'LEX_TEST_FAILED: private email or authentication UUID leaked in feed';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(feed_one->'items') item
    where item->>'postId' = post_a::text
      and (item->'counts'->>'likes')::integer = 1
      and (item->'counts'->>'comments')::integer = 1
      and (item->'counts'->>'shares')::integer = 1
  ) then
    raise exception 'LEX_TEST_FAILED: authoritative interaction counts differ';
  end if;

  begin
    perform public.forum_admin_queue(user_a, 'pending', 100, 0);
    raise exception 'LEX_TEST_FAILED: ordinary user moderation unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%Founder administrator authorization required%' then raise; end if;
  end;

  queue := public.forum_admin_queue(moderator, 'pending', 100, 0);
  if not exists (
    select 1 from jsonb_array_elements(queue->'reports') row
    where row->>'id' = report_b::text
      and row->>'content' like '%NLRC doctrine%'
  ) then
    raise exception 'LEX_TEST_FAILED: founder moderation queue omitted report content';
  end if;

  perform public.forum_admin_action(
    moderator, 'hide_content', report_b,
    'Temporarily hidden during verified doctrine review.',
    null, 'lex-hide-request-0001'
  );
  result := public.forum_admin_action(
    moderator, 'hide_content', report_b,
    'Temporarily hidden during verified doctrine review.',
    null, 'lex-hide-request-0001'
  );
  if coalesce((result->>'replayed')::boolean, false) is not true then
    raise exception 'LEX_TEST_FAILED: identical moderation retry was not idempotent';
  end if;
  begin
    perform public.forum_admin_action(
      moderator, 'restore_content', report_b,
      'A reused request key must not authorize a different action.',
      null, 'lex-hide-request-0001'
    );
    raise exception 'LEX_TEST_FAILED: conflicting moderation request key unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%FORUM_ADMIN_REQUEST_KEY_CONFLICT%' then raise; end if;
  end;
  feed_one := public.forum_feed(user_b, 20, null, null, null);
  if exists (
    select 1 from jsonb_array_elements(feed_one->'items') item
    where item->>'postId' = post_a::text
  ) then
    raise exception 'LEX_TEST_FAILED: hidden content leaked into member feed';
  end if;
  begin
    perform public.forum_comments_for_post(user_b, post_a, 100);
    raise exception 'LEX_TEST_FAILED: comments for hidden post unexpectedly disclosed';
  exception when others then
    if sqlerrm not like '%FORUM_POST_NOT_FOUND%' then raise; end if;
  end;

  perform public.forum_admin_action(
    moderator, 'restore_content', report_b,
    'Official source review completed; discussion restored.',
    null, 'lex-restore-request-01'
  );
  if not exists (
    select 1
    from jsonb_array_elements(public.forum_feed(user_b, 20, null, null, null)->'items') item
    where item->>'postId' = post_a::text
  ) then
    raise exception 'LEX_TEST_FAILED: restored content did not return to feed';
  end if;

  result := public.forum_admin_action(
    moderator, 'restrict_user', report_b,
    'Temporary restriction after repeated source-discipline concerns.',
    24, 'lex-restrict-request-1'
  );
  restriction_a := (result->>'targetId')::uuid;
  begin
    perform public.forum_create_post(
      user_a,
      'Restricted member must not be able to publish.',
      null
    );
    raise exception 'LEX_TEST_FAILED: restricted publishing unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%FORUM_POSTING_RESTRICTED%' then raise; end if;
  end;

  perform public.forum_admin_action(
    moderator, 'remove_restriction', restriction_a,
    'Restriction lifted after moderation review.',
    null, 'lex-unrestrict-request1'
  );
  perform public.forum_create_post(
    user_a,
    'Publishing resumes after the exact forum restriction is lifted.',
    null
  );

  if (
    select count(*)
    from public.admin_audit_log
    where actor_user_id = moderator
      and action_type = 'content_management_action'
      and target_resource_type in ('forum_post', 'forum_user_restriction')
  ) <> 4 then
    raise exception 'LEX_TEST_FAILED: moderation actions were not fully audited';
  end if;

  result := public.forum_set_reaction(user_b, post_a, false);
  result := public.forum_set_reaction(user_b, post_a, false);
  if (result->>'liked')::boolean is not false
     or (result->>'count')::integer <> 0 then
    raise exception 'LEX_TEST_FAILED: idempotent unlike did not retain zero reactions';
  end if;

  perform public.forum_delete_comment(user_b, comment_b);
  perform public.forum_delete_comment(user_b, comment_b);
  if exists (
    select 1 from jsonb_array_elements(public.forum_comments_for_post(user_a, post_a, 100)) row
    where row->>'id' = comment_b::text
  ) then
    raise exception 'LEX_TEST_FAILED: soft-deleted comment leaked';
  end if;

  perform public.forum_delete_repost(user_b, repost_b);
  perform public.forum_delete_repost(user_b, repost_b);
  if exists (
    select 1 from jsonb_array_elements(public.forum_feed(user_a, 20, null, null, null)->'items') row
    where row->>'kind' = 'repost' and row->>'id' = repost_b::text
  ) then
    raise exception 'LEX_TEST_FAILED: soft-deleted repost leaked';
  end if;

  for idx in 1..22 loop
    insert into public.forum_posts (author_user_id, body, created_at, updated_at)
    values (
      user_a,
      'Synthetic pagination discussion ' || idx::text,
      now() - make_interval(secs => idx),
      now() - make_interval(secs => idx)
    );
  end loop;
  feed_one := public.forum_feed(user_b, 10, null, null, null);
  if jsonb_array_length(feed_one->'items') <> 10
     or not (feed_one->>'hasMore')::boolean then
    raise exception 'LEX_TEST_FAILED: first pagination page is invalid';
  end if;
  cursor_at := (feed_one->'nextCursor'->>'createdAt')::timestamptz;
  cursor_id := (feed_one->'nextCursor'->>'id')::uuid;
  feed_two := public.forum_feed(user_b, 10, cursor_at, cursor_id, null);
  select array_agg((row->>'id')::uuid)
  into feed_ids
  from jsonb_array_elements(feed_one->'items') row;
  select array_agg((row->>'id')::uuid)
  into second_ids
  from jsonb_array_elements(feed_two->'items') row;
  if feed_ids && second_ids then
    raise exception 'LEX_TEST_FAILED: pagination returned duplicate feed items';
  end if;

  for idx in 1..4 loop
    perform public.forum_create_post(
      user_b,
      'Rate-limit post ' || idx::text || ' with distinct educational content.',
      null
    );
  end loop;
  begin
    perform public.forum_create_post(
      user_b,
      'This sixth post inside the rate window must be rejected.',
      null
    );
    raise exception 'LEX_TEST_FAILED: persistent post rate limit unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%FORUM_RATE_LIMITED%' then raise; end if;
  end;

  begin
    perform public.forum_delete_post(user_b, post_a);
    raise exception 'LEX_TEST_FAILED: cross-user post deletion unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%FORUM_OWNERSHIP_REQUIRED%' then raise; end if;
  end;
  perform public.forum_delete_post(user_a, post_a);
  perform public.forum_delete_post(user_a, post_a);
  if exists (
    select 1 from jsonb_array_elements(public.forum_feed(user_b, 20, null, null, null)->'items') row
    where row->>'postId' = post_a::text
  ) then
    raise exception 'LEX_TEST_FAILED: soft-deleted post leaked';
  end if;
end;
$lex_forum_test$;

select
  'LEX_FORUM_BEHAVIORAL_TEST_PASSED' as result,
  (select count(*) from auth.users where email like 'lex-%@example.invalid') as synthetic_users_inside_transaction,
  (select count(*) from public.admin_audit_log
   where actor_user_id = 'fa000000-0000-4000-8000-000000000003'::uuid
     and action_type = 'content_management_action') as audited_actions_inside_transaction;

rollback;

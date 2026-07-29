-- Quorum behavioral and authorization tests.
-- Disposable staging/local database only. Every synthetic record is rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values
  (
    'fb000000-0000-4000-8000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'quorum-a@example.invalid',
    '{}'::jsonb, '{"full_name":"Quorum Student A"}'::jsonb,
    now(), now(), false, false
  ),
  (
    'fb000000-0000-4000-8000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'quorum-b@example.invalid',
    '{}'::jsonb, '{"full_name":"Quorum Student B"}'::jsonb,
    now(), now(), false, false
  ),
  (
    'fb000000-0000-4000-8000-000000000003'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'quorum-admin@example.invalid',
    '{}'::jsonb, '{"full_name":"Quorum Founder Moderator"}'::jsonb,
    now(), now(), false, false
  );

update public.profiles
set display_name = case id
      when 'fb000000-0000-4000-8000-000000000001'::uuid then 'Quorum Student A'
      when 'fb000000-0000-4000-8000-000000000002'::uuid then 'Quorum Student B'
      else 'Quorum Founder Moderator'
    end,
    school = 'Synthetic Law School',
    year_level = 'Third Year'
where id in (
  'fb000000-0000-4000-8000-000000000001'::uuid,
  'fb000000-0000-4000-8000-000000000002'::uuid,
  'fb000000-0000-4000-8000-000000000003'::uuid
);

update public.user_roles
set role = 'founder_admin',
    assigned_by = 'fb000000-0000-4000-8000-000000000003'::uuid,
    updated_at = now()
where user_id = 'fb000000-0000-4000-8000-000000000003'::uuid;

do $quorum_behavior$
declare
  user_a constant uuid := 'fb000000-0000-4000-8000-000000000001'::uuid;
  user_b constant uuid := 'fb000000-0000-4000-8000-000000000002'::uuid;
  moderator constant uuid := 'fb000000-0000-4000-8000-000000000003'::uuid;
  entry_a text;
  entry_b text;
  announcement text;
  comment_b text;
  reply_a text;
  circle_a text;
  member_a text;
  member_b text;
  report_b text;
  restriction_b text;
  result jsonb;
  queue jsonb;
begin
  if not exists (
    select 1 from public.forum_profile_settings where user_id = user_a
  ) then
    raise exception 'QUORUM_TEST_FAILED: auth trigger did not create profile settings';
  end if;

  member_a := (
    select public_id from public.forum_profile_settings where user_id = user_a
  );
  member_b := (
    select public_id from public.forum_profile_settings where user_id = user_b
  );

  begin
    perform public.forum_quorum_query(null, 'feed', '{}'::jsonb);
    raise exception 'QUORUM_TEST_FAILED: signed-out query unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%FORUM_AUTHENTICATION_REQUIRED%' then raise; end if;
  end;

  result := public.forum_quorum_command(user_a, 'create_entry', jsonb_build_object(
    'body', '<img src=x onerror=alert(1)> Article 294 should be read with the official source and the stated facts.',
    'entryType', 'discuss_legal_issue',
    'subject', 'Labor Law',
    'category', 'philippine_jurisprudence',
    'lawSchoolYear', 'Third Year',
    'sourceUrl', 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/68904',
    'opinionOnly', false
  ));
  entry_a := result->>'entryId';
  if entry_a !~ '^qe_[a-f0-9]{20}$' then
    raise exception 'QUORUM_TEST_FAILED: opaque entry ID missing';
  end if;

  result := public.forum_quorum_query(user_b, 'feed', jsonb_build_object(
    'subject', 'Labor Law', 'limit', 10
  ));
  if jsonb_array_length(result->'items') <> 1
    or result::text like '%' || user_a::text || '%'
  then
    raise exception 'QUORUM_TEST_FAILED: feed count or UUID privacy failed';
  end if;

  begin
    perform public.forum_quorum_command(user_b, 'update_entry', jsonb_build_object(
      'entryId', entry_a,
      'body', 'Cross-user edits must fail.',
      'entryType', 'discuss_legal_issue',
      'subject', 'Labor Law',
      'category', 'philippine_jurisprudence',
      'opinionOnly', false
    ));
    raise exception 'QUORUM_TEST_FAILED: cross-user entry edit succeeded';
  exception when others then
    if sqlerrm not like '%FORUM_OWNERSHIP_REQUIRED%' then raise; end if;
  end;

  result := public.forum_quorum_command(user_b, 'set_helpful', jsonb_build_object(
    'entryId', entry_a, 'enabled', true
  ));
  result := public.forum_quorum_command(user_b, 'set_helpful', jsonb_build_object(
    'entryId', entry_a, 'enabled', true
  ));
  if (result->>'count')::integer <> 1 then
    raise exception 'QUORUM_TEST_FAILED: Helpful was not idempotent';
  end if;

  result := public.forum_quorum_command(user_b, 'create_comment', jsonb_build_object(
    'entryId', entry_a,
    'body', 'The application should connect Article 294 to the stated dismissal facts.'
  ));
  comment_b := result->>'commentId';
  result := public.forum_quorum_command(user_a, 'create_comment', jsonb_build_object(
    'entryId', entry_a,
    'parentCommentId', comment_b,
    'body', 'Agreed. The factual link is what makes the doctrine useful in a Bar answer.'
  ));
  reply_a := result->>'commentId';
  if comment_b !~ '^qc_[a-f0-9]{20}$' or reply_a !~ '^qc_[a-f0-9]{20}$' then
    raise exception 'QUORUM_TEST_FAILED: comment public IDs missing';
  end if;

  begin
    perform public.forum_quorum_command(user_b, 'create_comment', jsonb_build_object(
      'entryId', entry_a,
      'parentCommentId', reply_a,
      'body', 'A second-level reply must fail.'
    ));
    raise exception 'QUORUM_TEST_FAILED: second-level reply succeeded';
  exception when others then
    if sqlerrm not like '%FORUM_COMMENT_NOT_FOUND%' then raise; end if;
  end;

  perform public.forum_quorum_command(user_b, 'set_saved', jsonb_build_object(
    'entryId', entry_a, 'enabled', true
  ));
  if jsonb_array_length(
    public.forum_quorum_query(user_b, 'saved', '{}'::jsonb)->'items'
  ) <> 1 then
    raise exception 'QUORUM_TEST_FAILED: private save did not persist';
  end if;

  result := public.forum_quorum_command(user_b, 'create_repost', jsonb_build_object(
    'entryId', entry_a,
    'body', 'Useful authority for Labor Law review.'
  ));
  if result->>'citationId' !~ '^qr_[a-f0-9]{20}$' then
    raise exception 'QUORUM_TEST_FAILED: citation public ID missing';
  end if;

  result := public.forum_quorum_query(user_b, 'search', jsonb_build_object(
    'query', 'Article 294', 'limit', 10
  ));
  if jsonb_array_length(result->'entries'->'items') < 1 then
    raise exception 'QUORUM_TEST_FAILED: indexed entry search failed';
  end if;

  result := public.forum_quorum_command(user_a, 'create_circle', jsonb_build_object(
    'name', 'Labor Law Working Students',
    'description', 'A focused circle for working students preparing Labor Law doctrine.',
    'subject', 'Labor Law',
    'school', 'Synthetic Law School',
    'rules', 'Use official sources, protect privacy, and keep discussions academically focused.'
  ));
  circle_a := result->>'circleId';
  perform public.forum_quorum_command(user_b, 'join_circle', jsonb_build_object(
    'circleId', circle_a
  ));
  result := public.forum_quorum_command(user_b, 'create_entry', jsonb_build_object(
    'body', 'Circle entry applying the burden-of-proof doctrine to a dismissal problem.',
    'entryType', 'request_study_help',
    'subject', 'Labor Law',
    'category', 'law_school_life',
    'circleId', circle_a,
    'opinionOnly', false
  ));
  entry_b := result->>'entryId';

  begin
    perform public.forum_quorum_command(user_a, 'leave_circle', jsonb_build_object(
      'circleId', circle_a
    ));
    raise exception 'QUORUM_TEST_FAILED: active owner left circle';
  exception when others then
    if sqlerrm not like '%FORUM_CIRCLE_OWNER_MUST_ARCHIVE%' then raise; end if;
  end;

  result := public.forum_quorum_command(user_b, 'create_report', jsonb_build_object(
    'targetType', 'entry',
    'targetId', entry_a,
    'category', 'misinformation',
    'explanation', 'Synthetic moderation workflow test.'
  ));
  report_b := (
    select public_id from public.forum_reports
    where reporter_user_id = user_b and target_post_id = (
      select id from public.forum_posts where public_id = entry_a
    )
  );
  queue := public.forum_quorum_admin(moderator, 'queue', '{}'::jsonb);
  if queue::text like '%' || user_b::text || '%'
    or queue::text like '%quorum-b@example.invalid%'
    or not (queue->'reports' @> jsonb_build_array(jsonb_build_object('reportId', report_b)))
  then
    raise exception 'QUORUM_TEST_FAILED: moderation queue privacy or report lookup failed';
  end if;

  perform public.forum_quorum_admin(moderator, 'action', jsonb_build_object(
    'action', 'set_indicator',
    'targetId', entry_a,
    'indicator', 'citation_checked',
    'enabled', true,
    'reason', 'Official eLibrary source exists and corresponds to the cited authority.',
    'requestId', 'quorum_indicator_000001'
  ));
  if not (
    public.forum_quorum_query(user_a, 'entry', jsonb_build_object('entryId', entry_a))
      ->'entry'->'indicators' @> '["Citation Checked"]'::jsonb
  ) then
    raise exception 'QUORUM_TEST_FAILED: moderator indicator missing';
  end if;

  result := public.forum_quorum_command(user_a, 'create_entry', jsonb_build_object(
    'body', 'Synthetic school announcement requiring moderator approval.',
    'entryType', 'school_bar_announcement',
    'category', 'philippine_legal_education',
    'opinionOnly', false
  ));
  announcement := result->>'entryId';
  if result->>'publicationStatus' <> 'pending' then
    raise exception 'QUORUM_TEST_FAILED: announcement bypassed approval';
  end if;
  begin
    perform public.forum_quorum_query(user_b, 'entry', jsonb_build_object(
      'entryId', announcement
    ));
    raise exception 'QUORUM_TEST_FAILED: pending announcement leaked';
  exception when others then
    if sqlerrm not like '%FORUM_POST_NOT_FOUND%' then raise; end if;
  end;
  perform public.forum_quorum_admin(moderator, 'action', jsonb_build_object(
    'action', 'approve_announcement',
    'targetId', announcement,
    'reason', 'Synthetic announcement approved for staging verification.',
    'requestId', 'quorum_announcement_0001'
  ));
  perform public.forum_quorum_query(user_b, 'entry', jsonb_build_object(
    'entryId', announcement
  ));

  perform public.forum_quorum_command(user_a, 'set_block', jsonb_build_object(
    'memberId', member_b, 'enabled', true
  ));
  begin
    perform public.forum_quorum_query(user_b, 'entry', jsonb_build_object(
      'entryId', entry_a
    ));
    raise exception 'QUORUM_TEST_FAILED: blocked direct entry leaked';
  exception when others then
    if sqlerrm not like '%FORUM_POST_NOT_FOUND%' then raise; end if;
  end;
  perform public.forum_quorum_command(user_a, 'set_block', jsonb_build_object(
    'memberId', member_b, 'enabled', false
  ));

  perform public.forum_quorum_admin(moderator, 'action', jsonb_build_object(
    'action', 'restrict_user',
    'memberId', member_b,
    'durationHours', 24,
    'reason', 'Synthetic temporary restriction for staging security verification.',
    'requestId', 'quorum_restrict_0000001'
  ));
  restriction_b := (
    select public_id from public.forum_user_restrictions
    where user_id = user_b and revoked_at is null
  );
  begin
    perform public.forum_quorum_command(user_b, 'create_entry', jsonb_build_object(
      'body', 'Restricted publishing must fail.',
      'entryType', 'student_support',
      'category', 'student_support',
      'opinionOnly', true
    ));
    raise exception 'QUORUM_TEST_FAILED: restricted publishing succeeded';
  exception when others then
    if sqlerrm not like '%FORUM_POSTING_RESTRICTED%' then raise; end if;
  end;
  perform public.forum_quorum_admin(moderator, 'action', jsonb_build_object(
    'action', 'remove_restriction',
    'restrictionId', restriction_b,
    'reason', 'Synthetic restriction test completed.',
    'requestId', 'quorum_unrestrict_00001'
  ));

  result := public.forum_quorum_query(user_a, 'notifications', jsonb_build_object(
    'limit', 20
  ));
  if (result->>'unreadCount')::integer < 2 then
    raise exception 'QUORUM_TEST_FAILED: expected notifications missing';
  end if;
  perform public.forum_quorum_command(user_a, 'mark_all_notifications', '{}'::jsonb);
  if (
    public.forum_quorum_query(user_a, 'notifications', '{}'::jsonb)
      ->>'unreadCount'
  )::integer <> 0 then
    raise exception 'QUORUM_TEST_FAILED: mark-all notifications failed';
  end if;

  result := public.forum_quorum_admin(moderator, 'analytics', jsonb_build_object(
    'from', now() - interval '1 day',
    'to', now() + interval '1 minute'
  ));
  if (result->'metrics'->>'entries')::integer < 3
    or result->'definitions'->>'entries' is null
  then
    raise exception 'QUORUM_TEST_FAILED: truthful analytics missing';
  end if;

  if exists (
    select 1
    from public.forum_telemetry_events
    where user_id in (user_a, user_b, moderator)
      and (
        subject ilike '%@%'
        or entry_type ilike '%@%'
        or result_category ilike '%@%'
      )
  ) then
    raise exception 'QUORUM_TEST_FAILED: private analytics data stored';
  end if;
end
$quorum_behavior$;

rollback;

select 'Quorum behavioral security contract passed and synthetic records rolled back.' as result;

-- Lex Forum social beta
-- Additive, Worker-mediated social discussion for authenticated members.
-- No existing examination, grading, subscription, payment, or analytics object
-- is altered by this migration.

begin;

-- ---------------------------------------------------------------------------
-- Core records
-- ---------------------------------------------------------------------------

create table if not exists public.forum_posts (
  id uuid primary key default gen_random_uuid(),
  author_user_id uuid not null references auth.users(id) on delete restrict,
  body text not null,
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  moderation_status text not null default 'visible'
    check (moderation_status in ('visible', 'hidden', 'removed')),
  moderated_at timestamptz,
  moderated_by uuid references auth.users(id) on delete set null,
  moderation_reason text,
  constraint forum_posts_body_check
    check (char_length(btrim(body)) between 1 and 4000),
  constraint forum_posts_no_email_check
    check (body !~* '[^[:space:]@]+@[^[:space:]@]+\.[[:alpha:]]{2,}'),
  constraint forum_posts_source_url_check
    check (
      source_url is null
      or (
        char_length(source_url) <= 2000
        and source_url ~* '^https?://'
        and source_url !~* '^https?://[^/]*@'
      )
    ),
  constraint forum_posts_moderation_reason_check
    check (
      moderation_reason is null
      or char_length(btrim(moderation_reason)) between 5 and 1000
    )
);

create table if not exists public.forum_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.forum_posts(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  moderation_status text not null default 'visible'
    check (moderation_status in ('visible', 'hidden', 'removed')),
  moderated_at timestamptz,
  moderated_by uuid references auth.users(id) on delete set null,
  moderation_reason text,
  constraint forum_comments_body_check
    check (char_length(btrim(body)) between 1 and 2000),
  constraint forum_comments_no_email_check
    check (body !~* '[^[:space:]@]+@[^[:space:]@]+\.[[:alpha:]]{2,}'),
  constraint forum_comments_moderation_reason_check
    check (
      moderation_reason is null
      or char_length(btrim(moderation_reason)) between 5 and 1000
    )
);

create table if not exists public.forum_reactions (
  post_id uuid not null references public.forum_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.forum_reposts (
  id uuid primary key default gen_random_uuid(),
  original_post_id uuid not null references public.forum_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  commentary text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint forum_reposts_commentary_check
    check (
      commentary is null
      or char_length(btrim(commentary)) between 1 and 1000
    ),
  constraint forum_reposts_no_email_check
    check (
      commentary is null
      or commentary !~* '[^[:space:]@]+@[^[:space:]@]+\.[[:alpha:]]{2,}'
    )
);

create table if not exists public.forum_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment')),
  target_post_id uuid references public.forum_posts(id) on delete cascade,
  target_comment_id uuid references public.forum_comments(id) on delete cascade,
  category text not null check (
    category in (
      'harassment',
      'misinformation',
      'unsafe_link',
      'spam',
      'privacy',
      'other'
    )
  ),
  explanation text,
  status text not null default 'pending'
    check (status in ('pending', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_reason text,
  constraint forum_reports_exact_target_check check (
    (target_type = 'post' and target_post_id is not null and target_comment_id is null)
    or
    (target_type = 'comment' and target_post_id is null and target_comment_id is not null)
  ),
  constraint forum_reports_explanation_check check (
    explanation is null or char_length(btrim(explanation)) between 1 and 1000
  ),
  constraint forum_reports_review_reason_check check (
    review_reason is null or char_length(btrim(review_reason)) between 5 and 1000
  )
);

create table if not exists public.forum_user_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  restricted_until timestamptz not null,
  reason text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoke_reason text,
  constraint forum_user_restrictions_reason_check
    check (char_length(btrim(reason)) between 5 and 1000),
  constraint forum_user_restrictions_future_check
    check (restricted_until > created_at),
  constraint forum_user_restrictions_revoke_reason_check
    check (
      revoke_reason is null
      or char_length(btrim(revoke_reason)) between 5 and 1000
    )
);

-- Privacy-safe persistence for transactionally enforced beta rate limits.
-- No IP address, user agent, email address, post body, or examination answer
-- is stored here.
create table if not exists public.forum_action_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action_type text not null check (
    action_type in (
      'post_create',
      'post_edit',
      'comment_create',
      'comment_edit',
      'reaction_toggle',
      'repost_create',
      'report_create'
    )
  ),
  created_at timestamptz not null default now()
);

-- Repeatability guard for staging environments that received an earlier beta
-- draft before the privacy constraints were introduced.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.forum_posts'::regclass
      and conname = 'forum_posts_no_email_check'
  ) then
    alter table public.forum_posts
      add constraint forum_posts_no_email_check
      check (body !~* '[^[:space:]@]+@[^[:space:]@]+\.[[:alpha:]]{2,}');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.forum_comments'::regclass
      and conname = 'forum_comments_no_email_check'
  ) then
    alter table public.forum_comments
      add constraint forum_comments_no_email_check
      check (body !~* '[^[:space:]@]+@[^[:space:]@]+\.[[:alpha:]]{2,}');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.forum_reposts'::regclass
      and conname = 'forum_reposts_no_email_check'
  ) then
    alter table public.forum_reposts
      add constraint forum_reposts_no_email_check
      check (
        commentary is null
        or commentary !~* '[^[:space:]@]+@[^[:space:]@]+\.[[:alpha:]]{2,}'
      );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Indexes and uniqueness
-- ---------------------------------------------------------------------------

create index if not exists forum_posts_feed_idx
  on public.forum_posts (created_at desc, id desc)
  where deleted_at is null and moderation_status = 'visible';
create index if not exists forum_posts_author_idx
  on public.forum_posts (author_user_id, created_at desc);
create index if not exists forum_comments_post_idx
  on public.forum_comments (post_id, created_at asc, id asc)
  where deleted_at is null and moderation_status = 'visible';
create index if not exists forum_comments_author_idx
  on public.forum_comments (author_user_id, created_at desc);
create index if not exists forum_reactions_post_idx
  on public.forum_reactions (post_id, created_at desc);
create index if not exists forum_reactions_user_idx
  on public.forum_reactions (user_id, created_at desc);
create index if not exists forum_reposts_feed_idx
  on public.forum_reposts (created_at desc, id desc)
  where deleted_at is null;
create index if not exists forum_reposts_original_idx
  on public.forum_reposts (original_post_id, created_at desc)
  where deleted_at is null;
create unique index if not exists forum_reposts_active_user_post_uidx
  on public.forum_reposts (user_id, original_post_id)
  where deleted_at is null;
create index if not exists forum_reports_queue_idx
  on public.forum_reports (status, created_at asc, id asc);
create unique index if not exists forum_reports_unique_post_uidx
  on public.forum_reports (reporter_user_id, target_post_id)
  where target_type = 'post';
create unique index if not exists forum_reports_unique_comment_uidx
  on public.forum_reports (reporter_user_id, target_comment_id)
  where target_type = 'comment';
create index if not exists forum_restrictions_user_idx
  on public.forum_user_restrictions (user_id, restricted_until desc);
create unique index if not exists forum_restrictions_active_user_uidx
  on public.forum_user_restrictions (user_id)
  where revoked_at is null;
create index if not exists forum_action_events_rate_idx
  on public.forum_action_events (user_id, action_type, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------

alter table public.forum_posts enable row level security;
alter table public.forum_comments enable row level security;
alter table public.forum_reactions enable row level security;
alter table public.forum_reposts enable row level security;
alter table public.forum_reports enable row level security;
alter table public.forum_user_restrictions enable row level security;
alter table public.forum_action_events enable row level security;

revoke all on public.forum_posts from public, anon, authenticated;
revoke all on public.forum_comments from public, anon, authenticated;
revoke all on public.forum_reactions from public, anon, authenticated;
revoke all on public.forum_reposts from public, anon, authenticated;
revoke all on public.forum_reports from public, anon, authenticated;
revoke all on public.forum_user_restrictions from public, anon, authenticated;
revoke all on public.forum_action_events from public, anon, authenticated;

grant select, insert, update, delete on public.forum_posts to service_role;
grant select, insert, update, delete on public.forum_comments to service_role;
grant select, insert, update, delete on public.forum_reactions to service_role;
grant select, insert, update, delete on public.forum_reposts to service_role;
grant select, insert, update, delete on public.forum_reports to service_role;
grant select, insert, update, delete on public.forum_user_restrictions to service_role;
grant select, insert, delete on public.forum_action_events to service_role;
grant usage, select on sequence public.forum_action_events_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- Trusted helpers
-- ---------------------------------------------------------------------------

create or replace function public.forum_assert_member(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null
     or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'FORUM_AUTHENTICATION_REQUIRED';
  end if;
end;
$$;

create or replace function public.forum_assert_can_publish(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_until timestamptz;
begin
  perform public.forum_assert_member(p_user_id);
  select restricted_until
  into v_until
  from public.forum_user_restrictions
  where user_id = p_user_id
    and revoked_at is null
    and restricted_until > now()
  order by restricted_until desc
  limit 1;

  if v_until is not null then
    raise exception 'FORUM_POSTING_RESTRICTED:%', v_until;
  end if;
end;
$$;

create or replace function public.forum_enforce_action_limit(
  p_user_id uuid,
  p_action_type text,
  p_maximum integer,
  p_window interval
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  perform public.forum_assert_member(p_user_id);
  if p_action_type not in (
    'post_create',
    'post_edit',
    'comment_create',
    'comment_edit',
    'reaction_toggle',
    'repost_create',
    'report_create'
  ) or p_maximum < 1 or p_window <= interval '0 seconds' then
    raise exception 'FORUM_RATE_LIMIT_CONFIGURATION_INVALID';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_action_type, 0)
  );
  select count(*)::integer
  into v_count
  from public.forum_action_events
  where user_id = p_user_id
    and action_type = p_action_type
    and created_at >= now() - p_window;

  if v_count >= p_maximum then
    raise exception 'FORUM_RATE_LIMITED';
  end if;

  insert into public.forum_action_events (user_id, action_type)
  values (p_user_id, p_action_type);
end;
$$;

-- ---------------------------------------------------------------------------
-- Authenticated feed and comments
-- ---------------------------------------------------------------------------

create or replace function public.forum_feed(
  p_user_id uuid,
  p_limit integer default 10,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null,
  p_post_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(20, greatest(1, coalesce(p_limit, 10)));
  v_items jsonb;
  v_has_more boolean;
  v_next jsonb;
begin
  perform public.forum_assert_member(p_user_id);

  with candidates as (
    select
      'post'::text as item_kind,
      p.id as item_id,
      p.created_at as sort_at,
      p.id as post_id,
      null::uuid as repost_id,
      null::uuid as reposter_user_id,
      null::text as repost_commentary
    from public.forum_posts p
    where p.deleted_at is null
      and p.moderation_status = 'visible'
      and (p_post_id is null or p.id = p_post_id)

    union all

    select
      'repost'::text,
      r.id,
      r.created_at,
      p.id,
      r.id,
      r.user_id,
      r.commentary
    from public.forum_reposts r
    join public.forum_posts p on p.id = r.original_post_id
    where r.deleted_at is null
      and p.deleted_at is null
      and p.moderation_status = 'visible'
      and p_post_id is null
  ),
  filtered as (
    select *
    from candidates
    where p_post_id is not null
       or p_cursor_at is null
       or sort_at < p_cursor_at
       or (sort_at = p_cursor_at and (p_cursor_id is null or item_id < p_cursor_id))
    order by sort_at desc, item_id desc
    limit v_limit + 1
  ),
  visible as (
    select *
    from filtered
    order by sort_at desc, item_id desc
    limit v_limit
  ),
  rendered as (
    select
      v.sort_at,
      v.item_id,
      jsonb_build_object(
        'kind', v.item_kind,
        'id', v.item_id,
        'postId', p.id,
        'body', p.body,
        'sourceUrl', p.source_url,
        'createdAt', p.created_at,
        'updatedAt', p.updated_at,
        'edited', p.edited_at is not null,
        'viewerOwns', p.author_user_id = p_user_id,
        'author', jsonb_build_object(
          'displayName', case
            when nullif(btrim(pr.display_name), '') is null
              or position('@' in pr.display_name) > 0 then 'Due Diligence Member'
            else btrim(pr.display_name)
          end,
          'school', case
            when position('@' in coalesce(pr.school, '')) > 0 then null
            else nullif(btrim(pr.school), '')
          end
        ),
        'counts', jsonb_build_object(
          'likes', (
            select count(*) from public.forum_reactions fr where fr.post_id = p.id
          ),
          'comments', (
            select count(*) from public.forum_comments fc
            where fc.post_id = p.id
              and fc.deleted_at is null
              and fc.moderation_status = 'visible'
          ),
          'shares', (
            select count(*) from public.forum_reposts fs
            where fs.original_post_id = p.id and fs.deleted_at is null
          )
        ),
        'viewerLiked', exists (
          select 1 from public.forum_reactions fr
          where fr.post_id = p.id and fr.user_id = p_user_id
        ),
        'repost', case
          when v.item_kind = 'repost' then jsonb_build_object(
            'id', v.repost_id,
            'commentary', v.repost_commentary,
            'createdAt', v.sort_at,
            'viewerOwns', v.reposter_user_id = p_user_id,
            'author', jsonb_build_object(
              'displayName', case
                when nullif(btrim(rr.display_name), '') is null
                  or position('@' in rr.display_name) > 0 then 'Due Diligence Member'
                else btrim(rr.display_name)
              end,
              'school', case
                when position('@' in coalesce(rr.school, '')) > 0 then null
                else nullif(btrim(rr.school), '')
              end
            )
          )
          else null
        end
      ) as payload
    from visible v
    join public.forum_posts p on p.id = v.post_id
    left join public.profiles pr on pr.id = p.author_user_id
    left join public.profiles rr on rr.id = v.reposter_user_id
  )
  select
    coalesce(jsonb_agg(payload order by sort_at desc, item_id desc), '[]'::jsonb),
    (select count(*) > v_limit from filtered),
    case
      when (select count(*) > v_limit from filtered) then (
        select jsonb_build_object('createdAt', sort_at, 'id', item_id)
        from visible
        order by sort_at asc, item_id asc
        limit 1
      )
      else null
    end
  into v_items, v_has_more, v_next
  from rendered;

  return jsonb_build_object(
    'items', v_items,
    'hasMore', coalesce(v_has_more, false),
    'nextCursor', v_next
  );
end;
$$;

create or replace function public.forum_comments_for_post(
  p_user_id uuid,
  p_post_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.forum_assert_member(p_user_id);
  if not exists (
    select 1 from public.forum_posts
    where id = p_post_id
      and deleted_at is null
      and moderation_status = 'visible'
  ) then
    raise exception 'FORUM_POST_NOT_FOUND';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'postId', c.post_id,
        'body', c.body,
        'createdAt', c.created_at,
        'updatedAt', c.updated_at,
        'edited', c.edited_at is not null,
        'viewerOwns', c.author_user_id = p_user_id,
        'author', jsonb_build_object(
          'displayName', case
            when nullif(btrim(pr.display_name), '') is null
              or position('@' in pr.display_name) > 0 then 'Due Diligence Member'
            else btrim(pr.display_name)
          end,
          'school', case
            when position('@' in coalesce(pr.school, '')) > 0 then null
            else nullif(btrim(pr.school), '')
          end
        )
      )
      order by c.created_at asc, c.id asc
    )
    from (
      select *
      from public.forum_comments
      where post_id = p_post_id
        and deleted_at is null
        and moderation_status = 'visible'
      order by created_at asc, id asc
      limit least(200, greatest(1, coalesce(p_limit, 100)))
    ) c
    left join public.profiles pr on pr.id = c.author_user_id
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Member mutations
-- ---------------------------------------------------------------------------

create or replace function public.forum_create_post(
  p_user_id uuid,
  p_body text,
  p_source_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_source text := nullif(btrim(coalesce(p_source_url, '')), '');
  v_post public.forum_posts;
begin
  perform public.forum_assert_can_publish(p_user_id);
  if char_length(v_body) not between 1 and 4000 then
    raise exception 'FORUM_POST_INVALID';
  end if;
  if v_body ~* '[^[:space:]@]+@[^[:space:]@]+\.[[:alpha:]]{2,}' then
    raise exception 'FORUM_PRIVATE_CONTACT';
  end if;
  if v_source is not null and (
    char_length(v_source) > 2000
    or v_source !~* '^https?://'
    or v_source ~* '^https?://[^/]*@'
  ) then
    raise exception 'FORUM_SOURCE_URL_INVALID';
  end if;
  perform public.forum_enforce_action_limit(
    p_user_id, 'post_create', 5, interval '10 minutes'
  );
  if exists (
    select 1 from public.forum_posts
    where author_user_id = p_user_id
      and lower(btrim(body)) = lower(v_body)
      and created_at >= now() - interval '2 minutes'
      and deleted_at is null
  ) then
    raise exception 'FORUM_DUPLICATE_POST';
  end if;
  insert into public.forum_posts (author_user_id, body, source_url)
  values (p_user_id, v_body, v_source)
  returning * into v_post;
  return jsonb_build_object('id', v_post.id, 'createdAt', v_post.created_at);
end;
$$;

create or replace function public.forum_update_post(
  p_user_id uuid,
  p_post_id uuid,
  p_body text,
  p_source_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_source text := nullif(btrim(coalesce(p_source_url, '')), '');
  v_author uuid;
begin
  perform public.forum_assert_can_publish(p_user_id);
  if char_length(v_body) not between 1 and 4000 then
    raise exception 'FORUM_POST_INVALID';
  end if;
  if v_body ~* '[^[:space:]@]+@[^[:space:]@]+\.[[:alpha:]]{2,}' then
    raise exception 'FORUM_PRIVATE_CONTACT';
  end if;
  if v_source is not null and (
    char_length(v_source) > 2000
    or v_source !~* '^https?://'
    or v_source ~* '^https?://[^/]*@'
  ) then
    raise exception 'FORUM_SOURCE_URL_INVALID';
  end if;
  select author_user_id into v_author
  from public.forum_posts where id = p_post_id for update;
  if v_author is null then raise exception 'FORUM_POST_NOT_FOUND'; end if;
  if v_author <> p_user_id then raise exception 'FORUM_OWNERSHIP_REQUIRED'; end if;
  perform public.forum_enforce_action_limit(
    p_user_id, 'post_edit', 20, interval '10 minutes'
  );
  update public.forum_posts
  set body = v_body,
      source_url = v_source,
      updated_at = now(),
      edited_at = case
        when body is distinct from v_body or source_url is distinct from v_source
          then now()
        else edited_at
      end
  where id = p_post_id
    and deleted_at is null
    and moderation_status = 'visible';
  if not found then raise exception 'FORUM_POST_NOT_EDITABLE'; end if;
  return jsonb_build_object('id', p_post_id, 'edited', true);
end;
$$;

create or replace function public.forum_delete_post(
  p_user_id uuid,
  p_post_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_author uuid;
begin
  perform public.forum_assert_member(p_user_id);
  select author_user_id into v_author
  from public.forum_posts where id = p_post_id for update;
  if v_author is null then raise exception 'FORUM_POST_NOT_FOUND'; end if;
  if v_author <> p_user_id then raise exception 'FORUM_OWNERSHIP_REQUIRED'; end if;
  update public.forum_posts
  set deleted_at = coalesce(deleted_at, now()), updated_at = now()
  where id = p_post_id;
  return jsonb_build_object('id', p_post_id, 'deleted', true);
end;
$$;

create or replace function public.forum_set_reaction(
  p_user_id uuid,
  p_post_id uuid,
  p_liked boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_liked boolean;
  v_count bigint;
begin
  perform public.forum_assert_member(p_user_id);
  if not exists (
    select 1 from public.forum_posts
    where id = p_post_id
      and deleted_at is null
      and moderation_status = 'visible'
  ) then
    raise exception 'FORUM_POST_NOT_FOUND';
  end if;
  perform public.forum_enforce_action_limit(
    p_user_id, 'reaction_toggle', 60, interval '10 minutes'
  );
  perform pg_advisory_xact_lock(hashtextextended(p_post_id::text || ':' || p_user_id::text, 0));
  if p_liked then
    insert into public.forum_reactions (post_id, user_id)
    values (p_post_id, p_user_id)
    on conflict (post_id, user_id) do nothing;
    v_liked := true;
  else
    delete from public.forum_reactions
    where post_id = p_post_id and user_id = p_user_id;
    v_liked := false;
  end if;
  select count(*) into v_count
  from public.forum_reactions where post_id = p_post_id;
  return jsonb_build_object('liked', v_liked, 'count', v_count);
end;
$$;

create or replace function public.forum_create_comment(
  p_user_id uuid,
  p_post_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_comment public.forum_comments;
begin
  perform public.forum_assert_can_publish(p_user_id);
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'FORUM_COMMENT_INVALID';
  end if;
  if v_body ~* '[^[:space:]@]+@[^[:space:]@]+\.[[:alpha:]]{2,}' then
    raise exception 'FORUM_PRIVATE_CONTACT';
  end if;
  if not exists (
    select 1 from public.forum_posts
    where id = p_post_id
      and deleted_at is null
      and moderation_status = 'visible'
  ) then
    raise exception 'FORUM_POST_NOT_FOUND';
  end if;
  perform public.forum_enforce_action_limit(
    p_user_id, 'comment_create', 20, interval '10 minutes'
  );
  if exists (
    select 1 from public.forum_comments
    where post_id = p_post_id
      and author_user_id = p_user_id
      and lower(btrim(body)) = lower(v_body)
      and created_at >= now() - interval '1 minute'
      and deleted_at is null
  ) then
    raise exception 'FORUM_DUPLICATE_COMMENT';
  end if;
  insert into public.forum_comments (post_id, author_user_id, body)
  values (p_post_id, p_user_id, v_body)
  returning * into v_comment;
  return jsonb_build_object('id', v_comment.id, 'createdAt', v_comment.created_at);
end;
$$;

create or replace function public.forum_update_comment(
  p_user_id uuid,
  p_comment_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_author uuid;
begin
  perform public.forum_assert_can_publish(p_user_id);
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'FORUM_COMMENT_INVALID';
  end if;
  if v_body ~* '[^[:space:]@]+@[^[:space:]@]+\.[[:alpha:]]{2,}' then
    raise exception 'FORUM_PRIVATE_CONTACT';
  end if;
  select author_user_id into v_author
  from public.forum_comments where id = p_comment_id for update;
  if v_author is null then raise exception 'FORUM_COMMENT_NOT_FOUND'; end if;
  if v_author <> p_user_id then raise exception 'FORUM_OWNERSHIP_REQUIRED'; end if;
  perform public.forum_enforce_action_limit(
    p_user_id, 'comment_edit', 30, interval '10 minutes'
  );
  update public.forum_comments
  set body = v_body,
      updated_at = now(),
      edited_at = case when body is distinct from v_body then now() else edited_at end
  where id = p_comment_id
    and deleted_at is null
    and moderation_status = 'visible';
  if not found then raise exception 'FORUM_COMMENT_NOT_EDITABLE'; end if;
  return jsonb_build_object('id', p_comment_id, 'edited', true);
end;
$$;

create or replace function public.forum_delete_comment(
  p_user_id uuid,
  p_comment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_author uuid;
begin
  perform public.forum_assert_member(p_user_id);
  select author_user_id into v_author
  from public.forum_comments where id = p_comment_id for update;
  if v_author is null then raise exception 'FORUM_COMMENT_NOT_FOUND'; end if;
  if v_author <> p_user_id then raise exception 'FORUM_OWNERSHIP_REQUIRED'; end if;
  update public.forum_comments
  set deleted_at = coalesce(deleted_at, now()), updated_at = now()
  where id = p_comment_id;
  return jsonb_build_object('id', p_comment_id, 'deleted', true);
end;
$$;

create or replace function public.forum_create_repost(
  p_user_id uuid,
  p_post_id uuid,
  p_commentary text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_commentary text := nullif(btrim(coalesce(p_commentary, '')), '');
  v_repost public.forum_reposts;
begin
  perform public.forum_assert_can_publish(p_user_id);
  if v_commentary is not null and char_length(v_commentary) > 1000 then
    raise exception 'FORUM_REPOST_INVALID';
  end if;
  if v_commentary ~* '[^[:space:]@]+@[^[:space:]@]+\.[[:alpha:]]{2,}' then
    raise exception 'FORUM_PRIVATE_CONTACT';
  end if;
  if not exists (
    select 1 from public.forum_posts
    where id = p_post_id
      and deleted_at is null
      and moderation_status = 'visible'
  ) then
    raise exception 'FORUM_POST_NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('forum-repost:' || p_user_id::text || ':' || p_post_id::text, 0)
  );
  select * into v_repost
  from public.forum_reposts
  where user_id = p_user_id
    and original_post_id = p_post_id
    and deleted_at is null
  limit 1;
  if v_repost.id is not null then
    return jsonb_build_object('id', v_repost.id, 'replayed', true);
  end if;
  perform public.forum_enforce_action_limit(
    p_user_id, 'repost_create', 10, interval '10 minutes'
  );
  insert into public.forum_reposts (original_post_id, user_id, commentary)
  values (p_post_id, p_user_id, v_commentary)
  returning * into v_repost;
  return jsonb_build_object('id', v_repost.id, 'replayed', false);
end;
$$;

create or replace function public.forum_delete_repost(
  p_user_id uuid,
  p_repost_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_author uuid;
begin
  perform public.forum_assert_member(p_user_id);
  select user_id into v_author
  from public.forum_reposts where id = p_repost_id for update;
  if v_author is null then raise exception 'FORUM_REPOST_NOT_FOUND'; end if;
  if v_author <> p_user_id then raise exception 'FORUM_OWNERSHIP_REQUIRED'; end if;
  update public.forum_reposts
  set deleted_at = coalesce(deleted_at, now())
  where id = p_repost_id;
  return jsonb_build_object('id', p_repost_id, 'deleted', true);
end;
$$;

create or replace function public.forum_create_report(
  p_user_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_category text,
  p_explanation text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text := lower(btrim(coalesce(p_target_type, '')));
  v_category text := lower(btrim(coalesce(p_category, '')));
  v_explanation text := nullif(btrim(coalesce(p_explanation, '')), '');
  v_report public.forum_reports;
begin
  perform public.forum_assert_member(p_user_id);
  if v_type not in ('post', 'comment')
     or v_category not in ('harassment','misinformation','unsafe_link','spam','privacy','other')
     or (v_explanation is not null and char_length(v_explanation) > 1000) then
    raise exception 'FORUM_REPORT_INVALID';
  end if;

  if v_type = 'post' then
    if not exists (
      select 1 from public.forum_posts
      where id = p_target_id and deleted_at is null and moderation_status = 'visible'
    ) then raise exception 'FORUM_POST_NOT_FOUND'; end if;
  else
    if not exists (
      select 1
      from public.forum_comments c
      join public.forum_posts p on p.id = c.post_id
      where c.id = p_target_id
        and c.deleted_at is null
        and c.moderation_status = 'visible'
        and p.deleted_at is null
        and p.moderation_status = 'visible'
    ) then raise exception 'FORUM_COMMENT_NOT_FOUND'; end if;
  end if;

  perform public.forum_enforce_action_limit(
    p_user_id, 'report_create', 10, interval '1 hour'
  );
  if v_type = 'post' then
    if exists (
      select 1 from public.forum_reports
      where reporter_user_id = p_user_id
        and target_type = 'post'
        and target_post_id = p_target_id
    ) then raise exception 'FORUM_DUPLICATE_REPORT'; end if;
  else
    if exists (
      select 1 from public.forum_reports
      where reporter_user_id = p_user_id
        and target_type = 'comment'
        and target_comment_id = p_target_id
    ) then raise exception 'FORUM_DUPLICATE_REPORT'; end if;
  end if;

  insert into public.forum_reports (
    reporter_user_id,
    target_type,
    target_post_id,
    target_comment_id,
    category,
    explanation
  )
  values (
    p_user_id,
    v_type,
    case when v_type = 'post' then p_target_id end,
    case when v_type = 'comment' then p_target_id end,
    v_category,
    v_explanation
  )
  returning * into v_report;
  return jsonb_build_object('id', v_report.id, 'status', v_report.status);
end;
$$;

-- ---------------------------------------------------------------------------
-- Founder/Super Admin moderation
-- ---------------------------------------------------------------------------

create or replace function public.forum_admin_queue(
  p_actor_user_id uuid,
  p_status text default 'pending',
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := lower(btrim(coalesce(p_status, 'pending')));
  v_limit integer := least(200, greatest(1, coalesce(p_limit, 100)));
  v_offset integer := least(10000, greatest(0, coalesce(p_offset, 0)));
  v_reports jsonb;
  v_restrictions jsonb;
begin
  perform public.phase4_require_founder(p_actor_user_id);
  if v_status not in ('pending', 'actioned', 'dismissed', 'all') then
    raise exception 'FORUM_ADMIN_STATUS_INVALID';
  end if;

  select coalesce(jsonb_agg(payload order by created_at asc, id asc), '[]'::jsonb)
  into v_reports
  from (
    select
      r.id,
      r.created_at,
      jsonb_build_object(
        'id', r.id,
        'targetType', r.target_type,
        'targetId', coalesce(r.target_post_id, r.target_comment_id),
        'category', r.category,
        'explanation', r.explanation,
        'status', r.status,
        'createdAt', r.created_at,
        'content', case
          when r.target_type = 'post' then p.body
          else c.body
        end,
        'contentStatus', case
          when r.target_type = 'post' then p.moderation_status
          else c.moderation_status
        end,
        'contentCreatedAt', case
          when r.target_type = 'post' then p.created_at
          else c.created_at
        end,
        'author', jsonb_build_object(
          'displayName', case
            when nullif(btrim(pr.display_name), '') is null
              or position('@' in pr.display_name) > 0 then 'Due Diligence Member'
            else btrim(pr.display_name)
          end,
          'school', case
            when position('@' in coalesce(pr.school, '')) > 0 then null
            else nullif(btrim(pr.school), '')
          end
        ),
        'activeRestrictionId', ur.id,
        'restrictedUntil', ur.restricted_until
      ) as payload
    from public.forum_reports r
    left join public.forum_posts p on p.id = r.target_post_id
    left join public.forum_comments c on c.id = r.target_comment_id
    left join public.profiles pr on pr.id = coalesce(p.author_user_id, c.author_user_id)
    left join public.forum_user_restrictions ur
      on ur.user_id = coalesce(p.author_user_id, c.author_user_id)
      and ur.revoked_at is null
      and ur.restricted_until > now()
    where v_status = 'all' or r.status = v_status
    order by r.created_at asc, r.id asc
    limit v_limit offset v_offset
  ) queue;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', ur.id,
      'displayName', case
        when nullif(btrim(pr.display_name), '') is null
          or position('@' in pr.display_name) > 0 then 'Due Diligence Member'
        else btrim(pr.display_name)
      end,
      'school', case
        when position('@' in coalesce(pr.school, '')) > 0 then null
        else nullif(btrim(pr.school), '')
      end,
      'restrictedUntil', ur.restricted_until,
      'reason', ur.reason,
      'createdAt', ur.created_at
    )
    order by ur.restricted_until asc
  ), '[]'::jsonb)
  into v_restrictions
  from public.forum_user_restrictions ur
  left join public.profiles pr on pr.id = ur.user_id
  where ur.revoked_at is null and ur.restricted_until > now();

  return jsonb_build_object(
    'reports', v_reports,
    'restrictions', v_restrictions
  );
end;
$$;

create or replace function public.forum_admin_action(
  p_actor_user_id uuid,
  p_action text,
  p_target_id uuid,
  p_reason text,
  p_duration_hours integer default null,
  p_request_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_report public.forum_reports;
  v_target_user uuid;
  v_target_resource_id uuid;
  v_restriction public.forum_user_restrictions;
  v_request_key text := nullif(btrim(coalesce(p_request_key, '')), '');
  v_existing_details jsonb;
begin
  perform public.phase4_require_founder(p_actor_user_id);
  if v_action not in (
    'hide_content',
    'restore_content',
    'remove_content',
    'dismiss_report',
    'restrict_user',
    'remove_restriction'
  ) or char_length(v_reason) not between 5 and 1000 then
    raise exception 'FORUM_ADMIN_ACTION_INVALID';
  end if;
  if v_request_key is null or v_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'FORUM_ADMIN_REQUEST_KEY_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('forum-admin:' || v_request_key, 0));
  select details into v_existing_details
  from public.admin_audit_log
    where actor_user_id = p_actor_user_id
      and action_type = 'content_management_action'
      and details ->> 'requestKey' = v_request_key
  order by occurred_at desc
  limit 1;
  if v_existing_details is not null then
    if v_existing_details ->> 'forumAction' is distinct from v_action
       or v_existing_details ->> 'requestTargetId' is distinct from p_target_id::text then
      raise exception 'FORUM_ADMIN_REQUEST_KEY_CONFLICT';
    end if;
    return jsonb_build_object('replayed', true);
  end if;

  if v_action = 'remove_restriction' then
    select * into v_restriction
    from public.forum_user_restrictions
    where id = p_target_id
    for update;
    if v_restriction.id is null then
      raise exception 'FORUM_RESTRICTION_NOT_FOUND';
    end if;
    update public.forum_user_restrictions
    set revoked_at = now(),
        revoked_by = p_actor_user_id,
        revoke_reason = v_reason
    where id = v_restriction.id and revoked_at is null;
    v_target_user := v_restriction.user_id;
    v_target_resource_id := v_restriction.id;
  else
    select * into v_report
    from public.forum_reports
    where id = p_target_id
    for update;
    if v_report.id is null then raise exception 'FORUM_REPORT_NOT_FOUND'; end if;

    if v_report.target_type = 'post' then
      select author_user_id into v_target_user
      from public.forum_posts where id = v_report.target_post_id;
      v_target_resource_id := v_report.target_post_id;
    else
      select author_user_id into v_target_user
      from public.forum_comments where id = v_report.target_comment_id;
      v_target_resource_id := v_report.target_comment_id;
    end if;
    if v_target_user is null then raise exception 'FORUM_TARGET_NOT_FOUND'; end if;

    if v_action = 'dismiss_report' then
      update public.forum_reports
      set status = 'dismissed',
          reviewed_at = now(),
          reviewed_by = p_actor_user_id,
          review_reason = v_reason
      where id = v_report.id;
    elsif v_action in ('hide_content', 'restore_content', 'remove_content') then
      if v_report.target_type = 'post' then
        update public.forum_posts
        set moderation_status = case v_action
              when 'hide_content' then 'hidden'
              when 'restore_content' then 'visible'
              else 'removed'
            end,
            moderated_at = now(),
            moderated_by = p_actor_user_id,
            moderation_reason = v_reason,
            updated_at = now()
        where id = v_report.target_post_id;
      else
        update public.forum_comments
        set moderation_status = case v_action
              when 'hide_content' then 'hidden'
              when 'restore_content' then 'visible'
              else 'removed'
            end,
            moderated_at = now(),
            moderated_by = p_actor_user_id,
            moderation_reason = v_reason,
            updated_at = now()
        where id = v_report.target_comment_id;
      end if;
      update public.forum_reports
      set status = 'actioned',
          reviewed_at = now(),
          reviewed_by = p_actor_user_id,
          review_reason = v_reason
      where id = v_report.id;
    elsif v_action = 'restrict_user' then
      if p_duration_hours is null or p_duration_hours not between 1 and 8760 then
        raise exception 'FORUM_RESTRICTION_DURATION_INVALID';
      end if;
      update public.forum_user_restrictions
      set revoked_at = now(),
          revoked_by = p_actor_user_id,
          revoke_reason = 'Superseded by a new moderation restriction.'
      where user_id = v_target_user and revoked_at is null;
      insert into public.forum_user_restrictions (
        user_id, restricted_until, reason, created_by
      )
      values (
        v_target_user,
        now() + make_interval(hours => p_duration_hours),
        v_reason,
        p_actor_user_id
      )
      returning * into v_restriction;
      v_target_resource_id := v_restriction.id;
      update public.forum_reports
      set status = 'actioned',
          reviewed_at = now(),
          reviewed_by = p_actor_user_id,
          review_reason = v_reason
      where id = v_report.id;
    end if;
  end if;

  insert into public.admin_audit_log (
    actor_user_id,
    action_type,
    target_user_id,
    target_resource_type,
    target_resource_id,
    reason,
    details
  )
  values (
    p_actor_user_id,
    'content_management_action',
    v_target_user,
    case
      when v_action = 'remove_restriction' or v_action = 'restrict_user'
        then 'forum_user_restriction'
      when v_report.target_type = 'comment' then 'forum_comment'
      else 'forum_post'
    end,
    v_target_resource_id::text,
    v_reason,
    jsonb_build_object(
      'forumAction', v_action,
      'requestTargetId', p_target_id,
      'reportId', v_report.id,
      'durationHours', p_duration_hours,
      'requestKey', v_request_key
    )
  );

  return jsonb_build_object(
    'replayed', false,
    'action', v_action,
    'targetId', v_target_resource_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function execution is Worker-only. The Worker verifies the Supabase bearer
-- token and supplies the immutable auth user ID to these functions.
-- ---------------------------------------------------------------------------

revoke all on function public.forum_assert_member(uuid) from public, anon, authenticated;
revoke all on function public.forum_assert_can_publish(uuid) from public, anon, authenticated;
revoke all on function public.forum_enforce_action_limit(uuid, text, integer, interval) from public, anon, authenticated;
revoke all on function public.forum_feed(uuid, integer, timestamptz, uuid, uuid) from public, anon, authenticated;
revoke all on function public.forum_comments_for_post(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.forum_create_post(uuid, text, text) from public, anon, authenticated;
revoke all on function public.forum_update_post(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.forum_delete_post(uuid, uuid) from public, anon, authenticated;
revoke all on function public.forum_set_reaction(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.forum_create_comment(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.forum_update_comment(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.forum_delete_comment(uuid, uuid) from public, anon, authenticated;
revoke all on function public.forum_create_repost(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.forum_delete_repost(uuid, uuid) from public, anon, authenticated;
revoke all on function public.forum_create_report(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.forum_admin_queue(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.forum_admin_action(uuid, text, uuid, text, integer, text) from public, anon, authenticated;

grant execute on function public.forum_assert_member(uuid) to service_role;
grant execute on function public.forum_assert_can_publish(uuid) to service_role;
grant execute on function public.forum_enforce_action_limit(uuid, text, integer, interval) to service_role;
grant execute on function public.forum_feed(uuid, integer, timestamptz, uuid, uuid) to service_role;
grant execute on function public.forum_comments_for_post(uuid, uuid, integer) to service_role;
grant execute on function public.forum_create_post(uuid, text, text) to service_role;
grant execute on function public.forum_update_post(uuid, uuid, text, text) to service_role;
grant execute on function public.forum_delete_post(uuid, uuid) to service_role;
grant execute on function public.forum_set_reaction(uuid, uuid, boolean) to service_role;
grant execute on function public.forum_create_comment(uuid, uuid, text) to service_role;
grant execute on function public.forum_update_comment(uuid, uuid, text) to service_role;
grant execute on function public.forum_delete_comment(uuid, uuid) to service_role;
grant execute on function public.forum_create_repost(uuid, uuid, text) to service_role;
grant execute on function public.forum_delete_repost(uuid, uuid) to service_role;
grant execute on function public.forum_create_report(uuid, text, uuid, text, text) to service_role;
grant execute on function public.forum_admin_queue(uuid, text, integer, integer) to service_role;
grant execute on function public.forum_admin_action(uuid, text, uuid, text, integer, text) to service_role;

comment on table public.forum_posts is
  'Authenticated Lex Forum plain-text posts. Hidden, removed, and deleted rows never enter member feed RPCs.';
comment on table public.forum_action_events is
  'Privacy-safe Lex Forum rate-limit events; never stores IP, email, user-agent, content, or examination answers.';

commit;

-- Quorum complete academic community
-- Additive extension of the production Lex Forum beta. Existing forum records,
-- examination data, grading, entitlements, payments, and authentication remain
-- untouched. Browser roles receive no direct Quorum table or RPC access.

begin;

-- ---------------------------------------------------------------------------
-- Opaque public identifiers
-- ---------------------------------------------------------------------------

create or replace function public.forum_public_id(p_prefix text)
returns text
language sql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
  select lower(btrim(p_prefix)) || '_' || encode(gen_random_bytes(10), 'hex')
$$;

revoke all on function public.forum_public_id(text) from public, anon, authenticated;
grant execute on function public.forum_public_id(text) to service_role;

-- ---------------------------------------------------------------------------
-- Extend the already-deployed beta records in place
-- ---------------------------------------------------------------------------

alter table public.forum_posts
  add column if not exists public_id text,
  add column if not exists entry_type text not null default 'discuss_legal_issue',
  add column if not exists subject text,
  add column if not exists category text,
  add column if not exists law_school_year text,
  add column if not exists case_title text,
  add column if not exists opinion_only boolean not null default false,
  add column if not exists publication_status text not null default 'published',
  add column if not exists comments_locked_at timestamptz,
  add column if not exists comments_locked_by uuid references auth.users(id) on delete set null,
  add column if not exists comments_lock_reason text,
  add column if not exists mapped_question_id text;

update public.forum_posts
set public_id = public.forum_public_id('qe')
where public_id is null;

alter table public.forum_posts
  alter column public_id set default public.forum_public_id('qe'),
  alter column public_id set not null;

create unique index if not exists forum_posts_public_id_uidx
  on public.forum_posts (public_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.forum_posts'::regclass
      and conname = 'forum_posts_public_id_check'
  ) then
    alter table public.forum_posts add constraint forum_posts_public_id_check
      check (public_id ~ '^qe_[a-f0-9]{20}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.forum_posts'::regclass
      and conname = 'forum_posts_entry_type_check'
  ) then
    alter table public.forum_posts add constraint forum_posts_entry_type_check
      check (entry_type in (
        'ask_community',
        'discuss_legal_issue',
        'share_case_note',
        'request_study_help',
        'share_resource',
        'student_support',
        'school_bar_announcement'
      ));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.forum_posts'::regclass
      and conname = 'forum_posts_subject_check'
  ) then
    alter table public.forum_posts add constraint forum_posts_subject_check
      check (
        subject is null
        or subject in (
          'Political Law', 'Labor Law', 'Civil Law', 'Taxation Law',
          'Mercantile Law', 'Criminal Law', 'Remedial Law', 'Legal Ethics'
        )
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.forum_posts'::regclass
      and conname = 'forum_posts_category_check'
  ) then
    alter table public.forum_posts add constraint forum_posts_category_check
      check (
        category is null
        or category in (
          'philippine_legal_education',
          'philippine_jurisprudence',
          'bar_examination',
          'law_school_life',
          'career_internship',
          'student_support',
          'comparative_law'
        )
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.forum_posts'::regclass
      and conname = 'forum_posts_taxonomy_lengths_check'
  ) then
    alter table public.forum_posts add constraint forum_posts_taxonomy_lengths_check
      check (
        char_length(coalesce(law_school_year, '')) <= 80
        and char_length(coalesce(case_title, '')) <= 300
        and char_length(coalesce(mapped_question_id, '')) <= 120
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.forum_posts'::regclass
      and conname = 'forum_posts_publication_status_check'
  ) then
    alter table public.forum_posts add constraint forum_posts_publication_status_check
      check (publication_status in ('published', 'pending', 'rejected'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.forum_posts'::regclass
      and conname = 'forum_posts_lock_reason_check'
  ) then
    alter table public.forum_posts add constraint forum_posts_lock_reason_check
      check (
        comments_lock_reason is null
        or char_length(btrim(comments_lock_reason)) between 5 and 1000
      );
  end if;
end
$$;

alter table public.forum_comments
  add column if not exists public_id text,
  add column if not exists parent_comment_id uuid
    references public.forum_comments(id) on delete cascade;

update public.forum_comments
set public_id = public.forum_public_id('qc')
where public_id is null;

alter table public.forum_comments
  alter column public_id set default public.forum_public_id('qc'),
  alter column public_id set not null;

create unique index if not exists forum_comments_public_id_uidx
  on public.forum_comments (public_id);
create index if not exists forum_comments_parent_idx
  on public.forum_comments (parent_comment_id, created_at asc, id asc)
  where deleted_at is null and moderation_status = 'visible';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.forum_comments'::regclass
      and conname = 'forum_comments_public_id_check'
  ) then
    alter table public.forum_comments add constraint forum_comments_public_id_check
      check (public_id ~ '^qc_[a-f0-9]{20}$');
  end if;
end
$$;

alter table public.forum_reposts
  add column if not exists public_id text;

update public.forum_reposts
set public_id = public.forum_public_id('qr')
where public_id is null;

alter table public.forum_reposts
  alter column public_id set default public.forum_public_id('qr'),
  alter column public_id set not null;

create unique index if not exists forum_reposts_public_id_uidx
  on public.forum_reposts (public_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.forum_reposts'::regclass
      and conname = 'forum_reposts_public_id_check'
  ) then
    alter table public.forum_reposts add constraint forum_reposts_public_id_check
      check (public_id ~ '^qr_[a-f0-9]{20}$');
  end if;
end
$$;

alter table public.forum_reports
  add column if not exists public_id text;
update public.forum_reports
set public_id = public.forum_public_id('qf')
where public_id is null;
alter table public.forum_reports
  alter column public_id set default public.forum_public_id('qf'),
  alter column public_id set not null;
create unique index if not exists forum_reports_public_id_uidx
  on public.forum_reports (public_id);

alter table public.forum_user_restrictions
  add column if not exists public_id text;
update public.forum_user_restrictions
set public_id = public.forum_public_id('qx')
where public_id is null;
alter table public.forum_user_restrictions
  alter column public_id set default public.forum_public_id('qx'),
  alter column public_id set not null;
create unique index if not exists forum_user_restrictions_public_id_uidx
  on public.forum_user_restrictions (public_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.forum_reports'::regclass
      and conname = 'forum_reports_public_id_check'
  ) then
    alter table public.forum_reports add constraint forum_reports_public_id_check
      check (public_id ~ '^qf_[a-f0-9]{20}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.forum_user_restrictions'::regclass
      and conname = 'forum_user_restrictions_public_id_check'
  ) then
    alter table public.forum_user_restrictions
      add constraint forum_user_restrictions_public_id_check
      check (public_id ~ '^qx_[a-f0-9]{20}$');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- New Quorum entities
-- ---------------------------------------------------------------------------

create table if not exists public.forum_profile_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  public_id text not null default public.forum_public_id('qm'),
  profile_public boolean not null default true,
  show_school boolean not null default true,
  show_year boolean not null default true,
  verified_academic_at timestamptz,
  verified_academic_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint forum_profile_settings_public_id_check
    check (public_id ~ '^qm_[a-f0-9]{20}$')
);

create unique index if not exists forum_profile_settings_public_id_uidx
  on public.forum_profile_settings (public_id);

insert into public.forum_profile_settings (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create table if not exists public.forum_study_circles (
  id uuid primary key default gen_random_uuid(),
  public_id text not null default public.forum_public_id('qs'),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  name text not null,
  description text not null,
  subject text,
  school text,
  rules text not null,
  status text not null default 'active'
    check (status in ('active', 'archived', 'hidden', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  moderated_at timestamptz,
  moderated_by uuid references auth.users(id) on delete set null,
  moderation_reason text,
  constraint forum_study_circles_public_id_check
    check (public_id ~ '^qs_[a-f0-9]{20}$'),
  constraint forum_study_circles_name_check
    check (char_length(btrim(name)) between 3 and 100),
  constraint forum_study_circles_description_check
    check (char_length(btrim(description)) between 10 and 1000),
  constraint forum_study_circles_rules_check
    check (char_length(btrim(rules)) between 10 and 2000),
  constraint forum_study_circles_subject_check
    check (
      subject is null
      or subject in (
        'Political Law', 'Labor Law', 'Civil Law', 'Taxation Law',
        'Mercantile Law', 'Criminal Law', 'Remedial Law', 'Legal Ethics'
      )
    ),
  constraint forum_study_circles_school_check
    check (
      school is null
      or (
        char_length(btrim(school)) between 2 and 200
        and position('@' in school) = 0
      )
    ),
  constraint forum_study_circles_moderation_reason_check
    check (
      moderation_reason is null
      or char_length(btrim(moderation_reason)) between 5 and 1000
    )
);

create unique index if not exists forum_study_circles_public_id_uidx
  on public.forum_study_circles (public_id);
create index if not exists forum_study_circles_browse_idx
  on public.forum_study_circles (status, subject, created_at desc, id desc);
create index if not exists forum_study_circles_owner_idx
  on public.forum_study_circles (owner_user_id, created_at desc);

alter table public.forum_posts
  add column if not exists circle_id uuid
    references public.forum_study_circles(id) on delete set null;

create index if not exists forum_posts_taxonomy_idx
  on public.forum_posts (entry_type, subject, category, created_at desc, id desc)
  where deleted_at is null
    and moderation_status = 'visible'
    and publication_status = 'published';
create index if not exists forum_posts_circle_idx
  on public.forum_posts (circle_id, created_at desc, id desc)
  where deleted_at is null
    and moderation_status = 'visible'
    and publication_status = 'published';

create table if not exists public.forum_circle_members (
  circle_id uuid not null
    references public.forum_study_circles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null default 'member'
    check (member_role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (circle_id, user_id)
);

create index if not exists forum_circle_members_user_idx
  on public.forum_circle_members (user_id, joined_at desc)
  where left_at is null;
create index if not exists forum_circle_members_circle_idx
  on public.forum_circle_members (circle_id, joined_at asc)
  where left_at is null;

create table if not exists public.forum_saved_entries (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid not null references public.forum_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index if not exists forum_saved_entries_user_idx
  on public.forum_saved_entries (user_id, created_at desc, post_id);

create table if not exists public.forum_user_blocks (
  blocker_user_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  constraint forum_user_blocks_distinct_check
    check (blocker_user_id <> blocked_user_id)
);

create index if not exists forum_user_blocks_blocked_idx
  on public.forum_user_blocks (blocked_user_id, created_at desc);

create table if not exists public.forum_entry_indicators (
  post_id uuid not null references public.forum_posts(id) on delete cascade,
  indicator text not null check (
    indicator in (
      'citation_checked',
      'community_correction',
      'moderator_reviewed'
    )
  ),
  applied_by uuid not null references auth.users(id) on delete restrict,
  note text,
  applied_at timestamptz not null default now(),
  primary key (post_id, indicator),
  constraint forum_entry_indicators_note_check
    check (note is null or char_length(btrim(note)) between 5 and 500)
);

create table if not exists public.forum_post_attachments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references public.forum_posts(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  bucket_id text not null default 'quorum-images'
    check (bucket_id = 'quorum-images'),
  object_path text not null unique,
  mime_type text not null check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp')
  ),
  byte_size integer not null check (byte_size between 1 and 3145728),
  width integer check (width is null or width between 1 and 8000),
  height integer check (height is null or height between 1 and 8000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint forum_post_attachments_path_check
    check (
      object_path ~ '^entries/qe_[a-f0-9]{20}/[a-f0-9]{24}\.(jpg|png|webp)$'
    )
);

create index if not exists forum_post_attachments_owner_idx
  on public.forum_post_attachments (owner_user_id, created_at desc);

create table if not exists public.forum_notifications (
  id uuid primary key default gen_random_uuid(),
  public_id text not null default public.forum_public_id('qn'),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  notification_type text not null check (
    notification_type in (
      'entry_comment',
      'comment_reply',
      'helpful',
      'repost',
      'circle_activity',
      'moderation_decision'
    )
  ),
  post_id uuid references public.forum_posts(id) on delete cascade,
  comment_id uuid references public.forum_comments(id) on delete cascade,
  circle_id uuid references public.forum_study_circles(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint forum_notifications_public_id_check
    check (public_id ~ '^qn_[a-f0-9]{20}$')
);

create unique index if not exists forum_notifications_public_id_uidx
  on public.forum_notifications (public_id);
create index if not exists forum_notifications_unread_idx
  on public.forum_notifications (user_id, created_at desc, id desc)
  where read_at is null;

create table if not exists public.forum_telemetry_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (
    event_type in ('quorum_opened', 'practice_clicked', 'api_failed')
  ),
  subject text,
  entry_type text,
  result_category text,
  created_at timestamptz not null default now(),
  constraint forum_telemetry_subject_check
    check (subject is null or char_length(subject) <= 120),
  constraint forum_telemetry_entry_type_check
    check (entry_type is null or char_length(entry_type) <= 80),
  constraint forum_telemetry_result_check
    check (result_category is null or char_length(result_category) <= 80)
);

create index if not exists forum_telemetry_events_period_idx
  on public.forum_telemetry_events (event_type, created_at desc);

-- Reports now include Study Circles and the complete community-standard taxonomy.
alter table public.forum_reports
  add column if not exists target_circle_id uuid
    references public.forum_study_circles(id) on delete cascade;

alter table public.forum_reports
  drop constraint if exists forum_reports_target_type_check,
  drop constraint if exists forum_reports_category_check,
  drop constraint if exists forum_reports_exact_target_check;

alter table public.forum_reports
  add constraint forum_reports_target_type_check
    check (target_type in ('post', 'comment', 'circle')),
  add constraint forum_reports_category_check
    check (category in (
      'harassment',
      'misinformation',
      'unsafe_link',
      'spam',
      'privacy',
      'sexual_content',
      'unlawful_content',
      'fundraising_spam',
      'unauthorized_advertising',
      'copyright',
      'impersonation',
      'academic_dishonesty',
      'other'
    )),
  add constraint forum_reports_exact_target_check check (
    (
      target_type = 'post'
      and target_post_id is not null
      and target_comment_id is null
      and target_circle_id is null
    )
    or (
      target_type = 'comment'
      and target_post_id is null
      and target_comment_id is not null
      and target_circle_id is null
    )
    or (
      target_type = 'circle'
      and target_post_id is null
      and target_comment_id is null
      and target_circle_id is not null
    )
  );

create unique index if not exists forum_reports_unique_circle_uidx
  on public.forum_reports (reporter_user_id, target_circle_id)
  where target_type = 'circle';

-- Cover foreign-key and moderation lookups used by notifications, reports,
-- account lifecycle operations, and the Quorum administration queue.
create index if not exists forum_comments_moderated_by_idx
  on public.forum_comments (moderated_by)
  where moderated_by is not null;
create index if not exists forum_entry_indicators_applied_by_idx
  on public.forum_entry_indicators (applied_by);
create index if not exists forum_notifications_actor_idx
  on public.forum_notifications (actor_user_id, created_at desc)
  where actor_user_id is not null;
create index if not exists forum_notifications_circle_idx
  on public.forum_notifications (circle_id, created_at desc)
  where circle_id is not null;
create index if not exists forum_notifications_comment_idx
  on public.forum_notifications (comment_id, created_at desc)
  where comment_id is not null;
create index if not exists forum_notifications_post_idx
  on public.forum_notifications (post_id, created_at desc)
  where post_id is not null;
create index if not exists forum_posts_comments_locked_by_idx
  on public.forum_posts (comments_locked_by)
  where comments_locked_by is not null;
create index if not exists forum_posts_moderated_by_idx
  on public.forum_posts (moderated_by)
  where moderated_by is not null;
create index if not exists forum_profile_settings_verified_by_idx
  on public.forum_profile_settings (verified_academic_by)
  where verified_academic_by is not null;
create index if not exists forum_reports_reviewed_by_idx
  on public.forum_reports (reviewed_by)
  where reviewed_by is not null;
create index if not exists forum_reports_target_circle_idx
  on public.forum_reports (target_circle_id)
  where target_circle_id is not null;
create index if not exists forum_reports_target_comment_idx
  on public.forum_reports (target_comment_id)
  where target_comment_id is not null;
create index if not exists forum_reports_target_post_idx
  on public.forum_reports (target_post_id)
  where target_post_id is not null;
create index if not exists forum_saved_entries_post_idx
  on public.forum_saved_entries (post_id);
create index if not exists forum_study_circles_moderated_by_idx
  on public.forum_study_circles (moderated_by)
  where moderated_by is not null;
create index if not exists forum_telemetry_events_user_idx
  on public.forum_telemetry_events (user_id, created_at desc)
  where user_id is not null;
create index if not exists forum_user_restrictions_created_by_idx
  on public.forum_user_restrictions (created_by)
  where created_by is not null;
create index if not exists forum_user_restrictions_revoked_by_idx
  on public.forum_user_restrictions (revoked_by)
  where revoked_by is not null;

-- Expand privacy-safe persistent action-rate events.
alter table public.forum_action_events
  drop constraint if exists forum_action_events_action_type_check;

alter table public.forum_action_events
  add constraint forum_action_events_action_type_check check (
    action_type in (
      'post_create',
      'post_edit',
      'comment_create',
      'comment_edit',
      'reaction_toggle',
      'repost_create',
      'report_create',
      'save_toggle',
      'block_toggle',
      'circle_create',
      'circle_membership',
      'notification_update',
      'profile_update'
    )
  );

-- Search documents remain derived and cannot contain hidden metadata.
alter table public.forum_posts
  add column if not exists search_document tsvector
    generated always as (
      to_tsvector(
        'simple',
        coalesce(body, '') || ' ' ||
        coalesce(case_title, '') || ' ' ||
        replace(coalesce(entry_type, ''), '_', ' ') || ' ' ||
        coalesce(subject, '') || ' ' ||
        replace(coalesce(category, ''), '_', ' ') || ' ' ||
        coalesce(source_url, '')
      )
    ) stored;

create index if not exists forum_posts_search_gin_idx
  on public.forum_posts using gin (search_document);

alter table public.forum_study_circles
  add column if not exists search_document tsvector
    generated always as (
      to_tsvector(
        'simple',
        coalesce(name, '') || ' ' ||
        coalesce(description, '') || ' ' ||
        coalesce(subject, '') || ' ' ||
        coalesce(school, '')
      )
    ) stored;

create index if not exists forum_study_circles_search_gin_idx
  on public.forum_study_circles using gin (search_document);

-- Private image bucket. Browser roles have no storage.objects policy for this
-- bucket; all validation and object operations are Worker-mediated.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'quorum-images',
  'quorum-images',
  false,
  3145728,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- RLS and least privilege
-- ---------------------------------------------------------------------------

alter table public.forum_profile_settings enable row level security;
alter table public.forum_study_circles enable row level security;
alter table public.forum_circle_members enable row level security;
alter table public.forum_saved_entries enable row level security;
alter table public.forum_user_blocks enable row level security;
alter table public.forum_entry_indicators enable row level security;
alter table public.forum_post_attachments enable row level security;
alter table public.forum_notifications enable row level security;
alter table public.forum_telemetry_events enable row level security;

revoke all on public.forum_profile_settings from public, anon, authenticated;
revoke all on public.forum_study_circles from public, anon, authenticated;
revoke all on public.forum_circle_members from public, anon, authenticated;
revoke all on public.forum_saved_entries from public, anon, authenticated;
revoke all on public.forum_user_blocks from public, anon, authenticated;
revoke all on public.forum_entry_indicators from public, anon, authenticated;
revoke all on public.forum_post_attachments from public, anon, authenticated;
revoke all on public.forum_notifications from public, anon, authenticated;
revoke all on public.forum_telemetry_events from public, anon, authenticated;

grant select, insert, update, delete on public.forum_profile_settings to service_role;
grant select, insert, update, delete on public.forum_study_circles to service_role;
grant select, insert, update, delete on public.forum_circle_members to service_role;
grant select, insert, delete on public.forum_saved_entries to service_role;
grant select, insert, delete on public.forum_user_blocks to service_role;
grant select, insert, update, delete on public.forum_entry_indicators to service_role;
grant select, insert, update, delete on public.forum_post_attachments to service_role;
grant select, insert, update, delete on public.forum_notifications to service_role;
grant select, insert, delete on public.forum_telemetry_events to service_role;
grant usage, select on sequence public.forum_telemetry_events_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- Trusted Quorum helpers
-- ---------------------------------------------------------------------------

create or replace function public.forum_profile_settings_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.forum_profile_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists forum_profile_settings_after_auth_user_insert on auth.users;
create trigger forum_profile_settings_after_auth_user_insert
  after insert on auth.users
  for each row
  execute function public.forum_profile_settings_for_new_user();

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
    'report_create',
    'save_toggle',
    'block_toggle',
    'circle_create',
    'circle_membership',
    'notification_update',
    'profile_update'
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

create or replace function public.forum_users_blocked(
  p_first_user_id uuid,
  p_second_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_first_user_id is null or p_second_user_id is null then false
    else exists (
      select 1
      from public.forum_user_blocks b
      where
        (b.blocker_user_id = p_first_user_id and b.blocked_user_id = p_second_user_id)
        or
        (b.blocker_user_id = p_second_user_id and b.blocked_user_id = p_first_user_id)
    )
  end
$$;

create or replace function public.forum_safe_profile(
  p_viewer_user_id uuid,
  p_member_user_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p.id is null
      or public.forum_users_blocked(p_viewer_user_id, p_member_user_id)
      then null
    else jsonb_build_object(
      'memberId', s.public_id,
      'displayName', case
        when nullif(btrim(p.display_name), '') is null
          or position('@' in p.display_name) > 0 then 'Due Diligence Member'
        else btrim(p.display_name)
      end,
      'school', case
        when s.show_school
          and position('@' in coalesce(p.school, '')) = 0
          then nullif(btrim(p.school), '')
        else null
      end,
      'yearLevel', case
        when s.show_year then nullif(btrim(p.year_level), '')
        else null
      end,
      'verifiedAcademicIdentity', s.verified_academic_at is not null,
      'viewerOwns', p.id = p_viewer_user_id
    )
  end
  from public.profiles p
  join public.forum_profile_settings s on s.user_id = p.id
  where p.id = p_member_user_id
    and (s.profile_public or p.id = p_viewer_user_id)
$$;

create or replace function public.forum_post_is_visible(
  p_viewer_user_id uuid,
  p_post_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.forum_posts p
    left join public.forum_study_circles c on c.id = p.circle_id
    where p.id = p_post_id
      and p.deleted_at is null
      and p.moderation_status = 'visible'
      and p.publication_status = 'published'
      and not public.forum_users_blocked(p_viewer_user_id, p.author_user_id)
      and (
        p.circle_id is null
        or c.status in ('active', 'archived')
      )
  )
$$;

create or replace function public.forum_create_notification(
  p_user_id uuid,
  p_actor_user_id uuid,
  p_notification_type text,
  p_post_id uuid default null,
  p_comment_id uuid default null,
  p_circle_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null
    or p_actor_user_id is null
    or p_user_id = p_actor_user_id
    or public.forum_users_blocked(p_user_id, p_actor_user_id)
  then
    return;
  end if;

  if p_notification_type not in (
    'entry_comment',
    'comment_reply',
    'helpful',
    'repost',
    'circle_activity',
    'moderation_decision'
  ) then
    raise exception 'FORUM_NOTIFICATION_INVALID';
  end if;

  if not exists (
    select 1
    from public.forum_notifications n
    where n.user_id = p_user_id
      and n.actor_user_id = p_actor_user_id
      and n.notification_type = p_notification_type
      and n.post_id is not distinct from p_post_id
      and n.comment_id is not distinct from p_comment_id
      and n.circle_id is not distinct from p_circle_id
      and n.created_at >= now() - interval '2 minutes'
  ) then
    insert into public.forum_notifications (
      user_id,
      actor_user_id,
      notification_type,
      post_id,
      comment_id,
      circle_id
    )
    values (
      p_user_id,
      p_actor_user_id,
      p_notification_type,
      p_post_id,
      p_comment_id,
      p_circle_id
    );
  end if;
end;
$$;

create or replace function public.forum_render_entry(
  p_viewer_user_id uuid,
  p_post_id uuid,
  p_repost_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.forum_post_is_visible(p_viewer_user_id, p_post_id) then
    return null;
  end if;

  select jsonb_build_object(
    'kind', case when r.id is null then 'entry' else 'citation' end,
    'entryId', p.public_id,
    'body', p.body,
    'sourceUrl', p.source_url,
    'caseTitle', p.case_title,
    'entryType', p.entry_type,
    'subject', p.subject,
    'category', p.category,
    'lawSchoolYear', p.law_school_year,
    'createdAt', p.created_at,
    'updatedAt', p.updated_at,
    'edited', p.edited_at is not null,
    'commentsLocked', p.comments_locked_at is not null,
    'viewerOwns', p.author_user_id = p_viewer_user_id,
    'viewerHelpful', exists (
      select 1 from public.forum_reactions x
      where x.post_id = p.id and x.user_id = p_viewer_user_id
    ),
    'viewerSaved', exists (
      select 1 from public.forum_saved_entries x
      where x.post_id = p.id and x.user_id = p_viewer_user_id
    ),
    'author', public.forum_safe_profile(p_viewer_user_id, p.author_user_id),
    'circle', case when c.id is null then null else jsonb_build_object(
      'circleId', c.public_id,
      'name', c.name,
      'subject', c.subject,
      'status', c.status
    ) end,
    'counts', jsonb_build_object(
      'helpful', (
        select count(*) from public.forum_reactions x where x.post_id = p.id
      ),
      'comments', (
        select count(*) from public.forum_comments x
        where x.post_id = p.id
          and x.deleted_at is null
          and x.moderation_status = 'visible'
      ),
      'citations', (
        select count(*) from public.forum_reposts x
        where x.original_post_id = p.id and x.deleted_at is null
      )
    ),
    'indicators', (
      select coalesce(jsonb_agg(v.indicator order by v.ordinal), '[]'::jsonb)
      from (
        select 'Source Provided'::text as indicator, 1 as ordinal
        where p.source_url is not null
        union all
        select 'Opinion Only', 2 where p.opinion_only
        union all
        select case i.indicator
          when 'citation_checked' then 'Citation Checked'
          when 'community_correction' then 'Community Correction'
          when 'moderator_reviewed' then 'Moderator Reviewed'
        end,
        case i.indicator
          when 'citation_checked' then 3
          when 'community_correction' then 4
          else 5
        end
        from public.forum_entry_indicators i
        where i.post_id = p.id
      ) v
    ),
    'imagePath', a.object_path,
    'practiceQuestionId', p.mapped_question_id,
    'citation', case when r.id is null then null else jsonb_build_object(
      'citationId', r.public_id,
      'commentary', r.commentary,
      'createdAt', r.created_at,
      'viewerOwns', r.user_id = p_viewer_user_id,
      'author', public.forum_safe_profile(p_viewer_user_id, r.user_id)
    ) end
  )
  into v_result
  from public.forum_posts p
  left join public.forum_reposts r
    on r.id = p_repost_id
    and r.original_post_id = p.id
    and r.deleted_at is null
    and not public.forum_users_blocked(p_viewer_user_id, r.user_id)
  left join public.forum_study_circles c on c.id = p.circle_id
  left join public.forum_post_attachments a
    on a.post_id = p.id and a.deleted_at is null
  where p.id = p_post_id;

  if p_repost_id is not null and (v_result->'citation') = 'null'::jsonb then
    return null;
  end if;
  return v_result;
end;
$$;

revoke all on function public.forum_profile_settings_for_new_user()
  from public, anon, authenticated;
revoke all on function public.forum_enforce_action_limit(uuid, text, integer, interval)
  from public, anon, authenticated;
revoke all on function public.forum_users_blocked(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.forum_safe_profile(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.forum_post_is_visible(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.forum_create_notification(uuid, uuid, text, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.forum_render_entry(uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.forum_profile_settings_for_new_user()
  to service_role;
grant execute on function public.forum_enforce_action_limit(uuid, text, integer, interval)
  to service_role;
grant execute on function public.forum_users_blocked(uuid, uuid)
  to service_role;
grant execute on function public.forum_safe_profile(uuid, uuid)
  to service_role;
grant execute on function public.forum_post_is_visible(uuid, uuid)
  to service_role;
grant execute on function public.forum_create_notification(uuid, uuid, text, uuid, uuid, uuid)
  to service_role;
grant execute on function public.forum_render_entry(uuid, uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Authenticated Quorum reads
-- ---------------------------------------------------------------------------

create or replace function public.forum_quorum_query(
  p_user_id uuid,
  p_operation text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation text := lower(btrim(coalesce(p_operation, '')));
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_limit integer := least(20, greatest(1, coalesce((v_payload->>'limit')::integer, 10)));
  v_query text := left(btrim(coalesce(v_payload->>'query', '')), 120);
  v_sort text := lower(btrim(coalesce(v_payload->>'sort', 'latest')));
  v_subject text := nullif(btrim(coalesce(v_payload->>'subject', '')), '');
  v_entry_type text := nullif(lower(btrim(coalesce(v_payload->>'entryType', ''))), '');
  v_category text := nullif(lower(btrim(coalesce(v_payload->>'category', ''))), '');
  v_cursor_at timestamptz;
  v_cursor_id text := nullif(btrim(coalesce(v_payload->>'cursorId', '')), '');
  v_circle_id uuid;
  v_author_user_id uuid;
  v_post_id uuid;
  v_entry_public_id text;
  v_member_user_id uuid;
  v_items jsonb;
  v_next jsonb;
  v_has_more boolean;
  v_result jsonb;
  v_saved_only boolean := coalesce(v_payload->>'savedOnly', 'false') = 'true';
  v_joined_only boolean := coalesce(v_payload->>'joinedOnly', 'false') = 'true';
  v_unanswered_only boolean := coalesce(v_payload->>'unansweredOnly', 'false') = 'true';
begin
  perform public.forum_assert_member(p_user_id);
  insert into public.forum_profile_settings (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'FORUM_QUERY_INVALID';
  end if;
  if v_sort not in ('latest', 'oldest') then
    raise exception 'FORUM_SORT_INVALID';
  end if;
  if v_subject is not null and v_subject not in (
    'Political Law', 'Labor Law', 'Civil Law', 'Taxation Law',
    'Mercantile Law', 'Criminal Law', 'Remedial Law', 'Legal Ethics'
  ) then
    raise exception 'FORUM_SUBJECT_INVALID';
  end if;
  if v_entry_type is not null and v_entry_type not in (
    'ask_community', 'discuss_legal_issue', 'share_case_note',
    'request_study_help', 'share_resource', 'student_support',
    'school_bar_announcement'
  ) then
    raise exception 'FORUM_ENTRY_TYPE_INVALID';
  end if;
  if v_category is not null and v_category not in (
    'philippine_legal_education', 'philippine_jurisprudence',
    'bar_examination', 'law_school_life', 'career_internship',
    'student_support', 'comparative_law'
  ) then
    raise exception 'FORUM_CATEGORY_INVALID';
  end if;
  if nullif(v_payload->>'cursorAt', '') is not null then
    begin
      v_cursor_at := (v_payload->>'cursorAt')::timestamptz;
    exception when others then
      raise exception 'FORUM_CURSOR_INVALID';
    end;
  end if;

  if nullif(v_payload->>'circleId', '') is not null then
    select id into v_circle_id
    from public.forum_study_circles
    where public_id = v_payload->>'circleId';
    if v_circle_id is null then raise exception 'FORUM_CIRCLE_NOT_FOUND'; end if;
  end if;

  if nullif(v_payload->>'authorMemberId', '') is not null then
    select user_id into v_author_user_id
    from public.forum_profile_settings
    where public_id = v_payload->>'authorMemberId';
    if v_author_user_id is null
      or public.forum_users_blocked(p_user_id, v_author_user_id)
    then
      raise exception 'FORUM_MEMBER_NOT_FOUND';
    end if;
  end if;

  if v_operation = 'bootstrap' then
    return jsonb_build_object(
      'profile', public.forum_safe_profile(p_user_id, p_user_id),
      'counts', jsonb_build_object(
        'unreadNotifications', (
          select count(*) from public.forum_notifications
          where user_id = p_user_id and read_at is null
        ),
        'savedAuthorities', (
          select count(*) from public.forum_saved_entries
          where user_id = p_user_id
        ),
        'joinedCircles', (
          select count(*) from public.forum_circle_members
          where user_id = p_user_id and left_at is null
        ),
        'entries', (
          select count(*) from public.forum_posts
          where author_user_id = p_user_id and deleted_at is null
        )
      )
    );

  elsif v_operation in ('feed', 'saved', 'unanswered') then
    if v_operation = 'saved' then v_saved_only := true; end if;
    if v_operation = 'unanswered' then v_unanswered_only := true; end if;

    with candidates as (
      select
        p.created_at as sort_at,
        p.public_id as item_public_id,
        p.id as post_id,
        null::uuid as repost_id
      from public.forum_posts p
      where public.forum_post_is_visible(p_user_id, p.id)
        and (v_subject is null or p.subject = v_subject)
        and (v_entry_type is null or p.entry_type = v_entry_type)
        and (v_category is null or p.category = v_category)
        and (v_circle_id is null or p.circle_id = v_circle_id)
        and (v_author_user_id is null or p.author_user_id = v_author_user_id)
        and (
          not v_saved_only
          or exists (
            select 1 from public.forum_saved_entries s
            where s.user_id = p_user_id and s.post_id = p.id
          )
        )
        and (
          not v_unanswered_only
          or (
            p.entry_type in ('ask_community', 'request_study_help')
            and not exists (
              select 1 from public.forum_comments c
              where c.post_id = p.id
                and c.deleted_at is null
                and c.moderation_status = 'visible'
            )
          )
        )
        and (
          v_query = ''
          or p.search_document @@ websearch_to_tsquery('simple', v_query)
        )

      union all

      select
        r.created_at,
        r.public_id,
        p.id,
        r.id
      from public.forum_reposts r
      join public.forum_posts p on p.id = r.original_post_id
      where not v_saved_only
        and not v_unanswered_only
        and r.deleted_at is null
        and public.forum_post_is_visible(p_user_id, p.id)
        and not public.forum_users_blocked(p_user_id, r.user_id)
        and (v_subject is null or p.subject = v_subject)
        and (v_entry_type is null or p.entry_type = v_entry_type)
        and (v_category is null or p.category = v_category)
        and (v_circle_id is null or p.circle_id = v_circle_id)
        and (v_author_user_id is null or p.author_user_id = v_author_user_id)
        and (
          v_query = ''
          or p.search_document @@ websearch_to_tsquery('simple', v_query)
          or to_tsvector('simple', coalesce(r.commentary, ''))
             @@ websearch_to_tsquery('simple', v_query)
        )
    ),
    filtered as (
      select *
      from candidates
      where v_cursor_at is null
        or (
          v_sort = 'latest'
          and (
            sort_at < v_cursor_at
            or (sort_at = v_cursor_at and item_public_id < coalesce(v_cursor_id, item_public_id))
          )
        )
        or (
          v_sort = 'oldest'
          and (
            sort_at > v_cursor_at
            or (sort_at = v_cursor_at and item_public_id > coalesce(v_cursor_id, item_public_id))
          )
        )
      order by
        case when v_sort = 'latest' then sort_at end desc,
        case when v_sort = 'latest' then item_public_id end desc,
        case when v_sort = 'oldest' then sort_at end asc,
        case when v_sort = 'oldest' then item_public_id end asc
      limit v_limit + 1
    ),
    selected as (
      select *
      from filtered
      order by
        case when v_sort = 'latest' then sort_at end desc,
        case when v_sort = 'latest' then item_public_id end desc,
        case when v_sort = 'oldest' then sort_at end asc,
        case when v_sort = 'oldest' then item_public_id end asc
      limit v_limit
    ),
    rendered as (
      select
        s.sort_at,
        s.item_public_id,
        public.forum_render_entry(p_user_id, s.post_id, s.repost_id) as item
      from selected s
    )
    select
      coalesce(
        jsonb_agg(item order by
          case when v_sort = 'latest' then sort_at end desc,
          case when v_sort = 'latest' then item_public_id end desc,
          case when v_sort = 'oldest' then sort_at end asc,
          case when v_sort = 'oldest' then item_public_id end asc
        ) filter (where item is not null),
        '[]'::jsonb
      ),
      (select count(*) > v_limit from filtered),
      case
        when (select count(*) > v_limit from filtered) then (
          select jsonb_build_object(
            'createdAt', sort_at,
            'id', item_public_id
          )
          from selected
          order by
            case when v_sort = 'latest' then sort_at end asc,
            case when v_sort = 'latest' then item_public_id end asc,
            case when v_sort = 'oldest' then sort_at end desc,
            case when v_sort = 'oldest' then item_public_id end desc
          limit 1
        )
        else null
      end
    into v_items, v_has_more, v_next
    from rendered;

    return jsonb_build_object(
      'items', coalesce(v_items, '[]'::jsonb),
      'hasMore', coalesce(v_has_more, false),
      'nextCursor', v_next
    );

  elsif v_operation = 'entry' then
    select id, public_id into v_post_id, v_entry_public_id
    from public.forum_posts
    where public_id = v_payload->>'entryId'
      or (
        nullif(v_payload->>'legacyPostId', '') is not null
        and id = (v_payload->>'legacyPostId')::uuid
      );
    if v_post_id is null
      or not public.forum_post_is_visible(p_user_id, v_post_id)
    then
      raise exception 'FORUM_POST_NOT_FOUND';
    end if;
    return jsonb_build_object(
      'entry', public.forum_render_entry(p_user_id, v_post_id, null),
      'comments', public.forum_quorum_query(
        p_user_id,
        'comments',
        jsonb_build_object('entryId', v_entry_public_id, 'limit', 200)
      )
    );

  elsif v_operation = 'comments' then
    select id into v_post_id
    from public.forum_posts
    where public_id = v_payload->>'entryId';
    if v_post_id is null
      or not public.forum_post_is_visible(p_user_id, v_post_id)
    then
      raise exception 'FORUM_POST_NOT_FOUND';
    end if;

    return coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'commentId', c.public_id,
          'parentCommentId', parent.public_id,
          'body', c.body,
          'createdAt', c.created_at,
          'updatedAt', c.updated_at,
          'edited', c.edited_at is not null,
          'viewerOwns', c.author_user_id = p_user_id,
          'author', public.forum_safe_profile(p_user_id, c.author_user_id)
        )
        order by coalesce(parent.created_at, c.created_at), parent.id nulls first, c.created_at, c.id
      )
      from (
        select *
        from public.forum_comments
        where post_id = v_post_id
          and deleted_at is null
          and moderation_status = 'visible'
          and not public.forum_users_blocked(p_user_id, author_user_id)
        order by created_at asc, id asc
        limit least(200, greatest(1, coalesce((v_payload->>'limit')::integer, 100)))
      ) c
      left join public.forum_comments parent on parent.id = c.parent_comment_id
    ), '[]'::jsonb);

  elsif v_operation = 'circles' then
    return jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(item order by created_at desc, circle_id desc)
        from (
          select
            c.created_at,
            c.public_id as circle_id,
            jsonb_build_object(
              'circleId', c.public_id,
              'name', c.name,
              'description', c.description,
              'subject', c.subject,
              'school', c.school,
              'rules', c.rules,
              'status', c.status,
              'createdAt', c.created_at,
              'owner', public.forum_safe_profile(p_user_id, c.owner_user_id),
              'viewerOwns', c.owner_user_id = p_user_id,
              'viewerJoined', exists (
                select 1 from public.forum_circle_members m
                where m.circle_id = c.id
                  and m.user_id = p_user_id
                  and m.left_at is null
              ),
              'memberCount', (
                select count(*) from public.forum_circle_members m
                where m.circle_id = c.id and m.left_at is null
              ),
              'entryCount', (
                select count(*) from public.forum_posts p
                where p.circle_id = c.id
                  and public.forum_post_is_visible(p_user_id, p.id)
              )
            ) as item
          from public.forum_study_circles c
          where c.status in ('active', 'archived')
            and not public.forum_users_blocked(p_user_id, c.owner_user_id)
            and (v_subject is null or c.subject = v_subject)
            and (
              not v_joined_only
              or exists (
                select 1 from public.forum_circle_members m
                where m.circle_id = c.id
                  and m.user_id = p_user_id
                  and m.left_at is null
              )
            )
            and (
              v_query = ''
              or c.search_document @@ websearch_to_tsquery('simple', v_query)
            )
          order by c.created_at desc, c.id desc
          limit v_limit
        ) listed
      ), '[]'::jsonb)
    );

  elsif v_operation = 'circle' then
    select id into v_circle_id
    from public.forum_study_circles
    where public_id = v_payload->>'circleId'
      and status in ('active', 'archived');
    if v_circle_id is null then raise exception 'FORUM_CIRCLE_NOT_FOUND'; end if;

    select jsonb_build_object(
      'circleId', c.public_id,
      'name', c.name,
      'description', c.description,
      'subject', c.subject,
      'school', c.school,
      'rules', c.rules,
      'status', c.status,
      'createdAt', c.created_at,
      'owner', public.forum_safe_profile(p_user_id, c.owner_user_id),
      'viewerOwns', c.owner_user_id = p_user_id,
      'viewerJoined', exists (
        select 1 from public.forum_circle_members m
        where m.circle_id = c.id and m.user_id = p_user_id and m.left_at is null
      ),
      'members', case
        when c.owner_user_id = p_user_id or exists (
          select 1 from public.forum_circle_members m
          where m.circle_id = c.id and m.user_id = p_user_id and m.left_at is null
        ) then (
          select coalesce(jsonb_agg(
            public.forum_safe_profile(p_user_id, m.user_id)
            order by m.joined_at asc
          ) filter (
            where public.forum_safe_profile(p_user_id, m.user_id) is not null
          ), '[]'::jsonb)
          from public.forum_circle_members m
          where m.circle_id = c.id and m.left_at is null
        )
        else '[]'::jsonb
      end
    )
    into v_result
    from public.forum_study_circles c
    where c.id = v_circle_id
      and not public.forum_users_blocked(p_user_id, c.owner_user_id);
    if v_result is null then raise exception 'FORUM_CIRCLE_NOT_FOUND'; end if;
    return v_result;

  elsif v_operation = 'notifications' then
    return jsonb_build_object(
      'unreadCount', (
        select count(*) from public.forum_notifications
        where user_id = p_user_id and read_at is null
      ),
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'notificationId', n.public_id,
            'type', n.notification_type,
            'createdAt', n.created_at,
            'read', n.read_at is not null,
            'actor', public.forum_safe_profile(p_user_id, n.actor_user_id),
            'entryId', p.public_id,
            'commentId', cm.public_id,
            'circleId', c.public_id,
            'targetAvailable', (
              (n.post_id is null or public.forum_post_is_visible(p_user_id, n.post_id))
              and (n.circle_id is null or c.status in ('active', 'archived'))
            )
          )
          order by n.created_at desc, n.id desc
        )
        from (
          select *
          from public.forum_notifications
          where user_id = p_user_id
            and (
              actor_user_id is null
              or not public.forum_users_blocked(p_user_id, actor_user_id)
            )
          order by created_at desc, id desc
          limit v_limit
        ) n
        left join public.forum_posts p on p.id = n.post_id
        left join public.forum_comments cm on cm.id = n.comment_id
        left join public.forum_study_circles c on c.id = n.circle_id
      ), '[]'::jsonb)
    );

  elsif v_operation = 'blocks' then
    return coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'memberId', s.public_id,
          'displayName', case
            when nullif(btrim(p.display_name), '') is null
              or position('@' in p.display_name) > 0 then 'Due Diligence Member'
            else btrim(p.display_name)
          end
        )
        order by b.created_at desc
      )
      from public.forum_user_blocks b
      join public.profiles p on p.id = b.blocked_user_id
      join public.forum_profile_settings s on s.user_id = b.blocked_user_id
      where b.blocker_user_id = p_user_id
    ), '[]'::jsonb);

  elsif v_operation = 'profile' then
    select user_id into v_member_user_id
    from public.forum_profile_settings
    where public_id = coalesce(v_payload->>'memberId', (
      select public_id from public.forum_profile_settings where user_id = p_user_id
    ));
    if v_member_user_id is null
      or public.forum_users_blocked(p_user_id, v_member_user_id)
    then
      raise exception 'FORUM_MEMBER_NOT_FOUND';
    end if;
    v_result := public.forum_safe_profile(p_user_id, v_member_user_id);
    if v_result is null then raise exception 'FORUM_MEMBER_NOT_FOUND'; end if;
    return v_result || jsonb_build_object(
      'settings', case when v_member_user_id = p_user_id then (
        select jsonb_build_object(
          'profilePublic', s.profile_public,
          'showSchool', s.show_school,
          'showYear', s.show_year
        )
        from public.forum_profile_settings s
        where s.user_id = p_user_id
      ) else null end,
      'counts', jsonb_build_object(
        'entries', (
          select count(*) from public.forum_posts p
          where p.author_user_id = v_member_user_id
            and public.forum_post_is_visible(p_user_id, p.id)
        ),
        'circles', (
          select count(*) from public.forum_circle_members m
          join public.forum_study_circles c on c.id = m.circle_id
          where m.user_id = v_member_user_id
            and m.left_at is null
            and c.status in ('active', 'archived')
        )
      )
    );

  elsif v_operation = 'search' then
    if char_length(v_query) < 2 then raise exception 'FORUM_SEARCH_INVALID'; end if;
    return jsonb_build_object(
      'entries', public.forum_quorum_query(
        p_user_id,
        'feed',
        v_payload || jsonb_build_object('query', v_query, 'limit', v_limit)
      ),
      'circles', (
        public.forum_quorum_query(
          p_user_id,
          'circles',
          jsonb_build_object('query', v_query, 'limit', least(v_limit, 10))
        )->'items'
      ),
      'profiles', coalesce((
        select jsonb_agg(profile)
        from (
          select public.forum_safe_profile(p_user_id, p.id) as profile
          from public.profiles p
          join public.forum_profile_settings s on s.user_id = p.id
          where s.profile_public
            and p.display_name ilike '%' || v_query || '%'
            and not public.forum_users_blocked(p_user_id, p.id)
          order by p.display_name asc
          limit least(v_limit, 10)
        ) matched
        where profile is not null
      ), '[]'::jsonb)
    );

  elsif v_operation = 'active_issues' then
    return coalesce((
      select jsonb_agg(public.forum_render_entry(p_user_id, ranked.id, null))
      from (
        select p.id,
          (
            (select count(*) from public.forum_reactions r where r.post_id = p.id)
            + (select count(*) * 2 from public.forum_comments c
               where c.post_id = p.id and c.deleted_at is null
                 and c.moderation_status = 'visible')
            + (select count(*) from public.forum_reposts x
               where x.original_post_id = p.id and x.deleted_at is null)
          ) as engagement
        from public.forum_posts p
        where p.created_at >= now() - interval '30 days'
          and public.forum_post_is_visible(p_user_id, p.id)
        order by engagement desc, p.created_at desc, p.id desc
        limit least(v_limit, 5)
      ) ranked
    ), '[]'::jsonb);

  else
    raise exception 'FORUM_QUERY_INVALID';
  end if;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'FORUM_QUERY_INVALID';
end;
$$;

revoke all on function public.forum_quorum_query(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.forum_quorum_query(uuid, text, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- Authenticated Quorum mutations
-- ---------------------------------------------------------------------------

create or replace function public.forum_quorum_command(
  p_user_id uuid,
  p_operation text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation text := lower(btrim(coalesce(p_operation, '')));
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_body text := btrim(coalesce(v_payload->>'body', ''));
  v_source_url text := nullif(btrim(coalesce(v_payload->>'sourceUrl', '')), '');
  v_entry_type text := lower(btrim(coalesce(v_payload->>'entryType', '')));
  v_subject text := nullif(btrim(coalesce(v_payload->>'subject', '')), '');
  v_category text := nullif(lower(btrim(coalesce(v_payload->>'category', ''))), '');
  v_year text := nullif(btrim(coalesce(v_payload->>'lawSchoolYear', '')), '');
  v_case_title text := nullif(btrim(coalesce(v_payload->>'caseTitle', '')), '');
  v_reason text := nullif(btrim(coalesce(v_payload->>'reason', '')), '');
  v_post_id uuid;
  v_comment_id uuid;
  v_parent_comment_id uuid;
  v_circle_id uuid;
  v_member_user_id uuid;
  v_notification_id uuid;
  v_repost_id uuid;
  v_author_user_id uuid;
  v_target_user_id uuid;
  v_public_id text;
  v_path text;
  v_count bigint;
  v_enabled boolean;
  v_was_enabled boolean;
  v_status text;
begin
  perform public.forum_assert_member(p_user_id);
  insert into public.forum_profile_settings (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'FORUM_COMMAND_INVALID';
  end if;

  if v_operation in ('create_entry', 'update_entry') then
    perform public.forum_assert_can_publish(p_user_id);
    if char_length(v_body) not between 1 and 4000 then
      raise exception 'FORUM_POST_INVALID';
    end if;
    if v_body ~* '[^[:space:]@]+@[^[:space:]@]+\.[[:alpha:]]{2,}' then
      raise exception 'FORUM_PRIVATE_CONTACT';
    end if;
    if v_entry_type not in (
      'ask_community', 'discuss_legal_issue', 'share_case_note',
      'request_study_help', 'share_resource', 'student_support',
      'school_bar_announcement'
    ) then
      raise exception 'FORUM_ENTRY_TYPE_INVALID';
    end if;
    if v_subject is not null and v_subject not in (
      'Political Law', 'Labor Law', 'Civil Law', 'Taxation Law',
      'Mercantile Law', 'Criminal Law', 'Remedial Law', 'Legal Ethics'
    ) then
      raise exception 'FORUM_SUBJECT_INVALID';
    end if;
    if v_category not in (
      'philippine_legal_education', 'philippine_jurisprudence',
      'bar_examination', 'law_school_life', 'career_internship',
      'student_support', 'comparative_law'
    ) then
      raise exception 'FORUM_CATEGORY_INVALID';
    end if;
    if v_entry_type in ('discuss_legal_issue', 'share_case_note')
      and v_subject is null
    then
      raise exception 'FORUM_SUBJECT_REQUIRED';
    end if;
    if v_entry_type = 'share_case_note'
      and (v_case_title is null or char_length(v_case_title) > 300)
    then
      raise exception 'FORUM_CASE_TITLE_REQUIRED';
    end if;
    if char_length(coalesce(v_year, '')) > 80 then
      raise exception 'FORUM_YEAR_INVALID';
    end if;
    if v_source_url is not null and (
      char_length(v_source_url) > 2000
      or v_source_url !~* '^https?://'
      or v_source_url ~* '^https?://[^/]*@'
    ) then
      raise exception 'FORUM_SOURCE_URL_INVALID';
    end if;

    if nullif(v_payload->>'circleId', '') is not null then
      select id into v_circle_id
      from public.forum_study_circles
      where public_id = v_payload->>'circleId' and status = 'active';
      if v_circle_id is null then raise exception 'FORUM_CIRCLE_NOT_FOUND'; end if;
      if not exists (
        select 1 from public.forum_circle_members
        where circle_id = v_circle_id
          and user_id = p_user_id
          and left_at is null
      ) then
        raise exception 'FORUM_CIRCLE_MEMBERSHIP_REQUIRED';
      end if;
    end if;
  end if;

  if v_operation = 'create_entry' then
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

    insert into public.forum_posts (
      author_user_id,
      body,
      source_url,
      entry_type,
      subject,
      category,
      law_school_year,
      case_title,
      opinion_only,
      publication_status,
      circle_id
    )
    values (
      p_user_id,
      v_body,
      v_source_url,
      v_entry_type,
      v_subject,
      v_category,
      v_year,
      v_case_title,
      coalesce(v_payload->>'opinionOnly', 'false') = 'true',
      case when v_entry_type = 'school_bar_announcement'
        then 'pending' else 'published' end,
      v_circle_id
    )
    returning id, public_id, publication_status
    into v_post_id, v_public_id, v_status;

    if v_circle_id is not null and v_status = 'published' then
      insert into public.forum_notifications (
        user_id, actor_user_id, notification_type, post_id, circle_id
      )
      select m.user_id, p_user_id, 'circle_activity', v_post_id, v_circle_id
      from public.forum_circle_members m
      where m.circle_id = v_circle_id
        and m.left_at is null
        and m.user_id <> p_user_id
        and not public.forum_users_blocked(m.user_id, p_user_id)
      order by m.joined_at desc
      limit 100;
    end if;

    return jsonb_build_object(
      'entryId', v_public_id,
      'publicationStatus', v_status,
      'message', case when v_status = 'pending'
        then 'This announcement is awaiting moderator approval.'
        else 'Entry published in Quorum.'
      end
    );

  elsif v_operation = 'update_entry' then
    select id, author_user_id into v_post_id, v_author_user_id
    from public.forum_posts
    where public_id = v_payload->>'entryId'
    for update;
    if v_post_id is null then raise exception 'FORUM_POST_NOT_FOUND'; end if;
    if v_author_user_id <> p_user_id then raise exception 'FORUM_OWNERSHIP_REQUIRED'; end if;
    perform public.forum_enforce_action_limit(
      p_user_id, 'post_edit', 20, interval '10 minutes'
    );
    update public.forum_posts
    set body = v_body,
        source_url = v_source_url,
        entry_type = v_entry_type,
        subject = v_subject,
        category = v_category,
        law_school_year = v_year,
        case_title = v_case_title,
        opinion_only = coalesce(v_payload->>'opinionOnly', 'false') = 'true',
        publication_status = case
          when v_entry_type = 'school_bar_announcement' then 'pending'
          else 'published'
        end,
        updated_at = now(),
        edited_at = now()
    where id = v_post_id
      and deleted_at is null
      and moderation_status = 'visible';
    if not found then raise exception 'FORUM_POST_NOT_EDITABLE'; end if;
    return jsonb_build_object('entryId', v_payload->>'entryId', 'edited', true);

  elsif v_operation = 'delete_entry' then
    select p.id, p.author_user_id, a.object_path
    into v_post_id, v_author_user_id, v_path
    from public.forum_posts p
    left join public.forum_post_attachments a
      on a.post_id = p.id and a.deleted_at is null
    where p.public_id = v_payload->>'entryId'
    for update of p;
    if v_post_id is null then raise exception 'FORUM_POST_NOT_FOUND'; end if;
    if v_author_user_id <> p_user_id then raise exception 'FORUM_OWNERSHIP_REQUIRED'; end if;
    update public.forum_posts
    set deleted_at = coalesce(deleted_at, now()), updated_at = now()
    where id = v_post_id;
    update public.forum_post_attachments
    set deleted_at = coalesce(deleted_at, now())
    where post_id = v_post_id;
    return jsonb_build_object(
      'entryId', v_payload->>'entryId',
      'deleted', true,
      'imagePath', v_path
    );

  elsif v_operation = 'set_helpful' then
    select id, author_user_id into v_post_id, v_author_user_id
    from public.forum_posts
    where public_id = v_payload->>'entryId';
    if v_post_id is null
      or not public.forum_post_is_visible(p_user_id, v_post_id)
    then raise exception 'FORUM_POST_NOT_FOUND'; end if;
    if jsonb_typeof(v_payload->'enabled') <> 'boolean' then
      raise exception 'FORUM_REACTION_INVALID';
    end if;
    v_enabled := (v_payload->>'enabled')::boolean;
    perform public.forum_enforce_action_limit(
      p_user_id, 'reaction_toggle', 60, interval '10 minutes'
    );
    perform pg_advisory_xact_lock(
      hashtextextended(v_post_id::text || ':' || p_user_id::text, 0)
    );
    select exists (
      select 1 from public.forum_reactions
      where post_id = v_post_id and user_id = p_user_id
    ) into v_was_enabled;
    if v_enabled then
      insert into public.forum_reactions (post_id, user_id)
      values (v_post_id, p_user_id)
      on conflict (post_id, user_id) do nothing;
      if not v_was_enabled then
        perform public.forum_create_notification(
          v_author_user_id, p_user_id, 'helpful', v_post_id
        );
      end if;
    else
      delete from public.forum_reactions
      where post_id = v_post_id and user_id = p_user_id;
    end if;
    select count(*) into v_count
    from public.forum_reactions where post_id = v_post_id;
    return jsonb_build_object('enabled', v_enabled, 'count', v_count);

  elsif v_operation = 'create_comment' then
    perform public.forum_assert_can_publish(p_user_id);
    if char_length(v_body) not between 1 and 2000 then
      raise exception 'FORUM_COMMENT_INVALID';
    end if;
    if v_body ~* '[^[:space:]@]+@[^[:space:]@]+\.[[:alpha:]]{2,}' then
      raise exception 'FORUM_PRIVATE_CONTACT';
    end if;
    select id, author_user_id into v_post_id, v_author_user_id
    from public.forum_posts
    where public_id = v_payload->>'entryId'
      and comments_locked_at is null;
    if v_post_id is null
      or not public.forum_post_is_visible(p_user_id, v_post_id)
    then raise exception 'FORUM_POST_NOT_FOUND_OR_LOCKED'; end if;
    if nullif(v_payload->>'parentCommentId', '') is not null then
      select id, author_user_id into v_parent_comment_id, v_target_user_id
      from public.forum_comments
      where public_id = v_payload->>'parentCommentId'
        and post_id = v_post_id
        and parent_comment_id is null
        and deleted_at is null
        and moderation_status = 'visible';
      if v_parent_comment_id is null then raise exception 'FORUM_COMMENT_NOT_FOUND'; end if;
      if public.forum_users_blocked(p_user_id, v_target_user_id) then
        raise exception 'FORUM_MEMBER_NOT_FOUND';
      end if;
    end if;
    perform public.forum_enforce_action_limit(
      p_user_id, 'comment_create', 20, interval '10 minutes'
    );
    if exists (
      select 1 from public.forum_comments
      where post_id = v_post_id
        and author_user_id = p_user_id
        and parent_comment_id is not distinct from v_parent_comment_id
        and lower(btrim(body)) = lower(v_body)
        and created_at >= now() - interval '1 minute'
        and deleted_at is null
    ) then
      raise exception 'FORUM_DUPLICATE_COMMENT';
    end if;
    insert into public.forum_comments (
      post_id, author_user_id, body, parent_comment_id
    )
    values (v_post_id, p_user_id, v_body, v_parent_comment_id)
    returning id, public_id into v_comment_id, v_public_id;
    if v_parent_comment_id is not null then
      perform public.forum_create_notification(
        v_target_user_id, p_user_id, 'comment_reply',
        v_post_id, v_comment_id
      );
    else
      perform public.forum_create_notification(
        v_author_user_id, p_user_id, 'entry_comment',
        v_post_id, v_comment_id
      );
    end if;
    return jsonb_build_object(
      'commentId', v_public_id,
      'created', true
    );

  elsif v_operation = 'update_comment' then
    perform public.forum_assert_can_publish(p_user_id);
    if char_length(v_body) not between 1 and 2000
      or v_body ~* '[^[:space:]@]+@[^[:space:]@]+\.[[:alpha:]]{2,}'
    then raise exception 'FORUM_COMMENT_INVALID'; end if;
    select id, author_user_id into v_comment_id, v_author_user_id
    from public.forum_comments
    where public_id = v_payload->>'commentId'
    for update;
    if v_comment_id is null then raise exception 'FORUM_COMMENT_NOT_FOUND'; end if;
    if v_author_user_id <> p_user_id then raise exception 'FORUM_OWNERSHIP_REQUIRED'; end if;
    perform public.forum_enforce_action_limit(
      p_user_id, 'comment_edit', 30, interval '10 minutes'
    );
    update public.forum_comments
    set body = v_body, updated_at = now(), edited_at = now()
    where id = v_comment_id
      and deleted_at is null
      and moderation_status = 'visible';
    if not found then raise exception 'FORUM_COMMENT_NOT_EDITABLE'; end if;
    return jsonb_build_object(
      'commentId', v_payload->>'commentId',
      'edited', true
    );

  elsif v_operation = 'delete_comment' then
    select id, author_user_id into v_comment_id, v_author_user_id
    from public.forum_comments
    where public_id = v_payload->>'commentId'
    for update;
    if v_comment_id is null then raise exception 'FORUM_COMMENT_NOT_FOUND'; end if;
    if v_author_user_id <> p_user_id then raise exception 'FORUM_OWNERSHIP_REQUIRED'; end if;
    update public.forum_comments
    set deleted_at = coalesce(deleted_at, now()), updated_at = now()
    where id = v_comment_id;
    return jsonb_build_object(
      'commentId', v_payload->>'commentId',
      'deleted', true
    );

  elsif v_operation = 'create_repost' then
    perform public.forum_assert_can_publish(p_user_id);
    select id, author_user_id into v_post_id, v_author_user_id
    from public.forum_posts
    where public_id = v_payload->>'entryId';
    if v_post_id is null
      or not public.forum_post_is_visible(p_user_id, v_post_id)
    then raise exception 'FORUM_POST_NOT_FOUND'; end if;
    if char_length(v_body) > 1000
      or v_body ~* '[^[:space:]@]+@[^[:space:]@]+\.[[:alpha:]]{2,}'
    then raise exception 'FORUM_REPOST_INVALID'; end if;
    perform public.forum_enforce_action_limit(
      p_user_id, 'repost_create', 10, interval '10 minutes'
    );
    if exists (
      select 1 from public.forum_reposts
      where original_post_id = v_post_id
        and user_id = p_user_id
        and deleted_at is null
    ) then raise exception 'FORUM_DUPLICATE_REPOST'; end if;
    insert into public.forum_reposts (
      original_post_id, user_id, commentary
    )
    values (v_post_id, p_user_id, nullif(v_body, ''))
    returning id, public_id into v_repost_id, v_public_id;
    perform public.forum_create_notification(
      v_author_user_id, p_user_id, 'repost', v_post_id
    );
    select count(*) into v_count
    from public.forum_reposts
    where original_post_id = v_post_id and deleted_at is null;
    return jsonb_build_object(
      'citationId', v_public_id,
      'count', v_count,
      'created', true
    );

  elsif v_operation = 'delete_repost' then
    select id, user_id into v_repost_id, v_author_user_id
    from public.forum_reposts
    where public_id = v_payload->>'citationId'
    for update;
    if v_repost_id is null then raise exception 'FORUM_REPOST_NOT_FOUND'; end if;
    if v_author_user_id <> p_user_id then raise exception 'FORUM_OWNERSHIP_REQUIRED'; end if;
    update public.forum_reposts
    set deleted_at = coalesce(deleted_at, now())
    where id = v_repost_id;
    return jsonb_build_object(
      'citationId', v_payload->>'citationId',
      'deleted', true
    );

  elsif v_operation = 'set_saved' then
    select id into v_post_id
    from public.forum_posts
    where public_id = v_payload->>'entryId';
    if v_post_id is null
      or not public.forum_post_is_visible(p_user_id, v_post_id)
    then raise exception 'FORUM_POST_NOT_FOUND'; end if;
    if jsonb_typeof(v_payload->'enabled') <> 'boolean' then
      raise exception 'FORUM_SAVE_INVALID';
    end if;
    v_enabled := (v_payload->>'enabled')::boolean;
    perform public.forum_enforce_action_limit(
      p_user_id, 'save_toggle', 60, interval '10 minutes'
    );
    if v_enabled then
      insert into public.forum_saved_entries (user_id, post_id)
      values (p_user_id, v_post_id)
      on conflict (user_id, post_id) do nothing;
    else
      delete from public.forum_saved_entries
      where user_id = p_user_id and post_id = v_post_id;
    end if;
    return jsonb_build_object('enabled', v_enabled);

  elsif v_operation = 'create_report' then
    if v_payload->>'targetType' not in ('entry', 'comment', 'circle') then
      raise exception 'FORUM_REPORT_INVALID';
    end if;
    if v_payload->>'category' not in (
      'harassment', 'misinformation', 'unsafe_link', 'spam', 'privacy',
      'sexual_content', 'unlawful_content', 'fundraising_spam',
      'unauthorized_advertising', 'copyright', 'impersonation',
      'academic_dishonesty', 'other'
    ) then raise exception 'FORUM_REPORT_INVALID'; end if;
    if char_length(coalesce(v_payload->>'explanation', '')) > 1000 then
      raise exception 'FORUM_REPORT_INVALID';
    end if;
    if v_payload->>'targetType' = 'entry' then
      select id into v_post_id from public.forum_posts
      where public_id = v_payload->>'targetId';
      if v_post_id is null
        or not public.forum_post_is_visible(p_user_id, v_post_id)
      then raise exception 'FORUM_POST_NOT_FOUND'; end if;
    elsif v_payload->>'targetType' = 'comment' then
      select c.id, c.post_id into v_comment_id, v_post_id
      from public.forum_comments c
      where c.public_id = v_payload->>'targetId'
        and c.deleted_at is null
        and c.moderation_status = 'visible';
      if v_comment_id is null
        or not public.forum_post_is_visible(p_user_id, v_post_id)
      then raise exception 'FORUM_COMMENT_NOT_FOUND'; end if;
    else
      select id into v_circle_id from public.forum_study_circles
      where public_id = v_payload->>'targetId'
        and status in ('active', 'archived');
      if v_circle_id is null then raise exception 'FORUM_CIRCLE_NOT_FOUND'; end if;
    end if;
    perform public.forum_enforce_action_limit(
      p_user_id, 'report_create', 10, interval '1 hour'
    );
    begin
      insert into public.forum_reports (
        reporter_user_id,
        target_type,
        target_post_id,
        target_comment_id,
        target_circle_id,
        category,
        explanation
      )
      values (
        p_user_id,
        case when v_payload->>'targetType' = 'entry'
          then 'post' else v_payload->>'targetType' end,
        case when v_payload->>'targetType' = 'entry' then v_post_id else null end,
        case when v_payload->>'targetType' = 'comment' then v_comment_id else null end,
        case when v_payload->>'targetType' = 'circle' then v_circle_id else null end,
        v_payload->>'category',
        nullif(btrim(coalesce(v_payload->>'explanation', '')), '')
      )
      returning id into v_notification_id;
    exception when unique_violation then
      raise exception 'FORUM_DUPLICATE_REPORT';
    end;
    return jsonb_build_object('reported', true);

  elsif v_operation = 'set_block' then
    select user_id into v_member_user_id
    from public.forum_profile_settings
    where public_id = v_payload->>'memberId';
    if v_member_user_id is null then raise exception 'FORUM_MEMBER_NOT_FOUND'; end if;
    if v_member_user_id = p_user_id then raise exception 'FORUM_BLOCK_SELF_INVALID'; end if;
    if jsonb_typeof(v_payload->'enabled') <> 'boolean' then
      raise exception 'FORUM_BLOCK_INVALID';
    end if;
    v_enabled := (v_payload->>'enabled')::boolean;
    perform public.forum_enforce_action_limit(
      p_user_id, 'block_toggle', 30, interval '1 hour'
    );
    if v_enabled then
      insert into public.forum_user_blocks (blocker_user_id, blocked_user_id)
      values (p_user_id, v_member_user_id)
      on conflict (blocker_user_id, blocked_user_id) do nothing;
    else
      delete from public.forum_user_blocks
      where blocker_user_id = p_user_id
        and blocked_user_id = v_member_user_id;
    end if;
    return jsonb_build_object('enabled', v_enabled);

  elsif v_operation = 'create_circle' then
    perform public.forum_assert_can_publish(p_user_id);
    if char_length(btrim(coalesce(v_payload->>'name', ''))) not between 3 and 100
      or char_length(btrim(coalesce(v_payload->>'description', ''))) not between 10 and 1000
      or char_length(btrim(coalesce(v_payload->>'rules', ''))) not between 10 and 2000
    then raise exception 'FORUM_CIRCLE_INVALID'; end if;
    if v_subject is not null and v_subject not in (
      'Political Law', 'Labor Law', 'Civil Law', 'Taxation Law',
      'Mercantile Law', 'Criminal Law', 'Remedial Law', 'Legal Ethics'
    ) then raise exception 'FORUM_SUBJECT_INVALID'; end if;
    if char_length(coalesce(v_payload->>'school', '')) > 200
      or coalesce(v_payload->>'school', '') like '%@%'
    then raise exception 'FORUM_CIRCLE_INVALID'; end if;
    perform public.forum_enforce_action_limit(
      p_user_id, 'circle_create', 3, interval '24 hours'
    );
    insert into public.forum_study_circles (
      owner_user_id, name, description, subject, school, rules
    )
    values (
      p_user_id,
      btrim(v_payload->>'name'),
      btrim(v_payload->>'description'),
      v_subject,
      nullif(btrim(coalesce(v_payload->>'school', '')), ''),
      btrim(v_payload->>'rules')
    )
    returning id, public_id into v_circle_id, v_public_id;
    insert into public.forum_circle_members (
      circle_id, user_id, member_role
    )
    values (v_circle_id, p_user_id, 'owner');
    return jsonb_build_object(
      'circleId', v_public_id,
      'created', true
    );

  elsif v_operation = 'join_circle' then
    perform public.forum_assert_can_publish(p_user_id);
    select id, owner_user_id into v_circle_id, v_author_user_id
    from public.forum_study_circles
    where public_id = v_payload->>'circleId' and status = 'active';
    if v_circle_id is null then raise exception 'FORUM_CIRCLE_NOT_FOUND'; end if;
    if public.forum_users_blocked(p_user_id, v_author_user_id) then
      raise exception 'FORUM_CIRCLE_NOT_FOUND';
    end if;
    perform public.forum_enforce_action_limit(
      p_user_id, 'circle_membership', 20, interval '1 hour'
    );
    insert into public.forum_circle_members (
      circle_id, user_id, member_role, joined_at, left_at
    )
    values (v_circle_id, p_user_id, 'member', now(), null)
    on conflict (circle_id, user_id) do update
    set left_at = null,
        joined_at = now(),
        member_role = case
          when forum_circle_members.member_role = 'owner' then 'owner'
          else 'member'
        end;
    perform public.forum_create_notification(
      v_author_user_id, p_user_id, 'circle_activity',
      null, null, v_circle_id
    );
    return jsonb_build_object('joined', true);

  elsif v_operation = 'leave_circle' then
    select c.id, c.owner_user_id, c.status
    into v_circle_id, v_author_user_id, v_status
    from public.forum_study_circles c
    where c.public_id = v_payload->>'circleId'
    for update;
    if v_circle_id is null then raise exception 'FORUM_CIRCLE_NOT_FOUND'; end if;
    if v_author_user_id = p_user_id and v_status = 'active' then
      raise exception 'FORUM_CIRCLE_OWNER_MUST_ARCHIVE';
    end if;
    perform public.forum_enforce_action_limit(
      p_user_id, 'circle_membership', 20, interval '1 hour'
    );
    update public.forum_circle_members
    set left_at = now()
    where circle_id = v_circle_id
      and user_id = p_user_id
      and left_at is null;
    if not found then raise exception 'FORUM_CIRCLE_MEMBERSHIP_REQUIRED'; end if;
    return jsonb_build_object('joined', false);

  elsif v_operation = 'archive_circle' then
    select id, owner_user_id into v_circle_id, v_author_user_id
    from public.forum_study_circles
    where public_id = v_payload->>'circleId'
    for update;
    if v_circle_id is null then raise exception 'FORUM_CIRCLE_NOT_FOUND'; end if;
    if v_author_user_id <> p_user_id then raise exception 'FORUM_OWNERSHIP_REQUIRED'; end if;
    update public.forum_study_circles
    set status = 'archived', archived_at = now(), updated_at = now()
    where id = v_circle_id and status = 'active';
    return jsonb_build_object('archived', true);

  elsif v_operation = 'update_profile_settings' then
    if jsonb_typeof(v_payload->'profilePublic') <> 'boolean'
      or jsonb_typeof(v_payload->'showSchool') <> 'boolean'
      or jsonb_typeof(v_payload->'showYear') <> 'boolean'
    then raise exception 'FORUM_PROFILE_INVALID'; end if;
    perform public.forum_enforce_action_limit(
      p_user_id, 'profile_update', 20, interval '1 hour'
    );
    update public.forum_profile_settings
    set profile_public = (v_payload->>'profilePublic')::boolean,
        show_school = (v_payload->>'showSchool')::boolean,
        show_year = (v_payload->>'showYear')::boolean,
        updated_at = now()
    where user_id = p_user_id;
    return jsonb_build_object('updated', true);

  elsif v_operation = 'mark_notification' then
    select id into v_notification_id
    from public.forum_notifications
    where public_id = v_payload->>'notificationId'
      and user_id = p_user_id
    for update;
    if v_notification_id is null then raise exception 'FORUM_NOTIFICATION_NOT_FOUND'; end if;
    perform public.forum_enforce_action_limit(
      p_user_id, 'notification_update', 120, interval '10 minutes'
    );
    update public.forum_notifications
    set read_at = coalesce(read_at, now())
    where id = v_notification_id;
    return jsonb_build_object('read', true);

  elsif v_operation = 'mark_all_notifications' then
    perform public.forum_enforce_action_limit(
      p_user_id, 'notification_update', 120, interval '10 minutes'
    );
    update public.forum_notifications
    set read_at = now()
    where user_id = p_user_id and read_at is null;
    get diagnostics v_count = row_count;
    return jsonb_build_object('read', true, 'count', v_count);

  elsif v_operation = 'register_attachment' then
    select id, author_user_id into v_post_id, v_author_user_id
    from public.forum_posts
    where public_id = v_payload->>'entryId'
      and deleted_at is null
    for update;
    if v_post_id is null then raise exception 'FORUM_POST_NOT_FOUND'; end if;
    if v_author_user_id <> p_user_id then raise exception 'FORUM_OWNERSHIP_REQUIRED'; end if;
    v_path := btrim(coalesce(v_payload->>'objectPath', ''));
    if v_path !~ ('^entries/' || (v_payload->>'entryId')
      || '/[a-f0-9]{24}\.(jpg|png|webp)$')
      or v_payload->>'mimeType' not in ('image/jpeg', 'image/png', 'image/webp')
      or coalesce((v_payload->>'byteSize')::integer, 0) not between 1 and 3145728
    then raise exception 'FORUM_ATTACHMENT_INVALID'; end if;
    insert into public.forum_post_attachments (
      post_id, owner_user_id, object_path, mime_type, byte_size
    )
    values (
      v_post_id, p_user_id, v_path,
      v_payload->>'mimeType', (v_payload->>'byteSize')::integer
    );
    return jsonb_build_object('registered', true, 'imagePath', v_path);

  elsif v_operation = 'remove_attachment' then
    select p.id, p.author_user_id, a.object_path
    into v_post_id, v_author_user_id, v_path
    from public.forum_posts p
    join public.forum_post_attachments a
      on a.post_id = p.id and a.deleted_at is null
    where p.public_id = v_payload->>'entryId'
    for update of a;
    if v_post_id is null then raise exception 'FORUM_ATTACHMENT_NOT_FOUND'; end if;
    if v_author_user_id <> p_user_id then raise exception 'FORUM_OWNERSHIP_REQUIRED'; end if;
    update public.forum_post_attachments
    set deleted_at = now()
    where post_id = v_post_id and deleted_at is null;
    return jsonb_build_object('removed', true, 'imagePath', v_path);

  elsif v_operation = 'telemetry' then
    if v_payload->>'eventType' not in (
      'quorum_opened', 'practice_clicked', 'api_failed'
    ) then raise exception 'FORUM_TELEMETRY_INVALID'; end if;
    insert into public.forum_telemetry_events (
      user_id, event_type, subject, entry_type, result_category
    )
    values (
      p_user_id,
      v_payload->>'eventType',
      left(nullif(btrim(coalesce(v_payload->>'subject', '')), ''), 120),
      left(nullif(btrim(coalesce(v_payload->>'entryType', '')), ''), 80),
      left(nullif(btrim(coalesce(v_payload->>'resultCategory', '')), ''), 80)
    );
    return jsonb_build_object('accepted', true);

  else
    raise exception 'FORUM_COMMAND_INVALID';
  end if;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'FORUM_COMMAND_INVALID';
end;
$$;

revoke all on function public.forum_quorum_command(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.forum_quorum_command(uuid, text, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- Founder/Super Admin moderation and truthful analytics
-- ---------------------------------------------------------------------------

create or replace function public.forum_quorum_admin(
  p_actor_user_id uuid,
  p_operation text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation text := lower(btrim(coalesce(p_operation, '')));
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_action text := lower(btrim(coalesce(v_payload->>'action', '')));
  v_reason text := btrim(coalesce(v_payload->>'reason', ''));
  v_request_key text := btrim(coalesce(v_payload->>'requestId', ''));
  v_existing jsonb;
  v_from timestamptz := coalesce(
    nullif(v_payload->>'from', '')::timestamptz,
    now() - interval '30 days'
  );
  v_to timestamptz := coalesce(
    nullif(v_payload->>'to', '')::timestamptz,
    now()
  );
  v_post_id uuid;
  v_comment_id uuid;
  v_circle_id uuid;
  v_report_id uuid;
  v_restriction_id uuid;
  v_target_user_id uuid;
  v_target_resource_type text;
  v_target_resource_id text;
  v_indicator text;
  v_enabled boolean;
  v_hours integer;
  v_path text;
  v_result jsonb;
begin
  perform public.phase4_require_founder(p_actor_user_id);
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'FORUM_ADMIN_REQUEST_INVALID';
  end if;

  if v_operation = 'queue' then
    return jsonb_build_object(
      'reports', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'reportId', r.public_id,
            'targetType', case when r.target_type = 'post'
              then 'entry' else r.target_type end,
            'targetId', coalesce(p.public_id, cm.public_id, sc.public_id),
            'category', r.category,
            'explanation', r.explanation,
            'status', r.status,
            'createdAt', r.created_at,
            'content', case r.target_type
              when 'post' then p.body
              when 'comment' then cm.body
              else sc.name || E'\n' || sc.description
            end,
            'contentStatus', case r.target_type
              when 'post' then p.moderation_status
              when 'comment' then cm.moderation_status
              else sc.status
            end,
            'commentsLocked', case when r.target_type = 'post'
              then p.comments_locked_at is not null else false end,
            'author', public.forum_safe_profile(
              p_actor_user_id,
              coalesce(p.author_user_id, cm.author_user_id, sc.owner_user_id)
            ),
            'activeRestrictionId', ur.public_id,
            'restrictedUntil', ur.restricted_until
          )
          order by r.created_at asc, r.id asc
        )
        from public.forum_reports r
        left join public.forum_posts p on p.id = r.target_post_id
        left join public.forum_comments cm on cm.id = r.target_comment_id
        left join public.forum_study_circles sc on sc.id = r.target_circle_id
        left join public.forum_user_restrictions ur
          on ur.user_id = coalesce(
            p.author_user_id, cm.author_user_id, sc.owner_user_id
          )
          and ur.revoked_at is null
          and ur.restricted_until > now()
        where r.status = coalesce(nullif(v_payload->>'status', ''), 'pending')
      ), '[]'::jsonb),
      'announcements', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'entryId', p.public_id,
            'body', p.body,
            'sourceUrl', p.source_url,
            'subject', p.subject,
            'category', p.category,
            'createdAt', p.created_at,
            'author', public.forum_safe_profile(p_actor_user_id, p.author_user_id)
          )
          order by p.created_at asc, p.id asc
        )
        from public.forum_posts p
        where p.entry_type = 'school_bar_announcement'
          and p.publication_status = 'pending'
          and p.deleted_at is null
          and p.moderation_status = 'visible'
      ), '[]'::jsonb),
      'restrictions', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'restrictionId', r.public_id,
            'member', public.forum_safe_profile(p_actor_user_id, r.user_id),
            'restrictedUntil', r.restricted_until,
            'reason', r.reason,
            'createdAt', r.created_at
          )
          order by r.restricted_until asc
        )
        from public.forum_user_restrictions r
        where r.revoked_at is null and r.restricted_until > now()
      ), '[]'::jsonb)
    );

  elsif v_operation = 'analytics' then
    if v_to <= v_from or v_to - v_from > interval '366 days' then
      raise exception 'FORUM_ADMIN_DATE_RANGE_INVALID';
    end if;
    return jsonb_build_object(
      'from', v_from,
      'to', v_to,
      'lastUpdatedAt', now(),
      'definitions', jsonb_build_object(
        'activeUsers', 'Distinct authenticated members who created an entry, comment, Helpful reaction, citation, save, or circle membership in the selected period.',
        'entries', 'Entries created in the selected period, including pending or later moderated entries.',
        'commentsReplies', 'Comments and one-level replies created in the selected period.',
        'helpful', 'Helpful reaction records created in the selected period.',
        'citations', 'Completed internal reposts created in the selected period.',
        'saves', 'Private saved-authority records created in the selected period.',
        'circles', 'Study Circles created in the selected period.',
        'reports', 'Community reports created in the selected period.',
        'moderationActions', 'Audited Quorum content-management actions in the selected period.',
        'unansweredQuestions', 'Visible Ask the Community or Request Study Help entries with no visible comments at the end of the selected period.',
        'practiceConversions', 'Recorded contextual Practice this issue clicks in the selected period.',
        'failedRequests', 'Privacy-safe Quorum API failure telemetry in the selected period.'
      ),
      'metrics', jsonb_build_object(
        'activeUsers', (
          select count(distinct user_id)
          from (
            select author_user_id as user_id, created_at from public.forum_posts
            union all
            select author_user_id, created_at from public.forum_comments
            union all
            select user_id, created_at from public.forum_reactions
            union all
            select user_id, created_at from public.forum_reposts
            union all
            select user_id, created_at from public.forum_saved_entries
            union all
            select user_id, joined_at from public.forum_circle_members
          ) activity
          where created_at >= v_from and created_at < v_to
        ),
        'entries', (
          select count(*) from public.forum_posts
          where created_at >= v_from and created_at < v_to
        ),
        'commentsReplies', (
          select count(*) from public.forum_comments
          where created_at >= v_from and created_at < v_to
        ),
        'helpful', (
          select count(*) from public.forum_reactions
          where created_at >= v_from and created_at < v_to
        ),
        'citations', (
          select count(*) from public.forum_reposts
          where created_at >= v_from and created_at < v_to
        ),
        'saves', (
          select count(*) from public.forum_saved_entries
          where created_at >= v_from and created_at < v_to
        ),
        'circles', (
          select count(*) from public.forum_study_circles
          where created_at >= v_from and created_at < v_to
        ),
        'reports', (
          select count(*) from public.forum_reports
          where created_at >= v_from and created_at < v_to
        ),
        'moderationActions', (
          select count(*) from public.admin_audit_log
          where occurred_at >= v_from and occurred_at < v_to
            and action_type = 'content_management_action'
            and target_resource_type like 'forum_%'
        ),
        'unansweredQuestions', (
          select count(*) from public.forum_posts p
          where p.entry_type in ('ask_community', 'request_study_help')
            and p.created_at < v_to
            and p.deleted_at is null
            and p.moderation_status = 'visible'
            and p.publication_status = 'published'
            and not exists (
              select 1 from public.forum_comments c
              where c.post_id = p.id
                and c.created_at < v_to
                and c.deleted_at is null
                and c.moderation_status = 'visible'
            )
        ),
        'practiceConversions', (
          select count(*) from public.forum_telemetry_events
          where created_at >= v_from and created_at < v_to
            and event_type = 'practice_clicked'
        ),
        'failedRequests', (
          select count(*) from public.forum_telemetry_events
          where created_at >= v_from and created_at < v_to
            and event_type = 'api_failed'
        )
      ),
      'bySubject', coalesce((
        select jsonb_agg(jsonb_build_object(
          'label', coalesce(subject, 'Not classified'),
          'count', count
        ) order by count desc, subject)
        from (
          select subject, count(*) as count
          from public.forum_posts
          where created_at >= v_from and created_at < v_to
          group by subject
        ) grouped
      ), '[]'::jsonb),
      'byEntryType', coalesce((
        select jsonb_agg(jsonb_build_object(
          'label', entry_type,
          'count', count
        ) order by count desc, entry_type)
        from (
          select entry_type, count(*) as count
          from public.forum_posts
          where created_at >= v_from and created_at < v_to
          group by entry_type
        ) grouped
      ), '[]'::jsonb),
      'recentActivity', coalesce((
        select jsonb_agg(item order by occurred_at desc)
        from (
          select p.created_at as occurred_at,
            jsonb_build_object(
              'type', 'entry',
              'occurredAt', p.created_at,
              'entryId', p.public_id,
              'label', left(p.body, 120)
            ) as item
          from public.forum_posts p
          where p.created_at >= v_from and p.created_at < v_to
          union all
          select c.created_at,
            jsonb_build_object(
              'type', case when c.parent_comment_id is null
                then 'comment' else 'reply' end,
              'occurredAt', c.created_at,
              'commentId', c.public_id,
              'label', left(c.body, 120)
            )
          from public.forum_comments c
          where c.created_at >= v_from and c.created_at < v_to
          order by occurred_at desc
          limit 50
        ) recent
      ), '[]'::jsonb)
    );

  elsif v_operation = 'action' then
    if char_length(v_reason) not between 5 and 1000
      or v_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
    then raise exception 'FORUM_ADMIN_ACTION_INVALID'; end if;

    perform pg_advisory_xact_lock(
      hashtextextended('quorum-admin:' || v_request_key, 0)
    );
    select details into v_existing
    from public.admin_audit_log
    where actor_user_id = p_actor_user_id
      and action_type = 'content_management_action'
      and details->>'requestKey' = v_request_key
    order by occurred_at desc
    limit 1;
    if v_existing is not null then
      if v_existing->>'quorumAction' is distinct from v_action
        or v_existing->>'requestTarget' is distinct from coalesce(
          v_payload->>'targetId',
          v_payload->>'reportId',
          v_payload->>'restrictionId',
          v_payload->>'memberId',
          ''
        )
      then raise exception 'FORUM_ADMIN_REQUEST_KEY_CONFLICT'; end if;
      return jsonb_build_object('replayed', true);
    end if;

    if v_action in (
      'approve_announcement', 'reject_announcement',
      'hide_entry', 'restore_entry', 'remove_entry',
      'lock_comments', 'unlock_comments',
      'set_indicator'
    ) then
      select id, author_user_id into v_post_id, v_target_user_id
      from public.forum_posts
      where public_id = v_payload->>'targetId'
      for update;
      if v_post_id is null then raise exception 'FORUM_POST_NOT_FOUND'; end if;
      v_target_resource_type := 'forum_post';
      v_target_resource_id := v_payload->>'targetId';
    elsif v_action in ('hide_comment', 'restore_comment', 'remove_comment') then
      select id, author_user_id into v_comment_id, v_target_user_id
      from public.forum_comments
      where public_id = v_payload->>'targetId'
      for update;
      if v_comment_id is null then raise exception 'FORUM_COMMENT_NOT_FOUND'; end if;
      v_target_resource_type := 'forum_comment';
      v_target_resource_id := v_payload->>'targetId';
    elsif v_action in ('hide_circle', 'restore_circle', 'remove_circle') then
      select id, owner_user_id into v_circle_id, v_target_user_id
      from public.forum_study_circles
      where public_id = v_payload->>'targetId'
      for update;
      if v_circle_id is null then raise exception 'FORUM_CIRCLE_NOT_FOUND'; end if;
      v_target_resource_type := 'forum_circle';
      v_target_resource_id := v_payload->>'targetId';
    elsif v_action = 'dismiss_report' then
      select id into v_report_id
      from public.forum_reports
      where public_id = v_payload->>'reportId'
      for update;
      if v_report_id is null then raise exception 'FORUM_REPORT_NOT_FOUND'; end if;
      v_target_resource_type := 'forum_report';
      v_target_resource_id := v_payload->>'reportId';
    elsif v_action = 'restrict_user' then
      select user_id into v_target_user_id
      from public.forum_profile_settings
      where public_id = v_payload->>'memberId';
      v_hours := coalesce((v_payload->>'durationHours')::integer, 0);
      if v_target_user_id is null or v_hours not between 1 and 8760 then
        raise exception 'FORUM_RESTRICTION_INVALID';
      end if;
      v_target_resource_type := 'forum_user_restriction';
      v_target_resource_id := v_payload->>'memberId';
    elsif v_action = 'remove_restriction' then
      select id, user_id into v_restriction_id, v_target_user_id
      from public.forum_user_restrictions
      where public_id = v_payload->>'restrictionId'
      for update;
      if v_restriction_id is null then raise exception 'FORUM_RESTRICTION_NOT_FOUND'; end if;
      v_target_resource_type := 'forum_user_restriction';
      v_target_resource_id := v_payload->>'restrictionId';
    elsif v_action in ('verify_profile', 'unverify_profile') then
      select user_id into v_target_user_id
      from public.forum_profile_settings
      where public_id = v_payload->>'memberId';
      if v_target_user_id is null then raise exception 'FORUM_MEMBER_NOT_FOUND'; end if;
      v_target_resource_type := 'forum_profile';
      v_target_resource_id := v_payload->>'memberId';
    else
      raise exception 'FORUM_ADMIN_ACTION_INVALID';
    end if;

    if v_action = 'approve_announcement' then
      update public.forum_posts
      set publication_status = 'published',
          moderated_at = now(),
          moderated_by = p_actor_user_id,
          moderation_reason = v_reason,
          updated_at = now()
      where id = v_post_id
        and entry_type = 'school_bar_announcement'
        and publication_status = 'pending';
      if not found then raise exception 'FORUM_ANNOUNCEMENT_NOT_PENDING'; end if;
    elsif v_action = 'reject_announcement' then
      update public.forum_posts
      set publication_status = 'rejected',
          moderated_at = now(),
          moderated_by = p_actor_user_id,
          moderation_reason = v_reason,
          updated_at = now()
      where id = v_post_id
        and entry_type = 'school_bar_announcement'
        and publication_status = 'pending';
      if not found then raise exception 'FORUM_ANNOUNCEMENT_NOT_PENDING'; end if;
    elsif v_action in ('hide_entry', 'restore_entry', 'remove_entry') then
      update public.forum_posts
      set moderation_status = case v_action
            when 'hide_entry' then 'hidden'
            when 'restore_entry' then 'visible'
            else 'removed'
          end,
          moderated_at = now(),
          moderated_by = p_actor_user_id,
          moderation_reason = v_reason,
          updated_at = now()
      where id = v_post_id;
    elsif v_action in ('hide_comment', 'restore_comment', 'remove_comment') then
      update public.forum_comments
      set moderation_status = case v_action
            when 'hide_comment' then 'hidden'
            when 'restore_comment' then 'visible'
            else 'removed'
          end,
          moderated_at = now(),
          moderated_by = p_actor_user_id,
          moderation_reason = v_reason,
          updated_at = now()
      where id = v_comment_id;
    elsif v_action in ('hide_circle', 'restore_circle', 'remove_circle') then
      update public.forum_study_circles
      set status = case v_action
            when 'hide_circle' then 'hidden'
            when 'restore_circle' then 'active'
            else 'removed'
          end,
          moderated_at = now(),
          moderated_by = p_actor_user_id,
          moderation_reason = v_reason,
          updated_at = now()
      where id = v_circle_id;
    elsif v_action = 'lock_comments' then
      update public.forum_posts
      set comments_locked_at = now(),
          comments_locked_by = p_actor_user_id,
          comments_lock_reason = v_reason,
          updated_at = now()
      where id = v_post_id;
    elsif v_action = 'unlock_comments' then
      update public.forum_posts
      set comments_locked_at = null,
          comments_locked_by = null,
          comments_lock_reason = null,
          updated_at = now()
      where id = v_post_id;
    elsif v_action = 'set_indicator' then
      v_indicator := v_payload->>'indicator';
      if v_indicator not in (
        'citation_checked', 'community_correction', 'moderator_reviewed'
      ) or jsonb_typeof(v_payload->'enabled') <> 'boolean'
      then raise exception 'FORUM_INDICATOR_INVALID'; end if;
      v_enabled := (v_payload->>'enabled')::boolean;
      if v_enabled then
        insert into public.forum_entry_indicators (
          post_id, indicator, applied_by, note
        )
        values (v_post_id, v_indicator, p_actor_user_id, v_reason)
        on conflict (post_id, indicator) do update
        set applied_by = excluded.applied_by,
            note = excluded.note,
            applied_at = now();
      else
        delete from public.forum_entry_indicators
        where post_id = v_post_id and indicator = v_indicator;
      end if;
    elsif v_action = 'dismiss_report' then
      update public.forum_reports
      set status = 'dismissed',
          reviewed_at = now(),
          reviewed_by = p_actor_user_id,
          review_reason = v_reason
      where id = v_report_id;
    elsif v_action = 'restrict_user' then
      update public.forum_user_restrictions
      set revoked_at = now(),
          revoked_by = p_actor_user_id,
          revoke_reason = 'Superseded by a new Quorum restriction.'
      where user_id = v_target_user_id and revoked_at is null;
      insert into public.forum_user_restrictions (
        user_id, restricted_until, reason, created_by
      )
      values (
        v_target_user_id,
        now() + make_interval(hours => v_hours),
        v_reason,
        p_actor_user_id
      )
      returning id, public_id into v_restriction_id, v_target_resource_id;
    elsif v_action = 'remove_restriction' then
      update public.forum_user_restrictions
      set revoked_at = now(),
          revoked_by = p_actor_user_id,
          revoke_reason = v_reason
      where id = v_restriction_id and revoked_at is null;
    elsif v_action in ('verify_profile', 'unverify_profile') then
      update public.forum_profile_settings
      set verified_academic_at = case when v_action = 'verify_profile'
            then now() else null end,
          verified_academic_by = case when v_action = 'verify_profile'
            then p_actor_user_id else null end,
          updated_at = now()
      where user_id = v_target_user_id;
    end if;

    if v_target_user_id is not null then
      perform public.forum_create_notification(
        v_target_user_id,
        p_actor_user_id,
        'moderation_decision',
        v_post_id,
        v_comment_id,
        v_circle_id
      );
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
      v_target_user_id,
      v_target_resource_type,
      v_target_resource_id,
      v_reason,
      jsonb_build_object(
        'quorumAction', v_action,
        'requestTarget', coalesce(
          v_payload->>'targetId',
          v_payload->>'reportId',
          v_payload->>'restrictionId',
          v_payload->>'memberId',
          ''
        ),
        'requestKey', v_request_key,
        'durationHours', v_hours,
        'indicator', v_indicator
      )
    );

    return jsonb_build_object(
      'replayed', false,
      'action', v_action,
      'completed', true
    );
  else
    raise exception 'FORUM_ADMIN_REQUEST_INVALID';
  end if;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'FORUM_ADMIN_REQUEST_INVALID';
end;
$$;

revoke all on function public.forum_quorum_admin(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.forum_quorum_admin(uuid, text, jsonb)
  to service_role;

comment on table public.forum_posts is
  'Authenticated Quorum entries. Legacy forum-prefixed names are intentionally retained for zero-downtime compatibility.';
comment on table public.forum_saved_entries is
  'Private Quorum saved authorities. Browser roles have no direct access.';
comment on table public.forum_telemetry_events is
  'Privacy-safe Quorum product telemetry; never stores IP, email, user-agent, content, examination answers, tokens, or secrets.';

commit;

begin;

-- Quorum aliases remain service-role-only and contain no real identity.
alter table public.forum_anonymous_aliases
  add column if not exists alias_text text;

create unique index if not exists forum_anonymous_aliases_post_text_uidx
  on public.forum_anonymous_aliases (post_id, alias_text)
  where alias_text is not null;

create or replace function public.forum_ensure_anonymous_alias(p_post_id uuid, p_user_id uuid)
returns smallint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_alias smallint;
  v_candidate text;
  v_base text;
  v_start integer;
  v_offset integer;
  v_aliases constant text[] := array[
    'Midnight Codal','Quiet Quill','Obiter Owl','Hidden Footnote','Library Lantern',
    'Gentle Dissent','Pocket Doctrine','Unnamed Amicus','Recit Survivor','Phantom Case Digest',
    'Margin Note','Silent Syllabus','Codal Compass','Velvet Bookmark','Reserved Rejoinder',
    'Late-Night Lexicon','Paper Lantern','Measured Dictum','Study Hall Echo','Careful Citation',
    'Brief Intermission','Patient Precedent','Ink and Doctrine','Quiet Majority','Golden Footnote',
    'Library Afterglow','Moot Point','Codal Cartographer','Diligent Digest','Calm Counterpoint',
    'Casebook Comet','Doctrine Drifter','Reasonable Reader','Soft-Spoken Stare Decisis','Bluebook Moon',
    'Restless Reviewer','Margin Whisper','Footnote Forty-Two','Pocket Codex','Last Page Lantern',
    'Tea and Testimony','Gentle Objection','Quiet Qualification','Library Night Shift','Case Digest Keeper',
    'Measured Minority','Study Break Solicitor','Codal Nightwatch','Page-Turner Pro Tem','Hidden Ratio',
    'Patient Petitioner','Quiet Respondent','Reserved Remark','Doctrine Daydream','Syllabus Sentinel',
    'Midnight Memorandum','Bookmark Barrister','Soft Rebuttal','Library Loophole','Footnote Forager',
    'Amicus After Hours','Codal Cloud','Reasoned Reader','Paperbound Precedent','Silent Side Note',
    'Calm Case Note','Study Lamp','Measured Maxim','Quiet Caveat','Doctrine Lantern',
    'Casebook Constellation','Page Margin','Reserved Rationale','Gentle Gloss','Footnote in Recess',
    'Codal Coffee','Library Compass','Midnight Annotation','Careful Conclusion','Quiet Question Presented'
  ];
begin
  perform pg_advisory_xact_lock(hashtextextended(p_post_id::text, 618));
  select alias_number, alias_text into v_alias, v_candidate
  from public.forum_anonymous_aliases
  where post_id = p_post_id and user_id = p_user_id;
  if v_alias is not null then return v_alias; end if;

  v_start := 1 + ((hashtextextended(p_post_id::text || ':' || p_user_id::text, 619)
    & 9223372036854775807) % array_length(v_aliases, 1))::integer;
  for v_offset in 0..array_length(v_aliases, 1) - 1 loop
    v_alias := 1 + ((v_start - 1 + v_offset) % array_length(v_aliases, 1));
    v_candidate := v_aliases[v_alias];
    if not exists (
      select 1 from public.forum_anonymous_aliases
      where post_id = p_post_id and alias_text = v_candidate
    ) and not exists (
      select 1 from public.forum_anonymous_aliases
      where user_id = p_user_id and post_id <> p_post_id and alias_text = v_candidate
    ) then
      insert into public.forum_anonymous_aliases (post_id, user_id, alias_number, alias_text)
      values (p_post_id, p_user_id, v_alias, v_candidate);
      return v_alias;
    end if;
  end loop;

  v_base := v_aliases[v_start];
  v_candidate := v_base || ' ' || upper(substr(encode(extensions.digest(p_post_id::text || p_user_id::text, 'sha256'), 'hex'), 1, 6));
  v_alias := 9000 + ((hashtextextended(v_candidate, 620) & 9223372036854775807) % 999)::smallint;
  while exists (select 1 from public.forum_anonymous_aliases where post_id = p_post_id and alias_number = v_alias) loop
    v_alias := case when v_alias >= 9998 then 9000 else v_alias + 1 end;
  end loop;
  insert into public.forum_anonymous_aliases (post_id, user_id, alias_number, alias_text)
  values (p_post_id, p_user_id, v_alias, v_candidate);
  return v_alias;
end;
$$;

create or replace function public.forum_anonymous_profile(p_post_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_alias text;
begin
  select alias_text into v_alias from public.forum_anonymous_aliases
  where post_id = p_post_id and user_id = p_user_id;
  return jsonb_build_object(
    'memberId', null,
    'displayName', coalesce(v_alias, 'Anonymous participant'),
    'school', null, 'year', null, 'verified', false,
    'anonymous', true, 'anonymousBadge', 'Anonymous', 'avatarPath', null
  );
end;
$$;

create or replace function public.forum_lock_published_identity_mode()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.is_anonymous is distinct from new.is_anonymous
     and old.created_at < transaction_timestamp() then
    raise exception 'FORUM_IDENTITY_MODE_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists forum_posts_lock_identity_mode on public.forum_posts;
create trigger forum_posts_lock_identity_mode before update of is_anonymous on public.forum_posts
for each row execute function public.forum_lock_published_identity_mode();
drop trigger if exists forum_comments_lock_identity_mode on public.forum_comments;
create trigger forum_comments_lock_identity_mode before update of is_anonymous on public.forum_comments
for each row execute function public.forum_lock_published_identity_mode();

alter table public.forum_anonymous_identity_audits
  add column if not exists target_type text,
  add column if not exists target_public_id text,
  add column if not exists comment_id uuid references public.forum_comments(id) on delete cascade;

create or replace function public.forum_resolve_anonymous_identity_v2(
  p_actor_user_id uuid,
  p_target_type text,
  p_target_public_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text := lower(btrim(coalesce(p_target_type, '')));
  v_post public.forum_posts%rowtype;
  v_comment public.forum_comments%rowtype;
  v_user_id uuid;
begin
  perform public.phase4_require_founder(p_actor_user_id);
  if v_type not in ('post', 'comment', 'reply') then raise exception 'FORUM_TARGET_TYPE_INVALID'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 1000 then raise exception 'FORUM_REASON_REQUIRED'; end if;
  if v_type = 'post' then
    select * into v_post from public.forum_posts
    where public_id = p_target_public_id and is_anonymous;
    if v_post.id is null then raise exception 'FORUM_ANONYMOUS_TARGET_NOT_FOUND'; end if;
    v_user_id := v_post.author_user_id;
  else
    select * into v_comment from public.forum_comments
    where public_id = p_target_public_id and is_anonymous
      and ((v_type = 'reply' and parent_comment_id is not null)
        or (v_type = 'comment' and parent_comment_id is null));
    if v_comment.id is null then raise exception 'FORUM_ANONYMOUS_TARGET_NOT_FOUND'; end if;
    select * into v_post from public.forum_posts where id = v_comment.post_id;
    v_user_id := v_comment.author_user_id;
  end if;
  insert into public.forum_anonymous_identity_audits (
    actor_user_id, post_id, comment_id, target_user_id, target_type,
    target_public_id, reason
  ) values (
    p_actor_user_id, v_post.id, v_comment.id, v_user_id, v_type,
    p_target_public_id, btrim(p_reason)
  );
  return jsonb_build_object('targetType', v_type, 'targetId', p_target_public_id, 'userId', v_user_id);
end;
$$;

create or replace function public.forum_quorum_admin_safe(
  p_actor_user_id uuid,
  p_operation text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  v_result := public.forum_quorum_admin(p_actor_user_id, p_operation, p_payload);
  if lower(btrim(coalesce(p_operation, ''))) = 'queue' then
    select jsonb_set(v_result, '{reports}', coalesce(jsonb_agg(
      case
        when (r.value->>'targetType') = 'entry' and p.is_anonymous then
          jsonb_set(r.value, '{author}', public.forum_anonymous_profile(p.id, p.author_user_id))
        when (r.value->>'targetType') in ('comment','reply') and c.is_anonymous then
          jsonb_set(r.value, '{author}', public.forum_anonymous_profile(c.post_id, c.author_user_id))
        else r.value
      end order by r.ordinality
    ), '[]'::jsonb)) into v_result
    from jsonb_array_elements(coalesce(v_result->'reports', '[]'::jsonb)) with ordinality r(value, ordinality)
    left join public.forum_posts p on p.public_id = r.value->>'targetId'
    left join public.forum_comments c on c.public_id = r.value->>'targetId';
  end if;
  return v_result;
end;
$$;

-- Private, revisioned study annotations. Ordinary browser roles have no direct table access.
create table if not exists public.study_annotations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_type text not null check (resource_type in ('doctrine','chair_case','anchor_case','subject_matter')),
  resource_id text not null check (char_length(btrim(resource_id)) between 1 and 240),
  note_text text not null check (char_length(note_text) <= 12000),
  selected_text text check (selected_text is null or char_length(selected_text) <= 1000),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, resource_type, resource_id)
);
alter table public.study_annotations enable row level security;
alter table public.study_annotations force row level security;
revoke all on public.study_annotations from public, anon, authenticated;
grant select, insert, update, delete on public.study_annotations to service_role;

create or replace function public.study_annotation_query(
  p_user_id uuid, p_resource_type text default null, p_resource_id text default null
)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'annotationId', id, 'resourceType', resource_type, 'resourceId', resource_id,
    'noteText', note_text, 'selectedText', selected_text, 'revision', revision,
    'updatedAt', updated_at
  ) order by updated_at desc), '[]'::jsonb)
  from public.study_annotations
  where user_id = p_user_id
    and (p_resource_type is null or resource_type = p_resource_type)
    and (p_resource_id is null or resource_id = p_resource_id);
$$;

create or replace function public.study_annotation_command(
  p_user_id uuid, p_operation text, p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type text := lower(btrim(coalesce(p_payload->>'resourceType', '')));
  v_id text := btrim(coalesce(p_payload->>'resourceId', ''));
  v_note text := coalesce(p_payload->>'noteText', '');
  v_selected text := nullif(coalesce(p_payload->>'selectedText', ''), '');
  v_expected integer := coalesce((p_payload->>'expectedRevision')::integer, 0);
  v_row public.study_annotations%rowtype;
begin
  if v_type not in ('doctrine','chair_case','anchor_case','subject_matter')
     or char_length(v_id) not between 1 and 240
     or char_length(v_note) > 12000
     or char_length(coalesce(v_selected, '')) > 1000 then
    raise exception 'STUDY_ANNOTATION_INVALID';
  end if;
  if lower(btrim(coalesce(p_operation, ''))) = 'delete' then
    delete from public.study_annotations where user_id = p_user_id
      and resource_type = v_type and resource_id = v_id
      and revision = v_expected returning * into v_row;
    if v_row.id is null then raise exception 'STUDY_ANNOTATION_CONFLICT'; end if;
    return jsonb_build_object('deleted', true, 'resourceType', v_type, 'resourceId', v_id);
  end if;
  select * into v_row from public.study_annotations where user_id = p_user_id
    and resource_type = v_type and resource_id = v_id for update;
  if v_row.id is null then
    if v_expected <> 0 then raise exception 'STUDY_ANNOTATION_CONFLICT'; end if;
    insert into public.study_annotations (user_id, resource_type, resource_id, note_text, selected_text)
    values (p_user_id, v_type, v_id, v_note, v_selected) returning * into v_row;
  elsif v_row.revision <> v_expected then
    return jsonb_build_object('conflict', true, 'server', jsonb_build_object(
      'noteText', v_row.note_text, 'selectedText', v_row.selected_text,
      'revision', v_row.revision, 'updatedAt', v_row.updated_at
    ), 'local', p_payload);
  else
    update public.study_annotations set note_text = v_note, selected_text = v_selected,
      revision = revision + 1, updated_at = now() where id = v_row.id returning * into v_row;
  end if;
  return jsonb_build_object('conflict', false, 'annotationId', v_row.id,
    'resourceType', v_row.resource_type, 'resourceId', v_row.resource_id,
    'noteText', v_row.note_text, 'selectedText', v_row.selected_text,
    'revision', v_row.revision, 'updatedAt', v_row.updated_at);
end;
$$;

revoke all on function public.forum_ensure_anonymous_alias(uuid,uuid) from public, anon, authenticated;
revoke all on function public.forum_anonymous_profile(uuid,uuid) from public, anon, authenticated;
revoke all on function public.forum_lock_published_identity_mode() from public, anon, authenticated;
revoke all on function public.forum_resolve_anonymous_identity_v2(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.forum_quorum_admin_safe(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.study_annotation_query(uuid,text,text) from public, anon, authenticated;
revoke all on function public.study_annotation_command(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.forum_ensure_anonymous_alias(uuid,uuid) to service_role;
grant execute on function public.forum_anonymous_profile(uuid,uuid) to service_role;
grant execute on function public.forum_resolve_anonymous_identity_v2(uuid,text,text,text) to service_role;
grant execute on function public.forum_quorum_admin_safe(uuid,text,jsonb) to service_role;
grant execute on function public.study_annotation_query(uuid,text,text) to service_role;
grant execute on function public.study_annotation_command(uuid,text,jsonb) to service_role;

commit;

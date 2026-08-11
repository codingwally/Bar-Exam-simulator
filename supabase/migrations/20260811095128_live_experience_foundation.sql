-- Due Diligence live-experience foundation.
-- Additive support for private Verdict history, Quorum anonymity/media, and
-- optimized member photographs. Existing grading, question, timer, and
-- entitlement objects are intentionally left unchanged.

begin;

-- ---------------------------------------------------------------------------
-- The Verdict: reversible, user-owned history visibility
-- ---------------------------------------------------------------------------

create table if not exists public.verdict_archived_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null check (
    source_type in ('legacy_grading_result', 'phase4_exam_attempt', 'examination_attempt')
  ),
  source_id uuid not null,
  deleted_at timestamptz not null default now(),
  restore_until timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  unique (user_id, source_type, source_id),
  check (restore_until >= deleted_at)
);

create index if not exists verdict_archived_records_user_idx
  on public.verdict_archived_records (user_id, deleted_at desc);

alter table public.verdict_archived_records enable row level security;
alter table public.verdict_archived_records force row level security;
revoke all on public.verdict_archived_records from public, anon, authenticated;
grant select, insert, update, delete on public.verdict_archived_records to service_role;

create or replace function public.dd2026_verdict_source_owned(
  p_user_id uuid,
  p_source_type text,
  p_source_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case p_source_type
    when 'legacy_grading_result' then exists (
      select 1
      from public.grading_results g
      join public.submissions s on s.id = g.submission_id
      where g.id = p_source_id and s.user_id = p_user_id
    )
    when 'phase4_exam_attempt' then exists (
      select 1 from public.exam_attempts a
      where a.id = p_source_id and a.user_id = p_user_id
    )
    when 'examination_attempt' then exists (
      select 1 from public.examination_attempts_multi a
      where a.id = p_source_id and a.user_id = p_user_id
    )
    else false
  end;
$$;

create or replace function public.dd2026_verdict_records(
  p_user_id uuid,
  p_include_deleted boolean default false,
  p_limit integer default 200,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
begin
  perform public.dd2026_require_user(p_user_id);

  return jsonb_build_object(
    'items', coalesce((
      with records as (
        select
          g.id as source_id,
          'legacy_grading_result'::text as source_type,
          'Mock Bar'::text as feature,
          subj.name::text as subject,
          q.id::text as question_id,
          q.question_no::text as question_number,
          q.bar_year,
          g.overall_score::numeric as score,
          s.time_spent_seconds::integer as elapsed_seconds,
          null::text as timer_mode,
          g.graded_at as occurred_at,
          'completed'::text as status,
          g.rubric_version::text as rubric_version
        from public.grading_results g
        join public.submissions s on s.id = g.submission_id
        join public.questions q on q.id = s.question_id
        join public.subjects subj on subj.id = q.subject_id
        where s.user_id = p_user_id

        union all

        select
          a.id,
          'phase4_exam_attempt',
          'Mock Bar',
          a.subject,
          a.question_bank_id,
          null::text,
          null::integer,
          a.score,
          a.elapsed_seconds,
          a.timer_mode,
          coalesce(a.completed_at, a.submitted_at),
          a.status,
          a.assessment->>'rubricVersion'
        from public.exam_attempts a
        where a.user_id = p_user_id

        union all

        select
          a.id,
          'examination_attempt',
          case d.track when 'per_subject' then 'Subject Matter' else 'Bar Feels' end,
          coalesce(d.subject, d.title),
          null::text,
          null::text,
          null::integer,
          scores.average_score,
          a.elapsed_seconds,
          a.timer_mode,
          coalesce(a.submitted_at, a.started_at),
          a.status,
          scores.rubric_version
        from public.examination_attempts_multi a
        join public.examination_versions v on v.id = a.version_id
        join public.examination_definitions d on d.id = v.exam_id
        left join lateral (
          select
            round(avg(x.score), 1) as average_score,
            max(x.assessment_json->>'rubricVersion') as rubric_version
          from public.examination_ai_assessments x
          where x.attempt_id = a.id
        ) scores on true
        where a.user_id = p_user_id
      ), visible as (
        select
          r.*,
          ar.deleted_at,
          ar.restore_until
        from records r
        left join public.verdict_archived_records ar
          on ar.user_id = p_user_id
         and ar.source_type = r.source_type
         and ar.source_id = r.source_id
        where p_include_deleted = (ar.id is not null)
           or (not p_include_deleted and ar.id is null)
      )
      select jsonb_agg(jsonb_build_object(
        'id', source_id,
        'sourceType', source_type,
        'feature', feature,
        'subject', subject,
        'questionId', question_id,
        'questionNumber', question_number,
        'barYear', bar_year,
        'score', score,
        'elapsedSeconds', elapsed_seconds,
        'timerMode', timer_mode,
        'occurredAt', occurred_at,
        'status', status,
        'rubricVersion', rubric_version,
        'deletedAt', deleted_at,
        'restoreUntil', restore_until
      ) order by occurred_at desc, source_id desc)
      from (
        select * from visible
        order by occurred_at desc, source_id desc
        limit v_limit offset v_offset
      ) page
    ), '[]'::jsonb),
    'includeDeleted', p_include_deleted,
    'limit', v_limit,
    'offset', v_offset
  );
end;
$$;

create or replace function public.dd2026_verdict_archive(
  p_user_id uuid,
  p_action text,
  p_records jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_record jsonb;
  v_source_type text;
  v_source_id uuid;
  v_count integer := 0;
begin
  perform public.dd2026_require_user(p_user_id);
  if v_action not in ('archive', 'restore')
     or jsonb_typeof(p_records) <> 'array'
     or jsonb_array_length(p_records) not between 1 and 200 then
    raise exception 'DD2026_VERDICT_ARCHIVE_INVALID';
  end if;

  for v_record in select value from jsonb_array_elements(p_records)
  loop
    v_source_type := btrim(coalesce(v_record->>'sourceType', ''));
    begin
      v_source_id := (v_record->>'id')::uuid;
    exception when others then
      raise exception 'DD2026_VERDICT_ARCHIVE_INVALID';
    end;
    if not public.dd2026_verdict_source_owned(p_user_id, v_source_type, v_source_id) then
      raise exception 'DD2026_VERDICT_RESULT_NOT_FOUND';
    end if;

    if v_action = 'archive' then
      insert into public.verdict_archived_records (
        user_id, source_type, source_id, deleted_at, restore_until
      ) values (
        p_user_id, v_source_type, v_source_id, now(), now() + interval '30 days'
      )
      on conflict (user_id, source_type, source_id) do update
      set deleted_at = excluded.deleted_at,
          restore_until = excluded.restore_until;
    else
      delete from public.verdict_archived_records
      where user_id = p_user_id
        and source_type = v_source_type
        and source_id = v_source_id
        and restore_until >= now();
      if not found then raise exception 'DD2026_VERDICT_RESTORE_UNAVAILABLE'; end if;
    end if;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('action', v_action, 'affected', v_count);
end;
$$;

alter table public.dd2026_verdict_pdf_exports
  drop constraint if exists dd2026_verdict_pdf_exports_exactly_one_result_check;
alter table public.dd2026_verdict_pdf_exports
  add column if not exists examination_attempt_id uuid
    references public.examination_attempts_multi(id) on delete restrict;
alter table public.dd2026_verdict_pdf_exports
  add constraint dd2026_verdict_pdf_exports_exactly_one_result_check
  check (num_nonnulls(grading_result_id, exam_attempt_id, examination_attempt_id) = 1);
create index if not exists dd2026_verdict_pdf_exports_multi_attempt_idx
  on public.dd2026_verdict_pdf_exports (examination_attempt_id)
  where examination_attempt_id is not null;

create or replace function public.dd2026_verdict_result(
  p_user_id uuid,
  p_grading_result_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_enabled boolean;
  v_premium_required boolean;
  v_result jsonb;
begin
  perform public.dd2026_require_user(p_user_id);
  select enabled into v_enabled from public.dd2026_feature_flags
  where flag_key = 'VERDICT_PDF_ENABLED';
  select enabled into v_premium_required from public.dd2026_feature_flags
  where flag_key = 'VERDICT_PDF_PREMIUM_REQUIRED';
  if not coalesce(v_enabled, false) then raise exception 'DD2026_VERDICT_PDF_DISABLED'; end if;
  if coalesce(v_premium_required, false) and not public.dd2026_is_premium(p_user_id) then
    raise exception 'DD2026_PREMIUM_REQUIRED';
  end if;
  if exists (
    select 1 from public.verdict_archived_records
    where user_id = p_user_id and source_id = p_grading_result_id
  ) then raise exception 'DD2026_VERDICT_RESULT_NOT_FOUND'; end if;

  select jsonb_build_object(
    'resultId', g.id, 'sourceType', 'legacy_grading_result',
    'submissionId', s.id, 'questionId', q.id, 'subject', subj.name,
    'barYear', q.bar_year, 'questionNumber', q.question_no,
    'question', q.prompt_text, 'suggestedAnswer', q.model_answer,
    'legalBasis', q.case_law, 'userAnswer', s.answer_text,
    'feedback', coalesce(g.feedback_json, '{}'::jsonb),
    'score', g.overall_score, 'passed', g.passed,
    'gradedAt', g.graded_at, 'rubricVersion', g.rubric_version
  ) into v_result
  from public.grading_results g
  join public.submissions s on s.id = g.submission_id
  join public.questions q on q.id = s.question_id
  join public.subjects subj on subj.id = q.subject_id
  where g.id = p_grading_result_id and s.user_id = p_user_id;

  if v_result is null then
    select jsonb_build_object(
      'resultId', a.id, 'sourceType', 'phase4_exam_attempt',
      'questionBankId', a.question_bank_id, 'questionId', a.question_bank_id,
      'subject', a.subject, 'question', null, 'suggestedAnswer', null,
      'userAnswer', a.answer_text, 'feedback', coalesce(a.assessment, '{}'::jsonb),
      'score', a.score, 'passed', null, 'gradedAt', a.completed_at,
      'rubricVersion', a.assessment->>'rubricVersion'
    ) into v_result
    from public.exam_attempts a
    where a.id = p_grading_result_id and a.user_id = p_user_id
      and a.status in ('completed', 'unanswered');
  end if;

  if v_result is null then
    select jsonb_build_object(
      'resultId', a.id,
      'sourceType', 'examination_attempt',
      'feature', case d.track when 'per_subject' then 'Subject Matter' else 'Bar Feels' end,
      'subject', coalesce(d.subject, d.title),
      'title', d.title,
      'userAnswer', null,
      'score', summary.average_score,
      'gradedAt', coalesce(a.submitted_at, a.started_at),
      'rubricVersion', summary.rubric_version,
      'questions', coalesce(summary.questions, '[]'::jsonb)
    ) into v_result
    from public.examination_attempts_multi a
    join public.examination_versions v on v.id = a.version_id
    join public.examination_definitions d on d.id = v.exam_id
    left join lateral (
      select
        round(avg(ai.score), 1) as average_score,
        max(ai.assessment_json->>'rubricVersion') as rubric_version,
        jsonb_agg(jsonb_build_object(
          'questionId', vq.question_id,
          'questionNumber', vq.ordinal,
          'question', vq.prompt_snapshot,
          'suggestedAnswer', vq.model_answer_snapshot,
          'legalBasis', vq.legal_basis_snapshot,
          'application', vq.application_snapshot,
          'conclusion', vq.conclusion_snapshot,
          'sources', vq.source_urls_snapshot,
          'userAnswer', coalesce(r.answer_text, ''),
          'score', ai.score,
          'feedback', coalesce(ai.assessment_json, '{}'::jsonb)
        ) order by vq.ordinal) as questions
      from public.examination_version_questions vq
      left join public.examination_responses r
        on r.attempt_id = a.id and r.question_id = vq.question_id
      left join public.examination_ai_assessments ai
        on ai.attempt_id = a.id and ai.question_id = vq.question_id
      where vq.version_id = a.version_id
    ) summary on true
    where a.id = p_grading_result_id and a.user_id = p_user_id
      and a.status in ('submitted', 'expired');
  end if;

  if v_result is null then raise exception 'DD2026_VERDICT_RESULT_NOT_FOUND'; end if;
  return v_result;
end;
$$;

create or replace function public.dd2026_record_verdict_export(
  p_user_id uuid,
  p_grading_result_id uuid,
  p_request_key text,
  p_selection_kind text,
  p_selected_ids jsonb,
  p_output_bytes integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.dd2026_verdict_pdf_exports%rowtype;
  v_legacy_id uuid;
  v_attempt_id uuid;
  v_multi_attempt_id uuid;
begin
  perform public.dd2026_verdict_result(p_user_id, p_grading_result_id);
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
    or p_selection_kind not in ('entire_result', 'sections', 'questions')
    or jsonb_typeof(p_selected_ids) <> 'array'
    or p_output_bytes not between 1 and 26214400 then
    raise exception 'DD2026_VERDICT_EXPORT_INVALID';
  end if;
  select g.id into v_legacy_id from public.grading_results g
  join public.submissions s on s.id = g.submission_id
  where g.id = p_grading_result_id and s.user_id = p_user_id;
  if v_legacy_id is null then
    select a.id into v_attempt_id from public.exam_attempts a
    where a.id = p_grading_result_id and a.user_id = p_user_id
      and a.status in ('completed', 'unanswered');
  end if;
  if v_legacy_id is null and v_attempt_id is null then
    select a.id into v_multi_attempt_id from public.examination_attempts_multi a
    where a.id = p_grading_result_id and a.user_id = p_user_id
      and a.status in ('submitted', 'expired');
  end if;
  insert into public.dd2026_verdict_pdf_exports (
    user_id, grading_result_id, exam_attempt_id, examination_attempt_id,
    request_key, selection_kind, selected_ids, output_bytes
  ) values (
    p_user_id, v_legacy_id, v_attempt_id, v_multi_attempt_id,
    p_request_key, p_selection_kind, p_selected_ids, p_output_bytes
  ) on conflict (user_id, request_key) do update
    set output_bytes = excluded.output_bytes
  returning * into v_row;
  return jsonb_build_object('exportId', v_row.id, 'createdAt', v_row.created_at);
end;
$$;

revoke all on function public.dd2026_verdict_source_owned(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.dd2026_verdict_records(uuid, boolean, integer, integer) from public, anon, authenticated;
revoke all on function public.dd2026_verdict_archive(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.dd2026_verdict_result(uuid, uuid) from public, anon, authenticated;
revoke all on function public.dd2026_record_verdict_export(uuid, uuid, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.dd2026_verdict_source_owned(uuid, text, uuid) to service_role;
grant execute on function public.dd2026_verdict_records(uuid, boolean, integer, integer) to service_role;
grant execute on function public.dd2026_verdict_archive(uuid, text, jsonb) to service_role;
grant execute on function public.dd2026_verdict_result(uuid, uuid) to service_role;
grant execute on function public.dd2026_record_verdict_export(uuid, uuid, text, text, jsonb, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Quorum: thread-safe anonymity, multiple post images, and private avatars
-- ---------------------------------------------------------------------------

alter table public.forum_posts add column if not exists is_anonymous boolean not null default false;
alter table public.forum_comments add column if not exists is_anonymous boolean not null default false;

alter table public.forum_post_attachments
  drop constraint if exists forum_post_attachments_post_id_key;
alter table public.forum_post_attachments
  add column if not exists sort_order smallint not null default 1;
alter table public.forum_post_attachments
  drop constraint if exists forum_post_attachments_sort_order_check;
alter table public.forum_post_attachments
  add constraint forum_post_attachments_sort_order_check check (sort_order between 1 and 12);
create unique index if not exists forum_post_attachments_post_order_uidx
  on public.forum_post_attachments (post_id, sort_order)
  where deleted_at is null;

create table if not exists public.forum_anonymous_aliases (
  post_id uuid not null references public.forum_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  alias_number smallint not null check (alias_number between 1 and 9999),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id),
  unique (post_id, alias_number)
);

create table if not exists public.forum_anonymous_identity_audits (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  post_id uuid not null references public.forum_posts(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.forum_profile_avatars (
  user_id uuid primary key references auth.users(id) on delete cascade,
  object_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size between 1 and 5242880),
  width integer check (width is null or width between 256 and 4096),
  height integer check (height is null or height between 256 and 4096),
  crop_x numeric(6,5) not null default 0.5 check (crop_x between 0 and 1),
  crop_y numeric(6,5) not null default 0.5 check (crop_y between 0 and 1),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (object_path ~ '^profiles/[a-f0-9]{24}\.(jpg|png|webp)$')
);

alter table public.forum_anonymous_aliases enable row level security;
alter table public.forum_anonymous_aliases force row level security;
alter table public.forum_anonymous_identity_audits enable row level security;
alter table public.forum_anonymous_identity_audits force row level security;
alter table public.forum_profile_avatars enable row level security;
alter table public.forum_profile_avatars force row level security;
revoke all on public.forum_anonymous_aliases from public, anon, authenticated;
revoke all on public.forum_anonymous_identity_audits from public, anon, authenticated;
revoke all on public.forum_profile_avatars from public, anon, authenticated;
grant select, insert, update, delete on public.forum_anonymous_aliases to service_role;
grant select, insert on public.forum_anonymous_identity_audits to service_role;
grant select, insert, update, delete on public.forum_profile_avatars to service_role;

create or replace function public.forum_ensure_anonymous_alias(p_post_id uuid, p_user_id uuid)
returns smallint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_alias smallint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_post_id::text, 618));
  select alias_number into v_alias from public.forum_anonymous_aliases
  where post_id = p_post_id and user_id = p_user_id;
  if v_alias is null then
    select coalesce(max(alias_number), 0) + 1 into v_alias
    from public.forum_anonymous_aliases where post_id = p_post_id;
    insert into public.forum_anonymous_aliases (post_id, user_id, alias_number)
    values (p_post_id, p_user_id, v_alias);
  end if;
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
declare v_alias smallint;
begin
  select alias_number into v_alias
  from public.forum_anonymous_aliases
  where post_id = p_post_id and user_id = p_user_id;
  if v_alias is null then
    return jsonb_build_object(
      'memberId', null, 'displayName', 'Anonymous member',
      'school', null, 'year', null, 'verified', false,
      'anonymous', true, 'avatarPath', null
    );
  end if;
  return jsonb_build_object(
    'memberId', null,
    'displayName', 'Anonymous member ' || v_alias,
    'school', null,
    'year', null,
    'verified', false,
    'anonymous', true,
    'avatarPath', null
  );
end;
$$;

create or replace function public.forum_public_profile(
  p_viewer_user_id uuid,
  p_post_id uuid,
  p_user_id uuid,
  p_anonymous boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_profile jsonb;
declare v_avatar text;
begin
  if coalesce(p_anonymous, false) then
    return public.forum_anonymous_profile(p_post_id, p_user_id);
  end if;
  v_profile := public.forum_safe_profile(p_viewer_user_id, p_user_id);
  if v_profile is null then return null; end if;
  select object_path into v_avatar from public.forum_profile_avatars where user_id = p_user_id;
  return v_profile || jsonb_build_object('anonymous', false, 'avatarPath', v_avatar);
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
declare v_result jsonb;
begin
  if not public.forum_post_is_visible(p_viewer_user_id, p_post_id) then return null; end if;
  select jsonb_build_object(
    'kind', case when r.id is null then 'entry' else 'citation' end,
    'entryId', p.public_id, 'body', p.body, 'sourceUrl', p.source_url,
    'caseTitle', p.case_title, 'entryType', p.entry_type, 'subject', p.subject,
    'category', p.category, 'lawSchoolYear', p.law_school_year,
    'createdAt', p.created_at, 'updatedAt', p.updated_at,
    'edited', p.edited_at is not null, 'commentsLocked', p.comments_locked_at is not null,
    'viewerOwns', p.author_user_id = p_viewer_user_id,
    'anonymous', p.is_anonymous,
    'viewerHelpful', exists (select 1 from public.forum_reactions x where x.post_id = p.id and x.user_id = p_viewer_user_id),
    'viewerReaction', (select x.reaction_type from public.forum_reactions x where x.post_id = p.id and x.user_id = p_viewer_user_id),
    'viewerSaved', exists (select 1 from public.forum_saved_entries x where x.post_id = p.id and x.user_id = p_viewer_user_id),
    'author', public.forum_public_profile(p_viewer_user_id, p.id, p.author_user_id, p.is_anonymous),
    'circle', case when c.id is null then null else jsonb_build_object('circleId', c.public_id, 'name', c.name, 'subject', c.subject, 'status', c.status) end,
    'counts', jsonb_build_object(
      'helpful', (select count(*) from public.forum_reactions x where x.post_id = p.id),
      'reactions', (select count(*) from public.forum_reactions x where x.post_id = p.id),
      'hear', (select count(*) from public.forum_reactions x where x.post_id = p.id and x.reaction_type = 'hear'),
      'see', (select count(*) from public.forum_reactions x where x.post_id = p.id and x.reaction_type = 'see'),
      'feel', (select count(*) from public.forum_reactions x where x.post_id = p.id and x.reaction_type = 'feel'),
      'comments', (select count(*) from public.forum_comments x where x.post_id = p.id and x.deleted_at is null and x.moderation_status = 'visible'),
      'citations', (select count(*) from public.forum_reposts x where x.original_post_id = p.id and x.deleted_at is null)
    ),
    'indicators', (
      select coalesce(jsonb_agg(v.indicator order by v.ordinal), '[]'::jsonb)
      from (
        select 'Source Provided'::text as indicator, 1 as ordinal where p.source_url is not null
        union all select 'Opinion Only', 2 where p.opinion_only
        union all
        select case i.indicator when 'citation_checked' then 'Citation Checked' when 'community_correction' then 'Community Correction' when 'moderator_reviewed' then 'Moderator Reviewed' end,
          case i.indicator when 'citation_checked' then 3 when 'community_correction' then 4 else 5 end
        from public.forum_entry_indicators i where i.post_id = p.id
      ) v
    ),
    'imagePath', media.first_path,
    'imageAlt', media.first_alt,
    'images', coalesce(media.images, '[]'::jsonb),
    'practiceQuestionId', p.mapped_question_id,
    'citation', case when r.id is null then null else jsonb_build_object(
      'citationId', r.public_id, 'commentary', r.commentary, 'createdAt', r.created_at,
      'viewerOwns', r.user_id = p_viewer_user_id,
      'author', public.forum_safe_profile(p_viewer_user_id, r.user_id)
    ) end
  ) into v_result
  from public.forum_posts p
  left join public.forum_reposts r on r.id = p_repost_id and r.original_post_id = p.id
    and r.deleted_at is null and not public.forum_users_blocked(p_viewer_user_id, r.user_id)
  left join public.forum_study_circles c on c.id = p.circle_id
  left join lateral (
    select
      (array_agg(a.object_path order by a.sort_order, a.created_at))[1] as first_path,
      (array_agg(a.alt_text order by a.sort_order, a.created_at))[1] as first_alt,
      jsonb_agg(jsonb_build_object('imagePath', a.object_path, 'imageAlt', a.alt_text, 'order', a.sort_order) order by a.sort_order, a.created_at) as images
    from public.forum_post_attachments a
    where a.post_id = p.id and a.deleted_at is null
  ) media on true
  where p.id = p_post_id;
  if p_repost_id is not null and (v_result->'citation') = 'null'::jsonb then return null; end if;
  return v_result;
end;
$$;

create or replace function public.forum_quorum_query_v2(
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
  v_post_id uuid;
  v_entry_id text;
  v_result jsonb;
  v_member_user_id uuid;
  v_avatar_path text;
begin
  perform public.forum_assert_member(p_user_id);
  if v_operation in ('comments', 'entry') then
    select id, public_id into v_post_id, v_entry_id
    from public.forum_posts
    where public_id = p_payload->>'entryId'
       or (nullif(p_payload->>'legacyPostId', '') is not null and id = (p_payload->>'legacyPostId')::uuid);
    if v_post_id is null or not public.forum_post_is_visible(p_user_id, v_post_id) then
      raise exception 'FORUM_POST_NOT_FOUND';
    end if;
    v_result := coalesce((
      select jsonb_agg(jsonb_build_object(
        'commentId', c.public_id,
        'parentCommentId', parent.public_id,
        'body', c.body,
        'createdAt', c.created_at,
        'updatedAt', c.updated_at,
        'edited', c.edited_at is not null,
        'viewerOwns', c.author_user_id = p_user_id,
        'anonymous', c.is_anonymous,
        'author', public.forum_public_profile(p_user_id, c.post_id, c.author_user_id, c.is_anonymous)
      ) order by coalesce(parent.created_at, c.created_at), parent.id nulls first, c.created_at, c.id)
      from (
        select * from public.forum_comments
        where post_id = v_post_id and deleted_at is null and moderation_status = 'visible'
          and not public.forum_users_blocked(p_user_id, author_user_id)
        order by created_at asc, id asc limit 200
      ) c
      left join public.forum_comments parent on parent.id = c.parent_comment_id
    ), '[]'::jsonb);
    if v_operation = 'comments' then return v_result; end if;
    return jsonb_build_object('entry', public.forum_render_entry(p_user_id, v_post_id, null), 'comments', v_result);
  end if;
  v_result := public.forum_quorum_query(p_user_id, v_operation, p_payload);
  if v_operation = 'profile' and v_result is not null then
    if nullif(p_payload->>'memberId', '') is null then
      v_member_user_id := p_user_id;
    else
      select user_id into v_member_user_id
      from public.forum_profile_settings
      where public_id = p_payload->>'memberId';
    end if;
    select object_path into v_avatar_path
    from public.forum_profile_avatars
    where user_id = v_member_user_id;
    v_result := v_result || jsonb_build_object('avatarPath', v_avatar_path);
  end if;
  return v_result;
end;
$$;

create or replace function public.forum_quorum_command_v2(
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
  v_result jsonb;
  v_post_id uuid;
  v_comment_id uuid;
  v_path text;
  v_paths jsonb;
  v_order smallint;
begin
  perform public.forum_assert_member(p_user_id);
  if v_operation = 'register_attachment' then
    select id into v_post_id from public.forum_posts
    where public_id = p_payload->>'entryId' and author_user_id = p_user_id and deleted_at is null
    for update;
    if v_post_id is null then raise exception 'FORUM_OWNERSHIP_REQUIRED'; end if;
    v_path := btrim(coalesce(p_payload->>'objectPath', ''));
    v_order := coalesce((p_payload->>'sortOrder')::smallint, 1);
    if v_path !~ ('^entries/' || (p_payload->>'entryId') || '/[a-f0-9]{24}\.(jpg|png|webp)$')
      or p_payload->>'mimeType' not in ('image/jpeg', 'image/png', 'image/webp')
      or coalesce((p_payload->>'byteSize')::integer, 0) not between 1 and 3145728
      or v_order not between 1 and 12
      or (select count(*) from public.forum_post_attachments where post_id = v_post_id and deleted_at is null) >= 12
    then raise exception 'FORUM_ATTACHMENT_INVALID'; end if;
    insert into public.forum_post_attachments (post_id, owner_user_id, object_path, mime_type, byte_size, sort_order, alt_text)
    values (v_post_id, p_user_id, v_path, p_payload->>'mimeType', (p_payload->>'byteSize')::integer, v_order, nullif(btrim(p_payload->>'altText'), ''));
    return jsonb_build_object('registered', true, 'imagePath', v_path, 'sortOrder', v_order);
  elsif v_operation = 'remove_attachment' then
    select p.id, a.object_path into v_post_id, v_path
    from public.forum_posts p join public.forum_post_attachments a on a.post_id = p.id
    where p.public_id = p_payload->>'entryId' and p.author_user_id = p_user_id
      and a.deleted_at is null
      and (nullif(p_payload->>'objectPath', '') is null or a.object_path = p_payload->>'objectPath')
    order by a.sort_order limit 1 for update of a;
    if v_path is null then raise exception 'FORUM_ATTACHMENT_NOT_FOUND'; end if;
    update public.forum_post_attachments set deleted_at = now() where object_path = v_path;
    return jsonb_build_object('removed', true, 'imagePath', v_path);
  elsif v_operation = 'delete_entry' then
    select id into v_post_id from public.forum_posts
    where public_id = p_payload->>'entryId' and author_user_id = p_user_id for update;
    if v_post_id is null then raise exception 'FORUM_OWNERSHIP_REQUIRED'; end if;
    select coalesce(jsonb_agg(object_path), '[]'::jsonb) into v_paths
    from public.forum_post_attachments where post_id = v_post_id and deleted_at is null;
    update public.forum_posts set deleted_at = coalesce(deleted_at, now()), updated_at = now() where id = v_post_id;
    update public.forum_post_attachments set deleted_at = coalesce(deleted_at, now()) where post_id = v_post_id;
    return jsonb_build_object('entryId', p_payload->>'entryId', 'deleted', true, 'imagePaths', v_paths);
  end if;

  v_result := public.forum_quorum_command(p_user_id, v_operation, p_payload);
  if v_operation in ('create_entry', 'update_entry') then
    select id into v_post_id from public.forum_posts
    where public_id = coalesce(v_result->>'entryId', p_payload->>'entryId') and author_user_id = p_user_id;
    if v_post_id is not null then
      update public.forum_posts set is_anonymous = coalesce((p_payload->>'isAnonymous')::boolean, false)
      where id = v_post_id;
      if coalesce((p_payload->>'isAnonymous')::boolean, false) then
        perform public.forum_ensure_anonymous_alias(v_post_id, p_user_id);
      end if;
    end if;
  elsif v_operation = 'create_comment' then
    select c.id, c.post_id into v_comment_id, v_post_id
    from public.forum_comments c where c.public_id = v_result->>'commentId' and c.author_user_id = p_user_id;
    if v_comment_id is not null then
      update public.forum_comments set is_anonymous = coalesce((p_payload->>'isAnonymous')::boolean, false)
      where id = v_comment_id;
      if coalesce((p_payload->>'isAnonymous')::boolean, false) then
        perform public.forum_ensure_anonymous_alias(v_post_id, p_user_id);
        update public.forum_notifications set actor_user_id = null
        where comment_id = v_comment_id and actor_user_id = p_user_id;
      end if;
    end if;
  end if;
  return v_result;
end;
$$;

create or replace function public.forum_set_profile_avatar(
  p_user_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_old_path text;
declare v_path text := btrim(coalesce(p_payload->>'objectPath', ''));
begin
  perform public.forum_assert_member(p_user_id);
  if v_path !~ '^profiles/[a-f0-9]{24}\.(jpg|png|webp)$'
    or p_payload->>'mimeType' not in ('image/jpeg', 'image/png', 'image/webp')
    or coalesce((p_payload->>'byteSize')::integer, 0) not between 1 and 5242880
    or coalesce((p_payload->>'width')::integer, 0) not between 256 and 4096
    or coalesce((p_payload->>'height')::integer, 0) not between 256 and 4096
  then raise exception 'FORUM_AVATAR_INVALID'; end if;
  select object_path into v_old_path from public.forum_profile_avatars where user_id = p_user_id;
  insert into public.forum_profile_avatars (user_id, object_path, mime_type, byte_size, width, height, crop_x, crop_y, updated_at)
  values (p_user_id, v_path, p_payload->>'mimeType', (p_payload->>'byteSize')::integer,
    (p_payload->>'width')::integer, (p_payload->>'height')::integer,
    coalesce((p_payload->>'cropX')::numeric, 0.5), coalesce((p_payload->>'cropY')::numeric, 0.5), now())
  on conflict (user_id) do update set object_path = excluded.object_path, mime_type = excluded.mime_type,
    byte_size = excluded.byte_size, width = excluded.width, height = excluded.height,
    crop_x = excluded.crop_x, crop_y = excluded.crop_y, updated_at = now();
  return jsonb_build_object('updated', true, 'avatarPath', v_path, 'previousPath', v_old_path);
end;
$$;

create or replace function public.forum_resolve_anonymous_identity(
  p_actor_user_id uuid,
  p_entry_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_post public.forum_posts%rowtype;
begin
  perform public.phase4_require_founder(p_actor_user_id);
  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 1000 then raise exception 'FORUM_REASON_REQUIRED'; end if;
  select * into v_post from public.forum_posts where public_id = p_entry_id and is_anonymous;
  if v_post.id is null then raise exception 'FORUM_ANONYMOUS_ENTRY_NOT_FOUND'; end if;
  insert into public.forum_anonymous_identity_audits (actor_user_id, post_id, target_user_id, reason)
  values (p_actor_user_id, v_post.id, v_post.author_user_id, btrim(p_reason));
  return jsonb_build_object('entryId', p_entry_id, 'userId', v_post.author_user_id);
end;
$$;

revoke all on function public.forum_ensure_anonymous_alias(uuid, uuid) from public, anon, authenticated;
revoke all on function public.forum_anonymous_profile(uuid, uuid) from public, anon, authenticated;
revoke all on function public.forum_public_profile(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.forum_render_entry(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.forum_quorum_query_v2(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.forum_quorum_command_v2(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.forum_set_profile_avatar(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.forum_resolve_anonymous_identity(uuid, text, text) from public, anon, authenticated;
grant execute on function public.forum_ensure_anonymous_alias(uuid, uuid) to service_role;
grant execute on function public.forum_anonymous_profile(uuid, uuid) to service_role;
grant execute on function public.forum_public_profile(uuid, uuid, uuid, boolean) to service_role;
grant execute on function public.forum_render_entry(uuid, uuid, uuid) to service_role;
grant execute on function public.forum_quorum_query_v2(uuid, text, jsonb) to service_role;
grant execute on function public.forum_quorum_command_v2(uuid, text, jsonb) to service_role;
grant execute on function public.forum_set_profile_avatar(uuid, jsonb) to service_role;
grant execute on function public.forum_resolve_anonymous_identity(uuid, text, text) to service_role;

commit;

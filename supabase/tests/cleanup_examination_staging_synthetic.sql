-- STAGING ONLY. This script refuses to run if any non-synthetic examination
-- account or definition exists. It preserves the approved Google Sheet source
-- questions and removes only isolated examination feature-test records.

begin;

do $$
begin
  if exists (
    select 1
    from auth.users
    where email is null
       or email not like 'dd-%@example.com'
  ) then
    raise exception 'STAGING_CLEANUP_REFUSED_NON_SYNTHETIC_USER';
  end if;

  if exists (
    select 1
    from public.examination_definitions
    where title not like '[SYNTHETIC %'
  ) then
    raise exception 'STAGING_CLEANUP_REFUSED_NON_SYNTHETIC_EXAMINATION';
  end if;

  if exists (
    select 1
    from public.examination_questions
    where source_type = 'google_sheet'
      and (
        review_status <> 'approved'
        or not publication_ready
      )
  ) then
    raise exception 'STAGING_CLEANUP_REFUSED_SOURCE_STATE_CHANGED';
  end if;
end
$$;

truncate table
  public.examination_command_receipts,
  public.examination_audit_log,
  public.examination_notifications,
  public.examination_model_releases,
  public.examination_examiner_reviews,
  public.examination_examiner_assignments,
  public.examination_ai_assessments,
  public.examination_grading_jobs,
  public.examination_submissions,
  public.examination_responses,
  public.examination_attempts_multi,
  public.examination_participants,
  public.examination_beta_access,
  public.examination_version_questions,
  public.examination_versions,
  public.examination_definitions,
  public.examination_uploads
restart identity cascade;

delete from public.examination_questions
where source_type = 'uploaded';

delete from public.usage_events
where user_id in (
  select id
  from auth.users
  where email like 'dd-%@example.com'
);

delete from public.usage_sessions
where user_id in (
  select id
  from auth.users
  where email like 'dd-%@example.com'
);

delete from auth.users
where email like 'dd-%@example.com';

do $$
begin
  if (select count(*) from public.examination_questions) <> 20
    or exists (
      select 1
      from public.examination_questions
      where source_type <> 'google_sheet'
         or review_status <> 'approved'
         or not publication_ready
    )
  then
    raise exception 'STAGING_CLEANUP_SOURCE_INVENTORY_MISMATCH';
  end if;
end
$$;

commit;

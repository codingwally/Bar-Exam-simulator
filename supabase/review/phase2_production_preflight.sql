-- Phase 2 production preflight. READ ONLY.
-- Fails if the approved Phase 1 foundation or zero-row Phase 2 assumptions differ.
do $$
begin
  if current_database() is null then
    raise exception 'Unable to identify database';
  end if;
  if to_regclass('public.question_corrections') is null
     or to_regclass('public.user_roles') is null
     or to_regclass('public.terms_acceptances') is null
     or to_regprocedure('public.accept_terms(text,text,text)') is null
     or to_regprocedure('public.complete_profile_onboarding(text,text,text,text,text,text)') is null
     or to_regprocedure('public.bootstrap_first_super_admin(uuid,text)') is null then
    raise exception 'Phase 1 production foundation does not match the approved baseline';
  end if;
  if to_regclass('public.grade_disputes') is not null then
    raise exception 'Deprecated grade_disputes table unexpectedly exists';
  end if;
  if (select count(*) from public.subjects) <> 8 then
    raise exception 'Expected exactly eight production subjects';
  end if;
  if (select count(*) from public.questions) <> 2 then
    raise exception 'Expected exactly two production question records';
  end if;
  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260727'
  ) then
    raise exception 'Expected the Phase 1 production migration ledger entry';
  end if;
  if exists (select 1 from auth.users)
     or exists (select 1 from public.profiles)
     or exists (select 1 from public.user_roles)
     or exists (select 1 from public.submissions)
     or exists (select 1 from public.grading_results) then
    raise exception 'Production user-data baseline changed; review before Phase 2';
  end if;
  if to_regclass('public.guest_grading_usage') is not null
     or to_regclass('public.guest_grading_devices') is not null
     or to_regclass('public.guest_grading_reservations') is not null
     or to_regclass('public.support_requests') is not null then
    raise exception 'Phase 2 objects already exist; reconcile migration history first';
  end if;
end
$$;

select jsonb_build_object(
  'phase1_ledger',
    exists (
      select 1
      from supabase_migrations.schema_migrations
      where version = '20260727'
    ),
  'subjects', (select count(*) from public.subjects),
  'questions', (select count(*) from public.questions),
  'question_corrections', (select count(*) from public.question_corrections),
  'auth_users', (select count(*) from auth.users),
  'profiles', (select count(*) from public.profiles),
  'user_roles', (select count(*) from public.user_roles),
  'submissions', (select count(*) from public.submissions),
  'grading_results', (select count(*) from public.grading_results),
  'phase2_objects_absent',
    to_regclass('public.guest_grading_usage') is null
    and to_regclass('public.guest_grading_devices') is null
    and to_regclass('public.guest_grading_reservations') is null
    and to_regclass('public.support_requests') is null
) as phase2_preflight;

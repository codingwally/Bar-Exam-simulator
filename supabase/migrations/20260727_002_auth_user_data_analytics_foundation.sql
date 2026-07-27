-- Due Diligence Phase 1: authentication, user data, analytics, and admin foundation.
--
-- ADDITIVE / UNAPPLIED MIGRATION
-- This migration must be reviewed and tested against a non-production Supabase
-- database before it is applied to project hbllomlijfznnuudpdvr.
--
-- Security design:
--   * authenticated users can update only approved personal profile columns;
--   * terms and marketing history are written through server-timestamped RPCs;
--   * roles, analytics, entitlements, and audit records are backend-controlled;
--   * no founder email address or secret is embedded in this migration;
--   * existing questions, submissions, grading, and Labor identifiers are untouched.
--
-- Approved beta legal-document versions:
--   Terms:  terms-beta-v1-2026-08-15
--   Privacy: privacy-beta-v1-2026-08-15
-- Approved active-viewer window: five minutes from usage_sessions.last_seen_at.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Existing core-table least-privilege reconciliation
-- ---------------------------------------------------------------------------

-- Phase 1B found legacy broad table grants on all seven production core
-- tables. Revoke every client privilege first, then restore only the operations
-- required by the existing application and RLS policies.
revoke all privileges on table
  public.profiles,
  public.subjects,
  public.questions,
  public.submissions,
  public.grading_results,
  public.calibration_examples,
  public.grade_disputes
from public, anon, authenticated;

-- Public question discovery remains read-only.
grant select on table public.subjects, public.questions
  to anon, authenticated;

-- Signed-in students retain only their existing owner-scoped workflows.
grant select on table public.profiles to authenticated;
grant select, insert on table public.submissions to authenticated;
grant select on table public.grading_results to authenticated;
grant select, insert on table public.grade_disputes to authenticated;

-- Calibration data and every core-table write not listed above remain
-- backend-only. The service role keeps full operational access.
grant all privileges on table
  public.profiles,
  public.subjects,
  public.questions,
  public.submissions,
  public.grading_results,
  public.calibration_examples,
  public.grade_disputes
to service_role;

-- ---------------------------------------------------------------------------
-- Profiles and onboarding
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists school text,
  add column if not exists enrollment_status text,
  add column if not exists year_level text,
  add column if not exists profile_completed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_enrollment_status_check'
  ) then
    alter table public.profiles
      add constraint profiles_enrollment_status_check
      check (
        enrollment_status is null
        or enrollment_status in ('enrolled', 'not_yet_enrolled')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_completed_onboarding_check'
  ) then
    alter table public.profiles
      add constraint profiles_completed_onboarding_check
      check (
        profile_completed_at is null
        or (
          enrollment_status = 'not_yet_enrolled'
          or (
            enrollment_status = 'enrolled'
            and nullif(btrim(school), '') is not null
            and nullif(btrim(year_level), '') is not null
          )
        )
      );
  end if;
end
$$;

create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'profiles_set_updated_at'
      and not tgisinternal
  ) then
    create trigger profiles_set_updated_at
      before update on public.profiles
      for each row
      execute function public.set_profile_updated_at();
  end if;
end
$$;

-- RLS controls row ownership; column grants below enforce field-level security.
alter table public.profiles enable row level security;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_select_own'
  ) then
    alter policy profiles_select_own on public.profiles
      using ((select auth.uid()) = id);
  else
    create policy profiles_select_own
      on public.profiles
      for select
      to authenticated
      using ((select auth.uid()) = id);
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_update_own'
  ) then
    alter policy profiles_update_own on public.profiles
      using ((select auth.uid()) = id)
      with check ((select auth.uid()) = id);
  else
    create policy profiles_update_own
      on public.profiles
      for update
      to authenticated
      using ((select auth.uid()) = id)
      with check ((select auth.uid()) = id);
  end if;
end
$$;

-- A permissive UPDATE policy cannot protect individual columns. The broad
-- table-level privilege was revoked above; grant only approved personal fields.
grant update (display_name, school, enrollment_status, year_level)
  on public.profiles to authenticated;

-- A dispute must belong to the authenticated user and must reference that
-- same user's submission. Checking only grade_disputes.user_id would allow a
-- student who learned another submission UUID to attach a dispute to it.
do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'grade_disputes'
      and policyname = 'grade_disputes_insert_own'
  ) then
    alter policy grade_disputes_insert_own
      on public.grade_disputes
      to authenticated
      with check (
        (select auth.uid()) = user_id
        and exists (
          select 1
          from public.submissions
          where submissions.id = grade_disputes.submission_id
            and submissions.user_id = (select auth.uid())
        )
      );
  else
    create policy grade_disputes_insert_own
      on public.grade_disputes
      for insert
      to authenticated
      with check (
        (select auth.uid()) = user_id
        and exists (
          select 1
          from public.submissions
          where submissions.id = grade_disputes.submission_id
            and submissions.user_id = (select auth.uid())
        )
      );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Versioned terms acceptance and optional marketing consent history
-- ---------------------------------------------------------------------------

create table if not exists public.terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  terms_version text not null check (nullif(btrim(terms_version), '') is not null),
  privacy_version text not null default '' check (privacy_version = '' or nullif(btrim(privacy_version), '') is not null),
  accepted_at timestamptz not null default now(),
  acceptance_source text not null check (nullif(btrim(acceptance_source), '') is not null),
  unique (user_id, terms_version, privacy_version)
);

create table if not exists public.marketing_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  opted_in boolean not null default false,
  consent_version text not null check (nullif(btrim(consent_version), '') is not null),
  source text not null check (nullif(btrim(source), '') is not null),
  changed_at timestamptz not null default now()
);

create index if not exists terms_acceptances_user_time_idx
  on public.terms_acceptances (user_id, accepted_at desc);
create index if not exists marketing_consents_user_time_idx
  on public.marketing_consents (user_id, changed_at desc);

alter table public.terms_acceptances enable row level security;
alter table public.marketing_consents enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'terms_acceptances'
      and policyname = 'terms_acceptances_select_own'
  ) then
    create policy terms_acceptances_select_own
      on public.terms_acceptances
      for select
      to authenticated
      using ((select auth.uid()) = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'marketing_consents'
      and policyname = 'marketing_consents_select_own'
  ) then
    create policy marketing_consents_select_own
      on public.marketing_consents
      for select
      to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end
$$;

revoke all on public.terms_acceptances from anon, authenticated;
revoke all on public.marketing_consents from anon, authenticated;
grant select on public.terms_acceptances to authenticated;
grant select on public.marketing_consents to authenticated;

create or replace function public.accept_terms(
  p_terms_version text default 'terms-beta-v1-2026-08-15',
  p_privacy_version text default 'privacy-beta-v1-2026-08-15',
  p_acceptance_source text default 'web_onboarding'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if nullif(btrim(p_terms_version), '') is null then
    raise exception 'Terms version is required';
  end if;
  if nullif(btrim(p_acceptance_source), '') is null then
    raise exception 'Acceptance source is required';
  end if;
  if btrim(p_terms_version) <> 'terms-beta-v1-2026-08-15'
     or coalesce(btrim(p_privacy_version), '') <> 'privacy-beta-v1-2026-08-15' then
    raise exception 'Current Terms and Privacy versions are required';
  end if;

  insert into public.terms_acceptances (
    user_id,
    terms_version,
    privacy_version,
    accepted_at,
    acceptance_source
  )
  values (
    v_user_id,
    btrim(p_terms_version),
    coalesce(btrim(p_privacy_version), ''),
    now(),
    btrim(p_acceptance_source)
  )
  on conflict (user_id, terms_version, privacy_version)
  do nothing;
end;
$$;

create or replace function public.record_marketing_consent(
  p_opted_in boolean default false,
  p_consent_version text default '1',
  p_source text default 'web_onboarding'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if nullif(btrim(p_consent_version), '') is null then
    raise exception 'Consent version is required';
  end if;
  if nullif(btrim(p_source), '') is null then
    raise exception 'Consent source is required';
  end if;

  insert into public.marketing_consents (
    user_id,
    opted_in,
    consent_version,
    source,
    changed_at
  )
  values (
    v_user_id,
    coalesce(p_opted_in, false),
    btrim(p_consent_version),
    btrim(p_source),
    clock_timestamp()
  );
end;
$$;

create or replace function public.complete_profile_onboarding(
  p_display_name text,
  p_school text,
  p_enrollment_status text,
  p_year_level text,
  p_terms_version text default 'terms-beta-v1-2026-08-15',
  p_privacy_version text default 'privacy-beta-v1-2026-08-15'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_enrollment_status is null
     or p_enrollment_status not in ('enrolled', 'not_yet_enrolled') then
    raise exception 'Invalid enrollment status';
  end if;
  if btrim(p_terms_version) <> 'terms-beta-v1-2026-08-15'
     or coalesce(btrim(p_privacy_version), '') <> 'privacy-beta-v1-2026-08-15' then
    raise exception 'Current Terms and Privacy versions are required';
  end if;
  if p_enrollment_status = 'enrolled'
     and (
       nullif(btrim(p_school), '') is null
       or nullif(btrim(p_year_level), '') is null
     ) then
    raise exception 'School and year level are required for enrolled students';
  end if;
  if not exists (
    select 1
    from public.terms_acceptances
    where user_id = v_user_id
      and terms_version = btrim(p_terms_version)
      and privacy_version = coalesce(btrim(p_privacy_version), '')
  ) then
    raise exception 'Required terms have not been accepted';
  end if;

  update public.profiles
  set display_name = nullif(btrim(p_display_name), ''),
      school = case
        when p_enrollment_status = 'not_yet_enrolled' then nullif(btrim(p_school), '')
        else btrim(p_school)
      end,
      enrollment_status = p_enrollment_status,
      year_level = case
        when p_enrollment_status = 'not_yet_enrolled' then nullif(btrim(p_year_level), '')
        else btrim(p_year_level)
      end,
      profile_completed_at = now()
  where id = v_user_id;

  if not found then
    raise exception 'Profile does not exist for authenticated user';
  end if;
end;
$$;

revoke all on function public.accept_terms(text, text, text) from public, anon;
revoke all on function public.record_marketing_consent(boolean, text, text) from public, anon;
revoke all on function public.complete_profile_onboarding(text, text, text, text, text, text) from public, anon;
grant execute on function public.accept_terms(text, text, text) to authenticated;
grant execute on function public.record_marketing_consent(boolean, text, text) to authenticated;
grant execute on function public.complete_profile_onboarding(text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Immutable-user-ID role foundation
-- ---------------------------------------------------------------------------

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'student'
    check (role in ('student', 'admin', 'super_admin')),
  assigned_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_roles enable row level security;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select role from public.user_roles where user_id = auth.uid()),
    'student'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_user_role() in ('admin', 'super_admin');
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_user_role() = 'super_admin';
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_roles'
      and policyname = 'user_roles_select_own'
  ) then
    create policy user_roles_select_own
      on public.user_roles
      for select
      to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end
$$;

revoke all on public.user_roles from anon, authenticated;
grant select on public.user_roles to authenticated;

-- Existing profiles receive the safe default role. Founder roles are assigned
-- later by immutable auth.users.id through a trusted operation after OAuth.
insert into public.user_roles (user_id, role)
select id, 'student'
from public.profiles
on conflict (user_id) do nothing;

create or replace function public.handle_due_diligence_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', '')
    )
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'student')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'auth.users'::regclass
      and tgname = 'on_auth_user_created_due_diligence'
      and not tgisinternal
  ) then
    create trigger on_auth_user_created_due_diligence
      after insert on auth.users
      for each row
      execute function public.handle_due_diligence_auth_user();
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Analytics and current-viewer foundation
-- ---------------------------------------------------------------------------

-- Recursively inspect JSON objects and arrays so forbidden data cannot be
-- hidden below the top metadata level. The function is immutable and has no
-- table access; it exists solely for CHECK constraints.
create or replace function public.jsonb_has_forbidden_keys(
  p_value jsonb,
  p_forbidden_keys text[]
)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_key text;
  v_child jsonb;
begin
  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_child in
      select key, value
      from pg_catalog.jsonb_each(p_value)
    loop
      if lower(v_key) = any(p_forbidden_keys)
         or public.jsonb_has_forbidden_keys(v_child, p_forbidden_keys) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in
      select value
      from pg_catalog.jsonb_array_elements(p_value)
    loop
      if public.jsonb_has_forbidden_keys(v_child, p_forbidden_keys) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

revoke all on function public.jsonb_has_forbidden_keys(jsonb, text[])
  from public, anon, authenticated;
grant execute on function public.jsonb_has_forbidden_keys(jsonb, text[])
  to service_role;

create table if not exists public.usage_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  anonymous_session_id uuid,
  auth_state text not null check (auth_state in ('guest', 'signed_in')),
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  source text not null default 'web',
  metadata jsonb not null default '{}'::jsonb,
  check (
    (auth_state = 'guest' and user_id is null and anonymous_session_id is not null)
    or (auth_state = 'signed_in' and user_id is not null)
  ),
  constraint usage_sessions_metadata_safe_check check (
    not public.jsonb_has_forbidden_keys(
      metadata,
      array[
        'answer', 'answer_text', 'student_answer', 'submission_text',
        'raw_answer', 'email', 'password', 'token', 'api_key',
        'service_role_key', 'ip', 'ip_address', 'raw_ip'
      ]
    )
  )
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.usage_sessions(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  anonymous_session_id uuid,
  event_type text not null check (nullif(btrim(event_type), '') is not null),
  subject text,
  question_id text,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  check (user_id is not null or anonymous_session_id is not null),
  constraint usage_events_metadata_safe_check check (
    not public.jsonb_has_forbidden_keys(
      metadata,
      array[
        'answer', 'answer_text', 'student_answer', 'submission_text',
        'raw_answer', 'email', 'password', 'token', 'api_key',
        'service_role_key', 'ip', 'ip_address', 'raw_ip'
      ]
    )
  )
);

-- `CREATE TABLE IF NOT EXISTS` does not amend a table created by an earlier
-- staging run. Add the named recursive constraints when upgrading such a
-- disposable database, while remaining repeatable.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.usage_sessions'::regclass
      and conname = 'usage_sessions_metadata_safe_check'
  ) then
    alter table public.usage_sessions
      add constraint usage_sessions_metadata_safe_check
      check (
        not public.jsonb_has_forbidden_keys(
          metadata,
          array[
            'answer', 'answer_text', 'student_answer', 'submission_text',
            'raw_answer', 'email', 'password', 'token', 'api_key',
            'service_role_key', 'ip', 'ip_address', 'raw_ip'
          ]
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.usage_events'::regclass
      and conname = 'usage_events_metadata_safe_check'
  ) then
    alter table public.usage_events
      add constraint usage_events_metadata_safe_check
      check (
        not public.jsonb_has_forbidden_keys(
          metadata,
          array[
            'answer', 'answer_text', 'student_answer', 'submission_text',
            'raw_answer', 'email', 'password', 'token', 'api_key',
            'service_role_key', 'ip', 'ip_address', 'raw_ip'
          ]
        )
      );
  end if;
end
$$;

create index if not exists usage_sessions_last_seen_idx
  on public.usage_sessions (last_seen_at desc);
-- Current viewers are sessions with ended_at IS NULL and:
-- last_seen_at >= now() - interval '5 minutes'.
create index if not exists usage_sessions_user_started_idx
  on public.usage_sessions (user_id, started_at desc)
  where user_id is not null;
create index if not exists usage_sessions_anonymous_started_idx
  on public.usage_sessions (anonymous_session_id, started_at desc)
  where anonymous_session_id is not null;
create index if not exists usage_events_occurred_idx
  on public.usage_events (occurred_at desc);
create index if not exists usage_events_user_occurred_idx
  on public.usage_events (user_id, occurred_at desc)
  where user_id is not null;
create index if not exists usage_events_type_occurred_idx
  on public.usage_events (event_type, occurred_at desc);
create index if not exists usage_events_subject_occurred_idx
  on public.usage_events (subject, occurred_at desc)
  where subject is not null;

alter table public.usage_sessions enable row level security;
alter table public.usage_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'usage_sessions'
      and policyname = 'usage_sessions_admin_select'
  ) then
    create policy usage_sessions_admin_select
      on public.usage_sessions
      for select
      to authenticated
      using ((select public.is_admin()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'usage_events'
      and policyname = 'usage_events_admin_select'
  ) then
    create policy usage_events_admin_select
      on public.usage_events
      for select
      to authenticated
      using ((select public.is_admin()));
  end if;
end
$$;

-- No client INSERT/UPDATE/DELETE policy is created. Future writes must use the
-- trusted Worker/service role. Admins receive read-only operational access.
revoke all on public.usage_sessions from anon, authenticated;
revoke all on public.usage_events from anon, authenticated;
grant select on public.usage_sessions to authenticated;
grant select on public.usage_events to authenticated;
grant select, insert, update on public.usage_sessions to service_role;
grant select, insert on public.usage_events to service_role;

-- ---------------------------------------------------------------------------
-- Future entitlements (inactive) and immutable administrator audit records
-- ---------------------------------------------------------------------------

create table if not exists public.user_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_code text not null,
  questions_per_subject_per_day integer
    check (questions_per_subject_per_day is null or questions_per_subject_per_day >= 0),
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  source text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  check (effective_until is null or effective_until > effective_from)
);

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action_type text not null check (action_type in (
    'administrator_role_assigned',
    'administrator_role_removed',
    'administrator_role_changed',
    'user_account_status_changed',
    'subscription_changed',
    'content_management_action',
    'security_setting_changed'
  )),
  target_user_id uuid references auth.users(id) on delete set null,
  target_resource_type text,
  target_resource_id text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint admin_audit_log_details_safe_check check (
    not public.jsonb_has_forbidden_keys(
      details,
      array[
        'answer', 'answer_text', 'student_answer', 'submission_text',
        'raw_answer', 'email', 'password', 'token', 'api_key',
        'service_role_key', 'ip', 'ip_address', 'raw_ip'
      ]
    )
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.admin_audit_log'::regclass
      and conname = 'admin_audit_log_details_safe_check'
  ) then
    alter table public.admin_audit_log
      add constraint admin_audit_log_details_safe_check
      check (
        not public.jsonb_has_forbidden_keys(
          details,
          array[
            'answer', 'answer_text', 'student_answer', 'submission_text',
            'raw_answer', 'email', 'password', 'token', 'api_key',
            'service_role_key', 'ip', 'ip_address', 'raw_ip'
          ]
        )
      );
  end if;
end
$$;

create index if not exists admin_audit_log_occurred_idx
  on public.admin_audit_log (occurred_at desc);
create index if not exists admin_audit_log_actor_idx
  on public.admin_audit_log (actor_user_id, occurred_at desc);

alter table public.user_entitlements enable row level security;
alter table public.admin_audit_log enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_entitlements'
      and policyname = 'user_entitlements_select_own'
  ) then
    create policy user_entitlements_select_own
      on public.user_entitlements
      for select
      to authenticated
      using ((select auth.uid()) = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'admin_audit_log'
      and policyname = 'admin_audit_log_super_admin_select'
  ) then
    create policy admin_audit_log_super_admin_select
      on public.admin_audit_log
      for select
      to authenticated
      using ((select public.is_super_admin()));
  end if;
end
$$;

revoke all on public.user_entitlements from anon, authenticated;
revoke all on public.admin_audit_log from anon, authenticated;
grant select on public.user_entitlements to authenticated;
grant select on public.admin_audit_log to authenticated;
grant select, insert, update, delete on public.user_roles to service_role;
grant select, insert, update, delete on public.user_entitlements to service_role;
grant select, insert on public.admin_audit_log to service_role;

create or replace function public.assign_user_role(
  p_target_user_id uuid,
  p_role text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_previous_role text;
  v_action_type text;
begin
  if v_actor_user_id is null or not public.is_super_admin() then
    raise exception 'Super administrator authorization required';
  end if;
  if p_target_user_id = v_actor_user_id then
    raise exception 'Self-directed administrator role changes are not allowed';
  end if;
  if p_role not in ('student', 'admin', 'super_admin') then
    raise exception 'Invalid role';
  end if;
  if not exists (select 1 from auth.users where id = p_target_user_id) then
    raise exception 'Target authenticated user does not exist';
  end if;

  select role into v_previous_role
  from public.user_roles
  where user_id = p_target_user_id;

  insert into public.user_roles (user_id, role, assigned_by, updated_at)
  values (p_target_user_id, p_role, v_actor_user_id, now())
  on conflict (user_id)
  do update set
    role = excluded.role,
    assigned_by = excluded.assigned_by,
    updated_at = excluded.updated_at;

  v_action_type := case
    when p_role = 'student' then 'administrator_role_removed'
    when coalesce(v_previous_role, 'student') = 'student'
      then 'administrator_role_assigned'
    else 'administrator_role_changed'
  end;

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
    v_actor_user_id,
    v_action_type,
    p_target_user_id,
    'user_role',
    p_target_user_id::text,
    nullif(btrim(p_reason), ''),
    jsonb_build_object(
      'previous_role', coalesce(v_previous_role, 'student'),
      'new_role', p_role
    )
  );
end;
$$;

create or replace function public.bootstrap_first_super_admin(
  p_target_user_id uuid,
  p_reason text default 'Initial trusted super administrator bootstrap'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.user_roles
    where role = 'super_admin'
  ) then
    raise exception 'A super administrator already exists';
  end if;
  if not exists (select 1 from auth.users where id = p_target_user_id) then
    raise exception 'Target authenticated user does not exist';
  end if;

  insert into public.user_roles (user_id, role, assigned_by, updated_at)
  values (p_target_user_id, 'super_admin', null, now())
  on conflict (user_id)
  do update set
    role = excluded.role,
    assigned_by = null,
    updated_at = excluded.updated_at;

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
    null,
    'administrator_role_assigned',
    p_target_user_id,
    'user_role',
    p_target_user_id::text,
    nullif(btrim(p_reason), ''),
    jsonb_build_object(
      'previous_role', 'student',
      'new_role', 'super_admin',
      'bootstrap_operation', true
    )
  );
end;
$$;

revoke all on function public.current_user_role() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_super_admin() from public, anon;
revoke all on function public.assign_user_role(uuid, text, text) from public, anon;
revoke all on function public.bootstrap_first_super_admin(uuid, text)
  from public, anon, authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.assign_user_role(uuid, text, text) to authenticated;
grant execute on function public.bootstrap_first_super_admin(uuid, text)
  to service_role;

-- Privileged tables remain backend-controlled even if future default grants
-- change. Service-role operations bypass RLS and must be kept server-side.
revoke insert, update, delete on public.user_roles from anon, authenticated;
revoke insert, update, delete on public.user_entitlements from anon, authenticated;
revoke insert, update, delete on public.admin_audit_log from anon, authenticated;

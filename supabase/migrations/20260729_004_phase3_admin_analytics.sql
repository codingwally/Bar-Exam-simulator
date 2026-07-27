-- Due Diligence Phase 3: privacy-safe analytics, protected administration,
-- operational queues, manual access controls, and future-ready configuration.
--
-- This migration is additive except for tightening direct analytics/audit
-- browser grants and extending existing queue status constraints. It does not
-- alter Gemini grading, the 0-5 rubric, questions, answers, timers, payments,
-- or the sole existing Super Admin.

-- ---------------------------------------------------------------------------
-- Capability foundation
-- ---------------------------------------------------------------------------

create table if not exists public.admin_capabilities (
  user_id uuid not null references auth.users(id) on delete cascade,
  capability text not null check (capability in (
    'analytics_viewer',
    'learner_analytics_viewer',
    'support_admin',
    'correction_admin',
    'subscription_admin',
    'account_recovery_admin',
    'advertiser_report_viewer',
    'role_admin'
  )),
  granted_by uuid not null references auth.users(id),
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  revoke_reason text,
  primary key (user_id, capability),
  check (
    (revoked_at is null and revoked_by is null and revoke_reason is null)
    or (
      revoked_at is not null
      and revoked_by is not null
      and char_length(btrim(revoke_reason)) between 5 and 1000
    )
  )
);

create index if not exists admin_capabilities_active_idx
  on public.admin_capabilities (capability, user_id)
  where revoked_at is null;

alter table public.admin_capabilities enable row level security;
revoke all on public.admin_capabilities from public, anon, authenticated;
grant select, insert, update on public.admin_capabilities to service_role;

create or replace function public.admin_has_capability(
  p_actor_user_id uuid,
  p_capability text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = p_actor_user_id
      and role = 'super_admin'
  ) or exists (
    select 1
    from public.user_roles r
    join public.admin_capabilities c on c.user_id = r.user_id
    where r.user_id = p_actor_user_id
      and r.role = 'admin'
      and c.capability = p_capability
      and c.revoked_at is null
  );
$$;

revoke all on function public.admin_has_capability(uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_has_capability(uuid, text)
  to service_role;

-- Existing client-callable role mutation is tightened: the sole Super Admin
-- can assign or remove ordinary admins, but no caller can create another
-- Super Admin through this function.
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
  if p_role not in ('student', 'admin') then
    raise exception 'Only student or admin roles may be assigned';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'A reason is required';
  end if;
  if not exists (select 1 from auth.users where id = p_target_user_id) then
    raise exception 'Target authenticated user does not exist';
  end if;

  select role into v_previous_role
  from public.user_roles
  where user_id = p_target_user_id
  for update;

  if v_previous_role = 'super_admin' then
    raise exception 'The Super Admin role cannot be changed here';
  end if;

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
    btrim(p_reason),
    jsonb_build_object(
      'previous_role', coalesce(v_previous_role, 'student'),
      'new_role', p_role
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Analytics event model
-- ---------------------------------------------------------------------------

alter table public.usage_sessions
  add column if not exists visitor_id uuid,
  add column if not exists device_category text,
  add column if not exists referral_host text,
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists landing_area text,
  add column if not exists last_page_area text,
  add column if not exists heartbeat_interval_seconds smallint not null default 90;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.usage_sessions'::regclass
      and conname = 'usage_sessions_phase3_fields_check'
  ) then
    alter table public.usage_sessions
      add constraint usage_sessions_phase3_fields_check check (
        visitor_id is not null
        and device_category in ('desktop', 'tablet', 'mobile', 'unknown')
        and char_length(coalesce(referral_host, '')) <= 253
        and char_length(coalesce(utm_source, '')) <= 120
        and char_length(coalesce(utm_medium, '')) <= 120
        and char_length(coalesce(utm_campaign, '')) <= 160
        and char_length(coalesce(landing_area, '')) <= 80
        and char_length(coalesce(last_page_area, '')) <= 80
        and heartbeat_interval_seconds between 60 and 300
      ) not valid;
  end if;
end
$$;

alter table public.usage_events
  add column if not exists event_key text,
  add column if not exists event_version smallint not null default 1,
  add column if not exists page_area text,
  add column if not exists result_category text,
  add column if not exists duration_ms integer,
  add column if not exists latency_ms integer,
  add column if not exists model_name text,
  add column if not exists worker_version text,
  add column if not exists score numeric(2,1);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.usage_events'::regclass
      and conname = 'usage_events_phase3_fields_check'
  ) then
    alter table public.usage_events
      add constraint usage_events_phase3_fields_check check (
        (event_key is null or event_key ~ '^[A-Za-z0-9_-]{16,128}$')
        and event_version between 1 and 20
        and char_length(coalesce(page_area, '')) <= 80
        and char_length(coalesce(result_category, '')) <= 80
        and char_length(coalesce(model_name, '')) <= 120
        and char_length(coalesce(worker_version, '')) <= 120
        and (duration_ms is null or duration_ms between 0 and 14400000)
        and (latency_ms is null or latency_ms between 0 and 14400000)
        and (score is null or score between 0.0 and 5.0)
      ) not valid;
  end if;
end
$$;

create unique index if not exists usage_events_event_key_uidx
  on public.usage_events (event_key)
  where event_key is not null;
create index if not exists usage_sessions_visitor_started_idx
  on public.usage_sessions (visitor_id, started_at desc)
  where visitor_id is not null;
create index if not exists usage_events_question_time_idx
  on public.usage_events (question_id, occurred_at desc)
  where question_id is not null;
create index if not exists usage_events_result_time_idx
  on public.usage_events (result_category, occurred_at desc)
  where result_category is not null;

-- Browser roles no longer receive direct raw analytics or audit-table reads.
drop policy if exists usage_sessions_admin_select on public.usage_sessions;
drop policy if exists usage_events_admin_select on public.usage_events;
drop policy if exists admin_audit_log_super_admin_select on public.admin_audit_log;
revoke all on public.usage_sessions from public, anon, authenticated;
revoke all on public.usage_events from public, anon, authenticated;
revoke all on public.admin_audit_log from public, anon, authenticated;
grant select, insert, update on public.usage_sessions to service_role;
grant select, insert on public.usage_events to service_role;
grant select, insert on public.admin_audit_log to service_role;

create or replace function public.record_usage_event(
  p_session_id uuid,
  p_visitor_id uuid,
  p_user_id uuid,
  p_event_key text,
  p_event_type text,
  p_subject text default null,
  p_question_id text default null,
  p_page_area text default null,
  p_result_category text default null,
  p_duration_ms integer default null,
  p_latency_ms integer default null,
  p_model_name text default null,
  p_worker_version text default null,
  p_score numeric default null,
  p_device_category text default 'unknown',
  p_referral_host text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_landing_area text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed_types constant text[] := array[
    'session_start', 'session_heartbeat', 'session_end', 'page_view',
    'registration_completed', 'onboarding_completed', 'subject_selected',
    'exam_started', 'question_viewed', 'question_started',
    'grading_started', 'grading_success', 'grading_failure',
    'grading_timeout', 'grading_rate_limited', 'guest_first_grade',
    'guest_third_grade', 'guest_limit_reached', 'sign_in_prompted',
    'sign_in_started', 'sign_in_completed', 'pricing_viewed',
    'support_submitted', 'correction_submitted', 'entitlement_changed'
  ];
  v_auth_state text := case when p_user_id is null then 'guest' else 'signed_in' end;
  v_inserted boolean := false;
  v_row_count integer := 0;
  v_existing_visitor uuid;
  v_existing_user uuid;
begin
  if p_session_id is null or p_visitor_id is null then
    raise exception 'Session and visitor identifiers are required';
  end if;
  if p_event_type is null or not (p_event_type = any(v_allowed_types)) then
    raise exception 'Unsupported analytics event type';
  end if;
  if p_event_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Invalid analytics event key';
  end if;
  if p_device_category not in ('desktop', 'tablet', 'mobile', 'unknown') then
    raise exception 'Invalid device category';
  end if;
  if char_length(coalesce(p_subject, '')) > 120
     or char_length(coalesce(p_question_id, '')) > 120
     or char_length(coalesce(p_page_area, '')) > 80
     or char_length(coalesce(p_result_category, '')) > 80
     or char_length(coalesce(p_model_name, '')) > 120
     or char_length(coalesce(p_worker_version, '')) > 120
     or char_length(coalesce(p_referral_host, '')) > 253
     or char_length(coalesce(p_utm_source, '')) > 120
     or char_length(coalesce(p_utm_medium, '')) > 120
     or char_length(coalesce(p_utm_campaign, '')) > 160
     or char_length(coalesce(p_landing_area, '')) > 80 then
    raise exception 'Analytics field exceeds its limit';
  end if;
  if p_duration_ms is not null and p_duration_ms not between 0 and 14400000 then
    raise exception 'Invalid duration';
  end if;
  if p_latency_ms is not null and p_latency_ms not between 0 and 14400000 then
    raise exception 'Invalid latency';
  end if;
  if p_score is not null and (p_score < 0 or p_score > 5 or p_score <> round(p_score, 1)) then
    raise exception 'Invalid score';
  end if;
  if public.jsonb_has_forbidden_keys(
    coalesce(p_metadata, '{}'::jsonb),
    array[
      'answer', 'answer_text', 'student_answer', 'submission_text',
      'raw_answer', 'prompt', 'model_answer', 'draft', 'email',
      'password', 'token', 'api_key', 'service_role_key',
      'ip', 'ip_address', 'raw_ip', 'user_agent', 'raw_user_agent'
    ]
  ) then
    raise exception 'Sensitive analytics metadata is forbidden';
  end if;

  insert into public.usage_sessions (
    id,
    user_id,
    anonymous_session_id,
    visitor_id,
    auth_state,
    started_at,
    last_seen_at,
    ended_at,
    source,
    metadata,
    device_category,
    referral_host,
    utm_source,
    utm_medium,
    utm_campaign,
    landing_area,
    last_page_area,
    heartbeat_interval_seconds
  )
  values (
    p_session_id,
    p_user_id,
    p_visitor_id,
    p_visitor_id,
    v_auth_state,
    now(),
    now(),
    case when p_event_type = 'session_end' then now() else null end,
    'web',
    '{}'::jsonb,
    p_device_category,
    nullif(lower(btrim(p_referral_host)), ''),
    nullif(btrim(p_utm_source), ''),
    nullif(btrim(p_utm_medium), ''),
    nullif(btrim(p_utm_campaign), ''),
    nullif(btrim(p_landing_area), ''),
    nullif(btrim(p_page_area), ''),
    90
  )
  on conflict (id) do update
  set user_id = coalesce(excluded.user_id, usage_sessions.user_id),
      auth_state = case
        when coalesce(excluded.user_id, usage_sessions.user_id) is null then 'guest'
        else 'signed_in'
      end,
      last_seen_at = now(),
      ended_at = case
        when p_event_type = 'session_end' then now()
        else null
      end,
      last_page_area = coalesce(excluded.last_page_area, usage_sessions.last_page_area)
  where usage_sessions.visitor_id = excluded.visitor_id;

  select visitor_id, user_id
    into v_existing_visitor, v_existing_user
  from public.usage_sessions
  where id = p_session_id;

  if v_existing_visitor is distinct from p_visitor_id
     or (p_user_id is not null and v_existing_user is distinct from p_user_id) then
    raise exception 'Session ownership mismatch';
  end if;

  if p_event_type <> 'session_heartbeat' then
    insert into public.usage_events (
      session_id,
      user_id,
      anonymous_session_id,
      event_key,
      event_version,
      event_type,
      subject,
      question_id,
      occurred_at,
      page_area,
      result_category,
      duration_ms,
      latency_ms,
      model_name,
      worker_version,
      score,
      metadata
    )
    values (
      p_session_id,
      p_user_id,
      p_visitor_id,
      p_event_key,
      1,
      p_event_type,
      nullif(btrim(p_subject), ''),
      nullif(btrim(p_question_id), ''),
      now(),
      nullif(btrim(p_page_area), ''),
      nullif(btrim(p_result_category), ''),
      p_duration_ms,
      p_latency_ms,
      nullif(btrim(p_model_name), ''),
      nullif(btrim(p_worker_version), ''),
      case when p_score is null then null else round(p_score, 1) end,
      coalesce(p_metadata, '{}'::jsonb)
    )
    on conflict (event_key) where event_key is not null do nothing;
    get diagnostics v_row_count = row_count;
    v_inserted := v_row_count > 0;
  end if;

  return jsonb_build_object(
    'accepted', true,
    'event_stored', v_inserted,
    'heartbeat_only', p_event_type = 'session_heartbeat'
  );
end;
$$;

revoke all on function public.record_usage_event(
  uuid, uuid, uuid, text, text, text, text, text, text, integer,
  integer, text, text, numeric, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_usage_event(
  uuid, uuid, uuid, text, text, text, text, text, text, integer,
  integer, text, text, numeric, text, text, text, text, text, text, jsonb
) to service_role;

-- ---------------------------------------------------------------------------
-- Support and editorial queues
-- ---------------------------------------------------------------------------

alter table public.support_requests
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists priority text not null default 'normal',
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists first_responded_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists internal_note text;

update public.support_requests
set status = case status
  when 'new' then 'pending'
  when 'reviewing' then 'in_progress'
  else status
end
where status in ('new', 'reviewing');

alter table public.support_requests
  drop constraint if exists support_requests_category_check,
  drop constraint if exists support_requests_status_check,
  drop constraint if exists support_requests_priority_check,
  drop constraint if exists support_requests_internal_note_check,
  add constraint support_requests_category_check
    check (category in ('technical', 'account', 'account_recovery', 'content', 'accessibility', 'other')),
  add constraint support_requests_status_check
    check (status in ('pending', 'in_progress', 'waiting_for_student', 'resolved', 'closed')),
  add constraint support_requests_priority_check
    check (priority in ('low', 'normal', 'high', 'urgent')),
  add constraint support_requests_internal_note_check
    check (internal_note is null or char_length(internal_note) <= 4000);

create index if not exists support_requests_queue_idx
  on public.support_requests (status, priority, created_at);

create table if not exists public.support_request_history (
  id uuid primary key default gen_random_uuid(),
  support_request_id uuid not null references public.support_requests(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  previous_status text,
  new_status text not null,
  previous_priority text,
  new_priority text not null,
  assigned_to uuid references auth.users(id) on delete set null,
  internal_note text,
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  occurred_at timestamptz not null default now(),
  check (internal_note is null or char_length(internal_note) <= 4000)
);

create index if not exists support_request_history_case_idx
  on public.support_request_history (support_request_id, occurred_at desc);

alter table public.question_corrections
  add column if not exists priority text not null default 'normal',
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists reviewer_note text,
  add column if not exists reviewed_at timestamptz;

alter table public.question_corrections
  drop constraint if exists question_corrections_priority_check,
  drop constraint if exists question_corrections_reviewer_note_check,
  add constraint question_corrections_priority_check
    check (priority in ('low', 'normal', 'high', 'urgent')),
  add constraint question_corrections_reviewer_note_check
    check (reviewer_note is null or char_length(reviewer_note) <= 4000);

create table if not exists public.question_correction_history (
  id uuid primary key default gen_random_uuid(),
  correction_id uuid not null references public.question_corrections(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  previous_status text,
  new_status text not null check (new_status in ('pending', 'accepted', 'rejected')),
  assigned_to uuid references auth.users(id) on delete set null,
  reviewer_note text,
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  occurred_at timestamptz not null default now(),
  check (reviewer_note is null or char_length(reviewer_note) <= 4000)
);

create index if not exists question_correction_history_case_idx
  on public.question_correction_history (correction_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Manual access, draft plans, and future checkout configuration
-- ---------------------------------------------------------------------------

alter table public.user_entitlements
  add column if not exists status text not null default 'active',
  add column if not exists paused_at timestamptz,
  add column if not exists canceled_at timestamptz,
  add column if not exists reason text,
  add column if not exists version integer not null default 1;

alter table public.user_entitlements
  drop constraint if exists user_entitlements_phase3_status_check,
  drop constraint if exists user_entitlements_phase3_reason_check,
  drop constraint if exists user_entitlements_phase3_version_check,
  add constraint user_entitlements_phase3_status_check
    check (status in ('active', 'paused', 'canceled', 'expired')),
  add constraint user_entitlements_phase3_reason_check
    check (reason is null or char_length(reason) <= 1000),
  add constraint user_entitlements_phase3_version_check
    check (version > 0);

create table if not exists public.entitlement_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  action text not null check (action in ('grant', 'pause', 'resume', 'cancel', 'expire', 'extend', 'adjust')),
  previous_state jsonb not null default '{}'::jsonb,
  new_state jsonb not null default '{}'::jsonb,
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  occurred_at timestamptz not null default now(),
  request_key text not null unique check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  constraint entitlement_history_previous_safe_check check (
    not public.jsonb_has_forbidden_keys(
      previous_state,
      array['email','password','token','api_key','service_role_key','answer','answer_text','student_answer','ip','raw_ip']
    )
  ),
  constraint entitlement_history_new_safe_check check (
    not public.jsonb_has_forbidden_keys(
      new_state,
      array['email','password','token','api_key','service_role_key','answer','answer_text','student_answer','ip','raw_ip']
    )
  )
);

create index if not exists entitlement_history_user_idx
  on public.entitlement_history (user_id, occurred_at desc);

create table if not exists public.plan_catalog (
  plan_code text primary key check (plan_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  display_name text not null check (char_length(display_name) between 2 and 100),
  price_php numeric(10,2) not null check (price_php >= 0 and price_php <= 1000000),
  status text not null default 'draft' check (status in ('draft', 'paused', 'retired')),
  description text not null default '',
  features jsonb not null default '[]'::jsonb check (jsonb_typeof(features) = 'array'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  note text not null default 'DRAFT / NOT ACTIVE — payment integration pending.'
);

insert into public.plan_catalog (plan_code, display_name, price_php, status, description, features)
values
  ('early_access_beta', 'Early Access / Beta', 149.00, 'draft',
   'Planning configuration only. No checkout or payment provider is connected.', '[]'::jsonb),
  ('standard', 'Standard', 249.00, 'draft',
   'Planning configuration only. No checkout or payment provider is connected.', '[]'::jsonb),
  ('premium', 'Premium', 499.00, 'draft',
   'Planning configuration only. No checkout or payment provider is connected.',
   '["All features", "Scheduled in-person coaching", "Direct access"]'::jsonb)
on conflict (plan_code) do nothing;

create table if not exists public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,39}$'),
  state text not null default 'draft' check (state in ('draft', 'active', 'paused', 'expired')),
  discount_type text not null check (discount_type in ('fixed_php', 'percentage')),
  discount_value numeric(10,2) not null,
  plan_code text references public.plan_catalog(plan_code),
  starts_at timestamptz,
  ends_at timestamptz,
  total_limit integer check (total_limit is null or total_limit > 0),
  per_user_limit integer check (per_user_limit is null or per_user_limit > 0),
  internal_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  check (
    (discount_type = 'percentage' and discount_value > 0 and discount_value <= 100)
    or (discount_type = 'fixed_php' and discount_value > 0 and discount_value <= 1000000)
  ),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (char_length(internal_note) <= 2000)
);

create table if not exists public.discount_assignments (
  id uuid primary key default gen_random_uuid(),
  discount_id uuid not null references public.discount_codes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  unique (discount_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Account-recovery case management (identity transfer intentionally disabled)
-- ---------------------------------------------------------------------------

create table if not exists public.account_recovery_cases (
  id uuid primary key default gen_random_uuid(),
  support_request_id uuid not null unique references public.support_requests(id),
  user_id uuid not null references auth.users(id),
  status text not null default 'opened' check (status in (
    'opened', 'verification_in_progress', 'awaiting_super_admin',
    'blocked_identity_handoff_unavailable', 'closed_no_transfer'
  )),
  verification_checklist jsonb not null default '{}'::jsonb
    check (jsonb_typeof(verification_checklist) = 'object'),
  assigned_to uuid references auth.users(id) on delete set null,
  reason text not null check (char_length(btrim(reason)) between 5 and 2000),
  transfer_enabled boolean not null default false check (transfer_enabled = false),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  version integer not null default 1 check (version > 0)
);

create table if not exists public.account_recovery_audit (
  id uuid primary key default gen_random_uuid(),
  recovery_case_id uuid not null references public.account_recovery_cases(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  administrator_user_id uuid not null references auth.users(id),
  previous_email text,
  proposed_email text,
  verification_steps jsonb not null default '{}'::jsonb
    check (jsonb_typeof(verification_steps) = 'object'),
  status text not null check (status in (
    'case_opened', 'verification_updated', 'handoff_blocked', 'case_closed'
  )),
  reason text not null check (char_length(btrim(reason)) between 5 and 2000),
  failure_reason text,
  occurred_at timestamptz not null default now()
);

create index if not exists account_recovery_audit_case_idx
  on public.account_recovery_audit (recovery_case_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Allowlisted website controls and immutable publication history
-- ---------------------------------------------------------------------------

create table if not exists public.website_controls (
  control_key text primary key check (control_key in (
    'announcement_text',
    'beta_label',
    'support_availability_message',
    'pricing_section_visible',
    'promotional_content_visible',
    'future_feature_status'
  )),
  value jsonb not null,
  is_published boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  version integer not null default 1 check (version > 0),
  check (octet_length(value::text) <= 8000),
  constraint website_controls_sensitive_check check (
    not public.jsonb_has_forbidden_keys(
      value,
      array[
        'html','javascript','script','sql','environment','env','api_key',
        'service_role_key','token','password','prompt','grading_prompt',
        'guest_limit','answer','answer_text','student_answer','email','ip','raw_ip'
      ]
    )
  )
);

create table if not exists public.website_control_history (
  id uuid primary key default gen_random_uuid(),
  control_key text not null,
  actor_user_id uuid not null references auth.users(id),
  previous_value jsonb,
  new_value jsonb not null,
  previous_published boolean,
  new_published boolean not null,
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  occurred_at timestamptz not null default now(),
  request_key text not null unique check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  constraint website_control_history_sensitive_check check (
    not public.jsonb_has_forbidden_keys(
      coalesce(previous_value, '{}'::jsonb) || new_value,
      array[
        'html','javascript','script','sql','environment','env','api_key',
        'service_role_key','token','password','prompt','grading_prompt',
        'guest_limit','answer','answer_text','student_answer','email','ip','raw_ip'
      ]
    )
  )
);

-- Expand the immutable audit action vocabulary without weakening its recursive
-- sensitive-data check.
alter table public.admin_audit_log
  drop constraint if exists admin_audit_log_action_type_check;
alter table public.admin_audit_log
  add constraint admin_audit_log_action_type_check check (action_type in (
    'administrator_role_assigned',
    'administrator_role_removed',
    'administrator_role_changed',
    'capability_granted',
    'capability_revoked',
    'user_account_status_changed',
    'subscription_changed',
    'discount_changed',
    'support_case_changed',
    'correction_reviewed',
    'account_recovery_changed',
    'email_searched',
    'email_revealed',
    'aggregate_exported',
    'website_control_changed',
    'content_management_action',
    'security_setting_changed'
  ));

-- Every Phase 3 operational table is backend-only. Browser authorization is
-- enforced by the Worker and repeated inside SECURITY DEFINER functions.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'admin_capabilities',
    'support_request_history',
    'question_correction_history',
    'entitlement_history',
    'plan_catalog',
    'discount_codes',
    'discount_assignments',
    'account_recovery_cases',
    'account_recovery_audit',
    'website_controls',
    'website_control_history'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on public.%I from public, anon, authenticated', v_table);
    execute format('grant select, insert, update, delete on public.%I to service_role', v_table);
  end loop;
end
$$;

revoke all on public.support_requests from public, anon, authenticated;
revoke all on public.question_corrections from public, anon, authenticated;
revoke all on public.user_entitlements from public, anon, authenticated;
grant select, insert, update, delete on public.support_requests to service_role;
grant select, insert, update, delete on public.question_corrections to service_role;
grant select, insert, update, delete on public.user_entitlements to service_role;

-- Plan values are intentionally draft configuration. They are available only
-- through authorized aggregate endpoints and never represent paid revenue.

-- ---------------------------------------------------------------------------
-- Protected aggregate reads
-- ---------------------------------------------------------------------------

create or replace function public.admin_authorization_context(
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_capabilities text[];
begin
  select role into v_role
  from public.user_roles
  where user_id = p_actor_user_id;

  if v_role not in ('admin', 'super_admin') then
    raise exception 'Administrator authorization required';
  end if;

  if v_role = 'super_admin' then
    v_capabilities := array[
      'analytics_viewer',
      'learner_analytics_viewer',
      'support_admin',
      'correction_admin',
      'subscription_admin',
      'account_recovery_admin',
      'advertiser_report_viewer',
      'role_admin'
    ];
  else
    select coalesce(array_agg(capability order by capability), '{}'::text[])
      into v_capabilities
    from public.admin_capabilities
    where user_id = p_actor_user_id
      and revoked_at is null;
  end if;

  return jsonb_build_object(
    'authorized', true,
    'role', v_role,
    'capabilities', to_jsonb(v_capabilities),
    'account_transfer_enabled', false,
    'account_transfer_explanation',
      'Same-UUID Google identity handoff has not been proven safe with the current Supabase configuration.'
  );
end;
$$;

create or replace function public.admin_mask_email(p_email text)
returns text
language sql
immutable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_email is null or position('@' in p_email) <= 1 then 'Not available'
    else left(split_part(p_email, '@', 1), 1)
      || repeat('•', greatest(3, least(10, char_length(split_part(p_email, '@', 1)) - 1)))
      || '@' || split_part(p_email, '@', 2)
  end
$$;

create or replace function public.admin_period_metrics(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_days integer;
  v_result jsonb;
begin
  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'Invalid reporting window';
  end if;
  if p_to - p_from > interval '366 days' then
    raise exception 'Reporting window exceeds 366 days';
  end if;

  v_days := greatest(1, ceil(extract(epoch from (p_to - p_from)) / 86400.0)::integer);

  with
  session_scope as (
    select
      id,
      coalesce(user_id::text, visitor_id::text, anonymous_session_id::text) as audience_id,
      user_id,
      started_at,
      least(
        coalesce(ended_at, last_seen_at),
        started_at + interval '4 hours'
      ) as conservative_end,
      device_category,
      referral_host,
      utm_source,
      utm_medium,
      utm_campaign,
      landing_area
    from public.usage_sessions
    where started_at >= p_from and started_at < p_to
  ),
  event_scope as (
    select *
    from public.usage_events
    where occurred_at >= p_from and occurred_at < p_to
  ),
  all_audience_days as (
    select
      coalesce(user_id::text, anonymous_session_id::text) as audience_id,
      (occurred_at at time zone 'Asia/Manila')::date as activity_date
    from public.usage_events
    where occurred_at < p_to
      and coalesce(user_id::text, anonymous_session_id::text) is not null
    group by 1, 2
  ),
  cohort_first as (
    select audience_id, min(activity_date) as first_activity_date
    from all_audience_days
    group by audience_id
  ),
  retention as (
    select jsonb_object_agg(
      'd' || horizon.days::text,
      jsonb_build_object(
        'matured',
          ((p_to at time zone 'Asia/Manila')::date - horizon.days)
            >= (p_from at time zone 'Asia/Manila')::date,
        'sample_sufficient', cohort.eligible_count >= 5,
        'eligible_cohort', cohort.eligible_count,
        'retained', cohort.retained_count,
        'rate', case when cohort.eligible_count < 5 then null
          else round(cohort.retained_count::numeric / cohort.eligible_count, 4) end
      )
    ) as metrics
    from (values (1), (7), (30)) as horizon(days)
    cross join lateral (
      select
        count(*)::integer as eligible_count,
        count(*) filter (
          where exists (
            select 1
            from all_audience_days retained_day
            where retained_day.audience_id = first_seen.audience_id
              and retained_day.activity_date
                = first_seen.first_activity_date + horizon.days
          )
        )::integer as retained_count
      from cohort_first first_seen
      where first_seen.first_activity_date
        >= (p_from at time zone 'Asia/Manila')::date
        and first_seen.first_activity_date
          <= (p_to at time zone 'Asia/Manila')::date - horizon.days
    ) cohort
  ),
  audience_days as (
    select
      coalesce(user_id::text, anonymous_session_id::text) as audience_id,
      (occurred_at at time zone 'Asia/Manila')::date as activity_date
    from event_scope
    group by 1, 2
  ),
  daily_activity as (
    select count(*)::integer as daily_unique_total
    from audience_days
  ),
  traffic as (
    select
      count(*) filter (where event_type = 'page_view')::integer as page_views,
      count(distinct coalesce(user_id::text, anonymous_session_id::text))::integer as unique_visitors,
      count(*) filter (where event_type = 'registration_completed')::integer as registrations,
      count(*) filter (where event_type = 'onboarding_completed')::integer as onboarding_completions,
      count(*) filter (where event_type = 'guest_first_grade')::integer as guest_first_grade,
      count(*) filter (where event_type = 'guest_third_grade')::integer as guest_third_grade,
      count(*) filter (where event_type = 'guest_limit_reached')::integer as guest_limit_reached,
      count(*) filter (where event_type = 'sign_in_prompted')::integer as sign_in_prompted,
      count(*) filter (where event_type = 'sign_in_started')::integer as sign_in_started,
      count(*) filter (where event_type = 'sign_in_completed')::integer as sign_in_completed,
      count(*) filter (where event_type = 'subject_selected')::integer as subject_selections,
      count(*) filter (where event_type = 'question_viewed')::integer as questions_viewed,
      count(*) filter (where event_type = 'grading_started')::integer as grading_started,
      count(*) filter (where event_type = 'grading_success')::integer as grading_success,
      count(*) filter (where event_type = 'grading_failure')::integer as grading_failure,
      count(*) filter (where event_type = 'grading_timeout')::integer as grading_timeout,
      count(*) filter (where event_type = 'grading_rate_limited')::integer as grading_rate_limited,
      count(*) filter (where event_type = 'support_submitted')::integer as support_submitted,
      count(*) filter (where event_type = 'correction_submitted')::integer as correction_submitted
    from event_scope
  ),
  learning as (
    select
      round(avg(score) filter (where event_type = 'grading_success' and score is not null), 1) as attempt_average,
      round(percentile_cont(0.5) within group (order by score)
        filter (where event_type = 'grading_success' and score is not null)::numeric, 1) as median_score,
      count(*) filter (where event_type = 'grading_success' and score is not null)::integer as score_sample_size
    from event_scope
  ),
  latest_success as (
    select distinct on (audience_id, question_id)
      audience_id, question_id, score
    from (
      select
        coalesce(user_id::text, anonymous_session_id::text) as audience_id,
        question_id,
        score,
        occurred_at
      from event_scope
      where event_type = 'grading_success'
        and score is not null
        and question_id is not null
    ) successful
    order by audience_id, question_id, occurred_at desc
  ),
  repeated_success as (
    select
      coalesce(user_id::text, anonymous_session_id::text) as audience_id,
      question_id,
      (array_agg(score order by occurred_at asc))[1] as first_score,
      (array_agg(score order by occurred_at desc))[1] as latest_score
    from event_scope
    where event_type = 'grading_success'
      and score is not null
      and question_id is not null
    group by 1, 2
    having count(*) > 1
  ),
  mastery as (
    select
      round((select avg(score) from latest_success), 1) as mastery_average,
      (select count(*) from latest_success)::integer as mastery_sample_size,
      round((select avg(latest_score - first_score) from repeated_success), 1)
        as average_improvement,
      (select count(*) from repeated_success)::integer as repeated_question_sample
  ),
  reliability as (
    select
      round(percentile_cont(0.5) within group (order by latency_ms)
        filter (where event_type = 'grading_success' and latency_ms is not null)::numeric)::integer as p50_latency_ms,
      round(percentile_cont(0.95) within group (order by latency_ms)
        filter (where event_type = 'grading_success' and latency_ms is not null)::numeric)::integer as p95_latency_ms,
      max(occurred_at) filter (where event_type = 'grading_success') as last_successful_grade
    from event_scope
  ),
  engagement as (
    select
      count(distinct audience_id) filter (
        where activity_date >= ((p_to at time zone 'Asia/Manila')::date - 1)
      )::integer as dau,
      count(distinct audience_id) filter (
        where activity_date >= ((p_to at time zone 'Asia/Manila')::date - 7)
      )::integer as wau,
      count(distinct audience_id) filter (
        where activity_date >= ((p_to at time zone 'Asia/Manila')::date - 30)
      )::integer as mau,
      count(*) filter (where dates_active > 1)::integer as returning_visitors
    from (
      select audience_id, count(distinct activity_date) as dates_active, max(activity_date) as activity_date
      from audience_days
      group by audience_id
    ) d
  ),
  sessions as (
    select
      count(*)::integer as session_count,
      count(*) filter (where user_id is not null)::integer as authenticated_sessions,
      count(*) filter (where user_id is null)::integer as guest_sessions,
      round(percentile_cont(0.5) within group (
        order by greatest(0, extract(epoch from (conservative_end - started_at)))
      )::numeric)::integer as median_session_seconds
    from session_scope
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'calendar_days', v_days,
    'traffic', jsonb_build_object(
      'page_views', traffic.page_views,
      'unique_visitors', traffic.unique_visitors,
      'sessions', sessions.session_count,
      'average_daily_views', round(traffic.page_views::numeric / v_days, 1),
      'average_daily_unique_visitors', round(daily_activity.daily_unique_total::numeric / v_days, 1),
      'authenticated_sessions', sessions.authenticated_sessions,
      'guest_sessions', sessions.guest_sessions,
      'median_session_seconds', sessions.median_session_seconds,
      'dau', engagement.dau,
      'wau', engagement.wau,
      'mau', engagement.mau,
      'dau_mau_ratio', case when engagement.mau = 0 then null
        else round(engagement.dau::numeric / engagement.mau, 3) end,
      'wau_mau_ratio', case when engagement.mau = 0 then null
        else round(engagement.wau::numeric / engagement.mau, 3) end,
      'returning_visitors', engagement.returning_visitors
    ),
    'funnel', jsonb_build_object(
      'eligible_guest_sessions', sessions.guest_sessions,
      'guest_first_successful_grade', traffic.guest_first_grade,
      'guest_third_successful_grade', traffic.guest_third_grade,
      'limit_reached', traffic.guest_limit_reached,
      'sign_in_prompted', traffic.sign_in_prompted,
      'sign_in_started', traffic.sign_in_started,
      'sign_in_completed', traffic.sign_in_completed,
      'onboarding_completed', traffic.onboarding_completions,
      'registrations', traffic.registrations,
      'registration_conversion_rate', case when traffic.sign_in_prompted = 0 then null
        else round(traffic.registrations::numeric / traffic.sign_in_prompted, 4) end,
      'onboarding_completion_rate', case when traffic.registrations = 0 then null
        else round(traffic.onboarding_completions::numeric / traffic.registrations, 4) end,
      'guest_activation_rate', case when sessions.guest_sessions = 0 then null
        else round(traffic.guest_first_grade::numeric / sessions.guest_sessions, 4) end
    ),
    'retention', retention.metrics,
    'learning', jsonb_build_object(
      'attempt_average', learning.attempt_average,
      'mastery_average', mastery.mastery_average,
      'mastery_sample_size', mastery.mastery_sample_size,
      'average_improvement', mastery.average_improvement,
      'repeated_question_sample', mastery.repeated_question_sample,
      'median_score', learning.median_score,
      'sample_size', learning.score_sample_size,
      'questions_viewed', traffic.questions_viewed,
      'successful_grades', traffic.grading_success,
      'questions_per_active_user', case when traffic.unique_visitors = 0 then null
        else round(traffic.questions_viewed::numeric / traffic.unique_visitors, 2) end,
      'successful_grades_per_active_user', case when traffic.unique_visitors = 0 then null
        else round(traffic.grading_success::numeric / traffic.unique_visitors, 2) end
    ),
    'reliability', jsonb_build_object(
      'grading_started', traffic.grading_started,
      'grading_success', traffic.grading_success,
      'grading_failure', traffic.grading_failure,
      'grading_timeout', traffic.grading_timeout,
      'grading_rate_limited', traffic.grading_rate_limited,
      'success_rate', case when traffic.grading_started = 0 then null
        else round(traffic.grading_success::numeric / traffic.grading_started, 4) end,
      'p50_latency_ms', reliability.p50_latency_ms,
      'p95_latency_ms', reliability.p95_latency_ms,
      'last_successful_grade', reliability.last_successful_grade
    ),
    'operations', jsonb_build_object(
      'support_submitted', traffic.support_submitted,
      'correction_submitted', traffic.correction_submitted
    )
  )
  into v_result
  from traffic, learning, mastery, reliability, engagement, sessions, daily_activity, retention;

  return v_result;
end;
$$;

create or replace function public.admin_dashboard_snapshot(
  p_actor_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_previous_from timestamptz,
  p_previous_to timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth jsonb;
  v_current jsonb;
  v_previous jsonb;
  v_collection_start timestamptz;
  v_subjects jsonb;
  v_models jsonb;
  v_sources jsonb;
  v_device_mix jsonb;
begin
  v_auth := public.admin_authorization_context(p_actor_user_id);
  if not public.admin_has_capability(p_actor_user_id, 'analytics_viewer') then
    raise exception 'Analytics capability required';
  end if;
  if p_previous_from is null or p_previous_to is null then
    raise exception 'Comparison window is required';
  end if;

  v_current := public.admin_period_metrics(p_from, p_to);
  v_previous := public.admin_period_metrics(p_previous_from, p_previous_to);

  select least(
    coalesce((select min(started_at) from public.usage_sessions), 'infinity'::timestamptz),
    coalesce((select min(occurred_at) from public.usage_events), 'infinity'::timestamptz)
  ) into v_collection_start;
  if v_collection_start = 'infinity'::timestamptz then
    v_collection_start := null;
  end if;

  select coalesce(jsonb_agg(row_value order by subject), '[]'::jsonb)
  into v_subjects
  from (
    select
      subject,
      jsonb_build_object(
        'subject', subject,
        'question_views', count(*) filter (where event_type = 'question_viewed'),
        'grading_starts', count(*) filter (where event_type = 'grading_started'),
        'successful_grades', count(*) filter (where event_type = 'grading_success'),
        'failures', count(*) filter (where event_type in ('grading_failure','grading_timeout','grading_rate_limited')),
        'attempt_average', round(avg(score) filter (where event_type = 'grading_success' and score is not null), 1),
        'sample_size', count(*) filter (where event_type = 'grading_success' and score is not null),
        'low_sample', count(*) filter (where event_type = 'grading_success' and score is not null) < 5
      ) as row_value
    from public.usage_events
    where occurred_at >= p_from and occurred_at < p_to
      and subject is not null
    group by subject
  ) s;

  select coalesce(jsonb_agg(row_value order by model_name), '[]'::jsonb)
  into v_models
  from (
    select
      coalesce(model_name, 'Not reported') as model_name,
      jsonb_build_object(
        'model', coalesce(model_name, 'Not reported'),
        'successful_grades', count(*) filter (where event_type = 'grading_success'),
        'failures', count(*) filter (where event_type in ('grading_failure','grading_timeout','grading_rate_limited')),
        'p95_latency_ms', round(percentile_cont(0.95) within group (order by latency_ms)
          filter (where latency_ms is not null)::numeric)::integer
      ) as row_value
    from public.usage_events
    where occurred_at >= p_from and occurred_at < p_to
      and event_type like 'grading_%'
    group by coalesce(model_name, 'Not reported')
  ) m;

  select coalesce(jsonb_agg(row_value order by sessions desc), '[]'::jsonb)
  into v_sources
  from (
    select
      coalesce(utm_source, referral_host, 'Direct / unavailable') as source,
      count(*)::integer as sessions,
      jsonb_build_object(
        'source', coalesce(utm_source, referral_host, 'Direct / unavailable'),
        'medium', coalesce(utm_medium, 'Not available'),
        'sessions', count(*)
      ) as row_value
    from public.usage_sessions
    where started_at >= p_from and started_at < p_to
    group by coalesce(utm_source, referral_host, 'Direct / unavailable'), coalesce(utm_medium, 'Not available')
    limit 20
  ) a;

  select coalesce(jsonb_agg(row_value order by sessions desc), '[]'::jsonb)
  into v_device_mix
  from (
    select
      coalesce(device_category, 'unknown') as category,
      count(*)::integer as sessions,
      jsonb_build_object(
        'category', coalesce(device_category, 'unknown'),
        'sessions', count(*)
      ) as row_value
    from public.usage_sessions
    where started_at >= p_from and started_at < p_to
    group by coalesce(device_category, 'unknown')
  ) d;

  return jsonb_build_object(
    'authorization', v_auth,
    'meta', jsonb_build_object(
      'timezone', 'Asia/Manila',
      'generated_at', now(),
      'data_collection_start', v_collection_start,
      'freshness', case when v_collection_start is null then 'No verified analytics events yet' else 'Live operational data' end,
      'heartbeat_seconds', 90,
      'current_viewer_window_minutes', 5,
      'privacy_threshold', 5
    ),
    'current', v_current,
    'previous', v_previous,
    'realtime', jsonb_build_object(
      'current_viewers', (
        select count(distinct coalesce(user_id::text, visitor_id::text, anonymous_session_id::text))
        from public.usage_sessions
        where ended_at is null
          and last_seen_at >= now() - interval '5 minutes'
      )
    ),
    'inventory', jsonb_build_object(
      'database_subjects', (select count(*) from public.subjects),
      'database_questions', (select count(*) from public.questions)
    ),
    'queues', jsonb_build_object(
      'pending_support', (
        select count(*) from public.support_requests
        where status in ('pending', 'in_progress', 'waiting_for_student')
      ),
      'pending_corrections', (
        select count(*) from public.question_corrections where status = 'pending'
      ),
      'open_recovery_cases', (
        select count(*) from public.account_recovery_cases
        where status <> 'closed_no_transfer'
      ),
      'active_manual_entitlements', (
        select count(*) from public.user_entitlements
        where status = 'active'
          and effective_from <= now()
          and (effective_until is null or effective_until > now())
      )
    ),
    'subjects', v_subjects,
    'models', v_models,
    'acquisition', v_sources,
    'devices', v_device_mix,
    'financial', jsonb_build_object(
      'paid_subscribers', null,
      'paid_subscribers_status', 'Not connected — payment integration pending.',
      'revenue', null,
      'mrr', null,
      'arr', null,
      'arpu', null,
      'paid_churn', null,
      'advertising_impressions', null,
      'advertising_clicks', null,
      'advertising_ctr', null,
      'sponsorship_income', null,
      'manual_access_notice', 'Manual access control — no payment provider is connected.'
    )
  );
end;
$$;

revoke all on function public.admin_authorization_context(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_mask_email(text)
  from public, anon, authenticated;
revoke all on function public.admin_period_metrics(timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.admin_dashboard_snapshot(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.admin_authorization_context(uuid) to service_role;
grant execute on function public.admin_mask_email(text) to service_role;
grant execute on function public.admin_period_metrics(timestamptz, timestamptz) to service_role;
grant execute on function public.admin_dashboard_snapshot(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz
) to service_role;

create or replace function public.admin_operational_data(
  p_actor_user_id uuid,
  p_section text,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_capability text;
begin
  perform public.admin_authorization_context(p_actor_user_id);
  v_capability := case p_section
    when 'users' then 'analytics_viewer'
    when 'learning' then 'learner_analytics_viewer'
    when 'support' then 'support_admin'
    when 'corrections' then 'correction_admin'
    when 'subscriptions' then 'subscription_admin'
    when 'recovery' then 'account_recovery_admin'
    when 'advertiser' then 'advertiser_report_viewer'
    when 'controls' then 'role_admin'
    when 'security' then 'role_admin'
    else null
  end;
  if v_capability is null or not public.admin_has_capability(p_actor_user_id, v_capability) then
    raise exception 'Required capability is missing';
  end if;

  if p_section = 'users' then
    select count(*) into v_total
    from public.profiles p
    join auth.users u on u.id = p.id
    where nullif(btrim(p_search), '') is null
      or p.display_name ilike '%' || btrim(p_search) || '%'
      or p.school ilike '%' || btrim(p_search) || '%';

    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      into v_items
    from (
      select
        p.id,
        p.display_name,
        p.school,
        p.enrollment_status,
        p.year_level,
        p.created_at,
        p.profile_completed_at,
        public.admin_mask_email(u.email) as masked_email,
        coalesce(r.role, 'student') as role,
        e.plan_code,
        e.status as entitlement_status,
        (
          select max(s.last_seen_at) from public.usage_sessions s where s.user_id = p.id
        ) as last_active_at,
        (
          select count(*) from public.usage_sessions s where s.user_id = p.id
        ) as session_count,
        (
          select count(*) from public.usage_events ev
          where ev.user_id = p.id and ev.event_type = 'grading_success'
        ) as successful_grade_count,
        (
          select mc.opted_in from public.marketing_consents mc
          where mc.user_id = p.id order by mc.changed_at desc limit 1
        ) as marketing_consent
      from public.profiles p
      join auth.users u on u.id = p.id
      left join public.user_roles r on r.user_id = p.id
      left join public.user_entitlements e on e.user_id = p.id
      where nullif(btrim(p_search), '') is null
        or p.display_name ilike '%' || btrim(p_search) || '%'
        or p.school ilike '%' || btrim(p_search) || '%'
      order by p.created_at desc
      limit v_limit offset v_offset
    ) x;
  elsif p_section = 'learning' then
    select count(distinct user_id) into v_total
    from public.usage_events
    where user_id is not null and event_type = 'grading_success';
    select coalesce(jsonb_agg(to_jsonb(x) order by x.last_attempt_at desc), '[]'::jsonb)
      into v_items
    from (
      select
        p.id,
        p.display_name,
        p.school,
        public.admin_mask_email(u.email) as masked_email,
        round(avg(ev.score), 1) as attempt_average,
        count(*) as successful_attempts,
        count(distinct ev.question_id) as unique_questions,
        max(ev.occurred_at) as last_attempt_at
      from public.usage_events ev
      join public.profiles p on p.id = ev.user_id
      join auth.users u on u.id = p.id
      where ev.event_type = 'grading_success' and ev.score is not null
      group by p.id, p.display_name, p.school, u.email
      order by max(ev.occurred_at) desc
      limit v_limit offset v_offset
    ) x;
  elsif p_section = 'support' then
    select count(*) into v_total from public.support_requests;
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb)
      into v_items
    from (
      select
        s.id, s.category, s.message, s.status, s.priority, s.assigned_to,
        s.created_at, s.updated_at, s.first_responded_at, s.resolved_at,
        s.internal_note,
        extract(epoch from (now() - s.created_at))::integer as age_seconds,
        s.first_responded_at is null
          and s.status not in ('resolved', 'closed')
          and s.created_at < now() - interval '24 hours' as overdue_24h
      from public.support_requests s
      order by
        case s.priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,
        s.created_at
      limit v_limit offset v_offset
    ) x;
  elsif p_section = 'corrections' then
    select count(*) into v_total from public.question_corrections;
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb)
      into v_items
    from (
      select
        id, question_bank_id, subject, correction_type, proposed_correction,
        explanation, source_urls, status, priority, assigned_to, reviewer_note,
        created_at, updated_at, reviewed_at
      from public.question_corrections
      order by case priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,
        created_at
      limit v_limit offset v_offset
    ) x;
  elsif p_section = 'subscriptions' then
    select count(*) into v_total from public.user_entitlements;
    select coalesce(jsonb_agg(to_jsonb(x) order by x.updated_at desc), '[]'::jsonb)
      into v_items
    from (
      select
        e.user_id, p.display_name, public.admin_mask_email(u.email) as masked_email,
        e.plan_code, e.status, e.questions_per_subject_per_day,
        e.effective_from, e.effective_until, e.source, e.updated_at, e.version
      from public.user_entitlements e
      join auth.users u on u.id = e.user_id
      left join public.profiles p on p.id = e.user_id
      order by e.updated_at desc
      limit v_limit offset v_offset
    ) x;
  elsif p_section = 'recovery' then
    select count(*) into v_total from public.account_recovery_cases;
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      into v_items
    from (
      select
        c.id, c.support_request_id, c.user_id, c.status,
        c.verification_checklist, c.assigned_to, c.reason,
        c.transfer_enabled, c.created_at, c.updated_at, c.closed_at, c.version
      from public.account_recovery_cases c
      order by c.created_at desc
      limit v_limit offset v_offset
    ) x;
  elsif p_section = 'advertiser' then
    select count(*) into v_total from public.profiles where profile_completed_at is not null;
    select coalesce(jsonb_agg(to_jsonb(x) order by x.member_count desc), '[]'::jsonb)
      into v_items
    from (
      select
        case when count(*) < 5 then 'Suppressed (fewer than 5)' else coalesce(school, 'Not provided') end as school,
        case when count(*) < 5 then null else count(*) end as member_count
      from public.profiles
      where profile_completed_at is not null
      group by school
      order by count(*) desc
      limit v_limit
    ) x;
  elsif p_section = 'controls' then
    select count(*) into v_total from public.website_controls;
    select coalesce(jsonb_agg(to_jsonb(x) order by x.control_key), '[]'::jsonb)
      into v_items
    from (
      select control_key, value, is_published, updated_at, updated_by, version
      from public.website_controls
      order by control_key
      limit v_limit offset v_offset
    ) x;
  elsif p_section = 'security' then
    select count(*) into v_total from public.admin_audit_log;
    select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at desc), '[]'::jsonb)
      into v_items
    from (
      select
        a.id, a.actor_user_id, a.action_type, a.target_user_id,
        a.target_resource_type, a.target_resource_id, a.reason,
        a.details, a.occurred_at
      from public.admin_audit_log a
      order by a.occurred_at desc
      limit v_limit offset v_offset
    ) x;
  end if;

  return jsonb_build_object(
    'section', p_section,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'items', v_items
  );
end;
$$;

create or replace function public.admin_reveal_user_email(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
begin
  if not public.admin_has_capability(p_actor_user_id, 'learner_analytics_viewer') then
    raise exception 'Learner analytics capability required';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A reason is required';
  end if;
  select email into v_email from auth.users where id = p_target_user_id;
  if v_email is null then
    raise exception 'User not found';
  end if;

  insert into public.admin_audit_log (
    actor_user_id, action_type, target_user_id, target_resource_type,
    target_resource_id, reason, details
  ) values (
    p_actor_user_id, 'email_revealed', p_target_user_id, 'auth_identity',
    p_target_user_id::text, btrim(p_reason),
    jsonb_build_object('email_revealed', true)
  );

  return jsonb_build_object('user_id', p_target_user_id, 'email', v_email);
end;
$$;

create or replace function public.admin_find_user_by_email(
  p_actor_user_id uuid,
  p_email text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_display_name text;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not public.admin_has_capability(p_actor_user_id, 'learner_analytics_viewer') then
    raise exception 'Learner analytics capability required';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A reason is required';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'A valid exact email is required';
  end if;

  select u.id, p.display_name into v_user_id, v_display_name
  from auth.users u
  left join public.profiles p on p.id = u.id
  where lower(u.email) = v_email
  limit 1;

  insert into public.admin_audit_log (
    actor_user_id, action_type, target_user_id, target_resource_type,
    target_resource_id, reason, details
  ) values (
    p_actor_user_id, 'email_searched', v_user_id, 'auth_identity',
    coalesce(v_user_id::text, 'no_match'), btrim(p_reason),
    jsonb_build_object('exact_email_search', true, 'match_found', v_user_id is not null)
  );

  return jsonb_build_object(
    'found', v_user_id is not null,
    'user_id', v_user_id,
    'display_name', v_display_name,
    'masked_email', case when v_user_id is null then null else public.admin_mask_email(v_email) end
  );
end;
$$;

revoke all on function public.admin_operational_data(uuid, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.admin_reveal_user_email(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.admin_find_user_by_email(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_operational_data(uuid, text, text, integer, integer)
  to service_role;
grant execute on function public.admin_reveal_user_email(uuid, uuid, text)
  to service_role;
grant execute on function public.admin_find_user_by_email(uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Narrow, audited, idempotent administrator mutations
-- ---------------------------------------------------------------------------

create table if not exists public.admin_action_requests (
  request_key text primary key check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  actor_user_id uuid not null references auth.users(id),
  action text not null,
  target_resource_id text,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.admin_action_requests enable row level security;
revoke all on public.admin_action_requests from public, anon, authenticated;
grant select, insert, update on public.admin_action_requests to service_role;

create or replace function public.admin_execute_action(
  p_actor_user_id uuid,
  p_action text,
  p_target_id uuid,
  p_payload jsonb,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_inserted integer := 0;
  v_existing jsonb;
  v_result jsonb;
  v_previous jsonb;
  v_new jsonb;
  v_status text;
  v_priority text;
  v_assigned_to uuid;
  v_action_name text;
  v_target_user_id uuid;
  v_control_key text;
  v_code text;
  v_recovery_case_id uuid;
begin
  perform public.admin_authorization_context(p_actor_user_id);
  if p_request_key is null or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Invalid request key';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A reason is required';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Action payload must be an object';
  end if;

  insert into public.admin_action_requests (
    request_key, actor_user_id, action, target_resource_id
  ) values (
    p_request_key, p_actor_user_id, p_action, p_target_id::text
  )
  on conflict (request_key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select result into v_existing
    from public.admin_action_requests
    where request_key = p_request_key
      and actor_user_id = p_actor_user_id
      and action = p_action;
    if not found then
      raise exception 'Request key conflict';
    end if;
    if v_existing is null then
      raise exception 'Action is already in progress';
    end if;
    return v_existing || jsonb_build_object('replayed', true);
  end if;

  perform pg_advisory_xact_lock(hashtext(coalesce(p_target_id::text, '') || ':' || p_action));

  if p_action = 'support_update' then
    if not public.admin_has_capability(p_actor_user_id, 'support_admin') then
      raise exception 'Support capability required';
    end if;
    select to_jsonb(s) into v_previous
    from public.support_requests s where id = p_target_id for update;
    if v_previous is null then raise exception 'Support case not found'; end if;
    v_status := coalesce(p_payload->>'status', v_previous->>'status');
    v_priority := coalesce(p_payload->>'priority', v_previous->>'priority');
    v_assigned_to := nullif(p_payload->>'assigned_to', '')::uuid;
    if v_status not in ('pending', 'in_progress', 'waiting_for_student', 'resolved', 'closed')
       or v_priority not in ('low', 'normal', 'high', 'urgent') then
      raise exception 'Invalid support status or priority';
    end if;
    update public.support_requests
    set status = v_status,
        priority = v_priority,
        assigned_to = coalesce(v_assigned_to, assigned_to),
        internal_note = nullif(p_payload->>'internal_note', ''),
        first_responded_at = case
          when first_responded_at is null and v_status <> 'pending' then now()
          else first_responded_at end,
        resolved_at = case when v_status in ('resolved', 'closed') then coalesce(resolved_at, now()) else null end,
        updated_at = now()
    where id = p_target_id
    returning to_jsonb(support_requests.*) into v_new;
    insert into public.support_request_history (
      support_request_id, actor_user_id, previous_status, new_status,
      previous_priority, new_priority, assigned_to, internal_note, reason
    ) values (
      p_target_id, p_actor_user_id, v_previous->>'status', v_status,
      v_previous->>'priority', v_priority, v_assigned_to,
      nullif(p_payload->>'internal_note', ''), btrim(p_reason)
    );
    v_action_name := 'support_case_changed';

  elsif p_action = 'correction_review' then
    if not public.admin_has_capability(p_actor_user_id, 'correction_admin') then
      raise exception 'Correction capability required';
    end if;
    select to_jsonb(c) into v_previous
    from public.question_corrections c where id = p_target_id for update;
    if v_previous is null then raise exception 'Correction not found'; end if;
    v_status := p_payload->>'status';
    if v_status not in ('pending', 'accepted', 'rejected') then
      raise exception 'Invalid correction status';
    end if;
    v_assigned_to := nullif(p_payload->>'assigned_to', '')::uuid;
    update public.question_corrections
    set status = v_status,
        assigned_to = coalesce(v_assigned_to, assigned_to),
        reviewer_note = nullif(p_payload->>'reviewer_note', ''),
        reviewed_at = case when v_status in ('accepted', 'rejected') then now() else null end,
        updated_at = now()
    where id = p_target_id
    returning to_jsonb(question_corrections.*) into v_new;
    insert into public.question_correction_history (
      correction_id, actor_user_id, previous_status, new_status,
      assigned_to, reviewer_note, reason
    ) values (
      p_target_id, p_actor_user_id, v_previous->>'status', v_status,
      v_assigned_to, nullif(p_payload->>'reviewer_note', ''), btrim(p_reason)
    );
    v_action_name := 'correction_reviewed';

  elsif p_action = 'entitlement_change' then
    if not public.admin_has_capability(p_actor_user_id, 'subscription_admin') then
      raise exception 'Subscription capability required';
    end if;
    v_target_user_id := p_target_id;
    if not exists (select 1 from auth.users where id = v_target_user_id) then
      raise exception 'User not found';
    end if;
    select to_jsonb(e) into v_previous
    from public.user_entitlements e where user_id = v_target_user_id for update;
    v_status := coalesce(p_payload->>'status', 'active');
    v_action_name := coalesce(p_payload->>'entitlement_action', 'adjust');
    if v_status not in ('active', 'paused', 'canceled', 'expired')
       or v_action_name not in ('grant', 'pause', 'resume', 'cancel', 'expire', 'extend', 'adjust') then
      raise exception 'Invalid entitlement action';
    end if;
    insert into public.user_entitlements (
      user_id, plan_code, questions_per_subject_per_day,
      effective_from, effective_until, source, updated_at, updated_by,
      status, paused_at, canceled_at, reason, version
    ) values (
      v_target_user_id,
      coalesce(nullif(p_payload->>'plan_code', ''), 'manual_beta'),
      nullif(p_payload->>'questions_per_subject_per_day', '')::integer,
      coalesce(nullif(p_payload->>'effective_from', '')::timestamptz, now()),
      nullif(p_payload->>'effective_until', '')::timestamptz,
      'manual_admin',
      now(),
      p_actor_user_id,
      v_status,
      case when v_status = 'paused' then now() else null end,
      case when v_status = 'canceled' then now() else null end,
      btrim(p_reason),
      1
    )
    on conflict (user_id) do update set
      plan_code = excluded.plan_code,
      questions_per_subject_per_day = excluded.questions_per_subject_per_day,
      effective_from = excluded.effective_from,
      effective_until = excluded.effective_until,
      source = excluded.source,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by,
      status = excluded.status,
      paused_at = excluded.paused_at,
      canceled_at = excluded.canceled_at,
      reason = excluded.reason,
      version = user_entitlements.version + 1
    returning to_jsonb(user_entitlements.*) into v_new;
    insert into public.entitlement_history (
      user_id, actor_user_id, action, previous_state, new_state, reason, request_key
    ) values (
      v_target_user_id, p_actor_user_id, v_action_name,
      coalesce(v_previous, '{}'::jsonb), v_new, btrim(p_reason), p_request_key
    );
    v_action_name := 'subscription_changed';

  elsif p_action = 'capability_change' then
    select role into v_role from public.user_roles where user_id = p_actor_user_id;
    if v_role <> 'super_admin' then
      raise exception 'Only the Super Admin may change capabilities';
    end if;
    v_target_user_id := p_target_id;
    if v_target_user_id = p_actor_user_id then
      raise exception 'Self-directed capability changes are not allowed';
    end if;
    if not exists (
      select 1 from public.user_roles where user_id = v_target_user_id and role = 'admin'
    ) then
      raise exception 'Capabilities may be assigned only to verified administrators';
    end if;
    if not (p_payload->>'capability' = any(array[
      'analytics_viewer','learner_analytics_viewer','support_admin','correction_admin',
      'subscription_admin','account_recovery_admin','advertiser_report_viewer','role_admin'
    ])) then
      raise exception 'Invalid capability';
    end if;
    if coalesce((p_payload->>'grant')::boolean, false) then
      insert into public.admin_capabilities (
        user_id, capability, granted_by, reason, granted_at, revoked_at, revoked_by, revoke_reason
      ) values (
        v_target_user_id, p_payload->>'capability', p_actor_user_id, btrim(p_reason),
        now(), null, null, null
      )
      on conflict (user_id, capability) do update set
        granted_by = excluded.granted_by,
        reason = excluded.reason,
        granted_at = excluded.granted_at,
        revoked_at = null,
        revoked_by = null,
        revoke_reason = null;
      v_action_name := 'capability_granted';
    else
      update public.admin_capabilities
      set revoked_at = now(), revoked_by = p_actor_user_id, revoke_reason = btrim(p_reason)
      where user_id = v_target_user_id and capability = p_payload->>'capability';
      if not found then raise exception 'Capability assignment not found'; end if;
      v_action_name := 'capability_revoked';
    end if;
    v_new := jsonb_build_object(
      'user_id', v_target_user_id,
      'capability', p_payload->>'capability',
      'active', coalesce((p_payload->>'grant')::boolean, false)
    );

  elsif p_action = 'role_change' then
    select role into v_role from public.user_roles where user_id = p_actor_user_id;
    if v_role <> 'super_admin' then
      raise exception 'Only the Super Admin may change administrator roles';
    end if;
    v_target_user_id := p_target_id;
    if v_target_user_id = p_actor_user_id then
      raise exception 'Self-directed role changes are not allowed';
    end if;
    if p_payload->>'role' not in ('student', 'admin') then
      raise exception 'Only student or admin roles may be assigned';
    end if;
    select to_jsonb(r) into v_previous from public.user_roles r
    where user_id = v_target_user_id for update;
    if v_previous->>'role' = 'super_admin' then
      raise exception 'The Super Admin role cannot be changed';
    end if;
    insert into public.user_roles (user_id, role, assigned_by, updated_at)
    values (v_target_user_id, p_payload->>'role', p_actor_user_id, now())
    on conflict (user_id) do update
    set role = excluded.role, assigned_by = excluded.assigned_by, updated_at = excluded.updated_at;
    v_new := jsonb_build_object('user_id', v_target_user_id, 'role', p_payload->>'role');
    v_action_name := case when p_payload->>'role' = 'admin'
      then 'administrator_role_assigned' else 'administrator_role_removed' end;

  elsif p_action = 'discount_upsert' then
    if not public.admin_has_capability(p_actor_user_id, 'subscription_admin') then
      raise exception 'Subscription capability required';
    end if;
    v_code := upper(btrim(p_payload->>'code'));
    if v_code !~ '^[A-Z0-9][A-Z0-9_-]{2,39}$' then raise exception 'Invalid discount code'; end if;
    insert into public.discount_codes (
      id, code, state, discount_type, discount_value, plan_code,
      starts_at, ends_at, total_limit, per_user_limit, internal_note, updated_at, updated_by
    ) values (
      coalesce(p_target_id, gen_random_uuid()), v_code, coalesce(p_payload->>'state', 'draft'),
      p_payload->>'discount_type', (p_payload->>'discount_value')::numeric,
      nullif(p_payload->>'plan_code', ''),
      nullif(p_payload->>'starts_at', '')::timestamptz,
      nullif(p_payload->>'ends_at', '')::timestamptz,
      nullif(p_payload->>'total_limit', '')::integer,
      nullif(p_payload->>'per_user_limit', '')::integer,
      coalesce(p_payload->>'internal_note', ''), now(), p_actor_user_id
    )
    on conflict (code) do update set
      state = excluded.state,
      discount_type = excluded.discount_type,
      discount_value = excluded.discount_value,
      plan_code = excluded.plan_code,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      total_limit = excluded.total_limit,
      per_user_limit = excluded.per_user_limit,
      internal_note = excluded.internal_note,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
    returning jsonb_build_object('id', id, 'code', code, 'state', state) into v_new;
    v_action_name := 'discount_changed';

  elsif p_action = 'website_control_update' then
    if not public.admin_has_capability(p_actor_user_id, 'role_admin') then
      raise exception 'Website-control authorization required';
    end if;
    v_control_key := p_payload->>'control_key';
    if v_control_key not in (
      'announcement_text','beta_label','support_availability_message',
      'pricing_section_visible','promotional_content_visible','future_feature_status'
    ) then
      raise exception 'Control is not allowlisted';
    end if;
    if public.jsonb_has_forbidden_keys(
      coalesce(p_payload->'value', '{}'::jsonb),
      array['html','javascript','script','sql','environment','env','api_key','service_role_key',
        'token','password','prompt','grading_prompt','guest_limit','answer','answer_text',
        'student_answer','email','ip','raw_ip']
    ) then
      raise exception 'Unsafe website-control content';
    end if;
    select to_jsonb(w) into v_previous from public.website_controls w
    where control_key = v_control_key for update;
    insert into public.website_controls (
      control_key, value, is_published, updated_at, updated_by, version
    ) values (
      v_control_key, p_payload->'value', coalesce((p_payload->>'is_published')::boolean, false),
      now(), p_actor_user_id, 1
    )
    on conflict (control_key) do update set
      value = excluded.value,
      is_published = excluded.is_published,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by,
      version = website_controls.version + 1
    returning to_jsonb(website_controls.*) into v_new;
    insert into public.website_control_history (
      control_key, actor_user_id, previous_value, new_value,
      previous_published, new_published, reason, request_key
    ) values (
      v_control_key, p_actor_user_id, v_previous->'value', v_new->'value',
      (v_previous->>'is_published')::boolean, (v_new->>'is_published')::boolean,
      btrim(p_reason), p_request_key
    );
    v_action_name := 'website_control_changed';

  elsif p_action = 'recovery_case_update' then
    if not public.admin_has_capability(p_actor_user_id, 'account_recovery_admin') then
      raise exception 'Account-recovery capability required';
    end if;
    if coalesce((p_payload->>'attempt_transfer')::boolean, false) then
      raise exception 'Final identity transfer is disabled until same-UUID Google handoff is proven';
    end if;
    if p_target_id is null then
      if not exists (
        select 1 from public.support_requests
        where id = (p_payload->>'support_request_id')::uuid
          and category = 'account_recovery'
      ) then
        raise exception 'A native Account Recovery support case is required';
      end if;
      insert into public.account_recovery_cases (
        support_request_id, user_id, status, verification_checklist,
        assigned_to, reason
      ) values (
        (p_payload->>'support_request_id')::uuid,
        (p_payload->>'user_id')::uuid,
        'opened',
        coalesce(p_payload->'verification_checklist', '{}'::jsonb),
        p_actor_user_id,
        btrim(p_reason)
      ) returning id into v_recovery_case_id;
    else
      update public.account_recovery_cases
      set status = coalesce(p_payload->>'status', status),
          verification_checklist = coalesce(p_payload->'verification_checklist', verification_checklist),
          assigned_to = coalesce(nullif(p_payload->>'assigned_to', '')::uuid, assigned_to),
          reason = btrim(p_reason),
          updated_at = now(),
          closed_at = case when p_payload->>'status' = 'closed_no_transfer' then now() else closed_at end,
          version = version + 1
      where id = p_target_id
      returning id into v_recovery_case_id;
      if v_recovery_case_id is null then raise exception 'Recovery case not found'; end if;
    end if;
    insert into public.account_recovery_audit (
      recovery_case_id, user_id, administrator_user_id,
      previous_email, proposed_email, verification_steps, status, reason, failure_reason
    )
    select
      c.id, c.user_id, p_actor_user_id,
      nullif(p_payload->>'previous_email', ''),
      nullif(p_payload->>'proposed_email', ''),
      coalesce(p_payload->'verification_checklist', '{}'::jsonb),
      case
        when p_payload->>'status' = 'closed_no_transfer' then 'case_closed'
        when p_payload->>'status' = 'blocked_identity_handoff_unavailable' then 'handoff_blocked'
        when p_target_id is null then 'case_opened'
        else 'verification_updated'
      end,
      btrim(p_reason),
      nullif(p_payload->>'failure_reason', '')
    from public.account_recovery_cases c where c.id = v_recovery_case_id;
    v_new := jsonb_build_object(
      'case_id', v_recovery_case_id,
      'transfer_enabled', false,
      'status', coalesce(p_payload->>'status', 'opened')
    );
    v_action_name := 'account_recovery_changed';

  elsif p_action = 'aggregate_export' then
    if not public.admin_has_capability(p_actor_user_id, 'advertiser_report_viewer') then
      raise exception 'Advertiser-report capability required';
    end if;
    v_new := jsonb_build_object('authorized', true, 'aggregate_only', true);
    v_action_name := 'aggregate_exported';
  else
    raise exception 'Unsupported administrator action';
  end if;

  insert into public.admin_audit_log (
    actor_user_id, action_type, target_user_id, target_resource_type,
    target_resource_id, reason, details
  ) values (
    p_actor_user_id, v_action_name,
    case when p_action in ('entitlement_change','capability_change','role_change') then v_target_user_id else null end,
    p_action,
    coalesce(p_target_id::text, v_new->>'id', v_new->>'case_id', v_new->>'user_id', v_control_key, v_code),
    btrim(p_reason),
    jsonb_strip_nulls(jsonb_build_object(
      'request_key', p_request_key,
      'action', p_action,
      'status', v_new->>'status',
      'role', v_new->>'role',
      'capability', v_new->>'capability',
      'control_key', v_control_key,
      'discount_code', v_code,
      'transfer_enabled', case when p_action = 'recovery_case_update' then false else null end
    ))
  );

  v_result := jsonb_build_object(
    'ok', true,
    'action', p_action,
    'request_key', p_request_key,
    'result', coalesce(v_new, '{}'::jsonb),
    'replayed', false
  );
  update public.admin_action_requests
  set result = v_result, completed_at = now()
  where request_key = p_request_key;
  return v_result;
end;
$$;

revoke all on function public.admin_execute_action(uuid, text, uuid, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_execute_action(uuid, text, uuid, jsonb, text, text)
  to service_role;

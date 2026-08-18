-- Install private Retainer choice schema and preserve the current access resolver.
-- Split from the reviewed explicit Retainer choice release for rolling safety.

begin;

alter table public.platform_access_settings
  add column if not exists mandatory_access_choice_enabled boolean not null default false,
  add column if not exists launch_trial_ends_at timestamptz not null
    default '2026-09-01 23:59:59+08'::timestamptz;

alter table public.platform_access_settings
  drop constraint if exists platform_access_settings_launch_trial_date_check;
alter table public.platform_access_settings
  add constraint platform_access_settings_launch_trial_date_check check (
    launch_trial_ends_at <= early_access_entitlement_ends_at
  );

create table if not exists public.commercial_access_choices (
  user_id uuid primary key references auth.users(id) on delete cascade,
  choice text not null check (choice in ('launch_trial', 'early_access')),
  selected_at timestamptz not null default now(),
  trial_started_at timestamptz,
  trial_expires_at timestamptz,
  request_key text,
  choice_source text not null default 'user' check (
    choice_source in (
      'user', 'payment_submission', 'existing_subscription', 'existing_payment'
    )
  ),
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (trial_started_at is null and trial_expires_at is null)
    or (
      trial_started_at is not null
      and trial_expires_at is not null
      and trial_expires_at > trial_started_at
    )
  ),
  check (request_key is null or request_key ~ '^[A-Za-z0-9_-]{16,128}$')
);

create unique index if not exists commercial_access_choices_request_key_uidx
  on public.commercial_access_choices (request_key)
  where request_key is not null;
create index if not exists commercial_access_choices_choice_idx
  on public.commercial_access_choices (choice, selected_at desc);

alter table public.commercial_access_choices enable row level security;
alter table public.commercial_access_choices force row level security;
revoke all on table public.commercial_access_choices
  from public, anon, authenticated;
grant select, insert, update on table public.commercial_access_choices
  to service_role;

comment on table public.commercial_access_choices
  is 'Private server-authoritative Retainer choice for each ordinary account.';
comment on column public.commercial_access_choices.trial_expires_at
  is 'Fixed launch-trial expiry; never calculated from sign-in time.';

alter table public.grade_reservations
  drop constraint if exists grade_reservations_access_basis_check;
alter table public.grade_reservations
  add constraint grade_reservations_access_basis_check check (access_basis in (
    'super_admin', 'founder_admin', 'free_beta', 'paid_subscription',
    'trial', 'lifetime_free', 'global_beta_all_access', 'founding_beta',
    'early_access', 'provisional_payment', 'daily_free', 'launch_trial'
  ));

-- Existing valid transactions already represent a paid choice.
insert into public.commercial_access_choices (
  user_id, choice, selected_at, choice_source
)
select distinct on (s.user_id)
  s.user_id,
  'early_access',
  coalesce(s.starts_at, s.created_at, now()),
  'existing_subscription'
from public.subscriptions s
where s.status = 'active'
  and s.starts_at <= clock_timestamp()
  and (s.expires_at is null or s.expires_at > clock_timestamp())
order by s.user_id, s.updated_at desc
on conflict (user_id) do nothing;

insert into public.commercial_access_choices (
  user_id, choice, selected_at, choice_source
)
select distinct on (p.user_id)
  p.user_id,
  'early_access',
  coalesce(p.submitted_at, p.updated_at, now()),
  'existing_payment'
from public.payment_requests p
where p.plan_code = 'early_access_beta'
  and p.status in ('pending', 'needs_information', 'approved')
order by p.user_id, p.submitted_at desc nulls last, p.updated_at desc
on conflict (user_id) do update
set choice = 'early_access',
    selected_at = excluded.selected_at,
    choice_source = excluded.choice_source,
    version = public.commercial_access_choices.version + 1,
    updated_at = now();

-- Preserve the exact currently deployed resolver as a private base function.
-- CREATE OR REPLACE below keeps the original phase4_access_snapshot OID, so all
-- existing callers automatically use the explicit-choice wrapper.
do $$
declare
  v_source_oid oid;
  v_definition text;
begin
  if to_regprocedure(
    'public.phase4_access_snapshot_base(uuid,boolean,text)'
  ) is null then
    v_source_oid := to_regprocedure(
      'public.phase4_access_snapshot(uuid,boolean,text)'
    )::oid;
    if v_source_oid is null then
      raise exception 'phase4_access_snapshot is required before this migration';
    end if;

    select pg_get_functiondef(v_source_oid)
    into v_definition;

    v_definition := regexp_replace(
      v_definition,
      'CREATE OR REPLACE FUNCTION public\.phase4_access_snapshot\(',
      'CREATE OR REPLACE FUNCTION public.phase4_access_snapshot_base(',
      ''
    );
    execute v_definition;
  end if;
end;
$$;

revoke all on function public.phase4_access_snapshot_base(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.phase4_access_snapshot_base(uuid, boolean, text)
  to service_role;

commit;

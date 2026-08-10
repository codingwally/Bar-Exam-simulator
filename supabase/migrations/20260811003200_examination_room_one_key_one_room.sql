-- DueDiligence Examination Room: one Admin key creates one single-exam room.
-- The plaintext invitation key is generated outside Postgres. Only its SHA-256
-- digest crosses the Worker boundary or is persisted here.

begin;

-- ---------------------------------------------------------------------------
-- Scoped Professor invitations
-- ---------------------------------------------------------------------------

alter table public.exam_room_professor_activations
  add column if not exists room_policy text not null default 'legacy',
  add column if not exists room_title text,
  add column if not exists school_name text,
  add column if not exists academic_term text,
  add column if not exists classroom_id uuid;

alter table public.exam_room_professor_activations
  drop constraint if exists exam_room_activation_room_policy_check,
  drop constraint if exists exam_room_activation_classroom_fkey;

alter table public.exam_room_professor_activations
  add constraint exam_room_activation_room_policy_check check (
    (
      room_policy = 'legacy'
      and room_title is null
      and school_name is null
      and academic_term is null
      and classroom_id is null
    )
    or
    (
      room_policy = 'one_key_one_room'
      and char_length(btrim(room_title)) between 2 and 200
      and char_length(btrim(school_name)) between 2 and 300
      and char_length(btrim(academic_term)) between 1 and 160
      and (
        (status = 'redeemed' and classroom_id is not null)
        or (status <> 'redeemed' and classroom_id is null)
      )
      and (
        (
          status = 'redeemed'
          and redeemed_by is not null
          and redeemed_at is not null
          and revoked_by is null
          and revoked_at is null
          and revoke_reason is null
        )
        or (
          status = 'revoked'
          and revoked_by is not null
          and revoked_at is not null
          and char_length(btrim(revoke_reason)) between 5 and 1000
          and redeemed_by is null
          and redeemed_at is null
        )
        or (
          status in ('issued', 'locked', 'expired')
          and redeemed_by is null
          and redeemed_at is null
          and revoked_by is null
          and revoked_at is null
          and revoke_reason is null
        )
      )
    )
  ),
  add constraint exam_room_activation_classroom_fkey
    foreign key (classroom_id)
    references public.exam_room_classrooms(id)
    on delete restrict;

-- One Professor may hold several pending invitations for different rooms.
-- The former email-wide uniqueness rule prevented that valid workflow.
drop index if exists public.exam_room_activation_one_active_email_idx;

create index if not exists exam_room_activation_email_status_idx
  on public.exam_room_professor_activations (target_email, status, created_at desc);

create index if not exists exam_room_activation_status_created_idx
  on public.exam_room_professor_activations (status, created_at desc);

create unique index if not exists exam_room_activation_classroom_uq
  on public.exam_room_professor_activations (classroom_id)
  where classroom_id is not null;

-- Wrong key attempts cannot be attributed to a particular pending room key.
-- Apply the bounded lockout to the signed-in account and Worker-derived rate
-- scope instead of locking an unrelated pending invitation.
create table if not exists public.exam_room_activation_attempt_windows (
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  rate_key_hash text not null check (rate_key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  failures integer not null default 0 check (failures between 0 and 5),
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (actor_user_id, rate_key_hash)
);

alter table public.exam_room_activation_attempt_windows enable row level security;
alter table public.exam_room_activation_attempt_windows force row level security;
revoke all privileges on table public.exam_room_activation_attempt_windows
  from public, anon, authenticated;
grant select, insert, update, delete on table public.exam_room_activation_attempt_windows
  to service_role;

-- Unscoped beta-preview invitations cannot satisfy the new room contract.
-- Retire only those legacy rows; scoped pending invitations are independent
-- and are never superseded merely because they share a Professor email.
with retired as (
  update public.exam_room_professor_activations
  set status = 'revoked',
      locked_until = null,
      revoked_at = now(),
      revoke_reason = 'Legacy unscoped invitation retired when one-room keys were enabled.'
  where room_policy = 'legacy'
    and status in ('issued', 'locked')
  returning id
)
insert into public.exam_room_audit_log (action, metadata)
select 'professor_activation_legacy_retired',
       jsonb_build_object('activationId', r.id)
from retired r;

-- Scoped invitation identity and room binding are immutable. Status and
-- revocation bookkeeping may still move through their authorized RPCs.
create or replace function public.exam_room_guard_activation_room_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.room_policy = 'one_key_one_room' then
      raise exception 'EXAM_ROOM_ACTIVATION_ROOM_BINDING_CONFLICT';
    end if;
    return old;
  end if;

  if old.room_policy is distinct from new.room_policy then
    raise exception 'EXAM_ROOM_ACTIVATION_ROOM_BINDING_CONFLICT';
  end if;

  if old.status is distinct from new.status and not (
    (old.status = 'issued' and new.status in ('locked', 'redeemed', 'revoked', 'expired'))
    or (old.status = 'locked' and new.status in ('issued', 'redeemed', 'revoked', 'expired'))
  ) then
    raise exception 'EXAM_ROOM_ACTIVATION_ROOM_BINDING_CONFLICT';
  end if;

  if old.room_policy = 'one_key_one_room' and (
    old.target_email is distinct from new.target_email
    or old.token_hash is distinct from new.token_hash
    or old.room_title is distinct from new.room_title
    or old.school_name is distinct from new.school_name
    or old.academic_term is distinct from new.academic_term
    or old.expires_at is distinct from new.expires_at
    or old.issued_by is distinct from new.issued_by
    or old.created_at is distinct from new.created_at
    or (old.classroom_id is not null and old.classroom_id is distinct from new.classroom_id)
    or (old.redeemed_by is not null and old.redeemed_by is distinct from new.redeemed_by)
    or (old.redeemed_at is not null and old.redeemed_at is distinct from new.redeemed_at)
    or (old.revoked_by is not null and old.revoked_by is distinct from new.revoked_by)
    or (old.revoked_at is not null and old.revoked_at is distinct from new.revoked_at)
    or (old.revoke_reason is not null and old.revoke_reason is distinct from new.revoke_reason)
  ) then
    raise exception 'EXAM_ROOM_ACTIVATION_ROOM_BINDING_CONFLICT';
  end if;

  return new;
end;
$$;

drop trigger if exists exam_room_activation_room_binding_guard
  on public.exam_room_professor_activations;
create trigger exam_room_activation_room_binding_guard
before update or delete on public.exam_room_professor_activations
for each row execute function public.exam_room_guard_activation_room_binding();

-- ---------------------------------------------------------------------------
-- Admin issuance, monitoring, and revocation
-- ---------------------------------------------------------------------------

create or replace function public.exam_room_issue_professor_activation(
  p_actor_user_id uuid,
  p_target_email text,
  p_token_hash text,
  p_room_title text,
  p_school_name text,
  p_academic_term text,
  p_expires_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_target_email));
  v_activation public.exam_room_professor_activations%rowtype;
begin
  perform public.exam_room_require_admin(p_actor_user_id);

  if p_target_email is null
    or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'
    or p_token_hash is null
    or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_room_title is null
    or char_length(btrim(p_room_title)) not between 2 and 200
    or p_school_name is null
    or char_length(btrim(p_school_name)) not between 2 and 300
    or p_academic_term is null
    or char_length(btrim(p_academic_term)) not between 1 and 160
    or p_expires_at is null
    or p_expires_at <= clock_timestamp()
    or p_expires_at > clock_timestamp() + interval '7 days'
    or p_reason is null
    or char_length(btrim(p_reason)) not between 5 and 1000
  then
    raise exception 'EXAM_ROOM_ACTIVATION_INVALID';
  end if;

  begin
    insert into public.exam_room_professor_activations (
      target_email, token_hash, status, expires_at, issued_by,
      room_policy, room_title, school_name, academic_term
    ) values (
      v_email, p_token_hash, 'issued', p_expires_at, p_actor_user_id,
      'one_key_one_room', btrim(p_room_title), btrim(p_school_name),
      btrim(p_academic_term)
    )
    returning * into v_activation;
  exception when unique_violation then
    raise exception 'EXAM_ROOM_ACTIVATION_INVALID';
  end;

  insert into public.exam_room_audit_log (
    actor_user_id, action, reason, metadata
  ) values (
    p_actor_user_id,
    'professor_room_invitation_issued',
    btrim(p_reason),
    jsonb_build_object(
      'activationId', v_activation.id,
      'targetEmail', v_activation.target_email,
      'roomTitle', v_activation.room_title,
      'schoolName', v_activation.school_name,
      'academicTerm', v_activation.academic_term,
      'expiresAt', v_activation.expires_at
    )
  );

  return jsonb_build_object(
    'ok', true,
    'activationId', v_activation.id,
    'status', v_activation.status,
    'createdAt', v_activation.created_at,
    'expiresAt', v_activation.expires_at,
    'targetEmail', v_activation.target_email,
    'roomTitle', v_activation.room_title,
    'schoolName', v_activation.school_name,
    'academicTerm', v_activation.academic_term
  );
end;
$$;

create or replace function public.exam_room_admin_professor_activation_ledger(
  p_actor_user_id uuid,
  p_status text default 'all',
  p_limit integer default 200,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_total bigint;
  v_rows jsonb;
begin
  perform public.exam_room_require_admin(p_actor_user_id);

  if v_status not in ('all', 'issued', 'redeemed', 'expired', 'revoked', 'locked')
    or p_limit is null
    or p_limit not between 1 and 500
    or p_offset is null
    or p_offset not between 0 and 100000
  then
    raise exception 'EXAM_ROOM_ACTIVATION_LEDGER_INVALID';
  end if;

  select count(*) into v_total
  from (
    select case
      when a.status in ('issued', 'locked') and a.expires_at <= clock_timestamp()
        then 'expired'
      else a.status
    end as effective_status
    from public.exam_room_professor_activations a
  ) counted
  where v_status = 'all' or counted.effective_status = v_status;

  select coalesce(
    jsonb_agg(rows.item order by rows.created_at desc, rows.activation_id desc),
    '[]'::jsonb
  )
  into v_rows
  from (
    select
      a.id as activation_id,
      a.created_at,
      jsonb_build_object(
        'activationId', a.id,
        'roomTitle', a.room_title,
        'schoolName', a.school_name,
        'academicTerm', a.academic_term,
        'targetEmail', a.target_email,
        'status', effective.effective_status,
        'createdAt', a.created_at,
        'expiresAt', a.expires_at,
        'issuedByUserId', a.issued_by,
        'issuedByEmail', lower(issuer.email),
        'redeemedByUserId', a.redeemed_by,
        'redeemedByEmail', lower(redeemer.email),
        'redeemedAt', a.redeemed_at,
        'failedAttempts', a.failed_attempts,
        'lockedUntil', a.locked_until,
        'revokedAt', a.revoked_at,
        'revokeReason', a.revoke_reason,
        'classroomId', c.public_id
      ) as item
    from public.exam_room_professor_activations a
    join auth.users issuer on issuer.id = a.issued_by
    left join auth.users redeemer on redeemer.id = a.redeemed_by
    left join public.exam_room_classrooms c on c.id = a.classroom_id
    cross join lateral (
      select case
        when a.status in ('issued', 'locked') and a.expires_at <= clock_timestamp()
          then 'expired'
        else a.status
      end as effective_status
    ) effective
    where v_status = 'all' or effective.effective_status = v_status
    order by a.created_at desc, a.id desc
    limit p_limit
    offset p_offset
  ) rows;

  return jsonb_build_object(
    'ok', true,
    'status', v_status,
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset,
    'activations', v_rows
  );
end;
$$;

create or replace function public.exam_room_admin_revoke_professor_activation(
  p_actor_user_id uuid,
  p_activation_id uuid,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activation public.exam_room_professor_activations%rowtype;
  v_request jsonb;
  v_existing jsonb;
  v_response jsonb;
  v_revoked_at timestamptz;
begin
  perform public.exam_room_require_admin(p_actor_user_id);

  if p_activation_id is null
    or p_reason is null
    or char_length(btrim(p_reason)) not between 5 and 1000
    or p_request_key is null
    or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
  then
    raise exception 'EXAM_ROOM_ACTIVATION_REVOKE_INVALID';
  end if;

  v_request := jsonb_build_object(
    'activationId', p_activation_id,
    'reason', btrim(p_reason)
  );
  v_existing := public.exam_room_command_begin_v2(
    p_actor_user_id,
    'revoke_professor_activation',
    p_request_key,
    v_request
  );
  if v_existing is not null then
    return v_existing || jsonb_build_object('idempotent', true);
  end if;

  select * into v_activation
  from public.exam_room_professor_activations a
  where a.id = p_activation_id
  for update;

  if not found
    or v_activation.room_policy <> 'one_key_one_room'
    or v_activation.status not in ('issued', 'locked')
  then
    raise exception 'EXAM_ROOM_ACTIVATION_NOT_REVOCABLE';
  end if;

  if v_activation.expires_at <= clock_timestamp() then
    update public.exam_room_professor_activations
    set status = 'expired', locked_until = null
    where id = v_activation.id;
    insert into public.exam_room_audit_log (
      actor_user_id, action, reason, metadata
    ) values (
      p_actor_user_id,
      'professor_room_invitation_expired',
      'Invitation expired before the requested revocation.',
      jsonb_build_object('activationId', v_activation.id, 'roomTitle', v_activation.room_title)
    );
    v_response := jsonb_build_object(
      'ok', false,
      'code', 'ACTIVATION_EXPIRED',
      'activationId', v_activation.id,
      'status', 'expired',
      'idempotent', false
    );
    return public.exam_room_command_complete_v2(
      p_actor_user_id,
      'revoke_professor_activation',
      p_request_key,
      v_request,
      v_response
    );
  end if;

  v_revoked_at := clock_timestamp();
  update public.exam_room_professor_activations
  set status = 'revoked',
      locked_until = null,
      revoked_by = p_actor_user_id,
      revoked_at = v_revoked_at,
      revoke_reason = btrim(p_reason)
  where id = v_activation.id;

  insert into public.exam_room_audit_log (
    actor_user_id, action, reason, metadata
  ) values (
    p_actor_user_id,
    'professor_room_invitation_revoked',
    btrim(p_reason),
    jsonb_build_object(
      'activationId', v_activation.id,
      'targetEmail', v_activation.target_email,
      'roomTitle', v_activation.room_title
    )
  );

  v_response := jsonb_build_object(
    'ok', true,
    'activationId', v_activation.id,
    'status', 'revoked',
    'revokedAt', v_revoked_at,
    'idempotent', false
  );
  return public.exam_room_command_complete_v2(
    p_actor_user_id,
    'revoke_professor_activation',
    p_request_key,
    v_request,
    v_response
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Exact-key redemption creates and binds exactly one room
-- ---------------------------------------------------------------------------

create or replace function public.exam_room_redeem_professor_activation(
  p_user_id uuid,
  p_token_hash text,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_activation public.exam_room_professor_activations%rowtype;
  v_window public.exam_room_activation_attempt_windows%rowtype;
  v_failures integer;
  v_locked_until timestamptz;
  v_class public.exam_room_classrooms%rowtype;
  v_redeemed_at timestamptz;
begin
  if p_user_id is null
    or p_token_hash is null
    or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_rate_key_hash is null
    or p_rate_key_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'EXAM_ROOM_CREDENTIAL_INPUT_INVALID';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = p_user_id;
  if v_email is null then raise exception 'EXAM_ROOM_AUTH_REQUIRED'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_user_id::text || ':professor-room-key:' || p_rate_key_hash,
      20260811003200
    )
  );

  select * into v_window
  from public.exam_room_activation_attempt_windows w
  where w.actor_user_id = p_user_id
    and w.rate_key_hash = p_rate_key_hash
  for update;

  if found
    and v_window.locked_until is not null
    and v_window.locked_until > clock_timestamp()
  then
    return jsonb_build_object(
      'ok', false,
      'code', 'CREDENTIAL_LOCKED',
      'lockedUntil', v_window.locked_until
    );
  end if;

  select * into v_activation
  from public.exam_room_professor_activations a
  where a.target_email = v_email
    and a.token_hash = p_token_hash
  for update;

  if not found then
    if v_window.actor_user_id is null
      or v_window.window_started_at < clock_timestamp() - interval '15 minutes'
    then
      insert into public.exam_room_activation_attempt_windows (
        actor_user_id, rate_key_hash, window_started_at,
        failures, locked_until, updated_at
      ) values (
        p_user_id, p_rate_key_hash, clock_timestamp(), 1, null, clock_timestamp()
      )
      on conflict (actor_user_id, rate_key_hash) do update
      set window_started_at = excluded.window_started_at,
          failures = 1,
          locked_until = null,
          updated_at = excluded.updated_at
      returning * into v_window;
      v_failures := 1;
    else
      v_failures := least(v_window.failures + 1, 5);
      v_locked_until := case
        when v_failures >= 5 then clock_timestamp() + interval '15 minutes'
        else null
      end;
      update public.exam_room_activation_attempt_windows
      set failures = v_failures,
          locked_until = v_locked_until,
          updated_at = clock_timestamp()
      where actor_user_id = p_user_id
        and rate_key_hash = p_rate_key_hash;
    end if;

    insert into public.exam_room_audit_log (actor_user_id, action, metadata)
    values (
      p_user_id,
      'professor_activation_failed',
      jsonb_build_object('scope', 'signed_in_account', 'failureCount', v_failures)
    );

    return jsonb_build_object(
      'ok', false,
      'code', case when v_failures >= 5 then 'CREDENTIAL_LOCKED' else 'ACTIVATION_INVALID' end,
      'lockedUntil', case when v_failures >= 5 then v_locked_until else null end
    );
  end if;

  if v_activation.status = 'redeemed' then
    return jsonb_build_object('ok', false, 'code', 'ACTIVATION_ALREADY_REDEEMED');
  end if;
  if v_activation.status = 'revoked' then
    return jsonb_build_object('ok', false, 'code', 'ACTIVATION_REVOKED');
  end if;
  if v_activation.status = 'expired' or v_activation.expires_at <= clock_timestamp() then
    if v_activation.status in ('issued', 'locked') then
      update public.exam_room_professor_activations
      set status = 'expired', locked_until = null
      where id = v_activation.id;
      insert into public.exam_room_audit_log (
        actor_user_id, action, reason, metadata
      ) values (
        p_user_id,
        'professor_room_invitation_expired',
        'Invitation expired before redemption.',
        jsonb_build_object('activationId', v_activation.id, 'roomTitle', v_activation.room_title)
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'ACTIVATION_EXPIRED');
  end if;
  if v_activation.status = 'locked'
    and v_activation.locked_until is not null
    and v_activation.locked_until > clock_timestamp()
  then
    return jsonb_build_object(
      'ok', false,
      'code', 'CREDENTIAL_LOCKED',
      'lockedUntil', v_activation.locked_until
    );
  end if;
  if v_activation.room_policy <> 'one_key_one_room'
    or v_activation.room_title is null
    or v_activation.school_name is null
    or v_activation.academic_term is null
  then
    return jsonb_build_object('ok', false, 'code', 'ACTIVATION_ROOM_SCOPE_REQUIRED');
  end if;
  if v_activation.classroom_id is not null then
    raise exception 'EXAM_ROOM_ACTIVATION_ROOM_BINDING_CONFLICT';
  end if;

  insert into public.exam_room_professors (user_id, status, activated_by)
  values (p_user_id, 'active', v_activation.issued_by)
  on conflict (user_id) do update
  set status = 'active',
      activated_by = excluded.activated_by,
      updated_at = clock_timestamp();

  insert into public.exam_room_classrooms (
    owner_professor_id, title, school_name, academic_term
  ) values (
    p_user_id,
    v_activation.room_title,
    v_activation.school_name,
    v_activation.academic_term
  )
  returning * into v_class;

  v_redeemed_at := clock_timestamp();
  update public.exam_room_professor_activations
  set status = 'redeemed',
      redeemed_by = p_user_id,
      redeemed_at = v_redeemed_at,
      classroom_id = v_class.id,
      failed_attempts = 0,
      locked_until = null
  where id = v_activation.id
    and status in ('issued', 'locked')
    and classroom_id is null;
  if not found then
    raise exception 'EXAM_ROOM_ACTIVATION_ROOM_BINDING_CONFLICT';
  end if;

  delete from public.exam_room_activation_attempt_windows
  where actor_user_id = p_user_id
    and rate_key_hash = p_rate_key_hash;
  delete from public.exam_room_credential_windows
  where activation_id = v_activation.id;

  insert into public.exam_room_audit_log (
    actor_user_id, classroom_id, action, metadata
  ) values (
    p_user_id,
    v_class.id,
    'professor_room_invitation_redeemed',
    jsonb_build_object(
      'activationId', v_activation.id,
      'roomTitle', v_class.title,
      'issuedBy', v_activation.issued_by
    )
  );

  return jsonb_build_object(
    'ok', true,
    'role', 'professor',
    'activationId', v_activation.id,
    'classroomId', v_class.public_id,
    'roomTitle', v_class.title,
    'schoolName', v_class.school_name,
    'academicTerm', v_class.academic_term,
    'status', 'redeemed',
    'redeemedAt', v_redeemed_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- One key-created room contains one examination
-- ---------------------------------------------------------------------------

create or replace function public.exam_room_guard_single_exam_key_room()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activation_id uuid;
begin
  if tg_op = 'UPDATE' and new.classroom_id = old.classroom_id then
    return new;
  end if;

  select a.id into v_activation_id
  from public.exam_room_professor_activations a
  where a.classroom_id = new.classroom_id
    and a.room_policy = 'one_key_one_room'
  for update;

  if found then
    if tg_op = 'INSERT' then
      if exists (
        select 1 from public.exam_room_exams e
        where e.classroom_id = new.classroom_id
      ) then
        raise exception 'EXAM_ROOM_ONE_EXAM_LIMIT';
      end if;
    elsif exists (
      select 1 from public.exam_room_exams e
      where e.classroom_id = new.classroom_id
        and e.id <> old.id
    ) then
      raise exception 'EXAM_ROOM_ONE_EXAM_LIMIT';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists exam_room_single_exam_key_room_guard
  on public.exam_room_exams;
create trigger exam_room_single_exam_key_room_guard
before insert or update of classroom_id on public.exam_room_exams
for each row execute function public.exam_room_guard_single_exam_key_room();

create or replace function public.exam_room_create_exam(
  p_professor_user_id uuid,
  p_classroom_public_id uuid,
  p_title text,
  p_instructions text,
  p_requested_question_count integer,
  p_integrity_preset text,
  p_include_questionnaire boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class public.exam_room_classrooms%rowtype;
  v_exam public.exam_room_exams%rowtype;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_class
  from public.exam_room_classrooms c
  where c.public_id = p_classroom_public_id
    and c.owner_professor_id = p_professor_user_id
    and c.status = 'active'
  for update;
  if not found then raise exception 'EXAM_ROOM_CLASS_NOT_FOUND'; end if;

  if exists (
    select 1
    from public.exam_room_professor_activations a
    where a.classroom_id = v_class.id
      and a.room_policy = 'one_key_one_room'
  ) and exists (
    select 1 from public.exam_room_exams e
    where e.classroom_id = v_class.id
  ) then
    raise exception 'EXAM_ROOM_ONE_EXAM_LIMIT';
  end if;

  if p_title is null
    or char_length(btrim(p_title)) not between 1 and 200
    or char_length(coalesce(p_instructions, '')) > 10000
    or p_requested_question_count is null
    or p_requested_question_count not between 1 and 200
    or p_integrity_preset not in ('open_book', 'standard', 'strict')
  then
    raise exception 'EXAM_ROOM_EXAM_INVALID';
  end if;

  insert into public.exam_room_exams (
    classroom_id, owner_professor_id, title, instructions,
    requested_question_count, integrity_preset, include_questionnaire
  ) values (
    v_class.id, p_professor_user_id, btrim(p_title), coalesce(p_instructions, ''),
    p_requested_question_count, p_integrity_preset,
    coalesce(p_include_questionnaire, false)
  )
  returning * into v_exam;

  insert into public.exam_room_audit_log (
    actor_user_id, exam_id, classroom_id, action, metadata
  ) values (
    p_professor_user_id,
    v_exam.id,
    v_class.id,
    'exam_created',
    jsonb_build_object('questionCount', p_requested_question_count)
  );

  return jsonb_build_object(
    'examId', v_exam.public_id,
    'status', v_exam.status,
    'questionCount', v_exam.requested_question_count
  );
end;
$$;

-- Free-form room creation is retired. Room metadata and ownership must come
-- from an Admin-issued key and the signed-in Professor's exact email match.
create or replace function public.exam_room_create_classroom(
  p_professor_user_id uuid,
  p_title text,
  p_school_name text default null,
  p_academic_term text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  raise exception 'EXAM_ROOM_ROOM_KEY_REQUIRED';
end;
$$;

-- ---------------------------------------------------------------------------
-- Least-privilege RPC surface
-- ---------------------------------------------------------------------------

revoke all on function public.exam_room_guard_activation_room_binding()
  from public, anon, authenticated, service_role;
revoke all on function public.exam_room_guard_single_exam_key_room()
  from public, anon, authenticated, service_role;

revoke all on function public.exam_room_issue_professor_activation(
  uuid, text, text, text, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.exam_room_issue_professor_activation(
  uuid, text, text, text, text, text, timestamptz, text
) to service_role;

revoke all on function public.exam_room_redeem_professor_activation(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.exam_room_redeem_professor_activation(uuid, text, text)
  to service_role;

revoke all on function public.exam_room_admin_professor_activation_ledger(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.exam_room_admin_professor_activation_ledger(uuid, text, integer, integer)
  to service_role;

do $retire_unpaged_activation_ledger$
declare
  v_legacy regprocedure;
begin
  v_legacy := pg_catalog.to_regprocedure(
    'public.exam_room_admin_professor_activation_ledger(uuid,text,integer)'
  );
  if v_legacy is not null then
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      v_legacy
    );
  end if;
end;
$retire_unpaged_activation_ledger$;

revoke all on function public.exam_room_admin_revoke_professor_activation(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.exam_room_admin_revoke_professor_activation(uuid, uuid, text, text)
  to service_role;

revoke all on function public.exam_room_create_exam(
  uuid, uuid, text, text, integer, text, boolean
) from public, anon, authenticated;
grant execute on function public.exam_room_create_exam(
  uuid, uuid, text, text, integer, text, boolean
) to service_role;

revoke all on function public.exam_room_create_classroom(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.exam_room_create_classroom(uuid, text, text, text)
  to service_role;

-- Keep the legacy unscoped issuer installed only for historical migration
-- compatibility. It is not part of any callable application surface.
alter function public.exam_room_issue_professor_activation(
  uuid, text, text, timestamptz, text
) set search_path = '';
revoke all on function public.exam_room_issue_professor_activation(
  uuid, text, text, timestamptz, text
) from public, anon, authenticated, service_role;

commit;

-- Owner-only saved-result exports. No automatic mail or practice-email change.
begin;
create table public.dd2026_forecast_result_exports (
  attempt_id uuid not null references public.dd2026_forecast_attempts(id) on delete cascade,
  result_revision integer not null check (result_revision=1),
  owner_id uuid not null references auth.users(id) on delete cascade,
  pdf_hash text not null check (pdf_hash ~ '^[0-9a-f]{64}$'),
  file_name text not null check (length(file_name) between 10 and 150),
  byte_count integer not null check (byte_count between 1 and 10485760),
  created_at timestamptz not null default statement_timestamp(),
  downloads integer not null default 0,
  email_status text not null default 'not_requested' check (email_status in ('not_requested','processing','provider_accepted','uncertain','failed')),
  recipient_hash text,
  email_requested_at timestamptz,
  email_retry_at timestamptz,
  email_executions integer not null default 0 check (email_executions between 0 and 3),
  email_lease uuid,
  email_lease_expires_at timestamptz,
  provider_id text,
  settled_lease uuid,
  primary key(attempt_id,result_revision),
  check ((email_status='processing')=(email_lease is not null and email_lease_expires_at is not null))
);
create index dd2026_forecast_result_email_rate on public.dd2026_forecast_result_exports(owner_id,email_requested_at) where email_requested_at is not null;
alter table public.dd2026_forecast_result_exports enable row level security;
alter table public.dd2026_forecast_result_exports force row level security;
revoke all on public.dd2026_forecast_result_exports from public,anon,authenticated;
grant select,insert,update,delete on public.dd2026_forecast_result_exports to service_role;

create function public.dd2026_forecast_result_export_immutable()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if (new.attempt_id,new.result_revision,new.owner_id,new.pdf_hash,new.file_name,new.byte_count,new.created_at)
    is distinct from (old.attempt_id,old.result_revision,old.owner_id,old.pdf_hash,old.file_name,old.byte_count,old.created_at)
    or (old.recipient_hash is not null and new.recipient_hash is distinct from old.recipient_hash)
    or (old.email_requested_at is not null and new.email_requested_at is distinct from old.email_requested_at)
    or (old.email_status='provider_accepted' and (new.email_status,new.provider_id) is distinct from (old.email_status,old.provider_id)) then
    raise exception 'Saved export and accepted email identity are immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger dd2026_forecast_result_export_immutable before update on public.dd2026_forecast_result_exports
for each row execute function public.dd2026_forecast_result_export_immutable();

create function public.dd2026_forecast_result_email_public(p_attempt_id uuid,p_result_revision integer)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('status',case when email_status='processing' and email_lease_expires_at<=statement_timestamp() then 'uncertain' else email_status end,
    'alreadyRequested',email_requested_at is not null,'providerAccepted',email_status='provider_accepted','deliveryConfirmed',false,
    'retryAllowed',email_status in ('failed','uncertain') and email_executions<3 and email_requested_at>statement_timestamp()-interval '23 hours'
      and email_retry_at<=statement_timestamp(),
    'retryAt',email_retry_at,'requestedAt',email_requested_at)
  from public.dd2026_forecast_result_exports where attempt_id=p_attempt_id and result_revision=p_result_revision;
$$;

create function public.dd2026_forecast_result_pdf_record(p_actor_user_id uuid,p_attempt_id uuid,p_result_revision integer,p_pdf_hash text,p_file_name text,p_byte_count integer,p_download boolean default true)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_export public.dd2026_forecast_result_exports%rowtype;
begin
  if not exists(select 1 from public.dd2026_forecast_attempts where id=p_attempt_id and owner_id=p_actor_user_id and status='complete' and result_revision=p_result_revision) then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EXPORT_NOT_READY','Only your complete saved Forecast can be exported.',409);
  end if;
  if not public.dd2026_bar_forecast_access_allowed(p_actor_user_id) then return public.dd2026_forecast_attempt_error('BAR_FORECAST_ACCESS_REQUIRED','Current Forecast access is required.',403); end if;
  if p_result_revision is distinct from 1 or p_pdf_hash is null or p_pdf_hash !~ '^[0-9a-f]{64}$'
    or p_byte_count is null or p_byte_count not between 1 and 10485760
    or p_file_name is distinct from ('duediligence-forecast-'||p_attempt_id::text||'-r1.pdf') then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EXPORT_INVALID','The saved PDF metadata is invalid.',400);
  end if;
  insert into public.dd2026_forecast_result_exports(attempt_id,result_revision,owner_id,pdf_hash,file_name,byte_count)
    values(p_attempt_id,p_result_revision,p_actor_user_id,p_pdf_hash,p_file_name,p_byte_count) on conflict do nothing;
  select * into v_export from public.dd2026_forecast_result_exports where attempt_id=p_attempt_id and result_revision=p_result_revision for update;
  if (v_export.pdf_hash,v_export.file_name,v_export.byte_count) is distinct from (p_pdf_hash,p_file_name,p_byte_count) then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EXPORT_CONFLICT','The existing saved PDF has a different fingerprint. No email was sent.',409);
  end if;
  if p_download then update public.dd2026_forecast_result_exports set downloads=downloads+1 where attempt_id=p_attempt_id and result_revision=p_result_revision; end if;
  return jsonb_build_object('ok',true,'pdfHash',v_export.pdf_hash,'email',public.dd2026_forecast_result_email_public(p_attempt_id,p_result_revision));
end;
$$;

-- Supabase service_role can invoke the Worker RPCs but cannot SELECT auth.users.
-- Expose only this exact identity/confirmed-email boolean to that trusted role;
-- do not grant the Worker or browser roles direct access to the Auth table.
create schema if not exists private;
grant usage on schema private to service_role;
create function private.dd2026_forecast_verified_owner_email(p_actor_user_id uuid,p_recipient_email text)
returns boolean language sql stable security definer set search_path='' as $$
  select p_actor_user_id is not null and p_recipient_email is not null
    and p_recipient_email=lower(btrim(p_recipient_email))
    and exists(select 1 from auth.users where id=p_actor_user_id
      and lower(email)=p_recipient_email and email_confirmed_at is not null);
$$;
revoke all on function private.dd2026_forecast_verified_owner_email(uuid,text) from public,anon,authenticated;
grant execute on function private.dd2026_forecast_verified_owner_email(uuid,text) to service_role;

create function public.dd2026_forecast_result_email_claim(p_actor_user_id uuid,p_attempt_id uuid,p_result_revision integer,p_recipient_email text,p_pdf_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_export public.dd2026_forecast_result_exports%rowtype; v_hash text; v_now timestamptz:=statement_timestamp();
begin
  -- The SQL check also reads current Auth truth, never editable user metadata.
  if not private.dd2026_forecast_verified_owner_email(p_actor_user_id,p_recipient_email) then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_VERIFIED_EMAIL_REQUIRED','Verify your account email before emailing this report.',409);
  end if;
  if not public.dd2026_bar_forecast_access_allowed(p_actor_user_id) then return public.dd2026_forecast_attempt_error('BAR_FORECAST_ACCESS_REQUIRED','Current Forecast access is required.',403); end if;
  perform pg_advisory_xact_lock(hashtextextended('dd2026_forecast_email/'||p_actor_user_id::text,0));
  select * into v_export from public.dd2026_forecast_result_exports where attempt_id=p_attempt_id and result_revision=p_result_revision and owner_id=p_actor_user_id for update;
  if not found then return public.dd2026_forecast_attempt_error('BAR_FORECAST_EXPORT_NOT_READY','Only your complete saved report can be emailed.',409); end if;
  if v_export.pdf_hash is distinct from p_pdf_hash then return public.dd2026_forecast_attempt_error('BAR_FORECAST_EXPORT_CONFLICT','The saved PDF fingerprint changed.',409); end if;
  v_hash:=encode(sha256(convert_to(p_recipient_email,'UTF8')),'hex');
  if v_export.recipient_hash is not null and v_export.recipient_hash<>v_hash then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EMAIL_RECIPIENT_CHANGED','This report email was already requested for a different verified address. Download the PDF instead.',409);
  end if;
  if v_export.email_status='provider_accepted' or (v_export.email_status='processing' and v_export.email_lease_expires_at>v_now) then
    return jsonb_build_object('ok',true,'claimed',false,'email',public.dd2026_forecast_result_email_public(p_attempt_id,p_result_revision));
  end if;
  -- Resend retains idempotency keys 24h. Stop at 23h and three claims; never
  -- resend an uncertain outcome after the provider's retention window expires.
  if v_export.email_requested_at is not null and (v_export.email_executions>=3 or v_export.email_requested_at<=v_now-interval '23 hours') then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EMAIL_RETRY_LIMIT','Email recovery needs support review. The saved PDF is still available.',409);
  end if;
  if v_export.email_retry_at>v_now then return jsonb_build_object('ok',true,'claimed',false,'email',public.dd2026_forecast_result_email_public(p_attempt_id,p_result_revision)); end if;
  if v_export.email_requested_at is null and (select count(*) from public.dd2026_forecast_result_exports where owner_id=p_actor_user_id and email_requested_at>v_now-interval '24 hours')>=5 then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EMAIL_RATE_LIMIT','You can email five saved reports in 24 hours. Download the PDF instead.',429);
  end if;
  update public.dd2026_forecast_result_exports set email_status='processing',recipient_hash=v_hash,
    email_requested_at=coalesce(email_requested_at,v_now),email_executions=email_executions+1,
    email_lease=gen_random_uuid(),email_lease_expires_at=v_now+interval '120 seconds',email_retry_at=null
    where attempt_id=p_attempt_id and result_revision=p_result_revision returning * into v_export;
  return jsonb_build_object('ok',true,'claimed',true,'leaseToken',v_export.email_lease,
    'idempotencyKey','forecast-result/'||p_attempt_id::text||'/r'||p_result_revision::text,
    'email',public.dd2026_forecast_result_email_public(p_attempt_id,p_result_revision));
end;
$$;

create function public.dd2026_forecast_result_email_settle(p_actor_user_id uuid,p_attempt_id uuid,p_result_revision integer,p_lease_token uuid,p_status text,p_provider_id text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_export public.dd2026_forecast_result_exports%rowtype;
begin
  select * into v_export from public.dd2026_forecast_result_exports where attempt_id=p_attempt_id and result_revision=p_result_revision and owner_id=p_actor_user_id for update;
  if not found then return public.dd2026_forecast_attempt_error('BAR_FORECAST_EXPORT_NOT_READY','The saved email request is unavailable.',409); end if;
  if v_export.settled_lease=p_lease_token and v_export.email_status=p_status and v_export.provider_id is not distinct from p_provider_id then
    return jsonb_build_object('ok',true,'email',public.dd2026_forecast_result_email_public(p_attempt_id,p_result_revision));
  end if;
  if v_export.email_status<>'processing' or v_export.email_lease is distinct from p_lease_token or v_export.email_lease_expires_at<=statement_timestamp() then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EMAIL_LEASE_LOST','Another processor owns the email request.',409);
  end if;
  if p_status is null or p_status not in ('provider_accepted','uncertain','failed') or (p_status='provider_accepted' and (p_provider_id is null or length(p_provider_id) not between 1 and 200)) then
    return public.dd2026_forecast_attempt_error('BAR_FORECAST_EMAIL_STATUS_INVALID','The email provider status is invalid.',400);
  end if;
  update public.dd2026_forecast_result_exports set email_status=p_status,provider_id=p_provider_id,settled_lease=p_lease_token,
    email_lease=null,email_lease_expires_at=null,email_retry_at=case when p_status='provider_accepted' then null else statement_timestamp()+interval '30 seconds' end
    where attempt_id=p_attempt_id and result_revision=p_result_revision;
  return jsonb_build_object('ok',true,'email',public.dd2026_forecast_result_email_public(p_attempt_id,p_result_revision));
end;
$$;

do $$ declare v_function regprocedure; begin
  for v_function in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('dd2026_forecast_result_export_immutable','dd2026_forecast_result_email_public',
      'dd2026_forecast_result_pdf_record','dd2026_forecast_result_email_claim','dd2026_forecast_result_email_settle')
  loop
    execute format('revoke all on function %s from public,anon,authenticated',v_function);
    execute format('grant execute on function %s to service_role',v_function);
  end loop;
end $$;
commit;

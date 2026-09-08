-- A recorded verifier success is terminal. This does NOT fence older completions
-- while a newer attempt is still sending, or promise exactly-once email delivery.
-- No existing rows, claim/retry policy, Worker, provider key, receipt or access changes.
begin;
set local lock_timeout = '4s';
set local statement_timeout = '15s';

do $install_sent_terminal$
declare
  v_complete oid;
  v_claim oid;
  v_guard oid;
  v_body text;
  v_body_hash text;
  v_raw_body text;
  v_definition text;
  v_trigger_present boolean;
  v_guard_definition text := $definition$
create or replace function private.astra_guard_payment_notification_sent()
returns trigger language plpgsql volatile security invoker set search_path = ''
as $function$
begin
  if tg_op <> 'UPDATE' or tg_when <> 'BEFORE' or tg_level <> 'ROW'
     or tg_relid <> 'public.payment_requests'::regclass or tg_nargs <> 0 then
    raise exception 'ASTRA_PAYMENT_NOTIFICATION_SENT_GUARD_CONTEXT';
  end if;
  -- Null-safe comparisons protect the original success metadata, not the whole
  -- payment row. Unrelated approval, refund, evidence and receipt updates pass.
  if old.verification_email_status = 'sent' and (
       new.verification_email_status is distinct from old.verification_email_status
    or new.verification_email_attempts is distinct from old.verification_email_attempts
    or new.verification_email_provider_id is distinct from old.verification_email_provider_id
    or new.verification_email_error is distinct from old.verification_email_error
    or new.verification_email_last_attempt_at is distinct from old.verification_email_last_attempt_at
    or new.verification_email_sent_at is distinct from old.verification_email_sent_at
  ) then
    raise exception 'ASTRA_PAYMENT_NOTIFICATION_SENT_IMMUTABLE';
  end if;
  return new;
end;
$function$;
$definition$;
begin
  if current_user <> 'postgres' or to_regnamespace('private') is null
     or to_regclass('public.payment_requests') is null then
    raise exception 'ASTRA_PAYMENT_NOTIFICATION_SENT_PREREQUISITE';
  end if;
  -- CREATE TRIGGER already needs this lock. Acquire it before inspecting state;
  -- never cancel existing writers or silently install over unknown drift.
  lock table public.payment_requests in share row exclusive mode;
  if not exists(select 1 from pg_class where oid='public.payment_requests'::regclass
      and relkind='r' and pg_get_userbyid(relowner)='postgres')
     or (select count(*) from pg_attribute a join (values
       ('verification_email_status','text'::regtype,true),
       ('verification_email_attempts','integer'::regtype,true),
       ('verification_email_provider_id','text'::regtype,false),
       ('verification_email_error','text'::regtype,false),
       ('verification_email_last_attempt_at','timestamp with time zone'::regtype,false),
       ('verification_email_sent_at','timestamp with time zone'::regtype,false)
     ) x(name,type_oid,not_null) on a.attname=x.name and a.atttypid=x.type_oid
       and a.attnotnull=x.not_null
       where a.attrelid='public.payment_requests'::regclass and not a.attisdropped
         and a.attgenerated='' and a.attidentity='') <> 6 then
    raise exception 'ASTRA_PAYMENT_NOTIFICATION_SENT_PREREQUISITE';
  end if;
  v_complete := to_regprocedure('public.phase4_complete_payment_notification(uuid,text,text,text)');
  v_claim := to_regprocedure('public.phase4_claim_payment_notification(uuid)');
  if v_complete is null or v_claim is null then
    raise exception 'ASTRA_PAYMENT_NOTIFICATION_SENT_PREREQUISITE';
  end if;
  -- Preserve the actual existing interface/defaults/ACL/security attributes.
  if (select count(*) from pg_proc p join pg_language l on l.oid=p.prolang
      where p.oid in (v_complete,v_claim) and pg_get_userbyid(p.proowner)='postgres'
        and l.lanname='plpgsql' and p.prokind='f' and p.prosecdef
        and p.provolatile='v' and not p.proretset and not p.proisstrict
        and not p.proleakproof and p.proparallel='u' and p.prosupport=0
        and p.provariadic=0 and p.procost=100 and p.prorows=0
        and p.proallargtypes is null and p.proargmodes is null and p.probin is null
        and p.proconfig=array['search_path=public, pg_temp']
        and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}'
        and ((p.oid=v_complete and p.prorettype='void'::regtype and p.pronargs=4
          and p.pronargdefaults=2 and oidvectortypes(p.proargtypes)='uuid, text, text, text'
          and p.proargnames=array['p_payment_request_id','p_status','p_provider_id','p_error']
          and pg_get_expr(p.proargdefaults,0)='NULL::text, NULL::text')
        or (p.oid=v_claim and p.prorettype='jsonb'::regtype and p.pronargs=1
          and p.pronargdefaults=1 and oidvectortypes(p.proargtypes)='uuid'
          and p.proargnames=array['p_payment_request_id']
          and pg_get_expr(p.proargdefaults,0)='NULL::uuid'))) <> 2 then
    raise exception 'ASTRA_PAYMENT_NOTIFICATION_SENT_METADATA_DRIFT';
  end if;
  if (select encode(sha256(convert_to(replace(prosrc,chr(13)||chr(10),chr(10)),'UTF8')),'hex')
      from pg_proc where oid=v_claim) <> 'c3a34ab7e47759057d3bd63ad3bd71c759b48c686ed62abfb7fc44547f8f1f95' then
    raise exception 'ASTRA_PAYMENT_NOTIFICATION_SENT_SOURCE_DRIFT';
  end if;
  select prosrc,pg_get_functiondef(oid) into v_raw_body,v_definition from pg_proc where oid=v_complete;
  v_body := replace(v_raw_body,chr(13)||chr(10),chr(10));
  v_body_hash := encode(sha256(convert_to(v_body,'UTF8')),'hex');
  if v_body_hash not in (
    '245803a0489b74fbd482c2de8fc55f8f6dfc5abf22417799c6cc9f7f02817855',
    '9275b458fa8151cc6c66b9558bf2500685a8d24a53b5e43f58757be4b54318e2') then
    raise exception 'ASTRA_PAYMENT_NOTIFICATION_SENT_SOURCE_DRIFT';
  end if;

  v_guard := to_regprocedure('private.astra_guard_payment_notification_sent()');
  select exists(select 1 from pg_trigger where tgrelid='public.payment_requests'::regclass
    and tgname='astra_guard_payment_notification_sent') into v_trigger_present;
  if (select count(*) from pg_proc where pronamespace='private'::regnamespace
      and proname='astra_guard_payment_notification_sent') <> (case when v_guard is null then 0 else 1 end) then
    raise exception 'ASTRA_PAYMENT_NOTIFICATION_SENT_GUARD_DRIFT';
  end if;
  if v_guard is not null and not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang
      where p.oid=v_guard and pg_get_userbyid(p.proowner)='postgres'
        and l.lanname='plpgsql' and p.prokind='f' and not p.prosecdef
        and p.provolatile='v' and p.prorettype='trigger'::regtype and not p.proretset
        and not p.proisstrict and not p.proleakproof and p.proparallel='u' and p.prosupport=0
        and p.pronargs=0 and p.pronargdefaults=0 and p.provariadic=0
        and p.proargnames is null and p.proallargtypes is null and p.proargmodes is null
        and p.probin is null and p.procost=100 and p.prorows=0
        and p.proconfig=array['search_path=""'] and p.proacl::text='{postgres=X/postgres}'
        and replace(p.prosrc,chr(13)||chr(10),chr(10))=
          replace(split_part(v_guard_definition,'$function$',2),chr(13)||chr(10),chr(10))) then
    raise exception 'ASTRA_PAYMENT_NOTIFICATION_SENT_GUARD_DRIFT';
  end if;
  if v_trigger_present and not exists(select 1 from pg_trigger
      where tgrelid='public.payment_requests'::regclass and tgname='astra_guard_payment_notification_sent'
        and tgfoid=v_guard and tgtype=19 and tgenabled='O' and not tgisinternal
        and tgnargs=0 and tgattr::text='' and tgqual is null and tgconstraint=0
        and not tgdeferrable and not tginitdeferred and tgparentid=0
        and tgoldtable is null and tgnewtable is null) then
    raise exception 'ASTRA_PAYMENT_NOTIFICATION_SENT_TRIGGER_DRIFT';
  end if;
  -- Only pristine original state or a complete, exact replay is accepted.
  if v_body_hash='245803a0489b74fbd482c2de8fc55f8f6dfc5abf22417799c6cc9f7f02817855' then
    if v_guard is not null or v_trigger_present then
      raise exception 'ASTRA_PAYMENT_NOTIFICATION_SENT_PARTIAL_INSTALL';
    end if;
    v_body := replace(v_body,'  where id = p_payment_request_id;',
      E'  where id = p_payment_request_id\n    and verification_email_status <> ''sent'';');
    if encode(sha256(convert_to(v_body,'UTF8')),'hex') <> '9275b458fa8151cc6c66b9558bf2500685a8d24a53b5e43f58757be4b54318e2' then
      raise exception 'ASTRA_PAYMENT_NOTIFICATION_SENT_SOURCE_DRIFT';
    end if;
    execute replace(v_definition,v_raw_body,v_body);
    execute v_guard_definition;
    revoke all on function private.astra_guard_payment_notification_sent() from public,anon,authenticated,service_role;
    create trigger astra_guard_payment_notification_sent before update on public.payment_requests
      for each row execute function private.astra_guard_payment_notification_sent();
  elsif v_guard is null or not v_trigger_present then
    raise exception 'ASTRA_PAYMENT_NOTIFICATION_SENT_PARTIAL_INSTALL';
  end if;
end;
$install_sent_terminal$;
commit;

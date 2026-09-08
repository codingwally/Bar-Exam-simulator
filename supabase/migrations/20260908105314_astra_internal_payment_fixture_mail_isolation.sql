-- Explicit, root-registered payment QA only. This does not register any account.
-- Root must register a fresh normal student BEFORE intake, using the exact source
-- 'astra_payment_fixture_mail_v1:' || user_id::text in the protected private registry.
-- No editable Auth metadata, general internal/Beta/admin classification, or GUC opts in.
-- Only new verifier/notice status changes; no existing-row adoption, backfill,
-- receipt policy, proof, payment state, provisional access or entitlement changes.
begin;
set local lock_timeout = '4s';
set local statement_timeout = '15s';

do $install_fixture_mail_isolation$
declare
  v_target record;
  v_oid oid;
  v_body text;
  v_payment text := $definition$
create or replace function private.astra_isolate_payment_fixture_mail()
returns trigger language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_email text;
  v_role text;
  v_registered_email text;
begin
  if tg_op <> 'INSERT' or tg_when <> 'BEFORE' or tg_level <> 'ROW'
     or tg_relid <> 'public.payment_requests'::regclass then
    raise exception 'ASTRA_PAYMENT_FIXTURE_TRIGGER_CONTEXT';
  end if;
  select email_at_classification into v_registered_email
  from private.internal_test_accounts
  where user_id=new.user_id
    and classification_source='astra_payment_fixture_mail_v1:' || new.user_id::text
  for share;
  if not found then return new; end if;

  -- Row locks keep this explicitly opted-in identity stable through its insert.
  -- Ordinary users never enter this branch. The real intake RPC's own owner lock,
  -- proof uniqueness and replay rules remain unchanged.
  select email into v_email from auth.users
    where id=new.user_id and not coalesce(is_anonymous,false) for update;
  select role::text into v_role from public.user_roles where user_id=new.user_id for update;
  if v_email is null or v_email='' or lower(btrim(v_email)) is distinct from v_registered_email
     or v_role is distinct from 'student'
     or exists(select 1 from public.admin_capabilities where user_id=new.user_id)
     or exists(select 1 from public.subscriptions where user_id=new.user_id)
     or exists(select 1 from public.payment_requests where user_id=new.user_id)
     or exists(select 1 from public.free_beta_access where user_id=new.user_id)
     or exists(select 1 from public.examination_beta_access where user_id=new.user_id) then
    raise exception 'ASTRA_PAYMENT_FIXTURE_IDENTITY_UNSAFE';
  end if;
  if new.verification_email_status is distinct from 'pending'
     or new.verification_email_attempts is distinct from 0
     or new.verification_email_provider_id is not null
     or new.verification_email_error is not null
     or new.verification_email_last_attempt_at is not null
     or new.verification_email_sent_at is not null then
    raise exception 'ASTRA_PAYMENT_FIXTURE_NOTIFICATION_NOT_PRISTINE';
  end if;
  new.verification_email_status := 'suppressed';
  return new;
end;
$function$;
$definition$;
  v_notice text := $definition$
create or replace function private.astra_isolate_payment_fixture_notice()
returns trigger language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_payment public.payment_requests%rowtype;
  v_registered_email text;
  v_email text;
  v_role text;
begin
  if tg_op <> 'INSERT' or tg_when <> 'BEFORE' or tg_level <> 'ROW'
     or tg_relid <> 'public.outbound_notifications'::regclass then
    raise exception 'ASTRA_PAYMENT_FIXTURE_TRIGGER_CONTEXT';
  end if;
  if new.notification_type is distinct from 'payment_submitted'
     or new.related_resource_type is distinct from 'payment_request' then return new; end if;
  select * into v_payment from public.payment_requests where id=new.related_resource_id;
  if not found then return new; end if;
  select email_at_classification into v_registered_email
  from private.internal_test_accounts
  where user_id=v_payment.user_id
    and classification_source='astra_payment_fixture_mail_v1:' || v_payment.user_id::text
  for share;
  if not found then return new; end if;
  select email into v_email from auth.users
    where id=v_payment.user_id and not coalesce(is_anonymous,false) for update;
  select role::text into v_role from public.user_roles where user_id=v_payment.user_id for update;
  if v_email is null or v_email='' or lower(btrim(v_email)) is distinct from v_registered_email
     or v_role is distinct from 'student'
     or exists(select 1 from public.admin_capabilities where user_id=v_payment.user_id)
     or exists(select 1 from public.subscriptions where user_id=v_payment.user_id)
     or exists(select 1 from public.free_beta_access where user_id=v_payment.user_id)
     or exists(select 1 from public.examination_beta_access where user_id=v_payment.user_id)
     or exists(select 1 from public.payment_requests where user_id=v_payment.user_id and id<>v_payment.id) then
    raise exception 'ASTRA_PAYMENT_FIXTURE_IDENTITY_UNSAFE';
  end if;
  if v_payment.verification_email_status is distinct from 'suppressed'
     or v_payment.verification_email_attempts is distinct from 0
     or v_payment.verification_email_provider_id is not null
     or v_payment.verification_email_error is not null
     or v_payment.verification_email_last_attempt_at is not null
     or v_payment.verification_email_sent_at is not null
     or new.status is distinct from 'queued' or new.attempts is distinct from 0
     or new.last_attempt_at is not null or new.sent_at is not null or new.failure_code is not null then
    raise exception 'ASTRA_PAYMENT_FIXTURE_NOTIFICATION_NOT_PRISTINE';
  end if;
  new.status := 'suppressed';
  return new;
end;
$function$;
$definition$;
begin
  if current_user <> 'postgres' or to_regclass('private.internal_test_accounts') is null
     or to_regclass('public.payment_requests') is null
     or to_regclass('public.outbound_notifications') is null then
    raise exception 'ASTRA_PAYMENT_FIXTURE_PREREQUISITE';
  end if;
  if not exists(select 1 from pg_class where oid='private.internal_test_accounts'::regclass
       and relrowsecurity and relforcerowsecurity and pg_get_userbyid(relowner)='postgres')
     or exists(select 1 from unnest(array['anon','authenticated','service_role']) r(role_name)
       cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) a(privilege)
       where has_table_privilege(r.role_name,'private.internal_test_accounts',a.privilege))
     or exists(select 1 from unnest(array['anon','authenticated','service_role']) r(role_name)
       cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) a(privilege)
       where has_any_column_privilege(r.role_name,'private.internal_test_accounts',a.privilege)) then
    raise exception 'ASTRA_PAYMENT_FIXTURE_REGISTRY_PROTECTION_CHANGED';
  end if;
  -- Exact reapplication is allowed; unknown function or trigger state is not repaired.
  for v_target in select * from (values
    ('private.astra_isolate_payment_fixture_mail()',v_payment,'public.payment_requests','astra_isolate_payment_fixture_mail'),
    ('private.astra_isolate_payment_fixture_notice()',v_notice,'public.outbound_notifications','astra_isolate_payment_fixture_notice')
  ) t(signature,definition,relation_name,trigger_name) loop
    v_oid := to_regprocedure(v_target.signature);
    v_body := split_part(v_target.definition,'$function$',2);
    if v_oid is not null and not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang
      where p.oid=v_oid and pg_get_userbyid(p.proowner)='postgres'
      and p.prosecdef and p.provolatile='v' and l.lanname='plpgsql'
      and p.prokind='f' and not p.proretset and p.prorettype='trigger'::regtype
      and not p.proisstrict and not p.proleakproof and p.proparallel='u' and p.prosupport=0
      and p.pronargs=0 and p.pronargdefaults=0 and p.provariadic=0
      and p.proconfig=array['search_path=""'] and p.proacl::text='{postgres=X/postgres}'
      and replace(p.prosrc,chr(13)||chr(10),chr(10))=replace(v_body,chr(13)||chr(10),chr(10))) then
      raise exception 'ASTRA_PAYMENT_FIXTURE_FUNCTION_DRIFT';
    end if;
    if exists(select 1 from pg_trigger where tgrelid=to_regclass(v_target.relation_name)
       and tgname=v_target.trigger_name
       and (v_oid is null or tgfoid<>v_oid or tgtype<>7 or tgenabled<>'O' or tgisinternal
         or tgnargs<>0 or tgqual is not null or tgconstraint<>0 or tgoldtable is not null or tgnewtable is not null)) then
      raise exception 'ASTRA_PAYMENT_FIXTURE_TRIGGER_DRIFT';
    end if;
  end loop;
  execute v_payment;
  execute v_notice;
  revoke all on function private.astra_isolate_payment_fixture_mail() from public,anon,authenticated,service_role;
  revoke all on function private.astra_isolate_payment_fixture_notice() from public,anon,authenticated,service_role;
  if not exists(select 1 from pg_trigger where tgrelid='public.payment_requests'::regclass
     and tgname='astra_isolate_payment_fixture_mail') then
    create trigger astra_isolate_payment_fixture_mail before insert on public.payment_requests
      for each row execute function private.astra_isolate_payment_fixture_mail();
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.outbound_notifications'::regclass
     and tgname='astra_isolate_payment_fixture_notice') then
    create trigger astra_isolate_payment_fixture_notice before insert on public.outbound_notifications
      for each row execute function private.astra_isolate_payment_fixture_notice();
  end if;
end;
$install_fixture_mail_isolation$;
commit;

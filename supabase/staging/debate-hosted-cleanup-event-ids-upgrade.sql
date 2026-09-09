-- STAGING ONLY: manually apply with project_id=hlzqmreeoghbldnhlybr after CI.
-- Outside production migration discovery. No database project GUC is treated
-- as identity proof; the executing coordinator pins the real project.
-- Upgrade only the exact installed 20260909132706 helper, whose original
-- source SHA256 is d4f7c239564d6f4634a2fa8415dd4cb9eebb37b76bb98a5f02d3175774184a14.
-- Fix only the generated event ID and corresponding Storage path predicates.
-- Auth/Study/billing/Storage/competition rows and privileges remain unchanged.
-- Refuse an already upgraded or otherwise changed helper; never retry blindly.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local search_path = '';

do $upgrade$
declare
  v_schema text; v_function oid; v_proc record; v_old_body text; v_new_body text;
  v_expected_hash text; v_acl_count integer; v_acl_invalid integer;
  v_prior_acl aclitem[]; v_prior_owner oid;
  v_old_event constant text := $old_event$or coalesce(v_event->>'id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'$old_event$;
  v_new_event constant text := $new_event$or coalesce(v_event->>'id','') !~ '^de-[a-f0-9]{32}$'$new_event$;
  v_old_path constant text := $old_path$'^(exports|evidence)/[a-f0-9-]{36}/([a-zA-Z0-9:_-]{8,160}/)?[a-zA-Z0-9_-]{8,160}\.(pdf|csv|png|jpg)$'$old_path$;
  v_new_path constant text := $new_path$'^(exports|evidence)/de-[a-f0-9]{32}/([a-zA-Z0-9:_-]{8,160}/)?[a-zA-Z0-9_-]{8,160}\.(pdf|csv|png|jpg)$'$new_path$;
begin
  if current_user <> 'postgres' or to_regclass('private.internal_test_accounts') is null
    or not has_schema_privilege('service_role','private','USAGE') then
    raise exception 'HOSTED_CLEANUP_UPGRADE_PREREQUISITE';
  end if;
  foreach v_schema in array array['private','public'] loop
    v_function := to_regprocedure(format('%I.astra_staging_debate_cleanup_v1(jsonb,jsonb)',v_schema));
    if v_function is null then raise exception 'HOSTED_CLEANUP_UPGRADE_FUNCTION_MISSING'; end if;
    select p.*,l.lanname,r.rolname into v_proc from pg_proc p
      join pg_language l on l.oid=p.prolang join pg_roles r on r.oid=p.proowner where p.oid=v_function;
    v_expected_hash := case when v_schema='private'
      then '1d02811f3c315d68ba47cbf1085c1386a6c02e9289e00e0ae9ccfed153aa6467'
      else 'aec0459bac58aee8fc65057c1d9408f4b3e3842c059e38dbcdfa18fb834dcfd2' end;
    if encode(sha256(convert_to(v_proc.prosrc,'UTF8')),'hex') is distinct from v_expected_hash
      or v_proc.rolname<>'postgres' or v_proc.prosecdef is distinct from (v_schema='private')
      or v_proc.lanname is distinct from (case when v_schema='private' then 'plpgsql' else 'sql' end)
      or v_proc.provolatile<>'v' or v_proc.proparallel<>'u' or v_proc.proisstrict or v_proc.proleakproof
      or v_proc.prokind<>'f' or v_proc.prorettype<>'jsonb'::regtype or v_proc.pronargs<>2
      or v_proc.pronargdefaults<>0 or v_proc.proargnames is distinct from array['p_manifest','p_expected']
      or (select array_agg(setting order by setting) from unnest(v_proc.proconfig) setting)
        is distinct from array['lock_timeout=5s','search_path=""','statement_timeout=20s'] then
      raise exception 'HOSTED_CLEANUP_UPGRADE_DEFINITION_DRIFT';
    end if;
    select count(*),count(*) filter(where grantor<>v_proc.proowner or is_grantable or privilege_type<>'EXECUTE'
      or grantee not in (v_proc.proowner,(select oid from pg_roles where rolname='service_role')))
      into v_acl_count,v_acl_invalid from aclexplode(coalesce(v_proc.proacl,acldefault('f',v_proc.proowner)));
    if v_acl_count<>2 or v_acl_invalid<>0
      or not has_function_privilege('service_role',v_function,'EXECUTE')
      or has_function_privilege('anon',v_function,'EXECUTE') or has_function_privilege('authenticated',v_function,'EXECUTE') then
      raise exception 'HOSTED_CLEANUP_UPGRADE_PRIVILEGE_DRIFT';
    end if;
    if v_schema='private' then v_old_body:=v_proc.prosrc; v_prior_acl:=v_proc.proacl; v_prior_owner:=v_proc.proowner; end if;
  end loop;
  if (length(v_old_body)-length(replace(v_old_body,v_old_event,'')))/length(v_old_event)<>1
    or (length(v_old_body)-length(replace(v_old_body,v_old_path,'')))/length(v_old_path)<>1 then
    raise exception 'HOSTED_CLEANUP_UPGRADE_REPLACEMENT_SCOPE';
  end if;
  v_new_body := replace(replace(v_old_body,v_old_event,v_new_event),v_old_path,v_new_path);
  if encode(sha256(convert_to(v_new_body,'UTF8')),'hex')<>'7d36c45e58b7d842724707e9e961700ef8c8493bb25605c1fde422ddf1c39848' then
    raise exception 'HOSTED_CLEANUP_UPGRADE_NEW_BODY_HASH';
  end if;
  execute format('create or replace function private.astra_staging_debate_cleanup_v1(p_manifest jsonb,p_expected jsonb)
    returns jsonb language plpgsql volatile security definer set search_path = ''''
    set lock_timeout = ''5s'' set statement_timeout = ''20s'' as %L',v_new_body);
  select * into v_proc from pg_proc where oid='private.astra_staging_debate_cleanup_v1(jsonb,jsonb)'::regprocedure;
  if encode(sha256(convert_to(v_proc.prosrc,'UTF8')),'hex')<>'7d36c45e58b7d842724707e9e961700ef8c8493bb25605c1fde422ddf1c39848'
    or v_proc.proacl is distinct from v_prior_acl or v_proc.proowner<>v_prior_owner then
    raise exception 'HOSTED_CLEANUP_UPGRADE_POSTCONDITION';
  end if;
end;
$upgrade$;
commit;

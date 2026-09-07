-- Fail closed when an authenticated actor has no authoritative administrator role.
-- Catalog-reviewed production/staging baseline: 2026-09-07 18:17 UTC.
-- Change ONLY the two NULL-role predicates. Preserve signatures, capabilities,
-- owner, SECURITY DEFINER/STABLE/search_path, service-only ACLs and body line endings.
-- The two exact known body encodings (production LF, staging CRLF) are pinned.
-- An exact already-patched definition is a safe no-op; unknown drift aborts BOTH
-- updates atomically. This migration reads no customer rows and changes no data.
do $astra_admin_role_fail_closed$
declare
  v_target record;
  v_oid oid;
  v_definition text;
  v_before_hash text;
  v_expected_after_hash text;
  v_metadata jsonb;
begin
  for v_target in
    select * from (values
      ('public.admin_authorization_context(uuid)',
       'if v_role not in (''admin'', ''founder_admin'', ''super_admin'') then',
       'if v_role is null or v_role not in (''admin'', ''founder_admin'', ''super_admin'') then',
       'c7992d0b3a5d1ae15ef04de5b1655afc7d37c104edcf9acad332a41299ad0350',
       '56834a7e84a3d9345447132ad56579d121761ca748e4075ff5904587c1a2c3a9',
       '7d22815f84eb36a8592e20562afa2b71ed29c0aeaf77a3311acaeb9843b7f273',
       '48a5a026bfe8705e7ea91a02721dd6519b74d286c3c094ddd50f1c77e5d39eee'),
      ('public.phase4_require_founder(uuid)',
       'if v_role not in (''founder_admin'',''super_admin'') then',
       'if v_role is null or v_role not in (''founder_admin'',''super_admin'') then',
       'd7ebadf6de5b4f1ba5fa557ec9e32d343f9a50083f2d97eaa90ecbe0ae59a451',
       '9d2ead39d5e903d48c1b9a53025ab930c6ed2fe67d71b9439ecde2e320ca8190',
       'c9e0e17e48849ea9328a3ccd7d02851214e5f58b325d05616474c742535af6da',
       '92bc71e505247a3909d85836a5ae763378677369eea93b620137bb818e49440b')
    ) as targets(signature, before_anchor, after_anchor, before_lf, after_lf, before_crlf, after_crlf)
  loop
    v_oid := to_regprocedure(v_target.signature);
    if v_oid is null then
      raise exception 'Administrator role guard prerequisite missing: %', v_target.signature;
    end if;

    select jsonb_build_object('owner', p.proowner, 'acl', p.proacl::text,
      'securityDefiner', p.prosecdef, 'volatility', p.provolatile,
      'config', p.proconfig) into strict v_metadata
    from pg_proc p where p.oid = v_oid;
    if v_metadata->>'owner' is distinct from (select oid::text from pg_roles where rolname = 'postgres')
       or v_metadata->>'acl' is distinct from '{postgres=X/postgres,service_role=X/postgres}'
       or v_metadata->>'securityDefiner' is distinct from 'true'
       or v_metadata->>'volatility' is distinct from 's'
       or v_metadata->'config' is distinct from '["search_path=public, pg_temp"]'::jsonb then
      raise exception 'Administrator role guard metadata drift: %', v_target.signature;
    end if;

    v_definition := pg_get_functiondef(v_oid);
    v_before_hash := encode(sha256(convert_to(v_definition, 'UTF8')), 'hex');
    if v_before_hash in (v_target.after_lf, v_target.after_crlf) then
      continue;
    elsif v_before_hash = v_target.before_lf then
      v_expected_after_hash := v_target.after_lf;
    elsif v_before_hash = v_target.before_crlf then
      v_expected_after_hash := v_target.after_crlf;
    else
      raise exception 'Administrator role guard definition drift: %', v_target.signature;
    end if;

    if (length(v_definition) - length(replace(v_definition, v_target.before_anchor, '')))
       / length(v_target.before_anchor) <> 1 then
      raise exception 'Administrator role guard anchor mismatch: %', v_target.signature;
    end if;
    v_definition := replace(v_definition, v_target.before_anchor, v_target.after_anchor);
    if encode(sha256(convert_to(v_definition, 'UTF8')), 'hex') <> v_expected_after_hash then
      raise exception 'Administrator role guard replacement mismatch: %', v_target.signature;
    end if;
    execute v_definition;

    if to_regprocedure(v_target.signature)::oid is distinct from v_oid
       or encode(sha256(convert_to(pg_get_functiondef(v_oid), 'UTF8')), 'hex') is distinct from v_expected_after_hash
       or v_metadata is distinct from (
         select jsonb_build_object('owner', p.proowner, 'acl', p.proacl::text,
           'securityDefiner', p.prosecdef, 'volatility', p.provolatile,
           'config', p.proconfig) from pg_proc p where p.oid = v_oid
       ) then
      raise exception 'Administrator role guard postcondition failed: %', v_target.signature;
    end if;
  end loop;
end;
$astra_admin_role_fail_closed$;

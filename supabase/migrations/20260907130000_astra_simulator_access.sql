-- Current Bar Simulation access without changing historical Syllabus-Based Review or admin management.
-- Staging first. No customer rows, answers, grades, timers, or receipts are rewritten.
begin;
set local lock_timeout = '4s';
set local statement_timeout = '30s';

create or replace function private.astra_simulator_entitlement(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare
  v_now timestamptz := statement_timestamp();
  v_basis text;
  v_ends timestamptz;
begin
  if p_user_id is null or not exists (
    select 1 from auth.users where id = p_user_id and coalesce(is_anonymous, false) = false
  ) then
    return jsonb_build_object('allowed', false, 'unlimited', false, 'track', 'bar_feels');
  end if;
  if public.dd2026_is_admin(p_user_id) then
    v_basis := 'admin';
  else
    select case when s.plan_code = 'early_access_beta' then 'early_access' else 'paid_subscription' end,
           s.expires_at into v_basis, v_ends
    from public.subscriptions s where s.user_id = p_user_id and s.status = 'active'
      and s.source in ('manual_payment', 'admin_adjustment', 'migration')
      and s.starts_at <= v_now and (s.expires_at is null or s.expires_at > v_now)
    order by s.expires_at desc nulls first, s.updated_at desc limit 1;
    if v_basis is null then
      select 'founding_beta', b.expires_at into v_basis, v_ends
      from public.free_beta_access b where b.user_id = p_user_id and b.enabled
        and b.access_program = 'founding_beta_2026'
        and (b.expires_at is null or b.expires_at > v_now) limit 1;
    end if;
    if v_basis is null then
      select 'provisional_payment', p.provisional_access_expires_at into v_basis, v_ends
      from public.payment_requests p where p.user_id = p_user_id
        and p.status in ('pending', 'needs_information')
        and p.provisional_access_started_at <= v_now
        and p.provisional_access_expires_at > v_now
        and p.provisional_access_expires_at <= p.provisional_access_started_at + interval '24 hours'
        and p.provisional_access_revoked_at is null
        and nullif(btrim(p.proof_object_path), '') is not null
      order by p.provisional_access_expires_at desc limit 1;
    end if;
  end if;
  return jsonb_build_object('allowed', v_basis is not null, 'unlimited', v_basis is not null,
    'basis', coalesce(v_basis, 'payment_required'), 'track', 'bar_feels',
    'entitlementEndsAt', v_ends);
end;
$function$;
revoke all on function private.astra_simulator_entitlement(uuid) from public, anon, authenticated;
grant execute on function private.astra_simulator_entitlement(uuid) to service_role;

create or replace function public.examination_authorize_access(
  p_user_id uuid, p_track text default null, p_version_id uuid default null,
  p_attempt_id uuid default null, p_allow_historical boolean default false
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_track text := nullif(btrim(coalesce(p_track, '')), '');
  v_access jsonb;
  v_simulator jsonb;
begin
  if p_user_id is null or not exists (
    select 1 from auth.users where id = p_user_id and coalesce(is_anonymous, false) = false
  ) then raise exception 'EXAM_ACCESS_REQUIRED'; end if;
  if p_attempt_id is not null then
    select d.track into v_track from public.examination_attempts_multi a
      join public.examination_versions v on v.id = a.version_id
      join public.examination_definitions d on d.id = v.exam_id
      where a.id = p_attempt_id and a.user_id = p_user_id;
    if v_track is null then raise exception 'EXAM_ATTEMPT_NOT_FOUND'; end if;
    if p_allow_historical and v_track = 'per_subject' then
      return jsonb_build_object('allowed', true, 'basis', 'historical_owner', 'track', v_track);
    end if;
  elsif p_version_id is not null then
    select d.track into v_track from public.examination_versions v
      join public.examination_definitions d on d.id = v.exam_id where v.id = p_version_id;
    if v_track is null then raise exception 'EXAM_VERSION_NOT_FOUND'; end if;
  elsif p_allow_historical and v_track = 'per_subject' and exists (
    select 1 from public.examination_attempts_multi a
      join public.examination_versions v on v.id = a.version_id
      join public.examination_definitions d on d.id = v.exam_id
      where a.user_id = p_user_id and d.track = v_track
  ) then
    return jsonb_build_object('allowed', true, 'basis', 'historical_owner', 'track', v_track);
  end if;
  if v_track is not null and v_track not in ('per_subject', 'bar_feels') then
    raise exception 'EXAM_ACCESS_REQUIRED';
  end if;
  v_access := public.phase4_access_snapshot(p_user_id, false, null);
  if v_track = 'bar_feels' then
    if coalesce((v_access->>'termsRequired')::boolean, false)
       or coalesce((v_access->>'reauthenticationRequired')::boolean, false)
       or (coalesce((v_access->>'commercialLaunchEnabled')::boolean, false)
           and (v_access->>'profileCompleted')::boolean is false)
    then raise exception 'EXAM_ACCESS_REQUIRED'; end if;
    v_simulator := private.astra_simulator_entitlement(p_user_id);
    if not coalesce((v_simulator->>'allowed')::boolean, false) then
      raise exception 'EXAM_PREMIUM_REQUIRED';
    end if;
    return v_simulator;
  end if;
  if not coalesce((v_access->>'allowed')::boolean, false) then
    raise exception 'EXAM_ACCESS_REQUIRED';
  end if;
  return jsonb_build_object('allowed', true, 'basis', v_access->>'basis', 'track', v_track,
    'accessMode', v_access->>'accessMode', 'remainingToday', (v_access->>'remainingToday')::integer,
    'unlimited', (v_access->>'unlimited')::boolean);
end;
$function$;
revoke all on function public.examination_authorize_access(uuid,text,uuid,uuid,boolean)
  from public, anon, authenticated;
grant execute on function public.examination_authorize_access(uuid,text,uuid,uuid,boolean) to service_role;

-- Resolve the actual owned attempt/version before using the new consumer access rule.
-- Other tracks retain their existing admission, including their historical policy.
create or replace function private.astra_examination_admit(p_user_id uuid, p_operation text, p_payload jsonb)
returns void language plpgsql security definer set search_path = ''
as $function$
declare
  v_track text := nullif(p_payload->>'track', '');
  v_attempt_id uuid := nullif(p_payload->>'attemptId', '')::uuid;
  v_version_id uuid := nullif(p_payload->>'versionId', '')::uuid;
begin
  if v_attempt_id is not null then
    select d.track into v_track from public.examination_attempts_multi a
      join public.examination_versions v on v.id = a.version_id
      join public.examination_definitions d on d.id = v.exam_id
      where a.id = v_attempt_id and a.user_id = p_user_id;
    if v_track is null then raise exception 'EXAM_ATTEMPT_NOT_FOUND'; end if;
  elsif v_version_id is not null then
    select d.track into v_track from public.examination_versions v
      join public.examination_definitions d on d.id = v.exam_id where v.id = v_version_id;
    if v_track is null then raise exception 'EXAM_VERSION_NOT_FOUND'; end if;
  elsif p_operation in ('confirm_upload', 'delete_upload') then
    v_track := 'bar_feels';
  end if;
  if v_track = 'bar_feels' then
    perform public.examination_authorize_access(p_user_id, v_track, v_version_id, v_attempt_id, false);
  else
    perform public.examination_require_beta(p_user_id);
  end if;
end;
$function$;
revoke all on function private.astra_examination_admit(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function private.astra_examination_admit(uuid,text,jsonb) to service_role;

-- Preserve the exact existing functions and apply only reviewed admission substitutions.
-- Hashes were read independently from staging and production on 2026-09-07.
do $patch$
declare
  v_target regprocedure;
  v_before text;
  v_after text;
  v_acl text;
  v_admin_before text := pg_get_functiondef('public.examination_is_admin(uuid)'::regprocedure);
  v_admin_acl text := (select proacl::text from pg_proc where oid='public.examination_is_admin(uuid)'::regprocedure);
  v_spec record;
  v_old text;
  v_new text;
begin
  for v_spec in select * from (values
    ('public.examination_command(uuid,text,jsonb)', 'b230aadf993a47e1b28b54e61b015fa8'),
    ('public.examination_query_pre_protected_review_release(uuid,text,jsonb)', '2e84d758553a745865f326154bb96373'),
    ('public.bar_simulation_start_attempt_v1(uuid,uuid,text,text,text)', '78530754fb332e1359961563c0193845')
  ) as s(signature, expected_hash)
  loop
    v_target := v_spec.signature::regprocedure;
    select pg_get_functiondef(v_target), proacl::text into v_before, v_acl from pg_proc where oid=v_target;
    if position('astra-simulator-access-20260907-r1' in v_before) > 0 then continue; end if;
    if md5(v_before) <> v_spec.expected_hash then
      raise exception 'ASTRA_SIMULATOR_SOURCE_CHANGED:%', v_spec.signature;
    end if;
    v_old := 'perform public.examination_require_beta(p_user_id);';
    if (length(v_before)-length(replace(v_before,v_old,'')))/length(v_old) <> 1 then
      raise exception 'ASTRA_SIMULATOR_ADMISSION_COUNT:%', v_spec.signature;
    end if;
    if v_spec.signature like '%bar_simulation_start_attempt_v1%' then
      -- Current access precedes receipt replay too; old attempts never substitute for entitlement.
      v_after := replace(v_before, E'begin\n  if p_user_id is null',
        E'begin\n  -- astra-simulator-access-20260907-r1\n  perform public.examination_authorize_access(p_user_id, ''bar_feels'', p_catalog_version_id, null, false);\n  if p_user_id is null');
      if v_after = v_before then raise exception 'ASTRA_SIMULATOR_START_ANCHOR_CHANGED'; end if;
      v_after := replace(v_after, v_old, '-- Current admission checked before receipt replay.');
      v_after := replace(v_after, 'public.examination_has_beta_access(p_user_id)',
        'coalesce((private.astra_simulator_entitlement(p_user_id)->>''allowed'')::boolean, false)');
    else
      v_new := E'-- astra-simulator-access-20260907-r1\n  perform private.astra_examination_admit(p_user_id, v_operation, v_payload);';
      v_after := replace(v_before, v_old, v_new);
      if v_spec.signature like '%examination_command%' then
        v_after := replace(v_after, 'public.examination_has_beta_access(p_user_id)',
          '(case when v_definition.track = ''bar_feels'' then coalesce((private.astra_simulator_entitlement(p_user_id)->>''allowed'')::boolean, false) else public.examination_has_beta_access(p_user_id) end)');
      else
        v_after := replace(v_after, 'public.examination_has_beta_access(p_user_id)',
          '(case when d.track = ''bar_feels'' then coalesce((private.astra_simulator_entitlement(p_user_id)->>''allowed'')::boolean, false) else public.examination_has_beta_access(p_user_id) end)');
      end if;
    end if;
    execute v_after;
    if (select proacl::text from pg_proc where oid=v_target) is distinct from v_acl then
      raise exception 'ASTRA_SIMULATOR_ACL_CHANGED:%', v_spec.signature;
    end if;
  end loop;
  if pg_get_functiondef('public.examination_is_admin(uuid)'::regprocedure) <> v_admin_before
     or (select proacl::text from pg_proc where oid='public.examination_is_admin(uuid)'::regprocedure) is distinct from v_admin_acl
  then raise exception 'ASTRA_SIMULATOR_ADMIN_BOUNDARY_CHANGED'; end if;
end;
$patch$;
commit;

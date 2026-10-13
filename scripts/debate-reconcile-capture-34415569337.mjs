// One failed rehearsal only. This module generates SQL; it makes no connection.
// The executing coordinator MUST independently pin the actual staging project.
// projectRef is a context guard, not immutable database identity proof.
export const EXACT_PROJECT_REF = 'hlzqmreeoghbldnhlybr';
export const EXACT_RUN_ID = '34415569337';
export const EXACT_EVENT_ID = 'de-aeb554ed338a0f459afdd2f4dc6995cc';
export const EXACT_JOB_ID = '049562ae-9dcc-4a54-9e9b-3b5877aea645';
export const EXACT_EXCLUDED_ID = '4e3d1df1-af99-4d13-a3de-2971c89c42d5';
export const EXACT_LEASE_UNTIL_MS = 1789001625924;
export const HELPER_BODY_SHA256 = Object.freeze({
  private: '7d36c45e58b7d842724707e9e961700ef8c8493bb25605c1fde422ddf1c39848',
  public: 'aec0459bac58aee8fc65057c1d9408f4b3e3842c059e38dbcdfa18fb834dcfd2',
});
const freeze = value => { for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); return Object.freeze(value); };
// Exact timestamps and run IDs from the retained, credential-free fixture receipt.
export const FIXED_MANIFEST = freeze({
  projectRef: EXACT_PROJECT_REF,
  runTag: 'dv3host-056595878a2bcf83',
  fixtures: [
    { purpose: 'host', id: '6d75b461-3588-44f6-a685-12f7f1399254', runId: 'dv3study-48394f84', createdAt: '2026-09-09T23:10:43.36114Z' },
    { purpose: 'A1', id: '25a46e1d-ac15-4ad5-b1d4-967312a8f9bd', runId: 'dv3study-c12b00a3', createdAt: '2026-09-09T23:10:48.185783Z' },
    { purpose: 'A2', id: '572eae0f-8345-44da-9960-8e9b90b44cdc', runId: 'dv3study-1ff382e0', createdAt: '2026-09-09T23:10:51.770117Z' },
    { purpose: 'A3', id: '03a0ccf6-6d5a-4a45-aff7-3e286f62dd13', runId: 'dv3study-a475ca96', createdAt: '2026-09-09T23:10:55.011339Z' },
    { purpose: 'N1', id: '48b429a8-a7d9-495b-b86f-080583a39482', runId: 'dv3study-218b8bc6', createdAt: '2026-09-09T23:10:58.275899Z' },
    { purpose: 'N2', id: '01eb8d5a-f8f5-4a24-bdd3-95859eec761f', runId: 'dv3study-d4345b5a', createdAt: '2026-09-09T23:11:01.484246Z' },
    { purpose: 'N3', id: '1c53ccad-3115-4e16-bb31-d208b0b4ff4c', runId: 'dv3study-41cc31da', createdAt: '2026-09-09T23:11:04.760899Z' },
    { purpose: 'judge2', id: '6ae3ef2d-c30e-4576-a61a-91dc5354a19d', runId: 'dv3study-8b083acf', createdAt: '2026-09-09T23:11:07.642795Z' },
    { purpose: 'judge3', id: '7c2fe5d6-c1c7-42fb-acce-6b44c6a68191', runId: 'dv3study-e9ffe6fb', createdAt: '2026-09-09T23:11:10.533721Z' },
    { purpose: 'observer', id: 'da6948ca-29da-4757-a181-2fb0ac9dd66c', runId: 'dv3study-d424ba37', createdAt: '2026-09-09T23:11:12.892852Z' },
  ],
  events: [{ id: EXACT_EVENT_ID, title: 'Hosted Debate dv3host-056595878a2bcf83 main' }],
});
export const EXACT_STORAGE_KEYS = Object.freeze([
  `evidence/${EXACT_EVENT_ID}/d7c78b2e-7977-4cc5-a574-ae8ece487dd1/9c2cbcd5-1278-4579-a75a-ceeecbedab43.pdf`,
  `exports/${EXACT_EVENT_ID}/${EXACT_JOB_ID}.pdf`,
  `exports/${EXACT_EVENT_ID}/5f44868b-0086-4d88-837c-5c46461fdb9d.pdf`,
  `exports/${EXACT_EVENT_ID}/b9a9a95c-14c4-40aa-b993-d13a4904dd10.pdf`,
].sort());
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${quote(JSON.stringify(value))}::jsonb`;

export function buildExactCaptureSql(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.getPrototypeOf(options) !== Object.prototype ||
      Object.keys(options).some(key => !['expectedEventSha256', 'expectedJobSha256', 'commit'].includes(key))) {
    throw new Error('EXACT_RECONCILE_ARGUMENTS');
  }
  const { expectedEventSha256, expectedJobSha256, commit = false } = options;
  if (![expectedEventSha256, expectedJobSha256].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)) ||
      typeof commit !== 'boolean') throw new Error('EXACT_RECONCILE_ARGUMENTS');
  return `-- Exact staging project ${EXACT_PROJECT_REF}; failed rehearsal ${EXACT_RUN_ID} only.
-- No project GUC is trusted. The executor pins the real project separately.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '20s';
set local search_path = '';
do $exact_reconcile$
declare
  v_schema text; v_function oid; v_proc record; v_expected_hash text;
  v_acl_count integer; v_acl_invalid integer; v_fixture jsonb;
  v_event jsonb; v_job jsonb; v_after jsonb; v_changed integer;
  v_manifest constant jsonb := ${json(FIXED_MANIFEST)};
begin
  if current_user <> 'postgres' or to_regclass('private.internal_test_accounts') is null
    or not has_schema_privilege('service_role','private','USAGE') then
    raise exception 'EXACT_RECONCILE_PREREQUISITE';
  end if;
  foreach v_schema in array array['private','public'] loop
    v_function := to_regprocedure(format('%I.astra_staging_debate_cleanup_v1(jsonb,jsonb)',v_schema));
    if v_function is null then raise exception 'EXACT_RECONCILE_HELPER_MISSING'; end if;
    select p.*,l.lanname,r.rolname into v_proc from pg_proc p
      join pg_language l on l.oid=p.prolang join pg_roles r on r.oid=p.proowner where p.oid=v_function;
    v_expected_hash := case when v_schema='private' then '${HELPER_BODY_SHA256.private}' else '${HELPER_BODY_SHA256.public}' end;
    if encode(sha256(convert_to(v_proc.prosrc,'UTF8')),'hex') is distinct from v_expected_hash
      or v_proc.rolname<>'postgres' or v_proc.prosecdef is distinct from (v_schema='private')
      or v_proc.lanname is distinct from (case when v_schema='private' then 'plpgsql' else 'sql' end)
      or v_proc.provolatile<>'v' or v_proc.proparallel<>'u' or v_proc.proisstrict or v_proc.proleakproof
      or v_proc.prokind<>'f' or v_proc.prorettype<>'jsonb'::regtype or v_proc.pronargs<>2
      or v_proc.pronargdefaults<>0 or v_proc.proargnames is distinct from array['p_manifest','p_expected']
      or (select array_agg(setting order by setting) from unnest(v_proc.proconfig) setting)
        is distinct from array['lock_timeout=5s','search_path=""','statement_timeout=20s'] then
      raise exception 'EXACT_RECONCILE_HELPER_DEFINITION_DRIFT';
    end if;
    select count(*),count(*) filter(where grantor<>v_proc.proowner or is_grantable or privilege_type<>'EXECUTE'
      or grantee not in (v_proc.proowner,(select oid from pg_roles where rolname='service_role')))
      into v_acl_count,v_acl_invalid from aclexplode(coalesce(v_proc.proacl,acldefault('f',v_proc.proowner)));
    if v_acl_count<>2 or v_acl_invalid<>0
      or not has_function_privilege('service_role',v_function,'EXECUTE')
      or has_function_privilege('anon',v_function,'EXECUTE') or has_function_privilege('authenticated',v_function,'EXECUTE') then
      raise exception 'EXACT_RECONCILE_HELPER_PRIVILEGE_DRIFT';
    end if;
  end loop;
  -- Match the helper's lock order. Auth row locks precede the nine Debate locks.
  for v_fixture in select f from jsonb_array_elements(v_manifest->'fixtures') f order by f->>'id' loop
    perform 1 from auth.users where id=(v_fixture->>'id')::uuid for update;
    if not found then raise exception 'EXACT_RECONCILE_AUTH_MISSING'; end if;
    -- Deliberately stricter than the helper: even revoked refresh rows fail.
    if exists(select 1 from auth.sessions where user_id=(v_fixture->>'id')::uuid)
      or exists(select 1 from auth.refresh_tokens where user_id=v_fixture->>'id') then
      raise exception 'EXACT_RECONCILE_SESSION_OR_REFRESH';
    end if;
  end loop;
  if exists(select 1 from auth.users where id='${EXACT_EXCLUDED_ID}'::uuid)
    or exists(select 1 from auth.sessions where user_id='${EXACT_EXCLUDED_ID}'::uuid)
    or exists(select 1 from auth.refresh_tokens where user_id='${EXACT_EXCLUDED_ID}') then
    raise exception 'EXACT_RECONCILE_EXCLUDED_REMAINS';
  end if;
  lock table public.debate_v3_events,public.debate_v3_uploads,public.debate_v3_outbox,
    public.debate_v3_receipts,public.debate_v3_audit,public.debate_v3_match_versions,
    public.debate_v3_ballots,public.debate_v3_votes,public.debate_v3_rate_limits in share row exclusive mode;
  select to_jsonb(e) into v_event from public.debate_v3_events e where id='${EXACT_EVENT_ID}' for update;
  if v_event is null or encode(sha256(convert_to(v_event::text,'UTF8')),'hex') <> '${expectedEventSha256}'
    or v_event->'revision' is distinct from '647'::jsonb
    or v_event->'state'->'revision' is distinct from '647'::jsonb
    or v_event->'state'->'rehearsal' is distinct from 'true'::jsonb
    or v_event->'state'->>'visibility' is distinct from 'unlisted'
    or v_event->'state'->'media' is distinct from '{}'::jsonb then
    raise exception 'EXACT_RECONCILE_EVENT_DRIFT';
  end if;
  select to_jsonb(j) into v_job from public.debate_v3_outbox j where id='${EXACT_JOB_ID}' for update;
  if v_job is null or encode(sha256(convert_to(v_job::text,'UTF8')),'hex') <> '${expectedJobSha256}'
    or v_job->>'event_id' is distinct from '${EXACT_EVENT_ID}'
    or v_job->>'actor_id' is distinct from '${FIXED_MANIFEST.fixtures[0].id}'
    or v_job->>'status' is distinct from 'running' or v_job->'attempts' is distinct from '1'::jsonb
    or v_job->>'type' is distinct from 'export' or v_job->'job'->'payload'->'document'->>'kind' is distinct from 'result'
    or v_job->'job'->'payload'->>'format' is distinct from 'pdf'
    or coalesce(v_job->>'claim_id','')=''
    or v_job->'lease_until_ms' is distinct from '${EXACT_LEASE_UNTIL_MS}'::jsonb
    or (v_job->>'lease_until_ms')::bigint >= floor(extract(epoch from clock_timestamp())*1000)::bigint then
    raise exception 'EXACT_RECONCILE_JOB_DRIFT';
  end if;
  update public.debate_v3_outbox set status='cancelled',claim_id=null,lease_until_ms=null
    where id='${EXACT_JOB_ID}' and to_jsonb(debate_v3_outbox)=v_job;
  get diagnostics v_changed = row_count;
  if v_changed<>1 then raise exception 'EXACT_RECONCILE_UPDATE_COUNT'; end if;
  select to_jsonb(j) into v_after from public.debate_v3_outbox j where id='${EXACT_JOB_ID}';
  if v_after is distinct from v_job||'{"status":"cancelled","claim_id":null,"lease_until_ms":null}'::jsonb then
    raise exception 'EXACT_RECONCILE_UPDATE_SCOPE';
  end if;
end;
$exact_reconcile$;
set local role service_role;
do $exact_capture$
declare v_capture jsonb;
begin
  -- Ownership, role, financial and all event/child boundaries are rechecked by
  -- the unchanged helper. Any rejection rolls back the cancellation above.
  v_capture := public.astra_staging_debate_cleanup_v1(${json(FIXED_MANIFEST)},null);
  if v_capture->>'status' is distinct from 'CAPTURED'
    or v_capture->'snapshot'->'storageKeys' is distinct from ${json(EXACT_STORAGE_KEYS)}
    or v_capture->'snapshot'->'counts'->'events' is distinct from '1'::jsonb
    or v_capture->'snapshot'->'counts'->'outbox' is distinct from '4'::jsonb then
    raise exception 'EXACT_RECONCILE_CAPTURE_SCOPE';
  end if;
  perform set_config('astra.exact_reconcile_capture',v_capture::text,true);
end;
$exact_capture$;
select jsonb_build_object('status','CAPTURED','projectRef','${EXACT_PROJECT_REF}',
  'runId','${EXACT_RUN_ID}','eventId','${EXACT_EVENT_ID}','jobId','${EXACT_JOB_ID}',
  'expectedEventSha256','${expectedEventSha256}','expectedJobSha256','${expectedJobSha256}',
  'transactionMode','${commit ? 'COMMIT_REQUESTED' : 'ROLLBACK_ONLY'}',
  'snapshot',current_setting('astra.exact_reconcile_capture')::jsonb->'snapshot');
${commit ? 'commit' : 'rollback'};
`;
}

-- Bounded, idempotent transport for the 800+ row Simulation pool snapshot.
-- Staging is private and has no catalog-visible effect. Finalization invokes
-- the already validated full-snapshot synchronizer in one transaction.
begin;

set local lock_timeout = '250ms';
set local statement_timeout = '5s';

create table if not exists public.bar_simulation_pool_staging_v1 (
  sync_id uuid not null,
  part_number smallint not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  total_parts smallint not null,
  source_digest text not null,
  source_endpoint text not null,
  payload_hash text not null,
  rows_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key (sync_id, part_number),
  constraint bar_simulation_pool_staging_part_check
    check (part_number between 1 and total_parts and total_parts between 1 and 200),
  constraint bar_simulation_pool_staging_digest_check
    check (source_digest ~ '^[0-9a-f]{64}$'),
  constraint bar_simulation_pool_staging_payload_hash_check
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint bar_simulation_pool_staging_rows_check
    check (jsonb_typeof(rows_json) = 'array'
      and jsonb_array_length(rows_json) between 1 and 100)
);

create index if not exists bar_simulation_pool_staging_created_idx
  on public.bar_simulation_pool_staging_v1(created_at);

alter table public.bar_simulation_pool_staging_v1 enable row level security;
alter table public.bar_simulation_pool_staging_v1 force row level security;
revoke all on table public.bar_simulation_pool_staging_v1
  from public, anon, authenticated;
grant select on table public.bar_simulation_pool_staging_v1 to service_role;

commit;

begin;

set local statement_timeout = '5min';

create or replace function public.bar_simulation_stage_pool_v1(
  p_actor_user_id uuid,
  p_sync_id uuid,
  p_part_number integer,
  p_total_parts integer,
  p_rows jsonb,
  p_source_digest text,
  p_source_endpoint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $bar_simulation_stage_pool_v1$
declare
  v_payload_hash text;
  v_existing public.bar_simulation_pool_staging_v1%rowtype;
  v_inserted boolean := false;
begin
  perform public.examination_require_admin(p_actor_user_id);
  if p_sync_id is null
     or p_part_number is null
     or p_total_parts is null
     or p_part_number not between 1 and p_total_parts
     or p_total_parts not between 1 and 200
     or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) not between 1 and 100
     or coalesce(p_source_digest, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_source_endpoint, '')
       not like 'https://docs.google.com/spreadsheets/%'
  then
    raise exception 'BAR_SIMULATION_POOL_STAGE_INVALID';
  end if;
  v_payload_hash := encode(
    extensions.digest(p_rows::text, 'sha256'),
    'hex'
  );
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'bar-simulation-pool-stage-v1:' || p_sync_id::text,
    0
  ));

  if exists (
    select 1
    from public.bar_simulation_pool_staging_v1 staged
    where staged.sync_id = p_sync_id
      and (
        staged.actor_user_id <> p_actor_user_id
        or staged.total_parts <> p_total_parts
        or staged.source_digest <> lower(p_source_digest)
        or staged.source_endpoint <> p_source_endpoint
      )
  ) then
    raise exception 'BAR_SIMULATION_POOL_STAGE_CONFLICT';
  end if;

  insert into public.bar_simulation_pool_staging_v1 (
    sync_id, part_number, actor_user_id, total_parts, source_digest,
    source_endpoint, payload_hash, rows_json
  )
  values (
    p_sync_id, p_part_number, p_actor_user_id, p_total_parts,
    lower(p_source_digest), p_source_endpoint, v_payload_hash, p_rows
  )
  on conflict (sync_id, part_number) do nothing
  returning true into v_inserted;

  select * into v_existing
  from public.bar_simulation_pool_staging_v1
  where sync_id = p_sync_id
    and part_number = p_part_number;
  if v_existing.payload_hash <> v_payload_hash
     or v_existing.rows_json <> p_rows
  then
    raise exception 'BAR_SIMULATION_POOL_STAGE_CONFLICT';
  end if;
  return jsonb_build_object(
    'syncId', p_sync_id,
    'partNumber', p_part_number,
    'totalParts', p_total_parts,
    'acceptedRows', jsonb_array_length(p_rows),
    'replayed', not coalesce(v_inserted, false)
  );
end;
$bar_simulation_stage_pool_v1$;

create or replace function public.bar_simulation_finalize_pool_v1(
  p_actor_user_id uuid,
  p_sync_id uuid,
  p_source_digest text,
  p_source_endpoint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $bar_simulation_finalize_pool_v1$
declare
  v_total_parts integer;
  v_received_parts integer;
  v_rows jsonb;
  v_result jsonb;
begin
  perform public.examination_require_admin(p_actor_user_id);
  if p_sync_id is null
     or coalesce(p_source_digest, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_source_endpoint, '')
       not like 'https://docs.google.com/spreadsheets/%'
  then
    raise exception 'BAR_SIMULATION_POOL_FINALIZE_INVALID';
  end if;
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'bar-simulation-pool-stage-v1:' || p_sync_id::text,
    0
  ));

  select max(staged.total_parts), count(*)
  into v_total_parts, v_received_parts
  from public.bar_simulation_pool_staging_v1 staged
  where staged.sync_id = p_sync_id
    and staged.actor_user_id = p_actor_user_id
    and staged.source_digest = lower(p_source_digest)
    and staged.source_endpoint = p_source_endpoint;
  if v_total_parts is null
     or v_received_parts <> v_total_parts
     or exists (
       select 1
       from generate_series(1, v_total_parts) expected(part_number)
       where not exists (
         select 1
         from public.bar_simulation_pool_staging_v1 staged
         where staged.sync_id = p_sync_id
           and staged.part_number = expected.part_number
       )
     )
  then
    raise exception 'BAR_SIMULATION_POOL_STAGE_INCOMPLETE';
  end if;

  select jsonb_agg(item.value order by staged.part_number, item.ordinality)
  into v_rows
  from public.bar_simulation_pool_staging_v1 staged
  cross join lateral jsonb_array_elements(staged.rows_json)
    with ordinality as item(value, ordinality)
  where staged.sync_id = p_sync_id;

  v_result := public.bar_simulation_sync_pool_v1(
    p_actor_user_id,
    v_rows,
    lower(p_source_digest),
    p_source_endpoint
  );
  delete from public.bar_simulation_pool_staging_v1
  where sync_id = p_sync_id;
  return v_result || jsonb_build_object(
    'stagedParts', v_total_parts,
    'stagedRows', jsonb_array_length(v_rows)
  );
end;
$bar_simulation_finalize_pool_v1$;

revoke all on function public.bar_simulation_stage_pool_v1(
  uuid, uuid, integer, integer, jsonb, text, text
) from public, anon, authenticated;
revoke all on function public.bar_simulation_finalize_pool_v1(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.bar_simulation_stage_pool_v1(
  uuid, uuid, integer, integer, jsonb, text, text
) to service_role;
grant execute on function public.bar_simulation_finalize_pool_v1(
  uuid, uuid, text, text
) to service_role;

commit;

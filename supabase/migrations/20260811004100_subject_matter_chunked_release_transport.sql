-- Due Diligence: bounded, atomic transport for the two-bank Subject Matter sync.
-- Payload chunks are backend-only and never become catalog-visible. Publication
-- occurs only inside the final all-content transaction after every part passes.

begin;

create table if not exists public.release_subject_matter_payload_parts (
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  sync_id uuid not null,
  payload_kind text not null check (payload_kind in ('rows', 'placements')),
  part_number integer not null check (part_number between 1 and 100),
  total_parts integer not null check (total_parts between 1 and 100),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'array'
    and jsonb_array_length(payload) between 1 and 200
  ),
  source_digest text not null check (source_digest ~ '^[0-9a-f]{64}$'),
  source_endpoint text not null check (
    source_endpoint ~ '^https://docs\.google\.com/spreadsheets/'
  ),
  placement_digest text not null check (placement_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 hours'),
  primary key (actor_user_id, sync_id, payload_kind, part_number),
  check (part_number <= total_parts),
  check (expires_at > created_at)
);

create index if not exists release_subject_matter_payload_expiry_idx
  on public.release_subject_matter_payload_parts (expires_at);

alter table public.release_subject_matter_payload_parts enable row level security;
alter table public.release_subject_matter_payload_parts force row level security;
revoke all on public.release_subject_matter_payload_parts
  from public, anon, authenticated;
grant select, insert, update, delete on public.release_subject_matter_payload_parts
  to service_role;

create or replace function public.release_stage_subject_matter_v2(
  p_actor_user_id uuid,
  p_sync_id uuid,
  p_payload_kind text,
  p_part_number integer,
  p_total_parts integer,
  p_payload jsonb,
  p_source_digest text,
  p_source_endpoint text,
  p_placement_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_kind text := lower(btrim(coalesce(p_payload_kind, '')));
begin
  perform public.examination_require_admin(p_actor_user_id);
  if p_sync_id is null
     or v_kind not in ('rows', 'placements')
     or p_part_number not between 1 and 100
     or p_total_parts not between 1 and 100
     or p_part_number > p_total_parts
     or jsonb_typeof(p_payload) <> 'array'
     or jsonb_array_length(p_payload) not between 1 and 200
     or p_source_digest !~ '^[0-9a-f]{64}$'
     or p_source_endpoint !~ '^https://docs\.google\.com/spreadsheets/'
     or p_placement_digest !~ '^[0-9a-f]{64}$'
  then
    raise exception 'SUBJECT_MATTER_STAGE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'subject-release-stage:' || p_actor_user_id::text || ':' || p_sync_id::text,
    0
  ));

  delete from public.release_subject_matter_payload_parts
  where expires_at <= now();

  if exists (
    select 1
    from public.release_subject_matter_payload_parts
    where actor_user_id = p_actor_user_id
      and sync_id = p_sync_id
      and (
        source_digest <> p_source_digest
        or source_endpoint <> p_source_endpoint
        or placement_digest <> p_placement_digest
        or (payload_kind = v_kind and total_parts <> p_total_parts)
      )
  ) then
    raise exception 'SUBJECT_MATTER_STAGE_CONFLICT';
  end if;

  insert into public.release_subject_matter_payload_parts (
    actor_user_id, sync_id, payload_kind, part_number, total_parts,
    payload, source_digest, source_endpoint, placement_digest
  ) values (
    p_actor_user_id, p_sync_id, v_kind, p_part_number, p_total_parts,
    p_payload, p_source_digest, p_source_endpoint, p_placement_digest
  )
  on conflict (actor_user_id, sync_id, payload_kind, part_number) do update
  set total_parts = excluded.total_parts,
      payload = excluded.payload,
      source_digest = excluded.source_digest,
      source_endpoint = excluded.source_endpoint,
      placement_digest = excluded.placement_digest,
      created_at = now(),
      expires_at = now() + interval '2 hours';

  return jsonb_build_object(
    'accepted', jsonb_array_length(p_payload),
    'kind', v_kind,
    'part', p_part_number,
    'parts', p_total_parts
  );
end;
$$;

revoke all on function public.release_stage_subject_matter_v2(
  uuid, uuid, text, integer, integer, jsonb, text, text, text
) from public, anon, authenticated;
grant execute on function public.release_stage_subject_matter_v2(
  uuid, uuid, text, integer, integer, jsonb, text, text, text
) to service_role;

create or replace function public.release_finalize_subject_matter_v2(
  p_actor_user_id uuid,
  p_sync_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
  v_placements jsonb;
  v_source_digest text;
  v_source_endpoint text;
  v_placement_digest text;
  v_subject_result jsonb;
  v_rows_parts integer;
  v_rows_expected integer;
  v_placement_parts integer;
  v_placement_expected integer;
begin
  perform public.examination_require_admin(p_actor_user_id);
  if p_sync_id is null then
    raise exception 'SUBJECT_MATTER_FINALIZE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'subject-release-stage:' || p_actor_user_id::text || ':' || p_sync_id::text,
    0
  ));

  select
    count(*) filter (where payload_kind = 'rows')::integer,
    max(total_parts) filter (where payload_kind = 'rows')::integer,
    count(*) filter (where payload_kind = 'placements')::integer,
    max(total_parts) filter (where payload_kind = 'placements')::integer,
    min(source_digest),
    min(source_endpoint),
    min(placement_digest)
  into
    v_rows_parts, v_rows_expected, v_placement_parts,
    v_placement_expected, v_source_digest, v_source_endpoint,
    v_placement_digest
  from public.release_subject_matter_payload_parts
  where actor_user_id = p_actor_user_id
    and sync_id = p_sync_id
    and expires_at > now();

  if v_rows_parts is distinct from v_rows_expected
     or v_placement_parts is distinct from v_placement_expected
     or coalesce(v_rows_parts, 0) = 0
     or coalesce(v_placement_parts, 0) = 0
     or exists (
       select 1
       from public.release_subject_matter_payload_parts
       where actor_user_id = p_actor_user_id
         and sync_id = p_sync_id
         and expires_at > now()
         and (
           source_digest <> v_source_digest
           or source_endpoint <> v_source_endpoint
           or placement_digest <> v_placement_digest
         )
     )
  then
    raise exception 'SUBJECT_MATTER_STAGE_INCOMPLETE';
  end if;

  select coalesce(jsonb_agg(element order by part_number, ordinal), '[]'::jsonb)
  into v_rows
  from public.release_subject_matter_payload_parts parts
  cross join lateral jsonb_array_elements(parts.payload)
    with ordinality expanded(element, ordinal)
  where parts.actor_user_id = p_actor_user_id
    and parts.sync_id = p_sync_id
    and parts.payload_kind = 'rows'
    and parts.expires_at > now();

  select coalesce(jsonb_agg(element order by part_number, ordinal), '[]'::jsonb)
  into v_placements
  from public.release_subject_matter_payload_parts parts
  cross join lateral jsonb_array_elements(parts.payload)
    with ordinality expanded(element, ordinal)
  where parts.actor_user_id = p_actor_user_id
    and parts.sync_id = p_sync_id
    and parts.payload_kind = 'placements'
    and parts.expires_at > now();

  if jsonb_array_length(v_rows) <> 1622
     or jsonb_array_length(v_placements) <> 1890
  then
    raise exception 'SUBJECT_MATTER_STAGE_COUNT_INVALID';
  end if;

  v_subject_result := public.release_sync_subject_matter_v2(
    p_actor_user_id,
    v_rows,
    v_source_digest,
    v_source_endpoint,
    v_placements,
    v_placement_digest
  );

  delete from public.release_subject_matter_payload_parts
  where actor_user_id = p_actor_user_id and sync_id = p_sync_id;

  return v_subject_result;
end;
$$;

revoke all on function public.release_finalize_subject_matter_v2(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.release_finalize_subject_matter_v2(uuid, uuid)
  to service_role;

create or replace function public.release_finalize_all_content_v2(
  p_actor_user_id uuid,
  p_sync_id uuid,
  p_bar_groups jsonb,
  p_bar_digest text,
  p_bar_endpoint text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subject_result jsonb;
  v_bar_result jsonb;
begin
  -- Nested functions share this outer transaction. A Bar Feels failure rolls
  -- back the Subject Matter publication and staged-payload cleanup as well.
  v_subject_result := public.release_finalize_subject_matter_v2(
    p_actor_user_id,
    p_sync_id
  );
  v_bar_result := public.release_sync_bar_feels(
    p_actor_user_id,
    p_bar_groups,
    p_bar_digest,
    p_bar_endpoint
  );
  return jsonb_build_object(
    'subjectMatter', v_subject_result,
    'barFeels', v_bar_result
  );
end;
$$;

revoke all on function public.release_finalize_all_content_v2(
  uuid, uuid, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.release_finalize_all_content_v2(
  uuid, uuid, jsonb, text, text
) to service_role;

commit;

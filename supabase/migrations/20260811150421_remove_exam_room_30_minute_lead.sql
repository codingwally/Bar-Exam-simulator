-- Allow a Professor to publish or reschedule an Examination Room test for an
-- immediate opening. The class-list, Beadle, access-code, attempt, close-time,
-- and immutable-publication safeguards remain unchanged.

begin;

do $migration$
declare
  v_target regprocedure;
  v_definition text;
  v_fragment text;
begin
  v_target := to_regprocedure(
    'public.exam_room_schedule_for_handoff_v3(uuid,uuid,timestamptz,timestamptz,integer,text,text)'
  );
  if v_target is null then
    raise exception 'EXAM_ROOM_IMMEDIATE_OPEN_PREFLIGHT_SCHEDULER_MISSING';
  end if;
  select pg_get_functiondef(v_target::oid) into v_definition;
  v_fragment := 'if p_opens_at < clock_timestamp() + interval ''30 minutes'' then
    raise exception ''EXAM_ROOM_HANDOFF_TIME_REQUIRED'';
  end if;';
  if position(v_fragment in v_definition) > 0 then
    execute replace(v_definition, v_fragment, '');
  elsif position('EXAM_ROOM_HANDOFF_TIME_REQUIRED' in v_definition) > 0 then
    raise exception 'EXAM_ROOM_IMMEDIATE_OPEN_PREFLIGHT_SCHEDULER_CHANGED';
  end if;

  v_target := to_regprocedure(
    'public.exam_room_publish_for_beadle_v3(uuid,uuid,jsonb,text,text,text,timestamptz,text,text)'
  );
  if v_target is null then
    raise exception 'EXAM_ROOM_IMMEDIATE_OPEN_PREFLIGHT_PUBLISHER_MISSING';
  end if;
  select pg_get_functiondef(v_target::oid) into v_definition;
  v_fragment := 'if v_opens_at < clock_timestamp() + interval ''30 minutes'' then
    raise exception ''EXAM_ROOM_HANDOFF_TIME_REQUIRED'';
  end if;';
  if position(v_fragment in v_definition) > 0 then
    execute replace(v_definition, v_fragment, '');
  elsif position('EXAM_ROOM_HANDOFF_TIME_REQUIRED' in v_definition) > 0 then
    raise exception 'EXAM_ROOM_IMMEDIATE_OPEN_PREFLIGHT_PUBLISHER_CHANGED';
  end if;

  v_target := to_regprocedure(
    'public.exam_room_reschedule_publication_v1(uuid,uuid,uuid,bigint,timestamptz,timestamptz,integer,integer,integer,text,text)'
  );
  if v_target is null then
    raise exception 'EXAM_ROOM_IMMEDIATE_OPEN_PREFLIGHT_RESCHEDULER_MISSING';
  end if;
  select pg_get_functiondef(v_target::oid) into v_definition;
  v_fragment := '    or p_opens_at < clock_timestamp() + interval ''30 minutes''
';
  if position(v_fragment in v_definition) > 0 then
    execute replace(v_definition, v_fragment, '');
  elsif position('p_opens_at < clock_timestamp() + interval ''30 minutes''' in v_definition) > 0 then
    raise exception 'EXAM_ROOM_IMMEDIATE_OPEN_PREFLIGHT_RESCHEDULER_CHANGED';
  end if;

  if exists (
    select 1
    from unnest(array[
      to_regprocedure('public.exam_room_schedule_for_handoff_v3(uuid,uuid,timestamptz,timestamptz,integer,text,text)'),
      to_regprocedure('public.exam_room_publish_for_beadle_v3(uuid,uuid,jsonb,text,text,text,timestamptz,text,text)'),
      to_regprocedure('public.exam_room_reschedule_publication_v1(uuid,uuid,uuid,bigint,timestamptz,timestamptz,integer,integer,integer,text,text)')
    ]) as target(function_oid)
    where position('interval ''30 minutes''' in pg_get_functiondef(target.function_oid::oid)) > 0
      or position('EXAM_ROOM_HANDOFF_TIME_REQUIRED' in pg_get_functiondef(target.function_oid::oid)) > 0
  ) then
    raise exception 'EXAM_ROOM_IMMEDIATE_OPEN_POSTCONDITION_FAILED';
  end if;
end;
$migration$;

revoke all on function public.exam_room_schedule_for_handoff_v3(
  uuid, uuid, timestamptz, timestamptz, integer, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.exam_room_publish_for_beadle_v3(
  uuid, uuid, jsonb, text, text, text, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_publish_for_beadle_v3(
  uuid, uuid, jsonb, text, text, text, timestamptz, text, text
) to service_role;

revoke all on function public.exam_room_reschedule_publication_v1(
  uuid, uuid, uuid, bigint, timestamptz, timestamptz,
  integer, integer, integer, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_reschedule_publication_v1(
  uuid, uuid, uuid, bigint, timestamptz, timestamptz,
  integer, integer, integer, text, text
) to service_role;

comment on function public.exam_room_schedule_for_handoff_v3(
  uuid, uuid, timestamptz, timestamptz, integer, text, text
) is 'Schedules the protected Beadle handoff with no minimum opening lead time.';
comment on function public.exam_room_publish_for_beadle_v3(
  uuid, uuid, jsonb, text, text, text, timestamptz, text, text
) is 'Publishes the atomic Beadle handoff and permits an immediate examination opening.';
comment on function public.exam_room_reschedule_publication_v1(
  uuid, uuid, uuid, bigint, timestamptz, timestamptz,
  integer, integer, integer, text, text
) is 'Creates a schedule-only publication revision and permits an immediate examination opening.';

commit;

begin;

do $$
declare
  ddl text;
  old_fragment text := $old$
          'connected', coalesce((session.session_metadata ->> 'connected')::boolean, false),
$old$;
  new_fragment text := $new$
          'connected', (
            session.session_status in ('created','active')
            and coalesce(session.last_heartbeat_at, session.updated_at, session.started_at)
                >= now() - interval '45 seconds'
          ),
$new$;
begin
  select pg_get_functiondef(p.oid)
  into ddl
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='examination_room_v1'
    and p.proname='api_professor_view'
    and pg_get_function_identity_arguments(p.oid)='p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_exam_id uuid';

  if position(new_fragment in ddl) = 0 then
    if position(old_fragment in ddl) = 0 then
      raise exception 'Expected monitor connected fragment was not found';
    end if;
    ddl := replace(ddl, old_fragment, new_fragment);
    execute ddl;
  end if;
end;
$$;

commit;

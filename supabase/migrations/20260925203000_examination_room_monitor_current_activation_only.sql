begin;

do $$
declare
  ddl text;
  grading_pos integer;
  monitor_prefix text;
  grading_suffix text;
  old_filter text := 'where session.exam_id = exam.id';
  new_filter text := $new$
where session.exam_id = exam.id
          and session.activation_id = (
            select current_activation.id
            from examination_room_v1.room_activations current_activation
            where current_activation.exam_id = exam.id
            order by current_activation.created_at desc, current_activation.id desc
            limit 1
          )
$new$;
begin
  select pg_get_functiondef(p.oid)
  into ddl
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='examination_room_v1'
    and p.proname='api_professor_view'
    and pg_get_function_identity_arguments(p.oid)='p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_exam_id uuid';

  grading_pos := position('if p_operation = ''grading'' then' in ddl);
  if grading_pos = 0 then
    raise exception 'Expected grading branch not found';
  end if;

  monitor_prefix := substring(ddl from 1 for grading_pos - 1);
  grading_suffix := substring(ddl from grading_pos);

  if position(new_filter in monitor_prefix) = 0 then
    if position(old_filter in monitor_prefix) = 0 then
      raise exception 'Expected monitor session filter not found';
    end if;
    monitor_prefix := replace(monitor_prefix, old_filter, new_filter);
    ddl := monitor_prefix || grading_suffix;
    execute ddl;
  end if;
end;
$$;

commit;

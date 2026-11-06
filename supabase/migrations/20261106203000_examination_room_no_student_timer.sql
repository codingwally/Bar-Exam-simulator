-- The professor's No Time Limit option is represented by the current
-- published duration sentinel (1440 minutes / 86400 seconds).
-- Remove the otherwise imposed 24-hour per-student lease and use only the
-- room's already-enforced closure time. All timed exams are unchanged.
-- No student sessions, answers or receipts are modified.
begin;
do $patch$
declare
  definition text := pg_get_functiondef('examination_room_v1.api_student(text,jsonb)'::regprocedure);
  old_expression text := $before$    lease_expires_at := case
      when coalesce(controls_payload ->> 'lateSubmissions', 'not_allowed') = 'professor_review'
        then activation_closes_at
      else least($before$;
  new_expression text := $after$    lease_expires_at := case
      -- The 1440-minute selector value denotes No Time Limit, not 24 hours.
      -- Admission and submission still require the room to remain open.
      when duration_seconds = 86400 then activation_closes_at
      when coalesce(controls_payload ->> 'lateSubmissions', 'not_allowed') = 'professor_review'
        then activation_closes_at
      else least($after$;
begin
  if strpos(definition,new_expression) > 0 then
    return;
  end if;
  if strpos(definition,old_expression) = 0 then
    raise exception 'Expected examination session lease expression not found; refusing unreviewed change';
  end if;
  execute replace(definition,old_expression,new_expression);
end;
$patch$;
commit;

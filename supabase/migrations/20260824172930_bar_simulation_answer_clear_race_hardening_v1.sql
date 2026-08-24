-- Correct staging/early installations of the capture function. Fresh
-- production installs already receive this definition from the base migration.
begin;

create or replace function public.bar_simulation_capture_answer_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $bar_simulation_capture_answer_v1$
declare
  v_user_id uuid;
begin
  if nullif(btrim(new.answer_text), '') is null
     and (
       tg_op <> 'UPDATE'
       or nullif(btrim(old.answer_text), '') is null
     )
  then
    return new;
  end if;
  select attempt.user_id
  into v_user_id
  from public.examination_attempts_multi attempt
  join public.examination_versions version on version.id = attempt.version_id
  join public.examination_definitions definition on definition.id = version.exam_id
  where attempt.id = new.attempt_id
    and definition.track = 'bar_feels';
  if v_user_id is not null then
    insert into public.bar_simulation_answered_questions (
      user_id, question_id, first_attempt_id, first_answered_at
    )
    values (v_user_id, new.question_id, new.attempt_id, now())
    on conflict (user_id, question_id) do nothing;
  end if;
  return new;
end;
$bar_simulation_capture_answer_v1$;

revoke all on function public.bar_simulation_capture_answer_v1()
  from public, anon, authenticated;

commit;

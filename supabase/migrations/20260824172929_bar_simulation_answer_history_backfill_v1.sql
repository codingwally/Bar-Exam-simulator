-- Run only after the answer-capture trigger is committed. New nonblank answers
-- are then captured while this idempotent statement fills older observable
-- Simulation history, eliminating the install-time race without blocking
-- ordinary response writes.
begin;

set local statement_timeout = '120s';

insert into public.bar_simulation_answered_questions (
  user_id, question_id, first_attempt_id, first_answered_at
)
select distinct on (attempt.user_id, response.question_id)
  attempt.user_id,
  response.question_id,
  attempt.id,
  response.saved_at
from public.examination_responses response
join public.examination_attempts_multi attempt on attempt.id = response.attempt_id
join public.examination_versions version on version.id = attempt.version_id
join public.examination_definitions definition on definition.id = version.exam_id
where definition.track = 'bar_feels'
  and nullif(btrim(response.answer_text), '') is not null
order by attempt.user_id, response.question_id, response.saved_at
on conflict (user_id, question_id) do nothing;

commit;

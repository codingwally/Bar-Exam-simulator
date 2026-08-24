-- Install the response capture hook in its own fail-fast transaction.
-- CREATE TRIGGER takes a write-conflicting lock on examination_responses;
-- never wait behind paid-user saves and never hold that lock during unrelated
-- schema or backfill work.
begin;

set local lock_timeout = '250ms';
set local statement_timeout = '5s';

create trigger bar_simulation_capture_answer_v1_trigger
after insert or update of answer_text on public.examination_responses
for each row
execute function public.bar_simulation_capture_answer_v1();

commit;

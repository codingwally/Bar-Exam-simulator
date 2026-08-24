-- Install both hooks on examination_attempts_multi in one tiny fail-fast
-- transaction. If the live table is busy, the migration aborts instead of
-- queuing or delaying an examinee's attempt update.
begin;

set local lock_timeout = '250ms';
set local statement_timeout = '5s';

create trigger bar_simulation_close_allocation_v1_trigger
after update of status on public.examination_attempts_multi
for each row
execute function public.bar_simulation_close_allocation_v1();

create trigger bar_simulation_guard_one_open_attempt_v1_trigger
before insert or update of user_id, version_id, status
on public.examination_attempts_multi
for each row
execute function public.bar_simulation_guard_one_open_attempt_v1();

commit;

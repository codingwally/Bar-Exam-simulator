-- Active-time hardening for self-paced examinations.
--
-- The shared examination engine previously derived a self-paced attempt's
-- elapsed time from started_at. That counted time while the page was hidden,
-- the browser was closed, or the user was signed out. The trigger below makes
-- the stored counter authoritative and advances it only across a normal
-- heartbeat interval. Strict and untimed modes retain their existing behavior.

create or replace function public.examination_active_elapsed_seconds(
  p_previous_elapsed integer,
  p_previous_heartbeat timestamptz,
  p_observed_at timestamptz
)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select least(
    2147483647::bigint,
    greatest(0, coalesce(p_previous_elapsed, 0))::bigint
      + case
          when p_previous_heartbeat is null
            or p_observed_at is null
            or p_observed_at < p_previous_heartbeat
          then 0
          when extract(epoch from (p_observed_at - p_previous_heartbeat)) <= 45
          then greatest(
            0,
            floor(extract(epoch from (p_observed_at - p_previous_heartbeat)))::integer
          )
          else 0
        end
  )::integer;
$$;

create or replace function public.examination_guard_active_elapsed_seconds()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_observed_at timestamptz;
begin
  if old.timer_mode <> 'selfPaced'
    or old.status not in ('in_progress', 'review')
  then
    return new;
  end if;

  v_observed_at := case
    when new.last_heartbeat_at is distinct from old.last_heartbeat_at
      then new.last_heartbeat_at
    when new.submitted_at is distinct from old.submitted_at
      then new.submitted_at
    else null
  end;

  if v_observed_at is null then
    new.elapsed_seconds := old.elapsed_seconds;
  else
    new.elapsed_seconds := public.examination_active_elapsed_seconds(
      old.elapsed_seconds,
      old.last_heartbeat_at,
      v_observed_at
    );
  end if;

  return new;
end;
$$;

drop trigger if exists examination_active_time_guard
  on public.examination_attempts_multi;
create trigger examination_active_time_guard
before update on public.examination_attempts_multi
for each row
execute function public.examination_guard_active_elapsed_seconds();

create or replace function public.examination_attempt_summary(
  p_attempt public.examination_attempts_multi
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'attemptId', p_attempt.id,
    'publicId', p_attempt.public_id,
    'versionId', p_attempt.version_id,
    'status', p_attempt.status,
    'timerMode', p_attempt.timer_mode,
    'startedAt', p_attempt.started_at,
    'deadlineAt', p_attempt.deadline_at,
    'submittedAt', p_attempt.submitted_at,
    'lastSavedAt', p_attempt.last_activity_at,
    'elapsedSeconds', p_attempt.elapsed_seconds,
    'remainingSeconds', public.examination_attempt_remaining_seconds(p_attempt),
    'tabLeaseUntil', p_attempt.tab_lease_until,
    'counts', jsonb_build_object(
      'answered', (
        select count(*) from public.examination_responses r
        where r.attempt_id = p_attempt.id and nullif(btrim(r.answer_text), '') is not null
      ),
      'flagged', (
        select count(*) from public.examination_responses r
        where r.attempt_id = p_attempt.id and r.flagged
      ),
      'total', (
        select count(*) from public.examination_responses r
        where r.attempt_id = p_attempt.id
      )
    )
  );
$$;

revoke all on function public.examination_active_elapsed_seconds(
  integer, timestamptz, timestamptz
) from public, anon, authenticated;
revoke all on function public.examination_guard_active_elapsed_seconds()
  from public, anon, authenticated;
revoke all on function public.examination_attempt_summary(
  public.examination_attempts_multi
) from public, anon, authenticated;

grant execute on function public.examination_active_elapsed_seconds(
  integer, timestamptz, timestamptz
) to service_role;
grant execute on function public.examination_guard_active_elapsed_seconds()
  to service_role;
grant execute on function public.examination_attempt_summary(
  public.examination_attempts_multi
) to service_role;

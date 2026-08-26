-- Restore the historical-owner branch removed by the commercial access
-- resolver. This keeps saved Syllabus performance and other owner-bound
-- history readable after current grading access ends, without granting access
-- to a track the user has never attempted.

begin;

create or replace function public.examination_authorize_access(
  p_user_id uuid,
  p_track text default null,
  p_version_id uuid default null,
  p_attempt_id uuid default null,
  p_allow_historical boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_track text := nullif(btrim(coalesce(p_track, '')), '');
  v_access jsonb;
begin
  if p_user_id is null or not exists (
    select 1
    from auth.users
    where id = p_user_id
      and coalesce(is_anonymous, false) = false
  ) then
    raise exception 'EXAM_ACCESS_REQUIRED';
  end if;

  if p_attempt_id is not null then
    select definition.track
    into v_track
    from public.examination_attempts_multi attempt
    join public.examination_versions version
      on version.id = attempt.version_id
    join public.examination_definitions definition
      on definition.id = version.exam_id
    where attempt.id = p_attempt_id
      and attempt.user_id = p_user_id;

    if v_track is null then
      raise exception 'EXAM_ATTEMPT_NOT_FOUND';
    end if;

    if p_allow_historical then
      return jsonb_build_object(
        'allowed', true,
        'basis', 'historical_owner',
        'track', v_track
      );
    end if;
  elsif p_version_id is not null then
    select definition.track
    into v_track
    from public.examination_versions version
    join public.examination_definitions definition
      on definition.id = version.exam_id
    where version.id = p_version_id;

    if v_track is null then
      raise exception 'EXAM_VERSION_NOT_FOUND';
    end if;
  elsif p_allow_historical
    and v_track in ('per_subject', 'bar_feels')
    and exists (
      select 1
      from public.examination_attempts_multi attempt
      join public.examination_versions version
        on version.id = attempt.version_id
      join public.examination_definitions definition
        on definition.id = version.exam_id
      where attempt.user_id = p_user_id
        and definition.track = v_track
    )
  then
    return jsonb_build_object(
      'allowed', true,
      'basis', 'historical_owner',
      'track', v_track
    );
  end if;

  if v_track is not null and v_track not in ('per_subject', 'bar_feels') then
    raise exception 'EXAM_ACCESS_REQUIRED';
  end if;

  v_access := public.phase4_access_snapshot(p_user_id, false, null);
  if not coalesce((v_access->>'allowed')::boolean, false) then
    raise exception 'EXAM_ACCESS_REQUIRED';
  end if;

  return jsonb_build_object(
    'allowed', true,
    'basis', v_access->>'basis',
    'track', v_track,
    'accessMode', v_access->>'accessMode',
    'remainingToday', (v_access->>'remainingToday')::integer,
    'unlimited', (v_access->>'unlimited')::boolean
  );
end;
$$;

revoke all on function public.examination_authorize_access(
  uuid, text, uuid, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.examination_authorize_access(
  uuid, text, uuid, uuid, boolean
) to service_role;

commit;

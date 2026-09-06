-- Owner-authorized P0: keep the four-hour timer, but do not close Bar Simulation on expiry.
-- Other examination tracks, access checks, tab leases, revisions and submission receipts are unchanged.
DO $hotfix$
DECLARE
  v_target regprocedure := 'public.examination_command(uuid,text,jsonb)'::regprocedure;
  v_before text;
  v_after text;
  v_acl text;
  v_old text := 'if v_attempt.timer_mode = ''strict'' and v_attempt.deadline_at <= v_now then';
  v_new text := $replacement$if v_attempt.timer_mode = 'strict' and v_attempt.deadline_at <= v_now
      and not exists (
        select 1
        from public.examination_versions timer_version
        join public.examination_definitions timer_definition
          on timer_definition.id = timer_version.exam_id
        where timer_version.id = v_attempt.version_id
          and timer_definition.track = 'bar_feels'
      ) then$replacement$;
BEGIN
  SELECT pg_get_functiondef(v_target), proacl::text INTO v_before, v_acl FROM pg_proc WHERE oid = v_target;
  IF position(v_new in v_before) > 0 THEN RETURN; END IF;
  IF md5(v_before) <> '9e47d087daa734082c10e68d0d29b362' THEN
    RAISE EXCEPTION 'P0_TIMER_HOTFIX_SOURCE_CHANGED';
  END IF;
  IF (length(v_before) - length(replace(v_before, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'P0_TIMER_HOTFIX_EXPECTED_ONE_CUTOFF';
  END IF;
  EXECUTE replace(v_before, v_old, v_new);
  v_after := pg_get_functiondef(v_target);
  IF replace(v_after, v_new, v_old) <> v_before THEN
    RAISE EXCEPTION 'P0_TIMER_HOTFIX_UNEXPECTED_CHANGE';
  END IF;
  IF (SELECT proacl::text FROM pg_proc WHERE oid = v_target) IS DISTINCT FROM v_acl THEN
    RAISE EXCEPTION 'P0_TIMER_HOTFIX_PERMISSIONS_CHANGED';
  END IF;
END;
$hotfix$;

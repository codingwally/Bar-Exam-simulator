-- P0 owner approval: all Simulation users may continue past the timer.
-- Recover unfinished attempts closed by the previous automatic-expiry implementation.
-- Preserve answers, original timer, receipts and partial grading evidence.
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '25s';
CREATE TABLE IF NOT EXISTS private.bar_simulation_timer_recovery (
  attempt_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  recovered_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  original_state jsonb NOT NULL CHECK (jsonb_typeof(original_state) = 'object')
);
ALTER TABLE private.bar_simulation_timer_recovery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.bar_simulation_timer_recovery FROM PUBLIC, anon, authenticated;
GRANT SELECT ON private.bar_simulation_timer_recovery TO service_role;
DO $recover$
DECLARE
  a public.examination_attempts_multi%rowtype;
  s public.examination_submissions%rowtype;
  candidate record;
  before_answers jsonb;
  after_answers jsonb;
  snapshot jsonb;
  recovered integer := 0;
BEGIN
  IF md5(pg_get_functiondef('public.examination_command(uuid,text,jsonb)'::regprocedure)) <> 'b230aadf993a47e1b28b54e61b015fa8' THEN
    RAISE EXCEPTION 'RECOVERY_REQUIRES_ADVISORY_TIMER_PATCH';
  END IF;
  FOR candidate IN
    SELECT attempt.id, attempt.user_id, definition.subject
    FROM public.examination_attempts_multi attempt
    JOIN public.examination_versions version ON version.id=attempt.version_id
    JOIN public.examination_definitions definition ON definition.id=version.exam_id
    JOIN public.examination_submissions submission ON submission.attempt_id=attempt.id
    WHERE definition.track='bar_feels'
      AND attempt.status='expired' AND submission.automatic IS TRUE
      AND attempt.submission_reason='Strict Scrutiny overall time expired.'
    ORDER BY attempt.submitted_at DESC, attempt.id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'bar-simulation-destination:' || candidate.user_id::text || ':' || candidate.subject, 0));
    SELECT * INTO a FROM public.examination_attempts_multi WHERE id=candidate.id FOR UPDATE;
    IF a.status <> 'expired' THEN CONTINUE; END IF;
    IF EXISTS (
      SELECT 1 FROM public.examination_attempts_multi other_attempt
      JOIN public.examination_versions other_version ON other_version.id=other_attempt.version_id
      JOIN public.examination_definitions other_definition ON other_definition.id=other_version.exam_id
      WHERE other_attempt.user_id=a.user_id AND other_attempt.id<>a.id
        AND other_attempt.status IN ('in_progress','review')
        AND other_definition.track='bar_feels' AND other_definition.subject=candidate.subject
    ) THEN CONTINUE; END IF;
    -- Serialize against in-flight assessment writes; obsolete job IDs must not write after recovery.
    PERFORM 1 FROM public.examination_grading_jobs WHERE attempt_id=a.id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.examination_grading_jobs WHERE attempt_id=a.id AND status='completed')
      OR EXISTS (SELECT 1 FROM public.examination_model_releases WHERE attempt_id=a.id)
      OR EXISTS (SELECT 1 FROM public.examination_examiner_assignments WHERE attempt_id=a.id)
    THEN CONTINUE; END IF;
    SELECT * INTO s FROM public.examination_submissions WHERE attempt_id=a.id FOR UPDATE;
    IF s.id IS NULL OR s.automatic IS NOT TRUE THEN CONTINUE; END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.question_id),'[]'::jsonb)
      INTO before_answers FROM public.examination_responses r WHERE r.attempt_id=a.id;
    snapshot := jsonb_build_object(
      'attempt',to_jsonb(a),'submission',to_jsonb(s),'responses',before_answers,
      'gradingJobs',(SELECT coalesce(jsonb_agg(to_jsonb(j)),'[]'::jsonb) FROM public.examination_grading_jobs j WHERE j.attempt_id=a.id),
      'assessments',(SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]'::jsonb) FROM public.examination_ai_assessments g WHERE g.attempt_id=a.id),
      'commandReceipts',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM public.examination_command_receipts c
        WHERE c.user_id=a.user_id AND c.operation IN ('submit_attempt','request_ai_grading') AND c.response_json->>'attemptId'=a.id::text)
    );
    INSERT INTO private.bar_simulation_timer_recovery(attempt_id,user_id,reason,original_state)
      VALUES(a.id,a.user_id,'Owner-authorized continuation after automatic four-hour expiry; original answers and partial assessments preserved.',snapshot);
    -- Only invalidated automatic submissions and unfinished grades are removed from active slots.
    -- Complete originals remain in the restricted recovery archive above.
    DELETE FROM public.examination_ai_assessments WHERE attempt_id=a.id;
    DELETE FROM public.examination_grading_jobs WHERE attempt_id=a.id;
    DELETE FROM public.examination_command_receipts
      WHERE user_id=a.user_id AND operation IN ('submit_attempt','request_ai_grading') AND response_json->>'attemptId'=a.id::text;
    DELETE FROM public.examination_submissions WHERE id=s.id AND automatic IS TRUE;
    UPDATE public.examination_attempts_multi
      SET status='in_progress',submitted_at=NULL,submission_reason=NULL,updated_at=now()
      WHERE id=a.id;
    SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.question_id),'[]'::jsonb)
      INTO after_answers FROM public.examination_responses r WHERE r.attempt_id=a.id;
    IF before_answers IS DISTINCT FROM after_answers THEN RAISE EXCEPTION 'RECOVERY_MODIFIED_ANSWERS'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.examination_attempts_multi
      WHERE id=a.id AND status='in_progress' AND timer_mode=a.timer_mode
        AND deadline_at IS NOT DISTINCT FROM a.deadline_at AND started_at=a.started_at
        AND active_tab_hash=a.active_tab_hash AND tab_lease_until IS NOT DISTINCT FROM a.tab_lease_until)
    THEN RAISE EXCEPTION 'RECOVERY_MODIFIED_TIMER_OR_SESSION'; END IF;
    INSERT INTO public.examination_audit_log(actor_user_id,action,resource_type,resource_id,reason,metadata)
      VALUES(NULL,'timer_expiry_continuation_restored','examination_attempt',a.id::text,
        'Owner-authorized P0: continue, review and submit after timer expiry. Original responses and premature grading evidence archived without changes.',
        jsonb_build_object('answersPreserved',true,'originalTimerPreserved',true,'prematureReceiptArchived',true,
          'partialAssessmentsArchived',jsonb_array_length(snapshot->'assessments')));
    recovered := recovered+1;
  END LOOP;
  RAISE NOTICE 'Unfinished automatic-expiry attempts recovered: %',recovered;
END;
$recover$;

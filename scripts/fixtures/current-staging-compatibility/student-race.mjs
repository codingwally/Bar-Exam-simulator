// Consumed by the parent's isolated psql runner. No hosted connections or credentials.
export async function runConcurrency({ run, check }) {
  const q = s => `'${s.replaceAll("'", "''")}'`;
  const truth = s => String(s).trim().split(/\s+/).includes('t');
  await run(`
    DO $guard$ BEGIN
      IF current_database()<>'duediligence_compatibility_fixture' OR current_user<>'postgres'
      OR current_setting('duediligence.compatibility_fixture',true) IS DISTINCT FROM 'isolated-current-capture-20261018'
      THEN RAISE EXCEPTION 'Student concurrency isolation guard refused'; END IF;
    END $guard$;
    CREATE TABLE compat_student_test.race_release(id integer PRIMARY KEY);
    CREATE TABLE compat_student_test.race_result(name text PRIMARY KEY,result jsonb NOT NULL);
    CREATE FUNCTION compat_student_test.wait_release(n integer) RETURNS void LANGUAGE plpgsql SET search_path TO pg_catalog AS $gate$
    DECLARE deadline timestamptz:=clock_timestamp()+interval '20 seconds'; BEGIN
      LOOP
        IF EXISTS(SELECT 1 FROM compat_student_test.race_release WHERE id=n) THEN RETURN; END IF;
        IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'Synthetic concurrency gate timed out'; END IF;
        PERFORM pg_sleep(0.025);
      END LOOP;
    END $gate$;
    REVOKE ALL ON FUNCTION compat_student_test.wait_release(integer) FROM PUBLIC;
    REVOKE ALL ON ALL TABLES IN SCHEMA compat_student_test FROM PUBLIC;
  `,{applicationName:'student-race-setup'});
  async function until(sql,label) {
    const deadline=Date.now()+12000;
    while(Date.now()<deadline) {
      if(truth(await run(sql,{applicationName:'student-race-observer'}))) return;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    throw new Error(`RACE_HANDSHAKE_TIMEOUT: ${label}`);
  }
  async function race(n,firstSQL,secondSQL,secondMustWaitAdvisory=false) {
    const a=`student-race-${n}-holder`, b=`student-race-${n}-waiter`, ready=710100+n;
    const first=run(`BEGIN;
      INSERT INTO compat_student_test.race_result VALUES(${q(a)},(${firstSQL}));
      SELECT pg_advisory_xact_lock(${ready}::bigint);
      SELECT compat_student_test.wait_release(${n}); COMMIT;`,{applicationName:a});
    first.catch(()=>{});
    let second;
    try {
      await until(`SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
        WHERE a.application_name=${q(a)} AND l.locktype='advisory' AND l.objid=${ready} AND l.granted);`,'holder completed real operation');
      second=run(`INSERT INTO compat_student_test.race_result VALUES(${q(b)},(${secondSQL}));`,{applicationName:b});
      second.catch(()=>{});
      await until(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity b JOIN pg_stat_activity a ON a.pid=ANY(pg_blocking_pids(b.pid))
        WHERE a.application_name=${q(a)} AND b.application_name=${q(b)} AND b.wait_event_type='Lock'
        ${secondMustWaitAdvisory?"AND lower(b.wait_event)='advisory'":''});`,'second request blocked behind actual first writer');
      await run(`INSERT INTO compat_student_test.race_release VALUES(${n});`,{applicationName:'student-race-release'});
      await Promise.all([first,second]);
      check(true,`student race ${n}: overlapping connections and real blocking observed`);
    } finally {
      await run(`INSERT INTO compat_student_test.race_release VALUES(${n}) ON CONFLICT DO NOTHING;`,{applicationName:'student-race-release'});
      await Promise.allSettled([first,...(second?[second]:[])]);
    }
  }
  // Different activations ensure that this race is stopped by the institution/email
  // advisory key, rather than accidentally passing due to the activation hot-row lock.
  await race(1,
    "examination_room_v1.prepare_student_admission(compat_student_test.admission(13,' RACE.Email@Example.invalid ','FIRST-NUMBER','race-admit-first'))",
    "examination_room_v1.prepare_student_admission(compat_student_test.admission(14,'race.email@example.invalid','SECOND-NUMBER','race-admit-second'))",true);
  await run(`DO $test$ BEGIN
    PERFORM compat_student_test.assert_true((SELECT bool_and(result->>'ok'='true') FROM compat_student_test.race_result WHERE name LIKE 'student-race-1-%'),'both email admissions succeed');
    PERFORM compat_student_test.assert_true((SELECT count(*)=1 FROM examination_room_v1.student_identities WHERE institution_id=compat_student_test.uid(1) AND email_normalized='race.email@example.invalid'),'concurrent normalized email creates one identity across rooms');
    PERFORM compat_student_test.assert_true((SELECT count(*)=2 FROM examination_room_v1.exam_roster er JOIN examination_room_v1.student_identities si ON si.id=er.student_identity_id WHERE si.email_normalized='race.email@example.invalid'),'one roster in each distinct exam');
  END $test$;`,{applicationName:'student-race-assert'});
  check(true,'student concurrent institutional email recheck has one identity and two distinct exam rosters');
  await race(2,
    "public.examination_room_v1_api('student','consent',null,null,compat_student_test.admission(13,'race.email@example.invalid','FIRST-NUMBER','race-consent-first'))",
    "public.examination_room_v1_api('student','consent',null,null,compat_student_test.admission(13,'RACE.EMAIL@example.invalid','CHANGED-NUMBER','race-consent-second'))",true);
  await run(`DO $test$ DECLARE first_result jsonb; second_result jsonb; sid uuid; BEGIN
    SELECT result INTO first_result FROM compat_student_test.race_result WHERE name='student-race-2-holder';
    SELECT result INTO second_result FROM compat_student_test.race_result WHERE name='student-race-2-waiter';
    PERFORM compat_student_test.assert_true(first_result->>'ok'='true' AND second_result->>'ok'='true' AND second_result->>'resumed'='true','concurrent consent resumes after commit');
    sid:=(first_result#>>'{session,id}')::uuid;
    PERFORM compat_student_test.assert_true(second_result#>>'{session,id}'=sid::text,'concurrent consent same session');
    PERFORM compat_student_test.assert_true((SELECT count(*)=1 FROM examination_room_v1.student_sessions WHERE activation_id=compat_student_test.uid(4013)),'one concurrent session');
    PERFORM compat_student_test.assert_true((SELECT count(*)=1 FROM examination_room_v1.privacy_acceptances WHERE session_id=sid),'one immutable consent receipt');
    PERFORM compat_student_test.assert_true((SELECT session_token_hash=compat_student_test.hash('race-consent-second-token') FROM examination_room_v1.student_sessions WHERE id=sid),'later resume credential wins');
  END $test$;`,{applicationName:'student-race-assert'});
  check(true,'student simultaneous consent resumes single session without duplicate consent');
  await race(3,
    "examination_room_v1.creator_revoke_session(compat_student_test.uid(11),compat_student_test.uid(1),jsonb_build_object('examId',compat_student_test.uid(1010),'sessionId',compat_student_test.uid(30010),'requestHash',compat_student_test.hash('race-revoke-session'),'reason','Synthetic race'))",
    "examination_room_v1.api_student('submission_intent',compat_student_test.payload(10,'submit'))");
  await run(`DO $test$ BEGIN
    PERFORM compat_student_test.code((SELECT result FROM compat_student_test.race_result WHERE name='student-race-3-waiter'),'SESSION_REVOKED','concurrent session revocation wins before new intent');
    PERFORM compat_student_test.assert_true((SELECT session_status='revoked' AND NOT(session_metadata?'pendingSubmission') FROM examination_room_v1.student_sessions WHERE id=compat_student_test.uid(30010)),'no pending intent created after revocation');
  END $test$;`,{applicationName:'student-race-assert'});
  check(true,'student session revocation race denies pending intent');
  await race(4,
    "examination_room_v1.api_admin('revoke_key',compat_student_test.uid(11),compat_student_test.uid(1),jsonb_build_object('examId',compat_student_test.uid(1009),'requestHash',compat_student_test.hash('race-revoke-key'),'reason','Synthetic race'))",
    "examination_room_v1.api_student('submission_intent',compat_student_test.payload(9,'submit'))");
  await run(`DO $test$ BEGIN
    PERFORM compat_student_test.code((SELECT result FROM compat_student_test.race_result WHERE name='student-race-4-waiter'),'SESSION_REVOKED','concurrent activation revocation wins before new intent');
    PERFORM compat_student_test.assert_true((SELECT NOT(session_metadata?'pendingSubmission') FROM examination_room_v1.student_sessions WHERE id=compat_student_test.uid(30009)),'no pending intent after key revocation');
  END $test$;`,{applicationName:'student-race-assert'});
  check(true,'student activation revocation race observes current activation after blocking');
  await run(`BEGIN ISOLATION LEVEL REPEATABLE READ;
    DO $test$ BEGIN
      BEGIN
        PERFORM examination_room_v1.prepare_student_admission(compat_student_test.admission(14,'isolation@example.invalid','ISOLATION','repeatable-read'));
        RAISE EXCEPTION 'Repeatable-read admission unexpectedly accepted';
      EXCEPTION WHEN serialization_failure THEN NULL; END;
    END $test$; ROLLBACK;`,{applicationName:'student-race-isolation'});
  check(true,'student admission rejects stale-snapshot isolation rather than allowing duplicate identity');
}

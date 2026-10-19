BEGIN;
DO $test$ DECLARE before_state jsonb; r jsonb; BEGIN
 PERFORM compat_student_test.assert_true(current_database()='duediligence_compatibility_fixture' AND current_setting('duediligence.compatibility_fixture',true)='isolated-current-capture-20261018','fixture guard');
 PERFORM compat_student_test.assert_true(position('pendingSubmission' in pg_get_functiondef('examination_room_v1.api_student(text,jsonb)'::regprocedure))=0,'captured staging has no pending intent implementation');
 before_state:=compat_student_test.write_state();
 r:=examination_room_v1.api_student('submission_intent',compat_student_test.payload(1,'submit'));
 PERFORM compat_student_test.code(r,'UNKNOWN_OPERATION','current staging does not accept missing operation');
 PERFORM compat_student_test.assert_true(before_state=compat_student_test.write_state(),'missing operation changes no evidence');
 r:=examination_room_v1.api_student('session_context',compat_student_test.payload(1,'context'));
 PERFORM compat_student_test.assert_true(r->>'ok'='true' AND r#>>'{studentIdentity,studentNumber}'='STUDENT-1','current context fixture is valid');
END $test$;
ROLLBACK;
SELECT 'PASS student captured baseline: missing intent is not attributed to already-installed staging behavior';

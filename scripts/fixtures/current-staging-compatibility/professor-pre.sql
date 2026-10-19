-- Must execute on the exact captured function image before the bounded forward.
BEGIN;
DO $pre$
DECLARE response jsonb; before_state jsonb; monitor jsonb; operation text;
BEGIN
  PERFORM compat_professor_test.assert_true(current_database()='duediligence_compatibility_fixture'
    AND current_user='postgres' AND current_setting('duediligence.compatibility_fixture',true)='isolated-current-capture-20261018','pre isolation');
  before_state := compat_professor_test.write_state();
  response := examination_room_v1.api_professor('save_grade',compat_professor_test.uid(11),compat_professor_test.uid(1),
    compat_professor_test.grade_payload(2,compat_professor_test.score_items(false)));
  PERFORM compat_professor_test.code(response,'GRADING_MANIFEST_INVALID','P01 captured partial draft reproduction');
  PERFORM compat_professor_test.assert_true(compat_professor_test.write_state()=before_state,'P01 rejected draft has no writes');
  monitor := examination_room_v1.api_professor_view('monitor',compat_professor_test.uid(11),compat_professor_test.uid(1),compat_professor_test.uid(21));
  PERFORM compat_professor_test.assert_true(monitor->>'ok'='true'
    AND jsonb_array_length(monitor->'sessions')=3 AND jsonb_array_length(monitor->'submissions')=3
    AND jsonb_array_length(monitor->'incidents')=3,'M01 captured monitor includes prior activation');
  PERFORM compat_professor_test.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(monitor->'sessions') s WHERE s ? 'email'),
    'M04 captured monitor has no email');
  FOREACH operation IN ARRAY ARRAY['monitor','grading'] LOOP
    response := examination_room_v1.api_professor_view(operation,compat_professor_test.uid(12),compat_professor_test.uid(1),compat_professor_test.uid(21));
    PERFORM compat_professor_test.code(response,'FORBIDDEN','P05 pre unrelated view ' || operation);
    response := examination_room_v1.api_professor_view(operation,compat_professor_test.uid(11),compat_professor_test.uid(2),compat_professor_test.uid(21));
    PERFORM compat_professor_test.code(response,'EXAM_NOT_FOUND','P05 pre wrong workspace ' || operation);
  END LOOP;
  response := examination_room_v1.api_professor('release_results',compat_professor_test.uid(11),compat_professor_test.uid(1),
    compat_professor_test.release_payload(compat_professor_test.grade_payload(2,compat_professor_test.score_items(false),'final')));
  PERFORM compat_professor_test.code(response,'GRADING_INCOMPLETE','P06 captured final release remains complete-only');
  PERFORM compat_professor_test.assert_true(compat_professor_test.write_state()=before_state,'pre failures preserve seeded evidence');
  RAISE NOTICE 'PASS P01 pre: partial draft rejected without writes';
  RAISE NOTICE 'PASS M01/M04 pre: all three activation rows visible, no monitor email';
  RAISE NOTICE 'PASS P05/P06 pre: authorization and strict final release';
END $pre$;
ROLLBACK;
SELECT 'PASS professor pre-image cases rolled back';

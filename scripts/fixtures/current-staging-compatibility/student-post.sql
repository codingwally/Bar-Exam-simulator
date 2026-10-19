-- All behavior mutations roll back; concurrency has separately committed synthetic rooms.
BEGIN;
DO $test$
DECLARE n integer; r jsonb; p jsonb; a jsonb; before_state jsonb; op text;
  final5 jsonb; final6 jsonb; accepted5 jsonb; legacy jsonb; subid uuid; consent_payload jsonb;
  sid uuid; started timestamptz; oldtoken text; newtoken text;
BEGIN
 PERFORM compat_student_test.assert_true(current_database()='duediligence_compatibility_fixture' AND current_setting('duediligence.compatibility_fixture',true)='isolated-current-capture-20261018','fixture guard');
 FOR n IN 1..10 LOOP
   r:=examination_room_v1.api_student('submission_intent',compat_student_test.payload(n,'submit'));
   PERFORM compat_student_test.assert_true(r->>'ok'='true','valid intent '||n||': '||r::text);
 END LOOP;
 -- Session revocation must dominate old intent/save replay as well as new writes.
 a:=compat_student_test.answer(1);
 r:=examination_room_v1.api_student('save_answer',a);
 PERFORM compat_student_test.assert_true(r->>'ok'='true','save before revocation');
 p:=compat_student_test.final_payload(1);
 r:=examination_room_v1.creator_revoke_session(compat_student_test.uid(11),compat_student_test.uid(1),
   jsonb_build_object('examId',compat_student_test.uid(1001),'sessionId',compat_student_test.uid(30001),'requestHash',compat_student_test.hash('revoke-1'),'reason','Synthetic removal'));
 PERFORM compat_student_test.assert_true(r->>'ok'='true','creator revocation');
 before_state:=compat_student_test.write_state();
 FOREACH op IN ARRAY ARRAY['submission_intent','save_answer','submit','heartbeat','record_event','resume','session_context'] LOOP
   r:=examination_room_v1.api_student(op,CASE op WHEN 'save_answer' THEN a WHEN 'submit' THEN p ELSE compat_student_test.payload(1,'submit') END);
   PERFORM compat_student_test.code(r,'SESSION_REVOKED','revoked session '||op);
 END LOOP;
 PERFORM compat_student_test.assert_true(before_state=compat_student_test.write_state(),'revoked session attempts write nothing');
 -- Activation revocation is separately authoritative even when session status remains active.
 a:=compat_student_test.answer(2); r:=examination_room_v1.api_student('save_answer',a);
 PERFORM compat_student_test.assert_true(r->>'ok'='true','save before key revocation');
 p:=compat_student_test.final_payload(2);
 r:=examination_room_v1.api_admin('revoke_key',compat_student_test.uid(11),compat_student_test.uid(1),
  jsonb_build_object('examId',compat_student_test.uid(1002),'requestHash',compat_student_test.hash('revoke-key-2'),'reason','Synthetic removal'));
 PERFORM compat_student_test.assert_true(r->>'ok'='true','actual administrator key revocation');
 before_state:=compat_student_test.write_state();
 FOREACH op IN ARRAY ARRAY['submission_intent','save_answer','submit','heartbeat','session_context'] LOOP
   r:=examination_room_v1.api_student(op,CASE op WHEN 'save_answer' THEN a WHEN 'submit' THEN p ELSE compat_student_test.payload(2,'submit') END);
   PERFORM compat_student_test.code(r,'SESSION_REVOKED','revoked activation '||op);
 END LOOP;
 PERFORM compat_student_test.assert_true(before_state=compat_student_test.write_state(),'revoked activation attempts write nothing');
 -- Timed-out sessions retain only the already-accepted exact pending submission.
 UPDATE examination_room_v1.student_sessions SET lease_expires_at=clock_timestamp()-interval '1 minute' WHERE id=compat_student_test.uid(30003);
 r:=examination_room_v1.api_student('submission_intent',compat_student_test.payload(3,'submit'));
 PERFORM compat_student_test.assert_true(r->>'ok'='true','exact intent replay survives expiry');
 r:=examination_room_v1.api_student('save_answer',compat_student_test.answer(3));
 PERFORM compat_student_test.assert_true(r->>'ok'='true','pending answer survives expiry');
 p:=compat_student_test.final_payload(3);
 r:=examination_room_v1.api_student('submit',p);
 PERFORM compat_student_test.assert_true(r->>'ok'='true' AND r#>>'{submission,status}'='accepted','pending final submit survives expiry');
 before_state:=compat_student_test.write_state();
 r:=examination_room_v1.api_student('submit',p);
 PERFORM compat_student_test.assert_true(r->>'ok'='true' AND r->>'duplicate'='true','exact successful submit replay');
 PERFORM compat_student_test.assert_true(before_state=compat_student_test.write_state(),'exact final replay writes nothing');
 a:=compat_student_test.answer(3);
 a:=a||jsonb_build_object('requestHash',compat_student_test.hash('new-revision-after-submit'),'answerRevision',
   (a->'answerRevision')||jsonb_build_object('revision',2,'answer','Late changed content'));
 r:=examination_room_v1.api_student('save_answer',a);
 PERFORM compat_student_test.code(r,'SESSION_NOT_ACTIVE','accepted attempt cannot append a new revision through pending intent');
 PERFORM compat_student_test.assert_true(before_state=compat_student_test.write_state(),'post-submit new revision writes nothing');
 -- An ordinary close expires active sessions, but is not key revocation.
 r:=examination_room_v1.api_professor('close_room',compat_student_test.uid(11),compat_student_test.uid(1),
  jsonb_build_object('examId',compat_student_test.uid(1004),'requestHash',compat_student_test.hash('close-4'),'closedAt',clock_timestamp()));
 PERFORM compat_student_test.assert_true(r->>'ok'='true','actual professor close');
 PERFORM compat_student_test.assert_true((SELECT session_status='expired' FROM examination_room_v1.student_sessions WHERE id=compat_student_test.uid(30004)),'close expires session');
 r:=examination_room_v1.api_student('submission_intent',compat_student_test.payload(4,'submit'));
 PERFORM compat_student_test.assert_true(r->>'ok'='true','accepted intent survives ordinary close');
 r:=examination_room_v1.api_student('save_answer',compat_student_test.answer(4));
 PERFORM compat_student_test.assert_true(r->>'ok'='true','pending upload after close');
 r:=examination_room_v1.api_student('submit',compat_student_test.final_payload(4));
 PERFORM compat_student_test.assert_true(r->>'ok'='true','pending final submit after close');
 -- An accepted v2 final receipt remains readable after key revocation, with no new writes.
 r:=examination_room_v1.api_student('save_answer',compat_student_test.answer(5));
 PERFORM compat_student_test.assert_true(r->>'ok'='true','historical v2 answer');
 final5:=compat_student_test.final_payload(5);
 accepted5:=examination_room_v1.api_student('submit',final5);
 PERFORM compat_student_test.assert_true(accepted5->>'ok'='true','historical v2 accepted submit');
 UPDATE examination_room_v1.room_activations SET activation_status='revoked' WHERE id=compat_student_test.uid(4005);
 before_state:=compat_student_test.write_state();
 r:=examination_room_v1.api_student('submit',final5);
 PERFORM compat_student_test.assert_true((r-'duplicate')=(accepted5-'duplicate') AND r->>'duplicate'='true','exact accepted v2 receipt after revocation');
 PERFORM compat_student_test.assert_true(before_state=compat_student_test.write_state(),'accepted v2 receipt remains read-only');
 r:=examination_room_v1.api_student('submit',final5||jsonb_build_object('requestHash',compat_student_test.hash('different-final5')));
 PERFORM compat_student_test.code(r,'SESSION_REVOKED','changed final hash after revocation');
 -- A real accepted legacy audit receipt (without submittedAt) is also preserved.
 r:=examination_room_v1.api_student('save_answer',compat_student_test.answer(6));
 PERFORM compat_student_test.assert_true(r->>'ok'='true','legacy answer');
 final6:=compat_student_test.final_payload(6); p:=final6->'submissionManifest'; subid:=(p->>'submissionId')::uuid;
 INSERT INTO examination_room_v1.submissions(id,session_id,exam_version_id,idempotency_key_hash,manifest_sha256,submission_manifest,answer_count,submitted_at_client)
 VALUES(subid,compat_student_test.uid(30006),compat_student_test.uid(2006),final6->>'requestHash',final6->>'manifestHash',p,1,(p->>'submittedAt')::timestamptz);
 INSERT INTO examination_room_v1.submission_answers(submission_id,session_id,question_id,answer_revision_id)
 SELECT subid,ar.session_id,ar.question_id,ar.id FROM examination_room_v1.answer_revisions ar WHERE ar.session_id=compat_student_test.uid(30006);
 INSERT INTO examination_room_v1.submission_receipts(submission_id,receipt_sha256,receipt_payload)
 VALUES(subid,final6->>'manifestHash',jsonb_build_object('submissionId',subid,'answerCount',1));
 legacy:=jsonb_build_object('ok',true,'submission',jsonb_build_object('id',subid,'status','accepted'),'duplicate',false);
 PERFORM examination_room_v1.api_record_audit(compat_student_test.uid(1),compat_student_test.uid(1006),compat_student_test.uid(30006),null,'student','student.submit','submission',subid,
 final6->>'requestHash',(p->>'submittedAt')::timestamptz,legacy,gen_random_uuid());
 UPDATE examination_room_v1.student_sessions SET session_status='submitted',ended_at=clock_timestamp() WHERE id=compat_student_test.uid(30006);
 UPDATE examination_room_v1.room_activations SET activation_status='revoked' WHERE id=compat_student_test.uid(4006);
 before_state:=compat_student_test.write_state();
 r:=examination_room_v1.api_student('submit',final6);
 PERFORM compat_student_test.assert_true(r->>'ok'='true' AND r->>'duplicate'='true' AND r#>>'{submission,id}'=subid::text
 AND (r#>>'{submission,submittedAt}')::timestamptz=(p->>'submittedAt')::timestamptz,'legacy receipt time derived from accepted submission');
 PERFORM compat_student_test.assert_true(before_state=compat_student_test.write_state(),'legacy receipt replay writes nothing');
 -- A valid credential cannot retrieve another session's accepted receipt through revocation.
 UPDATE examination_room_v1.student_sessions SET session_status='revoked' WHERE id=compat_student_test.uid(30007);
 r:=examination_room_v1.api_student('submit',compat_student_test.payload(7,'submit')||jsonb_build_object('requestHash',final5->>'requestHash'));
 PERFORM compat_student_test.code(r,'SESSION_REVOKED','foreign accepted receipt not returned');
 -- Consent withdrawal continues to dominate any formerly accepted pending intent.
 INSERT INTO examination_room_v1.privacy_acceptances(notice_version_id,roster_id,session_id,exam_version_id,client_event_id,decision,prior_acceptance_id,accepted_features,evidence_sha256,capture_method,recorded_at)
 SELECT notice_version_id,roster_id,session_id,exam_version_id,gen_random_uuid(),'withdrawn',id,accepted_features,compat_student_test.hash('withdraw-8'),'checkbox',clock_timestamp()
 FROM examination_room_v1.privacy_acceptances WHERE id=compat_student_test.uid(40008);
 before_state:=compat_student_test.write_state();
 FOREACH op IN ARRAY ARRAY['submission_intent','save_answer','submit'] LOOP
  r:=examination_room_v1.api_student(op,compat_student_test.payload(8,'submit'));
  PERFORM compat_student_test.code(r,'PRIVACY_CONSENT_REQUIRED','withdrawn consent '||op);
 END LOOP;
 PERFORM compat_student_test.assert_true(before_state=compat_student_test.write_state(),'withdrawn consent attempts write nothing');
 UPDATE examination_room_v1.student_sessions SET lease_expires_at=clock_timestamp()-interval '1 minute' WHERE id=compat_student_test.uid(30009);
 before_state:=compat_student_test.write_state();
 r:=examination_room_v1.api_student('submission_intent',compat_student_test.payload(9,'new-submit'));
 PERFORM compat_student_test.code(r,'SESSION_NOT_ACTIVE','new intent after expiry');
 r:=examination_room_v1.api_student('save_answer',compat_student_test.answer(9)||jsonb_build_object('submissionRequestHash',compat_student_test.hash('other-submit')));
 PERFORM compat_student_test.code(r,'SESSION_NOT_ACTIVE','wrong pending upload hash after expiry');
 r:=examination_room_v1.api_student('submit',compat_student_test.payload(9,'new-submit'));
 PERFORM compat_student_test.code(r,'SESSION_NOT_ACTIVE','wrong pending final hash after expiry');
 PERFORM compat_student_test.assert_true(before_state=compat_student_test.write_state(),'changed expiry requests write nothing');
 r:=examination_room_v1.api_student('submission_intent',compat_student_test.payload(10,'submit')||jsonb_build_object('sessionTokenHash',compat_student_test.hash('foreign-token')));
 PERFORM compat_student_test.code(r,'SESSION_INVALID','wrong bearer denied before replay');
 -- Fresh consent and same-email resume use one identity, roster and session despite changed entered number.
 consent_payload:=compat_student_test.admission(11,'  Same.Email@Example.invalid  ','ENTRY-A','fresh-consent-11');
 r:=public.examination_room_v1_api('student','consent',null,null,consent_payload);
 PERFORM compat_student_test.assert_true(r->>'ok'='true','fresh consent '||r::text);
 sid:=(r#>>'{session,id}')::uuid;
 SELECT started_at,session_token_hash INTO started,oldtoken FROM examination_room_v1.student_sessions WHERE id=sid;
 consent_payload:=compat_student_test.admission(11,'same.email@example.invalid','ENTRY-B','resume-consent-11');
 newtoken:=consent_payload->>'sessionTokenHash';
 r:=public.examination_room_v1_api('student','consent',null,null,consent_payload);
 PERFORM compat_student_test.assert_true(r->>'ok'='true' AND r->>'resumed'='true' AND (r#>>'{session,id}')::uuid=sid,'same-email resume');
 PERFORM compat_student_test.assert_true((SELECT count(*)=1 FROM examination_room_v1.student_identities WHERE institution_id=compat_student_test.uid(1) AND email_normalized='same.email@example.invalid'),'one normalized identity');
 PERFORM compat_student_test.assert_true((SELECT count(*)=1 FROM examination_room_v1.student_sessions WHERE activation_id=compat_student_test.uid(4011)),'one room session');
 PERFORM compat_student_test.assert_true((SELECT started_at=started AND session_token_hash=newtoken AND session_token_hash<>oldtoken FROM examination_room_v1.student_sessions WHERE id=sid),'resume rotates only token, preserves start');
 -- Real late-review lease insert trigger applies without rewriting an old session.
 consent_payload:=compat_student_test.admission(12,'late@example.invalid','LATE-12','late-consent-12');
 r:=public.examination_room_v1_api('student','consent',null,null,consent_payload);
 PERFORM compat_student_test.assert_true(r->>'ok'='true','late-review consent '||r::text);
 PERFORM compat_student_test.assert_true((SELECT s.lease_expires_at=a.closes_at FROM examination_room_v1.student_sessions s JOIN examination_room_v1.room_activations a ON a.id=s.activation_id WHERE s.id=(r#>>'{session,id}')::uuid),'late-review lease uses activation close');
END $test$;
ROLLBACK;
SELECT 'PASS student revocation, exact expiry recovery, accepted receipts, privacy, admission and resume cases';

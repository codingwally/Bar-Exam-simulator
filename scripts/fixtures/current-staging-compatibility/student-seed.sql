-- Synthetic fixture only. Real captured constraints and triggers remain enabled.
BEGIN;
DO $guard$ BEGIN
  IF current_database() <> 'duediligence_compatibility_fixture' OR current_user <> 'postgres'
     OR current_setting('duediligence.compatibility_fixture',true) IS DISTINCT FROM 'isolated-current-capture-20261018'
  THEN RAISE EXCEPTION 'Student fixture isolation guard refused'; END IF;
END $guard$;
CREATE SCHEMA compat_student_test AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA compat_student_test FROM PUBLIC;
CREATE FUNCTION compat_student_test.uid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog AS $$
 SELECT ('71000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
$$;
CREATE FUNCTION compat_student_test.hash(t text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO pg_catalog AS $$
 SELECT encode(sha256(convert_to('student-fixture:' || t,'UTF8')),'hex');
$$;
CREATE FUNCTION compat_student_test.assert_true(ok boolean,label text) RETURNS void LANGUAGE plpgsql SET search_path TO pg_catalog AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Student assertion failed: %',label; END IF; END $$;
CREATE FUNCTION compat_student_test.code(r jsonb,code text,label text) RETURNS void LANGUAGE plpgsql SET search_path TO pg_catalog AS $$
BEGIN PERFORM compat_student_test.assert_true(r->>'ok'='false' AND r->>'errorCode'=code,label || ': ' || r::text); END $$;
CREATE FUNCTION compat_student_test.write_state() RETURNS jsonb LANGUAGE sql STABLE SET search_path TO pg_catalog AS $$
 SELECT jsonb_build_object(
 'identities',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM examination_room_v1.student_identities t),
 'rosters',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM examination_room_v1.exam_roster t),
 'sessions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM examination_room_v1.student_sessions t),
 'answers',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM examination_room_v1.answer_revisions t),
 'submissions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM examination_room_v1.submissions t),
 'submissionAnswers',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') FROM examination_room_v1.submission_answers t),
 'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM examination_room_v1.submission_receipts t),
 'privacy',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM examination_room_v1.privacy_acceptances t),
 'incidents',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM examination_room_v1.proctoring_incidents t),
 'audits',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM examination_room_v1.audit_events t),
 'snapshots',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM examination_room_v1.recovery_snapshots t));
$$;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(compat_student_test.uid(11),'student-fixture-professor@example.invalid','{"full_name":"Synthetic Professor"}');
INSERT INTO public.profiles(id,display_name,law_school_id) VALUES(compat_student_test.uid(11),'Synthetic Professor','student-fixture');
INSERT INTO public.user_roles(user_id,role) VALUES(compat_student_test.uid(11),'founder_admin');
INSERT INTO examination_room_v1.institutions(id,institution_code,profile_school_id,institution_name,bootstrap_request_hash,created_by_user_id)
VALUES(compat_student_test.uid(1),'student-fixture','student-fixture','Synthetic Student Institution',compat_student_test.hash('institution'),compat_student_test.uid(11));
INSERT INTO examination_room_v1.staff_memberships(institution_id,user_id,staff_role,display_name,email_normalized,granted_by_user_id)
VALUES(compat_student_test.uid(1),compat_student_test.uid(11),'professor','Synthetic Professor','student-fixture-professor@example.invalid',compat_student_test.uid(11));
INSERT INTO examination_room_v1.privacy_notice_versions(id,institution_id,notice_code,version_number,title,notice_body,body_sha256,effective_at,created_by_user_id)
VALUES(compat_student_test.uid(31),compat_student_test.uid(1),'student-synthetic-notice',1,'Synthetic notice','No real data or outgoing mail.',compat_student_test.hash('notice'),now(),compat_student_test.uid(11));
CREATE FUNCTION compat_student_test.make_room(n integer, late boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SET search_path TO pg_catalog AS $$
DECLARE manifest jsonb; published timestamptz := clock_timestamp(); BEGIN
 INSERT INTO examination_room_v1.exams(id,institution_id,owner_user_id,title)
 VALUES(compat_student_test.uid(1000+n),compat_student_test.uid(1),compat_student_test.uid(11),'Synthetic student room ' || n);
 INSERT INTO examination_room_v1.exam_versions(id,exam_id,institution_id,version_number,title_snapshot,duration_seconds,privacy_notice_version_id,content_sha256,controls)
 VALUES(compat_student_test.uid(2000+n),compat_student_test.uid(1000+n),compat_student_test.uid(1),1,'Synthetic student version',3600,compat_student_test.uid(31),compat_student_test.hash('unsealed-'||n),
 jsonb_build_object('subject','Civil Law','yearLevel','First year','lateSubmissions',CASE WHEN late THEN 'professor_review' ELSE 'not_allowed' END));
 INSERT INTO examination_room_v1.questions(id,exam_version_id,position,question_key,question_kind,prompt,points,content_sha256)
 VALUES(compat_student_test.uid(3000+n),compat_student_test.uid(2000+n),1,'q001','essay','Synthetic student question',10,compat_student_test.hash('question-'||n));
 manifest := examination_room_v1.build_publication_manifest(compat_student_test.uid(2000+n),published);
 UPDATE examination_room_v1.exam_versions SET publication_status='published',published_by_user_id=compat_student_test.uid(11),published_at=published,
 publication_manifest=manifest,content_sha256=examination_room_v1.jsonb_sha256(manifest) WHERE id=compat_student_test.uid(2000+n);
 UPDATE examination_room_v1.exams SET status='published',current_published_version_id=compat_student_test.uid(2000+n) WHERE id=compat_student_test.uid(1000+n);
 INSERT INTO examination_room_v1.room_activations(id,exam_id,institution_id,exam_version_id,key_hash,key_hash_algorithm,request_hash,activation_status,opens_at,closes_at,activated_by_user_id)
 VALUES(compat_student_test.uid(4000+n),compat_student_test.uid(1000+n),compat_student_test.uid(1),compat_student_test.uid(2000+n),compat_student_test.hash('key-'||n),'hmac-sha256-v1',compat_student_test.hash('activation-'||n),'open',now()-interval '1 hour',now()+interval '2 hours',compat_student_test.uid(11));
END $$;
CREATE FUNCTION compat_student_test.make_session(n integer,room_n integer) RETURNS uuid LANGUAGE plpgsql SET search_path TO pg_catalog AS $$
DECLARE a examination_room_v1.room_activations%rowtype; sid uuid:=compat_student_test.uid(30000+n); BEGIN
 SELECT * INTO STRICT a FROM examination_room_v1.room_activations WHERE id=compat_student_test.uid(4000+room_n);
 INSERT INTO examination_room_v1.student_identities(id,institution_id,external_student_id,full_name,email_normalized)
 VALUES(compat_student_test.uid(10000+n),a.institution_id,'STUDENT-'||n,'Synthetic Student '||n,'student-'||n||'@example.invalid');
 INSERT INTO examination_room_v1.exam_roster(id,exam_id,institution_id,student_identity_id,added_by_user_id,accommodations)
 VALUES(compat_student_test.uid(20000+n),a.exam_id,a.institution_id,compat_student_test.uid(10000+n),compat_student_test.uid(11),'{"subject":"Civil Law","yearLevel":"First year"}');
 INSERT INTO examination_room_v1.student_sessions(id,activation_id,exam_id,institution_id,exam_version_id,roster_id,session_token_hash,consent_request_hash,client_instance_id,session_status,started_at,last_heartbeat_at,lease_expires_at)
 VALUES(sid,a.id,a.exam_id,a.institution_id,a.exam_version_id,compat_student_test.uid(20000+n),compat_student_test.hash('token-'||n),compat_student_test.hash('consent-'||n),compat_student_test.uid(50000+n),'active',now()-interval '30 minutes',now(),now()+interval '30 minutes');
 INSERT INTO examination_room_v1.privacy_acceptances(id,notice_version_id,roster_id,session_id,exam_version_id,client_event_id,decision,accepted_features,evidence_sha256,capture_method,recorded_at)
 VALUES(compat_student_test.uid(40000+n),compat_student_test.uid(31),compat_student_test.uid(20000+n),sid,a.exam_version_id,compat_student_test.uid(60000+n),'accepted','{"recordingAccepted":false}',compat_student_test.hash('privacy-'||n),'checkbox',now()-interval '30 minutes');
 RETURN sid;
END $$;
CREATE FUNCTION compat_student_test.payload(n integer,label text) RETURNS jsonb LANGUAGE sql VOLATILE SET search_path TO pg_catalog AS $$
 SELECT jsonb_build_object('sessionId',compat_student_test.uid(30000+n),'sessionTokenHash',compat_student_test.hash('token-'||n),
 'requestHash',compat_student_test.hash(label||'-'||n),'clientEventId',gen_random_uuid(),'occurredAt',clock_timestamp(),'clientCompletedAt',clock_timestamp());
$$;
CREATE FUNCTION compat_student_test.answer(n integer) RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog AS $$
DECLARE s examination_room_v1.student_sessions%rowtype; v examination_room_v1.exam_versions%rowtype; a jsonb; BEGIN
 SELECT * INTO STRICT s FROM examination_room_v1.student_sessions WHERE id=compat_student_test.uid(30000+n);
 SELECT * INTO STRICT v FROM examination_room_v1.exam_versions WHERE id=s.exam_version_id;
 a:=jsonb_build_object('attemptId',s.id,'examinationId',s.exam_id,'examinationVersion',v.version_number,'questionNumber',1,'questionKey','q001','questionType','essay','publicationHash',v.content_sha256,'revision',1,'answer','Synthetic answer '||n);
 RETURN compat_student_test.payload(n,'answer')||jsonb_build_object('source','submission','submissionRequestHash',compat_student_test.hash('submit-'||n),'answerRevision',a,'answerHash',examination_room_v1.jsonb_sha256(a),'savedAt',clock_timestamp());
END $$;
CREATE FUNCTION compat_student_test.final_payload(n integer) RETURNS jsonb LANGUAGE plpgsql SET search_path TO pg_catalog AS $$
DECLARE context jsonb; s examination_room_v1.student_sessions%rowtype; a jsonb; m jsonb; BEGIN
 context:=examination_room_v1.api_student('session_context',compat_student_test.payload(n,'context'));
 PERFORM compat_student_test.assert_true(context->>'ok'='true','final payload context '||context::text);
 SELECT * INTO STRICT s FROM examination_room_v1.student_sessions WHERE id=compat_student_test.uid(30000+n);
 SELECT answer_payload INTO STRICT a FROM examination_room_v1.answer_revisions WHERE session_id=s.id AND revision_number=1;
 m:=jsonb_build_object('schemaVersion','examination-room/submission/v1','submissionId',compat_student_test.uid(70000+n),'attemptId',s.id,'examinationId',s.exam_id,
 'examinationVersion',1,'publicationHash',context->'publicationHash','identityMode','real_names','studentIdentity',context->'studentIdentity',
 'gradingIdentity',jsonb_build_object('mode','real_names','displayName',context#>'{studentIdentity,realName}','studentNumber',context#>'{studentIdentity,studentNumber}'),
 'privacyConsent',context->'privacyConsent','questionCount',1,'maxPoints',10,'submittedAt',clock_timestamp(),
 'questions',jsonb_build_array(jsonb_build_object('questionNumber',1,'questionKey','q001','revision',1,'answer',a->'answer')));
 RETURN compat_student_test.payload(n,'submit')||jsonb_build_object('submissionManifest',m,'manifestHash',examination_room_v1.jsonb_sha256(m),
 'answerSelections','[{"questionNumber":1,"questionKey":"q001","revision":1}]'::jsonb);
END $$;
CREATE FUNCTION compat_student_test.admission(room_n integer,email text,number text,label text) RETURNS jsonb LANGUAGE sql VOLATILE SET search_path TO pg_catalog AS $$
 SELECT jsonb_build_object('roomKeyHash',compat_student_test.hash('key-'||room_n),'requestHash',compat_student_test.hash(label),'sessionTokenHash',compat_student_test.hash(label||'-token'),
 'clientEventId',gen_random_uuid(),'clientInstanceId',gen_random_uuid(),'identity',jsonb_build_object('realName','Synthetic Candidate','studentNumber',number,'email',email,'subject','Civil Law','yearLevel','First year'),
 'consent',jsonb_build_object('noticeVersion','student-synthetic-notice','accepted',true,'recordingAccepted',false,'acceptedAt',clock_timestamp()));
$$;
CREATE TABLE compat_student_test.saved(name text PRIMARY KEY,value jsonb NOT NULL);
SELECT compat_student_test.make_room(n,n=12) FROM generate_series(1,14) n;
SELECT compat_student_test.make_session(n,n) FROM generate_series(1,10) n;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA compat_student_test FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA compat_student_test FROM PUBLIC;
COMMIT;
SELECT 'PASS student synthetic seed with actual guards';

-- Synthetic current-schema behavior fixture only. Never run against a hosted project.
-- The parent runner must independently bind a disposable local database.
BEGIN;
DO $guard$ BEGIN
  IF current_database() <> 'duediligence_compatibility_fixture'
     OR current_user <> 'postgres'
     OR current_setting('duediligence.compatibility_fixture', true)
        IS DISTINCT FROM 'isolated-current-capture-20261018' THEN
    RAISE EXCEPTION 'Professor fixture isolation guard refused';
  END IF;
END $guard$;
CREATE SCHEMA compat_professor_test AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA compat_professor_test FROM PUBLIC;
CREATE FUNCTION compat_professor_test.uid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE
SET search_path TO pg_catalog AS $$
  SELECT ('70000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid;
$$;
CREATE FUNCTION compat_professor_test.hash(t text) RETURNS text LANGUAGE sql IMMUTABLE
SET search_path TO pg_catalog AS $$
  SELECT encode(sha256(convert_to('professor-fixture:' || t, 'UTF8')), 'hex');
$$;
CREATE FUNCTION compat_professor_test.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql
SET search_path TO pg_catalog AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Professor assertion failed: %', label; END IF;
END $$;
CREATE FUNCTION compat_professor_test.code(response jsonb, expected text, label text) RETURNS void LANGUAGE plpgsql
SET search_path TO pg_catalog AS $$ BEGIN
  PERFORM compat_professor_test.assert_true(response ->> 'ok' = 'false'
    AND response ->> 'errorCode' = expected, label || ': ' || response::text);
END $$;
CREATE FUNCTION compat_professor_test.write_state() RETURNS jsonb LANGUAGE sql STABLE
SET search_path TO pg_catalog AS $$
  SELECT jsonb_build_object(
    'grades', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM examination_room_v1.grade_revisions t
      JOIN examination_room_v1.submissions s ON s.id=t.submission_id JOIN examination_room_v1.student_sessions ss ON ss.id=s.session_id
      WHERE ss.institution_id=compat_professor_test.uid(1)),
    'items', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]') FROM examination_room_v1.grade_revision_items t
      JOIN examination_room_v1.grade_revisions g ON g.id=t.grade_revision_id JOIN examination_room_v1.submissions s ON s.id=g.submission_id
      JOIN examination_room_v1.student_sessions ss ON ss.id=s.session_id WHERE ss.institution_id=compat_professor_test.uid(1)),
    'releases', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM examination_room_v1.result_releases t
      JOIN examination_room_v1.submissions s ON s.id=t.submission_id JOIN examination_room_v1.student_sessions ss ON ss.id=s.session_id
      WHERE ss.institution_id=compat_professor_test.uid(1)),
    'audits', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM examination_room_v1.audit_events t
      WHERE t.institution_id=compat_professor_test.uid(1)),
    'snapshots', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]') FROM examination_room_v1.recovery_snapshots t
      JOIN examination_room_v1.exams e ON e.id=t.exam_id WHERE e.institution_id=compat_professor_test.uid(1)));
$$;
CREATE TABLE compat_professor_test.baseline(name text PRIMARY KEY, value jsonb NOT NULL);
CREATE FUNCTION compat_professor_test.sealed_state() RETURNS jsonb LANGUAGE sql STABLE
SET search_path TO pg_catalog AS $$
  SELECT jsonb_build_object(
    'versions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM examination_room_v1.exam_versions t WHERE t.institution_id=compat_professor_test.uid(1)),
    'questions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM examination_room_v1.questions t JOIN examination_room_v1.exam_versions v ON v.id=t.exam_version_id WHERE v.institution_id=compat_professor_test.uid(1)),
    'submissions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM examination_room_v1.submissions t JOIN examination_room_v1.student_sessions s ON s.id=t.session_id WHERE s.institution_id=compat_professor_test.uid(1)),
    'answers',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM examination_room_v1.answer_revisions t JOIN examination_room_v1.student_sessions s ON s.id=t.session_id WHERE s.institution_id=compat_professor_test.uid(1)),
    'selectedAnswers',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') FROM examination_room_v1.submission_answers t JOIN examination_room_v1.student_sessions s ON s.id=t.session_id WHERE s.institution_id=compat_professor_test.uid(1)),
    'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM examination_room_v1.submission_receipts t JOIN examination_room_v1.submissions sub ON sub.id=t.submission_id JOIN examination_room_v1.student_sessions s ON s.id=sub.session_id WHERE s.institution_id=compat_professor_test.uid(1)));
$$;

INSERT INTO auth.users(id, email, raw_user_meta_data)
SELECT compat_professor_test.uid(n), 'professor-' || n || '@example.invalid', '{"full_name":"Synthetic Professor"}'
FROM generate_series(11, 13) n;
INSERT INTO public.profiles(id, display_name, law_school_id)
SELECT compat_professor_test.uid(n), 'Synthetic Professor ' || n, 'professor-fixture-a'
FROM generate_series(11, 13) n;
INSERT INTO public.user_roles(user_id, role) VALUES (compat_professor_test.uid(13), 'founder_admin');
INSERT INTO examination_room_v1.institutions(id,institution_code,profile_school_id,institution_name,bootstrap_request_hash,created_by_user_id)
SELECT compat_professor_test.uid(n), 'professor-fixture-' || n,
  CASE n WHEN 1 THEN 'professor-fixture-a' ELSE 'professor-fixture-b' END,
  'Synthetic Professor Institution ' || n, compat_professor_test.hash('institution-' || n), compat_professor_test.uid(13)
FROM generate_series(1,2) n;
INSERT INTO examination_room_v1.staff_memberships(institution_id,user_id,staff_role,display_name,email_normalized,granted_by_user_id)
SELECT compat_professor_test.uid(1),compat_professor_test.uid(n),'professor','Synthetic Professor ' || n,
  'professor-' || n || '@example.invalid',compat_professor_test.uid(13)
FROM generate_series(11,13) n;
INSERT INTO examination_room_v1.privacy_notice_versions(id,institution_id,notice_code,version_number,title,notice_body,body_sha256,effective_at,created_by_user_id)
VALUES (compat_professor_test.uid(31),compat_professor_test.uid(1),'synthetic-notice',1,
  'Synthetic notice','No real participant or outgoing mail.',compat_professor_test.hash('notice'),now(),compat_professor_test.uid(11));
INSERT INTO examination_room_v1.exams(id,institution_id,owner_user_id,title)
SELECT compat_professor_test.uid(n),compat_professor_test.uid(1),compat_professor_test.uid(11),'Synthetic grading ' || n
FROM generate_series(21,23) n;

CREATE FUNCTION compat_professor_test.publish(exam_n integer, version_n integer, version_number integer, points integer[]) RETURNS void
LANGUAGE plpgsql SET search_path TO pg_catalog AS $$
DECLARE v uuid := compat_professor_test.uid(version_n); manifest jsonb; published timestamptz := clock_timestamp(); idx integer;
BEGIN
  INSERT INTO examination_room_v1.exam_versions(id,exam_id,institution_id,version_number,title_snapshot,duration_seconds,privacy_notice_version_id,content_sha256,created_at)
  VALUES(v,compat_professor_test.uid(exam_n),compat_professor_test.uid(1),version_number,
    'Synthetic immutable version',3600,compat_professor_test.uid(31),compat_professor_test.hash('unsealed-' || version_n),published);
  FOR idx IN 1..array_length(points,1) LOOP
    INSERT INTO examination_room_v1.questions(id,exam_version_id,position,question_key,question_kind,prompt,points,content_sha256)
    VALUES(compat_professor_test.uid(version_n * 100 + idx),v,idx,'q' || lpad(idx::text,3,'0'),'essay',
      'Synthetic question ' || idx, points[idx],compat_professor_test.hash('question-' || version_n || '-' || idx));
  END LOOP;
  manifest := examination_room_v1.build_publication_manifest(v,published);
  UPDATE examination_room_v1.exam_versions SET publication_status='published',published_by_user_id=compat_professor_test.uid(11),
    published_at=published,publication_manifest=manifest,content_sha256=examination_room_v1.jsonb_sha256(manifest) WHERE id=v;
  UPDATE examination_room_v1.exams SET status='published',current_published_version_id=v WHERE id=compat_professor_test.uid(exam_n);
END $$;
SELECT compat_professor_test.publish(21,41,1,ARRAY[10,20]);
SELECT compat_professor_test.publish(21,42,2,ARRAY[90]);
SELECT compat_professor_test.publish(22,43,1,ARRAY[5]);
SELECT compat_professor_test.publish(23,44,1,ARRAY[5]);
INSERT INTO examination_room_v1.room_activations(id,exam_id,institution_id,exam_version_id,key_hash,key_hash_algorithm,request_hash,activation_status,opens_at,closes_at,activated_by_user_id,created_at)
SELECT compat_professor_test.uid(n),compat_professor_test.uid(CASE WHEN n IN(61,62) THEN 21 ELSE 23 END),
  compat_professor_test.uid(1),compat_professor_test.uid(CASE WHEN n IN(61,62) THEN 41 ELSE 44 END),
  compat_professor_test.hash('key-' || n),'hmac-sha256-v1',compat_professor_test.hash('activation-' || n),
  CASE WHEN n IN(61,64) THEN 'closed' ELSE 'open' END,
  now()-interval '2 hours',now()+interval '2 hours',compat_professor_test.uid(11),
  CASE WHEN n=61 THEN now()-interval '2 hours' ELSE now()-interval '1 hour' END
FROM generate_series(61,64) n;

CREATE FUNCTION compat_professor_test.add_session(n integer, activation_n integer, status text,
  heartbeat timestamptz, updated timestamptz, submitted boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SET search_path TO pg_catalog AS $$
DECLARE a examination_room_v1.room_activations%rowtype; q examination_room_v1.questions%rowtype;
  sid uuid := compat_professor_test.uid(10000+n); subid uuid := compat_professor_test.uid(20000+n);
  payload jsonb; count_answers integer; pubhash text;
BEGIN
  SELECT * INTO STRICT a FROM examination_room_v1.room_activations WHERE id=compat_professor_test.uid(activation_n);
  INSERT INTO examination_room_v1.student_identities(id,institution_id,external_student_id,full_name,email_normalized)
  VALUES(compat_professor_test.uid(30000+n),a.institution_id,'fixture-' || n,'Synthetic Student ' || n,'student-' || n || '@example.invalid');
  INSERT INTO examination_room_v1.exam_roster(id,exam_id,institution_id,student_identity_id,grading_alias,added_by_user_id)
  VALUES(compat_professor_test.uid(40000+n),a.exam_id,a.institution_id,compat_professor_test.uid(30000+n),'Candidate ' || n,compat_professor_test.uid(11));
  INSERT INTO examination_room_v1.student_sessions(id,activation_id,exam_id,institution_id,exam_version_id,roster_id,session_token_hash,consent_request_hash,client_instance_id,
    session_status,started_at,last_heartbeat_at,lease_expires_at,session_metadata,created_at,updated_at)
  VALUES(sid,a.id,a.exam_id,a.institution_id,a.exam_version_id,compat_professor_test.uid(40000+n),compat_professor_test.hash('session-' || n),
    compat_professor_test.hash('consent-' || n),compat_professor_test.uid(50000+n),status,now()-interval '30 minutes',heartbeat,a.closes_at,
    jsonb_build_object('connected',false,'email','forged@example.invalid'),now()-interval '30 minutes',updated);
  IF submitted THEN
    SELECT count(*) INTO count_answers FROM examination_room_v1.questions WHERE exam_version_id=a.exam_version_id;
    SELECT content_sha256 INTO pubhash FROM examination_room_v1.exam_versions WHERE id=a.exam_version_id;
    payload := jsonb_build_object('schemaVersion','examination-room/submission/v1','submissionId',subid,'sessionId',sid,
      'publicationHash',pubhash,'answerCount',count_answers,'submittedAt',now());
    INSERT INTO examination_room_v1.submissions(id,session_id,exam_version_id,idempotency_key_hash,manifest_sha256,submission_manifest,answer_count,submitted_at_client)
    VALUES(subid,sid,a.exam_version_id,compat_professor_test.hash('submission-' || n),examination_room_v1.jsonb_sha256(payload),payload,count_answers,now());
    FOR q IN SELECT * FROM examination_room_v1.questions WHERE exam_version_id=a.exam_version_id ORDER BY position LOOP
      payload := jsonb_build_object('answer','Synthetic saved answer ' || n || '-' || q.position);
      INSERT INTO examination_room_v1.answer_revisions(id,session_id,exam_version_id,question_id,revision_number,client_revision_id,idempotency_key_hash,
        answer_format,answer_payload,answer_sha256,source,saved_at)
      VALUES(compat_professor_test.uid(60000+n*10+q.position),sid,a.exam_version_id,q.id,1,
        compat_professor_test.uid(70000+n*10+q.position),compat_professor_test.hash('answer-' || n || '-' || q.position),
        'plain_text',payload,examination_room_v1.jsonb_sha256(payload),'submission',now());
      INSERT INTO examination_room_v1.submission_answers(submission_id,session_id,question_id,answer_revision_id)
      VALUES(subid,sid,q.id,compat_professor_test.uid(60000+n*10+q.position));
    END LOOP;
    INSERT INTO examination_room_v1.submission_receipts(id,submission_id,receipt_code,receipt_sha256,receipt_payload)
    VALUES(compat_professor_test.uid(80000+n),subid,compat_professor_test.uid(90000+n),compat_professor_test.hash('receipt-' || n),
      jsonb_build_object('submissionId',subid,'answerCount',count_answers,'status','accepted'));
  END IF;
  INSERT INTO examination_room_v1.proctoring_incidents(session_id,client_event_id,incident_kind,source,occurred_at,details)
  VALUES(sid,compat_professor_test.uid(100000+n),'focus_lost','browser_signal',now(),'{"synthetic":true}');
  RETURN sid;
END $$;
SELECT compat_professor_test.add_session(1,61,'submitted',now(),now(),true);
SELECT compat_professor_test.add_session(2,62,'submitted',now(),now(),true);
SELECT compat_professor_test.add_session(3,62,'submitted',now(),now(),true);
SELECT compat_professor_test.add_session(4,63,'submitted',now(),now(),true);
SELECT compat_professor_test.add_session(5,64,'submitted',now(),now(),true);

CREATE FUNCTION compat_professor_test.grade_payload(n integer, scores jsonb, status text DEFAULT 'draft', actor_n integer DEFAULT 11) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO pg_catalog AS $$
DECLARE sub examination_room_v1.submissions%rowtype; manifest jsonb; revision_n integer; revision_id uuid := gen_random_uuid(); total numeric;
BEGIN
  SELECT * INTO STRICT sub FROM examination_room_v1.submissions WHERE id=compat_professor_test.uid(20000+n);
  SELECT coalesce(max(revision_number),0)+1 INTO revision_n FROM examination_room_v1.grade_revisions WHERE submission_id=sub.id;
  SELECT coalesce(sum((v->>'pointsAwarded')::numeric),0) INTO total FROM jsonb_array_elements(scores) v;
  manifest := jsonb_build_object('schemaVersion','examination-room/grading/v1','submissionId',sub.id,
    'publicationHash',sub.submission_manifest->>'publicationHash','graderId',compat_professor_test.uid(actor_n),
    'status',status,'revision',revision_n,'revisionId',revision_id,'gradedAt',now(),'scores',scores,
    'scoreCount',jsonb_array_length(scores),'totalPointsAwarded',total,'maxPoints',30,'overallFeedback','Synthetic feedback');
  RETURN jsonb_build_object('examId',compat_professor_test.uid(21),'sessionId',sub.session_id,'gradingManifest',manifest,
    'requestHash',compat_professor_test.hash(revision_id::text),'clientRevisionId',gen_random_uuid(),
    'gradingHash',examination_room_v1.jsonb_sha256(manifest));
END $$;
CREATE FUNCTION compat_professor_test.score_items(complete boolean DEFAULT true) RETURNS jsonb LANGUAGE sql IMMUTABLE
SET search_path TO pg_catalog AS $$
  SELECT CASE WHEN complete THEN
    '[{"questionNumber":1,"questionKey":"q001","pointsAwarded":7,"maxPoints":10,"feedback":"Synthetic first"},{"questionNumber":2,"questionKey":"q002","pointsAwarded":17,"maxPoints":20,"feedback":"Synthetic second"}]'::jsonb
  ELSE '[{"questionNumber":1,"questionKey":"q001","pointsAwarded":7,"maxPoints":10,"feedback":"Synthetic first"}]'::jsonb END;
$$;
CREATE FUNCTION compat_professor_test.release_payload(grade_payload jsonb) RETURNS jsonb LANGUAGE plpgsql
SET search_path TO pg_catalog AS $$
DECLARE g jsonb := grade_payload->'gradingManifest'; r jsonb; request_hash text := compat_professor_test.hash(gen_random_uuid()::text);
BEGIN
  r := jsonb_build_object('schemaVersion','examination-room/result-release/v1','submissionId',g->'submissionId',
    'publicationHash',g->'publicationHash','selectedRevisionId',g->'revisionId','selectedRevision',g->'revision',
    'releasedBy',g->'graderId','releasedAt',g->'gradedAt','releaseId',gen_random_uuid(),
    'result',jsonb_build_object('gradedAt',g->'gradedAt','scores',g->'scores','totalPointsAwarded',g->'totalPointsAwarded',
      'maxPoints',g->'maxPoints','overallFeedback',g->'overallFeedback'));
  RETURN jsonb_build_object('examId',grade_payload->'examId','requestHash',request_hash,
    'sessionIds',jsonb_build_array(grade_payload->'sessionId'),'releases',jsonb_build_array(jsonb_build_object(
      'sessionId',grade_payload->'sessionId','gradingManifest',g,'gradingHash',grade_payload->'gradingHash',
      'releaseManifest',r,'releaseHash',examination_room_v1.jsonb_sha256(r),'releaseRequestHash',compat_professor_test.hash(gen_random_uuid()::text))));
END $$;

-- Historical valid release uses the real strict validator and real recovery trigger.
DO $historical$ DECLARE response jsonb; BEGIN
  response := examination_room_v1.api_professor('release_results',compat_professor_test.uid(11),compat_professor_test.uid(1),
    compat_professor_test.release_payload(compat_professor_test.grade_payload(1,compat_professor_test.score_items(), 'final')));
  PERFORM compat_professor_test.assert_true(response->>'ok'='true' AND response->>'released'='1','historical full release: ' || response::text);
END $historical$;
INSERT INTO compat_professor_test.baseline(name,value)
VALUES('grading',examination_room_v1.api_professor_view('grading',compat_professor_test.uid(11),compat_professor_test.uid(1),compat_professor_test.uid(21))-'generatedAt');
UPDATE examination_room_v1.exams SET anonymous_grading=true WHERE id=compat_professor_test.uid(21);
INSERT INTO compat_professor_test.baseline(name,value)
VALUES('anonymous_grading',examination_room_v1.api_professor_view('grading',compat_professor_test.uid(11),compat_professor_test.uid(1),compat_professor_test.uid(21))-'generatedAt');
UPDATE examination_room_v1.exams SET anonymous_grading=false WHERE id=compat_professor_test.uid(21);
INSERT INTO compat_professor_test.baseline(name,value) VALUES('write_state',compat_professor_test.write_state());
INSERT INTO compat_professor_test.baseline(name,value) VALUES('sealed_state',compat_professor_test.sealed_state());
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA compat_professor_test FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA compat_professor_test FROM PUBLIC;
COMMIT;
SELECT 'PASS professor synthetic seed: real constraints, immutable publication, complete answers, historical final release';

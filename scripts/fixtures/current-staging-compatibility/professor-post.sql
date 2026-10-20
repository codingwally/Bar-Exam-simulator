-- Must execute after the complete bounded forward in an isolated local database.
-- Every behavior-test mutation is rolled back, including real inert recovery records.
BEGIN;
DO $post$
DECLARE
  response jsonb; replay jsonb; p jsonb; valid jsonb; r jsonb; r2 jsonb; bad jsonb;
  before_state jsonb; baseline jsonb; monitor jsonb; grading jsonb; g_id uuid;
  operation text; case_n integer; item jsonb; expected boolean;
BEGIN
  PERFORM compat_professor_test.assert_true(current_database()='duediligence_compatibility_fixture'
    AND current_user='postgres' AND current_setting('duediligence.compatibility_fixture',true)='isolated-current-capture-20261018','post isolation');
  SELECT value INTO STRICT baseline FROM compat_professor_test.baseline WHERE name='write_state';
  PERFORM compat_professor_test.assert_true(compat_professor_test.write_state()=baseline,'forward changed no fixture rows');

  -- Check preserved historical rendering before appending any new grade.
  grading := examination_room_v1.api_professor_view('grading',compat_professor_test.uid(11),compat_professor_test.uid(1),compat_professor_test.uid(21))-'generatedAt';
  PERFORM compat_professor_test.assert_true(grading=(SELECT value FROM compat_professor_test.baseline WHERE name='grading'),'M01 exact grading/history response preservation');
  PERFORM compat_professor_test.assert_true(jsonb_array_length(grading->'sessions')=3 AND jsonb_array_length(grading->'answerRevisions')=6
    AND jsonb_array_length(grading->'gradeRevisions')=2 AND jsonb_array_length(grading->'releases')=1,'M01 historical answers, grades and release retained');
  PERFORM compat_professor_test.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(grading->'sessions') s WHERE s ? 'email'),'M04 no grading email key');
  monitor := examination_room_v1.api_professor_view('monitor',compat_professor_test.uid(11),compat_professor_test.uid(1),compat_professor_test.uid(21));
  PERFORM compat_professor_test.assert_true(monitor->>'ok'='true' AND monitor#>>'{activation,id}'=compat_professor_test.uid(62)::text
    AND jsonb_array_length(monitor->'sessions')=2 AND jsonb_array_length(monitor->'submissions')=2
    AND jsonb_array_length(monitor->'incidents')=2,'M01 latest activation all arrays');
  FOREACH operation IN ARRAY ARRAY['sessions','submissions','incidents'] LOOP
    PERFORM compat_professor_test.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(monitor->operation) s
      WHERE s->>'sessionId'=compat_professor_test.uid(10001)::text),'M01 no prior session in ' || operation);
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(monitor->'sessions') LOOP
    PERFORM compat_professor_test.assert_true(item->>'email'=CASE item->>'sessionId'
      WHEN compat_professor_test.uid(10002)::text THEN 'student-2@example.invalid'
      WHEN compat_professor_test.uid(10003)::text THEN 'student-3@example.invalid' END,'M04 email joined from identity');
    PERFORM compat_professor_test.assert_true(item->>'email'<>'forged@example.invalid','M04 client metadata cannot change email');
  END LOOP;
  RAISE NOTICE 'PASS M01/M04: current monitor scope and email; exact grading/history preserved';

  -- Tie-break follows latest created then descending UUID, even for a closed room.
  monitor := examination_room_v1.api_professor_view('monitor',compat_professor_test.uid(11),compat_professor_test.uid(1),compat_professor_test.uid(23));
  PERFORM compat_professor_test.assert_true(monitor#>>'{activation,id}'=compat_professor_test.uid(64)::text
    AND monitor#>>'{activation,status}'='closed','M02 latest closed tie activation');
  FOREACH operation IN ARRAY ARRAY['sessions','submissions','incidents'] LOOP
    PERFORM compat_professor_test.assert_true(jsonb_array_length(monitor->operation)=1
      AND monitor#>>ARRAY[operation,'0','sessionId']=compat_professor_test.uid(10005)::text,'M02 same tie scope ' || operation);
  END LOOP;
  monitor := examination_room_v1.api_professor_view('monitor',compat_professor_test.uid(11),compat_professor_test.uid(1),compat_professor_test.uid(22));
  PERFORM compat_professor_test.assert_true(monitor->'activation'='null'::jsonb AND monitor->'sessions'='[]'::jsonb
    AND monitor->'submissions'='[]'::jsonb AND monitor->'incidents'='[]'::jsonb,'M02 empty activation');
  RAISE NOTICE 'PASS M02: empty activation and closed tie are scoped consistently';

  -- The transaction clock makes exactly-45-second behavior deterministic.
  PERFORM compat_professor_test.add_session(10,62,'active',now(),now());
  PERFORM compat_professor_test.add_session(11,62,'active',now()-interval '45 seconds',now());
  PERFORM compat_professor_test.add_session(12,62,'active',now()-interval '46 seconds',now());
  PERFORM compat_professor_test.add_session(13,62,'created',now(),now());
  PERFORM compat_professor_test.add_session(14,62,'active',null,now());
  PERFORM compat_professor_test.add_session(15,62,'active',null,now()-interval '46 seconds');
  PERFORM compat_professor_test.add_session(16,62,'revoked',now(),now());
  -- This is ordinary permitted metadata mutation, with the real updated_at trigger.
  UPDATE examination_room_v1.student_sessions SET session_metadata=jsonb_set(session_metadata,'{connected}','true')
    WHERE id=compat_professor_test.uid(10012);
  monitor := examination_room_v1.api_professor_view('monitor',compat_professor_test.uid(11),compat_professor_test.uid(1),compat_professor_test.uid(21));
  FOR case_n IN 10..16 LOOP
    SELECT value INTO STRICT item FROM jsonb_array_elements(monitor->'sessions') WHERE value->>'id'=compat_professor_test.uid(10000+case_n)::text;
    expected := case_n IN(10,11,13,14);
    PERFORM compat_professor_test.assert_true((item->>'connected')::boolean=expected,'M03 presence session ' || case_n);
  END LOOP;
  PERFORM compat_professor_test.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(monitor->'sessions') s
    WHERE s->>'status'='submitted' AND (s->>'connected')::boolean),'M03 submitted fresh heartbeat is offline');
  RAISE NOTICE 'PASS M03: active/created, exact boundary, stale, fallback, revoked/submitted and legacy metadata';

  -- Every authorization response must contain no participant identity arrays.
  FOREACH operation IN ARRAY ARRAY['monitor','grading'] LOOP
    response := examination_room_v1.api_professor_view(operation,compat_professor_test.uid(12),compat_professor_test.uid(1),compat_professor_test.uid(21));
    PERFORM compat_professor_test.code(response,'FORBIDDEN','P05 unrelated view ' || operation);
    PERFORM compat_professor_test.assert_true(NOT(response ? 'sessions') AND response::text NOT LIKE '%student-%@example.invalid%','M04 no unauthorized identity');
    response := examination_room_v1.api_professor_view(operation,compat_professor_test.uid(11),compat_professor_test.uid(2),compat_professor_test.uid(21));
    PERFORM compat_professor_test.code(response,'EXAM_NOT_FOUND','P05 wrong institution view ' || operation);
    response := examination_room_v1.api_professor_view(operation,compat_professor_test.uid(13),compat_professor_test.uid(1),compat_professor_test.uid(21));
    PERFORM compat_professor_test.assert_true(response->>'ok'='true','P05 platform owner view ' || operation);
    response := public.examination_room_v1_api('professor',operation,null,compat_professor_test.uid(1),jsonb_build_object('examId',compat_professor_test.uid(21)));
    PERFORM compat_professor_test.code(response,'CREATOR_WORKSPACE_REQUIRED','P05 public missing actor ' || operation);
  END LOOP;
  UPDATE examination_room_v1.exams SET anonymous_grading=true,current_published_version_id=compat_professor_test.uid(45)
    WHERE id=compat_professor_test.uid(21);
  grading := examination_room_v1.api_professor_view('grading',compat_professor_test.uid(11),compat_professor_test.uid(1),compat_professor_test.uid(21));
  PERFORM compat_professor_test.assert_true(grading-'generatedAt'=(SELECT value FROM compat_professor_test.baseline WHERE name='anonymous_grading'),
    'M04 exact anonymous grading/history response preserved');
  PERFORM compat_professor_test.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(grading->'sessions') s
    WHERE s ? 'email' OR s->>'identityMode'<>'anonymous_grading' OR NOT(s ? 'realFullName') OR NOT(s ? 'realStudentNumber') OR NOT(s ? 'gradingAlias')),
    'M04 anonymous response excludes email and preserves existing reveal model');
  PERFORM compat_professor_test.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(grading->'sessions') s
    WHERE s->>'id'=ANY(ARRAY[compat_professor_test.uid(10001)::text,compat_professor_test.uid(10002)::text,compat_professor_test.uid(10003)::text])),
    'M04 anonymous response uses opaque grading identifiers');
  UPDATE examination_room_v1.exams SET anonymous_grading=false,current_published_version_id=compat_professor_test.uid(42)
    WHERE id=compat_professor_test.uid(21);

  -- Partial maximum must be bound to submitted version 41 (30), not current 42 (90).
  p := compat_professor_test.grade_payload(2,compat_professor_test.score_items(false));
  before_state := compat_professor_test.write_state();
  response := examination_room_v1.api_professor('save_grade',compat_professor_test.uid(11),compat_professor_test.uid(1),p);
  PERFORM compat_professor_test.assert_true(response->>'ok'='true' AND (response#>>'{revision,maxPoints}')::numeric=30
    AND (response#>>'{revision,totalPointsAwarded}')::numeric=7,'P01 partial succeeds: ' || response::text);
  g_id := (p#>>'{gradingManifest,revisionId}')::uuid;
  PERFORM compat_professor_test.assert_true(EXISTS(SELECT 1 FROM examination_room_v1.grade_revisions WHERE id=g_id
    AND item_count=1 AND maximum_score=30 AND total_score=7 AND exam_version_id=compat_professor_test.uid(41)),'P01 persisted full version maximum');
  PERFORM compat_professor_test.assert_true((SELECT count(*) FROM examination_room_v1.grade_revision_items WHERE grade_revision_id=g_id)=1,'P01 exactly one persisted grade item');
  PERFORM compat_professor_test.assert_true((SELECT count(*) FROM examination_room_v1.audit_events WHERE request_hash=p->>'requestHash' AND event_type='professor.save_grade')=1,'P01 draft audit');
  PERFORM compat_professor_test.assert_true((compat_professor_test.write_state()->'snapshots')=(before_state->'snapshots'),'P01 draft has no recovery event');
  before_state := compat_professor_test.write_state();
  replay := examination_room_v1.api_professor('save_grade',compat_professor_test.uid(11),compat_professor_test.uid(1),p);
  PERFORM compat_professor_test.assert_true(replay=response AND compat_professor_test.write_state()=before_state,'P04 replay returns same result without writes');
  bad := jsonb_set(compat_professor_test.grade_payload(2,compat_professor_test.score_items(false)),'{gradingManifest,revision}','1');
  response := examination_room_v1.api_professor('save_grade',compat_professor_test.uid(11),compat_professor_test.uid(1),bad);
  PERFORM compat_professor_test.code(response,'GRADE_REVISION_CONFLICT','P04 stale grade revision');
  response := examination_room_v1.api_professor('release_results',compat_professor_test.uid(11),compat_professor_test.uid(1),p);
  PERFORM compat_professor_test.code(response,'IDEMPOTENCY_KEY_REUSED','P04 request fingerprint reused for release');
  PERFORM compat_professor_test.assert_true(compat_professor_test.write_state()=before_state,'P04 rejected requests preserve writes');
  RAISE NOTICE 'PASS P01/P04: partial draft stored against submitted version; replay and revision protection';

  before_state := compat_professor_test.write_state();
  p := compat_professor_test.grade_payload(2,'[]');
  response := examination_room_v1.api_professor('save_grade',compat_professor_test.uid(11),compat_professor_test.uid(1),p);
  PERFORM compat_professor_test.assert_true(response->>'ok'='true','P02 empty draft accepted: ' || response::text);
  g_id := (p#>>'{gradingManifest,revisionId}')::uuid;
  PERFORM compat_professor_test.assert_true(EXISTS(SELECT 1 FROM examination_room_v1.grade_revisions WHERE id=g_id AND item_count=0 AND total_score=0 AND maximum_score=30)
    AND NOT EXISTS(SELECT 1 FROM examination_room_v1.grade_revision_items WHERE grade_revision_id=g_id),'P02 empty draft state');
  PERFORM compat_professor_test.assert_true((SELECT count(*) FROM examination_room_v1.audit_events WHERE request_hash=p->>'requestHash' AND event_type='professor.save_grade')=1,'P02 empty draft audit');
  p := compat_professor_test.grade_payload(2,compat_professor_test.score_items());
  response := examination_room_v1.api_professor('save_grade',compat_professor_test.uid(11),compat_professor_test.uid(1),p);
  PERFORM compat_professor_test.assert_true(response->>'ok'='true' AND (response#>>'{revision,totalPointsAwarded}')::numeric=24
    AND (response#>>'{revision,maxPoints}')::numeric=30,'P02 complete draft accepted: ' || response::text);
  PERFORM compat_professor_test.assert_true((SELECT count(*) FROM examination_room_v1.grade_revision_items WHERE grade_revision_id=(p#>>'{gradingManifest,revisionId}')::uuid)=2,'P02 complete draft two items');
  PERFORM compat_professor_test.assert_true((SELECT count(*) FROM examination_room_v1.audit_events WHERE request_hash=p->>'requestHash' AND event_type='professor.save_grade')=1,'P02 complete draft audit');
  PERFORM compat_professor_test.assert_true((compat_professor_test.write_state()->'snapshots')=(before_state->'snapshots'),'P02 draft saves do not queue recovery');
  RAISE NOTICE 'PASS P02: empty and complete drafts retain full submitted-version maximum';

  valid := compat_professor_test.grade_payload(2,compat_professor_test.score_items(false));
  before_state := compat_professor_test.write_state();
  FOR case_n IN 1..11 LOOP
    bad := CASE case_n
      WHEN 1 THEN jsonb_set(valid,'{gradingManifest,totalPointsAwarded}','8')
      WHEN 2 THEN jsonb_set(valid,'{gradingManifest,maxPoints}','10')
      WHEN 3 THEN jsonb_set(jsonb_set(valid,'{gradingManifest,scores}',(valid#>'{gradingManifest,scores}')||(valid#>'{gradingManifest,scores}')),'{gradingManifest,scoreCount}','2')
      WHEN 4 THEN jsonb_set(valid,'{gradingManifest,scores,0,questionKey}','"q999"')
      WHEN 5 THEN jsonb_set(valid,'{gradingManifest,scores,0,questionNumber}','99')
      WHEN 6 THEN jsonb_set(valid,'{gradingManifest,scores,0,maxPoints}','11')
      WHEN 7 THEN jsonb_set(valid,'{gradingManifest,scores,0,pointsAwarded}','11')
      WHEN 8 THEN jsonb_set(valid,'{gradingManifest,publicationHash}',to_jsonb(repeat('0',64)))
      WHEN 9 THEN jsonb_set(valid,'{gradingManifest,submissionId}',to_jsonb(compat_professor_test.uid(20003)::text))
      WHEN 10 THEN jsonb_set(valid,'{gradingManifest,graderId}',to_jsonb(compat_professor_test.uid(12)::text))
      WHEN 11 THEN jsonb_set(valid,'{gradingManifest,status}','"final"') END;
    response := examination_room_v1.api_professor('save_grade',compat_professor_test.uid(11),compat_professor_test.uid(1),bad);
    PERFORM compat_professor_test.code(response,'GRADING_MANIFEST_INVALID','P03 invalid manifest case ' || case_n);
    PERFORM compat_professor_test.assert_true(compat_professor_test.write_state()=before_state,'P03 no partial write case ' || case_n);
  END LOOP;
  FOREACH operation IN ARRAY ARRAY['save_grade','release_results'] LOOP
    response := examination_room_v1.api_professor(operation,compat_professor_test.uid(12),compat_professor_test.uid(1),valid);
    PERFORM compat_professor_test.code(response,'FORBIDDEN','P05 unrelated mutation ' || operation);
    response := examination_room_v1.api_professor(operation,compat_professor_test.uid(11),compat_professor_test.uid(2),valid);
    PERFORM compat_professor_test.code(response,'EXAM_NOT_FOUND','P05 wrong institution mutation ' || operation);
    response := public.examination_room_v1_api('professor',operation,null,compat_professor_test.uid(1),valid);
    PERFORM compat_professor_test.code(response,'CREATOR_WORKSPACE_REQUIRED','P05 missing actor mutation ' || operation);
  END LOOP;
  PERFORM compat_professor_test.assert_true(compat_professor_test.write_state()=before_state,'P05 mutation authorization no writes');
  p := compat_professor_test.grade_payload(3,compat_professor_test.score_items(false),'draft',13);
  response := examination_room_v1.api_professor('save_grade',compat_professor_test.uid(13),compat_professor_test.uid(1),p);
  PERFORM compat_professor_test.assert_true(response->>'ok'='true','P05 owner may save a bound draft');
  RAISE NOTICE 'PASS P03/P05: eleven invalid manifests and authorization boundaries';

  before_state := compat_professor_test.write_state();
  r := compat_professor_test.release_payload(compat_professor_test.grade_payload(2,compat_professor_test.score_items(false),'final'));
  response := examination_room_v1.api_professor('release_results',compat_professor_test.uid(11),compat_professor_test.uid(1),r);
  PERFORM compat_professor_test.code(response,'GRADING_INCOMPLETE','P06 incomplete final');
  r := compat_professor_test.release_payload(compat_professor_test.grade_payload(2,compat_professor_test.score_items(),'final'));
  bad := jsonb_set(r,'{releases,0,releaseManifest,result,totalPointsAwarded}','23');
  response := examination_room_v1.api_professor('release_results',compat_professor_test.uid(11),compat_professor_test.uid(1),bad);
  PERFORM compat_professor_test.code(response,'RESULT_RELEASE_MISMATCH','P06 exact result equality');
  r2 := compat_professor_test.release_payload(compat_professor_test.grade_payload(3,compat_professor_test.score_items(false),'final'));
  bad := jsonb_set(jsonb_set(r,'{releases}',(r->'releases')||(r2->'releases')),'{sessionIds}',(r->'sessionIds')||(r2->'sessionIds'));
  response := examination_room_v1.api_professor('release_results',compat_professor_test.uid(11),compat_professor_test.uid(1),bad);
  PERFORM compat_professor_test.code(response,'GRADING_INCOMPLETE','P07 mixed valid/incomplete release batch');
  bad := jsonb_set(jsonb_set(r,'{releases}',(r->'releases')||(r->'releases')),'{sessionIds}',(r->'sessionIds')||(r->'sessionIds'));
  response := examination_room_v1.api_professor('release_results',compat_professor_test.uid(11),compat_professor_test.uid(1),bad);
  PERFORM compat_professor_test.code(response,'GRADING_CONTEXT_INVALID','P07 duplicate recipients');
  bad := jsonb_set(r,'{sessionIds}',jsonb_build_array(compat_professor_test.uid(10003)));
  response := examination_room_v1.api_professor('release_results',compat_professor_test.uid(11),compat_professor_test.uid(1),bad);
  PERFORM compat_professor_test.code(response,'GRADING_CONTEXT_INVALID','P07 selected recipient mismatch');
  PERFORM compat_professor_test.assert_true(compat_professor_test.write_state()=before_state,'P06/P07 failures are atomic across grades/items/releases/audits/recovery');
  response := examination_room_v1.api_professor('release_results',compat_professor_test.uid(11),compat_professor_test.uid(1),r);
  PERFORM compat_professor_test.assert_true(response->>'ok'='true' AND response->>'released'='1','P06 full release: ' || response::text);
  g_id := (r#>>'{releases,0,gradingManifest,revisionId}')::uuid;
  PERFORM compat_professor_test.assert_true(EXISTS(SELECT 1 FROM examination_room_v1.grade_revisions WHERE id=g_id AND grade_status='final'
    AND item_count=2 AND total_score=24 AND maximum_score=30),'P06 final totals persisted');
  PERFORM compat_professor_test.assert_true((SELECT count(*) FROM examination_room_v1.grade_revision_items WHERE grade_revision_id=g_id)=2,'P06 final item count');
  PERFORM compat_professor_test.assert_true(EXISTS(SELECT 1 FROM examination_room_v1.result_releases WHERE grade_revision_id=g_id
    AND release_manifest#>'{result}'=r#>'{releases,0,releaseManifest,result}'),'P06 exact released result persisted');
  PERFORM compat_professor_test.assert_true((SELECT count(*) FROM examination_room_v1.recovery_snapshots WHERE request_hash=r->>'requestHash'
    AND source_kind='result_release' AND snapshot_status='pending' AND source_grade_revision_id=g_id)=1,'P06 real inert recovery trigger');
  PERFORM compat_professor_test.assert_true((SELECT count(*) FROM examination_room_v1.audit_events WHERE request_hash=r->>'requestHash'
    AND event_type='professor.release_results')=1,'P06 release audit');
  r2 := compat_professor_test.release_payload(compat_professor_test.grade_payload(3,compat_professor_test.score_items(),'final',13));
  response := examination_room_v1.api_professor('release_results',compat_professor_test.uid(13),compat_professor_test.uid(1),r2);
  PERFORM compat_professor_test.assert_true(response->>'ok'='true' AND response->>'released'='1','P05 owner may release a bound complete final');
  RAISE NOTICE 'PASS P06/P07: complete final release, exact result, atomic failed batches, real pending recovery';

  -- Catch only the expected immutable-record SQLSTATE; assertion exceptions escape.
  before_state := compat_professor_test.write_state();
  BEGIN UPDATE examination_room_v1.grade_revisions SET general_feedback='tampered' WHERE id=g_id;
    RAISE EXCEPTION 'P07 grade update unexpectedly succeeded'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN DELETE FROM examination_room_v1.grade_revisions WHERE id=g_id;
    RAISE EXCEPTION 'P07 grade delete unexpectedly succeeded'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN UPDATE examination_room_v1.grade_revision_items SET feedback='tampered' WHERE grade_revision_id=g_id;
    RAISE EXCEPTION 'P07 item update unexpectedly succeeded'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN DELETE FROM examination_room_v1.grade_revision_items WHERE grade_revision_id=g_id;
    RAISE EXCEPTION 'P07 item delete unexpectedly succeeded'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN UPDATE examination_room_v1.result_releases SET reason='tampered' WHERE grade_revision_id=g_id;
    RAISE EXCEPTION 'P07 release update unexpectedly succeeded'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  BEGIN DELETE FROM examination_room_v1.result_releases WHERE grade_revision_id=g_id;
    RAISE EXCEPTION 'P07 release delete unexpectedly succeeded'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  PERFORM compat_professor_test.assert_true(compat_professor_test.write_state()=before_state,'P07 denied edits preserve evidence byte-for-byte');
  FOREACH operation IN ARRAY ARRAY['grades','items','releases','audits','snapshots'] LOOP
    PERFORM compat_professor_test.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(baseline->operation) original
      WHERE NOT((compat_professor_test.write_state()->operation) @> jsonb_build_array(original))),
      'P07 historical evidence unchanged: ' || operation);
  END LOOP;
  PERFORM compat_professor_test.assert_true(compat_professor_test.sealed_state()=(SELECT value FROM compat_professor_test.baseline WHERE name='sealed_state'),
    'P07 immutable versions, questions, submissions, selected answers and receipts preserved');
  RAISE NOTICE 'PASS P07: six immutable mutation denials and historical evidence preserved';
END $post$;
ROLLBACK;
DO $rolled_back$ BEGIN
  PERFORM compat_professor_test.assert_true(compat_professor_test.write_state()=(SELECT value FROM compat_professor_test.baseline WHERE name='write_state'),
    'post rollback restored all seeded grading, audit and recovery rows');
END $rolled_back$;
SELECT 'PASS professor post-image cases rolled back';

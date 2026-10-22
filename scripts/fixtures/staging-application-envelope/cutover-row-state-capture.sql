-- READ ONLY staging hlzqmreeoghbldnhlybr; run only after the enforced ingress pause and drain.
-- Emits table counts and digests only. No application rows, identities, credentials or answers.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL TimeZone='UTC';
SET LOCAL DateStyle='ISO, YMD';
SET LOCAL IntervalStyle='postgres';
SET LOCAL extra_float_digits='3';
SET LOCAL bytea_output='hex';
SELECT clock_timestamp() AS captured_at, state AS original_row_state FROM (SELECT jsonb_object_agg(table_name, state ORDER BY table_name COLLATE "C") FROM (
  SELECT 'answer_revisions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."answer_revisions" t
  UNION ALL
  SELECT 'audit_events' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."audit_events" t
  UNION ALL
  SELECT 'email_delivery_events' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."email_delivery_events" t
  UNION ALL
  SELECT 'exam_roster' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."exam_roster" t
  UNION ALL
  SELECT 'exam_versions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."exam_versions" t
  UNION ALL
  SELECT 'exams' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."exams" t
  UNION ALL
  SELECT 'grade_revision_items' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."grade_revision_items" t
  UNION ALL
  SELECT 'grade_revisions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."grade_revisions" t
  UNION ALL
  SELECT 'institutions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."institutions" t
  UNION ALL
  SELECT 'media_upload_intents' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."media_upload_intents" t
  UNION ALL
  SELECT 'owner_identity_corrections' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."owner_identity_corrections" t
  UNION ALL
  SELECT 'owner_key_envelopes' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."owner_key_envelopes" t
  UNION ALL
  SELECT 'privacy_acceptances' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."privacy_acceptances" t
  UNION ALL
  SELECT 'privacy_notice_versions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."privacy_notice_versions" t
  UNION ALL
  SELECT 'proctoring_artifacts' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."proctoring_artifacts" t
  UNION ALL
  SELECT 'proctoring_incidents' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."proctoring_incidents" t
  UNION ALL
  SELECT 'professor_access_requests' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."professor_access_requests" t
  UNION ALL
  SELECT 'questions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."questions" t
  UNION ALL
  SELECT 'recovery_snapshots' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."recovery_snapshots" t
  UNION ALL
  SELECT 'result_email_delivery_events' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."result_email_delivery_events" t
  UNION ALL
  SELECT 'result_releases' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."result_releases" t
  UNION ALL
  SELECT 'room_activations' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."room_activations" t
  UNION ALL
  SELECT 'staff_memberships' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."staff_memberships" t
  UNION ALL
  SELECT 'student_identities' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."student_identities" t
  UNION ALL
  SELECT 'student_sessions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."student_sessions" t
  UNION ALL
  SELECT 'submission_answers' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."submission_answers" t
  UNION ALL
  SELECT 'submission_receipts' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."submission_receipts" t
  UNION ALL
  SELECT 'submissions' AS table_name, jsonb_build_object('rows',count(*),'sha256',encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\n' ORDER BY to_jsonb(t)::text COLLATE "C"),''),'UTF8')),'hex')) AS state
  FROM examination_room_v1."submissions" t
) all_tables) AS rows(state);
COMMIT;

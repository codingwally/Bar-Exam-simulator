-- DISPOSABLE DATABASE TEST PACKAGE ONLY. NOT A STAGING OR PRODUCTION MIGRATION.
-- Inverse is verified only before accepting behavior-dependent writes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $compatibility_package$
BEGIN
  IF current_database() <> 'duediligence_compatibility_fixture' OR current_user <> 'postgres' OR session_user <> 'fixture_bootstrap' OR current_setting('duediligence.compatibility_fixture',true) IS DISTINCT FROM 'isolated-current-capture-20261018' THEN RAISE EXCEPTION 'DISPOSABLE_FIXTURE_REQUIRED'; END IF;
  IF NOT pg_try_advisory_xact_lock(176018, 61018) THEN RAISE EXCEPTION 'COMPATIBILITY_UPDATE_BUSY'; END IF;
  IF NOT (EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_admin(text,uuid,uuid,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='7276e6df45b37831883ca9a28bc3b0731de3b4a312369d1104c81da1ecf513dd' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='6657d93aede10f8a3b4e9d38d389d54dc6ef72f3bc1191d2dcb7f6c0856f9125' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_error(text,text,integer,text)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='92d7ff0cb2d931bbd072df5d349a616965ea7383625ad6d59fd39eca77b137e4' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='63b3bc300c697d001bd2e0fdb51e673c598db03d0b654e2551fd098c42d50d0a' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_record_audit(uuid,uuid,uuid,uuid,text,text,text,uuid,text,timestamp with time zone,jsonb,uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='07190f7fcffa5d8b24ba4165d4c9ad7d09ce506e255712ef15f33f0f3986d4a1' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='538afa7098e32587f056d5dc62a9acaa9aee027c0d3430a73acb236cf3d2b9bd' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_replay(uuid,text,text)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='9f9ad9f65d49b2f89b1239ce8bb4fdce661805ebe3295ac9821ae9bb7c5cbf63' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='f4fd12d2421e2dce70147e3c0886370ab8a581ac44068364effc9b72da1e305e' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.build_publication_manifest(uuid,timestamp with time zone)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='4a3647c6606454793e632d63db70eaef5fbe86700db343f9874fba5885430cc9' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7df2a2721f3fc16a452479e80ae22367ddf8fcc8b995b319c6e0ed97589c67fc' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.creator_authorized(uuid,uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='a473426aa5bf9c2f559d2b509f47f9c082f8b3fed33845b7a0c1260426f4f5b0' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='8aec9542309e1c01b3edc0ea7c7087b73aeeff740b7ee1dff68b3d59abbc9d4c' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.creator_revoke_session(uuid,uuid,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='feb9f9e6e2458b3efe6fb1b4e0d562a2793df99a203618ca0f7b21574bf59e39' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='8f1e280682d1249ab23ad729ff4e8b30a85e9f1e683c4cad4fb7a31fe6b51bdc' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.ensure_exam_current_version_published()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e505d487c7d1ccda4e782b2ffad6d1d19a1d127699632c076af304b55e18bc4c' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ae68b6fb25772eca4ac8a3305a54dd785919c2723ab561b97e6a8dfa3a8b87a0' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.ensure_releasable_grade()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='5d92c026833a7acbbe1cdaa44e9a0088fecafd35f47560fd37ec77ff6987fd21' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='4317f150df2c8cc4eb03433a257996abe5c47d70852e5ce0d14e3248e3788768' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.grader_safe_submission_manifest(jsonb,boolean,text,uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='6de4e7c72329e22dc48a5093cbf3220eeb852e06efc22911a25fbfd5e39a4fb3' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='109b502d1dec6f856243dd1b4c8198f75938edade5f842ce6c8bda0cbea510d8' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.json_rows(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='599e4c83c981a0d4e8c68acf89d3fcceb7af630b6d5c01a8e087e78765d01357' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='917518f0cefe5e2d13674efa53ae121fcb869304a7c28c7cbb7de6652d3f40f8' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.jsonb_sha256(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='f9bce66b9a8f68ce44485ad0b86468d446e2998162927dde38265939a3a15875' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='55d8de4f9ad53e6ead49dd9ffca9ffe0e997ba74226413a2e32d3682bcd1518f' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.lock_request(uuid,text)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='465ef70b0cc6f0b854ddd204231b538b16bb9a8fbadd1126598af1250452ebc9' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='fc0331f880070fc45f1cc378816cee90d46b53d87db2d793b2f3abe6fe5eaadd' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.next_snapshot_sequence(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='bf75198d14a274d23d6a50068655085fad79caad79bd0f1a248c5b7c0d80baa7' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='df2db1d17d7b8f8b45c74e89c6c0374807110419117e28a0b41eeabc15e0c46f' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.normalize_default_student_warning()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='9e2d022da93519b500aada19a4beb3bd692e13fa2c9c49985d02d16f3ff420e7' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7fd42c9b5bb0973d808316fa72c35f1a363cbfd0f2498cd2e21f5f26082e2a08' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.normalized_allowed_emails(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='34198a6304ef9c1f6f92fd4114a00e1d27208c26241fac8149e2a0a5c41c5275' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='d98533d6b194a90694557a31238ab59ce33df632cf7cffb136cb8a9317695222' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_authorized(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='4bb04bfa47a9fa50ec42f2ebb9c47d2af81a9474cc3355fbc5281d231209a474' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='3574c6b327c5378c12f4d953c4862be199eddbe1e7b86b2b3669fac4a2d93205' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_exam_bundle(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='6b13cb369cdb1c3fb4c6369447dcc1225c5e70a06665aa99291487b99027710d' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c19e0e2777efd12e3b3f8199f69d53d598796e16da53f2acb25afbb504a4cabb' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_exam_bundle_before_result_email(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='ca2e687d64c72872aad61523a4fbefe825cbbaad9acd69c9980e0daef12f940a' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e2fda112c6566c56c3f524594b1660b72c1327318f58e937eb33dd8a1326fcd0' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_snapshot_event_bundle(examination_room_v1.recovery_snapshots)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='5d9fe43b12f40a6d3debafbe4c21e1e270b12b8ac5b0fed8e0e4d717da60ef2a' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='fa24e3d243a8d71fd5f22e698b0354c78eb8cac75633c5b84a8bd42159641346' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_snapshot_payload(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='399b06154a8fbaea7081f9116f8cd1d736f6e014aaef12819e9b8ed4e5a1f3df' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a500a81d55b0d81f5718b52c38f90aea86cd58a8fac4d58afb52a7671352bd39' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.prevent_delete()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='c697643b94d1eb985d076daf1f510834e8be39373aae23b659d9778e7e9f3dbf' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2babad1f225eb542c30e632b215bed9bdaf3fe2fb931d6f6c61011306f1489a2' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.prevent_mutation()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='184d4deaa5678a07c26415a01f0ebae0a8b5e160c67245d8be1959cb5e0c5f69' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='af664f1ce37de88d7994bbb4e7e67db2eebfabd3e0f5dc73a4d7dc002791a692' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_email_delivery_event()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='6c37b44db201da9c2740622b36fedc144e1d891e80e2c8bb1444f7f7cf53a72d' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='3ef1a89d75c15671527f4e0fa8bb38925364131becd594241024e16546bc3c51' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_grade_revision_item_set()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e0cd8fd5c9b2c5e0e3756040a60f74b07644c1f6d9cf26c8f7be5167df524b4d' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='b05845daaa070a8696fd2572605107762b6919ddf06da59e32626136e159487b' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_professor_access_request_history()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='6cc89d9726b20f9920a250d59640d6bde0834b78ef83a44b75e02a0c0b1b9d6d' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='659f2beff2f8ba1f6773f650eb120cc515b8ccbc9b4ada30516537da883318d1' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_published_question()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='4773e7cfc9cad7b2e5fc853a70c6bddab5f9f00922f9119f6cf45073bf03a4ff' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='191a7975701371fa890ee878aa5816bba36b9e02cf797a3ec4864739149c08f2' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_recovery_snapshot()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='1fde5878173075071ed8ccd74b1792d9c043c7bdf7055701ce8f7070c1f97739' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='f2259c5dd84c19500d3b98dcf478a0ce1fa80686382d3e4350847618cfa0fe6d' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_staff_membership_history()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='a79aaa26edbe8c60d215554e8f7c7a26c4cedc3a6d953dcde8507dfa78c75da5' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e7263f3cbf7811cd6e13e2f5225dafb6baa00d6d126c7cf849742dcf67fa9b96' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_student_session_binding()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='802b52b6d076c21d36d830a92740fa683af36302809384a6ed0da06de574f40e' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7030894f8c4692b5adb5605d2f9068538ff4814a9d4a041f3bcde091d25f2fed' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_submission_answer_set()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='90466c13788a7d464d08d67d6a3a5b68210883140ab2e57a335f6750d790716c' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c950ba3d5ce84b1590b6be154013ca5abe8c6b12dd9eeea54fbeeee028908f2e' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.queue_grading_snapshot()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e555ae1bbd482820fe834c4ff0806f6fdb52d2b296f593431b5f756168de4d74' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='07758f4327ded35900e2ef3f8b932474d52163e28a546e6a8be450bc08ccc0a7' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.seal_exam_version()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='eb8234aad39b21203994085df20faf3c1744071e8bd05384620593bb51074415' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c9c148a6d6182da7e5f8b8cde3c66de4a4358efbd7332b1e1c9d689a7f77ec71' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.set_snapshot_source()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e861a27c7fe71fe2e37b185cab513947d06ea09138801009864a8d5418502f58' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='5af1c9a737d4a8115e0ab67c3eee489cfe400ed0f7905ab941f34feedccf508e' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.touch_updated_at()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='354fd59c57b17c349514d24ce4a8e4fa8d3d177fb99291c64992d24d617f0e3a' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='92fa7c305a8b856faea0575b27eaa33c1e39952cf9fe87b4c0cbf7d7eab556bd' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.uuid_from_hash(text)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='d0d7dc854b466854f2c982e528e7e65a9de4ee33b4c7dea229a5ee737fcf64bb' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='66a736cf40ccbfc250f8446fbdd7de911585bb37f4da459125b74a2ad2b6e2b1' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.valid_allowed_emails(text[])') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e7be18f5b1812c66834c764b2c65b466b6ebc372b09a888b3b7dc79f76078566' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ba3b55cad702ac3f3fa66745c7815eec5f43444f758d9738284208d082cf6b6a' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.validate_exam_owner()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='f86d20fc206e887476f2363856d60d7c84cff4950362c185be6b434a7f7ca058' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='4c0f0147ebb06f4e457ed09c2f0cea9d1fdd2799d48d1b23037213804672ffc4' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.validate_privacy_acceptance()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='277bca90bee4d10f74b5475c143c36ab7c81fa5c0b6f708d5bfbcb1d7c38051c' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ea0070f61cc42e6de2d0eace5f2708617191d2f0c16086e8b4b73ee9f9439671' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.validate_room_activation()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='8f96672da3ed19d205bd697b255bc8e29b74080a90c4278fa8ca67a91fbed880' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e46e006a39104dd3b5b8045fecd747243d9e366eed30046d5f13643be751762b' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.validate_submission_receipt()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='8a7c5d74463a6c9fe4555b42c271d524ecbead0f59bc613feef222af9f5534a9' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='5aa6cbbae171e04b1a28bf94961759513c804d4fa60db267e03a30c85e7f33bd' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.examination_room_v1_lifecycle_guard(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='5be56ab90978ae40cdd821a7577bbe3ce977f9d6766c95fac4f111c4fbc9677b' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2913cd1f0af99c9a7999ceb93666e3ebacaed79333d33fb3e4e6049eb75c260c' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')) THEN RAISE EXCEPTION 'PROTECTED_DEPENDENCY_CHANGED'; END IF;
  IF (EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_student(text,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='b2f4901d8f02d6bcae1814a117491da061e94c131432e87f82b150e442bda046' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='78c5e72a4ea24b569eea5153ff1e954162427e869fef50cd045ae2b37b909e19' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.prepare_student_admission(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='263b9b20e8132ccaf946045a6512d813365dd42107296c5b0b2e20302a17a397' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7d60faf31d196c7387604eec0077b8d05055f5f5e959b5bf1fb77042041ba7a7' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.recover_existing_student_session(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='c30d7b63e3cec523180fab0d22603d5c49161d430a4d00f88f319e4f181213b1' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='97b566674e6da2b08c522f738b88065650f71c41289730d95aca342a6fccb4ef' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.examination_room_v1_api(text,text,uuid,uuid,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='9fc7ecec84dcada0860b443b3190cbc4bc93c8b6f1642dcb2e077249357b06ad' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7e4a95085b4db167e38fbddc3c02b0edd61502c80c287c7c68fe2cf404f0d23e' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_professor(text,uuid,uuid,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='75e15930ec34a9683791d53eaa380645bffe48c33ee9c5cd1ada618930c5e294' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a6025f0b8a979c2ef01c9d20849de06661a0f664c88e88e319c8de1762be5d78' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_professor_view(text,uuid,uuid,uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='95da22913df65a696f4bd8b003fb286b61df3c8cd1b01fe7144888a6c713c3ca' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c066ab9b3d82c6e34af8897d35f8b97e3ce9af656512c073aac7a9b980f50840' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND to_regprocedure('examination_room_v1.apply_open_room_lease()') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='examination_room_v1.student_sessions'::regclass AND tgname='student_sessions_open_room_lease')) THEN RETURN; END IF;
  IF NOT (EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_student(text,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='d9bb3bddf9c530971a3d437cc4123ab25939d9ec1800bac91b1bb6436ae27232' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='208cb22b1c0f242a2909c17ac52823834f095455c0cb7b17e3f396bd47584ef2' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.prepare_student_admission(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='d4bb7260b80243609f4209ac647be2fb19773913b739da4944f46f7e9fabfde2' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='f549672b37b6e9b79199217fcbc5a296d1a887584cb6a0033740687676292436' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.recover_existing_student_session(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='3e33651ef89d43e27b5a69783034e7351614bbbf560136f7318cff59c49ec4b9' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='f3a32fc71102eac5c83553d83c97238928c5ea603a6097b7a057c4d45eb0dfb6' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.examination_room_v1_api(text,text,uuid,uuid,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='8bbcaebcee32d2faca6f6c3e029b8480e8ac8af5c9ab0e8e72715c7a0050ede7' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c0c64ae2a57554badd6bb2ba8046dde8ea4ee58c01ea200e50333c2dbf1fdae1' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_professor(text,uuid,uuid,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='5113e63f861843751dd22a8639604daf5b1b02a073df718aa91e24b7428c7493' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='bee4776a358980d92785303cae1b1205010745c278b429ff1a15c2dbd3a330ce' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_professor_view(text,uuid,uuid,uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='f68eb2a60edd19af46c61ad8fabc8b3bc4084b795622d874841ab38dad3e97ce' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='429f80a433e1bdfdec1fe7044f86bf82db0c1e1794e3abce68b7099cd183f5b4' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.apply_open_room_lease()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='f724efdff5bd3cde6cdd051a90931905049582cc52c6a47d3bd7ed6cd8a6e216' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='96f1008c13e0a2eca0fbbdd0bd11dd6f8ff8c9e48e892f7df3f0aeac6bdf3b9d' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='examination_room_v1.student_sessions'::regclass AND tgname='student_sessions_open_room_lease' AND tgenabled='O' AND NOT tgisinternal AND pg_get_triggerdef(oid)='CREATE TRIGGER student_sessions_open_room_lease BEFORE INSERT ON examination_room_v1.student_sessions FOR EACH ROW EXECUTE FUNCTION examination_room_v1.apply_open_room_lease()')) THEN RAISE EXCEPTION 'UNKNOWN_OR_PARTIAL_PACKAGE_PREIMAGE'; END IF;
  EXECUTE 'CREATE OR REPLACE FUNCTION examination_room_v1.api_student(p_operation text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''pg_catalog''
AS $function$
#variable_conflict use_variable
declare
  institution_id uuid;
  exam_id uuid;
  exam_version_id uuid;
  activation_id uuid;
  roster_id uuid;
  student_identity_id uuid;
  session_id uuid;
  submission_id uuid;
  question_id uuid;
  answer_revision_id uuid;
  notice_version_id uuid;
  activation_status text;
  session_status text;
  notice_code text;
  full_name text;
  student_number text;
  grading_alias text;
  subject_name text;
  year_level text;
  professor_name text;
  request_hash text;
  audit_request_hash text;
  session_token_hash text;
  stored_token_hash text;
  publication_hash text;
  integrity_tier text;
  controls_payload jsonb;
  publication_manifest jsonb;
  submission_manifest jsonb;
  response jsonb;
  replay jsonb;
  answer_item jsonb;
  answer_selection jsonb;
  result_manifest jsonb;
  lifecycle_result jsonb;
  activation_opens_at timestamptz;
  activation_closes_at timestamptz;
  lease_expires_at timestamptz;
  occurred_at timestamptz;
  duration_seconds integer;
  extra_minutes integer;
  maximum_sessions integer;
  next_revision integer;
  expected_count integer;
  matched_count integer;
  affected_count integer;
  recording_required boolean;
  recording_accepted boolean;
  accepted_at timestamptz;
  accepted_features jsonb;
  expected_question_type text;
begin
  if p_operation in (''preview'', ''consent'') then
    select
      a.id,
      a.institution_id,
      a.exam_id,
      a.exam_version_id,
      a.activation_status,
      a.opens_at,
      a.closes_at,
      a.max_sessions,
      v.controls,
      v.publication_manifest,
      v.content_sha256,
      v.duration_seconds,
      v.privacy_notice_version_id,
      n.notice_code,
      er.id,
      er.student_identity_id,
      si.full_name,
      si.external_student_id,
      er.grading_alias,
      er.accommodations ->> ''subject'',
      er.accommodations ->> ''yearLevel'',
      coalesce((er.accommodations ->> ''extraMinutes'')::integer, 0),
      sm.display_name
    into
      activation_id,
      institution_id,
      exam_id,
      exam_version_id,
      activation_status,
      activation_opens_at,
      activation_closes_at,
      maximum_sessions,
      controls_payload,
      publication_manifest,
      publication_hash,
      duration_seconds,
      notice_version_id,
      notice_code,
      roster_id,
      student_identity_id,
      full_name,
      student_number,
      grading_alias,
      subject_name,
      year_level,
      extra_minutes,
      professor_name
    from examination_room_v1.room_activations a
    join examination_room_v1.exam_versions v on v.id = a.exam_version_id
    join examination_room_v1.exams e on e.id = a.exam_id
    join examination_room_v1.privacy_notice_versions n on n.id = v.privacy_notice_version_id
    join examination_room_v1.exam_roster er on er.exam_id = a.exam_id and er.roster_status in (''invited'', ''eligible'', ''completed'')
    join examination_room_v1.student_identities si on si.id = er.student_identity_id and si.identity_status = ''active''
    left join lateral (
      select m.display_name
      from examination_room_v1.staff_memberships m
      where m.institution_id = a.institution_id
        and m.user_id = e.owner_user_id
        and m.membership_status = ''active''
      order by (m.staff_role = ''professor'') desc, m.granted_at desc
      limit 1
    ) sm on true
    where a.key_hash = p_payload ->> ''roomKeyHash''
      and a.activation_status in (''scheduled'', ''open'')
      and a.closes_at > clock_timestamp()
      and upper(si.external_student_id) = upper(p_payload #>> ''{identity,studentNumber}'')
      and lower(btrim(si.full_name)) = lower(btrim(p_payload #>> ''{identity,realName}''))
      and lower(btrim(er.accommodations ->> ''subject'')) = lower(btrim(p_payload #>> ''{identity,subject}''))
      and lower(btrim(er.accommodations ->> ''yearLevel'')) = lower(btrim(p_payload #>> ''{identity,yearLevel}''))
    order by a.created_at desc
    limit 1;

    if activation_id is null then
      if exists (
        select 1
        from examination_room_v1.room_activations a
        where a.key_hash = p_payload ->> ''roomKeyHash''
          and a.activation_status in (''scheduled'', ''open'')
          and a.closes_at > clock_timestamp()
      ) then
        return examination_room_v1.api_error(
          ''STUDENT_IDENTITY_INVALID'', ''The entered identity does not exactly match the examination roster.'', 400,
          ''Use the complete registered name, student number, subject, and year level.''
        );
      end if;
      return examination_room_v1.api_error(
        ''ROOM_KEY_INVALID'', ''The room key is expired, revoked, or not recognized.'', 401,
        ''Copy the complete current key from the administrator message and try again.''
      );
    end if;

    lifecycle_result := public.examination_room_v1_lifecycle_guard(exam_id);
    if lifecycle_result ->> ''ok'' <> ''true'' then
      return lifecycle_result;
    end if;

    if p_operation = ''preview'' then
      select jsonb_build_object(
        ''ok'', true,
        ''metadata'', jsonb_build_object(
          ''examId'', e.id,
          ''title'', e.title,
          ''subject'', subject_name,
          ''yearLevel'', year_level,
          ''durationMinutes'', duration_seconds / 60,
          ''startsAt'', controls_payload -> ''startsAt'',
          ''professor'', coalesce(professor_name, ''Professor''),
          ''questionCount'', jsonb_array_length(publication_manifest -> ''questions''),
          ''integrityTier'', coalesce(controls_payload ->> ''integrityTier'', ''standard''),
          ''cameraRequired'', coalesce((controls_payload ->> ''cameraRequired'')::boolean, false),
          ''microphoneRequired'', coalesce((controls_payload ->> ''microphoneRequired'')::boolean, false),
          ''privacyNoticeVersion'', notice_code,
          ''privacyController'', coalesce(controls_payload ->> ''privacyController'', ''''),
          ''retentionSummary'', coalesce(controls_payload ->> ''retentionSummary'', ''''),
          ''activationStatus'', activation_status,
          ''safeguards'', jsonb_build_array(
            ''Fullscreen may be requested by the examination settings.'',
            ''Focus and connection changes are recorded for professor review.'',
            ''Browser signals are review evidence, not automatic proof of misconduct.''
          )
        ),
        ''identity'', jsonb_build_object(
          ''fullName'', full_name,
          ''studentNumber'', student_number,
          ''yearLevel'', year_level
        ),
        ''notice'', jsonb_build_object(
          ''version'', n.notice_code,
          ''title'', n.title,
          ''body'', n.notice_body,
          ''purposes'', n.processing_purposes
        )
      )
      into response
      from examination_room_v1.exams e
      join examination_room_v1.privacy_notice_versions n on n.id = notice_version_id
      where e.id = exam_id;
      return response;
    end if;

    -- Consent creation and capacity checks serialize on the chosen activation;
    -- read-only previews never take this shared hot-row lock.
    perform 1
    from examination_room_v1.room_activations a
    where a.id = activation_id
    for update;
    perform 1
    from examination_room_v1.exam_roster er
    where er.id = roster_id
    for update;

    request_hash := p_payload ->> ''requestHash'';
    session_token_hash := p_payload ->> ''sessionTokenHash'';
    recording_required := coalesce(controls_payload ->> ''integrityTier'', ''standard'') = ''recorded_proctoring''
      or coalesce((controls_payload ->> ''cameraRequired'')::boolean, false)
      or coalesce((controls_payload ->> ''microphoneRequired'')::boolean, false);
    recording_accepted := coalesce((p_payload #>> ''{consent,recordingAccepted}'')::boolean, false);

    if activation_status <> ''open'' or clock_timestamp() < activation_opens_at then
      return examination_room_v1.api_error(
        ''ROOM_NOT_OPEN'', ''The professor has not opened this examination room yet.'', 409,
        ''Wait for the professor to open the room, then choose Agree and begin again.''
      );
    end if;
    if p_payload #>> ''{consent,noticeVersion}'' <> notice_code
       or not coalesce((p_payload #>> ''{consent,accepted}'')::boolean, false) then
      return examination_room_v1.api_error(
        ''PRIVACY_CONSENT_VERSION_MISMATCH'', ''Consent must accept the exact current privacy notice.'', 412,
        ''Review the current notice shown on screen and agree again.''
      );
    end if;
    if recording_required and not recording_accepted then
      return examination_room_v1.api_error(
        ''RECORDING_CONSENT_REQUIRED'', ''This examination requires separate recording consent.'', 412,
        ''Agree to recording or ask the professor for another permitted arrangement.''
      );
    end if;

    replay := examination_room_v1.api_replay(institution_id, request_hash, ''student.consent'');
    if replay is not null then
      if replay ->> ''ok'' = ''false'' then return replay; end if;
      select s.id, s.session_token_hash
      into session_id, stored_token_hash
      from examination_room_v1.student_sessions s
      where s.consent_request_hash = request_hash
        and s.activation_id = activation_id
        and s.roster_id = roster_id
      for update;
      if session_id is null then
        return examination_room_v1.api_error(
          ''CONSENT_REPLAY_INVALID'', ''The prior consent receipt cannot be recovered.'', 409,
          ''Return to the join page and create a new consent request.''
        );
      end if;
      if stored_token_hash <> session_token_hash then
        update examination_room_v1.student_sessions s
        set session_token_hash = session_token_hash
        where s.id = session_id;
      end if;
      select v.publication_manifest, v.content_sha256
      into publication_manifest, publication_hash
      from examination_room_v1.student_sessions s
      join examination_room_v1.exam_versions v on v.id = s.exam_version_id
      where s.id = session_id;
      replay := replay || jsonb_build_object(
        ''publicationManifest'', publication_manifest,
        ''publicationHash'', publication_hash
      );
      return replay;
    end if;

    if maximum_sessions is not null
       and (select count(*) from examination_room_v1.student_sessions s where s.activation_id = activation_id) >= maximum_sessions then
      return examination_room_v1.api_error(
        ''ROOM_SESSION_LIMIT_REACHED'', ''This room has reached its configured session limit.'', 409,
        ''Ask the professor or administrator to review the room capacity.''
      );
    end if;
    if exists (
      select 1 from examination_room_v1.student_sessions s
      where s.activation_id = activation_id and s.roster_id = roster_id
    ) then
      return examination_room_v1.api_error(
        ''SESSION_ALREADY_EXISTS'', ''A session already exists for this student and room.'', 409,
        ''Resume the existing session with its issued session token.''
      );
    end if;

    session_id := gen_random_uuid();
    lease_expires_at := least(
      activation_closes_at,
      clock_timestamp() + make_interval(secs => duration_seconds + extra_minutes * 60)
    );
    insert into examination_room_v1.student_sessions (
      id, activation_id, exam_id, institution_id, exam_version_id, roster_id,
      session_token_hash, consent_request_hash, client_instance_id, session_status,
      identity_verified_at, identity_verification_method, started_at,
      last_heartbeat_at, lease_expires_at, session_metadata
    ) values (
      session_id,
      activation_id,
      exam_id,
      institution_id,
      exam_version_id,
      roster_id,
      session_token_hash,
      request_hash,
      (p_payload ->> ''clientInstanceId'')::uuid,
      ''active'',
      clock_timestamp(),
      ''room_key_roster_match'',
      clock_timestamp(),
      clock_timestamp(),
      lease_expires_at,
      jsonb_build_object(''connected'', true, ''currentQuestion'', 1)
    );

    insert into examination_room_v1.privacy_acceptances (
      notice_version_id, roster_id, session_id, exam_version_id, client_event_id,
      decision, accepted_features, evidence_sha256, capture_method, recorded_at
    ) values (
      notice_version_id,
      roster_id,
      session_id,
      exam_version_id,
      (p_payload ->> ''clientEventId'')::uuid,
      ''accepted'',
      jsonb_build_object(
        ''recordingAccepted'', recording_accepted,
        ''cameraRequired'', coalesce((controls_payload ->> ''cameraRequired'')::boolean, false),
        ''microphoneRequired'', coalesce((controls_payload ->> ''microphoneRequired'')::boolean, false),
        ''integrityTier'', coalesce(controls_payload ->> ''integrityTier'', ''standard'')
      ),
      request_hash,
      ''checkbox'',
      (p_payload #>> ''{consent,acceptedAt}'')::timestamptz
    );

    response := jsonb_build_object(
      ''ok'', true,
      ''session'', jsonb_build_object(
        ''id'', session_id,
        ''status'', ''active'',
        ''startedAt'', clock_timestamp(),
        ''leaseExpiresAt'', lease_expires_at,
        ''anonymousCandidateId'', grading_alias
      ),
      ''publicationManifest'', publication_manifest,
      ''publicationHash'', publication_hash
    );
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, ''student'', ''student.consent'',
      ''student_session'', session_id, request_hash, clock_timestamp(), response,
      (p_payload ->> ''clientEventId'')::uuid
    );
    return response;
  end if;

  session_id := nullif(p_payload ->> ''sessionId'', '''')::uuid;
  session_token_hash := p_payload ->> ''sessionTokenHash'';
  select
    s.institution_id,
    s.exam_id,
    s.exam_version_id,
    s.activation_id,
    s.roster_id,
    er.student_identity_id,
    s.session_status,
    s.lease_expires_at,
    a.activation_status,
    a.opens_at,
    a.closes_at,
    v.controls,
    v.publication_manifest,
    v.content_sha256,
    v.privacy_notice_version_id,
    n.notice_code,
    si.full_name,
    si.external_student_id,
    er.grading_alias,
    er.accommodations ->> ''subject'',
    er.accommodations ->> ''yearLevel''
  into
    institution_id,
    exam_id,
    exam_version_id,
    activation_id,
    roster_id,
    student_identity_id,
    session_status,
    lease_expires_at,
    activation_status,
    activation_opens_at,
    activation_closes_at,
    controls_payload,
    publication_manifest,
    publication_hash,
    notice_version_id,
    notice_code,
    full_name,
    student_number,
    grading_alias,
    subject_name,
    year_level
  from examination_room_v1.student_sessions s
  join examination_room_v1.room_activations a on a.id = s.activation_id
  join examination_room_v1.exam_versions v on v.id = s.exam_version_id
  join examination_room_v1.privacy_notice_versions n on n.id = v.privacy_notice_version_id
  join examination_room_v1.exam_roster er on er.id = s.roster_id
  join examination_room_v1.student_identities si on si.id = er.student_identity_id
  where s.id = session_id
    and s.session_token_hash = session_token_hash
  for update of s;

  if institution_id is null then
    return examination_room_v1.api_error(
      ''SESSION_INVALID'', ''The examination session could not be verified.'', 401,
      ''Return to the join page and enter the same room key and student details.''
    );
  end if;

  if p_operation = ''result'' and session_status = ''revoked'' then
    return examination_room_v1.api_error(
      ''SESSION_REVOKED'', ''This examination credential has been revoked.'', 401,
      ''Ask the examination administrator to review access to the released result.''
    );
  end if;

  if p_operation in (''resume'', ''session_context'') then
    select jsonb_build_object(
      ''ok'', true,
      ''session'', jsonb_build_object(
        ''id'', s.id,
        ''status'', s.session_status,
        ''startedAt'', s.started_at,
        ''lastHeartbeatAt'', s.last_heartbeat_at,
        ''leaseExpiresAt'', s.lease_expires_at,
        ''submittedAt'', s.ended_at
      ),
      ''publicationManifest'', publication_manifest,
      ''publicationHash'', publication_hash,
      ''studentIdentity'', jsonb_build_object(
        ''realName'', full_name,
        ''studentNumber'', student_number,
        ''subject'', subject_name,
        ''yearLevel'', year_level
      ),
      ''privacyConsent'', consent.item,
      ''answerRevisions'', coalesce(answers.items, ''[]''::jsonb),
      ''nextRevisionByQuestion'', coalesce(answers.next_revisions, ''{}''::jsonb),
      ''anonymousCandidateId'', grading_alias
    )
    into response
    from examination_room_v1.student_sessions s
    left join lateral (
      select jsonb_build_object(
        ''noticeVersion'', notice_code,
        ''accepted'', true,
        ''acceptedAt'', to_char(pa.recorded_at at time zone ''UTC'', ''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"''),
        ''recordingAccepted'', coalesce((pa.accepted_features ->> ''recordingAccepted'')::boolean, false)
      ) as item
      from examination_room_v1.privacy_acceptances pa
      where pa.session_id = s.id
        and pa.decision = ''accepted''
        and not exists (
          select 1 from examination_room_v1.privacy_acceptances withdrawal
          where withdrawal.prior_acceptance_id = pa.id and withdrawal.decision = ''withdrawn''
        )
      order by pa.recorded_at desc
      limit 1
    ) consent on true
    left join lateral (
      with latest as (
        select distinct on (ar.question_id)
          ar.question_id,
          ar.answer_payload,
          ar.idempotency_key_hash,
          ar.revision_number
        from examination_room_v1.answer_revisions ar
        where ar.session_id = s.id
        order by ar.question_id, ar.revision_number desc
      ), next_values as (
        select q.question_key, coalesce(max(ar.revision_number), 0) + 1 as next_revision
        from examination_room_v1.questions q
        left join examination_room_v1.answer_revisions ar
          on ar.question_id = q.id and ar.session_id = s.id
        where q.exam_version_id = s.exam_version_id
        group by q.question_key
      )
      select
        coalesce((
          select jsonb_agg(
            latest.answer_payload || jsonb_build_object(''idempotencyKey'', latest.idempotency_key_hash)
            order by q.position
          )
          from latest
          join examination_room_v1.questions q on q.id = latest.question_id
        ), ''[]''::jsonb) as items,
        coalesce((select jsonb_object_agg(next_values.question_key, next_values.next_revision) from next_values), ''{}''::jsonb) as next_revisions
    ) answers on true
    where s.id = session_id;

    if p_operation = ''session_context'' and response -> ''privacyConsent'' = ''null''::jsonb then
      return examination_room_v1.api_error(
        ''PRIVACY_CONSENT_REQUIRED'', ''The exact current privacy consent is missing or withdrawn.'', 412,
        ''Return to the join page and review the current notice.''
      );
    end if;
    return response;
  end if;

  if p_operation = ''result'' then
    select rr.release_manifest
    into result_manifest
    from examination_room_v1.submissions sub
    join examination_room_v1.result_releases rr
      on rr.submission_id = sub.id and rr.release_action = ''release''
    where sub.session_id = session_id
      and not exists (
        select 1 from examination_room_v1.result_releases revoked
        where revoked.supersedes_release_id = rr.id and revoked.release_action = ''revoke''
      )
    order by rr.occurred_at desc
    limit 1;

    if result_manifest is null then
      return jsonb_build_object(''ok'', true, ''available'', false, ''status'', ''awaiting_release'');
    end if;
    return jsonb_build_object(
      ''ok'', true,
      ''available'', true,
      ''releasedAt'', result_manifest -> ''releasedAt'',
      ''result'', result_manifest -> ''result''
    );
  end if;

  if p_operation in (''heartbeat'', ''record_event'', ''save_answer'', ''submit'')
     and not exists (
       select 1
       from examination_room_v1.privacy_acceptances pa
       where pa.session_id = session_id
         and pa.notice_version_id = notice_version_id
         and pa.decision = ''accepted''
         and not exists (
           select 1
           from examination_room_v1.privacy_acceptances withdrawn
           where withdrawn.prior_acceptance_id = pa.id
             and withdrawn.decision = ''withdrawn''
         )
     ) then
    return examination_room_v1.api_error(
      ''PRIVACY_CONSENT_REQUIRED'', ''The exact current privacy consent is missing or withdrawn.'', 412,
      ''Return to the join page and review the current notice.''
    );
  end if;

  request_hash := p_payload ->> ''requestHash'';
  audit_request_hash := case
    when p_operation = ''submit'' then
      encode(extensions.digest(request_hash || '':student.submit'', ''sha256''), ''hex'')
    else request_hash
  end;

  replay := examination_room_v1.api_replay(
    institution_id,
    audit_request_hash,
    ''student.'' || p_operation
  );

  if replay is null
     and p_operation = ''submit''
     and exists (
       select 1
       from examination_room_v1.audit_events legacy
       where legacy.institution_id = institution_id
         and legacy.request_hash = request_hash
         and legacy.event_type = ''student.submit''
     ) then
    replay := examination_room_v1.api_replay(
      institution_id,
      request_hash,
      ''student.submit''
    );
  end if;

  if replay is not null then
    if p_operation = ''submit'' and replay ->> ''ok'' = ''true'' then
      return jsonb_set(replay, ''{duplicate}'', ''true''::jsonb, true);
    end if;
    return replay;
  end if;

  if session_status not in (''created'', ''active'')
     or lease_expires_at <= clock_timestamp()
     or activation_status <> ''open''
     or clock_timestamp() > activation_closes_at then
    return examination_room_v1.api_error(
      ''SESSION_NOT_ACTIVE'', ''This examination session is no longer active.'', 409,
      ''Reconnect or ask the professor to review the session. Server-backed answers remain preserved.''
    );
  end if;

  occurred_at := coalesce((p_payload ->> ''occurredAt'')::timestamptz, clock_timestamp());

  if p_operation = ''heartbeat'' then
    update examination_room_v1.student_sessions s
    set last_heartbeat_at = greatest(coalesce(s.last_heartbeat_at, s.started_at), occurred_at),
        session_metadata = s.session_metadata || jsonb_build_object(
          ''connected'', coalesce((p_payload ->> ''connected'')::boolean, true),
          ''currentQuestion'', coalesce((p_payload ->> ''currentQuestion'')::integer, 1)
        )
    where s.id = session_id;
    response := jsonb_build_object(
      ''ok'', true,
      ''sessionId'', session_id,
      ''receivedAt'', clock_timestamp(),
      ''connected'', coalesce((p_payload ->> ''connected'')::boolean, true)
    );
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, ''student'', ''student.heartbeat'',
      ''student_session'', session_id, request_hash, occurred_at, response,
      (p_payload ->> ''clientEventId'')::uuid
    );
    return response;
  end if;

  if p_operation = ''record_event'' then
    insert into examination_room_v1.proctoring_incidents (
      session_id, client_event_id, incident_kind, source, severity,
      occurred_at, duration_ms, details
    ) values (
      session_id,
      (p_payload ->> ''clientEventId'')::uuid,
      p_payload ->> ''incidentKind'',
      ''browser_signal'',
      coalesce(p_payload ->> ''severity'', ''info''),
      occurred_at,
      nullif(p_payload ->> ''durationMs'', '''')::integer,
      coalesce(p_payload -> ''details'', ''{}''::jsonb)
    )
    returning id into answer_revision_id;
    response := jsonb_build_object(''ok'', true, ''incidentId'', answer_revision_id, ''recordedAt'', clock_timestamp());
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, ''student'', ''student.record_event'',
      ''proctoring_incident'', answer_revision_id, request_hash, occurred_at, response,
      (p_payload ->> ''clientEventId'')::uuid
    );
    return response;
  end if;

  if p_operation = ''save_answer'' then
    if not exists (
      select 1
      from examination_room_v1.privacy_acceptances pa
      where pa.session_id = session_id
        and pa.notice_version_id = notice_version_id
        and pa.decision = ''accepted''
        and not exists (
          select 1 from examination_room_v1.privacy_acceptances withdrawn
          where withdrawn.prior_acceptance_id = pa.id and withdrawn.decision = ''withdrawn''
        )
    ) then
      return examination_room_v1.api_error(
        ''PRIVACY_CONSENT_REQUIRED'', ''The exact current privacy consent is missing or withdrawn.'', 412,
        ''Return to the join page and review the current notice.''
      );
    end if;

    answer_item := p_payload -> ''answerRevision'';
    select q.id, coalesce(q.configuration ->> ''type'', replace(q.question_kind, ''_'', ''-''))
    into question_id, expected_question_type
    from examination_room_v1.questions q
    where q.exam_version_id = exam_version_id
      and q.position = (answer_item ->> ''questionNumber'')::integer
      and q.question_key = answer_item ->> ''questionKey'';
    if question_id is null
       or (answer_item ->> ''attemptId'')::uuid <> session_id
       or (answer_item ->> ''examinationId'')::uuid <> exam_id
       or coalesce((answer_item ->> ''examinationVersion'')::integer, -1) <> (publication_manifest ->> ''version'')::integer
       or answer_item ->> ''questionType'' <> expected_question_type
       or answer_item ->> ''publicationHash'' <> publication_hash then
      return examination_room_v1.api_error(
        ''ANSWER_BINDING_MISMATCH'', ''The answer does not belong to this exact examination session and version.'', 409,
        ''Refresh the examination. Your other saved answers remain preserved.''
      );
    end if;
    select coalesce(max(ar.revision_number), 0) + 1
    into next_revision
    from examination_room_v1.answer_revisions ar
    where ar.session_id = session_id and ar.question_id = question_id;
    if (answer_item ->> ''revision'')::integer <> next_revision then
      return examination_room_v1.api_error(
        ''ANSWER_REVISION_CONFLICT'', ''A newer answer revision already exists for this question.'', 409,
        ''Refresh the saved answer state, then save again.''
      );
    end if;

    answer_revision_id := gen_random_uuid();
    insert into examination_room_v1.answer_revisions (
      id, session_id, exam_version_id, question_id, revision_number,
      client_revision_id, idempotency_key_hash, answer_format, answer_payload,
      answer_sha256, is_flagged, source, saved_at
    ) values (
      answer_revision_id,
      session_id,
      exam_version_id,
      question_id,
      next_revision,
      (p_payload ->> ''clientEventId'')::uuid,
      request_hash,
      case
        when answer_item ->> ''questionType'' = ''multiple-choice'' then ''choice''
        when answer_item ->> ''questionType'' = ''true-false'' then ''boolean''
        else ''plain_text''
      end,
      answer_item,
      p_payload ->> ''answerHash'',
      coalesce((p_payload ->> ''flagged'')::boolean, false),
      coalesce(p_payload ->> ''source'', ''autosave''),
      (p_payload ->> ''savedAt'')::timestamptz
    );
    response := jsonb_build_object(
      ''ok'', true,
      ''revision'', jsonb_build_object(
        ''id'', answer_revision_id,
        ''questionKey'', answer_item ->> ''questionKey'',
        ''revision'', next_revision,
        ''savedAt'', p_payload -> ''savedAt'',
        ''flagged'', coalesce((p_payload ->> ''flagged'')::boolean, false)
      )
    );
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, ''student'', ''student.save_answer'',
      ''answer_revision'', answer_revision_id, request_hash,
      (p_payload ->> ''savedAt'')::timestamptz, response,
      (p_payload ->> ''clientEventId'')::uuid
    );
    return response;
  end if;

  if p_operation = ''submit'' then
    submission_manifest := p_payload -> ''submissionManifest'';

    select pa.recorded_at, pa.accepted_features
    into accepted_at, accepted_features
    from examination_room_v1.privacy_acceptances pa
    where pa.session_id = session_id
      and pa.notice_version_id = notice_version_id
      and pa.decision = ''accepted''
      and not exists (
        select 1
        from examination_room_v1.privacy_acceptances withdrawn
        where withdrawn.prior_acceptance_id = pa.id
          and withdrawn.decision = ''withdrawn''
      )
    order by pa.recorded_at desc
    limit 1;

    if coalesce(submission_manifest ->> ''schemaVersion'', '''') <> ''examination-room/submission/v1''
       or (submission_manifest ->> ''attemptId'')::uuid <> session_id
       or (submission_manifest ->> ''examinationId'')::uuid <> exam_id
       or coalesce((submission_manifest ->> ''examinationVersion'')::integer, -1) <> (publication_manifest ->> ''version'')::integer
       or submission_manifest ->> ''publicationHash'' <> publication_hash
       or submission_manifest ->> ''identityMode'' <> coalesce(controls_payload ->> ''identityMode'', ''real_names'')
       or submission_manifest -> ''studentIdentity'' is distinct from jsonb_build_object(
         ''realName'', full_name,
         ''studentNumber'', student_number,
         ''subject'', subject_name,
         ''yearLevel'', year_level
       )
       or submission_manifest -> ''gradingIdentity'' is distinct from (case
         when coalesce(controls_payload ->> ''identityMode'', ''real_names'') = ''anonymous_grading'' then
           jsonb_build_object(''mode'', ''anonymous_grading'', ''anonymousCandidateId'', grading_alias)
         else
           jsonb_build_object(''mode'', ''real_names'', ''displayName'', full_name, ''studentNumber'', student_number)
       end)
       or submission_manifest #>> ''{privacyConsent,noticeVersion}'' <> notice_code
       or not coalesce((submission_manifest #>> ''{privacyConsent,accepted}'')::boolean, false) then
      return examination_room_v1.api_error(
        ''SUBMISSION_BINDING_MISMATCH'', ''The submission does not match this exact session, publication, and consent.'', 409,
        ''Reconnect to the examination and submit the server-backed answers again.''
      );
    end if;

    if submission_manifest -> ''privacyConsent'' is distinct from jsonb_build_object(
         ''noticeVersion'', notice_code,
         ''accepted'', true,
         ''acceptedAt'', to_char(accepted_at at time zone ''UTC'', ''YYYY-MM-DD"T"HH24:MI:SS.MS"Z"''),
         ''recordingAccepted'', coalesce((accepted_features ->> ''recordingAccepted'')::boolean, false)
       ) then
      return examination_room_v1.api_error(
        ''SUBMISSION_CONSENT_MISMATCH'', ''The submission consent evidence does not match the immutable server receipt.'', 409,
        ''Reconnect to the examination and submit the server-backed consent receipt again.''
      );
    end if;

    if not exists (
      select 1
      from examination_room_v1.privacy_acceptances pa
      where pa.session_id = session_id
        and pa.notice_version_id = notice_version_id
        and pa.decision = ''accepted''
        and not exists (
          select 1 from examination_room_v1.privacy_acceptances withdrawn
          where withdrawn.prior_acceptance_id = pa.id and withdrawn.decision = ''withdrawn''
        )
    ) then
      return examination_room_v1.api_error(
        ''PRIVACY_CONSENT_REQUIRED'', ''The exact current privacy consent is missing or withdrawn.'', 412,
        ''Return to the join page and review the current notice.''
      );
    end if;

    expected_count := jsonb_array_length(coalesce(p_payload -> ''answerSelections'', ''[]''::jsonb));
    if expected_count <> (select count(*) from examination_room_v1.questions q where q.exam_version_id = exam_version_id)
       or expected_count <> jsonb_array_length(coalesce(submission_manifest -> ''questions'', ''[]''::jsonb))
       or coalesce((submission_manifest ->> ''questionCount'')::integer, -1) <> expected_count
       or coalesce((submission_manifest ->> ''maxPoints'')::numeric, -1) <>
          (select coalesce(sum(q.points), 0) from examination_room_v1.questions q where q.exam_version_id = exam_version_id) then
      return examination_room_v1.api_error(
        ''SUBMISSION_ANSWER_MISSING'', ''Every question must have one saved answer revision before submission.'', 400,
        ''Return to the listed question, save an answer, then submit again.''
      );
    end if;

    select count(*)::integer
    into matched_count
    from jsonb_array_elements(p_payload -> ''answerSelections'') selected(value)
    join examination_room_v1.questions q
      on q.exam_version_id = exam_version_id
     and q.position = (selected.value ->> ''questionNumber'')::integer
     and q.question_key = selected.value ->> ''questionKey''
    join examination_room_v1.answer_revisions ar
      on ar.session_id = session_id
     and ar.question_id = q.id
     and ar.revision_number = (selected.value ->> ''revision'')::integer
    join lateral (
      select manifest_question.value
      from jsonb_array_elements(submission_manifest -> ''questions'') manifest_question(value)
      where (manifest_question.value ->> ''questionNumber'')::integer = q.position
        and manifest_question.value ->> ''questionKey'' = q.question_key
        and (manifest_question.value ->> ''revision'')::integer = ar.revision_number
        and manifest_question.value -> ''answer'' = ar.answer_payload -> ''answer''
    ) bound on true;

    if matched_count <> expected_count then
      return examination_room_v1.api_error(
        ''ANSWER_BINDING_MISMATCH'', ''One or more submitted answers does not match its saved server revision.'', 409,
        ''Refresh the saved-answer state and submit again.''
      );
    end if;

    submission_id := (submission_manifest ->> ''submissionId'')::uuid;
    insert into examination_room_v1.submissions (
      id, session_id, exam_version_id, idempotency_key_hash, manifest_sha256,
      submission_manifest, answer_count, submitted_at_client
    ) values (
      submission_id,
      session_id,
      exam_version_id,
      request_hash,
      p_payload ->> ''manifestHash'',
      submission_manifest,
      expected_count,
      (submission_manifest ->> ''submittedAt'')::timestamptz
    );

    for answer_selection in select value from jsonb_array_elements(p_payload -> ''answerSelections'')
    loop
      select q.id, ar.id
      into question_id, answer_revision_id
      from examination_room_v1.questions q
      join examination_room_v1.answer_revisions ar
        on ar.question_id = q.id
       and ar.session_id = session_id
       and ar.revision_number = (answer_selection ->> ''revision'')::integer
      where q.exam_version_id = exam_version_id
        and q.position = (answer_selection ->> ''questionNumber'')::integer
        and q.question_key = answer_selection ->> ''questionKey'';
      insert into examination_room_v1.submission_answers (
        submission_id, session_id, question_id, answer_revision_id
      ) values (
        submission_id, session_id, question_id, answer_revision_id
      );
    end loop;

    insert into examination_room_v1.submission_receipts (
      submission_id, receipt_sha256, receipt_payload
    ) values (
      submission_id,
      p_payload ->> ''manifestHash'',
      jsonb_build_object(
        ''schemaVersion'', ''examination-room/submission-receipt/v1'',
        ''submissionId'', submission_id,
        ''manifestHash'', p_payload ->> ''manifestHash'',
        ''answerCount'', expected_count,
        ''receivedAt'', clock_timestamp()
      )
    ) returning id into answer_revision_id;

    update examination_room_v1.student_sessions s
    set session_status = ''submitted'', ended_at = clock_timestamp()
    where s.id = session_id;
    update examination_room_v1.exam_roster er
    set roster_status = ''completed''
    where er.id = roster_id;

    insert into examination_room_v1.recovery_snapshots (
      exam_id, exam_version_id, snapshot_sequence, snapshot_scope, request_hash,
      record_count, snapshot_status, retention_until
    ) values (
      exam_id,
      exam_version_id,
      examination_room_v1.next_snapshot_sequence(exam_id),
      ''answer_state'',
      request_hash,
      expected_count,
      ''pending'',
      clock_timestamp() + interval ''365 days''
    );

    response := jsonb_build_object(
      ''ok'', true,
      ''submission'', jsonb_build_object(
        ''id'', submission_id,
        ''status'', ''accepted'',
        ''receiptId'', answer_revision_id,
        ''receivedAt'', clock_timestamp()
      ),
      ''duplicate'', false
    );
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, ''student'', ''student.submit'',
      ''submission'', submission_id, audit_request_hash,
      (submission_manifest ->> ''submittedAt'')::timestamptz, response,
      (p_payload ->> ''clientEventId'')::uuid
    );
    return response;
  end if;

  return examination_room_v1.api_error(
    ''UNKNOWN_OPERATION'', ''The student operation is not implemented.'', 400,
    ''Refresh the examination and try a listed action.''
  );
end;
$function$
';
  EXECUTE 'CREATE OR REPLACE FUNCTION examination_room_v1.prepare_student_admission(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''pg_catalog''
AS $function$
#variable_conflict use_variable
declare
  activation_row examination_room_v1.room_activations%rowtype;
  exam_owner_id uuid;
  student_identity_id uuid;
  roster_id uuid;
  full_name text := btrim(coalesce(p_payload #>> ''{identity,realName}'', ''''));
  student_number text := upper(btrim(coalesce(p_payload #>> ''{identity,studentNumber}'', '''')));
  entered_subject text := btrim(coalesce(p_payload #>> ''{identity,subject}'', ''''));
  entered_year_level text := btrim(coalesce(p_payload #>> ''{identity,yearLevel}'', ''''));
  student_email text := nullif(lower(btrim(coalesce(p_payload #>> ''{identity,email}'', ''''))), '''');
  canonical_subject text;
  canonical_year_level text;
  admission_mode text;
  allowed_emails text[];
  use_anonymous_grading boolean;
  lifecycle_result jsonb;
begin
  select activation.* into activation_row
  from examination_room_v1.room_activations activation
  where activation.key_hash = p_payload ->> ''roomKeyHash''
  order by activation.created_at desc, activation.id desc
  limit 1;

  if activation_row.id is null then
    return examination_room_v1.api_error(
      ''ROOM_KEY_INVALID'', ''The room key is expired, revoked, or not recognized.'', 401,
      ''Copy the complete current key from the Professor message and try again.''
    );
  end if;

  lifecycle_result := public.examination_room_v1_lifecycle_guard(activation_row.exam_id);
  if lifecycle_result ->> ''ok'' <> ''true'' then
    return lifecycle_result;
  end if;

  if activation_row.activation_status not in (''scheduled'', ''open'')
     or activation_row.closes_at <= clock_timestamp() then
    return examination_room_v1.api_error(
      ''ROOM_KEY_INVALID'', ''The room key is expired, revoked, or not recognized.'', 401,
      ''Copy the complete current key from the Professor message and try again.''
    );
  end if;

  if activation_row.activation_status = ''scheduled'' then
    update examination_room_v1.room_activations activation
    set activation_status = ''open'',
        opens_at = least(activation.opens_at, clock_timestamp()),
        deactivated_at = null,
        deactivated_by_user_id = null,
        deactivation_reason = null
    where activation.id = activation_row.id
      and activation.activation_status = ''scheduled''
      and activation.closes_at > clock_timestamp()
    returning activation.* into activation_row;

    if not found then
      select activation.* into activation_row
      from examination_room_v1.room_activations activation
      where activation.key_hash = p_payload ->> ''roomKeyHash''
        and activation.activation_status = ''open''
        and activation.closes_at > clock_timestamp();
    end if;
    if activation_row.id is null then
      return examination_room_v1.api_error(
        ''ROOM_KEY_INVALID'', ''The room key is expired, revoked, or not recognized.'', 401,
        ''Copy the complete current key from the Professor message and try again.''
      );
    end if;
  end if;

  if length(full_name) not between 2 and 240
     or full_name !~ ''[[:alpha:]]''
     or length(student_number) not between 2 and 128
     or length(entered_subject) not between 1 and 160
     or length(entered_year_level) not between 1 and 64 then
    return examination_room_v1.api_error(
      ''STUDENT_IDENTITY_INVALID'', ''Complete the student name, student number, subject, and year level.'', 400,
      ''Correct the four student details, then try again with the same key.''
    );
  end if;
  if student_email is not null and (
    length(student_email) not between 3 and 320
    or student_email !~ ''^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$''
  ) then
    return examination_room_v1.api_error(
      ''STUDENT_EMAIL_INVALID'', ''Enter a valid student email or leave it blank.'', 400,
      ''Correct the email, then try again.''
    );
  end if;

  select
    exam.owner_user_id,
    exam.anonymous_grading,
    version.admission_mode_snapshot,
    version.allowed_emails_snapshot,
    coalesce(version.controls ->> ''subject'', ''''),
    coalesce(version.controls ->> ''yearLevel'', '''')
  into
    exam_owner_id,
    use_anonymous_grading,
    admission_mode,
    allowed_emails,
    canonical_subject,
    canonical_year_level
  from examination_room_v1.exams exam
  join examination_room_v1.exam_versions version on version.id = activation_row.exam_version_id
  where exam.id = activation_row.exam_id
    and exam.institution_id = activation_row.institution_id;

  if admission_mode = ''email_allowlist''
     and (student_email is null or not (student_email = any(allowed_emails))) then
    return examination_room_v1.api_error(
      ''STUDENT_EMAIL_NOT_ALLOWED'', ''This email is not included in the examination access list.'', 403,
      ''Check the email spelling or ask the Professor to update the optional email list.''
    );
  end if;

  if exists (
    select 1
    from examination_room_v1.student_sessions session
    join examination_room_v1.exam_roster roster on roster.id = session.roster_id
    join examination_room_v1.student_identities identity on identity.id = roster.student_identity_id
    where session.activation_id = activation_row.id
      and session.session_status = ''revoked''
      and (
        identity.external_student_id = student_number
        or (
          student_email is not null
          and identity.email_normalized = student_email
        )
      )
  ) then
    return examination_room_v1.api_error(
      ''SESSION_REVOKED'', ''This entry was removed from the current examination room.'', 403,
      ''Ask the Professor before trying to enter this activation again.''
    );
  end if;

  insert into examination_room_v1.student_identities (
    institution_id, external_student_id, full_name, email_normalized,
    identity_status, verified_at, verification_method
  ) values (
    activation_row.institution_id,
    student_number,
    full_name,
    student_email,
    ''active'',
    null,
    null
  )
  on conflict (institution_id, external_student_id) do update
  set full_name = excluded.full_name,
      email_normalized = coalesce(excluded.email_normalized, examination_room_v1.student_identities.email_normalized),
      identity_status = ''active'',
      updated_at = clock_timestamp()
  returning id into student_identity_id;

  roster_id := gen_random_uuid();
  insert into examination_room_v1.exam_roster (
    id, exam_id, institution_id, student_identity_id, grading_alias,
    roster_status, accommodations, added_by_user_id
  ) values (
    roster_id,
    activation_row.exam_id,
    activation_row.institution_id,
    student_identity_id,
    case when use_anonymous_grading
      then ''CAND-'' || upper(substr(replace(roster_id::text, ''-'', ''''), 1, 8))
      else null end,
    ''eligible'',
    jsonb_build_object(
      ''subject'', canonical_subject,
      ''yearLevel'', canonical_year_level,
      ''enteredSubject'', entered_subject,
      ''enteredYearLevel'', entered_year_level,
      ''admissionSource'', ''room_key_self_entry'',
      ''extraMinutes'', 0
    ),
    exam_owner_id
  )
  on conflict on constraint exam_roster_exam_student_key do update
  set roster_status = case
        when examination_room_v1.exam_roster.roster_status = ''completed'' then ''completed''
        else ''eligible''
      end,
      grading_alias = coalesce(examination_room_v1.exam_roster.grading_alias, excluded.grading_alias),
      accommodations = jsonb_build_object(
        ''subject'', canonical_subject,
        ''yearLevel'', canonical_year_level,
        ''enteredSubject'', entered_subject,
        ''enteredYearLevel'', entered_year_level,
        ''admissionSource'', ''room_key_self_entry'',
        ''extraMinutes'', coalesce(
          examination_room_v1.exam_roster.accommodations -> ''extraMinutes'',
          ''0''::jsonb
        )
      ),
      updated_at = clock_timestamp()
  returning id into roster_id;

  if exists (
    select 1
    from examination_room_v1.student_sessions session
    where session.activation_id = activation_row.id
      and session.roster_id = roster_id
      and session.session_status = ''revoked''
  ) then
    return examination_room_v1.api_error(
      ''SESSION_REVOKED'', ''This entry was removed from the current examination room.'', 403,
      ''Ask the Professor before trying to enter this activation again.''
    );
  end if;

  return jsonb_build_object(
    ''ok'', true,
    ''identity'', jsonb_strip_nulls(jsonb_build_object(
      ''realName'', full_name,
      ''studentNumber'', student_number,
      ''subject'', canonical_subject,
      ''yearLevel'', canonical_year_level,
      ''email'', student_email
    ))
  );
end;
$function$
';
  EXECUTE 'CREATE OR REPLACE FUNCTION examination_room_v1.recover_existing_student_session(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''pg_catalog''
AS $function$
declare
  v_session_id uuid;
  v_exam_id uuid;
  v_exam_version_id uuid;
  v_institution_id uuid;
  v_roster_id uuid;
  v_session_status text;
  v_started_at timestamptz;
  v_lease_expires_at timestamptz;
  v_publication_manifest jsonb;
  v_publication_hash text;
  v_grading_alias text;
  v_request_hash text := p_payload ->> ''requestHash'';
  v_session_token_hash text := p_payload ->> ''sessionTokenHash'';
  v_client_event_id uuid := nullif(p_payload ->> ''clientEventId'', '''')::uuid;
  v_response jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from ''object''
     or coalesce(p_payload ->> ''roomKeyHash'', '''') !~ ''^[0-9a-f]{64}$''
     or coalesce(v_request_hash, '''') !~ ''^[0-9a-f]{64}$''
     or coalesce(v_session_token_hash, '''') !~ ''^[0-9a-f]{64}$'' then
    return examination_room_v1.api_error(
      ''SESSION_RECOVERY_INVALID'',
      ''The saved examination could not be reconnected safely.'',
      400,
      ''Return to the join page, enter the same room key and student details, then try again.''
    );
  end if;

  select
    s.id,
    s.exam_id,
    s.exam_version_id,
    s.institution_id,
    s.roster_id,
    s.session_status,
    s.started_at,
    s.lease_expires_at,
    v.publication_manifest,
    v.content_sha256,
    er.grading_alias
  into
    v_session_id,
    v_exam_id,
    v_exam_version_id,
    v_institution_id,
    v_roster_id,
    v_session_status,
    v_started_at,
    v_lease_expires_at,
    v_publication_manifest,
    v_publication_hash,
    v_grading_alias
  from examination_room_v1.room_activations a
  join examination_room_v1.student_sessions s
    on s.activation_id = a.id
  join examination_room_v1.exam_roster er
    on er.id = s.roster_id
   and er.exam_id = s.exam_id
   and er.institution_id = s.institution_id
  join examination_room_v1.student_identities si
    on si.id = er.student_identity_id
  join examination_room_v1.exam_versions v
    on v.id = s.exam_version_id
  where a.key_hash = p_payload ->> ''roomKeyHash''
    and a.activation_status = ''open''
    and a.closes_at > clock_timestamp()
    and s.session_status in (''created'', ''active'')
    and upper(si.external_student_id) = upper(p_payload #>> ''{identity,studentNumber}'')
    and lower(btrim(si.full_name)) = lower(btrim(p_payload #>> ''{identity,realName}''))
    and lower(btrim(er.accommodations ->> ''subject'')) = lower(btrim(p_payload #>> ''{identity,subject}''))
    and lower(btrim(er.accommodations ->> ''yearLevel'')) = lower(btrim(p_payload #>> ''{identity,yearLevel}''))
    and not exists (
      select 1
      from examination_room_v1.submissions sub
      where sub.session_id = s.id
    )
  order by s.started_at desc
  limit 1
  for update of s;

  if v_session_id is null then
    return examination_room_v1.api_error(
      ''SESSION_ALREADY_EXISTS'',
      ''A session already exists for this student and room, but it could not be safely resumed.'',
      409,
      ''Use the same room key and exact student details. If this continues, ask the professor to review the session.''
    );
  end if;

  update examination_room_v1.student_sessions s
  set session_token_hash = v_session_token_hash,
      last_heartbeat_at = greatest(coalesce(s.last_heartbeat_at, s.started_at), clock_timestamp()),
      updated_at = clock_timestamp()
  where s.id = v_session_id;

  v_response := jsonb_build_object(
    ''ok'', true,
    ''resumed'', true,
    ''session'', jsonb_build_object(
      ''id'', v_session_id,
      ''status'', v_session_status,
      ''startedAt'', v_started_at,
      ''leaseExpiresAt'', v_lease_expires_at,
      ''anonymousCandidateId'', v_grading_alias
    ),
    ''publicationManifest'', v_publication_manifest,
    ''publicationHash'', v_publication_hash
  );

  perform examination_room_v1.api_record_audit(
    v_institution_id,
    v_exam_id,
    v_session_id,
    null,
    ''student'',
    ''student.session_recovered'',
    ''student_session'',
    v_session_id,
    v_request_hash,
    clock_timestamp(),
    v_response,
    v_client_event_id
  );

  return v_response;
end;
$function$
';
  EXECUTE 'CREATE OR REPLACE FUNCTION public.examination_room_v1_api(p_scope text, p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_payload jsonb DEFAULT ''{}''::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''pg_catalog''
AS $function$
#variable_conflict use_variable
declare
  safe_payload jsonb := coalesce(p_payload, ''{}''::jsonb);
  exam_id uuid;
  admission_result jsonb;
  student_result jsonb;
begin
  if p_scope is null
     or p_operation is null
     or (p_scope <> ''student'' and p_institution_id is null)
     or jsonb_typeof(safe_payload) <> ''object'' then
    return examination_room_v1.api_error(
      ''INVALID_REQUEST'', ''Scope, operation, an object payload, and workspace for creator views are required.'', 400,
      ''Refresh Examination Room and try again.''
    );
  end if;

  if safe_payload::text ~* ''"(key|token|raw[ _-]?key|room[ _-]?(key|code)|activation[ _-]?(key|code)|exam[ _-]?(key|code)|api[ _-]?key|session[ _-]?token|idempotency[ _-]?key|access[ _-]?(token|code)|refresh[ _-]?token|bearer[ _-]?token|one[ _-]?time[ _-]?code|password|secret|authorization|credential)"[[:space:]]*:'' then
    return examination_room_v1.api_error(
      ''RAW_SECRET_REJECTED'', ''Only one-way hashes or opaque identifiers may reach examination persistence.'', 400,
      ''Refresh the page and repeat the action without raw credentials.''
    );
  end if;

  if not (
    (p_scope = ''professor'' and p_operation in (
      ''session'', ''exam'', ''monitor'', ''grading'', ''grading_context'', ''release_context'',
      ''save_draft'', ''publish'', ''open_room'', ''close_room'', ''revoke_session'',
      ''save_grade'', ''release_results''
    ))
    or (p_scope = ''student'' and p_operation in (
      ''preview'', ''consent'', ''resume'', ''result'', ''session_context'', ''save_answer'',
      ''record_event'', ''heartbeat'', ''submission_intent'', ''submit''
    ))
    or (p_scope = ''admin'' and p_operation in (
      ''overview'', ''activate_exam'', ''email_key'', ''revoke_key'', ''create_snapshot''
    ))
  ) then
    return examination_room_v1.api_error(
      ''UNKNOWN_OPERATION'', ''The requested Examination Room operation is not registered.'', 400,
      ''Refresh Examination Room and choose a listed action.''
    );
  end if;

  if p_scope = ''professor'' then
    if not examination_room_v1.creator_authorized(p_actor_user_id, p_institution_id) then
      return examination_room_v1.api_error(
        ''CREATOR_WORKSPACE_REQUIRED'', ''A verified account and active law-school workspace are required.'', 403,
        ''Sign in, choose an active workspace, then retry.''
      );
    end if;
    if p_operation in (''monitor'', ''grading'') then
      exam_id := nullif(safe_payload ->> ''examId'', '''')::uuid;
      return examination_room_v1.api_professor_view(
        p_operation, p_actor_user_id, p_institution_id, exam_id
      );
    end if;
    if p_operation = ''revoke_session'' then
      return examination_room_v1.creator_revoke_session(
        p_actor_user_id, p_institution_id, safe_payload
      );
    end if;
    return examination_room_v1.api_professor(
      p_operation, p_actor_user_id, p_institution_id, safe_payload
    );
  elsif p_scope = ''admin'' then
    if not examination_room_v1.owner_authorized(p_actor_user_id)
       or not exists (
         select 1 from examination_room_v1.institutions institution
         where institution.id = p_institution_id
           and institution.institution_status = ''active''
       ) then
      return examination_room_v1.api_error(
        ''PLATFORM_OWNER_REQUIRED'', ''Only a Founder or Super Admin may use examination administration.'', 403,
        ''Sign in with a platform-owner account.''
      );
    end if;
    return examination_room_v1.api_admin(
      p_operation, p_actor_user_id, p_institution_id, safe_payload
    );
  end if;

  if p_operation in (''preview'', ''consent'') then
    admission_result := examination_room_v1.prepare_student_admission(safe_payload);
    if admission_result ->> ''ok'' = ''false'' then return admission_result; end if;
    safe_payload := jsonb_set(
      safe_payload,
      ''{identity}'',
      admission_result -> ''identity'',
      true
    );
  end if;

  student_result := examination_room_v1.api_student(p_operation, safe_payload);

  if p_operation = ''consent''
     and student_result #>> ''{error,code}'' = ''SESSION_ALREADY_EXISTS'' then
    return examination_room_v1.recover_existing_student_session(safe_payload);
  end if;

  return student_result;
exception
  when invalid_text_representation or datetime_field_overflow then
    return examination_room_v1.api_error(
      ''INVALID_REQUEST'', ''A supplied identifier, number, or timestamp is invalid.'', 400,
      ''Refresh the page, correct the highlighted value, and try again.''
    );
  when unique_violation then
    return examination_room_v1.api_error(
      ''PERSISTENCE_CONFLICT'', ''A newer or duplicate record already exists for this action.'', 409,
      ''Refresh the current server-backed state, then repeat the action only if still needed.''
    );
  when foreign_key_violation or check_violation or not_null_violation then
    return examination_room_v1.api_error(
      ''PERSISTENCE_STATE_INVALID'', ''The action does not match the current immutable examination state.'', 409,
      ''Refresh the examination and retry from the latest saved state.''
    );
  when object_not_in_prerequisite_state then
    return examination_room_v1.api_error(
      ''IMMUTABLE_RECORD_SEALED'', ''That evidence record is already sealed and cannot be changed.'', 409,
      ''Refresh the view and create a new revision instead of overwriting sealed evidence.''
    );
  when serialization_failure or deadlock_detected then
    return examination_room_v1.api_error(
      ''RETRY_REQUIRED'', ''Another examination action completed at the same time.'', 409,
      ''Refresh the current state and retry the action once.''
    );
  when others then
    return examination_room_v1.api_error(
      ''PERSISTENCE_INTERNAL_ERROR'', ''The database could not complete the examination action safely.'', 500,
      ''Your prior server-backed work is preserved. Try again; if it continues, contact support.''
    );
end;
$function$
';
  EXECUTE 'CREATE OR REPLACE FUNCTION examination_room_v1.api_professor(p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''pg_catalog''
AS $function$
#variable_conflict use_variable
declare
  actor_is_admin boolean;
  actor_name text;
  actor_email text;
  exam_id uuid;
  exam_owner_id uuid;
  version_id uuid;
  version_number integer;
  notice_id uuid;
  request_hash text;
  requested_at timestamptz;
  exam_payload jsonb;
  draft_payload jsonb;
  controls_payload jsonb;
  publication_bundle jsonb;
  publication_hash text;
  response jsonb;
  replay jsonb;
  roster_item jsonb;
  student_identity_id uuid;
  roster_row_id uuid;
  use_anonymous_grading boolean;
  question_count integer;
  roster_count integer;
  submission_id uuid;
  student_session_id uuid;
  exam_version_id uuid;
  grading_manifest jsonb;
  release_manifest jsonb;
  expected_result jsonb;
  release_item jsonb;
  score_item jsonb;
  grade_revision_id uuid;
  grade_revision_number integer;
  question_id uuid;
  score_count integer;
  distinct_score_count integer;
  total_score numeric(12, 2);
  maximum_score numeric(12, 2);
  event_time timestamptz;
  room_activation_status text;
begin
  actor_is_admin := examination_room_v1.owner_authorized(p_actor_user_id);

  select
    coalesce(
      nullif(btrim(membership.display_name), ''''),
      nullif(btrim(profile.display_name), ''''),
      nullif(btrim(auth_user.raw_user_meta_data ->> ''full_name''), ''''),
      nullif(btrim(auth_user.raw_user_meta_data ->> ''name''), ''''),
      nullif(pg_catalog.split_part(lower(auth_user.email), ''@'', 1), ''''),
      ''Examination creator''
    ),
    coalesce(membership.email_normalized, lower(auth_user.email))
  into actor_name, actor_email
  from auth.users auth_user
  left join public.profiles profile on profile.id = auth_user.id
  left join lateral (
    select row_value.display_name, row_value.email_normalized
    from examination_room_v1.staff_memberships row_value
    where row_value.institution_id = p_institution_id
      and row_value.user_id = p_actor_user_id
      and row_value.membership_status = ''active''
    order by (row_value.staff_role = ''admin'') desc, row_value.granted_at desc
    limit 1
  ) membership on true
  where auth_user.id = p_actor_user_id;

  if p_operation = ''session'' then
    select jsonb_build_object(
      ''ok'', true,
      ''professor'', jsonb_build_object(
        ''id'', p_actor_user_id,
        ''authorized'', true,
        ''displayName'', coalesce(actor_name, ''Professor''),
        ''email'', actor_email,
        ''institutionId'', p_institution_id,
        ''adminTesting'', actor_is_admin
      ),
      ''exam'', coalesce(exams.items -> 0, ''null''::jsonb),
      ''exams'', exams.items
    )
    into response
    from lateral (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          ''id'', e.id,
          ''title'', e.title,
          ''status'', e.status,
          ''anonymousGrading'', e.anonymous_grading,
          ''currentVersionId'', e.current_published_version_id,
          ''admissionMode'', e.admission_mode,
          ''allowedEmails'', to_jsonb(e.allowed_emails),
          ''activation'', (
            select jsonb_build_object(
              ''id'', activation.id,
              ''status'', activation.activation_status,
              ''opensAt'', activation.opens_at,
              ''closesAt'', activation.closes_at,
              ''expiresAt'', activation.closes_at,
              ''maxSessions'', activation.max_sessions,
              ''createdAt'', activation.created_at
            )
            from examination_room_v1.room_activations activation
            where activation.exam_id = e.id
            order by activation.created_at desc, activation.id desc
            limit 1
          ),
          ''updatedAt'', e.updated_at
        ) order by e.updated_at desc
      ), ''[]''::jsonb) as items
      from examination_room_v1.exams e
      where e.institution_id = p_institution_id
        and (actor_is_admin or e.owner_user_id = p_actor_user_id)
    ) exams;
    return response;
  end if;

  if p_operation in (''exam'', ''monitor'', ''grading'', ''grading_context'') then
    exam_id := nullif(p_payload ->> ''examId'', '''')::uuid;
  end if;

  if p_operation = ''release_context'' then
    exam_id := nullif(p_payload ->> ''examId'', '''')::uuid;
  end if;

  if p_operation in (''exam'', ''monitor'', ''grading'', ''grading_context'', ''release_context'', ''open_room'', ''close_room'', ''save_grade'', ''release_results'') then
    if exam_id is null then
      exam_id := nullif(p_payload ->> ''examId'', '''')::uuid;
    end if;

    select e.owner_user_id
    into exam_owner_id
    from examination_room_v1.exams e
    where e.id = exam_id
      and e.institution_id = p_institution_id;

    if exam_owner_id is null then
      return examination_room_v1.api_error(
        ''EXAM_NOT_FOUND'', ''The examination does not exist in this institution.'', 404,
        ''Return to the Examination Room list and choose an available examination.''
      );
    end if;

    if not actor_is_admin and exam_owner_id <> p_actor_user_id then
      return examination_room_v1.api_error(
        ''FORBIDDEN'', ''Only the examination owner or an administrator may access this examination.'', 403,
        ''Choose an examination assigned to your account.''
      );
    end if;
  end if;

  if p_operation = ''exam'' then
    select coalesce(
      (
        select v.id
        from examination_room_v1.exam_versions v
        where v.exam_id = exam_id
        order by (v.publication_status = ''building'') desc, v.version_number desc
        limit 1
      ),
      e.current_published_version_id
    )
    into version_id
    from examination_room_v1.exams e
    where e.id = exam_id;

    select jsonb_build_object(
      ''ok'', true,
      ''exam'', jsonb_build_object(
        ''id'', e.id,
        ''examId'', e.id,
        ''title'', e.title,
        ''description'', e.description,
        ''status'', e.status,
        ''anonymousGrading'', e.anonymous_grading,
        ''admissionMode'', e.admission_mode,
        ''allowedEmails'', to_jsonb(e.allowed_emails),
        ''currentPublishedVersionId'', e.current_published_version_id,
        ''versionId'', v.id,
        ''version'', v.version_number,
        ''publicationStatus'', v.publication_status,
        ''instructions'', v.instructions,
        ''durationMinutes'', v.duration_seconds / 60,
        ''controls'', v.controls,
        ''questions'', coalesce(q.items, ''[]''::jsonb),
        ''roster'', coalesce(r.items, ''[]''::jsonb)
      ),
      ''publicationManifest'', case when v.publication_status = ''published'' then v.publication_manifest else null end
    )
    into response
    from examination_room_v1.exams e
    left join examination_room_v1.exam_versions v on v.id = version_id
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          ''questionNumber'', q.position,
          ''questionKey'', q.question_key,
          ''questionKind'', q.question_kind,
          ''type'', coalesce(q.configuration ->> ''type'', replace(q.question_kind, ''_'', ''-'')),
          ''prompt'', q.prompt,
          ''points'', q.points,
          ''gradingGuidance'', coalesce(q.configuration ->> ''gradingGuidance'', ''''),
          ''wordLimit'', q.configuration -> ''wordLimit'',
          ''choices'', coalesce(q.configuration -> ''choices'', ''[]''::jsonb),
          ''correctOptionIndex'', q.configuration -> ''correctOptionIndex'',
          ''acceptedAnswers'', coalesce(q.configuration -> ''acceptedAnswers'', ''[]''::jsonb)
        ) order by q.position
      ) as items
      from examination_room_v1.questions q
      where q.exam_version_id = v.id
    ) q on true
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          ''id'', er.id,
          ''fullName'', si.full_name,
          ''studentNumber'', si.external_student_id,
          ''email'', si.email_normalized,
          ''yearLevel'', er.accommodations ->> ''yearLevel'',
          ''subject'', er.accommodations ->> ''subject'',
          ''extraMinutes'', coalesce((er.accommodations ->> ''extraMinutes'')::integer, 0),
          ''status'', er.roster_status,
          ''gradingAlias'', er.grading_alias
        ) order by si.full_name
      ) as items
      from examination_room_v1.exam_roster er
      join examination_room_v1.student_identities si on si.id = er.student_identity_id
      where er.exam_id = e.id
    ) r on true
    where e.id = exam_id;
    return response;
  end if;

  if p_operation = ''monitor'' then
    select jsonb_build_object(
      ''ok'', true,
      ''examId'', e.id,
      ''title'', e.title,
      ''status'', e.status,
      ''activation'', a.item,
      ''students'', coalesce(s.items, ''[]''::jsonb)
    )
    into response
    from examination_room_v1.exams e
    left join lateral (
      select jsonb_build_object(
        ''id'', ra.id,
        ''status'', ra.activation_status,
        ''opensAt'', ra.opens_at,
        ''closesAt'', ra.closes_at,
        ''maxSessions'', ra.max_sessions
      ) as item
      from examination_room_v1.room_activations ra
      where ra.exam_id = e.id
      order by ra.created_at desc
      limit 1
    ) a on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        ''sessionId'', ss.id,
        ''fullName'', si.full_name,
        ''studentNumber'', si.external_student_id,
        ''gradingAlias'', case when e.anonymous_grading then null else er.grading_alias end,
        ''status'', ss.session_status,
        ''startedAt'', ss.started_at,
        ''lastHeartbeatAt'', ss.last_heartbeat_at,
        ''currentQuestion'', ss.session_metadata -> ''currentQuestion'',
        ''connected'', coalesce((ss.session_metadata ->> ''connected'')::boolean, false),
        ''incidentCount'', (select count(*) from examination_room_v1.proctoring_incidents pi where pi.session_id = ss.id),
        ''submitted'', exists (select 1 from examination_room_v1.submissions sub where sub.session_id = ss.id)
      ) order by si.full_name) as items
      from examination_room_v1.exam_roster er
      join examination_room_v1.student_identities si on si.id = er.student_identity_id
      left join examination_room_v1.student_sessions ss on ss.roster_id = er.id
      where er.exam_id = e.id
        and ss.id is not null
    ) s on true
    where e.id = exam_id;
    return response;
  end if;

  if p_operation = ''grading'' then
    select jsonb_build_object(
      ''ok'', true,
      ''examId'', e.id,
      ''title'', e.title,
      ''students'', coalesce(g.items, ''[]''::jsonb)
    )
    into response
    from examination_room_v1.exams e
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        ''sessionId'', case
          when e.anonymous_grading then examination_room_v1.uuid_from_hash(sub.idempotency_key_hash)
          else ss.id
        end,
        ''submissionId'', sub.id,
        ''displayName'', case when e.anonymous_grading then er.grading_alias else si.full_name end,
        ''studentNumber'', case when e.anonymous_grading then null else si.external_student_id end,
        ''submittedAt'', sub.received_at,
        ''submissionStatus'', sub.submission_status,
        ''latestGrade'', gr.grading_manifest,
        ''released'', exists (
          select 1 from examination_room_v1.result_releases rr
          where rr.submission_id = sub.id
            and rr.release_action = ''release''
            and not exists (
              select 1 from examination_room_v1.result_releases rv
              where rv.supersedes_release_id = rr.id and rv.release_action = ''revoke''
            )
        )
      ) order by sub.received_at) as items
      from examination_room_v1.submissions sub
      join examination_room_v1.student_sessions ss on ss.id = sub.session_id
      join examination_room_v1.exam_roster er on er.id = ss.roster_id
      join examination_room_v1.student_identities si on si.id = er.student_identity_id
      left join lateral (
        select grades.grading_manifest
        from examination_room_v1.grade_revisions grades
        where grades.submission_id = sub.id
        order by grades.revision_number desc
        limit 1
      ) gr on true
      where ss.exam_id = e.id
    ) g on true
    where e.id = exam_id;
    return response;
  end if;

  if p_operation = ''grading_context'' then
    select
      sub.id,
      sub.exam_version_id,
      examination_room_v1.grader_safe_submission_manifest(
        sub.submission_manifest,
        e.anonymous_grading,
        er.grading_alias,
        examination_room_v1.uuid_from_hash(sub.idempotency_key_hash)
      ) || jsonb_build_object(''idempotencyKey'', sub.idempotency_key_hash)
    into submission_id, exam_version_id, draft_payload
    from examination_room_v1.student_sessions ss
    join examination_room_v1.submissions sub on sub.session_id = ss.id
    join examination_room_v1.exams e on e.id = ss.exam_id
    join examination_room_v1.exam_roster er on er.id = ss.roster_id
    where (
        (not e.anonymous_grading and ss.id = (p_payload ->> ''sessionId'')::uuid)
        or (
          e.anonymous_grading
          and examination_room_v1.uuid_from_hash(sub.idempotency_key_hash) = (p_payload ->> ''sessionId'')::uuid
        )
      )
      and ss.exam_id = exam_id
      and ss.institution_id = p_institution_id;

    if submission_id is null then
      return examination_room_v1.api_error(
        ''SUBMISSION_NOT_FOUND'', ''The student has not submitted this examination.'', 409,
        ''Refresh grading after the student submits.''
      );
    end if;

    select q.position
    into question_count
    from examination_room_v1.questions q
    where q.exam_version_id = exam_version_id
      and (
        q.question_key = p_payload ->> ''questionReference''
        or q.position::text = p_payload ->> ''questionReference''
        or ''q-'' || q.position::text = p_payload ->> ''questionReference''
      );

    if question_count is null then
      return examination_room_v1.api_error(
        ''QUESTION_NOT_FOUND'', ''That question is not part of the submitted examination version.'', 409,
        ''Refresh grading and choose a listed question.''
      );
    end if;

    select jsonb_build_object(
      ''ok'', true,
      ''publicationManifest'', v.publication_manifest,
      ''submissionManifest'', draft_payload,
      ''questionNumber'', question_count,
      ''scores'', coalesce(gr.scores, ''[]''::jsonb),
      ''nextRevision'', coalesce(gr.revision_number, 0) + 1,
      ''overallFeedback'', coalesce(gr.general_feedback, '''')
    )
    into response
    from examination_room_v1.exam_versions v
    left join lateral (
      select
        grades.revision_number,
        grades.general_feedback,
        (
          select jsonb_agg(jsonb_build_object(
            ''questionNumber'', q.position,
            ''pointsAwarded'', item.score,
            ''feedback'', coalesce(item.feedback, '''')
          ) order by q.position)
          from examination_room_v1.grade_revision_items item
          join examination_room_v1.questions q on q.id = item.question_id
          where item.grade_revision_id = grades.id
        ) as scores
      from examination_room_v1.grade_revisions grades
      where grades.submission_id = submission_id
      order by grades.revision_number desc
      limit 1
    ) gr on true
    where v.id = exam_version_id;
    return response;
  end if;

  if p_operation = ''release_context'' then
    if jsonb_typeof(p_payload -> ''sessionIds'') <> ''array''
       or jsonb_array_length(p_payload -> ''sessionIds'') = 0 then
      return examination_room_v1.api_error(
        ''RESULT_RECIPIENT_REQUIRED'', ''Select at least one submitted student.'', 400,
        ''Select the intended students, then release again.''
      );
    end if;

    select jsonb_build_object(''ok'', true, ''entries'', coalesce(jsonb_agg(entry.item order by entry.session_id), ''[]''::jsonb))
    into response
    from (
      select
        case
          when e.anonymous_grading then examination_room_v1.uuid_from_hash(sub.idempotency_key_hash)
          else ss.id
        end as session_id,
        jsonb_build_object(
          ''sessionId'', case
            when e.anonymous_grading then examination_room_v1.uuid_from_hash(sub.idempotency_key_hash)
            else ss.id
          end,
          ''nextRevision'', coalesce(gr.revision_number, 0) + 1,
          ''submissionManifest'', examination_room_v1.grader_safe_submission_manifest(
            sub.submission_manifest,
            e.anonymous_grading,
            er.grading_alias,
            examination_room_v1.uuid_from_hash(sub.idempotency_key_hash)
          ) || jsonb_build_object(''idempotencyKey'', sub.idempotency_key_hash),
          ''scores'', coalesce(gr.scores, ''[]''::jsonb),
          ''overallFeedback'', coalesce(gr.general_feedback, '''')
        ) as item
      from jsonb_array_elements_text(p_payload -> ''sessionIds'') requested(session_id)
      join examination_room_v1.student_sessions ss on true
      join examination_room_v1.submissions sub on sub.session_id = ss.id and sub.submission_status = ''accepted''
      join examination_room_v1.exams e on e.id = ss.exam_id
      join examination_room_v1.exam_roster er on er.id = ss.roster_id
      left join lateral (
        select
          grades.revision_number,
          grades.general_feedback,
          (
            select jsonb_agg(jsonb_build_object(
              ''questionNumber'', q.position,
              ''pointsAwarded'', item.score,
              ''feedback'', coalesce(item.feedback, '''')
            ) order by q.position)
            from examination_room_v1.grade_revision_items item
            join examination_room_v1.questions q on q.id = item.question_id
            where item.grade_revision_id = grades.id
          ) as scores
        from examination_room_v1.grade_revisions grades
        where grades.submission_id = sub.id
        order by grades.revision_number desc
        limit 1
      ) gr on true
      where ss.exam_id = exam_id
        and ss.institution_id = p_institution_id
        and (
          (not e.anonymous_grading and ss.id = requested.session_id::uuid)
          or (
            e.anonymous_grading
            and examination_room_v1.uuid_from_hash(sub.idempotency_key_hash) = requested.session_id::uuid
          )
        )
    ) entry;

    if jsonb_array_length(response -> ''entries'') <> jsonb_array_length(p_payload -> ''sessionIds'') then
      return examination_room_v1.api_error(
        ''GRADING_CONTEXT_INVALID'', ''One or more selected students does not have an accepted submission.'', 409,
        ''Refresh grading, review the selected students, then release again.''
      );
    end if;
    return response;
  end if;

  if p_operation in (''save_draft'', ''publish'') then
    request_hash := p_payload ->> ''requestHash'';
    requested_at := coalesce((p_payload ->> ''requestedAt'')::timestamptz, clock_timestamp());
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(p_institution_id, request_hash, ''professor.'' || p_operation);
    if replay is not null then
      if p_operation = ''publish'' and replay ->> ''ok'' = ''true'' then
        select v.publication_manifest
        into publication_bundle
        from examination_room_v1.exam_versions v
        where v.id = (replay ->> ''versionId'')::uuid
          and v.exam_id = (replay ->> ''examId'')::uuid
          and v.institution_id = p_institution_id
          and v.publication_status = ''published'';
        replay := replay || jsonb_build_object(''publicationManifest'', publication_bundle);
      end if;
      return replay;
    end if;

    exam_payload := p_payload -> ''exam'';
    draft_payload := p_payload -> ''draft'';
    if jsonb_typeof(exam_payload) <> ''object'' or jsonb_typeof(draft_payload) <> ''object'' then
      return examination_room_v1.api_error(
        ''EXAM_PAYLOAD_INVALID'', ''The normalized examination draft is missing.'', 400,
        ''Refresh the creator and save the examination again.''
      );
    end if;

    exam_id := nullif(exam_payload ->> ''examId'', '''')::uuid;
    if exam_id is null then
      exam_id := gen_random_uuid();
    end if;

    select e.owner_user_id
    into exam_owner_id
    from examination_room_v1.exams e
    where e.id = exam_id
      and e.institution_id = p_institution_id
    for update;

    if exam_owner_id is not null and not actor_is_admin and exam_owner_id <> p_actor_user_id then
      return examination_room_v1.api_error(
        ''FORBIDDEN'', ''Only the examination owner or an administrator may change this examination.'', 403,
        ''Choose an examination assigned to your account.''
      );
    end if;

    select n.id
    into notice_id
    from examination_room_v1.privacy_notice_versions n
    where n.institution_id = p_institution_id
      and n.notice_code = lower(exam_payload ->> ''privacyNoticeVersion'')
      and n.effective_at <= requested_at
    order by n.version_number desc
    limit 1;

    if notice_id is null then
      return examination_room_v1.api_error(
        ''PRIVACY_NOTICE_NOT_CONFIGURED'',
        ''The selected privacy notice has not been approved for this institution.'',
        409,
        ''Ask the administrator to publish the exact privacy notice version, then save or publish again.''
      );
    end if;

    if p_operation = ''publish''
       and jsonb_array_length(coalesce(exam_payload -> ''questions'', ''[]''::jsonb)) = 0 then
      return examination_room_v1.api_error(
        ''PUBLICATION_NOT_READY'', ''Publishing requires at least one question.'', 409,
        ''Add at least one complete question, then publish again.''
      );
    end if;
    if p_operation = ''publish''
       and coalesce(exam_payload ->> ''admissionMode'', ''key_only'') = ''email_allowlist''
       and cardinality(examination_room_v1.normalized_allowed_emails(exam_payload -> ''allowedEmails'')) = 0 then
      return examination_room_v1.api_error(
        ''ALLOWED_EMAIL_REQUIRED'', ''Add at least one email or use key-only admission.'', 409,
        ''Add one email per line, or choose Anyone with the key, then publish again.''
      );
    end if;

    use_anonymous_grading := coalesce(exam_payload ->> ''identityMode'', ''real_names'') = ''anonymous_grading'';
    controls_payload := jsonb_build_object(
      ''subject'', coalesce(exam_payload ->> ''subject'', ''''),
      ''yearLevel'', coalesce(exam_payload ->> ''yearLevel'', ''''),
      ''jurisdiction'', coalesce(exam_payload ->> ''jurisdiction'', ''Philippines''),
      ''startsAt'', exam_payload -> ''startsAt'',
      ''lateSubmissions'', coalesce(exam_payload ->> ''lateSubmissions'', ''not_allowed''),
      ''navigation'', coalesce(exam_payload ->> ''navigation'', ''free''),
      ''identityMode'', coalesce(exam_payload ->> ''identityMode'', ''real_names''),
      ''integrityTier'', coalesce(exam_payload ->> ''integrityTier'', ''standard''),
      ''cameraRequired'', coalesce((exam_payload ->> ''cameraRequired'')::boolean, false),
      ''microphoneRequired'', coalesce((exam_payload ->> ''microphoneRequired'')::boolean, false),
      ''privacyNoticeVersion'', lower(exam_payload ->> ''privacyNoticeVersion''),
      ''privacyController'', coalesce(exam_payload ->> ''privacyController'', ''''),
      ''retentionSummary'', coalesce(exam_payload ->> ''retentionSummary'', ''''),
      ''sourceFileName'', exam_payload -> ''sourceFileName'',
      ''sourceFileSize'', exam_payload -> ''sourceFileSize'',
      ''admissionMode'', coalesce(exam_payload ->> ''admissionMode'', ''key_only'')
    );

    if exam_owner_id is null then
      insert into examination_room_v1.exams (
        id, institution_id, owner_user_id, title, description, status, anonymous_grading,
        admission_mode, allowed_emails
      ) values (
        exam_id,
        p_institution_id,
        p_actor_user_id,
        exam_payload ->> ''title'',
        nullif(exam_payload ->> ''instructions'', ''''),
        ''draft'',
        use_anonymous_grading,
        coalesce(exam_payload ->> ''admissionMode'', ''key_only''),
        examination_room_v1.normalized_allowed_emails(exam_payload -> ''allowedEmails'')
      );
    else
      update examination_room_v1.exams e
      set title = exam_payload ->> ''title'',
          description = nullif(exam_payload ->> ''instructions'', ''''),
          admission_mode = coalesce(exam_payload ->> ''admissionMode'', ''key_only''),
          allowed_emails = examination_room_v1.normalized_allowed_emails(exam_payload -> ''allowedEmails'')
      where e.id = exam_id;
    end if;

    select v.id, v.version_number
    into version_id, version_number
    from examination_room_v1.exam_versions v
    where v.exam_id = exam_id
      and v.publication_status = ''building''
    order by v.version_number desc
    limit 1
    for update;

    if version_id is null then
      select coalesce(max(v.version_number), 0) + 1
      into version_number
      from examination_room_v1.exam_versions v
      where v.exam_id = exam_id;
      version_id := gen_random_uuid();
      insert into examination_room_v1.exam_versions (
        id, exam_id, institution_id, version_number, title_snapshot, instructions,
        duration_seconds, anonymous_grading_snapshot, privacy_notice_version_id,
        controls, content_sha256, admission_mode_snapshot, allowed_emails_snapshot
      ) values (
        version_id,
        exam_id,
        p_institution_id,
        version_number,
        exam_payload ->> ''title'',
        coalesce(exam_payload ->> ''instructions'', ''''),
        greatest(60, least(86400, coalesce((exam_payload ->> ''durationMinutes'')::integer, 120) * 60)),
        use_anonymous_grading,
        notice_id,
        controls_payload,
        examination_room_v1.jsonb_sha256(draft_payload),
        coalesce(exam_payload ->> ''admissionMode'', ''key_only''),
        examination_room_v1.normalized_allowed_emails(exam_payload -> ''allowedEmails'')
      );
    else
      update examination_room_v1.exam_versions v
      set title_snapshot = exam_payload ->> ''title'',
          instructions = coalesce(exam_payload ->> ''instructions'', ''''),
          duration_seconds = greatest(60, least(86400, coalesce((exam_payload ->> ''durationMinutes'')::integer, 120) * 60)),
          anonymous_grading_snapshot = use_anonymous_grading,
          privacy_notice_version_id = notice_id,
          controls = controls_payload,
          content_sha256 = examination_room_v1.jsonb_sha256(draft_payload),
          admission_mode_snapshot = coalesce(exam_payload ->> ''admissionMode'', ''key_only''),
          allowed_emails_snapshot = examination_room_v1.normalized_allowed_emails(exam_payload -> ''allowedEmails'')
      where v.id = version_id;
      delete from examination_room_v1.questions q where q.exam_version_id = version_id;
    end if;

    insert into examination_room_v1.questions (
      exam_version_id, position, question_key, question_kind, prompt, points, configuration, content_sha256
    )
    select
      version_id,
      coalesce((item.value ->> ''questionNumber'')::integer, item.ordinality::integer),
      item.value ->> ''questionKey'',
      item.value ->> ''questionKind'',
      item.value ->> ''prompt'',
      coalesce((item.value ->> ''points'')::numeric, 0),
      jsonb_build_object(
        ''type'', coalesce(item.value ->> ''type'', replace(item.value ->> ''questionKind'', ''_'', ''-'')),
        ''gradingGuidance'', coalesce(item.value ->> ''gradingGuidance'', ''''),
        ''wordLimit'', item.value -> ''wordLimit'',
        ''choices'', coalesce(item.value -> ''choices'', ''[]''::jsonb),
        ''correctOptionIndex'', item.value -> ''correctOptionIndex'',
        ''acceptedAnswers'', coalesce(item.value -> ''acceptedAnswers'', ''[]''::jsonb)
      ),
      examination_room_v1.jsonb_sha256(item.value)
    from jsonb_array_elements(coalesce(exam_payload -> ''questions'', ''[]''::jsonb)) with ordinality item(value, ordinality);

    update examination_room_v1.exam_roster er
    set roster_status = ''withdrawn''
    from examination_room_v1.student_identities si
    where er.exam_id = exam_id
      and er.student_identity_id = si.id
      and er.roster_status in (''invited'', ''eligible'')
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(exam_payload -> ''roster'', ''[]''::jsonb)) incoming(value)
        where upper(incoming.value ->> ''studentNumber'') = si.external_student_id
      );

    for roster_item in
      select value from jsonb_array_elements(coalesce(exam_payload -> ''roster'', ''[]''::jsonb))
    loop
      insert into examination_room_v1.student_identities (
        institution_id, external_student_id, full_name, email_normalized,
        identity_status, verified_at, verification_method
      ) values (
        p_institution_id,
        upper(roster_item ->> ''studentNumber''),
        roster_item ->> ''fullName'',
        lower(roster_item ->> ''email''),
        ''active'',
        requested_at,
        ''registrar_import''
      )
      on conflict (institution_id, external_student_id) do update
      set full_name = excluded.full_name,
          email_normalized = excluded.email_normalized,
          identity_status = ''active'',
          verified_at = excluded.verified_at,
          verification_method = excluded.verification_method
      returning id into student_identity_id;

      roster_row_id := gen_random_uuid();
      insert into examination_room_v1.exam_roster (
        id, exam_id, institution_id, student_identity_id, grading_alias,
        roster_status, accommodations, added_by_user_id
      ) values (
        roster_row_id,
        exam_id,
        p_institution_id,
        student_identity_id,
        case when use_anonymous_grading then ''CAND-'' || upper(substr(replace(roster_row_id::text, ''-'', ''''), 1, 8)) else null end,
        ''eligible'',
        jsonb_build_object(
          ''clientId'', roster_item -> ''clientId'',
          ''subject'', roster_item ->> ''subject'',
          ''yearLevel'', roster_item ->> ''yearLevel'',
          ''extraMinutes'', coalesce((roster_item ->> ''extraMinutes'')::integer, 0)
        ),
        p_actor_user_id
      )
      on conflict on constraint exam_roster_exam_student_key do update
      set roster_status = ''eligible'',
          grading_alias = coalesce(examination_room_v1.exam_roster.grading_alias, excluded.grading_alias),
          accommodations = excluded.accommodations;
    end loop;

    select count(*) into question_count
    from examination_room_v1.questions q where q.exam_version_id = version_id;
    select count(*) into roster_count
    from examination_room_v1.exam_roster er
    where er.exam_id = exam_id and er.roster_status in (''invited'', ''eligible'');

    if p_operation = ''publish'' then
      if question_count = 0 then
        return examination_room_v1.api_error(
          ''PUBLICATION_NOT_READY'', ''Publishing requires at least one question.'', 409,
          ''Add at least one complete question, then publish again.''
        );
      end if;

      publication_bundle := examination_room_v1.build_publication_manifest(version_id, requested_at);
      publication_hash := examination_room_v1.jsonb_sha256(publication_bundle);
      update examination_room_v1.exam_versions v
      set publication_manifest = publication_bundle,
          content_sha256 = publication_hash,
          publication_status = ''published'',
          published_by_user_id = p_actor_user_id,
          published_at = requested_at
      where v.id = version_id;

      update examination_room_v1.exams e
      set status = ''published'',
          anonymous_grading = use_anonymous_grading,
          current_published_version_id = version_id,
          closed_at = null
      where e.id = exam_id;

      insert into examination_room_v1.recovery_snapshots (
        exam_id, exam_version_id, snapshot_sequence, snapshot_scope, request_hash,
        record_count, snapshot_status, created_by_user_id, retention_until
      ) values (
        exam_id,
        version_id,
        examination_room_v1.next_snapshot_sequence(exam_id),
        ''exam_definition'',
        request_hash,
        question_count + roster_count,
        ''pending'',
        p_actor_user_id,
        requested_at + interval ''365 days''
      );

      response := jsonb_build_object(
        ''ok'', true,
        ''examId'', exam_id,
        ''versionId'', version_id,
        ''version'', version_number,
        ''status'', ''published'',
        ''publicationHash'', publication_hash,
        ''publicationManifest'', publication_bundle
      );
    else
      response := jsonb_build_object(
        ''ok'', true,
        ''examId'', exam_id,
        ''versionId'', version_id,
        ''version'', version_number,
        ''status'', ''draft'',
        ''questionCount'', question_count,
        ''rosterCount'', roster_count
      );
    end if;

    perform examination_room_v1.api_record_audit(
      p_institution_id, exam_id, null, p_actor_user_id, ''professor'',
      ''professor.'' || p_operation, ''exam'', exam_id, request_hash,
      requested_at, response, null
    );
    return response;
  end if;

  if p_operation in (''open_room'', ''close_room'') then
    request_hash := p_payload ->> ''requestHash'';
    event_time := coalesce(
      (p_payload ->> case when p_operation = ''open_room'' then ''openedAt'' else ''closedAt'' end)::timestamptz,
      clock_timestamp()
    );
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(p_institution_id, request_hash, ''professor.'' || p_operation);
    if replay is not null then return replay; end if;

    if p_operation = ''open_room'' then
      select a.id, a.activation_status
      into version_id, room_activation_status
      from examination_room_v1.room_activations a
      where a.exam_id = exam_id
        and a.institution_id = p_institution_id
        and a.activation_status in (''scheduled'', ''open'')
        and a.closes_at > event_time
      order by (a.activation_status = ''scheduled'') desc, a.created_at desc, a.id desc
      limit 1
      for update;

      if version_id is null then
        return examination_room_v1.api_error(
          ''ROOM_ACTIVATION_NOT_FOUND'', ''The administrator has not approved and generated a student key yet.'', 409,
          ''Request a key, then wait for the administrator to approve this examination.''
        );
      end if;

      if room_activation_status = ''scheduled'' then
        update examination_room_v1.room_activations a
        set activation_status = ''open'',
            opens_at = least(a.opens_at, event_time, clock_timestamp()),
            deactivated_at = null,
            deactivated_by_user_id = null,
            deactivation_reason = null
        where a.id = version_id;
      end if;
      response := jsonb_build_object(
        ''ok'', true,
        ''examId'', exam_id,
        ''activationId'', version_id,
        ''activation'', jsonb_build_object(''id'', version_id, ''status'', ''open''),
        ''status'', ''open''
      );
    else
      update examination_room_v1.room_activations a
      set activation_status = ''closed'',
          deactivated_at = event_time,
          deactivated_by_user_id = p_actor_user_id,
          deactivation_reason = ''Professor closed the examination room.''
      where a.exam_id = exam_id
        and a.institution_id = p_institution_id
        and a.activation_status in (''scheduled'', ''open'');

      update examination_room_v1.student_sessions s
      set session_status = ''expired'', ended_at = coalesce(s.ended_at, event_time)
      where s.exam_id = exam_id
        and s.institution_id = p_institution_id
        and s.session_status in (''created'', ''active'');

      update examination_room_v1.exams e
      set status = ''closed'', closed_at = event_time
      where e.id = exam_id and e.status in (''published'', ''closed'');
      response := jsonb_build_object(''ok'', true, ''examId'', exam_id, ''status'', ''closed'');
    end if;

    perform examination_room_v1.api_record_audit(
      p_institution_id, exam_id, null, p_actor_user_id, ''professor'',
      ''professor.'' || p_operation, ''exam'', exam_id, request_hash, event_time, response, null
    );
    return response;
  end if;

  if p_operation = ''save_grade'' then
    request_hash := p_payload ->> ''requestHash'';
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(p_institution_id, request_hash, ''professor.save_grade'');
    if replay is not null then return replay; end if;
    grading_manifest := p_payload -> ''gradingManifest'';

    select sub.id, sub.exam_version_id, sub.submission_manifest ->> ''publicationHash'', ss.id
    into submission_id, exam_version_id, publication_hash, student_session_id
    from examination_room_v1.student_sessions ss
    join examination_room_v1.submissions sub on sub.session_id = ss.id
    join examination_room_v1.exams e on e.id = ss.exam_id
    where (
        (not e.anonymous_grading and ss.id = (p_payload ->> ''sessionId'')::uuid)
        or (
          e.anonymous_grading
          and examination_room_v1.uuid_from_hash(sub.idempotency_key_hash) = (p_payload ->> ''sessionId'')::uuid
        )
      )
      and ss.exam_id = exam_id
      and ss.institution_id = p_institution_id
      and sub.submission_status = ''accepted''
    for update of sub;

    if submission_id is null then
      return examination_room_v1.api_error(
        ''SUBMISSION_NOT_FOUND'', ''The student has no accepted submission to grade.'', 409,
        ''Refresh grading after the student submits.''
      );
    end if;

    if jsonb_typeof(grading_manifest) is distinct from ''object''
       or coalesce(grading_manifest ->> ''schemaVersion'', '''') <> ''examination-room/grading/v1''
       or grading_manifest ->> ''submissionId'' is null
       or (grading_manifest ->> ''submissionId'')::uuid <> submission_id
       or grading_manifest ->> ''publicationHash'' <> publication_hash
       or grading_manifest ->> ''graderId'' is null
       or (grading_manifest ->> ''graderId'')::uuid <> p_actor_user_id
       or coalesce(grading_manifest ->> ''status'', '''') <> ''draft'' then
      return examination_room_v1.api_error(
        ''GRADING_MANIFEST_INVALID'', ''The grading evidence is not bound to this submission and signed-in professor.'', 409,
        ''Refresh grading, review the scores, then save again.''
      );
    end if;

    grade_revision_number := (grading_manifest ->> ''revision'')::integer;
    if grade_revision_number <> coalesce((select max(g.revision_number) from examination_room_v1.grade_revisions g where g.submission_id = submission_id), 0) + 1 then
      return examination_room_v1.api_error(
        ''GRADE_REVISION_CONFLICT'', ''A newer grading revision already exists.'', 409,
        ''Refresh the grading view, review the latest scores, then save again.''
      );
    end if;

    score_count := jsonb_array_length(coalesce(grading_manifest -> ''scores'', ''[]''::jsonb));
    total_score := coalesce((grading_manifest ->> ''totalPointsAwarded'')::numeric, 0);
    maximum_score := coalesce((grading_manifest ->> ''maxPoints'')::numeric, 0);
    select
      count(*)::integer,
      count(distinct q.id)::integer,
      coalesce(sum((score.value ->> ''pointsAwarded'')::numeric), 0),
      coalesce(sum(q.points), 0)
    into question_count, distinct_score_count, total_score, maximum_score
    from jsonb_array_elements(coalesce(grading_manifest -> ''scores'', ''[]''::jsonb)) score(value)
    join examination_room_v1.questions q
      on q.exam_version_id = exam_version_id
     and q.position = (score.value ->> ''questionNumber'')::integer
     and q.question_key = score.value ->> ''questionKey''
     and q.points = (score.value ->> ''maxPoints'')::numeric
    where (score.value ->> ''pointsAwarded'')::numeric between 0 and q.points;

    if question_count <> score_count
       or distinct_score_count <> score_count
       or coalesce((grading_manifest ->> ''scoreCount'')::integer, -1) <> score_count
       or total_score <> coalesce((grading_manifest ->> ''totalPointsAwarded'')::numeric, 0)
       or maximum_score <> coalesce((grading_manifest ->> ''maxPoints'')::numeric, 0) then
      return examination_room_v1.api_error(
        ''GRADING_MANIFEST_INVALID'', ''The grading manifest does not match this examination version.'', 409,
        ''Refresh grading, review the scores, then save again.''
      );
    end if;
    grade_revision_id := (grading_manifest ->> ''revisionId'')::uuid;
    insert into examination_room_v1.grade_revisions (
      id, submission_id, exam_version_id, revision_number, client_revision_id,
      manifest_sha256, grading_manifest, grader_user_id, source, grade_status,
      item_count, total_score, maximum_score, general_feedback
    ) values (
      grade_revision_id,
      submission_id,
      exam_version_id,
      grade_revision_number,
      (p_payload ->> ''clientRevisionId'')::uuid,
      p_payload ->> ''gradingHash'',
      grading_manifest,
      p_actor_user_id,
      ''online'',
      grading_manifest ->> ''status'',
      score_count,
      total_score,
      maximum_score,
      grading_manifest ->> ''overallFeedback''
    );

    for score_item in select value from jsonb_array_elements(coalesce(grading_manifest -> ''scores'', ''[]''::jsonb))
    loop
      select q.id into question_id
      from examination_room_v1.questions q
      where q.exam_version_id = exam_version_id
        and q.position = (score_item ->> ''questionNumber'')::integer
        and q.question_key = score_item ->> ''questionKey'';
      insert into examination_room_v1.grade_revision_items (
        grade_revision_id, exam_version_id, question_id, score, maximum_score, feedback
      ) values (
        grade_revision_id,
        exam_version_id,
        question_id,
        (score_item ->> ''pointsAwarded'')::numeric,
        (score_item ->> ''maxPoints'')::numeric,
        score_item ->> ''feedback''
      );
    end loop;

    response := jsonb_build_object(
      ''ok'', true,
      ''revision'', jsonb_build_object(
        ''id'', grade_revision_id,
        ''revision'', grade_revision_number,
        ''status'', grading_manifest ->> ''status'',
        ''totalPointsAwarded'', total_score,
        ''maxPoints'', maximum_score
      )
    );
    perform examination_room_v1.api_record_audit(
      p_institution_id, exam_id, student_session_id, p_actor_user_id, ''professor'',
      ''professor.save_grade'', ''grade_revision'', grade_revision_id, request_hash,
      clock_timestamp(), response, (p_payload ->> ''clientRevisionId'')::uuid
    );
    return response;
  end if;

  if p_operation = ''release_results'' then
    request_hash := p_payload ->> ''requestHash'';
    perform set_config(''examination_room_v1.release_batch_request_hash'', request_hash, true);
    perform set_config(
      ''examination_room_v1.release_batch_count'',
      coalesce(jsonb_array_length(p_payload -> ''releases''), 0)::text,
      true
    );
    perform examination_room_v1.lock_request(p_institution_id, request_hash);
    replay := examination_room_v1.api_replay(p_institution_id, request_hash, ''professor.release_results'');
    if replay is not null then return replay; end if;

    if jsonb_typeof(p_payload -> ''releases'') <> ''array''
       or jsonb_typeof(p_payload -> ''sessionIds'') <> ''array''
       or jsonb_array_length(p_payload -> ''releases'') = 0
       or jsonb_array_length(p_payload -> ''releases'') <> jsonb_array_length(p_payload -> ''sessionIds'')
       or (
         select count(distinct item.value ->> ''sessionId'')
         from jsonb_array_elements(p_payload -> ''releases'') item(value)
       ) <> jsonb_array_length(p_payload -> ''releases'')
       or exists (
         select 1
         from jsonb_array_elements(p_payload -> ''releases'') item(value)
         where not exists (
           select 1
           from jsonb_array_elements_text(p_payload -> ''sessionIds'') selected(value)
           where selected.value = item.value ->> ''sessionId''
         )
       ) then
      return examination_room_v1.api_error(
        ''GRADING_CONTEXT_INVALID'', ''The release set does not match the selected students.'', 409,
        ''Refresh grading, review the recipient list, then release again.''
      );
    end if;

    -- Validate and lock the complete batch before the first append-only write.
    for release_item in select value from jsonb_array_elements(p_payload -> ''releases'')
    loop
      grading_manifest := release_item -> ''gradingManifest'';
      release_manifest := release_item -> ''releaseManifest'';
      select sub.id, sub.exam_version_id, sub.submission_manifest ->> ''publicationHash''
      into submission_id, exam_version_id, publication_hash
      from examination_room_v1.student_sessions ss
      join examination_room_v1.submissions sub on sub.session_id = ss.id
      join examination_room_v1.exams e on e.id = ss.exam_id
      where (
          (not e.anonymous_grading and ss.id = (release_item ->> ''sessionId'')::uuid)
          or (
            e.anonymous_grading
            and examination_room_v1.uuid_from_hash(sub.idempotency_key_hash) = (release_item ->> ''sessionId'')::uuid
          )
        )
        and ss.exam_id = exam_id
        and ss.institution_id = p_institution_id
        and sub.submission_status = ''accepted''
      for update of sub;

      if submission_id is null
         or coalesce(grading_manifest ->> ''schemaVersion'', '''') <> ''examination-room/grading/v1''
         or coalesce(grading_manifest ->> ''status'', '''') <> ''final''
         or grading_manifest ->> ''submissionId'' is null
         or (grading_manifest ->> ''submissionId'')::uuid <> submission_id
         or grading_manifest ->> ''graderId'' is null
         or (grading_manifest ->> ''graderId'')::uuid <> p_actor_user_id
         or grading_manifest ->> ''publicationHash'' <> publication_hash
         or coalesce(release_manifest ->> ''schemaVersion'', '''') <> ''examination-room/result-release/v1''
         or release_manifest ->> ''submissionId'' is null
         or (release_manifest ->> ''submissionId'')::uuid <> submission_id
         or release_manifest ->> ''publicationHash'' <> publication_hash
         or release_manifest ->> ''selectedRevisionId'' is null
         or (release_manifest ->> ''selectedRevisionId'')::uuid <> (grading_manifest ->> ''revisionId'')::uuid
         or coalesce((release_manifest ->> ''selectedRevision'')::integer, -1) <> (grading_manifest ->> ''revision'')::integer
         or release_manifest ->> ''releasedBy'' is null
         or (release_manifest ->> ''releasedBy'')::uuid <> p_actor_user_id
         or (release_manifest ->> ''releasedAt'')::timestamptz < (grading_manifest ->> ''gradedAt'')::timestamptz then
        return examination_room_v1.api_error(
          ''GRADING_CONTEXT_INVALID'', ''A selected student has invalid release or grading evidence.'', 409,
          ''Refresh grading and review the recipient list.''
        );
      end if;

      grade_revision_number := (grading_manifest ->> ''revision'')::integer;
      if grade_revision_number <> coalesce((select max(g.revision_number) from examination_room_v1.grade_revisions g where g.submission_id = submission_id), 0) + 1 then
        return examination_room_v1.api_error(
          ''GRADE_REVISION_CONFLICT'', ''A selected submission changed after release preparation.'', 409,
          ''Refresh grading, review the latest scores, then release again.''
        );
      end if;

      score_count := jsonb_array_length(coalesce(grading_manifest -> ''scores'', ''[]''::jsonb));
      select
        count(*)::integer,
        count(distinct q.id)::integer,
        coalesce(sum((score.value ->> ''pointsAwarded'')::numeric), 0),
        coalesce(sum(q.points), 0)
      into question_count, distinct_score_count, total_score, maximum_score
      from jsonb_array_elements(coalesce(grading_manifest -> ''scores'', ''[]''::jsonb)) score(value)
      join examination_room_v1.questions q
        on q.exam_version_id = exam_version_id
       and q.position = (score.value ->> ''questionNumber'')::integer
       and q.question_key = score.value ->> ''questionKey''
       and q.points = (score.value ->> ''maxPoints'')::numeric
      where (score.value ->> ''pointsAwarded'')::numeric between 0 and q.points;

      if question_count <> score_count
         or distinct_score_count <> score_count
         or question_count <> (select count(*) from examination_room_v1.questions q where q.exam_version_id = exam_version_id)
         or coalesce((grading_manifest ->> ''scoreCount'')::integer, -1) <> score_count
         or total_score <> (grading_manifest ->> ''totalPointsAwarded'')::numeric
         or maximum_score <> (grading_manifest ->> ''maxPoints'')::numeric then
        return examination_room_v1.api_error(
          ''GRADING_INCOMPLETE'', ''Every question must have a valid final score before release.'', 409,
          ''Score every question, review the totals, then release again.''
        );
      end if;

      expected_result := jsonb_build_object(
        ''gradedAt'', grading_manifest -> ''gradedAt'',
        ''scores'', grading_manifest -> ''scores'',
        ''totalPointsAwarded'', grading_manifest -> ''totalPointsAwarded'',
        ''maxPoints'', grading_manifest -> ''maxPoints'',
        ''overallFeedback'', grading_manifest -> ''overallFeedback''
      );
      if release_manifest -> ''result'' is distinct from expected_result then
        return examination_room_v1.api_error(
          ''RESULT_RELEASE_MISMATCH'', ''The student-facing result does not exactly match the final grade revision.'', 409,
          ''Refresh grading, review the final scores, then release again.''
        );
      end if;
    end loop;

    score_count := 0;

    for release_item in select value from jsonb_array_elements(coalesce(p_payload -> ''releases'', ''[]''::jsonb))
    loop
      grading_manifest := release_item -> ''gradingManifest'';
      select sub.id, sub.exam_version_id, sub.submission_manifest ->> ''publicationHash''
      into submission_id, exam_version_id, publication_hash
      from examination_room_v1.student_sessions ss
      join examination_room_v1.submissions sub on sub.session_id = ss.id
      join examination_room_v1.exams e on e.id = ss.exam_id
      where (
          (not e.anonymous_grading and ss.id = (release_item ->> ''sessionId'')::uuid)
          or (
            e.anonymous_grading
            and examination_room_v1.uuid_from_hash(sub.idempotency_key_hash) = (release_item ->> ''sessionId'')::uuid
          )
        )
        and ss.exam_id = exam_id
        and ss.institution_id = p_institution_id
        and sub.submission_status = ''accepted''
      for update of sub;

      if submission_id is null then
        return examination_room_v1.api_error(
          ''GRADING_CONTEXT_INVALID'', ''A selected student has no accepted submission.'', 409,
          ''Refresh grading and review the recipient list.''
        );
      end if;

      grade_revision_number := (grading_manifest ->> ''revision'')::integer;
      if grade_revision_number <> coalesce((select max(g.revision_number) from examination_room_v1.grade_revisions g where g.submission_id = submission_id), 0) + 1 then
        return examination_room_v1.api_error(
          ''GRADE_REVISION_CONFLICT'', ''A selected submission changed after release preparation.'', 409,
          ''Refresh grading, review the latest scores, then release again.''
        );
      end if;

      grade_revision_id := (grading_manifest ->> ''revisionId'')::uuid;
      insert into examination_room_v1.grade_revisions (
        id, submission_id, exam_version_id, revision_number, client_revision_id,
        manifest_sha256, grading_manifest, grader_user_id, source, grade_status,
        item_count, total_score, maximum_score, general_feedback
      ) values (
        grade_revision_id,
        submission_id,
        exam_version_id,
        grade_revision_number,
        examination_room_v1.uuid_from_hash(release_item ->> ''releaseRequestHash''),
        release_item ->> ''gradingHash'',
        grading_manifest,
        p_actor_user_id,
        ''online'',
        ''final'',
        jsonb_array_length(coalesce(grading_manifest -> ''scores'', ''[]''::jsonb)),
        (grading_manifest ->> ''totalPointsAwarded'')::numeric,
        (grading_manifest ->> ''maxPoints'')::numeric,
        grading_manifest ->> ''overallFeedback''
      );

      for score_item in select value from jsonb_array_elements(coalesce(grading_manifest -> ''scores'', ''[]''::jsonb))
      loop
        select q.id into question_id
        from examination_room_v1.questions q
        where q.exam_version_id = exam_version_id
          and q.position = (score_item ->> ''questionNumber'')::integer
          and q.question_key = score_item ->> ''questionKey'';
        insert into examination_room_v1.grade_revision_items (
          grade_revision_id, exam_version_id, question_id, score, maximum_score, feedback
        ) values (
          grade_revision_id,
          exam_version_id,
          question_id,
          (score_item ->> ''pointsAwarded'')::numeric,
          (score_item ->> ''maxPoints'')::numeric,
          score_item ->> ''feedback''
        );
      end loop;

      insert into examination_room_v1.result_releases (
        id, submission_id, grade_revision_id, release_action, channel,
        idempotency_key_hash, batch_request_hash, manifest_sha256, release_manifest,
        performed_by_user_id, occurred_at
      ) values (
        ((release_item -> ''releaseManifest'') ->> ''releaseId'')::uuid,
        submission_id,
        grade_revision_id,
        ''release'',
        ''student_portal'',
        release_item ->> ''releaseRequestHash'',
        request_hash,
        release_item ->> ''releaseHash'',
        release_item -> ''releaseManifest'',
        p_actor_user_id,
        (((release_item -> ''releaseManifest'') ->> ''releasedAt''))::timestamptz
      );
      score_count := score_count + 1;
    end loop;

    if score_count <> jsonb_array_length(coalesce(p_payload -> ''sessionIds'', ''[]''::jsonb)) then
      return examination_room_v1.api_error(
        ''GRADING_CONTEXT_INVALID'', ''The release set does not match the selected students.'', 409,
        ''Refresh grading, review the recipient list, then release again.''
      );
    end if;

    response := jsonb_build_object(''ok'', true, ''released'', score_count);
    perform examination_room_v1.api_record_audit(
      p_institution_id, exam_id, null, p_actor_user_id, ''professor'',
      ''professor.release_results'', ''exam'', exam_id, request_hash,
      clock_timestamp(), response, null
    );
    return response;
  end if;

  return examination_room_v1.api_error(
    ''UNKNOWN_OPERATION'', ''The professor operation is not implemented.'', 400,
    ''Refresh Examination Room and try a listed action.''
  );
end;
$function$
';
  EXECUTE 'CREATE OR REPLACE FUNCTION examination_room_v1.api_professor_view(p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_exam_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''pg_catalog''
AS $function$
#variable_conflict use_variable
declare
  target_exam examination_room_v1.exams%rowtype;
  response jsonb;
begin
  select exam.* into target_exam
  from examination_room_v1.exams exam
  where exam.id = p_exam_id
    and exam.institution_id = p_institution_id;

  if target_exam.id is null then
    return examination_room_v1.api_error(
      ''EXAM_NOT_FOUND'', ''The examination does not exist in this workspace.'', 404,
      ''Return to the Examination Room list and choose an available examination.''
    );
  end if;
  if target_exam.owner_user_id <> p_actor_user_id
     and not examination_room_v1.owner_authorized(p_actor_user_id) then
    return examination_room_v1.api_error(
      ''FORBIDDEN'', ''Only the examination creator or a platform owner may open this examination.'', 403,
      ''Choose an examination created by your signed-in account.''
    );
  end if;

  if p_operation = ''monitor'' then
    select jsonb_build_object(
      ''ok'', true,
      ''exam'', jsonb_build_object(
        ''id'', exam.id,
        ''examId'', exam.id,
        ''title'', exam.title,
        ''description'', exam.description,
        ''status'', exam.status,
        ''anonymousGrading'', exam.anonymous_grading,
        ''currentPublishedVersionId'', exam.current_published_version_id
      ),
      ''activation'', (
        select jsonb_build_object(
          ''id'', activation.id,
          ''status'', activation.activation_status,
          ''opensAt'', activation.opens_at,
          ''closesAt'', activation.closes_at,
          ''expiresAt'', activation.closes_at,
          ''maxSessions'', activation.max_sessions,
          ''createdAt'', activation.created_at
        )
        from examination_room_v1.room_activations activation
        where activation.exam_id = exam.id
        order by activation.created_at desc, activation.id desc
        limit 1
      ),
      ''sessions'', coalesce((
        select jsonb_agg(jsonb_build_object(
          ''id'', session.id,
          ''sessionId'', session.id,
          ''examId'', session.exam_id,
          ''fullName'', identity.full_name,
          ''studentNumber'', identity.external_student_id,
          ''yearLevel'', roster.accommodations ->> ''yearLevel'',
          ''subject'', roster.accommodations ->> ''subject'',
          ''status'', session.session_status,
          ''connected'', coalesce((session.session_metadata ->> ''connected'')::boolean, false),
          ''currentQuestion'', session.session_metadata -> ''currentQuestion'',
          ''consentVersion'', (
            select notice.notice_code
            from examination_room_v1.privacy_acceptances acceptance
            join examination_room_v1.privacy_notice_versions notice
              on notice.id = acceptance.notice_version_id
            where acceptance.session_id = session.id
              and acceptance.decision = ''accepted''
            order by acceptance.recorded_at desc, acceptance.id desc
            limit 1
          ),
          ''startedAt'', session.started_at,
          ''lastSeenAt'', coalesce(session.last_heartbeat_at, session.updated_at, session.started_at),
          ''endedAt'', session.ended_at
        ) order by identity.full_name, session.started_at, session.id)
        from examination_room_v1.student_sessions session
        join examination_room_v1.exam_roster roster on roster.id = session.roster_id
        join examination_room_v1.student_identities identity on identity.id = roster.student_identity_id
        where session.exam_id = exam.id
      ), ''[]''::jsonb),
      ''submissions'', coalesce((
        select jsonb_agg(jsonb_build_object(
          ''id'', submission.id,
          ''submissionId'', submission.id,
          ''sessionId'', submission.session_id,
          ''status'', submission.submission_status,
          ''submissionStatus'', submission.submission_status,
          ''submittedAt'', submission.received_at,
          ''receivedAt'', submission.received_at,
          ''receiptCode'', receipt.receipt_code,
          ''receiptId'', receipt.id,
          ''answerCount'', submission.answer_count
        ) order by submission.received_at, submission.id)
        from examination_room_v1.submissions submission
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        left join examination_room_v1.submission_receipts receipt on receipt.submission_id = submission.id
        where session.exam_id = exam.id
      ), ''[]''::jsonb),
      ''incidents'', coalesce((
        select jsonb_agg(jsonb_build_object(
          ''id'', incident.id,
          ''sessionId'', incident.session_id,
          ''type'', incident.incident_kind,
          ''severity'', incident.severity,
          ''occurredAt'', incident.occurred_at,
          ''durationMs'', incident.duration_ms,
          ''details'', incident.details,
          ''reviewStatus'', incident.review_status
        ) order by incident.occurred_at, incident.id)
        from examination_room_v1.proctoring_incidents incident
        join examination_room_v1.student_sessions session on session.id = incident.session_id
        where session.exam_id = exam.id
      ), ''[]''::jsonb),
      ''generatedAt'', clock_timestamp()
    ) into response
    from examination_room_v1.exams exam
    where exam.id = target_exam.id;
    return response;
  end if;

  if p_operation = ''grading'' then
    select jsonb_build_object(
      ''ok'', true,
      ''exam'', jsonb_build_object(
        ''id'', exam.id,
        ''examId'', exam.id,
        ''title'', exam.title,
        ''description'', exam.description,
        ''status'', exam.status,
        ''anonymousGrading'', exam.anonymous_grading,
        ''currentPublishedVersionId'', exam.current_published_version_id
      ),
      ''sessions'', coalesce((
        select jsonb_agg(jsonb_build_object(
          ''id'', case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end,
          ''sessionId'', case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end,
          -- This view is already limited to the exact exam creator or a
          -- Founder/Super Admin. Return both real and grading identities so
          -- the Professor-controlled UI may mask or reveal them at any time.
          ''fullName'', identity.full_name,
          ''studentNumber'', identity.external_student_id,
          ''realFullName'', identity.full_name,
          ''realStudentNumber'', identity.external_student_id,
          ''yearLevel'', roster.accommodations ->> ''yearLevel'',
          ''subject'', roster.accommodations ->> ''subject'',
          ''gradingAlias'', roster.grading_alias,
          ''identityMode'', case when exam.anonymous_grading then ''anonymous_grading'' else ''real_names'' end,
          ''status'', session.session_status,
          ''submittedAt'', submission.received_at
        ) order by submission.received_at, submission.id)
        from examination_room_v1.submissions submission
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        join examination_room_v1.exam_roster roster on roster.id = session.roster_id
        join examination_room_v1.student_identities identity on identity.id = roster.student_identity_id
        where session.exam_id = exam.id
          and submission.submission_status = ''accepted''
      ), ''[]''::jsonb),
      ''submissions'', coalesce((
        select jsonb_agg(jsonb_build_object(
          ''id'', submission.id,
          ''submissionId'', submission.id,
          ''sessionId'', case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end,
          ''status'', submission.submission_status,
          ''submissionStatus'', submission.submission_status,
          ''submittedAt'', submission.received_at,
          ''receivedAt'', submission.received_at,
          ''receiptCode'', receipt.receipt_code,
          ''receiptId'', receipt.id,
          ''answerCount'', submission.answer_count
        ) order by submission.received_at, submission.id)
        from examination_room_v1.submissions submission
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        left join examination_room_v1.submission_receipts receipt on receipt.submission_id = submission.id
        where session.exam_id = exam.id
          and submission.submission_status = ''accepted''
      ), ''[]''::jsonb),
      ''answerRevisions'', coalesce((
        select jsonb_agg(jsonb_build_object(
          ''id'', answer.id,
          ''sessionId'', case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end,
          ''questionId'', question.question_key,
          ''questionNumber'', question.position,
          ''revision'', answer.revision_number,
          ''answer'', answer.answer_payload -> ''answer'',
          ''flagged'', answer.is_flagged,
          ''contentHash'', answer.answer_sha256,
          ''savedAt'', answer.saved_at,
          ''at'', answer.saved_at,
          ''source'', answer.source
        ) order by submission.received_at, question.position, answer.revision_number, answer.id)
        from examination_room_v1.submission_answers selected_answer
        join examination_room_v1.submissions submission on submission.id = selected_answer.submission_id
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        join examination_room_v1.answer_revisions answer on answer.id = selected_answer.answer_revision_id
        join examination_room_v1.questions question on question.id = selected_answer.question_id
        where session.exam_id = exam.id
          and submission.submission_status = ''accepted''
      ), ''[]''::jsonb),
      ''gradeRevisions'', coalesce((
        select jsonb_agg(jsonb_build_object(
          ''id'', grade.id,
          ''sessionId'', case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end,
          ''questionId'', question.question_key,
          ''questionNumber'', question.position,
          ''points'', item.score,
          ''feedback'', coalesce(item.feedback, ''''),
          ''revision'', grade.revision_number,
          ''status'', grade.grade_status,
          ''source'', grade.source,
          ''at'', grade.created_at,
          ''gradedAt'', grade.grading_manifest -> ''gradedAt''
        ) order by submission.received_at, grade.revision_number, question.position, grade.id)
        from examination_room_v1.grade_revisions grade
        join examination_room_v1.grade_revision_items item on item.grade_revision_id = grade.id
        join examination_room_v1.questions question on question.id = item.question_id
        join examination_room_v1.submissions submission on submission.id = grade.submission_id
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        where session.exam_id = exam.id
          and submission.submission_status = ''accepted''
      ), ''[]''::jsonb),
      ''releases'', coalesce((
        select jsonb_agg(jsonb_build_object(
          ''id'', release.id,
          ''sessionIds'', jsonb_build_array(case when exam.anonymous_grading
            then examination_room_v1.uuid_from_hash(submission.idempotency_key_hash)
            else session.id end),
          ''releasedAt'', release.occurred_at,
          ''at'', release.occurred_at,
          ''status'', ''released'',
          ''channel'', release.channel
        ) order by release.occurred_at, release.id)
        from examination_room_v1.result_releases release
        join examination_room_v1.submissions submission on submission.id = release.submission_id
        join examination_room_v1.student_sessions session on session.id = submission.session_id
        where session.exam_id = exam.id
          and release.release_action = ''release''
          and not exists (
            select 1
            from examination_room_v1.result_releases revoked
            where revoked.supersedes_release_id = release.id
              and revoked.release_action = ''revoke''
          )
      ), ''[]''::jsonb),
      ''generatedAt'', clock_timestamp()
    ) into response
    from examination_room_v1.exams exam
    where exam.id = target_exam.id;
    return response;
  end if;

  return examination_room_v1.api_error(
    ''UNKNOWN_OPERATION'', ''That examination creator view is unavailable.'', 400,
    ''Refresh Examination Room and choose Monitor or Grade.''
  );
end;
$function$
';
  DROP TRIGGER student_sessions_open_room_lease ON examination_room_v1.student_sessions;
  DROP FUNCTION examination_room_v1.apply_open_room_lease();
  IF NOT (EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_student(text,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='b2f4901d8f02d6bcae1814a117491da061e94c131432e87f82b150e442bda046' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='78c5e72a4ea24b569eea5153ff1e954162427e869fef50cd045ae2b37b909e19' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.prepare_student_admission(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='263b9b20e8132ccaf946045a6512d813365dd42107296c5b0b2e20302a17a397' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7d60faf31d196c7387604eec0077b8d05055f5f5e959b5bf1fb77042041ba7a7' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.recover_existing_student_session(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='c30d7b63e3cec523180fab0d22603d5c49161d430a4d00f88f319e4f181213b1' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='97b566674e6da2b08c522f738b88065650f71c41289730d95aca342a6fccb4ef' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.examination_room_v1_api(text,text,uuid,uuid,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='9fc7ecec84dcada0860b443b3190cbc4bc93c8b6f1642dcb2e077249357b06ad' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7e4a95085b4db167e38fbddc3c02b0edd61502c80c287c7c68fe2cf404f0d23e' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_professor(text,uuid,uuid,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='75e15930ec34a9683791d53eaa380645bffe48c33ee9c5cd1ada618930c5e294' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a6025f0b8a979c2ef01c9d20849de06661a0f664c88e88e319c8de1762be5d78' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_professor_view(text,uuid,uuid,uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='95da22913df65a696f4bd8b003fb286b61df3c8cd1b01fe7144888a6c713c3ca' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c066ab9b3d82c6e34af8897d35f8b97e3ce9af656512c073aac7a9b980f50840' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND to_regprocedure('examination_room_v1.apply_open_room_lease()') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='examination_room_v1.student_sessions'::regclass AND tgname='student_sessions_open_room_lease')) THEN RAISE EXCEPTION 'PACKAGE_POSTIMAGE_MISMATCH'; END IF;
  IF NOT (EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_admin(text,uuid,uuid,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='7276e6df45b37831883ca9a28bc3b0731de3b4a312369d1104c81da1ecf513dd' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='6657d93aede10f8a3b4e9d38d389d54dc6ef72f3bc1191d2dcb7f6c0856f9125' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_error(text,text,integer,text)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='92d7ff0cb2d931bbd072df5d349a616965ea7383625ad6d59fd39eca77b137e4' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='63b3bc300c697d001bd2e0fdb51e673c598db03d0b654e2551fd098c42d50d0a' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_record_audit(uuid,uuid,uuid,uuid,text,text,text,uuid,text,timestamp with time zone,jsonb,uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='07190f7fcffa5d8b24ba4165d4c9ad7d09ce506e255712ef15f33f0f3986d4a1' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='538afa7098e32587f056d5dc62a9acaa9aee027c0d3430a73acb236cf3d2b9bd' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.api_replay(uuid,text,text)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='9f9ad9f65d49b2f89b1239ce8bb4fdce661805ebe3295ac9821ae9bb7c5cbf63' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='f4fd12d2421e2dce70147e3c0886370ab8a581ac44068364effc9b72da1e305e' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.build_publication_manifest(uuid,timestamp with time zone)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='4a3647c6606454793e632d63db70eaef5fbe86700db343f9874fba5885430cc9' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7df2a2721f3fc16a452479e80ae22367ddf8fcc8b995b319c6e0ed97589c67fc' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.creator_authorized(uuid,uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='a473426aa5bf9c2f559d2b509f47f9c082f8b3fed33845b7a0c1260426f4f5b0' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='8aec9542309e1c01b3edc0ea7c7087b73aeeff740b7ee1dff68b3d59abbc9d4c' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.creator_revoke_session(uuid,uuid,jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='feb9f9e6e2458b3efe6fb1b4e0d562a2793df99a203618ca0f7b21574bf59e39' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='8f1e280682d1249ab23ad729ff4e8b30a85e9f1e683c4cad4fb7a31fe6b51bdc' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.ensure_exam_current_version_published()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e505d487c7d1ccda4e782b2ffad6d1d19a1d127699632c076af304b55e18bc4c' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ae68b6fb25772eca4ac8a3305a54dd785919c2723ab561b97e6a8dfa3a8b87a0' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.ensure_releasable_grade()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='5d92c026833a7acbbe1cdaa44e9a0088fecafd35f47560fd37ec77ff6987fd21' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='4317f150df2c8cc4eb03433a257996abe5c47d70852e5ce0d14e3248e3788768' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.grader_safe_submission_manifest(jsonb,boolean,text,uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='6de4e7c72329e22dc48a5093cbf3220eeb852e06efc22911a25fbfd5e39a4fb3' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='109b502d1dec6f856243dd1b4c8198f75938edade5f842ce6c8bda0cbea510d8' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.json_rows(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='599e4c83c981a0d4e8c68acf89d3fcceb7af630b6d5c01a8e087e78765d01357' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='917518f0cefe5e2d13674efa53ae121fcb869304a7c28c7cbb7de6652d3f40f8' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.jsonb_sha256(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='f9bce66b9a8f68ce44485ad0b86468d446e2998162927dde38265939a3a15875' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='55d8de4f9ad53e6ead49dd9ffca9ffe0e997ba74226413a2e32d3682bcd1518f' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.lock_request(uuid,text)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='465ef70b0cc6f0b854ddd204231b538b16bb9a8fbadd1126598af1250452ebc9' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='fc0331f880070fc45f1cc378816cee90d46b53d87db2d793b2f3abe6fe5eaadd' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.next_snapshot_sequence(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='bf75198d14a274d23d6a50068655085fad79caad79bd0f1a248c5b7c0d80baa7' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='df2db1d17d7b8f8b45c74e89c6c0374807110419117e28a0b41eeabc15e0c46f' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.normalize_default_student_warning()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='9e2d022da93519b500aada19a4beb3bd692e13fa2c9c49985d02d16f3ff420e7' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7fd42c9b5bb0973d808316fa72c35f1a363cbfd0f2498cd2e21f5f26082e2a08' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.normalized_allowed_emails(jsonb)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='34198a6304ef9c1f6f92fd4114a00e1d27208c26241fac8149e2a0a5c41c5275' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='d98533d6b194a90694557a31238ab59ce33df632cf7cffb136cb8a9317695222' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_authorized(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='4bb04bfa47a9fa50ec42f2ebb9c47d2af81a9474cc3355fbc5281d231209a474' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='3574c6b327c5378c12f4d953c4862be199eddbe1e7b86b2b3669fac4a2d93205' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_exam_bundle(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='6b13cb369cdb1c3fb4c6369447dcc1225c5e70a06665aa99291487b99027710d' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c19e0e2777efd12e3b3f8199f69d53d598796e16da53f2acb25afbb504a4cabb' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_exam_bundle_before_result_email(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='ca2e687d64c72872aad61523a4fbefe825cbbaad9acd69c9980e0daef12f940a' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e2fda112c6566c56c3f524594b1660b72c1327318f58e937eb33dd8a1326fcd0' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_snapshot_event_bundle(examination_room_v1.recovery_snapshots)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='5d9fe43b12f40a6d3debafbe4c21e1e270b12b8ac5b0fed8e0e4d717da60ef2a' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='fa24e3d243a8d71fd5f22e698b0354c78eb8cac75633c5b84a8bd42159641346' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.owner_snapshot_payload(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='399b06154a8fbaea7081f9116f8cd1d736f6e014aaef12819e9b8ed4e5a1f3df' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a500a81d55b0d81f5718b52c38f90aea86cd58a8fac4d58afb52a7671352bd39' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.prevent_delete()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='c697643b94d1eb985d076daf1f510834e8be39373aae23b659d9778e7e9f3dbf' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2babad1f225eb542c30e632b215bed9bdaf3fe2fb931d6f6c61011306f1489a2' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.prevent_mutation()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='184d4deaa5678a07c26415a01f0ebae0a8b5e160c67245d8be1959cb5e0c5f69' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='af664f1ce37de88d7994bbb4e7e67db2eebfabd3e0f5dc73a4d7dc002791a692' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_email_delivery_event()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='6c37b44db201da9c2740622b36fedc144e1d891e80e2c8bb1444f7f7cf53a72d' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='3ef1a89d75c15671527f4e0fa8bb38925364131becd594241024e16546bc3c51' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_grade_revision_item_set()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e0cd8fd5c9b2c5e0e3756040a60f74b07644c1f6d9cf26c8f7be5167df524b4d' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='b05845daaa070a8696fd2572605107762b6919ddf06da59e32626136e159487b' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_professor_access_request_history()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='6cc89d9726b20f9920a250d59640d6bde0834b78ef83a44b75e02a0c0b1b9d6d' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='659f2beff2f8ba1f6773f650eb120cc515b8ccbc9b4ada30516537da883318d1' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_published_question()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='4773e7cfc9cad7b2e5fc853a70c6bddab5f9f00922f9119f6cf45073bf03a4ff' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='191a7975701371fa890ee878aa5816bba36b9e02cf797a3ec4864739149c08f2' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_recovery_snapshot()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='1fde5878173075071ed8ccd74b1792d9c043c7bdf7055701ce8f7070c1f97739' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='f2259c5dd84c19500d3b98dcf478a0ce1fa80686382d3e4350847618cfa0fe6d' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_staff_membership_history()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='a79aaa26edbe8c60d215554e8f7c7a26c4cedc3a6d953dcde8507dfa78c75da5' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e7263f3cbf7811cd6e13e2f5225dafb6baa00d6d126c7cf849742dcf67fa9b96' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_student_session_binding()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='802b52b6d076c21d36d830a92740fa683af36302809384a6ed0da06de574f40e' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7030894f8c4692b5adb5605d2f9068538ff4814a9d4a041f3bcde091d25f2fed' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.protect_submission_answer_set()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='90466c13788a7d464d08d67d6a3a5b68210883140ab2e57a335f6750d790716c' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c950ba3d5ce84b1590b6be154013ca5abe8c6b12dd9eeea54fbeeee028908f2e' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.queue_grading_snapshot()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e555ae1bbd482820fe834c4ff0806f6fdb52d2b296f593431b5f756168de4d74' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='07758f4327ded35900e2ef3f8b932474d52163e28a546e6a8be450bc08ccc0a7' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.seal_exam_version()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='eb8234aad39b21203994085df20faf3c1744071e8bd05384620593bb51074415' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c9c148a6d6182da7e5f8b8cde3c66de4a4358efbd7332b1e1c9d689a7f77ec71' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.set_snapshot_source()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e861a27c7fe71fe2e37b185cab513947d06ea09138801009864a8d5418502f58' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='5af1c9a737d4a8115e0ab67c3eee489cfe400ed0f7905ab941f34feedccf508e' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.touch_updated_at()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='354fd59c57b17c349514d24ce4a8e4fa8d3d177fb99291c64992d24d617f0e3a' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='92fa7c305a8b856faea0575b27eaa33c1e39952cf9fe87b4c0cbf7d7eab556bd' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.uuid_from_hash(text)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='d0d7dc854b466854f2c982e528e7e65a9de4ee33b4c7dea229a5ee737fcf64bb' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='66a736cf40ccbfc250f8446fbdd7de911585bb37f4da459125b74a2ad2b6e2b1' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.valid_allowed_emails(text[])') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='e7be18f5b1812c66834c764b2c65b466b6ebc372b09a888b3b7dc79f76078566' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ba3b55cad702ac3f3fa66745c7815eec5f43444f758d9738284208d082cf6b6a' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.validate_exam_owner()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='f86d20fc206e887476f2363856d60d7c84cff4950362c185be6b434a7f7ca058' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='4c0f0147ebb06f4e457ed09c2f0cea9d1fdd2799d48d1b23037213804672ffc4' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.validate_privacy_acceptance()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='277bca90bee4d10f74b5475c143c36ab7c81fa5c0b6f708d5bfbcb1d7c38051c' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ea0070f61cc42e6de2d0eace5f2708617191d2f0c16086e8b4b73ee9f9439671' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.validate_room_activation()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='8f96672da3ed19d205bd697b255bc8e29b74080a90c4278fa8ca67a91fbed880' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e46e006a39104dd3b5b8045fecd747243d9e366eed30046d5f13643be751762b' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('examination_room_v1.validate_submission_receipt()') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='8a7c5d74463a6c9fe4555b42c271d524ecbead0f59bc613feef222af9f5534a9' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='5aa6cbbae171e04b1a28bf94961759513c804d4fa60db267e03a30c85e7f33bd' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=false AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres}')
    AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.examination_room_v1_lifecycle_guard(uuid)') AND encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')='5be56ab90978ae40cdd821a7577bbe3ce977f9d6766c95fac4f111c4fbc9677b' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2913cd1f0af99c9a7999ceb93666e3ebacaed79333d33fb3e4e6049eb75c260c' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef=true AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')) THEN RAISE EXCEPTION 'PROTECTED_DEPENDENCY_CHANGED'; END IF;
END;
$compatibility_package$;
COMMIT;

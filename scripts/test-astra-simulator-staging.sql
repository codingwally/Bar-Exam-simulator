-- STAGING ONLY: parent executes this whole file on hlzqmreeoghbldnhlybr AFTER the migration.
-- Explicit isolated Auth/profile/content fixtures, always rolled back. No existing user is changed.
-- No storage objects, emails, AI calls, or persistent grants. Never remove the final ROLLBACK.
begin;
set local statement_timeout = '45s';
set local lock_timeout = '4s';

-- Assertions and results stay inside this transaction; this probe performs no DDL.

do $matrix$
declare
  v_user uuid := gen_random_uuid();
  v_definition uuid := gen_random_uuid();
  v_version uuid := gen_random_uuid();
  v_subject_definition uuid := gen_random_uuid();
  v_subject_version uuid := gen_random_uuid();
  v_subject_attempt uuid := gen_random_uuid();
  v_question uuid;
  v_first_question uuid;
  v_attempt uuid;
  v_payment uuid := gen_random_uuid();
  v_grant uuid := gen_random_uuid();
  v_reservation uuid;
  v_subscription uuid;
  v_now timestamptz := statement_timestamp();
  v_result jsonb;
  v_access jsonb;
  v_operation text;
  v_basis text;
  v_tab text := 'astra_synthetic_tab_token_123456789012345678901234567890';
  v_prefix text := 'astra_' || replace(gen_random_uuid()::text, '-', '');
  v_payload jsonb;
  v_proof_path text;
  v_plan text;
  v_admin_hash text := md5(pg_get_functiondef('public.examination_is_admin(uuid)'::regprocedure));
  v_checks jsonb := '[]'::jsonb;
  v_label text;
  v_message text;
  i integer;
begin
  v_label := 'migration helper installed';
  if (to_regprocedure('private.astra_simulator_entitlement(uuid)') is not null) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  v_label := 'private helper denies anonymous execution';
  if (not has_function_privilege('anon', 'private.astra_simulator_entitlement(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'private.astra_simulator_entitlement(uuid)', 'execute')) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  v_label := 'public authorizer remains service-only';
  if (not has_function_privilege('authenticated', 'public.examination_authorize_access(uuid,text,uuid,uuid,boolean)', 'execute')) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));

  -- Direct Auth insert is solely a transaction-local synthetic identity, never a real account.
  insert into auth.users(id, aud, role, email, email_confirmed_at, last_sign_in_at, raw_user_meta_data, created_at, updated_at, is_anonymous)
  values(v_user, 'authenticated', 'authenticated', v_prefix || '@example.invalid', v_now, v_now,
    jsonb_build_object('full_name','Astra rollback-only fixture','internal_test',true), v_now, v_now, false);
  insert into public.profiles(id,display_name,enrollment_status,profile_completed_at,commercial_category,commercial_onboarding_completed_at)
  values(v_user,'Astra rollback-only fixture','not_yet_enrolled',v_now,'review',v_now)
  on conflict(id) do update set display_name=excluded.display_name,enrollment_status=excluded.enrollment_status,
    profile_completed_at=excluded.profile_completed_at,commercial_category=excluded.commercial_category,
    commercial_onboarding_completed_at=excluded.commercial_onboarding_completed_at;
  insert into public.user_roles(user_id,role) values(v_user,'student') on conflict(user_id) do update set role='student';
  insert into public.terms_acceptances(user_id,terms_version,privacy_version,acceptance_source)
  select v_user,current_terms_version,current_privacy_version,'astra_rollback_only' from public.platform_access_settings where singleton
  on conflict(user_id,terms_version,privacy_version) do nothing;
  insert into public.introductory_token_grants(id,user_id,token_limit,disclosure_version,granted_at,acknowledged_at)
  select v_grant,v_user,5,introductory_token_disclosure_version,v_now - interval '2 hours',v_now - interval '1 hour'
  from public.platform_access_settings where singleton
  on conflict(user_id) do update set acknowledged_at=greatest(v_now,public.introductory_token_grants.granted_at),disclosure_version=excluded.disclosure_version returning id into v_grant;
  -- Consume all five introductory credits in synthetic ledger rows; pending payment must still admit.
  for i in 1..5 loop
    insert into public.grade_reservations(user_id,request_key,question_bank_id,access_basis,status,consumes_quota,completed_at)
    values(v_user,v_prefix || '_quota_' || i,'astra-synthetic-question','introductory_tokens','completed',true,v_now)
    returning id into v_reservation;
    insert into public.introductory_token_ledger(user_id,grant_id,reservation_id,event_type,token_delta,balance_after,reason)
    values(v_user,v_grant,v_reservation,'consumed',-1,5-i,'Astra rollback-only exhausted quota fixture');
  end loop;
  v_label := 'introductory quota actually exhausted';
  if ((select count(*)=5 from public.introductory_token_ledger where user_id=v_user and event_type='consumed')) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));

  insert into public.examination_definitions(id,track,assessment_kind,title,subject,test_only,status,created_by)
  values(v_definition,'bar_feels','curated','Astra rollback-only Simulation','Civil Law',true,'draft',v_user),
    (v_subject_definition,'per_subject','system_test','Astra rollback-only Syllabus','Civil Law',true,'draft',v_user);
  insert into public.examination_versions(id,exam_id,version_number,label,duration_seconds,default_timer_mode,grading_route,answer_release_rule,created_by)
  values(v_version,v_definition,1,'Rollback-only Simulation',14400,'strict','provisional','manual',v_user),
    (v_subject_version,v_subject_definition,1,'Rollback-only Syllabus',720,'strict','provisional','manual',v_user);
  for i in 1..20 loop
    insert into public.examination_questions(source_key,source_type,owner_user_id,subject,prompt_text,content_hash)
    values(v_prefix || '_question_' || i,'uploaded',v_user,'Civil Law','Synthetic rollback-only question number ' || i || '. This is not customer content.',repeat('a',64))
    returning id into v_question;
    if i=1 then v_first_question:=v_question; end if;
    insert into public.examination_version_questions(version_id,question_id,ordinal,prompt_snapshot,snapshot_hash)
    values(v_version,v_question,i,'Synthetic rollback-only question number ' || i || '. This is not customer content.',repeat('b',64));
    if i=1 then
      insert into public.examination_version_questions(version_id,question_id,ordinal,prompt_snapshot,snapshot_hash)
      values(v_subject_version,v_question,1,'Synthetic rollback-only Syllabus question. Not customer content.',repeat('c',64));
    end if;
  end loop;
  update public.examination_versions set status='published',question_count=20,snapshot_hash=repeat('d',64),published_at=v_now where id=v_version;
  update public.examination_versions set status='published',question_count=1,snapshot_hash=repeat('e',64),published_at=v_now where id=v_subject_version;
  update public.examination_definitions set status='published',active_version_id=v_version where id=v_definition;
  update public.examination_definitions set status='published',active_version_id=v_subject_version where id=v_subject_definition;
  insert into public.examination_attempts_multi(id,user_id,version_id,timer_mode,status,active_tab_hash,start_request_key,deadline_at,submitted_at)
  values(v_subject_attempt,v_user,v_subject_version,'strict','submitted',public.examination_tab_hash(v_tab),v_prefix || '_subject',v_now+interval '12 minutes',v_now);

  v_label := 'unpaid with exhausted credits denied';
  if (not (private.astra_simulator_entitlement(v_user)->>'allowed')::boolean) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  v_result:=public.examination_authorize_access(v_user,'per_subject',null,v_subject_attempt,true);
  v_label := 'Syllabus historical ownership retained';
  if (v_result->>'basis'='historical_owner') is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  v_label := 'unpaid Simulator catalog denied';
  v_message := null;
  begin
    execute format('select public.examination_query(%L::uuid,''catalog'',''{"track":"bar_feels"}''::jsonb)',v_user);
  exception when others then
    v_message := sqlerrm;
  end;
  if v_message is distinct from 'EXAM_PREMIUM_REQUIRED' then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));

  select plan_code into strict v_plan from public.plan_catalog where plan_code='early_access_beta';
  v_proof_path:=v_user::text || '/' || v_payment::text || '.png';
  -- The payment repair may precede this test. Support either existing validated path constraint
  -- using a synthetic string only; no uploaded object is created or payment approved.
  if not (v_proof_path ~ (select substring(pg_get_constraintdef(oid) from $$proof_object_path ~ '([^']+)'$$)
    from pg_constraint where conrelid='public.payment_requests'::regclass and conname='payment_requests_proof_object_path_check')) then
    v_proof_path:=v_user::text || '/' || v_payment::text || chr(92) || '.png';
  end if;
  insert into public.payment_requests(id,user_id,plan_code,trusted_amount_php,payment_method,payment_date,transaction_reference,
    proof_object_path,proof_original_name,proof_mime_type,proof_size_bytes,proof_sha256,status,request_key,
    provisional_access_started_at,provisional_access_expires_at,verification_email_status,subscriber_receipt_status)
  values(v_payment,v_user,v_plan,149,'bpi_instapay',current_date,v_prefix,v_proof_path,'synthetic.png','image/png',1,repeat('f',64),
    'pending',v_prefix || '_payment',v_now-interval '1 hour',v_now+interval '23 hours','suppressed','suppressed');

  v_result:=private.astra_simulator_entitlement(v_user);
  v_label := 'valid 24-hour pending proof admitted despite exhausted credits';
  if (v_result->>'basis'='provisional_payment' and (v_result->>'allowed')::boolean) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  v_access:=public.examination_authorize_access(v_user,'bar_feels',v_version,null,false);
  v_label := 'outer authorizer accepts pending proof';
  if (v_access->>'basis'='provisional_payment') is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  v_result:=public.examination_query(v_user,'setup',jsonb_build_object('versionId',v_version));
  v_label := 'inner setup admits pending proof';
  if ((v_result->>'versionId')::uuid=v_version) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  v_result:=public.examination_command(v_user,'start_attempt',jsonb_build_object('versionId',v_version,'timerMode','strict','tabToken',v_tab,'requestKey',v_prefix || '_fixed_start'));
  v_attempt:=(v_result->'attempt'->>'attemptId')::uuid;
  v_label := 'inner fixed start admits pending proof';
  if (v_attempt is not null and jsonb_array_length(v_result->'questions')=20) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  v_result:=public.bar_simulation_start_attempt_v1(v_user,v_version,'strict',v_prefix || '_random_start',v_tab);
  v_label := 'randomized start admission resumes existing fixed attempt';
  if ((v_result->'attempt'->>'attemptId')::uuid=v_attempt and (v_result->>'resumed')::boolean) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));

  -- Keep the September 6 advisory-timer behavior: save after the deadline, then manually submit.
  update public.examination_attempts_multi set started_at=v_now-interval '5 hours',deadline_at=v_now-interval '1 hour' where id=v_attempt;
  v_payload:=jsonb_build_object('attemptId',v_attempt,'questionId',v_first_question,'tabToken',v_tab,
    'answerText',E'Exact unsent words.\n\nSecond paragraph preserved.','expectedRevision',0,'flagged',false);
  perform public.examination_command(v_user,'save_response',v_payload);
  v_label := 'post-deadline saved answer remains exact';
  if ((select answer_text=E'Exact unsent words.\n\nSecond paragraph preserved.' and revision=1 from public.examination_responses where attempt_id=v_attempt and question_id=v_first_question)) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  update public.payment_requests set status='needs_information' where id=v_payment;
  v_label := 'needs-information within original window admitted';
  if ((private.astra_simulator_entitlement(v_user)->>'allowed')::boolean) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  perform public.examination_command(v_user,'submit_attempt',jsonb_build_object('attemptId',v_attempt,'tabToken',v_tab,'confirmed',true,'requestKey',v_prefix || '_submit'));
  v_label := 'manual submit remains available after target ends';
  if ((select status='submitted' from public.examination_attempts_multi where id=v_attempt)) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));

  update public.payment_requests set provisional_access_revoked_at=v_now where id=v_payment;
  v_label := 'revoked provisional denied';
  if (not (private.astra_simulator_entitlement(v_user)->>'allowed')::boolean) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  v_label := 'owned historical Simulator authorizer denied';
  v_message := null;
  begin
    execute format(
    'select public.examination_authorize_access(%L::uuid,''bar_feels'',null,%L::uuid,true)',v_user,v_attempt);
  exception when others then
    v_message := sqlerrm;
  end;
  if v_message is distinct from 'EXAM_PREMIUM_REQUIRED' then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  for v_operation in select unnest(array['resume','verdict','history']) loop
    v_payload:=jsonb_build_object('track','bar_feels','attemptId',v_attempt);
    v_label := 'revoked inner query ' || v_operation;
    v_message := null;
    begin
      execute format('select public.examination_query(%L::uuid,%L,%L::jsonb)',v_user,v_operation,v_payload);
    exception when others then
      v_message := sqlerrm;
    end;
    if v_message is distinct from 'EXAM_PREMIUM_REQUIRED' then
      raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
    end if;
    v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  end loop;
  for v_operation in select unnest(array['heartbeat','save_response','flag_response','submit_attempt','request_ai_grading']) loop
    v_payload:=jsonb_build_object('attemptId',v_attempt,'questionId',v_first_question,'tabToken',v_tab,'requestKey',v_prefix || '_denied_' || v_operation,
      'confirmed',true,'answerText','Denied replacement','expectedRevision',1,'flagged',false);
    v_label := 'revoked inner command ' || v_operation;
    v_message := null;
    begin
      execute format('select public.examination_command(%L::uuid,%L,%L::jsonb)',v_user,v_operation,v_payload);
    exception when others then
      v_message := sqlerrm;
    end;
    if v_message is distinct from 'EXAM_PREMIUM_REQUIRED' then
      raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
    end if;
    v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  end loop;
  v_label := 'random start receipt cannot bypass revoked access';
  v_message := null;
  begin
    execute format(
    'select public.bar_simulation_start_attempt_v1(%L::uuid,%L::uuid,''strict'',%L,%L)',v_user,v_version,v_prefix || '_random_start',v_tab);
  exception when others then
    v_message := sqlerrm;
  end;
  if v_message is distinct from 'EXAM_PREMIUM_REQUIRED' then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  v_label := 'denial does not change stored answer';
  if ((select answer_text=E'Exact unsent words.\n\nSecond paragraph preserved.' and revision=1 from public.examination_responses where attempt_id=v_attempt and question_id=v_first_question)) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  v_result:=public.examination_authorize_access(v_user,'per_subject',null,v_subject_attempt,true);
  v_label := 'Syllabus historical access still retained after proof revocation';
  if (v_result->>'basis'='historical_owner') is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));

  update public.payment_requests set provisional_access_revoked_at=null,provisional_access_started_at=v_now-interval '25 hours',provisional_access_expires_at=v_now-interval '1 hour' where id=v_payment;
  v_label := 'expired 24-hour provisional denied';
  if (not (private.astra_simulator_entitlement(v_user)->>'allowed')::boolean) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  update public.payment_requests set provisional_access_started_at=v_now-interval '1 hour',provisional_access_expires_at=v_now+interval '23 hours',status='rejected' where id=v_payment;
  v_label := 'rejected proof denied during former window';
  if (not (private.astra_simulator_entitlement(v_user)->>'allowed')::boolean) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  update public.payment_requests set status='cancelled' where id=v_payment;
  v_label := 'cancelled proof denied';
  if (not (private.astra_simulator_entitlement(v_user)->>'allowed')::boolean) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));

  insert into public.subscriptions(user_id,plan_code,status,starts_at,expires_at,source,reason)
  values(v_user,v_plan,'active',v_now-interval '1 day',v_now+interval '29 days','manual_payment','Astra rollback-only paid fixture') returning id into v_subscription;
  v_label := 'current paid subscription admitted';
  if ((private.astra_simulator_entitlement(v_user)->>'allowed')::boolean) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  update public.subscriptions set starts_at=v_now-interval '31 days',expires_at=v_now-interval '1 day' where id=v_subscription;
  v_label := 'expired paid subscription denied despite owned attempt';
  if (not (private.astra_simulator_entitlement(v_user)->>'allowed')::boolean) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  insert into public.free_beta_access(user_id,enabled,expires_at,reason,created_by,updated_by,access_program)
  values(v_user,true,v_now+interval '1 day','Astra rollback-only beta fixture',v_user,v_user,'founding_beta_2026');
  v_label := 'current Founding Beta overrides expired subscription';
  if (private.astra_simulator_entitlement(v_user)->>'basis'='founding_beta') is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  update public.free_beta_access set expires_at=v_now-interval '1 second' where user_id=v_user;
  v_label := 'expired Founding Beta denied';
  if (not (private.astra_simulator_entitlement(v_user)->>'allowed')::boolean) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  update public.user_roles set role='beta_tester' where user_id=v_user;
  v_label := 'unentitled beta role alone is not Founding Beta';
  if (not (private.astra_simulator_entitlement(v_user)->>'allowed')::boolean) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  update public.user_roles set role='admin' where user_id=v_user;
  v_label := 'ordinary authorized admin admitted to consumer feature';
  if (private.astra_simulator_entitlement(v_user)->>'basis'='admin') is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  perform public.examination_authorize_access(v_user,'bar_feels',v_version,null,false);
  perform public.examination_query(v_user,'setup',jsonb_build_object('versionId',v_version));
  v_label := 'ordinary admin did not gain management status';
  if (not public.examination_is_admin(v_user)) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  v_label := 'ordinary admin cannot manage examinations';
  v_message := null;
  begin
    execute format('select public.examination_admin(%L::uuid,''dashboard'',''{}''::jsonb)',v_user);
  exception when others then
    v_message := sqlerrm;
  end;
  if v_message is distinct from 'EXAM_ADMIN_REQUIRED' then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));
  v_label := 'founder-only management function unchanged';
  if (md5(pg_get_functiondef('public.examination_is_admin(uuid)'::regprocedure))=v_admin_hash) is distinct from true then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:%', v_label;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('label', v_label, 'passed', true));

  -- Duplicate labels previously failed the temporary table primary key; retain that guard.
  if (select count(*) <> count(distinct item->>'label') from jsonb_array_elements(v_checks) item) then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:duplicate assertion labels';
  end if;
  if jsonb_array_length(v_checks) <> 40 then
    raise exception 'ASTRA_SIMULATOR_TEST_FAILED:incomplete assertion matrix';
  end if;
  perform set_config('astra.simulator_probe_summary', jsonb_build_object(
    'ok', true,
    'passedCount', jsonb_array_length(v_checks),
    'checks', v_checks,
    'transactionMode', 'rollback_only'
  )::text, true);
end;
$matrix$;

select current_setting('astra.simulator_probe_summary', true)::jsonb as simulator_probe_summary;
rollback;

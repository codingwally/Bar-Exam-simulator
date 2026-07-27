-- Phase 3 behavioral security and deterministic metric tests.
-- Staging only. Every synthetic identity and record is rolled back.
begin;
set local search_path = public, extensions, auth, pg_temp;
select plan(57);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values
  ('91000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','phase3-super@example.invalid','{}','{"full_name":"Phase 3 Super"}',
   now(),now(),false,false),
  ('91000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','phase3-admin@example.invalid','{}','{"full_name":"Phase 3 Admin"}',
   now(),now(),false,false),
  ('91000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','phase3-student@example.invalid','{}','{"full_name":"Phase 3 Student"}',
   now(),now(),false,false);

update public.user_roles set role = 'super_admin'
where user_id = '91000000-0000-4000-8000-000000000001';
update public.user_roles set role = 'admin'
where user_id = '91000000-0000-4000-8000-000000000002';

select is((select count(*) from public.profiles where id::text like '91000000-%'), 3::bigint, 'auth trigger created three synthetic profiles');
select is((select role from public.user_roles where user_id = '91000000-0000-4000-8000-000000000001'), 'super_admin', 'synthetic Super Admin established only in rolled-back test');
select throws_ok(
  $$select public.admin_authorization_context('91000000-0000-4000-8000-000000000003')$$,
  'P0001', 'Administrator authorization required', 'student cannot obtain admin context'
);
select is(
  (public.admin_authorization_context('91000000-0000-4000-8000-000000000001')->>'role'),
  'super_admin',
  'verified Super Admin receives admin context'
);
select throws_ok(
  $$select public.admin_operational_data(
    '91000000-0000-4000-8000-000000000002','users',null,50,0
  )$$,
  'P0001', 'Required capability is missing', 'ordinary admin without capability cannot read users'
);

insert into public.admin_capabilities(user_id,capability,granted_by,reason)
values (
  '91000000-0000-4000-8000-000000000002',
  'analytics_viewer',
  '91000000-0000-4000-8000-000000000001',
  'Synthetic staging capability test'
);
select is(
  (public.admin_operational_data(
    '91000000-0000-4000-8000-000000000002','users',null,50,0
  )->>'section'),
  'users',
  'admin with exact capability receives bounded user data'
);

insert into public.usage_sessions (
  id,user_id,anonymous_session_id,visitor_id,auth_state,started_at,last_seen_at,
  source,metadata,device_category,landing_area,last_page_area,heartbeat_interval_seconds
) values
  ('92000000-0000-4000-8000-000000000001',null,'93000000-0000-4000-8000-000000000001',
   '93000000-0000-4000-8000-000000000001','guest',now()-interval '2 days',now(),
   'web','{}','mobile','mock_bar','mock_bar',90),
  ('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003',
   '93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000002',
   'signed_in',now()-interval '1 day',now()-interval '1 day',
   'web','{}','desktop','mock_bar','mock_bar',90);

insert into public.usage_events (
  session_id,user_id,anonymous_session_id,event_key,event_type,subject,question_id,
  occurred_at,page_area,result_category,latency_ms,model_name,worker_version,score,metadata
) values
  ('92000000-0000-4000-8000-000000000001',null,'93000000-0000-4000-8000-000000000001',
   'phase3eventkey000001','page_view',null,null,now()-interval '2 days','mock_bar',null,null,null,null,null,'{}'),
  ('92000000-0000-4000-8000-000000000001',null,'93000000-0000-4000-8000-000000000001',
   'phase3eventkey000002','page_view',null,null,now()-interval '1 day','mock_bar',null,null,null,null,null,'{}'),
  ('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003',
   '93000000-0000-4000-8000-000000000002','phase3eventkey000003','page_view',null,null,
   now()-interval '1 day','mock_bar',null,null,null,null,null,'{}'),
  ('92000000-0000-4000-8000-000000000001',null,'93000000-0000-4000-8000-000000000001',
   'phase3eventkey000004','grading_success','Labor Law','LAB-001',now()-interval '1 day',
   'mock_bar','tier',1000,'synthetic-model','synthetic-worker',3.5,'{}'),
  ('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003',
   '93000000-0000-4000-8000-000000000002','phase3eventkey000005','grading_success','Labor Law','LAB-001',
   now()-interval '1 hour','mock_bar','tier',2000,'synthetic-model','synthetic-worker',4.5,'{}'),
  ('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003',
   '93000000-0000-4000-8000-000000000002','phase3eventkey000006','grading_failure','Labor Law','LAB-002',
   now()-interval '30 minutes','mock_bar','provider_unavailable',500,null,'synthetic-worker',null,'{}'),
  ('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003',
   '93000000-0000-4000-8000-000000000002','phase3eventkey000007','grading_success','Labor Law','LAB-001',
   now()-interval '12 hours','mock_bar','tier',1800,'synthetic-model','synthetic-worker',3.5,'{}'),
  ('92000000-0000-4000-8000-000000000001',null,'93000000-0000-4000-8000-000000000001',
   'phase3eventkey000008','sign_in_prompted',null,null,now()-interval '40 minutes','mock_bar',null,null,null,null,null,'{}'),
  ('92000000-0000-4000-8000-000000000001',null,'93000000-0000-4000-8000-000000000001',
   'phase3eventkey000009','sign_in_started',null,null,now()-interval '35 minutes','mock_bar',null,null,null,null,null,'{}'),
  ('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003',
   '93000000-0000-4000-8000-000000000002','phase3eventkey000010','registration_completed',null,null,
   now()-interval '25 minutes','mock_bar',null,null,null,null,null,'{}'),
  ('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003',
   '93000000-0000-4000-8000-000000000002','phase3eventkey000011','onboarding_completed',null,null,
   now()-interval '20 minutes','mock_bar',null,null,null,null,null,'{}');

select is(
  ((public.admin_period_metrics(now()-interval '3 days',now())->'traffic'->>'page_views')::integer),
  3,
  'page views count events rather than sessions'
);
select is(
  ((public.admin_period_metrics(now()-interval '3 days',now())->'traffic'->>'unique_visitors')::integer),
  2,
  'unique visitors deduplicate repeated events'
);
select is(
  ((public.admin_period_metrics(now()-interval '3 days',now())->'traffic'->>'average_daily_views')::numeric),
  1.0::numeric,
  'average daily views includes the zero-activity calendar day'
);
select is(
  ((public.admin_period_metrics(now()-interval '3 days',now())->'traffic'->>'average_daily_unique_visitors')::numeric),
  1.7::numeric,
  'average daily visitors sums daily uniques and includes zero days'
);
select is(
  ((public.admin_period_metrics(now()-interval '3 days',now())->'learning'->>'attempt_average')::numeric),
  3.8::numeric,
  'attempt average preserves the 0-5 scale and one decimal'
);
select is(
  ((public.admin_period_metrics(now()-interval '3 days',now())->'learning'->>'sample_size')::integer),
  3,
  'failed grade is excluded from score sample'
);
select is(
  ((public.admin_period_metrics(now()-interval '3 days',now())->'learning'->>'mastery_average')::numeric),
  4.0::numeric,
  'mastery average uses the latest successful score per audience and question'
);
select is(
  ((public.admin_period_metrics(now()-interval '3 days',now())->'learning'->>'average_improvement')::numeric),
  1.0::numeric,
  'improvement compares first and latest successful repeated-question scores'
);
select is(
  ((public.admin_period_metrics(now()-interval '3 days',now())->'traffic'->>'dau')::integer),
  2,
  'DAU deduplicates privacy-safe audience identities'
);
select is(
  ((public.admin_period_metrics(now()-interval '3 days',now())->'traffic'->>'wau')::integer),
  2,
  'WAU deduplicates privacy-safe audience identities'
);
select is(
  ((public.admin_period_metrics(now()-interval '3 days',now())->'traffic'->>'mau')::integer),
  2,
  'MAU deduplicates privacy-safe audience identities'
);
select is(
  ((public.admin_period_metrics(now()-interval '3 days',now())->'funnel'->>'registration_conversion_rate')::numeric),
  1.0::numeric,
  'registration conversion uses verified sign-in prompts as its denominator'
);
select is(
  ((public.admin_period_metrics(now()-interval '3 days',now())->'funnel'->>'onboarding_completion_rate')::numeric),
  1.0::numeric,
  'onboarding completion uses verified registrations as its denominator'
);
select is(
  ((public.admin_period_metrics(now()-interval '3 days',now())->'retention'->'d30'->>'matured')::boolean),
  false,
  'D30 retention remains immature for a three-day reporting cohort'
);
select ok(
  (public.admin_period_metrics(now()-interval '3 days',now())->'retention'->'d30'->'rate') = 'null'::jsonb,
  'immature D30 retention does not fabricate a rate'
);
select is(
  ((public.admin_period_metrics(now()-interval '3 days',now())->'reliability'->>'grading_failure')::integer),
  1,
  'failed grade is reported separately'
);
select is(
  ((public.admin_dashboard_snapshot(
    '91000000-0000-4000-8000-000000000001',
    now()-interval '3 days',now(),now()-interval '6 days',now()-interval '3 days'
  )->'realtime'->>'current_viewers')::integer),
  1,
  'current viewers use the five-minute session window'
);
select ok(
  (public.admin_dashboard_snapshot(
    '91000000-0000-4000-8000-000000000001',
    now()-interval '3 days',now(),now()-interval '6 days',now()-interval '3 days'
  )->'financial'->>'paid_subscribers') is null,
  'paid subscriber metric is not fabricated'
);

select is(
  (public.record_usage_event(
    '92000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001',
    null,'phase3heartbeat000001','session_heartbeat',null,null,'mock_bar',null,
    null,null,null,null,null,'mobile',null,null,null,null,'mock_bar','{}'
  )->>'heartbeat_only')::boolean,
  true,
  'visible-page heartbeat updates the session without creating an event row'
);
select is((select count(*) from public.usage_events where event_key = 'phase3heartbeat000001'), 0::bigint, 'heartbeat is not stored as a high-frequency event');
select lives_ok(
  $$select public.record_usage_event(
    '92000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001',
    null,'phase3dedupeevent001','page_view',null,null,'mock_bar',null,
    null,null,null,null,null,'mobile',null,null,null,null,'mock_bar','{}'
  )$$,
  'first deduplicated event is accepted'
);
select lives_ok(
  $$select public.record_usage_event(
    '92000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001',
    null,'phase3dedupeevent001','page_view',null,null,'mock_bar',null,
    null,null,null,null,null,'mobile',null,null,null,null,'mock_bar','{}'
  )$$,
  'replayed event is safely ignored'
);
select is((select count(*) from public.usage_events where event_key = 'phase3dedupeevent001'), 1::bigint, 'event-key deduplication prevents double counting');

select lives_ok(
  $$select public.admin_reveal_user_email(
    '91000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000003',
    'Synthetic staging reveal audit'
  )$$,
  'Super Admin may perform a reason-required email reveal'
);
select is((select count(*) from public.admin_audit_log where action_type = 'email_revealed' and target_user_id = '91000000-0000-4000-8000-000000000003'), 1::bigint, 'email reveal is audited without raw email metadata');
select ok(
  not public.jsonb_has_forbidden_keys(
    (select details from public.admin_audit_log where action_type = 'email_revealed' order by occurred_at desc limit 1),
    array['email']
  ),
  'ordinary audit metadata contains no exact email'
);
select lives_ok(
  $$select public.admin_find_user_by_email(
    '91000000-0000-4000-8000-000000000001',
    'phase3-student@example.invalid',
    'Synthetic staging exact-email search'
  )$$,
  'Super Admin may perform a reason-required exact-email search'
);
select is(
  (select count(*) from public.admin_audit_log
   where action_type = 'email_searched'
     and target_user_id = '91000000-0000-4000-8000-000000000003'),
  1::bigint,
  'exact-email search is audited against the matched user'
);
select ok(
  (select details::text || ' ' || coalesce(reason, '')
   from public.admin_audit_log
   where action_type = 'email_searched'
   order by occurred_at desc
   limit 1) not like '%phase3-student@example.invalid%',
  'ordinary email-search audit data does not retain the exact email'
);

select lives_ok(
  $$select public.admin_execute_action(
    '91000000-0000-4000-8000-000000000001','entitlement_change',
    '91000000-0000-4000-8000-000000000003',
    '{"plan_code":"manual_beta","status":"active","entitlement_action":"grant"}',
    'Synthetic staging manual access grant','phase3entitlement0001'
  )$$,
  'authorized manual entitlement action succeeds transactionally'
);
select is((select count(*) from public.entitlement_history where request_key = 'phase3entitlement0001'), 1::bigint, 'manual entitlement has immutable history');
select is((select source from public.user_entitlements where user_id = '91000000-0000-4000-8000-000000000003'), 'manual_admin', 'manual entitlement never claims payment');
select is((select count(*) from public.admin_audit_log where action_type = 'subscription_changed' and target_user_id = '91000000-0000-4000-8000-000000000003'), 1::bigint, 'manual entitlement is audited');
select is(
  (public.admin_execute_action(
    '91000000-0000-4000-8000-000000000001','entitlement_change',
    '91000000-0000-4000-8000-000000000003',
    '{"plan_code":"manual_beta","status":"active","entitlement_action":"grant"}',
    'Synthetic staging manual access replay','phase3entitlement0001'
  )->>'replayed')::boolean,
  true,
  'replayed entitlement request returns the original result without a second mutation'
);
select is((select count(*) from public.entitlement_history where request_key = 'phase3entitlement0001'), 1::bigint, 'idempotent replay does not duplicate entitlement history');

select lives_ok(
  $$select public.admin_execute_action(
    '91000000-0000-4000-8000-000000000001','discount_upsert',null,
    '{"code":"PHASE3TEST","state":"draft","discount_type":"percentage","discount_value":10,"plan_code":"standard","total_limit":50,"per_user_limit":1,"internal_note":"Synthetic staging discount"}',
    'Synthetic staging discount configuration','phase3discount000001'
  )$$,
  'authorized draft discount configuration succeeds'
);
select is((select state from public.discount_codes where code = 'PHASE3TEST'), 'draft', 'discount remains draft and does not claim a payment');
select is((select count(*) from public.admin_audit_log where action_type = 'discount_changed'), 1::bigint, 'discount configuration is audited');
select throws_ok(
  $$insert into public.discount_codes(
    code,state,discount_type,discount_value,internal_note
  ) values ('PHASE3INVALID','draft','percentage',150,'Synthetic invalid bounds')$$,
  '23514',
  null,
  'discount percentage above one hundred is rejected'
);

insert into public.question_corrections(
  id,user_id,question_bank_id,subject,correction_type,
  proposed_correction,explanation,source_urls,status
) values (
  '95000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000003',
  'LAB-001','Labor Law','legal_basis',
  'Synthetic correction content for staging review only.',
  'Synthetic explanation content for staging review only.',
  array['https://elibrary.judiciary.gov.ph/'],'pending'
);
select lives_ok(
  $$select public.admin_execute_action(
    '91000000-0000-4000-8000-000000000001','correction_review',
    '95000000-0000-4000-8000-000000000001',
    '{"status":"accepted","reviewer_note":"Synthetic staging editorial review"}',
    'Synthetic staging correction review','phase3correction0001'
  )$$,
  'authorized correction review succeeds without editing the question bank'
);
select is((select count(*) from public.question_correction_history where correction_id = '95000000-0000-4000-8000-000000000001'), 1::bigint, 'correction review creates immutable status history');

insert into public.support_requests(id,user_id,category,message,status)
values (
  '94000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000003',
  'account_recovery',
  'Synthetic recovery request used only inside a rolled-back staging test.',
  'pending'
);
select lives_ok(
  $$select public.admin_execute_action(
    '91000000-0000-4000-8000-000000000001','support_update',
    '94000000-0000-4000-8000-000000000001',
    '{"status":"in_progress","priority":"high","internal_note":"Synthetic staging operator note"}',
    'Synthetic staging support update','phase3support000001'
  )$$,
  'authorized support update succeeds'
);
select is((select count(*) from public.support_request_history where support_request_id = '94000000-0000-4000-8000-000000000001'), 1::bigint, 'support update creates non-destructive status history');
select lives_ok(
  $$select public.admin_execute_action(
    '91000000-0000-4000-8000-000000000001','recovery_case_update',null,
    '{"support_request_id":"94000000-0000-4000-8000-000000000001","user_id":"91000000-0000-4000-8000-000000000003","previous_email":"old@example.invalid","proposed_email":"new@example.invalid","verification_checklist":{"government_id":true}}',
    'Synthetic staging recovery case','phase3recoverycase001'
  )$$,
  'authorized recovery case management may be opened'
);
select is((select count(*) from public.account_recovery_audit where user_id = '91000000-0000-4000-8000-000000000003'), 1::bigint, 'exact recovery email is stored only in restricted recovery audit');
select throws_ok(
  $$select public.admin_execute_action(
    '91000000-0000-4000-8000-000000000001','recovery_case_update',
    (select id from public.account_recovery_cases limit 1),
    '{"attempt_transfer":true}',
    'Synthetic unsafe handoff attempt','phase3recoverycase002'
  )$$,
  'P0001',
  'Final identity transfer is disabled until same-UUID Google handoff is proven',
  'unsupported Google identity transfer remains disabled'
);

select lives_ok(
  $$select public.admin_execute_action(
    '91000000-0000-4000-8000-000000000001','website_control_update',null,
    '{"control_key":"announcement_text","value":{"text":"Synthetic staging announcement"},"is_published":false}',
    'Synthetic staging allowlisted control','phase3control000001'
  )$$,
  'allowlisted website control can be saved as unpublished'
);
select is((select count(*) from public.website_control_history where request_key = 'phase3control000001'), 1::bigint, 'website control change preserves audited history');

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claim.role','authenticated',true);
select throws_ok($$select * from public.usage_events$$, '42501', null, 'student cannot read raw analytics');
select throws_ok($$select * from public.account_recovery_audit$$, '42501', null, 'student cannot read recovery emails');
select throws_ok($$update public.user_entitlements set status='active'$$, '42501', null, 'student cannot mutate entitlements');
reset role;

select * from finish();
rollback;

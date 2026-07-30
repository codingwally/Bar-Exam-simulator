-- Staging-only integration coverage for the approved LEB Subject Matter seed
-- and the explicit-expiry Premium plan. Every synthetic row is rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;

do $test$
declare
  v_admin constant uuid := 'a4910000-0000-4000-8000-000000000001';
  v_free constant uuid := 'a4910000-0000-4000-8000-000000000002';
  v_pending constant uuid := 'a4910000-0000-4000-8000-000000000003';
  v_paid constant uuid := 'a4910000-0000-4000-8000-000000000004';
  v_beta constant uuid := 'a4910000-0000-4000-8000-000000000005';
  v_expired constant uuid := 'a4910000-0000-4000-8000-000000000006';
  v_suspended constant uuid := 'a4910000-0000-4000-8000-000000000007';
  v_revoked constant uuid := 'a4910000-0000-4000-8000-000000000008';
  v_no_terms constant uuid := 'a4910000-0000-4000-8000-000000000009';
  v_non_admin constant uuid := 'a4910000-0000-4000-8000-000000000010';
  v_terms text;
  v_privacy text;
  v_payment jsonb;
  v_replay jsonb;
  v_result jsonb;
  v_subscription_id uuid;
  v_denied boolean;
begin
  if (
    select count(*)
    from public.examination_questions
    where source_metadata->>'spreadsheetId' =
      '1DgDe_ObIoiTy9NJ3DmdM1ec7h7t0FS7RvFhBTjubZ8A'
      and source_metadata->>'sheetName' = 'LEB Y1-Y2 Exam Bank'
      and source_key like 'LEB-Y%-20260730-Q%'
      and review_status = 'approved'
      and publication_ready
  ) <> 11 then
    raise exception 'TEST_FAILED: approved LEB question count is not 11';
  end if;

  if (
    select count(*)
    from public.examination_definitions d
    join public.examination_versions v on v.id = d.active_version_id
    join public.examination_version_questions vq on vq.version_id = v.id
    join public.examination_questions q on q.id = vq.question_id
    where q.source_key like 'LEB-Y%-20260730-Q%'
      and d.track = 'per_subject'
      and d.assessment_kind = 'quiz'
      and d.status = 'published'
      and v.status = 'published'
      and v.question_count = 1
      and v.duration_seconds = 420
      and v.grading_route = 'ai'
      and v.answer_release_rule = 'after_ai'
  ) <> 11 then
    raise exception 'TEST_FAILED: approved LEB publication graph is incomplete';
  end if;

  if exists (
    select 1
    from public.examination_questions
    where source_key in (
      'LEB-Y2T1-JD306-20260730-Q01',
      'LEB-Y2T1-JD501-20260730-Q01',
      'LEB-Y2T1-JD603-20260730-Q01',
      'LEB-Y2T1-JD701-20260730-Q01',
      'LEB-Y2T1-JD702-20260730-Q01',
      'LEB-Y2T1-JD801-20260730-Q01',
      'LEB-Y2T1-JD105-20260730-Q01',
      'LEB-Y2T2-JD303-20260730-Q01',
      'LEB-Y2T2-JD503-20260730-Q01',
      'LEB-Y2T2-JD504-20260730-Q01',
      'LEB-Y2T2-JD604-20260730-Q01',
      'LEB-Y2T2-JD703-20260730-Q01',
      'LEB-Y2T2-JD901-20260730-Q01'
    )
  ) then
    raise exception 'TEST_FAILED: editorial-review-pending LEB content was published';
  end if;

  if not exists (
    select 1 from public.plan_catalog
    where plan_code = 'premium'
      and display_name = 'Premium'
      and price_php = 499.00
      and status = 'active'
      and checkout_enabled
      and duration_days is null
  ) then
    raise exception 'TEST_FAILED: authoritative Premium catalog row is invalid';
  end if;

  if has_function_privilege(
    'public',
    'public.phase4_admin_manage_subscription(uuid,uuid,uuid,jsonb,text,text)',
    'execute'
  ) or has_function_privilege(
    'anon',
    'public.phase4_admin_manage_subscription(uuid,uuid,uuid,jsonb,text,text)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.phase4_admin_manage_subscription(uuid,uuid,uuid,jsonb,text,text)',
    'execute'
  ) then
    raise exception 'TEST_FAILED: browser role can execute Premium administration';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.phase4_admin_manage_subscription(uuid,uuid,uuid,jsonb,text,text)',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.examination_authorize_access(uuid,text,uuid,uuid,boolean)',
    'execute'
  ) then
    raise exception 'TEST_FAILED: trusted backend lacks required Premium RPC access';
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, is_sso_user, is_anonymous
  )
  select
    id,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated',
    'authenticated',
    label || '@example.invalid',
    '{}'::jsonb,
    jsonb_build_object('full_name', label),
    now(),
    now(),
    false,
    false
  from (
    values
      (v_admin, 'leb-premium-admin'),
      (v_free, 'leb-premium-free'),
      (v_pending, 'leb-premium-pending'),
      (v_paid, 'leb-premium-paid'),
      (v_beta, 'leb-premium-beta'),
      (v_expired, 'leb-premium-expired'),
      (v_suspended, 'leb-premium-suspended'),
      (v_revoked, 'leb-premium-revoked'),
      (v_no_terms, 'leb-premium-no-terms'),
      (v_non_admin, 'leb-premium-non-admin')
  ) users(id, label);

  update public.user_roles set role = 'super_admin' where user_id = v_admin;
  select current_terms_version, current_privacy_version
  into v_terms, v_privacy
  from public.platform_access_settings
  where singleton;

  insert into public.terms_acceptances (
    user_id, terms_version, privacy_version, acceptance_source
  )
  select id, v_terms, v_privacy, 'staging_integration'
  from unnest(array[
    v_free, v_pending, v_paid, v_beta, v_expired, v_suspended,
    v_revoked, v_non_admin
  ]) id;

  v_denied := false;
  begin
    perform public.phase4_admin_manage_subscription(
      v_non_admin, v_paid, null,
      jsonb_build_object(
        'operation', 'complimentary',
        'planCode', 'premium',
        'expiresAt', now() + interval '30 days'
      ),
      'Unauthorized staging action must fail.',
      'leb_non_admin_denied_0001'
    );
  exception when others then
    v_denied := sqlerrm = 'Founder administrator authorization required';
  end;
  if not v_denied then
    raise exception 'TEST_FAILED: non-admin Premium mutation was not rejected';
  end if;

  v_denied := false;
  begin
    perform public.phase4_create_payment_request(
      v_pending, 'premium', 498.99, 'gcash', current_date,
      'LEB-STAGING-WRONG-AMOUNT',
      null,
      v_pending::text || '/a4910000-0000-4000-8000-000000000101.png',
      'proof.png', 'image/png', 128,
      repeat('a', 64), 'leb_wrong_amount_0001'
    );
  exception when others then
    v_denied := sqlerrm = 'Payment amount must match the trusted plan price';
  end;
  if not v_denied then
    raise exception 'TEST_FAILED: client-controlled Premium amount was accepted';
  end if;

  v_payment := public.phase4_create_payment_request(
    v_pending, 'premium', 499.00, 'gcash', current_date,
    'LEB-STAGING-PENDING-499',
    'Synthetic pending Premium request.',
    v_pending::text || '/a4910000-0000-4000-8000-000000000102.png',
    'proof.png', 'image/png', 128,
    repeat('b', 64), 'leb_pending_payment_0001'
  );
  v_replay := public.phase4_create_payment_request(
    v_pending, 'premium', 499.00, 'gcash', current_date,
    'LEB-STAGING-PENDING-499-RETRY',
    'Synthetic replay.',
    v_pending::text || '/a4910000-0000-4000-8000-000000000103.png',
    'proof.png', 'image/png', 128,
    repeat('c', 64), 'leb_pending_payment_0002'
  );
  if v_payment->>'id' <> v_replay->>'id'
     or coalesce((v_replay->>'replayed')::boolean, false) is not true then
    raise exception 'TEST_FAILED: duplicate pending Premium request was created';
  end if;

  v_denied := false;
  begin
    perform public.examination_authorize_access(
      v_pending, 'bar_feels', null, null, false
    );
  exception when others then
    v_denied := sqlerrm = 'EXAM_PREMIUM_REQUIRED';
  end;
  if not v_denied then
    raise exception 'TEST_FAILED: pending Premium payment activated Bar Feels';
  end if;

  v_payment := public.phase4_create_payment_request(
    v_paid, 'premium', 499.00, 'maribank', current_date,
    'LEB-STAGING-PAID-499',
    'Synthetic paid Premium request.',
    v_paid::text || '/a4910000-0000-4000-8000-000000000104.png',
    'proof.png', 'image/png', 128,
    repeat('d', 64), 'leb_paid_payment_0001'
  );
  v_result := public.phase4_admin_review_payment(
    v_admin,
    (v_payment->>'id')::uuid,
    jsonb_build_object(
      'status', 'approved',
      'expiresAt', now() + interval '30 days'
    ),
    'Verified synthetic Premium approval in staging.',
    'leb_paid_approval_0001'
  );
  if v_result#>>'{subscription,plan_code}' <> 'premium'
     or v_result#>>'{subscription,source}' <> 'manual_payment' then
    raise exception 'TEST_FAILED: Premium payment approval did not create paid access';
  end if;
  if (
    public.examination_authorize_access(v_paid, 'bar_feels', null, null, false)
      ->>'basis'
  ) <> 'premium_paid' then
    raise exception 'TEST_FAILED: paid Premium user cannot open Bar Feels';
  end if;

  v_result := public.phase4_admin_manage_subscription(
    v_admin, v_beta, null,
    jsonb_build_object(
      'operation', 'complimentary',
      'planCode', 'premium',
      'expiresAt', now() + interval '30 days'
    ),
    'Grant controlled complimentary Premium beta.',
    'leb_beta_grant_0001'
  );
  if v_result#>>'{result,source}' <> 'complimentary'
     or (
       public.examination_authorize_access(v_beta, 'bar_feels', null, null, false)
         ->>'basis'
     ) <> 'premium_beta' then
    raise exception 'TEST_FAILED: complimentary Premium beta is not distinguished';
  end if;
  if exists (select 1 from public.payment_requests where user_id = v_beta) then
    raise exception 'TEST_FAILED: complimentary Premium created false payment revenue';
  end if;

  v_result := public.phase4_admin_manage_subscription(
    v_admin, v_expired, null,
    jsonb_build_object(
      'operation', 'complimentary',
      'planCode', 'premium',
      'expiresAt', now() + interval '30 days'
    ),
    'Create controlled Premium expiry state.',
    'leb_expired_grant_0001'
  );
  v_subscription_id := (v_result#>>'{result,id}')::uuid;
  perform public.phase4_admin_manage_subscription(
    v_admin, v_expired, v_subscription_id,
    jsonb_build_object('operation', 'expire'),
    'Expire controlled Premium state.',
    'leb_expired_action_0001'
  );

  v_result := public.phase4_admin_manage_subscription(
    v_admin, v_suspended, null,
    jsonb_build_object(
      'operation', 'complimentary',
      'planCode', 'premium',
      'expiresAt', now() + interval '30 days'
    ),
    'Create controlled Premium suspension state.',
    'leb_suspended_grant_0001'
  );
  v_subscription_id := (v_result#>>'{result,id}')::uuid;
  perform public.phase4_admin_manage_subscription(
    v_admin, v_suspended, v_subscription_id,
    jsonb_build_object('operation', 'pause'),
    'Suspend controlled Premium state.',
    'leb_suspended_action_0001'
  );

  v_result := public.phase4_admin_manage_subscription(
    v_admin, v_revoked, null,
    jsonb_build_object(
      'operation', 'complimentary',
      'planCode', 'premium',
      'expiresAt', now() + interval '30 days'
    ),
    'Create controlled Premium revocation state.',
    'leb_revoked_grant_0001'
  );
  v_subscription_id := (v_result#>>'{result,id}')::uuid;
  perform public.phase4_admin_manage_subscription(
    v_admin, v_revoked, v_subscription_id,
    jsonb_build_object('operation', 'cancel'),
    'Revoke controlled Premium state.',
    'leb_revoked_action_0001'
  );

  for v_subscription_id in
    select id
    from public.subscriptions
    where user_id in (v_expired, v_suspended, v_revoked)
  loop
    v_denied := false;
    begin
      perform public.examination_authorize_access(
        (select user_id from public.subscriptions where id = v_subscription_id),
        'bar_feels', null, null, false
      );
    exception when others then
      v_denied := sqlerrm = 'EXAM_PREMIUM_REQUIRED';
    end;
    if not v_denied then
      raise exception 'TEST_FAILED: inactive Premium state retained Bar Feels access';
    end if;
  end loop;

  v_result := public.phase4_admin_manage_subscription(
    v_admin, v_no_terms, null,
    jsonb_build_object(
      'operation', 'complimentary',
      'planCode', 'premium',
      'expiresAt', now() + interval '30 days'
    ),
    'Create controlled no-terms Premium state.',
    'leb_no_terms_grant_0001'
  );
  v_denied := false;
  begin
    perform public.examination_authorize_access(
      v_no_terms, 'bar_feels', null, null, false
    );
  exception when others then
    v_denied := sqlerrm = 'EXAM_ACCESS_REQUIRED';
  end;
  if not v_denied then
    raise exception 'TEST_FAILED: Premium bypassed current Terms acceptance';
  end if;

  if (
    public.examination_authorize_access(v_free, 'per_subject', null, null, false)
      ->>'allowed'
  )::boolean is not true then
    raise exception 'TEST_FAILED: existing lower/free Subject Matter rules regressed';
  end if;
  v_denied := false;
  begin
    perform public.examination_authorize_access(
      v_free, 'bar_feels', null, null, false
    );
  exception when others then
    v_denied := sqlerrm = 'EXAM_PREMIUM_REQUIRED';
  end;
  if not v_denied then
    raise exception 'TEST_FAILED: non-Premium user entered Bar Feels';
  end if;

  if (
    select count(*) from public.subscriptions
    where user_id in (
      v_paid, v_beta, v_expired, v_suspended, v_revoked, v_no_terms
    )
  ) <> 6 then
    raise exception 'TEST_FAILED: Premium lifecycle created conflicting subscriptions';
  end if;

  if (
    select count(*) from public.admin_audit_log
    where actor_user_id = v_admin
      and action_type = 'subscription_changed'
      and target_user_id in (
        v_beta, v_expired, v_suspended, v_revoked, v_no_terms
      )
  ) <> 8 or (
    select count(*) from public.admin_audit_log
    where actor_user_id = v_admin
      and action_type = 'payment_changed'
      and target_user_id = v_paid
  ) <> 1 then
    raise exception 'TEST_FAILED: Premium administration audit trail is incomplete';
  end if;
end;
$test$;

rollback;

-- Due Diligence September 2026 pricing and Founding Beta cutovers.
--
-- This migration publishes the final PHP 149 fixed-end offer immediately and
-- appends one immutable PHP 199 / 30-day revision scheduled for the exact
-- Asia/Manila cutover. Existing subscriptions and payment rows are untouched.

begin;

-- The existing pricing schema intentionally limits public QR paths to the
-- immutable payments asset directory. This one exact legacy route is served
-- by the Worker only before the cutover so the old QR cannot remain publicly
-- reachable afterward. Keep the exception narrow; arbitrary /pricing paths
-- are still rejected.
alter table public.pricing_payment_channel_versions
  drop constraint if exists pricing_payment_channel_versions_qr_public_path_check;

alter table public.pricing_payment_channel_versions
  add constraint pricing_payment_channel_versions_qr_public_path_check
  check (
    qr_public_path is null
    or qr_public_path = '/pricing/legacy-149-qr.png'
    or (
      qr_public_path ~ '^/assets/payments/[A-Za-z0-9][A-Za-z0-9._-]{0,110}\.(png|jpg|jpeg)$'
      and qr_public_path not like '%..%'
    )
  );

do $pricing_cutover$
declare
  v_now timestamptz := clock_timestamp();
  v_cutover constant timestamptz := '2026-09-14 00:00:00+08'::timestamptz;
  v_revision_a constant uuid := 'a8310000-0000-4000-8000-000000000001'::uuid;
  v_revision_b constant uuid := 'a9140000-0000-4000-8000-000000000001'::uuid;
begin
  if v_now >= v_cutover and (
    not exists (select 1 from public.pricing_revisions where id = v_revision_a)
    or not exists (select 1 from public.pricing_revisions where id = v_revision_b)
  ) then
    raise exception 'September pricing schedule must be installed before the cutover';
  end if;

  if not exists (
    select 1 from public.pricing_revisions where id = v_revision_a
  ) then
    if exists (
      select 1
      from public.pricing_revisions
      where state in ('draft', 'scheduled')
        and id not in (v_revision_a, v_revision_b)
    ) then
      raise exception 'An unrelated pricing draft or schedule must be resolved before installing the September cutover';
    end if;

    insert into public.pricing_revisions (
      id, state, schema_version, lock_version, page_config,
      based_on_revision_id, effective_at, published_at, content_hash,
      created_at, updated_at
    )
    select
      v_revision_a,
      'draft',
      1,
      1,
      jsonb_build_object(
        'page', jsonb_build_object(
          'eyebrow', 'Access Options',
          'title', 'Plans & Pricing',
          'intro', 'Everything you need for focused Philippine Bar review.',
          'notice', '',
          'finePrint', 'One-time payment. No automatic renewal.'
        ),
        'faqs', jsonb_build_array(
          jsonb_build_object(
            'id', 'manual-payment',
            'question', 'How is payment confirmed?',
            'answer', 'Upload your payment proof for secure manual verification.',
            'visible', true,
            'sortOrder', 1
          )
        )
      ),
      (
        select r.id
        from public.pricing_revisions r
        where r.state in ('published', 'scheduled')
          and r.effective_at <= v_now
        order by r.effective_at desc, r.revision_number desc
        limit 1
      ),
      null,
      null,
      encode(extensions.digest(
        'duediligence-pricing-149-through-2026-09-14-v1',
        'sha256'
      ), 'hex'),
      v_now,
      v_now;

    insert into public.pricing_plan_versions (
      id, revision_id, plan_code, name, badge, price_centavos, currency,
      duration_days, entitlement_mode, fixed_ends_at, description, features,
      cta_label, renewal_note, visible, display_starts_at, display_ends_at,
      checkout_enabled, checkout_starts_at, checkout_ends_at, sort_order,
      promotional, billing
    ) values (
      'a8310000-0000-4000-8000-000000000101'::uuid,
      v_revision_a,
      'early_access_beta',
      'Due Diligence Subscription',
      '',
      14900,
      'PHP',
      null,
      'fixed_end',
      '2026-10-01 23:59:59+08'::timestamptz,
      'Unlimited eligible practice submissions across all Due Diligence study tracks.',
      jsonb_build_array(
        'Quick Drills & Doctrine Review',
        'Syllabus-Based Review',
        'Bar Question Practice',
        'Bar Exam Simulation',
        'Pedro — Private AI Study Assistant',
        'ALAC Grading, Model Answers & Legal Sources',
        'Saved Progress, Personal Analytics & PDF Exports'
      ),
      'Subscribe for PHP 149',
      'One-time payment. No automatic renewal.',
      true,
      null,
      v_cutover,
      true,
      null,
      v_cutover,
      1,
      true,
      'manual'
    );

    insert into public.pricing_payment_channel_versions (
      id, revision_id, plan_version_id, channel_code, label,
      account_name, account_details, instructions, qr_public_path,
      amount_centavos, enabled, visible, sort_order
    ) values (
      'a8310000-0000-4000-8000-000000000301'::uuid,
      v_revision_a,
      'a8310000-0000-4000-8000-000000000101'::uuid,
      'bpi_instapay',
      'BPI InstaPay',
      '',
      '',
      'Pay the exact plan amount, then upload your payment proof.',
      '/pricing/legacy-149-qr.png',
      14900,
      true,
      true,
      1
    );

    update public.pricing_revisions
    set state = 'published',
        effective_at = v_now,
        published_at = v_now,
        updated_at = v_now,
        lock_version = lock_version + 1
    where id = v_revision_a
      and state = 'draft';
  end if;

  if not exists (
    select 1 from public.pricing_revisions where id = v_revision_b
  ) then
    if exists (
      select 1
      from public.pricing_revisions
      where state = 'scheduled'
        and id <> v_revision_b
    ) then
      raise exception 'An unrelated pricing schedule must be cancelled before installing the September 14 revision';
    end if;

    insert into public.pricing_revisions (
      id, state, schema_version, lock_version, page_config,
      based_on_revision_id, effective_at, content_hash,
      created_at, updated_at
    ) values (
      v_revision_b,
      'draft',
      1,
      1,
      jsonb_build_object(
        'page', jsonb_build_object(
          'eyebrow', 'Access Options',
          'title', 'Plans & Pricing',
          'intro', 'Everything you need for focused Philippine Bar review.',
          'notice', '',
          'finePrint', 'One-time payment. No automatic renewal.'
        ),
        'faqs', jsonb_build_array(
          jsonb_build_object(
            'id', 'manual-payment',
            'question', 'How is payment confirmed?',
            'answer', 'Upload your BPI receipt or screenshot for secure manual verification.',
            'visible', true,
            'sortOrder', 1
          )
        )
      ),
      v_revision_a,
      null,
      encode(extensions.digest(
        'duediligence-pricing-199-from-2026-09-14-v1',
        'sha256'
      ), 'hex'),
      v_now,
      v_now
    );

    insert into public.pricing_plan_versions (
      id, revision_id, plan_code, name, badge, price_centavos, currency,
      duration_days, entitlement_mode, fixed_ends_at, description, features,
      cta_label, renewal_note, visible, display_starts_at, display_ends_at,
      checkout_enabled, checkout_starts_at, checkout_ends_at, sort_order,
      promotional, billing
    ) values (
      'a9140000-0000-4000-8000-000000000102'::uuid,
      v_revision_b,
      'bar_access_30d',
      'Regular Subscription',
      '',
      19900,
      'PHP',
      30,
      'rolling_days',
      null,
      'Unlimited eligible practice submissions across all Due Diligence study tracks.',
      jsonb_build_array(
        'Quick Drills & Doctrine Review',
        'Syllabus-Based Review',
        'Bar Question Practice',
        'Bar Exam Simulation',
        'Pedro — Private AI Study Assistant',
        'ALAC Grading, Model Answers & Legal Sources',
        'Saved Progress, Personal Analytics & PDF Exports',
        'Study Room Beta — Join Open Live Rooms'
      ),
      'Subscribe for PHP 199',
      'One-time payment. No automatic renewal.',
      true,
      v_cutover,
      null,
      true,
      v_cutover,
      null,
      1,
      false,
      'manual'
    );

    insert into public.pricing_payment_channel_versions (
      id, revision_id, plan_version_id, channel_code, label,
      account_name, account_details, instructions, qr_public_path,
      amount_centavos, enabled, visible, sort_order
    ) values (
      'a9140000-0000-4000-8000-000000000302'::uuid,
      v_revision_b,
      'a9140000-0000-4000-8000-000000000102'::uuid,
      'bpi_instapay',
      'BPI InstaPay',
      '',
      '',
      'Pay exactly PHP 199.00, then upload your payment proof.',
      '/assets/payments/bpi-instapay-199-qr.png',
      19900,
      true,
      true,
      1
    );

    update public.pricing_revisions
    set state = 'scheduled',
        effective_at = v_cutover,
        updated_at = v_now,
        lock_version = lock_version + 1
    where id = v_revision_b
      and state = 'draft';
  end if;
end;
$pricing_cutover$;

do $pricing_cutover_invariants$
declare
  v_now timestamptz := clock_timestamp();
begin
  if not exists (
    select 1
    from public.pricing_revisions r
    join public.pricing_plan_versions p on p.revision_id = r.id
    join public.pricing_payment_channel_versions c on c.revision_id = r.id
      and c.plan_version_id = p.id
    where r.id = 'a8310000-0000-4000-8000-000000000001'::uuid
      and r.state = 'published'
      and r.effective_at < '2026-09-14 00:00:00+08'::timestamptz
      and r.content_hash = encode(extensions.digest(
        'duediligence-pricing-149-through-2026-09-14-v1', 'sha256'
      ), 'hex')
      and p.id = 'a8310000-0000-4000-8000-000000000101'::uuid
      and p.plan_code = 'early_access_beta'
      and p.price_centavos = 14900
      and p.entitlement_mode = 'fixed_end'
      and p.checkout_ends_at = '2026-09-14 00:00:00+08'::timestamptz
      and c.id = 'a8310000-0000-4000-8000-000000000301'::uuid
      and c.channel_code = 'bpi_instapay'
      and c.qr_public_path = '/pricing/legacy-149-qr.png'
      and c.amount_centavos = 14900
  ) then
    raise exception 'Existing September 149 revision does not match the reviewed schedule';
  end if;
  if not exists (
    select 1
    from public.pricing_revisions r
    join public.pricing_plan_versions p on p.revision_id = r.id
    join public.pricing_payment_channel_versions c on c.revision_id = r.id
      and c.plan_version_id = p.id
    where r.id = 'a9140000-0000-4000-8000-000000000001'::uuid
      and (
        (v_now < '2026-09-14 00:00:00+08'::timestamptz and r.state = 'scheduled')
        or (
          v_now >= '2026-09-14 00:00:00+08'::timestamptz
          and r.state in ('scheduled', 'published')
        )
      )
      and r.effective_at = '2026-09-14 00:00:00+08'::timestamptz
      and r.content_hash = encode(extensions.digest(
        'duediligence-pricing-199-from-2026-09-14-v1', 'sha256'
      ), 'hex')
      and p.id = 'a9140000-0000-4000-8000-000000000102'::uuid
      and p.plan_code = 'bar_access_30d'
      and p.name = 'Regular Subscription'
      and p.price_centavos = 19900
      and p.duration_days = 30
      and p.entitlement_mode = 'rolling_days'
      and p.checkout_starts_at = '2026-09-14 00:00:00+08'::timestamptz
      and c.id = 'a9140000-0000-4000-8000-000000000302'::uuid
      and c.channel_code = 'bpi_instapay'
      and c.qr_public_path = '/assets/payments/bpi-instapay-199-qr.png'
      and c.amount_centavos = 19900
  ) then
    raise exception 'Existing September 199 revision does not match the reviewed schedule';
  end if;
end;
$pricing_cutover_invariants$;

-- The compatibility setting closes the old checkout at the same exclusive
-- boundary. Existing fixed-end subscription rows are intentionally untouched.
update public.platform_access_settings
set early_access_sales_close_at = '2026-09-14 00:00:00+08'::timestamptz,
    early_access_regular_price_centavos = 19900,
    updated_at = clock_timestamp()
where singleton = true;

-- Keep already-loaded pre-cutover clients usable through the same exclusive
-- boundary. New clients use immutable plan/channel versions; this wrapper is
-- retained only for zero-downtime compatibility and rejects new requests at
-- the exact instant the Regular Subscription becomes effective.
create or replace function public.phase4_create_payment_request(
  p_user_id uuid,
  p_plan_code text,
  p_amount_php numeric,
  p_payment_method text,
  p_payment_date date,
  p_transaction_reference text,
  p_student_note text,
  p_proof_object_path text,
  p_proof_original_name text,
  p_proof_mime_type text,
  p_proof_size_bytes integer,
  p_proof_sha256 text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_existing public.payment_requests%rowtype;
  v_plan_id uuid;
  v_channel_id uuid;
  v_result jsonb;
begin
  if p_request_key is null or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid request key required';
  end if;
  if lower(btrim(coalesce(p_plan_code, ''))) <> 'early_access_beta'
     or round(coalesce(p_amount_php, 0), 2) <> 149.00 then
    raise exception 'Only the legacy 149-peso Early Access offer is available through this checkout';
  end if;

  -- Recover an accepted response lost at the boundary before refusing a
  -- genuinely new compatibility submission.
  select r.* into v_existing
  from public.payment_requests r
  where r.user_id = p_user_id
    and r.pricing_plan_version_id is not null
    and r.plan_code = 'early_access_beta'
    and r.trusted_amount_centavos = 14900
    and r.payment_method = lower(btrim(coalesce(p_payment_method, '')))
    and r.reference_normalized = lower(btrim(coalesce(p_transaction_reference, '')))
    and r.proof_sha256 = lower(coalesce(p_proof_sha256, ''))
    and r.submitted_at < '2026-09-14 00:00:00+08'::timestamptz
  order by r.submitted_at desc
  limit 1;
  if v_existing.id is not null then
    return jsonb_build_object(
      'id', v_existing.id, 'status', v_existing.status,
      'pricingRevisionId', v_existing.pricing_revision_id,
      'planVersionId', v_existing.pricing_plan_version_id,
      'paymentChannelVersionId', v_existing.pricing_payment_channel_version_id,
      'planCode', v_existing.plan_code, 'planName', v_existing.trusted_plan_name,
      'amountPhp', v_existing.trusted_amount_php,
      'amountCentavos', v_existing.trusted_amount_centavos,
      'currency', v_existing.trusted_currency,
      'durationDays', v_existing.trusted_duration_days,
      'entitlementMode', v_existing.trusted_entitlement_mode,
      'fixedEndsAt', v_existing.trusted_fixed_ends_at,
      'submittedAt', v_existing.submitted_at,
      'proofObjectPath', v_existing.proof_object_path,
      'provisionalAccessExpiresAt', v_existing.provisional_access_expires_at,
      'provisionalGrantReused', v_existing.provisional_access_started_at is null,
      'replayed', true
    );
  end if;
  if v_now >= '2026-09-14 00:00:00+08'::timestamptz then
    raise exception 'Early Access checkout is closed; refresh Plans & Pricing';
  end if;

  select p.id, c.id into v_plan_id, v_channel_id
  from public.pricing_revisions r
  join public.pricing_plan_versions p on p.revision_id = r.id
  join public.pricing_payment_channel_versions c on c.revision_id = r.id
    and (c.plan_version_id is null or c.plan_version_id = p.id)
  where r.id = (
      select live.id
      from public.pricing_revisions live
      where live.state in ('published', 'scheduled')
        and live.effective_at <= v_now
      order by live.effective_at desc, live.revision_number desc limit 1
    )
    and p.plan_code = 'early_access_beta'
    and p.price_centavos = 14900
    and p.checkout_enabled
    and (p.checkout_starts_at is null or v_now >= p.checkout_starts_at)
    and (p.checkout_ends_at is null or v_now < p.checkout_ends_at)
    and c.channel_code = lower(btrim(coalesce(p_payment_method, '')))
    and c.enabled and c.visible
    and (c.qr_asset_id is not null or c.qr_public_path is not null)
    and (c.amount_centavos is null or c.amount_centavos = 14900)
  order by c.sort_order limit 1;
  if v_plan_id is null or v_channel_id is null then
    raise exception 'Legacy payment method is unavailable';
  end if;

  v_result := public.phase4_create_payment_request_v2(
    p_user_id, v_plan_id, v_channel_id, p_payment_date,
    p_transaction_reference, 'payment-proofs', p_proof_object_path,
    p_proof_mime_type, p_proof_size_bytes, p_proof_sha256
  );
  if coalesce((v_result->>'replayed')::boolean, false) = false then
    update public.payment_requests
    set student_note = nullif(btrim(coalesce(p_student_note, '')), ''),
        proof_original_name = left(coalesce(
          nullif(btrim(p_proof_original_name), ''), proof_original_name
        ), 180)
    where id = (v_result->>'id')::uuid;
  end if;
  return v_result;
end;
$$;

-- Keep internal entitlement bases intact while removing retired campaign names
-- from the customer-facing access label. Historical plan/payment rows retain
-- their immutable recorded names for authorized billing review.
do $september_access_label_wrapper$
begin
  if to_regprocedure(
       'public.phase4_access_snapshot_pre_september_cutover(uuid,boolean,text)'
     ) is null then
    alter function public.phase4_access_snapshot(uuid, boolean, text)
      rename to phase4_access_snapshot_pre_september_cutover;
  end if;
end;
$september_access_label_wrapper$;

create or replace function public.phase4_access_snapshot(
  p_user_id uuid,
  p_activate_trial boolean default false,
  p_request_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access jsonb;
  v_basis text;
  v_label text;
begin
  v_access := public.phase4_access_snapshot_pre_september_cutover(
    p_user_id, p_activate_trial, p_request_key
  );
  v_basis := lower(btrim(coalesce(v_access->>'basis', '')));
  v_label := case
    when v_basis in ('super_admin', 'founder_admin') then v_access->>'accountLabel'
    when v_basis in ('founding_beta', 'free_beta', 'global_beta_all_access')
      then 'Complimentary Access'
    when v_basis = 'provisional_payment' then 'Payment under review'
    when v_basis in ('early_access', 'paid_subscription') then 'Paid Access'
    when v_basis in (
      'trial_tokens_exhausted', 'insufficient_introductory_tokens',
      'payment_required', 'paid_subscription_expired', 'plan_selection_required',
      'trial_expired'
    ) then 'Regular Subscription required'
    else regexp_replace(
      coalesce(v_access->>'accountLabel', ''),
      '(Founding Beta|Early Access)',
      'Access',
      'gi'
    )
  end;
  return v_access || jsonb_build_object('accountLabel', nullif(btrim(v_label), ''));
end;
$$;

revoke all on function public.phase4_access_snapshot_pre_september_cutover(
  uuid, boolean, text
) from public, anon, authenticated;
revoke all on function public.phase4_access_snapshot(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.phase4_access_snapshot_pre_september_cutover(
  uuid, boolean, text
) to service_role;
grant execute on function public.phase4_access_snapshot(uuid, boolean, text)
  to service_role;

-- Founding Beta stays valid throughout September 30 and closes at the first
-- instant of October in Asia/Manila. Later grants, disabled rows, and revoked
-- invitations are preserved rather than broadened or shortened.
alter table public.founding_beta_invites
  alter column access_ends_at
  set default '2026-10-01 00:00:00+08'::timestamptz;

create or replace function private.phase4_extend_founding_beta_entitlements(
  p_boundary timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invites integer := 0;
  v_entitlements integer := 0;
begin
  if p_boundary is null then
    raise exception 'Founding Beta boundary is required';
  end if;
  update public.founding_beta_invites
  set access_ends_at = p_boundary,
      updated_at = clock_timestamp()
  where status <> 'revoked'
    and access_ends_at < p_boundary;
  get diagnostics v_invites = row_count;

  update public.free_beta_access
  set expires_at = p_boundary,
      updated_at = clock_timestamp()
  where access_program = 'founding_beta_2026'
    and enabled
    and expires_at is not null
    and not exists (
      select 1
      from public.founding_beta_invites invite_row
      where invite_row.claimed_user_id = free_beta_access.user_id
        and invite_row.status = 'revoked'
    )
    and expires_at < p_boundary;
  get diagnostics v_entitlements = row_count;

  return jsonb_build_object(
    'invitesExtended', v_invites,
    'entitlementsExtended', v_entitlements,
    'boundary', p_boundary
  );
end;
$$;

revoke all on function private.phase4_extend_founding_beta_entitlements(timestamptz)
  from public, anon, authenticated, service_role;

select private.phase4_extend_founding_beta_entitlements(
  '2026-10-01 00:00:00+08'::timestamptz
);

create or replace function private.phase4_founding_beta_claim_open(
  p_at timestamptz
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_at < '2026-10-01 00:00:00+08'::timestamptz;
$$;

revoke all on function private.phase4_founding_beta_claim_open(timestamptz)
  from public, anon, authenticated, service_role;

-- Claims fail closed at the exact boundary. An existing disabled entitlement
-- remains disabled, and an existing later or non-expiring entitlement is never
-- shortened by a Founding Beta claim.
create or replace function public.phase4_claim_founding_beta(
  p_user_id uuid,
  p_email_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_boundary constant timestamptz := '2026-10-01 00:00:00+08'::timestamptz;
  v_invite public.founding_beta_invites%rowtype;
  v_existing_beta public.free_beta_access%rowtype;
  v_effective_end timestamptz;
begin
  if p_user_id is null or not exists (
    select 1
    from auth.users u
    where u.id = p_user_id
      and coalesce(u.is_anonymous, false) = false
  ) then
    raise exception 'Authenticated user required';
  end if;
  if lower(coalesce(p_email_hash, '')) !~ '^[0-9a-f]{64}$' then
    raise exception 'Valid normalized email hash required';
  end if;
  if not private.phase4_founding_beta_claim_open(v_now) then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'FOUNDING_BETA_ENDED',
      'accessEndsAt', v_boundary
    );
  end if;
  if not exists (
    select 1
    from auth.users u
    where u.id = p_user_id
      and u.email is not null
      and encode(
        extensions.digest(lower(btrim(u.email)), 'sha256'),
        'hex'
      ) = lower(p_email_hash)
  ) then
    raise exception 'Authenticated email hash does not match user';
  end if;

  select i.* into v_invite
  from public.founding_beta_invites i
  where i.email_hash = lower(p_email_hash)
  for update;

  if v_invite.email_hash is null
     or v_invite.status = 'revoked'
     or v_invite.access_ends_at <= v_now then
    return jsonb_build_object('claimed', false);
  end if;
  if v_invite.status = 'claimed'
     and v_invite.claimed_user_id <> p_user_id then
    return jsonb_build_object('claimed', false);
  end if;

  select b.* into v_existing_beta
  from public.free_beta_access b
  where b.user_id = p_user_id
  for update;
  if v_existing_beta.user_id is not null and not v_existing_beta.enabled then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'ACCESS_DISABLED'
    );
  end if;

  v_effective_end := case
    when v_existing_beta.user_id is not null
      and v_existing_beta.expires_at is null then null
    when v_existing_beta.user_id is not null
      and v_existing_beta.expires_at > v_invite.access_ends_at
      then v_existing_beta.expires_at
    else v_invite.access_ends_at
  end;

  update public.founding_beta_invites
  set status = 'claimed',
      claimed_user_id = p_user_id,
      claimed_at = coalesce(claimed_at, v_now),
      updated_at = v_now
  where email_hash = lower(p_email_hash);

  insert into public.free_beta_access (
    user_id, enabled, expires_at, reason, created_by, updated_by,
    access_program
  ) values (
    p_user_id, true, v_effective_end,
    'Approved 2026 Founding Beta complimentary access.',
    p_user_id, p_user_id, 'founding_beta_2026'
  )
  on conflict (user_id) do update
  set expires_at = v_effective_end,
      reason = case
        when public.free_beta_access.expires_at is null
          or public.free_beta_access.expires_at > excluded.expires_at
          then public.free_beta_access.reason
        else excluded.reason
      end,
      updated_at = v_now,
      updated_by = excluded.updated_by,
      access_program = case
        when public.free_beta_access.expires_at is null
          or public.free_beta_access.expires_at > excluded.expires_at
          then public.free_beta_access.access_program
        else excluded.access_program
      end;

  return jsonb_build_object(
    'claimed', true,
    'accessEndsAt', v_effective_end
  );
end;
$$;

revoke all on function public.phase4_claim_founding_beta(uuid, text)
  from public, anon, authenticated;
grant execute on function public.phase4_claim_founding_beta(uuid, text)
  to service_role;

do $pricing_cutover_contract$
declare
  v_before jsonb;
  v_at jsonb;
  v_after jsonb;
begin
  if not private.phase4_founding_beta_claim_open(
       '2026-09-30 23:59:59.999999+08'::timestamptz
     )
     or private.phase4_founding_beta_claim_open(
       '2026-10-01 00:00:00+08'::timestamptz
     )
     or private.phase4_founding_beta_claim_open(
       '2026-10-01 00:00:00.000001+08'::timestamptz
     ) then
    raise exception 'Founding Beta exact-boundary contract failed';
  end if;

  v_before := public.phase4_pricing_revision_snapshot(
    'a8310000-0000-4000-8000-000000000001'::uuid,
    true,
    '2026-09-13 23:59:59.999999+08'::timestamptz
  );
  v_at := public.phase4_pricing_revision_snapshot(
    'a9140000-0000-4000-8000-000000000001'::uuid,
    true,
    '2026-09-14 00:00:00+08'::timestamptz
  );
  v_after := public.phase4_pricing_revision_snapshot(
    'a9140000-0000-4000-8000-000000000001'::uuid,
    true,
    '2026-09-14 00:00:00.000001+08'::timestamptz
  );

  if jsonb_array_length(v_before->'plans') <> 1
     or v_before->'plans'->0->>'priceCentavos' <> '14900'
     or coalesce((v_before->'plans'->0->>'checkoutOpen')::boolean, false) is not true then
    raise exception 'PHP 149 pre-cutover contract failed';
  end if;
  if jsonb_array_length(v_at->'plans') <> 1
     or v_at->'plans'->0->>'name' <> 'Regular Subscription'
     or v_at->'plans'->0->>'priceCentavos' <> '19900'
     or v_at->'plans'->0->>'durationDays' <> '30'
     or coalesce((v_at->'plans'->0->>'checkoutOpen')::boolean, false) is not true then
    raise exception 'PHP 199 exact-cutover contract failed';
  end if;
  if v_after->'plans' is distinct from v_at->'plans'
     or v_after->'paymentMethods' is distinct from v_at->'paymentMethods' then
    raise exception 'Post-cutover pricing contract failed';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_at->'paymentMethods') method(value)
    where value->>'qrUrl' = '/assets/payments/bpi-instapay-199-qr.png'
      and value->>'qrAmountCentavos' = '19900'
      and coalesce(value->>'accountName', '') = ''
      and coalesce(value->>'accountDetails', '') = ''
  ) is not true then
    raise exception 'PHP 199 payment-channel contract failed';
  end if;
end;
$pricing_cutover_contract$;

commit;

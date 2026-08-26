import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const migrationPath = join(
  repositoryRoot,
  'supabase',
  'migrations',
  '20260827003000_paid_subscription_expiry_access.sql',
);
const pgliteVersion = '0.5.7';

function candidateModules() {
  const candidates = [];
  if (process.env.PAID_EXPIRY_PGLITE_MODULE) {
    candidates.push(resolve(process.env.PAID_EXPIRY_PGLITE_MODULE));
  }
  candidates.push(join(
    tmpdir(),
    `duediligence-paid-expiry-pglite-${pgliteVersion}`,
    'node_modules',
    '@electric-sql',
    'pglite',
    'dist',
    'index.js',
  ));
  candidates.push(join(
    tmpdir(),
    `duediligence-examination-room-pglite-${pgliteVersion}`,
    'node_modules',
    '@electric-sql',
    'pglite',
    'dist',
    'index.js',
  ));
  for (const entry of readdirSync(tmpdir(), { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('codex-examroom-pglite-')) continue;
    candidates.push(join(
      tmpdir(),
      entry.name,
      'node_modules',
      '@electric-sql',
      'pglite',
      'dist',
      'index.js',
    ));
  }
  return candidates;
}

function resolvePgliteModule() {
  const existing = candidateModules().find((candidate) => existsSync(candidate));
  if (existing) return existing;

  const installRoot = join(tmpdir(), `duediligence-paid-expiry-pglite-${pgliteVersion}`);
  mkdirSync(installRoot, { recursive: true });
  const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npmExecutable, [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--prefix',
    installRoot,
    `@electric-sql/pglite@${pgliteVersion}`,
  ], { stdio: 'inherit' });
  const installed = candidateModules().find((candidate) => existsSync(candidate));
  if (!installed) throw new Error('Pinned PGlite installation completed without a loadable module.');
  return installed;
}

const fixture = `
  create schema auth;
  create schema extensions;
  create role anon;
  create role authenticated;
  create role service_role;

  create function extensions.digest(text, text)
  returns bytea language sql immutable
  as $$ select convert_to($1, 'utf8') $$;
  create function public.test_uuid()
  returns uuid language sql volatile
  as $$ select md5(random()::text || clock_timestamp()::text)::uuid $$;

  create table auth.users (
    id uuid primary key,
    is_anonymous boolean default false,
    email text,
    last_sign_in_at timestamptz
  );
  create table public.platform_access_settings (
    singleton boolean primary key,
    soft_launch_enabled boolean,
    introductory_token_limit integer,
    introductory_token_disclosure_version text,
    public_pricing_enabled boolean,
    early_access_sales_close_at timestamptz,
    reauthentication_required_after timestamptz,
    early_access_regular_price_centavos integer,
    early_access_manual_renewal_at timestamptz,
    commercial_launch_enabled boolean,
    current_terms_version text,
    current_privacy_version text
  );
  create table public.user_roles (user_id uuid primary key, role text);
  create table public.terms_acceptances (
    user_id uuid,
    terms_version text,
    privacy_version text
  );
  create table public.profiles (
    id uuid primary key,
    commercial_onboarding_completed_at timestamptz
  );
  create table public.free_beta_access (
    user_id uuid primary key,
    enabled boolean,
    access_program text,
    expires_at timestamptz
  );
  create table public.subscriptions (
    id uuid primary key default public.test_uuid(),
    user_id uuid,
    plan_code text,
    status text,
    starts_at timestamptz,
    expires_at timestamptz,
    source text,
    updated_at timestamptz default now(),
    created_at timestamptz default now()
  );
  create table public.payment_requests (
    id uuid primary key default public.test_uuid(),
    user_id uuid,
    plan_code text,
    status text,
    provisional_access_started_at timestamptz,
    provisional_access_expires_at timestamptz,
    provisional_access_revoked_at timestamptz,
    submitted_at timestamptz default now()
  );
  create table public.introductory_token_grants (
    id uuid primary key default public.test_uuid(),
    user_id uuid unique,
    token_limit integer,
    disclosure_version text,
    granted_at timestamptz,
    acknowledged_at timestamptz
  );
  create table public.introductory_token_ledger (
    id uuid primary key default public.test_uuid(),
    user_id uuid,
    grant_id uuid,
    event_type text,
    token_delta integer,
    balance_after integer,
    reason text,
    occurred_at timestamptz,
    unique (grant_id, event_type)
  );
  create table public.grade_reservations (
    id uuid primary key default public.test_uuid(),
    user_id uuid,
    consumes_quota boolean,
    status text,
    reservation_expires_at timestamptz,
    reserved_at timestamptz
  );
  create table public.plan_catalog (
    plan_code text primary key,
    status text,
    checkout_enabled boolean,
    price_php numeric
  );

  create function public.phase4_claim_founding_beta(uuid, text)
  returns void language sql as $$ select $$;
  create function public.phase4_access_snapshot_pre_soft_launch(uuid, boolean, text)
  returns jsonb language sql
  as $$ select jsonb_build_object('allowed', false, 'basis', 'locked') $$;

  insert into public.platform_access_settings values (
    true, true, 5, 'tokens-v1', true,
    now() + interval '90 days', null, 19900,
    now() + interval '30 days', true, 'terms-v1', 'privacy-v1'
  );
  insert into public.plan_catalog values ('early_access_beta', 'active', true, 149.00);
`;

const users = Object.freeze({
  manualExpired: '10000000-0000-4000-8000-000000000001',
  adjustedExpired: '10000000-0000-4000-8000-000000000002',
  activeRenewal: '10000000-0000-4000-8000-000000000003',
  provisionalRenewal: '10000000-0000-4000-8000-000000000004',
  complimentaryExpired: '10000000-0000-4000-8000-000000000005',
});

const modulePath = resolvePgliteModule();
const { PGlite } = await import(pathToFileURL(modulePath).href);
const database = new PGlite();

async function addCompletedUser(userId, emailLocalPart) {
  await database.query(
    `insert into auth.users (id, email, last_sign_in_at)
     values ($1, $2, now())`,
    [userId, `${emailLocalPart}@example.test`],
  );
  await database.query(
    'insert into public.profiles values ($1, now())',
    [userId],
  );
  await database.query(
    `insert into public.terms_acceptances values ($1, 'terms-v1', 'privacy-v1')`,
    [userId],
  );
}

async function addExpiredSubscription(userId, source, status = 'active') {
  await database.query(
    `insert into public.subscriptions (
       user_id, plan_code, status, starts_at, expires_at, source
     ) values (
       $1, 'early_access_beta', $2,
       now() - interval '60 days', now() - interval '1 day', $3
     )`,
    [userId, status, source],
  );
}

async function accessSnapshot(userId) {
  const result = await database.query(
    `select public.phase4_access_snapshot(
       $1, true, 'paid_expiry_database_regression'
     ) as access`,
    [userId],
  );
  return result.rows[0].access;
}

async function grantCount(userId) {
  const result = await database.query(
    `select count(*)::integer as count
     from public.introductory_token_grants where user_id = $1`,
    [userId],
  );
  return result.rows[0].count;
}

try {
  await database.exec(fixture);
  await database.exec(readFileSync(migrationPath, 'utf8'));
  for (const [name, userId] of Object.entries(users)) {
    await addCompletedUser(userId, name);
  }

  await addExpiredSubscription(users.manualExpired, 'manual_payment');
  const manualExpired = await accessSnapshot(users.manualExpired);
  assert.equal(manualExpired.basis, 'paid_subscription_expired');
  assert.equal(manualExpired.allowed, false);
  assert.equal(manualExpired.paymentRequired, true);
  assert.equal(manualExpired.introductoryTokensEligible, false);
  assert.equal(manualExpired.tokensRemaining, 0);
  assert.equal(manualExpired.subscription.status, 'expired');
  assert.equal(await grantCount(users.manualExpired), 0);

  await addExpiredSubscription(users.adjustedExpired, 'admin_adjustment', 'expired');
  const adjustedExpired = await accessSnapshot(users.adjustedExpired);
  assert.equal(adjustedExpired.basis, 'paid_subscription_expired');
  assert.equal(adjustedExpired.introductoryTokensEligible, false);
  assert.equal(adjustedExpired.tokensRemaining, 0);
  assert.equal(await grantCount(users.adjustedExpired), 0);

  await addExpiredSubscription(users.activeRenewal, 'manual_payment', 'expired');
  await database.query(
    `insert into public.subscriptions (
       user_id, plan_code, status, starts_at, expires_at, source
     ) values (
       $1, 'early_access_beta', 'active', now(),
       now() + interval '30 days', 'manual_payment'
     )`,
    [users.activeRenewal],
  );
  const activeRenewal = await accessSnapshot(users.activeRenewal);
  assert.equal(activeRenewal.basis, 'early_access');
  assert.equal(activeRenewal.allowed, true);
  assert.equal(activeRenewal.unlimited, true);
  assert.equal(activeRenewal.introductoryTokensEligible, false);
  assert.equal(activeRenewal.tokensRemaining, 0);
  assert.equal(activeRenewal.subscription.status, 'active');
  assert.equal(await grantCount(users.activeRenewal), 0);

  await addExpiredSubscription(users.provisionalRenewal, 'manual_payment', 'expired');
  await database.query(
    `insert into public.payment_requests (
       user_id, plan_code, status, provisional_access_started_at,
       provisional_access_expires_at, provisional_access_revoked_at
     ) values (
       $1, 'early_access_beta', 'pending', now(),
       now() + interval '24 hours', null
     )`,
    [users.provisionalRenewal],
  );
  const provisionalRenewal = await accessSnapshot(users.provisionalRenewal);
  assert.equal(provisionalRenewal.basis, 'provisional_payment');
  assert.equal(provisionalRenewal.allowed, true);
  assert.equal(provisionalRenewal.unlimited, true);
  assert.equal(provisionalRenewal.introductoryTokensEligible, false);
  assert.equal(await grantCount(users.provisionalRenewal), 0);

  await addExpiredSubscription(users.complimentaryExpired, 'complimentary', 'expired');
  const complimentaryBeforeAcknowledgement = await accessSnapshot(users.complimentaryExpired);
  assert.equal(complimentaryBeforeAcknowledgement.basis, 'profile_required');
  assert.equal(complimentaryBeforeAcknowledgement.introductoryTokensEligible, true);
  assert.equal(await grantCount(users.complimentaryExpired), 1);
  await database.query(
    `update public.introductory_token_grants
     set acknowledged_at = now()
     where user_id = $1`,
    [users.complimentaryExpired],
  );
  const complimentaryEligible = await accessSnapshot(users.complimentaryExpired);
  assert.equal(complimentaryEligible.basis, 'introductory_tokens');
  assert.equal(complimentaryEligible.allowed, true);
  assert.equal(complimentaryEligible.tokensRemaining, 5);

  console.log(
    'Paid subscription expiry database validation passed: manual, owner-adjusted, active renewal, provisional renewal, and complimentary boundaries.',
  );
} finally {
  await database.close();
}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
  migration: path.join(
    root,
    'supabase',
    'migrations',
    '20260807120000_private_beta_admission.sql',
  ),
  preflight: path.join(
    root,
    'supabase',
    'review',
    'private_beta_production_preflight.sql',
  ),
  pgTap: path.join(
    root,
    'supabase',
    'tests',
    '20260807_017_private_beta_admission_test.sql',
  ),
  workerCore: path.join(root, 'worker', 'private-beta-core.mjs'),
  workerIndex: path.join(root, 'worker', 'index.mjs'),
  wrangler: path.join(root, 'worker', 'wrangler.toml'),
  phase2: path.join(root, 'assets', 'phase2-experience.js'),
  privateBetaSession: path.join(root, 'assets', 'private-beta-session.js'),
};

const entries = await Promise.all(
  Object.entries(paths).map(async ([name, file]) => [
    name,
    await readFile(file, 'utf8'),
  ]),
);
const source = Object.fromEntries(entries);
const combined = Object.values(source).join('\n');

for (const table of [
  'private_beta_settings',
  'private_beta_acceptances',
  'private_beta_pending_tokens',
  'private_beta_admissions',
  'private_beta_sessions',
  'private_beta_code_attempts',
]) {
  assert.match(source.migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(source.migration, new RegExp(`alter table public\\.${table} force row level security`));
  assert.match(source.migration, new RegExp(`revoke all on public\\.${table}`));
}

for (const fn of [
  'private_beta_evaluate_code_attempt',
  'private_beta_complete_admission',
  'private_beta_access_snapshot',
]) {
  assert.match(source.migration, new RegExp(`create or replace function public\\.${fn}`));
  assert.match(source.migration, new RegExp(`revoke all on function public\\.${fn}`));
}

assert.match(source.migration, /'beta_tester'/);
assert.match(source.migration, /access_session_hours integer not null default 12/);
assert.match(source.migration, /pending_token_minutes integer not null default 15/);
assert.match(source.migration, /flow_attempt_limit integer not null default 5/);
assert.match(source.migration, /network_attempt_limit integer not null default 20/);
assert.match(source.migration, /acceptance_source[\s\S]*'private_beta_admission'/);
assert.match(source.migration, /where public\.user_roles\.role not in \([\s\S]*'admin'[\s\S]*'founder_admin'[\s\S]*'super_admin'/);
assert.match(source.migration, /insert into public\.free_beta_access/);
assert.match(source.migration, /insert into public\.examination_beta_access/);
assert.match(source.migration, /public\.free_beta_access\.expires_at is null/);
assert.match(source.migration, /public\.examination_beta_access\.expires_at is null/);
assert.match(source.migration, /on conflict \(scope, subject_hash\) do nothing/);

assert.doesNotMatch(
  source.migration,
  /grant\s+(?:select|insert|update|delete|all)[^;]*\s+to\s+(?:public|anon|authenticated)/i,
);
assert.doesNotMatch(
  source.migration,
  /grant\s+execute[^;]*\s+to\s+(?:public|anon|authenticated)/i,
);

assert.match(source.preflight, /begin transaction read only;/i);
assert.match(source.preflight, /rollback;/i);
assert.doesNotMatch(source.preflight, /\b(insert|update|delete|alter|create|drop|truncate)\b/i);
assert.match(source.preflight, /expected exactly four founder-role accounts/i);
assert.match(source.preflight, /PRIVATE_BETA_PREFLIGHT_ALREADY_APPLIED/);

assert.match(source.workerIndex, /\/beta\/access\/verify/);
assert.match(source.workerIndex, /\/beta\/access\/complete/);
assert.match(source.workerIndex, /\/beta\/access\/status/);
assert.match(source.workerIndex, /await requirePrivateBetaAdmission\(request, env\)/);
assert.match(source.workerIndex, /X-DD-Beta-Access/);
assert.match(source.workerIndex, /X-DD-Beta-Flow-ID/);
assert.match(source.workerIndex, /privateBetaCapabilityExempt/);
assert.match(source.workerIndex, /claim_examiner_assignment/);
assert.match(
  source.workerIndex,
  /privateBetaGateEnabled\(env\) && pathname === '\/beta\/access\/verify'/,
);
assert.match(source.workerCore, /PRIVATE_BETA_PENDING_SECONDS = 15 \* 60/);
assert.match(source.workerCore, /PRIVATE_BETA_ACCESS_SECONDS = 12 \* 60 \* 60/);
assert.match(source.workerCore, /constantTimeHexEqual/);
assert.match(source.workerCore, /verifyPrivateBetaAccessCode/);
assert.match(source.workerCore, /crypto\.subtle\.sign/);

assert.match(source.wrangler, /PRIVATE_BETA_GATE_ENABLED = "false"/);
assert.match(
  source.wrangler,
  /PRIVATE_BETA_DISCLOSURE_VERSION = "beta-disclosure-v1-2026-07-31"/,
);
assert.doesNotMatch(source.wrangler, /PRIVATE_BETA_ACCESS_CODE_VERIFIER\s*=/);
assert.doesNotMatch(source.wrangler, /PRIVATE_BETA_ACCESS_CODE_PEPPER\s*=/);
assert.doesNotMatch(source.wrangler, /PRIVATE_BETA_FLOW_SIGNING_KEY\s*=/);
assert.match(source.phase2, /storage:\s*global\.sessionStorage/);
assert.doesNotMatch(source.phase2, /storage:\s*global\.localStorage/);
assert.match(source.privateBetaSession, /global\.sessionStorage/);
assert.doesNotMatch(source.privateBetaSession, /global\.localStorage/);
assert.match(source.privateBetaSession, /cache:\s*'no-store'/);
assert.match(source.privateBetaSession, /credentials:\s*'omit'/);

assert.doesNotMatch(combined, /\bsbp_[A-Za-z0-9_-]{20,}\b/);
assert.doesNotMatch(combined, /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/);
assert.doesNotMatch(combined, /\bAIza[0-9A-Za-z_-]{30,}\b/);
assert.doesNotMatch(combined, /\bre_[A-Za-z0-9_-]{20,}\b/);
assert.doesNotMatch(combined, /service_role_key\s*[:=]\s*['"][^'"]+['"]/i);
assert.doesNotMatch(combined, /private[-_ ]beta[-_ ]access[-_ ]code\s*[:=]\s*['"][^'"]+['"]/i);

const planned = Number(source.pgTap.match(/select plan\((\d+)\)/i)?.[1] || 0);
const assertions = (
  source.pgTap.match(
    /select\s+(?:has_table|has_function|is|ok|like|lives_ok|throws_ok)\s*\(/gi,
  )
  || []
).length;
assert.equal(planned, assertions, `pgTAP plan ${planned} must match ${assertions} assertions`);

console.log('Private-beta admission contract checks passed.');

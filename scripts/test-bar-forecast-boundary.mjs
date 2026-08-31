import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);

async function text(path) {
  return readFile(new URL(path, ROOT), 'utf8');
}

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

function functionBody(sql, name, nextMarker) {
  const start = sql.indexOf(`create or replace function public.${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = nextMarker ? sql.indexOf(nextMarker, start) : sql.indexOf('revoke all on function', start);
  assert.ok(end > start, `${name} must have a bounded definition`);
  return sql.slice(start, end);
}

export async function main() {
  const [
    migration,
    consentMigration,
    runtimeIntegrityMigration,
    pgTap,
    workerIndex,
    core,
    routes,
    frontend,
    importer,
    forecastSource,
  ] = await Promise.all([
    text('supabase/migrations/20260831170000_admin_bar_forecast.sql'),
    text('supabase/migrations/20260901010837_admin_bar_forecast_consent_version.sql'),
    text('supabase/migrations/20260901014500_admin_bar_forecast_runtime_integrity.sql'),
    text('supabase/tests/20260831_039_admin_bar_forecast_test.sql'),
    text('worker/index.mjs'),
    text('worker/bar-forecast-core.mjs'),
    text('worker/bar-forecast-routes.mjs'),
    text('assets/bar-forecast.js'),
    text('scripts/import-duediligence-2026-content.mjs'),
    text('content/duediligence-2026/bar-forecast.json'),
  ]);

  assert.match(migration, /^--[\s\S]*\nbegin;/i, 'migration must begin transactionally');
  assert.match(migration, /\ncommit;\s*$/i, 'migration must commit transactionally');
  assert.match(consentMigration, /^--[\s\S]*\nbegin;/i, 'consent migration must begin transactionally');
  assert.match(consentMigration, /\ncommit;\s*$/i, 'consent migration must commit transactionally');
  assert.match(runtimeIntegrityMigration, /^--[\s\S]*\nbegin;/i, 'runtime-integrity migration must begin transactionally');
  assert.match(runtimeIntegrityMigration, /\ncommit;\s*$/i, 'runtime-integrity migration must commit transactionally');
  assert.match(
    consentMigration,
    /consent_version in \('2026-08-31', '2026-09-01'\)/,
    'consent storage must retain the prior version while permitting the current version',
  );
  assert.doesNotMatch(
    consentMigration,
    /delete\s+from\s+public\.dd2026_bar_forecast_consents/i,
    'the version bump must not delete prior consent rows',
  );
  assert.match(migration, /'bar_forecast_question'/, 'dedicated content type must be additive');
  assert.match(migration, /source_version in \('2026\.1', '2026\.3'\)/, 'both source versions must remain valid');
  assert.match(
    migration,
    /v_type = 'bar_forecast_question' and v_source_version = '2026\.3'/,
    'Forecast type must pair only with source version 2026.3',
  );
  assert.match(
    migration,
    /v_type in \('bar_easy', 'doctrine', 'chair_case', 'anchor_case'\)[\s\S]*v_source_version = '2026\.1'/,
    'legacy types must retain source version 2026.1',
  );
  assert.match(
    migration,
    /if p_actor_user_id is not null and not public\.dd2026_is_admin\(p_actor_user_id\)/,
    'service-role importer must preserve the null-actor contract',
  );
  assert.match(
    migration,
    /v_id, v_revision, v_source_version, 'AI_PREPARED_BETA'/,
    'the validated source version must be stored rather than hardcoded',
  );

  const statusRpc = functionBody(
    consentMigration,
    'dd2026_bar_forecast_consent_status',
    'create or replace function public.dd2026_bar_forecast_accept_consent',
  );
  const acceptRpc = functionBody(
    consentMigration,
    'dd2026_bar_forecast_accept_consent',
    'create or replace function public.dd2026_bar_forecast_admin_list',
  );
  const listRpc = functionBody(runtimeIntegrityMigration, 'dd2026_bar_forecast_admin_list');
  for (const [name, body] of [
    ['status', statusRpc],
    ['accept', acceptRpc],
    ['list', listRpc],
  ]) {
    assert.match(
      body,
      /p_actor_user_id is null or not public\.dd2026_is_admin\(p_actor_user_id\)/,
      `${name} RPC must independently reject non-admin actors`,
    );
    assert.match(body, /security definer/i, `${name} RPC must declare its privileged boundary`);
    assert.match(body, /set search_path = ''/i, `${name} RPC must pin an empty search path`);
    assert.match(body, /p_consent_version is distinct from '2026-09-01'/, `${name} RPC must require the current disclosure`);
  }
  assert.match(listRpc, /i\.current_published_version_id/, 'list must use the current published version');
  assert.match(listRpc, /v\.lifecycle_state = 'published'/, 'list must require published content');
  assert.match(listRpc, /v\.payload ->> 'id' = i\.id/, 'list must bind the payload id to its content envelope');
  assert.match(listRpc, /v\.payload ->> 'version' = v\.source_version/, 'list must bind the payload version to its content envelope');
  assert.match(listRpc, /v\.payload ->> 'subject' = i\.subject/, 'list must bind the payload subject to its content envelope');
  assert.match(listRpc, /v\.checksum ~ '\^\[0-9a-f\]\{64\}\$'/, 'list must require a complete lowercase SHA-256 checksum');
  assert.match(
    listRpc,
    /v_count <> 20[\s\S]*v_rank_count <> 20[\s\S]*v_prompt_count <> 20[\s\S]*v_editorial_count <> 20[\s\S]*v_checksum_count <> 20/,
    'list must fail closed unless every runtime-integrity dimension has 20 unique rows',
  );

  assert.match(migration, /'BAR_FORECAST_ENABLED', false/, 'public Forecast flag must default off');
  assert.match(migration, /'BAR_FORECAST_ADMIN_ONLY', true/, 'admin-only flag must default on');
  assert.match(migration, /enable row level security/i, 'consent table must enable RLS');
  assert.match(migration, /force row level security/i, 'consent table must force RLS');
  assert.match(
    migration,
    /revoke all privileges on table public\.dd2026_bar_forecast_consents\s+from public, anon, authenticated/i,
    'browser roles must have no consent table privileges',
  );
  assert.equal(
    occurrences(migration, 'from public, anon, authenticated;') >= 5,
    true,
    'table and function privileges must be revoked from browser roles',
  );
  assert.equal(
    occurrences(consentMigration, 'from public, anon, authenticated;'),
    3,
    'all replaced consent/list RPCs must remain revoked from browser roles',
  );
  assert.equal(
    occurrences(runtimeIntegrityMigration, 'from public, anon, authenticated;'),
    1,
    'the final runtime-integrity list RPC must remain revoked from browser roles',
  );

  assert.equal(
    occurrences(workerIndex, "pathname === '/admin/dd2026/bar-forecast'"),
    2,
    'Worker must have one route and one private-error cache guard for the exact path',
  );
  assert.match(workerIndex, /request\.method !== 'POST'/, 'Forecast route must be POST-only');
  assert.match(workerIndex, /createBarForecastHandlers/, 'Worker must instantiate the dedicated handlers');
  assert.match(workerIndex, /admin_authorization_context/, 'Worker must use the canonical admin authorization context');
  assert.match(
    workerIndex,
    /authorizeAdministrator:\s*\(env, user\) => protectedSupabaseRpc\([\s\S]*?'admin_authorization_context'[\s\S]*?\{ p_actor_user_id: user\.id \}[\s\S]*?\{ returnNullOnAuthorizationDenial: true \}[\s\S]*?\),/,
    'database authorization denials must reach the Forecast-specific 403 contract',
  );
  assert.match(workerIndex, /BAR_FORECAST_RPC_FUNCTIONS/, 'Worker must use a dedicated RPC allowlist');
  assert.match(
    routes,
    /enforceBarForecastAdminRateLimit/,
    'Forecast route must use its dedicated administrator rate limiter',
  );
  assert.match(
    workerIndex,
    /const barForecastAdminRateWindows = new Map\(\);/,
    'Forecast traffic must have an isolated rate-limit window',
  );
  assert.match(
    workerIndex,
    /barForecastAdminRateWindows,[\s\S]*?transientRateKey\(request, env, 'bar-forecast-admin'\),[\s\S]*?MAX_BAR_FORECAST_ADMIN_REQUESTS_PER_WINDOW/,
    'Forecast rate limiting must use its own scope and exact configured maximum',
  );
  assert.match(
    workerIndex,
    /const MAX_BAR_FORECAST_ADMIN_REQUESTS_PER_WINDOW = 90;/,
    'Forecast must permit the bounded 30-examiner gate without sharing generic admin traffic',
  );
  assert.match(
    workerIndex,
    /const barForecastHandlers = createBarForecastHandlers\(\{[\s\S]*?enforceBarForecastAdminRateLimit,[\s\S]*?\}\);/,
    'Forecast handlers must receive the dedicated limiter',
  );
  assert.doesNotMatch(
    routes,
    /enforceAdminRateLimit/,
    'Forecast routes must not fall back to the shared generic administrator bucket',
  );
  assert.match(routes, /requireAdministrator/, 'Forecast route must require verified bearer authentication');
  assert.match(routes, /requireBarForecastAdministrator/, 'Forecast route must require an allowed admin role');
  assert.match(routes, /requiredSetupPending/, 'Forecast route must enforce required account setup');
  assert.match(routes, /BAR_FORECAST_SETUP_REQUIRED/, 'Forecast setup rejection must use a stable safe code');
  assert.match(
    workerIndex,
    /const barForecastHandlers = createBarForecastHandlers\(\{[\s\S]*?requiredSetupAccess: \(env, user\) => phase4SetupAccessForUser\(env, user\.id\)[\s\S]*?\}\);/,
    'Forecast setup enforcement must use the canonical server access snapshot',
  );
  assert.match(routes, /private, no-store, max-age=0/, 'Forecast responses must be private and non-cacheable');
  assert.doesNotMatch(
    `${core}\n${routes}`,
    /requireCommercialAccess|openPaymentGate|phase4_create_payment|plan_catalog|pricing|paymentRequired/i,
    'Forecast backend must not enforce or invoke a commercial-entitlement gate',
  );

  assert.match(core, /complete and exclusive legal source of truth/i, 'grader must be confined to curated law');
  assert.match(core, /Do not invent, supplement, update, or cite any law/i, 'grader must forbid invented law');
  assert.match(core, /Do not produce or reveal rubric categories, component scores/i, 'rubric must remain hidden');
  assert.match(core, /startTime: '08:00', endTime: '12:00'/, 'morning schedule times must be exact');
  assert.match(core, /startTime: '14:00', endTime: '18:00'/, 'afternoon schedule times must be exact');
  assert.match(core, /BAR_FORECAST_CONSENT_VERSION = '2026-09-01'/, 'Worker must require the current disclosure version');
  assert.match(frontend, /CONSENT_VERSION = '2026-09-01'/, 'frontend and Worker must require the same disclosure version');

  assert.match(importer, /contentType: 'bar_forecast_question', sourceVersion: '2026\.3'/, 'importer must include the Forecast source');
  const parsed = JSON.parse(forecastSource);
  assert.equal(parsed.source?.version, '2026.3', 'curated Forecast source version must be 2026.3');
  assert.equal(parsed.count, 120, 'curated Forecast source must declare 120 rows');
  assert.equal(parsed.rows?.length, 120, 'curated Forecast source must contain 120 rows');
  assert.deepEqual(
    Object.values(parsed.subject_counts || {}),
    [20, 20, 20, 20, 20, 20],
    'each official subject must contain exactly 20 curated questions',
  );

  assert.match(pgTap, /select no_plan\(\)/i, 'pgTAP test must declare its plan');
  assert.match(pgTap, /rollback;\s*$/i, 'pgTAP fixtures must roll back');
  assert.match(pgTap, /legacy content types cannot be imported under source version 2026\.3/, 'pgTAP must test an invalid legacy pairing');
  assert.match(pgTap, /Forecast questions cannot be imported under legacy source version 2026\.1/, 'pgTAP must test an invalid Forecast pairing');
  assert.match(pgTap, /prior disclosure acceptance remains stored after the version bump/, 'pgTAP must preserve prior consent rows');
  assert.match(pgTap, /prior-version consent cannot satisfy the current Worker contract/, 'pgTAP must reject prior consent for current access');
  assert.match(pgTap, /current acceptance is added without overwriting prior-version consent/, 'pgTAP must retain both versioned rows');

  console.log(JSON.stringify({
    ok: true,
    route: '/admin/dd2026/bar-forecast',
    sourceVersion: '2026.3',
    contentType: 'bar_forecast_question',
    questions: parsed.rows.length,
    subjects: Object.keys(parsed.subject_counts || {}).length,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

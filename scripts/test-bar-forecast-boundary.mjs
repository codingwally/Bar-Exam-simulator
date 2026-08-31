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
    pgTap,
    workerIndex,
    core,
    routes,
    importer,
    forecastSource,
  ] = await Promise.all([
    text('supabase/migrations/20260831170000_admin_bar_forecast.sql'),
    text('supabase/tests/20260831_039_admin_bar_forecast_test.sql'),
    text('worker/index.mjs'),
    text('worker/bar-forecast-core.mjs'),
    text('worker/bar-forecast-routes.mjs'),
    text('scripts/import-duediligence-2026-content.mjs'),
    text('content/duediligence-2026/bar-forecast.json'),
  ]);

  assert.match(migration, /^--[\s\S]*\nbegin;/i, 'migration must begin transactionally');
  assert.match(migration, /\ncommit;\s*$/i, 'migration must commit transactionally');
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
    migration,
    'dd2026_bar_forecast_consent_status',
    'create or replace function public.dd2026_bar_forecast_accept_consent',
  );
  const acceptRpc = functionBody(
    migration,
    'dd2026_bar_forecast_accept_consent',
    'create or replace function public.dd2026_bar_forecast_admin_list',
  );
  const listRpc = functionBody(migration, 'dd2026_bar_forecast_admin_list');
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
  }
  assert.match(listRpc, /i\.current_published_version_id/, 'list must use the current published version');
  assert.match(listRpc, /v\.lifecycle_state = 'published'/, 'list must require published content');
  assert.match(listRpc, /v_count <> 20 or v_rank_count <> 20/, 'list must fail closed unless all 20 ranks exist');

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
    occurrences(workerIndex, "pathname === '/admin/dd2026/bar-forecast'"),
    2,
    'Worker must have one route and one private-error cache guard for the exact path',
  );
  assert.match(workerIndex, /request\.method !== 'POST'/, 'Forecast route must be POST-only');
  assert.match(workerIndex, /createBarForecastHandlers/, 'Worker must instantiate the dedicated handlers');
  assert.match(workerIndex, /admin_authorization_context/, 'Worker must use the canonical admin authorization context');
  assert.match(workerIndex, /BAR_FORECAST_RPC_FUNCTIONS/, 'Worker must use a dedicated RPC allowlist');
  assert.match(routes, /enforceAdminRateLimit/, 'Forecast route must be rate limited');
  assert.match(routes, /requireAdministrator/, 'Forecast route must require verified bearer authentication');
  assert.match(routes, /requireBarForecastAdministrator/, 'Forecast route must require an allowed admin role');
  assert.match(routes, /private, no-store, max-age=0/, 'Forecast responses must be private and non-cacheable');
  assert.doesNotMatch(
    `${core}\n${routes}`,
    /requireCommercialAccess|phase4AccessForUser|subscription|pricing|payment/i,
    'Forecast backend must have no commercial-entitlement dependency',
  );

  assert.match(core, /complete and exclusive legal source of truth/i, 'grader must be confined to curated law');
  assert.match(core, /Do not invent, supplement, update, or cite any law/i, 'grader must forbid invented law');
  assert.match(core, /Do not produce or reveal rubric categories, component scores/i, 'rubric must remain hidden');
  assert.match(core, /startTime: '08:00', endTime: '12:00'/, 'morning schedule times must be exact');
  assert.match(core, /startTime: '14:00', endTime: '18:00'/, 'afternoon schedule times must be exact');

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

import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Extract only actual pure helpers and the actual provisioning statements.
// Never import the executing runner or load credentials/browser dependencies.
const source = await readFile(new URL('./verify-forecast-entry-staging.mjs', import.meta.url), 'utf8');
const helperSource = source.split('// ASTRA_ENTRY_REGISTRATION_HELPERS_BEGIN')[1].split('// ASTRA_ENTRY_REGISTRATION_HELPERS_END')[0].replace(/^export /gm, '');
const cleanupSource = source.split('// ASTRA_ENTRY_CLEANUP_HELPERS_BEGIN')[1].split('// ASTRA_ENTRY_CLEANUP_HELPERS_END')[0].replace(/^export /gm, '');
const helpers = vm.runInNewContext(`${helperSource}\n({entryFixtureIdentity,preflightEntryFixtureRegistration,registerEntryFixture})`, { assert });
const cleanup = vm.runInNewContext(`${cleanupSource}\n({entryCleanupManifest,entryCleanupReadbackComplete})`, { assert });
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const runPrefix = 'astra-entry-1788811200000-abcdef12';
const fixture = helpers.entryFixtureIdentity(runPrefix);
const registration = { registered: true, fixtureUserId: id, dataScope: 'internal_test', registrationVersion: 'astra-staging-forecast-v1', replayed: false };
const plain = value => JSON.parse(JSON.stringify(value));
const start = source.indexOf('  await preflightEntryFixtureRegistration(service);');
const endMarker = '  assert.equal(session.user.id, userId);';
const end = source.indexOf(endMarker, start) + endMarker.length;
assert.ok(start > 0 && end > start);
const provisionSource = source.slice(start, end);

async function provision({ preflightError, createError, createResult = { id }, registerError,
  registerResult = registration, manifestFailure, signInError } = {}) {
  const calls = [], snapshots = [];
  const scope = { assert, fixture, email: fixture.email, password: 'synthetic-local-only', db: 'https://hlzqmreeoghbldnhlybr.supabase.co',
    publishable: 'synthetic-local-publishable', userId: undefined, creationState: 'not_requested', registrationState: 'not_requested',
    ...helpers,
    persistCleanupManifest: async () => {
      calls.push(`manifest:${scope.creationState}:${scope.registrationState}`);
      snapshots.push(plain(cleanup.entryCleanupManifest({ fixtureUserIds: scope.userId ? [scope.userId] : [],
        creationState: scope.creationState, registrationState: scope.registrationState, fixture })));
      if (calls.at(-1) === manifestFailure) throw new Error('Synthetic local manifest failure');
    },
    service: async (route, options, statuses) => {
      const body = JSON.parse(options.body);
      if (route === '/rest/v1/rpc/astra_register_staging_forecast_fixture') {
        if (body.p_user_id === null) {
          calls.push('preflight'); assert.deepEqual(body, { p_user_id: null, p_fixture_prefix: null, p_fixture_kind: null });
          assert.deepEqual(Array.from(statuses), [400]); if (preflightError) throw new Error('Synthetic missing RPC');
          return { code: 'P0001', message: 'Staging fixture identity is invalid' };
        }
        calls.push('register'); assert.equal(scope.creationState, 'recorded'); assert.equal(scope.registrationState, 'requested');
        assert.deepEqual(body, { p_user_id: id, p_fixture_prefix: fixture.prefix, p_fixture_kind: 'member' });
        if (registerError) throw new Error('Synthetic registration acknowledgement lost'); return registerResult;
      }
      assert.equal(route, '/auth/v1/admin/users'); calls.push('create');
      assert.equal(scope.creationState, 'requested'); assert.equal(scope.registrationState, 'not_requested');
      assert.equal(body.email, fixture.email); assert.equal(body.email_confirm, true);
      assert.deepEqual(body.app_metadata, { astra_staging_fixture: { version: 1, prefix: fixture.prefix, kind: 'member' } });
      assert.equal(body.user_metadata.internal_test, true); assert.equal(body.user_metadata.astra_fixture_prefix, fixture.prefix);
      assert.equal(body.user_metadata.astra_fixture_purpose, 'forecast-entry-smoke');
      assert.ok(!Object.hasOwn(body, 'role')); assert.ok(!Object.hasOwn(body.app_metadata, 'admin'));
      if (createError) throw new Error('Synthetic uncertain Auth creation'); return createResult;
    },
    request: async (url, options) => {
      calls.push('sign-in'); assert.equal(url, 'https://hlzqmreeoghbldnhlybr.supabase.co/auth/v1/token?grant_type=password');
      assert.equal(scope.registrationState, 'confirmed'); assert.deepEqual(JSON.parse(options.body), { email: fixture.email, password: 'synthetic-local-only' });
      if (signInError) throw new Error('Synthetic sign-in failure'); return { user: { id } };
    },
  };
  let error;
  try { await vm.runInNewContext(`(async()=>{${provisionSource}})()`, scope); } catch (caught) { error = caught; }
  return { calls, snapshots, error, creationState: scope.creationState, registrationState: scope.registrationState, userId: scope.userId };
}

test('entry retains its own purpose while satisfying the existing guarded fixture namespace', () => {
  assert.deepEqual(plain(fixture), { prefix: 'astra-durable-1788811200000-abcdef12', kind: 'member', purpose: 'forecast-entry-smoke',
    email: 'astra-durable-1788811200000-abcdef12-member@example.com' });
  assert.ok(Object.isFrozen(fixture));
  for (const prefix of ['', 'astra-durable-1788811200000-abcdef12', 'astra-entry-production-abcdef12', runPrefix.toUpperCase(), runPrefix + '-extra', runPrefix + '\n', runPrefix + '\r\n']) {
    assert.throws(() => helpers.entryFixtureIdentity(prefix));
  }
});

test('invalid-input preflight requires the installed exact rejection without reading or creating an account', async () => {
  for (const response of [{ code: 'P0001', message: 'Staging fixture identity is invalid' },
    { code: '42501', message: 'denied' }, { code: 'P0001', message: 'other' }, { registered: true }, null]) {
    let calls = 0;
    const action = helpers.preflightEntryFixtureRegistration(async () => { calls++; return response; });
    if (response?.message === 'Staging fixture identity is invalid') await action; else await assert.rejects(action);
    assert.equal(calls, 1);
  }
  const missing = await provision({ preflightError: true });
  assert.ok(missing.error); assert.deepEqual(missing.calls, ['preflight']); assert.equal(missing.creationState, 'not_requested');
});

test('actual runner persists intent and owner, registers authoritatively, then signs in once', async () => {
  const result = await provision(); assert.equal(result.error, undefined);
  assert.deepEqual(result.calls, ['preflight', 'manifest:requested:not_requested', 'create', 'manifest:recorded:not_requested',
    'manifest:recorded:requested', 'register', 'manifest:recorded:confirmed', 'sign-in']);
  assert.equal(result.userId, id); assert.equal(result.registrationState, 'confirmed');
  assert.equal(result.snapshots[0].fixturePurpose, 'forecast-entry-smoke');
  assert.equal(result.snapshots[0].fixtureRegistration.prefix, fixture.prefix);
  assert.deepEqual(result.snapshots[1].fixtureUserIds, [id]);
});

test('uncertain create and malformed response keep recoverable identity intent but never retry or claim empty cleanup', async () => {
  for (const options of [{ createError: true }, { createResult: {} }, { createResult: { id: 'invalid' } }]) {
    const result = await provision(options); assert.ok(result.error);
    assert.deepEqual(result.calls, ['preflight', 'manifest:requested:not_requested', 'create']);
    assert.equal(result.creationState, 'requested'); assert.equal(result.userId, undefined);
    assert.equal(result.snapshots[0].fixtureRegistration.prefix, fixture.prefix);
    assert.equal(cleanup.entryCleanupReadbackComplete({ userId: result.userId, creationState: result.creationState, readback: {} }), false);
  }
});

test('registration uncertainty or bad acknowledgement retains the exact owner and prevents sign-in', async () => {
  for (const options of [{ registerError: true }, ...[{ registered: false }, { fixtureUserId: other }, { dataScope: 'regular' },
    { registrationVersion: 'unknown' }, { replayed: undefined }].map(delta => ({ registerResult: { ...registration, ...delta } }))]) {
    const result = await provision(options); assert.ok(result.error); assert.equal(result.userId, id);
    assert.equal(result.registrationState, 'requested'); assert.equal(result.calls.at(-1), 'register');
    assert.ok(!result.calls.includes('sign-in')); assert.equal(result.calls.filter(value => value === 'create').length, 1);
    assert.deepEqual(result.snapshots.at(-1).fixtureUserIds, [id]);
  }
});

test('evidence persistence failures stop before the next side effect without discarding known owner', async () => {
  for (const [manifestFailure, expectedId, expectedCalls] of [
    ['manifest:requested:not_requested', undefined, 0], ['manifest:recorded:not_requested', id, 1],
    ['manifest:recorded:requested', id, 1], ['manifest:recorded:confirmed', id, 1],
  ]) {
    const result = await provision({ manifestFailure }); assert.ok(result.error); assert.equal(result.userId, expectedId);
    assert.equal(result.calls.filter(value => value === 'create').length, expectedCalls);
    assert.equal(result.calls.at(-1), manifestFailure); assert.ok(!result.calls.includes('sign-in'));
  }
});

test('accepted registration replay is not a second creation or registration call', async () => {
  const result = await provision({ registerResult: { ...registration, replayed: true } });
  assert.equal(result.error, undefined); assert.equal(result.calls.filter(value => value === 'create').length, 1);
  assert.equal(result.calls.filter(value => value === 'register').length, 1); assert.equal(result.calls.filter(value => value === 'sign-in').length, 1);
});

test('manifest registration fields are closed-schema and do not expose account email or credentials', () => {
  const dirty = { ...plain(fixture), email: 'private@example.invalid', password: 'private-token' };
  const value = plain(cleanup.entryCleanupManifest({ fixtureUserIds: [id], creationState: 'recorded', registrationState: 'requested', fixture: dirty }));
  assert.doesNotMatch(JSON.stringify(value), /private@example|private-token/);
  assert.equal(value.fixtureRegistration.state, 'requested'); assert.equal(value.pulseFixtureRows, 'not_independently_checked');
  assert.throws(() => cleanup.entryCleanupManifest({ creationState: 'requested', registrationState: 'invented', fixture }));
  assert.throws(() => cleanup.entryCleanupManifest({ creationState: 'requested', fixture: { ...fixture, kind: 'admin' } }));
  assert.throws(() => cleanup.entryCleanupManifest({ creationState: 'requested', fixture: { ...fixture, prefix: fixture.prefix + '\n' } }));
});

test('unchanged SQL requires trusted fresh student and pre-sign-in state; runner adds no role or cleanup bypass', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260907190944_astra_staging_fixture_registration.sql', import.meta.url), 'utf8');
  for (const fragment of ["'^astra-durable-[0-9]{13}-[a-f0-9]{8}$'", "p_fixture_kind not in ('member','other','unpaid')",
    "raw_app_meta_data->'astra_staging_fixture'", "v_role is distinct from 'student'", "v_user.last_sign_in_at is not null",
    'from auth.sessions where user_id=p_user_id', 'from auth.refresh_tokens where user_id=p_user_id::text',
    "v_user.created_at < clock_timestamp()-interval '15 minutes'", 'security invoker set search_path',
    'grant execute on function public.astra_register_staging_forecast_fixture(uuid,text,text) to service_role;']) assert.ok(sql.includes(fragment));
  assert.match(source, /const site = 'https:\/\/duediligence-examinations-staging\.wallyesteban1993\.workers\.dev'/);
  assert.match(source, /const ref = 'hlzqmreeoghbldnhlybr'/);
  assert.doesNotMatch(source, /\/rest\/v1\/user_roles|\/rest\/v1\/internal_test_accounts|method:\s*'PATCH'/);
  assert.equal((source.match(/method: 'DELETE'|method:'DELETE'/g) || []).length, 2);
  assert.ok(source.indexOf('await registerEntryFixture(userId, fixture, service);') < source.indexOf("await service('/rest/v1/free_beta_access?"));
  assert.ok(source.includes('independentCleanupVerificationComplete: false'));
  assert.ok(source.includes('pulse_fixture_rows_not_independently_checked'));
});

test('mandatory and protected gates include the exact inert regression without broadening release scope', async () => {
  const file = 'scripts/test-astra-forecast-entry-registration.mjs';
  const mandatory = await readFile(new URL('../.github/workflows/validate-mandatory-early-access.yml', import.meta.url), 'utf8');
  const release = await readFile(new URL('../.github/workflows/release-unlimited-feature-access.yml', import.meta.url), 'utf8');
  const scopeStart = release.indexOf('          approved_scope=');
  const scopeEnd = release.indexOf('          actual_scope=', scopeStart);
  assert.ok(scopeStart >= 0 && scopeEnd > scopeStart);
  const scope = release.slice(scopeStart, scopeEnd);
  assert.equal(mandatory.split(`      - '${file}'`).length - 1, 1);
  assert.equal(scope.split(`            ${file} \\`).length - 1, 1);
  for (const workflow of [mandatory, release]) {
    assert.equal(workflow.split(`          node ${file}`).length - 1, 1);
    assert.match(workflow, /node scripts\/test-astra-forecast-entry-cleanup-evidence\.mjs\r?\n\s+node scripts\/test-astra-forecast-entry-registration\.mjs/);
    for (const preserved of ['node scripts/test-forecast-cold-entry-cancellation.mjs',
      'node scripts/test-quorum-navigation-intent.mjs', 'node scripts/test-forecast-poll-rate-contract.mjs',
      'node scripts/test-forecast-multiline-editor.mjs --browser', 'node scripts/test-forecast-structured-selection.mjs --browser',
      'node scripts/astra-release-database-contract.mjs --self-test', 'node scripts/verify-astra-forecast-staging.mjs --self-test']) {
      assert.ok(workflow.includes(preserved), `Existing gate is missing: ${preserved}`);
    }
    assert.ok(workflow.indexOf(`          node ${file}`) < workflow.indexOf('node scripts/verify-astra-forecast-staging.mjs --self-test-browser'));
  }
  for (const preserved of ['This focused release may not delete files.',
    'The release contains files outside the reviewed Forecast and Bar Simulation boundary',
    'test "$PRODUCT_SHA" = "$GITHUB_SHA"', 'node scripts/astra-release-database-contract.mjs --verify-attestation']) {
    assert.ok(release.includes(preserved));
  }
  assert.ok(release.indexOf(`          node ${file}`) < release.indexOf('run: node scripts/verify-forecast-entry-staging.mjs'));
  assert.doesNotMatch(scope, /scripts\/test-astra-forecast-entry-\*/);
});

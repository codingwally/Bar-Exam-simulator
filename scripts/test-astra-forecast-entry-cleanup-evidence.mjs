import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Exercise the actual pure runner helpers without importing its executing
// staging entrypoint, loading credentials, starting a browser, or using network.
const source = await readFile(new URL('./verify-forecast-entry-staging.mjs', import.meta.url), 'utf8');
const helpers = source.split('// ASTRA_ENTRY_CLEANUP_HELPERS_BEGIN')[1].split('// ASTRA_ENTRY_CLEANUP_HELPERS_END')[0];
const { entryCleanupManifest, readEntryCleanupAbsence, entryCleanupReadbackComplete } = vm.runInNewContext(
  `${helpers.replace(/^export /gm, '')}\n({entryCleanupManifest,readEntryCleanupAbsence,entryCleanupReadbackComplete})`, { assert });
const id = '11111111-1111-4111-8111-111111111111';
const secret = 'Bearer private-token private.person@example.invalid /proof/private-object.png';
const plain = value => JSON.parse(JSON.stringify(value));

test('manifest retains only exact fixture IDs and closed-schema cleanup metadata', () => {
  const value = plain(entryCleanupManifest({ fixtureUserIds: [id, id], creationState: 'recorded', sourceSha: 'a'.repeat(40),
    readback: { authUser: 'absent', profile: secret, token: secret }, email: secret, profile: { token: secret } }));
  assert.deepEqual(value.fixtureUserIds, [id]);
  assert.equal(value.projectRef, 'hlzqmreeoghbldnhlybr');
  assert.equal(value.cleanupReadback.authUser, 'absent');
  assert.equal(value.cleanupReadback.profile, 'not_checked');
  assert.equal(value.authSessions, 'limited_no_existing_auth_schema_read_transport');
  assert.doesNotMatch(JSON.stringify(value), /private-token|private\.person|private-object/);
  assert.throws(() => entryCleanupManifest({ fixtureUserIds: [secret], creationState: 'recorded' }));
});

test('unknown Auth-create outcome is never reported as a successful empty cleanup', () => {
  assert.equal(entryCleanupReadbackComplete({ creationState: 'not_requested', readback: {} }), true);
  assert.equal(entryCleanupReadbackComplete({ creationState: 'requested', readback: {} }), false);
  assert.equal(entryCleanupReadbackComplete({ creationState: 'recorded', readback: {} }), false);
  assert.equal(entryCleanupManifest({ fixtureUserIds: [], creationState: 'requested' }).creationState, 'requested');
});

test('all supported readbacks use only the exact fixture ID and report Auth404 plus empty rows', async () => {
  const seen = [];
  const result = plain(await readEntryCleanupAbsence(id, {
    authStatus: async actual => { assert.equal(actual, id); return 404; },
    rows: async route => { seen.push(route); return []; },
  }));
  assert.deepEqual(result, { authUser: 'absent', profile: 'absent', forecastAttempts: 'absent', usageEvents: 'absent', usageSessions: 'absent' });
  assert.equal(seen.length, 4);
  for (const route of seen) assert.match(route, new RegExp(`=eq\\.${id}\\&select=id\\&limit=1$`));
  assert.equal(entryCleanupReadbackComplete({ userId: id, creationState: 'recorded', readback: result }), true);
});

test('surviving Auth/attempt rows or unavailable checks fail supported cleanup readback', async () => {
  for (const status of [200, 401, 403, 500]) {
    const result = await readEntryCleanupAbsence(id, { authStatus: async () => status, rows: async () => [] });
    assert.equal(entryCleanupReadbackComplete({ userId: id, creationState: 'recorded', readback: result }), false);
  }
  const remaining = await readEntryCleanupAbsence(id, { authStatus: async () => 404,
    rows: async route => route.includes('dd2026_forecast_attempts') ? [{ id }] : [] });
  assert.equal(remaining.forecastAttempts, 'present');
  assert.equal(entryCleanupReadbackComplete({ userId: id, creationState: 'recorded', readback: remaining }), false);
});

test('transport and malformed responses are closed-schema unavailable, without private errors', async () => {
  const result = await readEntryCleanupAbsence(id, { authStatus: async () => { throw new Error(secret); },
    rows: async route => { if (route.includes('profiles')) return { token: secret }; throw new Error(secret); } });
  assert.ok(Object.values(result).every(value => value === 'unavailable'));
  assert.doesNotMatch(JSON.stringify(result), /private-token|private\.person|private-object/);
});

test('runner persists identity before login and performs bounded readback before final evidence', () => {
  assert.match(source, /creationState = 'requested';\s*await persistCleanupManifest\(\);\s*const created = await service/);
  assert.match(source, /creationState = 'recorded';\s*await persistCleanupManifest\(\);[^\n]*\n\s*registrationState = 'requested';\s*await persistCleanupManifest\(\);\s*await registerEntryFixture\(userId, fixture, service\);\s*registrationState = 'confirmed';\s*await persistCleanupManifest\(\);[^\n]*\n\s*const session = await request/);
  assert.match(source, /authStatus:[\s\S]*?method: 'GET'[\s\S]*?AbortSignal.timeout\(30000\)/);
  assert.match(source, /let cleanupManifestSaved = false;[\s\S]*?finally \{[\s\S]*?await rm\(privateDir[\s\S]*?finally \{[\s\S]*?summary.json/);
  assert.match(source, /independentCleanupVerificationComplete: false/);
  assert.match(source, /cleanupVerificationLimitations: \['auth_sessions_not_exposed_by_existing_service_transport', 'pulse_fixture_rows_not_independently_checked'\]/);
  assert.equal((source.match(/method: 'DELETE'|method:'DELETE'/g) || []).length, 2, 'No additional deletion surface');
});

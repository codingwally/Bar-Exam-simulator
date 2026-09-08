import assert from 'node:assert/strict';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PAYMENT_FIXTURE_TARGET = Object.freeze({
  projectRef: 'hlzqmreeoghbldnhlybr',
  supabaseUrl: 'https://hlzqmreeoghbldnhlybr.supabase.co',
  workerUrl: 'https://duediligence-examinations-staging.wallyesteban1993.workers.dev',
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const REGISTRAR = '/rest/v1/rpc/astra_register_staging_payment_fixture';
const VERSION = 'astra-staging-complete-beta-v1';
const root = fileURLToPath(new URL('../', import.meta.url));

export function paymentFixtureIdentity(runId, label) {
  assert.equal(typeof runId, 'string'); assert.equal(/[\r\n]/u.test(runId), false);
  assert.match(runId, /^[a-z0-9]{8,12}-[a-f0-9]{8}$/u);
  assert.ok(['student','peer'].includes(label));
  return { runId, label, email: `dd-complete-beta-${label}-${runId}@duediligence.ph`,
    displayName: `Release ${label}`,
    appMetadata: { astra_staging_complete_beta_fixture: { version: 1, runId, label } } };
}

export function createPaymentFixtureLifecycle({ runId, supabaseUrl, workerUrl,
  serviceRoleKey, publishableKey, sourceSha = null, request = fetch, persist = null }) {
  assert.equal(supabaseUrl, PAYMENT_FIXTURE_TARGET.supabaseUrl);
  assert.equal(workerUrl, PAYMENT_FIXTURE_TARGET.workerUrl);
  assert.match(serviceRoleKey, /^sb_secret_[A-Za-z0-9_-]{20,}$/u);
  assert.match(publishableKey, /^sb_publishable_[A-Za-z0-9_-]{20,}$/u);
  paymentFixtureIdentity(runId, 'student');
  assert.ok(sourceSha === null || /^[a-f0-9]{40}$/u.test(sourceSha));
  const records = new Map(); const sessions = new Map();
  let ready = false; let initialized = false; let cleanupComplete = false;
  const manifestPath = path.join(root, 'artifacts', 'staging-e2e', `complete-beta-${runId}-cleanup-manifest.json`);
  const snapshot = () => ({ schemaVersion: 1, purpose: 'complete-beta-staging-verification',
    projectRef: PAYMENT_FIXTURE_TARGET.projectRef, sourceSha, suite: 'complete-beta', runId, cleanupComplete,
    cleanupScope: 'supported-api-exact-fixtures', independentDatabaseReadbackRequired: true,
    authSessions: 'not_directly_exposed', pulseAudit: 'retain-internal-test-events',
    examinationAudit: 'retain-exact-synthetic-run-audit-not-frozen-data-scope',
    fixtures: [...records.values()].map(record => ({ ...record, auditRowIds: [...record.auditRowIds] })) });
  async function save() {
    const value = snapshot();
    if (persist) { await persist(value); return; }
    await mkdir(path.dirname(manifestPath), { recursive: true });
    const contents = `${JSON.stringify(value, null, 2)}\n`;
    if (!initialized) {
      await writeFile(manifestPath, contents, { mode: 0o600, flag: 'wx' }); initialized = true;
    } else {
      // Never truncate the last successful checkpoint. A stale temporary file
      // fails closed; it does not authorize replacement of another run's intent.
      await writeFile(`${manifestPath}.tmp`, contents, { mode: 0o600, flag: 'wx' });
      await rename(`${manifestPath}.tmp`, manifestPath);
    }
  }
  async function service(route, options = {}, expected = [200]) {
    assert.ok(route.startsWith('/auth/v1/') || route.startsWith('/rest/v1/'));
    const response = await request(`${supabaseUrl}${route}`, { ...options, redirect: 'error',
      headers: { apikey: serviceRoleKey, 'Content-Type': 'application/json', ...options.headers },
      signal: AbortSignal.timeout(30000) });
    const body = await response.json().catch(() => null);
    assert.ok(expected.includes(response.status), 'Staging complete-beta fixture transport failed');
    return { status: response.status, body, contentRange: response.headers.get('content-range') };
  }
  const byId = id => {
    assert.match(id, UUID);
    const record = [...records.values()].find(item => item.id === id);
    assert.ok(record, 'Cleanup identity was not recorded by this run'); return record;
  };
  const registered = id => {
    const record = byId(id);
    assert.equal(record.registrationState, 'confirmed', 'Registration must precede fixture actions');
    return record;
  };
  async function verifyCleanupIdentity(id) {
    const record = byId(id); const identity = paymentFixtureIdentity(runId, record.label);
    const { status, body } = await service(`/auth/v1/admin/users/${id}`, {}, [200, 404]);
    if (status === 404) {
      assert.equal(record.cleanupState, 'deleted', 'Auth disappeared before this run captured its audit provenance');
      return false;
    }
    assert.equal(body?.id, id); assert.equal(body?.email, identity.email);
    assert.deepEqual(body?.app_metadata?.astra_staging_complete_beta_fixture,
      identity.appMetadata.astra_staging_complete_beta_fixture);
    assert.equal(body?.app_metadata?.provider, 'email');
    assert.deepEqual(body?.app_metadata?.providers, ['email']);
    assert.equal(body?.user_metadata?.display_name, identity.displayName);
    if (record.signInState === 'not_requested') assert.equal(body.last_sign_in_at, null);
    return true;
  }
  async function captureAudit(id) {
    const record = byId(id);
    // Preserve fixture-actor audit AND the existing administrator's exact
    // fixture-target Beta grant. No administrator identity is a cleanup target.
    const query = new URLSearchParams({
      or: `(actor_user_id.eq.${id},and(action.eq.admin_set_beta_access,resource_type.eq.examination_management,resource_id.eq.${id},reason.eq.Complete beta staging verification ${runId}))`,
      select: 'id', order: 'id.asc', limit: '501',
    });
    const { body, contentRange } = await service(`/rest/v1/examination_audit_log?${query}`,
      { headers: { Prefer: 'count=exact' } });
    assert.ok(Array.isArray(body) && body.length <= 500, 'Synthetic audit capture exceeded its explicit bound');
    const total = /^(?:\d+-\d+|\*)\/(\d+)$/u.exec(contentRange || '');
    assert.ok(total && Number(total[1]) === body.length, 'Synthetic audit capture was incomplete');
    const ids = body.map(row => {
      assert.deepEqual(Object.keys(row), ['id']);
      assert.ok((typeof row.id === 'number' && Number.isSafeInteger(row.id) && row.id > 0)
        || (typeof row.id === 'string' && /^[1-9][0-9]{0,18}$/u.test(row.id)));
      return String(row.id);
    });
    assert.equal(new Set(ids).size, ids.length);
    record.auditRowIds = [...new Set([...record.auditRowIds, ...ids])].sort();
    record.auditCaptureState = 'captured-before-auth-delete';
    record.auditProvenance = 'exact-fixture-actor-or-admin-beta-target-and-run-reason';
    // The fixture UUID/label/run and registered classification stay in this
    // manifest when Auth deletion sets examination_audit_log.actor_user_id NULL.
    await save();
  }
  return Object.freeze({
    manifestPath, snapshot,
    async preflight() {
      assert.equal(ready, false); await save();
      const { body } = await service(REGISTRAR, { method: 'POST', body: JSON.stringify({
        p_user_id: null, p_run_id: null, p_label: null }) }, [400]);
      assert.equal(body?.code, 'P0001');
      assert.equal(body?.message, 'Staging complete-beta fixture identity is invalid');
      ready = true;
    },
    async beforeCreate(label) {
      assert.equal(ready, true); assert.equal(records.has(label), false, 'Never repeat an uncertain Auth creation');
      const identity = paymentFixtureIdentity(runId, label);
      records.set(label, { label, id: null,
        classificationSource: `astra_complete_beta_staging_v1:${runId}:${label}`,
        creationState: 'requested', registrationState: 'not_requested',
        signInState: 'not_requested', signOutState: 'not_requested',
        cleanupState: 'pending', auditCaptureState: 'not_requested', auditRowIds: [] });
      await save(); return identity;
    },
    async recordCreated(label, id) {
      assert.match(id, UUID); const record = records.get(label);
      assert.ok(record && record.creationState === 'requested' && record.id === null);
      assert.ok(![...records.values()].some(item => item.id === id));
      record.id = id; record.creationState = 'recorded'; await save();
    },
    async register(id) {
      const record = byId(id); assert.equal(record.registrationState, 'not_requested');
      record.registrationState = 'requested'; await save();
      const { body } = await service(REGISTRAR, { method: 'POST', body: JSON.stringify({
        p_user_id: id, p_run_id: runId, p_label: record.label }) });
      assert.deepEqual(Object.keys(body || {}).sort(), ['dataScope','fixtureUserId','registered','registrationVersion','replayed']);
      assert.equal(body.registered, true); assert.equal(body.fixtureUserId, id);
      assert.equal(body.dataScope, 'internal_test'); assert.equal(body.registrationVersion, VERSION);
      assert.equal(typeof body.replayed, 'boolean');
      record.registrationState = 'confirmed'; await save();
    },
    async beforeSignIn(id) {
      const record = registered(id); assert.equal(record.signInState, 'not_requested');
      record.signInState = 'requested'; await save();
    },
    async rememberSession(id, session) {
      const record = registered(id); assert.equal(record.signInState, 'requested');
      assert.equal(session?.user?.id, id); assert.ok(typeof session.access_token === 'string' && session.access_token);
      sessions.set(id, session.access_token); record.signInState = 'confirmed'; await save();
    },
    verifyCleanupIdentity,
    async deleteUser(id) {
      const record = byId(id); if (!await verifyCleanupIdentity(id)) return;
      if (record.signInState !== 'not_requested') {
        const token = sessions.get(id);
        assert.ok(token, 'Uncertain sign-in requires independent session recovery before Auth deletion');
        record.signOutState = 'requested'; await save();
        await service('/auth/v1/logout?scope=global', { method: 'POST',
          headers: { Authorization: `Bearer ${token}` } }, [200, 204]);
        record.signOutState = 'confirmed'; await save();
      }
      await captureAudit(id);
      record.cleanupState = 'delete_requested'; await save();
      await service(`/auth/v1/admin/users/${id}`, { method: 'DELETE' }, [200, 204]);
      const absence = await service(`/auth/v1/admin/users/${id}`, {}, [200, 404]);
      assert.equal(absence.status, 404, 'Exact fixture Auth deletion was not confirmed');
      record.cleanupState = 'deleted'; sessions.delete(id); await save();
    },
    async finishCleanup(otherCleanupSucceeded) {
      cleanupComplete = otherCleanupSucceeded === true && [...records.values()].every(record =>
        record.creationState === 'recorded' && record.cleanupState === 'deleted'
        && record.auditCaptureState === 'captured-before-auth-delete');
      await save(); assert.equal(cleanupComplete, true, 'Exact fixture cleanup or creation outcome is unresolved');
    },
  });
}

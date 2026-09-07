import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { completeMandatoryCommercialProfile } from './staging-commercial-user.mjs';

// ASTRA_ENTRY_CLEANUP_HELPERS_BEGIN
export function entryCleanupManifest({ fixtureUserIds = [], creationState, sourceSha, readback = {}, fixture = null, registrationState = 'not_requested' }) {
  assert.ok(['not_requested', 'requested', 'recorded'].includes(creationState));
  assert.ok(Array.isArray(fixtureUserIds));
  for (const id of fixtureUserIds) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.ok(['not_requested', 'requested', 'confirmed'].includes(registrationState));
  if (fixture) {
    assert.match(fixture.prefix, /^astra-durable-[0-9]{13}-[a-f0-9]{8}$/);
    assert.equal(fixture.prefix, fixture.prefix.trim());
    assert.equal(fixture.kind, 'member');
    assert.equal(fixture.purpose, 'forecast-entry-smoke');
  }
  const status = value => ['not_checked', 'absent', 'present', 'unavailable'].includes(value) ? value : 'not_checked';
  return {
    schemaVersion: 'astra-entry-cleanup-v1', target: 'staging-only', projectRef: 'hlzqmreeoghbldnhlybr',
    sourceSha: /^[0-9a-f]{40}$/i.test(sourceSha || '') ? sourceSha : null,
    fixtureUserIds: [...new Set(fixtureUserIds)], creationState,
    fixturePurpose: 'forecast-entry-smoke',
    fixtureRegistration: { state: registrationState, prefix: fixture?.prefix || null, kind: fixture?.kind || null,
      version: 'astra-staging-forecast-v1', authority: 'existing-service-only-registry-rpc' },
    cleanupReadback: Object.fromEntries(['authUser', 'profile', 'forecastAttempts', 'usageEvents', 'usageSessions'].map(name => [name, status(readback[name])])),
    authSessions: 'limited_no_existing_auth_schema_read_transport',
    pulseFixtureRows: 'not_independently_checked',
  };
}

export async function readEntryCleanupAbsence(userId, { authStatus, rows }) {
  assert.match(userId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const entries = await Promise.all([
    (async () => { try { const status = await authStatus(userId); return ['authUser', status === 404 ? 'absent' : status === 200 ? 'present' : 'unavailable']; } catch { return ['authUser', 'unavailable']; } })(),
    ...[
      ['profile', 'profiles', 'id'], ['forecastAttempts', 'dd2026_forecast_attempts', 'owner_id'],
      ['usageEvents', 'usage_events', 'user_id'], ['usageSessions', 'usage_sessions', 'user_id'],
    ].map(async ([name, table, owner]) => {
      try {
        const result = await rows(`/rest/v1/${table}?${owner}=eq.${userId}&select=id&limit=1`);
        return [name, Array.isArray(result) ? result.length === 0 ? 'absent' : 'present' : 'unavailable'];
      } catch { return [name, 'unavailable']; }
    }),
  ]);
  return Object.fromEntries(entries);
}

export function entryCleanupReadbackComplete({ userId, creationState, readback }) {
  // A timed-out create may have committed without returning an ID. Never turn
  // that unknown outcome into the previous no-user cleanup=true shortcut.
  if (!userId) return creationState === 'not_requested';
  return creationState === 'recorded'
    && ['authUser', 'profile', 'forecastAttempts', 'usageEvents', 'usageSessions'].every(name => readback[name] === 'absent');
}
// ASTRA_ENTRY_CLEANUP_HELPERS_END

// ASTRA_ENTRY_REGISTRATION_HELPERS_BEGIN
export function entryFixtureIdentity(runPrefix) {
  assert.match(runPrefix, /^astra-entry-[0-9]{13}-[a-f0-9]{8}$/);
  assert.equal(runPrefix, runPrefix.trim());
  // Reuse the deployed infrastructure namespace, not its three-journey test.
  // This fixture remains explicitly labelled as a single entry/editor smoke.
  const prefix = runPrefix.replace(/^astra-entry-/, 'astra-durable-');
  return Object.freeze({ prefix, kind: 'member', purpose: 'forecast-entry-smoke', email: `${prefix}-member@example.com` });
}

export async function preflightEntryFixtureRegistration(service) {
  // Invalid input is rejected before Auth reads or registry writes. Fail before
  // creating an account when the existing optional staging RPC is unavailable.
  const denied = await service('/rest/v1/rpc/astra_register_staging_forecast_fixture', { method: 'POST',
    body: JSON.stringify({ p_user_id: null, p_fixture_prefix: null, p_fixture_kind: null }) }, [400]);
  assert.equal(denied?.code, 'P0001');
  assert.equal(denied.message, 'Staging fixture identity is invalid');
}

export async function registerEntryFixture(userId, fixture, service) {
  const registration = await service('/rest/v1/rpc/astra_register_staging_forecast_fixture', { method: 'POST',
    body: JSON.stringify({ p_user_id: userId, p_fixture_prefix: fixture.prefix, p_fixture_kind: fixture.kind }) });
  assert.equal(registration?.registered, true);
  assert.equal(registration.fixtureUserId, userId);
  assert.equal(registration.dataScope, 'internal_test');
  assert.equal(registration.registrationVersion, 'astra-staging-forecast-v1');
  assert.equal(typeof registration.replayed, 'boolean');
}
// ASTRA_ENTRY_REGISTRATION_HELPERS_END

// This runner never accepts a production target or uses customer accounts.
const site = 'https://duediligence-examinations-staging.wallyesteban1993.workers.dev';
const ref = 'hlzqmreeoghbldnhlybr';
const db = `https://${ref}.supabase.co`;
const key = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
assert.ok(key?.length > 30, 'Protected staging service credentials are required');
const run = promisify(execFile);
const prefix = `astra-entry-${Date.now()}-${randomBytes(4).toString('hex')}`;
const fixture = entryFixtureIdentity(prefix);
const privateDir = await mkdtemp(path.join(tmpdir(), 'dd-astra-entry-'));
const evidenceDir = path.resolve('artifacts/astra-forecast-entry');
await mkdir(evidenceDir, { recursive: true });
const statePath = path.join(privateDir, 'auth-state.json');
const checks = [];
let userId;
let creationState = 'not_requested';
let registrationState = 'not_requested';
let cleanupReadback = {};
let cleanupComplete = false;
let verificationComplete = false;
let browserSessionClosed = false;
let privateAuthStateRemoved = false;
const persistCleanupManifest = () => writeFile(path.join(evidenceDir, 'cleanup-manifest.json'), JSON.stringify(entryCleanupManifest({
  fixtureUserIds: userId ? [userId] : [], creationState, sourceSha: process.env.GITHUB_SHA, readback: cleanupReadback,
  fixture, registrationState,
}), null, 2), { mode: 0o600 });
await persistCleanupManifest();

async function request(url, options = {}, expected = [200]) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  const body = await response.json().catch(() => null);
  assert.ok(expected.includes(response.status), `Staging ${options.method || 'GET'} ${new URL(url).pathname} returned ${response.status}`);
  return body;
}
const serviceHeaders = { apikey: key, 'Content-Type': 'application/json', ...(/^eyJ/.test(key) ? { Authorization: `Bearer ${key}` } : {}) };
const service = (route, options = {}, expected) => request(`${db}${route}`, { ...options, headers: { ...serviceHeaders, ...options.headers } }, expected);
async function browser(...args) {
  try {
    const result = await run('npx', ['--yes', 'agent-browser@0.36.0', '--session', prefix, ...args], { timeout: 65000, maxBuffer: 1000000, windowsHide: true });
    return result.stdout;
  } catch (error) {
    const scrub = value => String(value || '').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[session]').replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, '[key]').replace(/\S+@\S+/g, '[test-account]').slice(0,5000);
    await writeFile(path.join(evidenceDir, 'failure-action.json'), JSON.stringify({ action: args[0], arguments: args.slice(1).map(scrub), detail: scrub(error.stderr || error.stdout || error.message) }, null, 2));
    await run('npx', ['--yes','agent-browser@0.36.0','--session',prefix,'screenshot',path.join(evidenceDir,'failure.png')], { timeout: 15000, windowsHide: true }).catch(() => {});
    const snapshot = await run('npx', ['--yes','agent-browser@0.36.0','--session',prefix,'snapshot','-i'], { timeout:15000, windowsHide:true }).catch(() => null);
    if (snapshot) await writeFile(path.join(evidenceDir,'failure-snapshot.txt'),scrub(snapshot.stdout));
    const state = await run('npx', ['--yes','agent-browser@0.36.0','--session',prefix,'eval',
      `JSON.stringify({hash:location.hash,forecastHidden:document.getElementById('bf26-root')?.hidden,forecastText:document.querySelector('[data-bf26-view]')?.textContent?.slice(0,1500),navigation:[...document.querySelectorAll('[data-public-feature="bar-forecast"]')].map(b=>({disabled:b.disabled,busy:b.getAttribute('aria-busy')}))})`],
      {timeout:15000,windowsHide:true}).catch(()=>null);
    if(state) await writeFile(path.join(evidenceDir,'failure-view-state.json'),scrub(state.stdout));
    // Keep credentials out of CI logs; sanitized diagnostics are private artifacts.
    throw new Error(`Authenticated staging browser action failed: ${args[0]}`);
  }
}
async function openPicker(label) {
  await browser('open', `${site}/#bar-forecast-2026`);
  await browser('wait', '.bf26-subject-grid');
  const snapshot = await browser('snapshot', '-i');
  assert.match(snapshot, /Start forecast/);
  assert.doesNotMatch(snapshot, /Administrator access required|Checking Forecast access/);
  await browser('screenshot', path.join(evidenceDir, `${label}.png`));
  checks.push(label);
}

try {
  const config = await fetch(`${site}/assets/phase2-config.js`).then(r => r.text());
  assert.ok(config.includes(ref) && !config.includes('hbllomlijfznnuudpdvr'));
  const publishable = config.match(/sb_publishable_[A-Za-z0-9_-]{20,}/)?.[0];
  assert.ok(publishable);
  const email = fixture.email;
  const password = `Dd!${randomBytes(32).toString('base64url')}`;
  await preflightEntryFixtureRegistration(service);
  creationState = 'requested';
  await persistCleanupManifest();
  const created = await service('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true,
    app_metadata: { astra_staging_fixture: { version: 1, prefix: fixture.prefix, kind: fixture.kind } },
    user_metadata: { full_name: 'Astra isolated staging entry verification', internal_test: true,
      astra_fixture_prefix: fixture.prefix, astra_fixture_purpose: fixture.purpose } }) }, [200, 201]);
  assert.match(created?.id || '', /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  userId = created.id;
  creationState = 'recorded';
  await persistCleanupManifest(); // Before login or any other fixture side effect.
  registrationState = 'requested';
  await persistCleanupManifest();
  await registerEntryFixture(userId, fixture, service);
  registrationState = 'confirmed';
  await persistCleanupManifest(); // Confirmed authoritative classification precedes normal sign-in.
  const session = await request(`${db}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: publishable, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(session.user.id, userId);
  const settings = await service('/rest/v1/platform_access_settings?singleton=eq.true&select=current_terms_version,current_privacy_version');
  assert.equal(settings.length, 1);
  await request(`${db}/rest/v1/rpc/accept_terms`, { method: 'POST', headers: { apikey: publishable, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_terms_version: settings[0].current_terms_version, p_privacy_version: settings[0].current_privacy_version, p_acceptance_source: 'astra_staging_entry_verification' }) }, [200, 204]);
  await completeMandatoryCommercialProfile({ supabaseUrl: db, publishableKey: publishable, workerUrl: site, token: session.access_token, displayName: 'Astra isolated staging verification', termsVersion: settings[0].current_terms_version, privacyVersion: settings[0].current_privacy_version });
  await service('/rest/v1/free_beta_access?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ user_id: userId, enabled: true, expires_at: new Date(Date.now() + 3600000).toISOString(), reason: prefix, created_by: userId, updated_by: userId, access_program: 'founding_beta_2026' }) }, [200, 201, 204]);
  await service('/rest/v1/dd2026_bar_forecast_consents', { method: 'POST', body: JSON.stringify({ user_id: userId, consent_version: '2026-09-01', accepted_at: new Date().toISOString() }) }, [200, 201]);
  await writeFile(statePath, JSON.stringify({ cookies: [], origins: [{ origin: site, localStorage: [{ name: `sb-${ref}-auth-token`, value: JSON.stringify(session) }] }] }), { mode: 0o600 });
  await browser('--state', statePath, 'open', site);
  await openPicker('01-authenticated-founding-beta-entry');
  await browser('click', '[data-subject="Civil Law and Land Titles and Deeds"]');
  await browser('wait', '#bf26-current-answer');
  const exam = await browser('snapshot', '-i');
  assert.match(exam, /Submit|Next/);
  await browser('screenshot', path.join(evidenceDir, '02-real-question-editor.png'));
  checks.push('real-server-20-question-editor');
  await browser('reload');
  await browser('wait', '.bf26-subject-grid');
  checks.push('reload-bounded-entry');
  await browser('find', 'role', 'button', 'click', '--name', 'Close forecast');
  // Closing starts ordinary Home restoration, which temporarily disables all
  // feature buttons. Observe actual readiness instead of dropping the next tap.
  await browser('wait', '.qfs-practice-rail [data-public-feature="bar-forecast"]:not(:disabled)');
  await browser('network', 'route', `${site}/admin/dd2026/bar-forecast`, '--body', JSON.stringify({ ok: false, error: { code: 'BAR_FORECAST_GRADING_UNAVAILABLE', message: 'Controlled staging response failure.' } }));
  // Exercise the actual user launcher. A same-document CLI `open` after Close
  // can remain on the Home shell without invoking the application's launcher.
  const home = await browser('snapshot', '-i');
  assert.match(home, /button "2026 Bar Forecast"/);
  await browser('find', 'role', 'button', 'click', '--name', '2026 Bar Forecast', '--exact');
  await browser('wait', '--text', 'Try again');
  const failed = await browser('snapshot', '-i');
  assert.match(failed, /Try again/);
  checks.push('injected-failure-terminal-manual-retry');
  await browser('screenshot', path.join(evidenceDir, '03-controlled-error.png'));
  await browser('network', 'unroute', `${site}/admin/dd2026/bar-forecast`);
  await browser('find', 'role', 'button', 'click', '--name', 'Try again');
  await browser('wait', '.bf26-subject-grid');
  checks.push('manual-retry-restores-real-server-picker');
  const errors = await browser('errors');
  assert.doesNotMatch(errors, /TypeError|ReferenceError|SyntaxError/);
  verificationComplete = true;
} finally {
  await browser('close').then(() => { browserSessionClosed = true; }).catch(() => {});
  try {
    if (userId) {
      // Analytics rows use SET NULL FKs but signed-in checks require an owner.
      // Remove only this disposable fixture's activity before deleting Auth.
      for (const table of ['usage_events', 'usage_sessions']) {
        await service(`/rest/v1/${table}?user_id=eq.${userId}`, { method:'DELETE' }, [200,204]);
      }
      await service(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' }, [200, 204]);
    }
  } finally {
    if (userId && creationState === 'recorded') cleanupReadback = await readEntryCleanupAbsence(userId, {
      authStatus: async id => {
        const response = await fetch(`${db}/auth/v1/admin/users/${id}`, { method: 'GET', headers: serviceHeaders, signal: AbortSignal.timeout(30000) });
        await response.body?.cancel(); // No Auth profile/session/token body is read or persisted.
        return response.status;
      },
      rows: route => service(route),
    });
    cleanupComplete = entryCleanupReadbackComplete({ userId, creationState, readback: cleanupReadback });
    let cleanupManifestSaved = false;
    try { await persistCleanupManifest(); cleanupManifestSaved = true; } // IDs survive browser/test/cleanup failures.
    finally {
      // Even failed evidence persistence must not strand private Auth state.
      // This exact private directory was created by this test, never a workspace.
      try { await rm(privateDir, { recursive: true, force: true }); privateAuthStateRemoved = true; }
      finally {
        cleanupComplete = cleanupComplete && browserSessionClosed && privateAuthStateRemoved && cleanupManifestSaved;
        await writeFile(path.join(evidenceDir, 'summary.json'), JSON.stringify({ target: 'staging-only', sourceSha: process.env.GITHUB_SHA || null,
          verificationComplete, checks, cleanupComplete, cleanupManifest: 'cleanup-manifest.json', cleanupManifestSaved, cleanupReadback,
          fixturePurpose: fixture.purpose, fixtureRegistrationState: registrationState,
          browserSessionClosed, privateAuthStateRemoved, independentCleanupVerificationComplete: false,
          cleanupVerificationLimitations: ['auth_sessions_not_exposed_by_existing_service_transport', 'pulse_fixture_rows_not_independently_checked'],
          note: 'Entry/editor smoke. Controlled failure is injected. Cleanup readback covers Auth user, profile, Forecast attempts and usage rows; Auth sessions and Pulse fixtures remain explicitly limited. No grading or production claim.' }, null, 2), { mode: 0o600 });
      }
    }
    assert.equal(cleanupComplete, true, 'Disposable staging cleanup and supported absence checks must complete');
  }
}
console.log(`ASTRA_FORECAST_ENTRY: ${checks.length} checks passed; synthetic_cleanup=${cleanupComplete}`);

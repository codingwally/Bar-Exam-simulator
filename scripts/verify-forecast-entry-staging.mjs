import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { completeMandatoryCommercialProfile } from './staging-commercial-user.mjs';

// This runner never accepts a production target or uses customer accounts.
const site = 'https://duediligence-examinations-staging.wallyesteban1993.workers.dev';
const ref = 'hlzqmreeoghbldnhlybr';
const db = `https://${ref}.supabase.co`;
const key = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
assert.ok(key?.length > 30, 'Protected staging service credentials are required');
const run = promisify(execFile);
const prefix = `astra-entry-${Date.now()}-${randomBytes(4).toString('hex')}`;
const privateDir = await mkdtemp(path.join(tmpdir(), 'dd-astra-entry-'));
const evidenceDir = path.resolve('artifacts/astra-forecast-entry');
await mkdir(evidenceDir, { recursive: true });
const statePath = path.join(privateDir, 'auth-state.json');
const checks = [];
let userId;
let cleanupComplete = false;
let verificationComplete = false;

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
  const email = `${prefix}@example.com`;
  const password = `Dd!${randomBytes(32).toString('base64url')}`;
  const created = await service('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: 'Astra isolated staging verification', internal_test: true } }) }, [200, 201]);
  userId = created.id;
  assert.match(userId, /^[0-9a-f-]{36}$/);
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
  await browser('close').catch(() => {});
  try {
    if (userId) {
      // Analytics rows use SET NULL FKs but signed-in checks require an owner.
      // Remove only this disposable fixture's activity before deleting Auth.
      for (const table of ['usage_events', 'usage_sessions']) {
        await service(`/rest/v1/${table}?user_id=eq.${userId}`, { method:'DELETE' }, [200,204]);
      }
      await service(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' }, [200, 204]);
      const remaining = await service(`/rest/v1/profiles?id=eq.${userId}&select=id`);
      cleanupComplete = remaining.length === 0;
      assert.equal(cleanupComplete, true, 'Disposable staging profile cleanup must complete');
    } else cleanupComplete = true;
  } finally {
    // Exact private directory was created by this test, never a user workspace.
    await rm(privateDir, { recursive: true, force: true });
    await writeFile(path.join(evidenceDir, 'summary.json'), JSON.stringify({ target: 'staging-only', sourceSha: process.env.GITHUB_SHA || null, verificationComplete, checks, cleanupComplete, note: 'Entry/editor smoke. Controlled failure is injected. No grading or production claim.' }, null, 2));
  }
}
console.log(`ASTRA_FORECAST_ENTRY: ${checks.length} checks passed; synthetic_cleanup=${cleanupComplete}`);

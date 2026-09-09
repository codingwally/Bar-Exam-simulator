import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, copyFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGET, CRITICAL_ASSETS, hash, parseBase, previewIds, validatePolicy, buildConfig, sanitizeBaseline, validateBaseline, validatePreservation, captureRemote, validateEvidence, inspectArtifact, resolveStagingPublishableKey, validateSmokeSessions, smokeStaging } from './debate-staging-release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policy = JSON.parse(await readFile(path.join(ROOT, 'worker/debate-staging-policy.json'), 'utf8'));
const base = parseBase(await readFile(path.join(ROOT, policy.baseConfig), 'utf8'));
const versionId = 'b134ccc7-1111-4111-8111-111111111111', preview = '10000000-0000-4000-8000-000000000001';
function remoteFixture() {
  return {
    deployments: { deployments: [{ id: 'deployment-one', versions: [{ version_id: versionId, percentage: 100 }] }] },
    settings: { compatibility_date: base.compatibilityDate, compatibility_flags: base.compatibilityFlags, placement: { region: 'gcp:us-east4' },
      bindings: [...Object.entries(base.vars).map(([name, text]) => ({ name, text, type: 'plain_text' })), ...policy.requiredSecretNames.map(name => ({ name, type: 'secret_text', text: 'DO_NOT_PERSIST_SECRET_VALUE' }))] },
    scriptSettings: { observability: { enabled: true, logs: { enabled: true } }, logpush: false, tail_consumers: [] },
    version: { id: versionId, resources: { script_runtime: { exports: { default: { cache: { enabled: false } } } } } },
    schedules: { schedules: [{ cron: '*/2 * * * *' }] }, subdomain: { enabled: true, previews_enabled: true },
  };
}
const baseline = () => sanitizeBaseline(remoteFixture(), base);

test('derived configuration preserves every base byte apart from path resolution and its additive closed Debate overlay', () => {
  const result = buildConfig(base, policy, preview, '/local/artifact', ROOT);
  const additions = { ...policy.debateVars, DEBATE_PREVIEW_ACTOR_IDS: preview };
  let restored = result.text.replace('keep_vars = true\n', '');
  for (const [key, value] of Object.entries(additions)) restored = restored.replace(`${key} = ${JSON.stringify(value)}\n`, '');
  restored = restored.replace(/^main\s*=.*$/m, 'main = "commercial-entry.mjs"').replace(/^directory\s*=.*$/m, 'directory = "../.staging-dist"');
  assert.equal(restored.replaceAll('\r\n', '\n'), base.source.replaceAll('\r\n', '\n'));
  assert.equal(result.hash, hash(result.text)); assert.deepEqual(result.previewActorIds, [preview]);
  for (const value of ['', '*', 'person@example.test', `${preview},${preview}`, `${preview}\nOUTBOUND_EMAIL_MODE=enabled`]) assert.throws(() => previewIds(value), { code: 'PREVIEW_ALLOWLIST_REQUIRED' });
  assert.throws(() => validatePolicy({ ...policy, publicUrl: 'https://duediligence.ph' }), { code: 'WRONG_TARGET' });
  assert.throws(() => validatePolicy({ ...policy, debateVars: { ...policy.debateVars, DEBATE_ROOM_ENABLED: 'true' } }), { code: 'UNSAFE_DEBATE_FLAGS' });
});

test('baseline backup retains all secret names/types but no secret or unreviewed variable values', () => {
  const raw = remoteFixture(); raw.settings.bindings.push({ name: 'UNREVIEWED_TEXT', type: 'plain_text', text: 'PRIVATE_VALUE_NO_LOG' });
  const result = sanitizeBaseline(raw, base), serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('DO_NOT_PERSIST_SECRET_VALUE')); assert.ok(!serialized.includes('PRIVATE_VALUE_NO_LOG'));
  assert.equal(result.state.undisclosedVariableHashes.UNREVIEWED_TEXT, hash('PRIVATE_VALUE_NO_LOG'));
  assert.equal(result.state.vars.SUPABASE_URL, `https://${TARGET.project}.supabase.co`);
  for (const name of policy.requiredSecretNames) assert.ok(result.state.bindings.some(binding => binding.name === name && binding.type === 'secret_text'));
  assert.equal(validateBaseline(result, base, policy, result.fingerprint, versionId), true);
  raw.settings.bindings.push({ name: 'UNEXPECTED_BUCKET', type: 'r2_bucket', bucket_name: 'some-other-service' });
  assert.throws(() => sanitizeBaseline(raw, base), { code: 'RESOURCE_BINDING_CHANGED' });
});

test('exact baseline gates reject traffic, version, origin, secret, cron, mail and custom-setting drift', () => {
  const initial = baseline();
  for (const mutate of [
    raw => { raw.deployments.deployments[0].versions[0].percentage = 50; },
    raw => { raw.version.id = '10000000-0000-4000-8000-000000000002'; },
  ]) { const raw = remoteFixture(); mutate(raw); assert.throws(() => sanitizeBaseline(raw, base)); }
  for (const mutate of [
    saved => { saved.state.vars.OUTBOUND_EMAIL_MODE = 'enabled'; },
    saved => { saved.state.vars.SUPABASE_URL = 'https://wrong.supabase.co'; },
    saved => { saved.state.crons = ['* * * * *']; },
    saved => { saved.state.bindings = saved.state.bindings.filter(binding => binding.name !== 'SUPABASE_SERVICE_ROLE_KEY'); },
    saved => { saved.state.limits = { cpu_ms: 100000 }; },
    saved => { saved.state.observability.head_sampling_rate = 0.5; },
  ]) {
    const changed = structuredClone(initial); mutate(changed);
    assert.throws(() => validateBaseline(changed, base, policy, initial.fingerprint, versionId), { code: 'BASELINE_DRIFT' });
    changed.fingerprint = hash(changed.state);
    assert.throws(() => validateBaseline(changed, base, policy, changed.fingerprint, versionId), 'reviewing a new hash alone must not bypass fixed safety settings');
  }
});

test('baseline capture uses only locked-target GET requests, checks credentials first and sanitizes failed API responses', async () => {
  const calls = [], raw = remoteFixture();
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    const suffix = url.split(`/workers/scripts/${TARGET.worker}`)[1];
    const value = { '/deployments': raw.deployments, '/settings': raw.settings, '/script-settings': raw.scriptSettings, [`/versions/${versionId}`]: raw.version, '/schedules': raw.schedules, '/subdomain': raw.subdomain }[suffix];
    assert.ok(value, 'No unreviewed Cloudflare endpoint may be contacted');
    return Response.json({ success: true, result: value });
  };
  await assert.rejects(captureRemote({ accountId: 'a'.repeat(32), base, fetcher }), { code: 'CI_CREDENTIAL_MISSING' }); assert.equal(calls.length, 0);
  const result = await captureRemote({ token: 'test-credential-never-logged', accountId: 'a'.repeat(32), base, fetcher });
  assert.equal(calls.length, 7); assert.ok(calls.every(call => call.options.method === 'GET' && call.options.redirect === 'error' && !call.options.body));
  assert.equal(result.state.versionId, versionId); assert.ok(!JSON.stringify(result).includes('test-credential-never-logged'));
  await assert.rejects(captureRemote({ token: 'test', accountId: 'a'.repeat(32), base, fetcher: async () => Response.json({ error: 'SECRET_BODY' }, { status: 403 }) }), error => error.code === 'CLOUDFLARE_READ_FAILED' && !error.message.includes('SECRET_BODY'));
});

test('postflight permits precisely the reviewed Debate additions and detects removal of another service secret', () => {
  const before = baseline(), after = structuredClone(before), additions = { ...policy.debateVars, DEBATE_PREVIEW_ACTOR_IDS: preview };
  after.state.versionId = '10000000-0000-4000-8000-000000000002'; after.state.deploymentId = 'deployment-two';
  Object.assign(after.state.vars, additions);
  after.state.bindings.push(...Object.keys(additions).map(name => ({ name, type: 'plain_text' })));
  after.state.bindings.sort((a, b) => a.name.localeCompare(b.name));
  assert.equal(validatePreservation(before, after, additions), true);
  after.state.bindings = after.state.bindings.filter(binding => binding.name !== 'LIVEKIT_API_SECRET');
  assert.throws(() => validatePreservation(before, after, additions), { code: 'POSTDEPLOY_SETTINGS_DRIFT' });
});

function evidenceFixture() {
  const candidate = '1'.repeat(40), sourceHashes = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`file-${i}`, hash(`source-${i}`)]));
  const migrationHashes = Object.fromEntries(policy.migrations.map(file => [file, hash(file)]));
  return { candidate, changedPaths: ['worker/debate-service.mjs'], migrationHashes, sourceHashes,
    suite: { head: candidate, status: 'PASS_LOCAL_SUITE', gitStatus: '', changedDuringRun: [], sourceHashes: { ...sourceHashes }, groups: Array.from({ length: 8 }, () => ({ status: 'PASS' })) },
    review: { candidateSha: candidate, baseSha: '2'.repeat(40), approvedPaths: ['worker/debate-service.mjs'], studyRoomPreserved: true, recoveryPreserved: true, retiredRuntimeAbsent: true, evidenceReferences: ['reviewed-evidence'], approvalReference: 'Owner staging change reference',
      databaseProof: { projectRef: TARGET.project, applied: true, rollbackProbePassed: true, privilegesPassed: true, evidenceReference: 'reviewed-probe', reviewedBy: 'Release reviewer', verifiedAt: '2026-09-09T00:00:00Z', migrationHashes: { ...migrationHashes } } } };
}
test('release evidence binds complete reviewed scope, unchanged suite, exact migrations and the intended Supabase project', () => {
  validateEvidence(evidenceFixture());
  for (const mutate of [
    input => { input.suite.gitStatus = ' M worker/debate-service.mjs'; },
    input => { input.sourceHashes['file-1'] = hash('later edit'); },
    input => { input.changedPaths.push('assets/unrelated-feature.js'); },
    input => { input.review.databaseProof.projectRef = 'production-project'; },
    input => { input.review.databaseProof.applied = false; },
    input => { input.migrationHashes[policy.migrations[0]] = hash('different SQL'); },
  ]) { const input = evidenceFixture(); mutate(input); assert.throws(() => validateEvidence(input)); }
});

test('actual candidate assets remain byte-identical; sanitized target, dependencies and retired-source boundary are enforced', async () => {
  const parent = path.join(ROOT, 'artifacts/debate-local-rehearsal'); await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'staging-artifact-contract-'));
  const copy = async file => {
    const target = path.join(directory, file); await mkdir(path.dirname(target), { recursive: true });
    if (['assets/vendor/livekit-client.umd.js','assets/vendor/livekit-track-processors.iife.js'].includes(file)) {
      // This focused perimeter test does not rebuild media bundles. The existing
      // sanitized builder and media artifact tests own their pinned byte checks.
      await writeFile(target, '/* INERT DEPENDENCY FIXTURE; not provider/build evidence */');
    } else if (file === 'assets/debate-domain.js') await writeFile(target, (await readFile(path.join(ROOT, 'worker/debate-domain.mjs'), 'utf8')).replace("'./debate-sanctions.mjs'", "'./debate-sanctions.js'"));
    else await copyFile(path.join(ROOT, file === 'assets/debate-sanctions.js' ? 'worker/debate-sanctions.mjs' : file), target);
  };
  for (const file of CRITICAL_ASSETS) await copy(file);
  const page = await readFile(path.join(ROOT, 'debate-room/index.html'), 'utf8');
  for (const match of page.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"?#]+)[^\"]*"/g)) if (match[1].startsWith('../')) await copy(path.posix.normalize('debate-room/' + match[1]));
  await writeFile(path.join(directory, 'assets/phase2-config.js'), `// Test-only staging target\n${TARGET.origin}\n${TARGET.project}\n`);
  const result = await inspectArtifact(directory); assert.equal(Object.keys(result.hashes).length, CRITICAL_ASSETS.length);
  await copy('examination-room/index.html'); assert.equal((await inspectArtifact(directory)).status, 'PASS_ARTIFACT_ONLY', 'Reviewed compatibility surfaces remain permitted');
  await writeFile(path.join(directory, 'assets/examination-room-renovation.js'), 'retired implementation'); await assert.rejects(inspectArtifact(directory), { code: 'ARTIFACT_PRIVATE_FILE' }); await unlink(path.join(directory, 'assets/examination-room-renovation.js'));
  await writeFile(path.join(directory, 'assets/debate-sanctions.js'), 'changed arithmetic'); await assert.rejects(inspectArtifact(directory), { code: 'ARTIFACT_SOURCE_MISMATCH' }); await copy('assets/debate-sanctions.js');
  await writeFile(path.join(directory, 'assets/study-room-live.js'), 'changed repaired media client');
  await assert.rejects(inspectArtifact(directory), { code: 'ARTIFACT_SOURCE_MISMATCH' }); await copy('assets/study-room-live.js');
  await writeFile(path.join(directory, 'CNAME'), 'duediligence.ph'); await assert.rejects(inspectArtifact(directory), { code: 'ARTIFACT_PRIVATE_FILE' }); await unlink(path.join(directory, 'CNAME'));
  await mkdir(path.join(directory, 'worker')); await writeFile(path.join(directory, 'worker/private.sql'), 'private');
  await assert.rejects(inspectArtifact(directory), { code: 'ARTIFACT_PRIVATE_FILE' });
});

test('hosted smoke requires exact assets plus genuine allow/deny-shaped authenticated responses and never claims full acceptance', async () => {
  const manifest = { hashes: { 'debate-room/index.html': hash('exact candidate bytes') } }, calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options }); assert.ok(url.startsWith(TARGET.origin + '/'));
    if (url.endsWith('index.html')) return new Response('exact candidate bytes');
    if (url.endsWith('/access')) return Response.json({ ok: true, enabled: false });
    const token = options.headers.Authorization;
    if (!token) return Response.json({ ok: false }, { status: 401 });
    if (token === 'Bearer excluded') return Response.json({ ok: false, error: { code: 'DEBATE_PREVIEW_RESTRICTED' } }, { status: 403 });
    return Response.json({ ok: true, events: [] });
  };
  const result = await smokeStaging({ allowedToken: 'allowed', deniedToken: 'excluded', manifest, fetcher });
  assert.equal(result.status, 'PASS_STAGING_ASSETS_AND_AUTH_ONLY'); assert.equal(result.fullOrganizerJourney, false); assert.equal(result.physicalMedia, false); assert.equal(result.publicLaunch, false);
  assert.ok(calls.every(call => call.options.method === 'GET'));
  await assert.rejects(smokeStaging({ allowedToken: 'same', deniedToken: 'same', manifest, fetcher }), { code: 'SMOKE_CREDENTIAL_MISSING' });
  await assert.rejects(smokeStaging({ allowedToken: 'allowed', deniedToken: 'excluded', manifest, fetcher: async () => new Response('wrong deployed source') }), { code: 'DEPLOYED_ASSET_MISMATCH' });
});

test('predeploy session verification rejects expired and wrongly scoped real-account responses before mutation', async () => {
  const calls = [], input = { allowedToken: 'private-allowed', deniedToken: 'private-excluded', publishableKey: 'sb_publishable_' + 'a'.repeat(25), allowlist: preview };
  const fetcher = async (url, options) => { calls.push({ url, options }); return Response.json({ id: options.headers.Authorization.endsWith('private-allowed') ? preview : '10000000-0000-4000-8000-000000000002' }); };
  const result = await validateSmokeSessions({ ...input, fetcher });
  assert.equal(result.verifiedAccounts, 2); assert.equal(result.tokensStored, false);
  assert.ok(calls.every(call => call.url === `https://${TARGET.project}.supabase.co/auth/v1/user` && call.options.method === 'GET'));
  await assert.rejects(validateSmokeSessions({ ...input, fetcher: async () => Response.json({ error: 'expired' }, { status: 401 }) }), { code: 'SMOKE_SESSION_INVALID' });
  await assert.rejects(validateSmokeSessions({ ...input, fetcher: async () => Response.json({ id: preview }) }), { code: 'SMOKE_ACCOUNT_SCOPE_WRONG' });
});

test('public-key fallback reads only current staging configuration without creating a secret or executing remote JavaScript', async () => {
  const key = 'sb_publishable_' + 'a'.repeat(25), calls = [];
  const fetcher = async (url, options) => { calls.push({ url, options }); return new Response(`${TARGET.origin}\nhttps://${TARGET.project}.supabase.co\n${key}`); };
  assert.equal((await resolveStagingPublishableKey({ fetcher })).key, key);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, TARGET.origin + '/assets/phase2-config.js'); assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.redirect, 'error');
  assert.equal((await resolveStagingPublishableKey({ configuredKey: key, fetcher })).source, 'existing-ci-configuration'); assert.equal(calls.length, 1);
  await assert.rejects(resolveStagingPublishableKey({ fetcher: async () => new Response(`${key}\nhttps://wrong.supabase.co`) }), { code: 'PUBLIC_CONFIG_UNAVAILABLE' });
  await assert.rejects(resolveStagingPublishableKey({ fetcher: async () => new Response(`${TARGET.origin}\nhttps://${TARGET.project}.supabase.co\n${key}\nsb_publishable_${'b'.repeat(25)}`) }), { code: 'PUBLIC_CONFIG_UNAVAILABLE' });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, copyFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGET, CRITICAL_ASSETS, CRITICAL_SOURCES, REQUIRED_SUITE_GROUPS, hash, parseBase, previewIds, validatePolicy, buildConfig, sanitizeBaseline, validateBaseline, validatePreservation, captureRemote, validateEvidence, inspectArtifact, resolveStagingPublishableKey, validateSmokeSessions, smokeStaging, validateCaptureRequest } from './debate-staging-release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policy = JSON.parse(await readFile(path.join(ROOT, 'worker/debate-staging-policy.json'), 'utf8'));
const base = parseBase(await readFile(path.join(ROOT, policy.baseConfig), 'utf8'));
const versionId = 'b134ccc7-1111-4111-8111-111111111111', preview = '10000000-0000-4000-8000-000000000001';
test('capture refuses forks, another actor, stale labels, a changed branch and a dirty or wrong candidate', () => {
  const repo = 'codingwally/Bar-Exam-simulator', sha = 'a'.repeat(40);
  const input = { event: { action: 'labeled', repository: { full_name: repo }, sender: { login: 'codingwally' }, label: { name: 'dv3-c-' + sha },
    pull_request: { number: 356, state: 'open', head: { repo: { full_name: repo }, ref: 'codex/debate-room-v3-20260909', sha }, base: { repo: { full_name: repo }, ref: 'main' } } },
    env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: repo, GITHUB_ACTOR: 'codingwally', GITHUB_TRIGGERING_ACTOR: 'codingwally', DEBATE_CANDIDATE_SHA: sha, GITHUB_REF: 'refs/pull/356/merge' }, head: sha, gitStatus: '' };
  assert.equal(validateCaptureRequest(input), sha);
  for (const mutate of [
    x => { x.event.pull_request.head.repo.full_name = 'fork/project'; }, x => { x.event.sender.login = 'other'; },
    x => { x.env.GITHUB_ACTOR = 'other'; }, x => { x.env.GITHUB_TRIGGERING_ACTOR = 'other'; },
    x => { x.event.label.name = 'dv3-c-' + 'b'.repeat(40); }, x => { x.event.pull_request.head.ref = 'main'; },
    x => { x.event.pull_request.base.ref = 'other'; }, x => { x.event.pull_request.number = 355; },
    x => { x.event.action = 'synchronize'; }, x => { x.gitStatus = ' M worker/index.mjs'; },
    x => { x.head = 'b'.repeat(40); }, x => { x.env.DEBATE_CANDIDATE_SHA = 'b'.repeat(40); },
    x => { x.env.GITHUB_EVENT_NAME = 'pull_request_target'; }, x => { x.event.pull_request.state = 'closed'; },
  ]) { const changed = structuredClone(input); mutate(changed); assert.throws(() => validateCaptureRequest(changed), { code: 'CAPTURE_AUTHORITY_REQUIRED' }); }
});
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
  const candidate = '1'.repeat(40), sourceHashes = Object.fromEntries(CRITICAL_SOURCES.map(file => [file, hash(`reviewed-source:${file}`)]));
  const migrationHashes = Object.fromEntries(policy.migrations.map(file => [file, hash(file)]));
  return { candidate, changedPaths: ['worker/debate-service.mjs'], migrationHashes, sourceHashes,
    suite: { head: candidate, status: 'PASS_LOCAL_SUITE', gitStatus: '', changedDuringRun: [], sourceHashes: { ...sourceHashes }, groups: REQUIRED_SUITE_GROUPS.map(name => ({ name, status: 'PASS', exitCode: 0 })) },
    review: { candidateSha: candidate, baseSha: '2'.repeat(40), approvedPaths: ['worker/debate-service.mjs'], studyRoomPreserved: true, recoveryPreserved: true, retiredRuntimeAbsent: true, evidenceReferences: ['reviewed-evidence'], approvalReference: 'Owner staging change reference',
      databaseProof: { schemaVersion: 2, projectRef: TARGET.project, evidenceReference: 'reviewed-probe', reviewedBy: 'Release reviewer', verifiedAt: '2026-09-09T00:00:00Z', migrationHashes: { ...migrationHashes },
        localInstallationRollback: { passed: true, evidenceReference: 'local-installation', artifactSha256: hash('local'), engine: 'PGlite PostgreSQL 18.3', adaptations: ['Local PG version and existing admin-helper fingerprint'], migrationHashes: { ...migrationHashes } },
        hostedApplication: { passed: true, evidenceReference: 'actual-application-ledger', artifactSha256: hash('applied'), migrationHashes: { ...migrationHashes } },
        hostedDmlRollback: { passed: true, evidenceReference: 'hosted-DML-transaction', artifactSha256: hash('transaction') },
        hostedPrivilegesAndPreservation: { passed: true, evidenceReference: 'hosted-privileges-and-Study', artifactSha256: hash('privileges') },
        hostedInstallationRollback: { status: 'NOT_RUN', reason: 'Installation rollback verified locally; supported hosted connector applies DDL separately.' }, fullAcceptance: false } } };
}
test('release evidence binds complete reviewed scope, unchanged suite, exact migrations and the intended Supabase project', () => {
  validateEvidence(evidenceFixture());
  for (const mutate of [
    input => { input.suite.gitStatus = ' M worker/debate-service.mjs'; },
    input => { input.sourceHashes['worker/debate-service.mjs'] = hash('later edit'); },
    input => { input.changedPaths.push('assets/unrelated-feature.js'); },
    input => { input.review.databaseProof.projectRef = 'production-project'; },
    input => { input.review.databaseProof.hostedApplication.passed = false; },
    input => { input.migrationHashes[policy.migrations[0]] = hash('different SQL'); },
  ]) { const input = evidenceFixture(); mutate(input); assert.throws(() => validateEvidence(input)); }
});

test('protected preview distinguishes local installation rollback from actual hosted DML rollback without implying full acceptance', () => {
  for (const mutate of [
    input => { input.review.databaseProof.rollbackProbePassed = true; },
    input => { delete input.review.databaseProof.localInstallationRollback; },
    input => { input.review.databaseProof.hostedDmlRollback.passed = false; },
    input => { input.review.databaseProof.hostedDmlRollback.artifactSha256 = ''; },
    input => { input.review.databaseProof.hostedPrivilegesAndPreservation.passed = false; },
    input => { input.review.databaseProof.hostedInstallationRollback.status = 'PASS'; },
    input => { input.review.databaseProof.fullAcceptance = true; },
    input => { input.review.databaseProof.localInstallationRollback.migrationHashes[policy.migrations[0]] = hash('different SQL'); },
    input => { input.review.databaseProof.hostedApplication.migrationHashes[policy.migrations[0]] = hash('different SQL'); },
  ]) { const input = evidenceFixture(); mutate(input); assert.throws(() => validateEvidence(input)); }
});

test('release evidence requires every named runner group exactly once and rejects missing new checks despite a padded PASS count', () => {
  for (const missing of REQUIRED_SUITE_GROUPS) {
    const input = evidenceFixture();
    input.suite.groups = input.suite.groups.filter(group => group.name !== missing);
    input.suite.groups.push({ name: 'unrelated-passing-check', status: 'PASS', exitCode: 0 });
    assert.throws(() => validateEvidence(input), { code: 'LOCAL_SUITE_REQUIRED' }, missing);
  }
  for (const mutate of [
    input => { input.suite.groups.push({ ...input.suite.groups[0] }); },
    input => { input.suite.groups[0].status = 'FAIL'; },
    input => { input.suite.groups[0].exitCode = 1; },
    input => { delete input.suite.groups[0].name; },
    input => { delete input.suite.changedDuringRun; },
    input => { delete input.suite.gitStatus; },
  ]) { const input = evidenceFixture(); mutate(input); assert.throws(() => validateEvidence(input), { code: 'LOCAL_SUITE_REQUIRED' }); }
  const input = evidenceFixture(); input.suite.groups.push({ name: 'additional-independent-check', status: 'PASS', exitCode: 0 });
  validateEvidence(input);
});

test('release evidence requires actual critical source paths and valid hashes, including Study migration and staging configuration', async () => {
  assert.equal(new Set(CRITICAL_SOURCES).size, CRITICAL_SOURCES.length);
  for (const file of CRITICAL_SOURCES) {
    assert.ok((await readFile(path.join(ROOT, file))).byteLength > 0, 'Critical source exists: ' + file);
    const input = evidenceFixture(); delete input.suite.sourceHashes[file];
    input.suite.sourceHashes['arbitrary-padding-file'] = hash('passing-count-is-insufficient');
    input.sourceHashes['arbitrary-padding-file'] = input.suite.sourceHashes['arbitrary-padding-file'];
    assert.throws(() => validateEvidence(input), { code: 'LOCAL_SUITE_REQUIRED' }, file);
  }
  for (const mutate of [
    input => { delete input.sourceHashes['worker/commercial-entry.mjs']; },
    input => { input.suite.sourceHashes['worker/debate-service.mjs'] = input.sourceHashes['worker/debate-service.mjs'] = 'not-a-hash'; },
  ]) { const input = evidenceFixture(); mutate(input); assert.throws(() => validateEvidence(input), { code: 'LOCAL_SUITE_REQUIRED' }); }
  for (const file of ['supabase/migrations/20260909080143_study_room_admission_v3.sql', 'worker/wrangler.staging.toml', 'worker/package-lock.json']) {
    const input = evidenceFixture(); input.sourceHashes[file] = hash('unverified-later-change');
    assert.throws(() => validateEvidence(input), { code: 'SOURCE_DRIFT' }, file);
  }
  for (const file of ['../outside-source', 'worker\\debate-service.mjs']) {
    const input = evidenceFixture(); input.suite.sourceHashes[file] = input.sourceHashes[file] = hash('invalid-path');
    assert.throws(() => validateEvidence(input), { code: 'INVALID_SOURCE_MANIFEST' });
  }
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
    assert.equal(new Headers(options.headers).has('Origin'), false, 'Do not invent a header omitted by same-origin browser GET');
    assert.equal(options.headers['Sec-Fetch-Site'], 'same-origin');
    assert.equal(options.headers['Sec-Fetch-Mode'], 'cors');
    assert.equal(new URL(options.headers.Referer).origin, TARGET.origin);
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

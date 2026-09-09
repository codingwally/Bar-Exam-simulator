import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runHostedDebateRehearsal, MINIMUM_HOSTED_REHEARSAL_MS } from './run-debate-hosted-rehearsal.mjs';
import { TARGET, hash, parseBase, buildConfig, sanitizeBaseline } from './debate-staging-release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceSha = 'a'.repeat(40), beforeVersion = '10000000-0000-4000-8000-000000000001';
const afterVersion = '10000000-0000-4000-8000-000000000002';
const actorNames = ['host','A1','A2','A3','N1','N2','N3','judge2','judge3','observer','excluded'];
const accounts = Object.fromEntries(actorNames.map((name, index) => [name, { id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` }]));
const allowedIds = actorNames.filter(name => name !== 'excluded').map(name => accounts[name].id).sort();
const tokens = Object.fromEntries(actorNames.map(name => [name, `inert-${name}-session-sensitive-`.repeat(8)]));
const refresh = Object.fromEntries(actorNames.map(name => [name, `inert-${name}-refresh-sensitive-`.repeat(8)]));
const base = parseBase(await readFile(path.join(ROOT, 'worker/wrangler.staging.toml'), 'utf8'));
const policy = JSON.parse(await readFile(path.join(ROOT, 'worker/debate-staging-policy.json'), 'utf8'));
const freshBaseline = () => sanitizeBaseline({
  deployments: { deployments: [{ id: 'before-deployment', versions: [{ version_id: beforeVersion, percentage: 100 }] }] },
  settings: { compatibility_date: base.compatibilityDate, compatibility_flags: base.compatibilityFlags,
    placement: { mode: 'targeted', target: [10] }, bindings: [
      ...Object.entries(base.vars).map(([name, text]) => ({ name, type: 'plain_text', text })),
      ...policy.requiredSecretNames.map(name => ({ name, type: 'secret_text' })),
    ] },
  scriptSettings: { observability: { enabled: true, head_sampling_rate: 1, redact_query_string: false,
    logs: { enabled: true, head_sampling_rate: 1, persist: true, invocation_logs: true },
    traces: { enabled: false, head_sampling_rate: 1, persist: true } }, logpush: false, tail_consumers: [] },
  version: { id: beforeVersion, resources: { script_runtime: {} } },
  service: { default_environment: { environment: 'production', script: { placement_mode: 'targeted',
    placement: { mode: 'targeted', target: [{ region: policy.placementRegion }] } } } },
  schedules: { schedules: base.crons.map(cron => ({ cron })) }, subdomain: { enabled: true, previews_enabled: true },
}, base);

async function fixture(options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'dv3-host-driver-'));
  const events = [], baseline = freshBaseline();
  const tooling = path.join(root, 'artifacts/debate-local-rehearsal/staging-tooling/node_modules/wrangler/bin/wrangler.js');
  await mkdir(path.dirname(tooling), { recursive: true }); await mkdir(path.join(root, 'worker'));
  await writeFile(tooling, '/* inert test entry: never executed */');
  let wall = 1800000000000, elapsed = 1000, preflights = 0, factoryCalls = 0, cleanupCalls = 0, browserCalls = 0;
  let lifecycle, lifecycleOptions, remote = baseline;
  const env = { DEBATE_CANDIDATE_SHA: sourceSha, DEBATE_EXPECTED_BASELINE_SHA256: baseline.fingerprint,
    DEBATE_EXPECTED_VERSION_ID: beforeVersion, DEBATE_RELEASE_REVIEW: '{}', DEBATE_LOCAL_SUITE_REPORT: 'artifacts/test-suite.json',
    STAGING_SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_inert_driver_sensitive_key_1234567890',
    CLOUDFLARE_API_TOKEN: 'inert-cloudflare-sensitive-key', CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32),
    NODE_OPTIONS: '--must-not-inherit', UNRELATED_SECRET: 'must-not-inherit-either', PATH: process.env.PATH || '' };
  const checked = { candidate: sourceSha, base, policy, review: {}, baseline,
    publicKey: { key: 'sb_publishable_inert_driver_public_key_1234567890' }, artifact: { hashes: { 'index.html': hash('exact-test-artifact') } },
    wrangler: { file: tooling, version: '4.114.0', entrySha256: hash(await readFile(tooling)) } };
  if (options.mode !== 'prepare' && options.preparation !== 'missing') {
    // Inert receipt within this disposable test root only; never a hosted proof.
    const prior = { schemaVersion: 1, kind: 'HOSTED_DEBATE_ORGANIZER_REHEARSAL_DRIVER', mode: 'prepare',
      status: 'PASS_HOSTED_FIXTURE_PREPARATION_ONLY', sourceSha, target: TARGET,
      baselineFingerprint: baseline.fingerprint, previousVersionId: beforeVersion,
      startedAt: new Date(wall - 120000).toISOString(), completedAt: new Date(wall - 1000).toISOString(),
      deploymentState: 'NOT_REQUESTED', steps: [], authenticatedAccounts: 11, allowedAccounts: 10,
      cleanup: 'EXACT_FIXTURES_DELETED_AND_KNOWN_SESSIONS_DENIED', immediateLogoutFencingVerified: true,
      atomicCleanupHelperVerified: true,
      publicLaunch: false, physicalMedia: false, providerMedia: false, realMail: false, fullAcceptance: false,
      credentialsStored: false, rawOutputStored: false, tracesStored: false };
    if (options.preparation === 'fence') prior.immediateLogoutFencingVerified = false;
    if (options.preparation === 'atomic-helper') prior.atomicCleanupHelperVerified = false;
    if (options.preparation === 'atomic-helper-missing') delete prior.atomicCleanupHelperVerified;
    if (options.preparation === 'atomic-helper-string') prior.atomicCleanupHelperVerified = 'true';
    if (options.preparation === 'source') prior.sourceSha = 'c'.repeat(40);
    if (options.preparation === 'baseline') prior.baselineFingerprint = 'c'.repeat(64);
    if (options.preparation === 'cleanup') prior.cleanup = 'EXACT_ID_RECONCILIATION_REQUIRED';
    if (options.preparation === 'mode') prior.mode = 'run';
    if (options.preparation === 'deployment') prior.deployedVersionId = afterVersion;
    if (options.preparation === 'provider') prior.providerMedia = true;
    if (options.preparation === 'future') prior.completedAt = new Date(wall + 1000).toISOString();
    const priorPath = path.join(root, options.preparation === 'path' ? 'worker' : 'artifacts', 'prior-hosted-preparation.json');
    const bytes = JSON.stringify(prior); await writeFile(priorPath, bytes);
    env.DEBATE_HOSTED_PREPARATION_REPORT = priorPath;
    env.DEBATE_HOSTED_PREPARATION_SHA256 = options.preparation === 'hash' ? '0'.repeat(64) : hash(bytes);
  }
  const fail = stage => { if (options.failAt === stage) throw Object.assign(new Error('inert-private-error-' + env.CLOUDFLARE_API_TOKEN), { code: `TEST_${stage.toUpperCase().replaceAll('-', '_')}_FAILED` }); };
  const stage = value => { events.push(value); fail(value); };
  const makeAfter = () => {
    const saved = structuredClone(baseline); saved.state.versionId = afterVersion; saved.state.deploymentId = 'after-deployment';
    Object.assign(saved.state.vars, policy.debateVars, { DEBATE_PREVIEW_ACTOR_IDS: allowedIds.join(',') });
    saved.state.bindings.push(...[...Object.keys(policy.debateVars), 'DEBATE_PREVIEW_ACTOR_IDS'].map(name => ({ name, type: 'plain_text' })));
    saved.state.bindings.sort((a, b) => a.name.localeCompare(b.name)); saved.fingerprint = hash(saved.state); return saved;
  };
  const input = { mode: options.mode, env, root, clock: () => wall, monotonic: () => elapsed,
    fetcher: async () => { assert.fail('Injected driver tests must never contact a provider'); },
    preflight: async request => {
      preflights++; assert.equal(request.mode, 'deploy'); assert.equal(request.env, env);
      stage(preflights === 1 ? 'preflight' : 'recheck');
      if (preflights === 2 && options.drift === 'fresh-candidate') return { ...checked, candidate: 'c'.repeat(40) };
      if (preflights === 2 && options.drift === 'fresh-baseline') return { ...checked, baseline: { ...baseline, fingerprint: 'd'.repeat(64) } };
      if (preflights === 2 && options.drift === 'second-config') await writeFile(path.join(root, 'artifacts/debate-local-rehearsal/staging-release/wrangler.debate-staging.toml'), 'changed between gates');
      return checked;
    },
    capture: async request => {
      assert.equal(request.token, env.CLOUDFLARE_API_TOKEN); events.push('capture');
      if (options.readbackFails && events.includes('deploy')) throw new Error('inert-sensitive-readback-failure');
      return remote;
    },
    verifySessions: async request => {
      stage('sessions'); assert.equal(request.allowedToken, tokens.host); assert.equal(request.deniedToken, tokens.excluded);
      assert.equal(request.allowlist, allowedIds.join(',')); assert.equal(request.publishableKey, checked.publicKey.key);
    },
    lifecycleFactory: parameters => {
      factoryCalls++; stage('factory'); lifecycleOptions = parameters;
      assert.equal(parameters.serviceRoleKey, env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
      assert.equal(parameters.sourceSha, sourceSha); assert.equal(parameters.workerUrl, TARGET.origin);
      assert.equal(parameters.supabaseUrl, `https://${TARGET.project}.supabase.co`);
      lifecycle = {
        snapshot: () => {
          stage('snapshot');
          const fence = cleanupCalls ? Object.hasOwn(options, 'immediateFence') ? options.immediateFence : true : null;
          return {
            immediateLogoutFencingVerified: fence,
            atomicCleanupHelperVerified: cleanupCalls
              ? Object.hasOwn(options, 'atomicHelper') ? options.atomicHelper : fence === true
              : false,
          };
        },
        preflightStorage: async () => { stage('storage-preflight'); await parameters.persist({ runTag: 'inert-owned-run', cleanupComplete: false, credentialsStored: false });
          return { status: options.storageState || 'ABSENT', rawIgnored: 'never-save-this-field' }; },
        ensureStorage: async () => { stage('storage-ensure'); return { status: 'MATCHING_PRIVATE_BUCKET' }; },
        provision: async () => {
          stage('provision'); const suppressed = await parameters.verifySuppression();
          assert.equal(suppressed.outboundEmailMode, 'suppressed'); assert.equal(suppressed.projectRef, TARGET.project);
          const out = { accounts: structuredClone(accounts), previewIds: [...allowedIds], excludedId: accounts.excluded.id, runTag: 'inert-owned-run' };
          if (options.badAccounts) out.previewIds.push(accounts.excluded.id);
          return out;
        },
        sessionFor: async purpose => {
          events.push('session-' + purpose); fail('session');
          return { user: { id: options.badSession && purpose === 'host' ? accounts.excluded.id : accounts[purpose].id },
            access_token: tokens[purpose], refresh_token: refresh[purpose], expires_at: Math.floor(wall / 1000) + 3600 };
        },
        cleanup: async () => {
          cleanupCalls++; stage('cleanup'); await parameters.persist({ runTag: 'inert-owned-run', cleanupComplete: !options.cleanupIncomplete, credentialsStored: false });
          return { complete: !options.cleanupIncomplete, ignoredRawOutput: 'never-save-this-field' };
        },
      };
      return lifecycle;
    },
    child: async call => {
      events.push(call.label);
      assert.equal(call.cwd, path.join(root, 'worker'));
      for (const key of ['STAGING_SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SERVICE_ROLE_KEY','NODE_OPTIONS','UNRELATED_SECRET']) assert.equal(call.env[key], undefined, key);
      if (call.label === 'prepare') {
        assert.equal(call.env.DEBATE_PREVIEW_ACTOR_IDS, allowedIds.join(','));
        assert.equal(call.env.DEBATE_STAGING_ALLOWED_BEARER, tokens.host); assert.equal(call.env.DEBATE_STAGING_DENIED_BEARER, tokens.excluded);
        assert.equal(call.env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_API_TOKEN);
        const output = path.join(root, 'artifacts/debate-local-rehearsal/staging-release');
        const config = buildConfig(base, policy, allowedIds.join(','), output, root);
        await writeFile(config.filename, options.drift === 'config' ? config.text + '\n# changed' : config.text);
        const receipt = { candidateSha: sourceSha, configHash: config.hash, baselineFingerprint: baseline.fingerprint,
          previousVersionId: beforeVersion, publicLaunch: false };
        if (options.drift === 'receipt') receipt.candidateSha = 'c'.repeat(40);
        await writeFile(path.join(output, 'preflight.json'), JSON.stringify(receipt));
        if (options.drift === 'tool') await writeFile(tooling, 'changed tool');
      } else if (call.label === 'deploy') {
        assert.deepEqual(Object.keys(call.env).sort(), ['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN','PATH','WRANGLER_SEND_METRICS'].sort());
        assert.deepEqual(call.args.slice(0, 4), [tooling, 'deploy', '--keep-vars', '--config']);
        remote = makeAfter(); // A CLI failure can still leave the new version live.
      } else if (call.label === 'postflight') {
        assert.equal(call.env.DEBATE_PREVIEW_ACTOR_IDS, allowedIds.join(','));
        assert.equal(call.env.DEBATE_STAGING_ALLOWED_BEARER, undefined);
        const after = makeAfter();
        if (options.drift === 'postflight') { after.state.vars.DEBATE_ROOM_ENABLED = 'true'; after.fingerprint = hash(after.state); }
        await writeFile(path.join(root, 'artifacts/debate-local-rehearsal/staging-release/deployed-baseline.json'), JSON.stringify(after));
      } else if (call.label === 'smoke') {
        assert.equal(call.env.CLOUDFLARE_API_TOKEN, undefined); assert.equal(call.env.STAGING_SUPABASE_PUBLISHABLE_KEY, undefined);
        assert.equal(call.env.DEBATE_STAGING_ALLOWED_BEARER, tokens.host); assert.equal(call.env.DEBATE_STAGING_DENIED_BEARER, tokens.excluded);
      }
      if (options.throwChild === call.label) throw new Error('inert-private-child-' + tokens.host);
      return { label: call.label, status: options.failAt === call.label ? 'FAIL' : 'PASS',
        exitCode: options.failAt === call.label ? 7 : 0, stdoutSha256: hash('inert'), stderrSha256: hash('inert'),
        rawOutputStored: false, rawIgnored: tokens.host };
    },
    browser: async request => {
      browserCalls++; stage('browser'); assert.equal(request.lifecycle, lifecycle);
      assert.equal(request.workerUrl, TARGET.origin); assert.equal(request.sourceSha, sourceSha); assert.equal(request.workerVersion, afterVersion);
      assert.ok(request.outputDir.startsWith(path.join(root, 'artifacts') + path.sep));
      const startedAt = new Date(wall).toISOString();
      const duration = options.completedBrowserFailure ? 27747 : options.shortRun ? MINIMUM_HOSTED_REHEARSAL_MS - 1
        : options.browserTiming === 'bounded-overhead' ? MINIMUM_HOSTED_REHEARSAL_MS + 15000 : MINIMUM_HOSTED_REHEARSAL_MS + 1500;
      elapsed += duration; wall += options.clockJump ? duration + 10000 : duration;
      const result = { kind: 'ISOLATED_CI_HOSTED_BROWSER_ORGANIZER',
        status: options.completedBrowserFailure ? 'FAIL' : options.badBrowserStatus ? 'PARTIAL' : 'PASS_HOSTED_BROWSER_ORGANIZER_CONTROL_ONLY',
        sourceSha: options.badBrowserSource ? 'f'.repeat(40) : sourceSha, workerVersion: afterVersion,
        actualHostedAuth: true, mainWorkerBootstrap: true, physicalMediaVerified: false,
        defaultFlowDurationMs: 78 * 60000, correctionWindowMs: 15 * 60000, elapsedMs: duration,
        startedAt, finishedAt: new Date(wall).toISOString(), credentialsStored: false, rawDomStored: false, tracesStored: false,
        claims: { physicalMedia: false, providerMedia: false, realEmail: false },
        rawIgnored: tokens.host };
      if (options.completedBrowserFailure) result.failure = { code: 'TEST_BROWSER_ACTION_REJECTED', messageSha256: hash('inert action failure') };
      await mkdir(request.outputDir, { recursive: true });
      const stored = { ...result }; delete stored.rawIgnored;
      if (options.badBrowserArtifact) stored.sourceSha = 'e'.repeat(40);
      if (options.browserArtifact === 'source') stored.sourceSha = 'e'.repeat(40);
      if (options.browserArtifact === 'version') stored.workerVersion = beforeVersion;
      if (options.browserArtifact === 'kind') stored.kind = 'UNRELATED_REPORT';
      if (options.browserArtifact === 'privacy') stored.rawDomStored = true;
      if (options.browserArtifact === 'nested-provider') stored.claims = { providerMedia: true };
      if (options.browserArtifact === 'credential') stored.access_token = tokens.host;
      if (options.browserArtifact === 'secret-value') stored.untrustedNote = env.CLOUDFLARE_API_TOKEN;
      if (options.browserArtifact === 'unfinished') delete stored.finishedAt;
      if (options.browserArtifact === 'running') stored.status = 'RUNNING';
      if (options.browserArtifact === 'negative-timing') stored.elapsedMs = -1;
      if (options.browserClaim) {
        const target = options.claimOn === 'result' ? result : stored, value = options.claimValue ?? true;
        if (options.claimLocation === 'top') target[options.browserClaim] = value;
        else target.claims = { ...target.claims, [options.browserClaim]: value };
      }
      for (const target of [result, stored]) {
        if (options.browserTiming === 'zero') { target.elapsedMs = 0; target.finishedAt = target.startedAt; }
        if (options.browserTiming === 'just-short') {
          target.elapsedMs = MINIMUM_HOSTED_REHEARSAL_MS - 1;
          target.startedAt = new Date(Date.parse(target.finishedAt) - target.elapsedMs).toISOString();
        }
        if (['stale','future'].includes(options.browserTiming)) {
          const offset = options.browserTiming === 'stale' ? -3600000 : 3600000;
          target.startedAt = new Date(Date.parse(target.startedAt) + offset).toISOString();
          target.finishedAt = new Date(Date.parse(target.finishedAt) + offset).toISOString();
        }
        if (options.browserTiming === 'bounded-overhead') {
          target.startedAt = new Date(Date.parse(target.startedAt) + 2000).toISOString();
          target.finishedAt = new Date(Date.parse(target.finishedAt) - 500).toISOString(); target.elapsedMs -= 2500;
        }
      }
      if (options.browserTiming === 'returned-elapsed-mismatch') result.elapsedMs++;
      if (options.browserTiming === 'returned-date-mismatch') result.finishedAt = new Date(Date.parse(result.finishedAt) + 1).toISOString();
      if (!options.missingBrowserArtifact) await writeFile(path.join(request.outputDir, 'report.json'), options.browserArtifact === 'malformed' ? '{unfinished' : JSON.stringify(stored));
      if (options.completedBrowserFailure || options.throwAfterBrowserReport)
        throw Object.assign(new Error('inert-secret-browser-failure-' + tokens.host), { code: 'TEST_BROWSER_EXECUTION_FAILED' });
      return result;
    },
  };
  return { input, events, env, root, baseline, checked, get cleanupCalls() { return cleanupCalls; },
    get preflights() { return preflights; }, get factoryCalls() { return factoryCalls; }, get browserCalls() { return browserCalls; },
    get lifecycleOptions() { return lifecycleOptions; },
    async dispose() {
      const absolute = path.resolve(root);
      assert.ok(absolute.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(absolute).startsWith('dv3-host-driver-'));
      await rm(absolute, { recursive: true, force: true });
    } };
}

async function exercise(options = {}) {
  const f = await fixture(options); let result, error;
  try { result = await runHostedDebateRehearsal(f.input); } catch (caught) { error = caught; }
  const directory = path.join(f.root, 'artifacts/debate-local-rehearsal/staging-release');
  const runs = await readdir(directory).catch(() => []), run = runs.find(name => name.startsWith('hosted-'));
  const report = run ? JSON.parse(await readFile(path.join(directory, run, 'driver.json'), 'utf8')) : null;
  if (report) {
    for (const file of (await readdir(path.join(directory, run), { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name)) {
      const text = await readFile(path.join(directory, run, file), 'utf8');
      for (const secret of [...Object.values(tokens), ...Object.values(refresh), f.env.CLOUDFLARE_API_TOKEN, f.env.STAGING_SUPABASE_SERVICE_ROLE_KEY, 'never-save-this-field']) assert.ok(!text.includes(secret));
    }
    for (const flag of ['publicLaunch','physicalMedia','providerMedia','realMail','fullAcceptance','credentialsStored','rawOutputStored','tracesStored']) assert.equal(report[flag], false, flag);
  }
  return { f, result, error, report };
}

test('hosted driver orders exact gates, private storage, eleven fresh accounts, deploy proof, full timed browser and final cleanup', async () => {
  const run = await exercise();
  try {
    assert.equal(run.error, undefined); assert.equal(run.result.status, 'PASS_HOSTED_ORGANIZER_CONTROL_ONLY');
    assert.equal(run.result.deployedVersionId, afterVersion); assert.equal(run.result.cleanupComplete, true);
    assert.equal(run.f.preflights, 2); assert.equal(run.f.cleanupCalls, 1); assert.equal(run.f.browserCalls, 1);
    const order = ['preflight','factory','storage-preflight','storage-ensure','provision','sessions','prepare','recheck','deploy','postflight','smoke','browser','cleanup'];
    for (let i = 1; i < order.length; i++) assert.ok(run.f.events.indexOf(order[i - 1]) < run.f.events.indexOf(order[i]), order.join(' → '));
    assert.equal(run.report.allowedAccounts, 10); assert.equal(run.report.authenticatedAccounts, 11);
    assert.ok(run.report.browser.measuredDurationMs >= 93 * 60000); assert.equal(run.report.browser.minimumDurationMet, true);
    assert.equal(run.report.browser.status, 'PASS_HOSTED_BROWSER_ORGANIZER_CONTROL_ONLY');
    assert.match(run.report.browser.reportSha256, /^[a-f0-9]{64}$/); assert.equal(run.report.browser.reportPath, 'browser/report.json');
    assert.equal(run.report.deploymentState, 'VERSION_AND_PRESERVATION_VERIFIED');
    assert.equal(run.report.preparationEvidence.immediateLogoutFencingVerified, true);
    assert.equal(run.report.preparationEvidence.atomicCleanupHelperVerified, true);
    assert.equal(run.report.atomicCleanupHelperVerified, true);
    assert.equal(run.report.preparationEvidence.sha256, run.f.env.DEBATE_HOSTED_PREPARATION_SHA256);
  } finally { await run.f.dispose(); }
});

test('failed static preflight creates no lifecycle, storage, account or deployment', async () => {
  const run = await exercise({ failAt: 'preflight' });
  try { assert.equal(run.error.code, 'TEST_PREFLIGHT_FAILED'); assert.equal(run.f.factoryCalls, 0); assert.equal(run.f.cleanupCalls, 0); assert.equal(run.report, null); }
  finally { await run.f.dispose(); }
});

test('prepare mode verifies all fixture prerequisites then cleans up without generating config, deployment, smoke or browser jobs', async () => {
  const run = await exercise({ mode: 'prepare' });
  try {
    assert.equal(run.error, undefined); assert.equal(run.result.status, 'PASS_HOSTED_FIXTURE_PREPARATION_ONLY');
    assert.equal(run.result.mode, 'prepare'); assert.equal(run.result.deployedVersionId, null);
    assert.equal(run.result.cleanupComplete, true); assert.equal(run.result.immediateLogoutFencingVerified, true);
    assert.equal(run.result.atomicCleanupHelperVerified, true); assert.equal(run.report.atomicCleanupHelperVerified, true);
    assert.equal(run.f.preflights, 1); assert.equal(run.f.cleanupCalls, 1); assert.equal(run.f.browserCalls, 0);
    const order = ['preflight','factory','storage-preflight','storage-ensure','provision','sessions','cleanup'];
    for (let i = 1; i < order.length; i++) assert.ok(run.f.events.indexOf(order[i - 1]) < run.f.events.indexOf(order[i]));
    for (const stage of ['prepare','recheck','deploy','postflight','smoke','browser']) assert.equal(run.f.events.includes(stage), false, stage);
    assert.deepEqual(run.report.steps, []); assert.equal(run.report.deploymentState, 'NOT_REQUESTED');
    assert.equal(run.report.authenticatedAccounts, 11); assert.equal(run.report.allowedAccounts, 10);
    assert.equal(run.report.browser, undefined); assert.equal(run.report.verificationGap, undefined);
    const output = path.dirname(run.result.outputDir);
    assert.deepEqual(await readdir(output), [path.basename(run.result.outputDir)]);
    assert.deepEqual((await readdir(run.result.outputDir)).sort(), ['driver.json','fixtures.json']);
    assert.ok(run.f.events.indexOf('cleanup') < run.f.events.indexOf('snapshot'));
  } finally { await run.f.dispose(); }
});

for (const immediateFence of [false, null]) test(`prepare completion reports ${immediateFence} immediate logout denial separately from successful final cleanup`, async () => {
  const run = await exercise({ mode: 'prepare', immediateFence });
  try {
    assert.equal(run.error, undefined); assert.equal(run.result.status, 'PASS_HOSTED_FIXTURE_PREPARATION_ONLY');
    assert.equal(run.result.cleanupComplete, true); assert.equal(run.result.immediateLogoutFencingVerified, immediateFence);
    assert.equal(run.result.atomicCleanupHelperVerified, false); assert.equal(run.report.atomicCleanupHelperVerified, false);
    assert.equal(run.report.verificationGap, 'IMMEDIATE_LOGOUT_FENCING_NOT_VERIFIED_BEFORE_AUTH_DELETION');
    assert.equal(run.report.cleanup, 'EXACT_FIXTURES_DELETED_AND_KNOWN_SESSIONS_DENIED');
    assert.equal(run.report.deploymentState, 'NOT_REQUESTED'); assert.equal(run.f.browserCalls, 0);
  } finally { await run.f.dispose(); }
});

for (const atomicHelper of [false, null, undefined, 'true']) test(`prepare refuses unverified atomic helper ${String(atomicHelper)} even after complete Auth cleanup`, async () => {
  const run = await exercise({ mode: 'prepare', atomicHelper });
  try {
    assert.equal(run.error.code, 'HOSTED_ATOMIC_CLEANUP_HELPER_UNVERIFIED'); assert.equal(run.result, undefined);
    assert.equal(run.report.status, 'FAIL_HOSTED_REHEARSAL'); assert.equal(run.report.atomicCleanupHelperVerified, false);
    assert.equal(run.report.immediateLogoutFencingVerified, true);
    assert.equal(run.report.cleanup, 'EXACT_FIXTURES_DELETED_AND_KNOWN_SESSIONS_DENIED');
    assert.equal(run.report.deploymentState, 'NOT_REQUESTED'); assert.deepEqual(run.report.steps, []);
    assert.equal(run.f.cleanupCalls, 1); assert.equal(run.f.browserCalls, 0);
  } finally { await run.f.dispose(); }
});

test('run cannot report success when its own atomic cleanup observation is missing despite a valid prior preparation', async () => {
  const run = await exercise({ atomicHelper: false });
  try {
    assert.equal(run.error.code, 'HOSTED_ATOMIC_CLEANUP_HELPER_UNVERIFIED'); assert.equal(run.result, undefined);
    assert.equal(run.report.preparationEvidence.atomicCleanupHelperVerified, true);
    assert.equal(run.report.atomicCleanupHelperVerified, false); assert.equal(run.report.status, 'FAIL_HOSTED_REHEARSAL');
    assert.equal(run.report.cleanup, 'EXACT_FIXTURES_DELETED_AND_KNOWN_SESSIONS_DENIED');
    assert.equal(run.report.observedAfterFailure.versionId, afterVersion);
  } finally { await run.f.dispose(); }
});

for (const preparation of ['missing','hash','path','fence','atomic-helper','atomic-helper-missing','atomic-helper-string','source','baseline','cleanup','mode','deployment','provider','future']) {
  test(`run rejects ${preparation} preparation evidence before storage or accounts`, async () => {
    const run = await exercise({ preparation });
    try {
      assert.ok(run.error); assert.equal(run.result, undefined); assert.equal(run.f.preflights, 1);
      assert.equal(run.f.factoryCalls, 0); assert.equal(run.f.cleanupCalls, 0); assert.equal(run.f.browserCalls, 0);
      assert.equal(run.report, null); assert.equal(run.f.events.includes('deploy'), false);
    } finally { await run.f.dispose(); }
  });
}

for (const failAt of ['storage-preflight','storage-ensure','provision','session','sessions','cleanup']) {
  test(`prepare ${failAt} failure cleans up and never reports fixture preparation passed`, async () => {
    const run = await exercise({ mode: 'prepare', failAt });
    try {
      assert.ok(run.error); assert.equal(run.result, undefined); assert.equal(run.f.cleanupCalls, 1);
      assert.equal(run.report.status, 'FAIL_HOSTED_REHEARSAL'); assert.equal(run.report.mode, 'prepare');
      assert.equal(run.report.deploymentState, 'NOT_REQUESTED'); assert.deepEqual(run.report.steps, []);
      assert.equal(run.f.browserCalls, 0); assert.equal(run.f.preflights, 1);
    } finally { await run.f.dispose(); }
  });
}

test('prepare incomplete cleanup cannot produce a passing preparation receipt', async () => {
  const run = await exercise({ mode: 'prepare', cleanupIncomplete: true });
  try {
    assert.equal(run.error.code, 'HOSTED_FIXTURE_CLEANUP_UNCONFIRMED'); assert.equal(run.result, undefined);
    assert.equal(run.report.cleanup, 'EXACT_ID_RECONCILIATION_REQUIRED'); assert.equal(run.f.browserCalls, 0);
  } finally { await run.f.dispose(); }
});

test('invalid hosted modes are rejected before static gates or fixture construction', async () => {
  const run = await exercise({ mode: 'deploy' });
  try {
    assert.equal(run.error.code, 'HOSTED_REHEARSAL_MODE'); assert.equal(run.f.preflights, 0);
    assert.equal(run.f.factoryCalls, 0); assert.equal(run.report, null);
  } finally { await run.f.dispose(); }
});

for (const failAt of ['storage-preflight','storage-ensure','provision','session','sessions','prepare','recheck','deploy','postflight','smoke','browser']) {
  test(`hosted ${failAt} failure always cleans owned fixtures and cannot report completion`, async () => {
    const run = await exercise({ failAt });
    try {
      assert.ok(run.error); assert.equal(run.f.cleanupCalls, 1); assert.equal(run.result, undefined);
      assert.equal(run.report.status, 'FAIL_HOSTED_REHEARSAL');
      assert.equal(run.report.cleanup, 'EXACT_FIXTURES_DELETED_AND_KNOWN_SESSIONS_DENIED');
      assert.ok(!run.error.message.includes('sensitive'));
      const requested = run.f.events.includes('deploy');
      assert.equal(Boolean(run.report.observedAfterFailure), requested);
      if (requested) assert.equal(run.report.observedAfterFailure.versionId, afterVersion);
      if (['deploy','postflight'].includes(failAt)) assert.equal(run.report.deployedVersionId, undefined, 'An unconfirmed or failed postflight cannot establish a deployed version.');
      if (failAt === 'deploy') assert.equal(run.report.deploymentState, 'REQUESTED_OUTCOME_UNCONFIRMED');
      assert.ok(!run.f.events.some(name => /rollback|delete-worker|restore-version/.test(name)));
    } finally { await run.f.dispose(); }
  });
}

for (const drift of ['config','second-config','receipt','tool','fresh-candidate','fresh-baseline']) {
  test(`hosted driver refuses ${drift} drift before deployment and still performs cleanup`, async () => {
    const run = await exercise({ drift });
    try { assert.ok(run.error); assert.equal(run.f.cleanupCalls, 1); assert.equal(run.f.events.includes('deploy'), false); assert.equal(run.report.deployedVersionId, undefined); }
    finally { await run.f.dispose(); }
  });
}

for (const parameters of [{ shortRun: true }, { clockJump: true }, { badBrowserStatus: true }, { badBrowserSource: true }, { badBrowserArtifact: true }, { missingBrowserArtifact: true }]) {
  test(`hosted browser evidence fails closed for ${Object.keys(parameters)[0]}`, async () => {
    const run = await exercise(parameters);
    try { assert.ok(run.error); assert.equal(run.f.cleanupCalls, 1); assert.equal(run.report.status, 'FAIL_HOSTED_REHEARSAL'); assert.equal(run.report.browser.minimumDurationMet, undefined); }
    finally { await run.f.dispose(); }
  });
}

test('postflight flag drift prevents browser launch and does not expose an asserted deployed version', async () => {
  const run = await exercise({ drift: 'postflight' });
  try { assert.equal(run.error.code, 'POSTDEPLOY_SETTINGS_DRIFT'); assert.equal(run.f.browserCalls, 0); assert.equal(run.report.deployedVersionId, undefined); assert.equal(run.report.observedAfterFailure.versionId, afterVersion); }
  finally { await run.f.dispose(); }
});

test('cleanup failure supersedes apparent browser success and preserves a reconciliation requirement', async () => {
  for (const options of [{ cleanupIncomplete: true }, { failAt: 'cleanup' }, { failAt: 'browser', cleanupIncomplete: true }]) {
    const run = await exercise(options);
    try { assert.equal(run.error.code, 'HOSTED_FIXTURE_CLEANUP_UNCONFIRMED'); assert.equal(run.result, undefined); assert.equal(run.report.cleanup, 'EXACT_ID_RECONCILIATION_REQUIRED'); assert.equal(run.report.status, 'FAIL_HOSTED_REHEARSAL'); }
    finally { await run.f.dispose(); }
  }
});

test('bad account/session scope cannot reach prepare or Wrangler', async () => {
  for (const options of [{ badAccounts: true }, { badSession: true }, { storageState: 'PUBLIC_BUCKET' }]) {
    const run = await exercise(options);
    try { assert.ok(run.error); assert.equal(run.f.cleanupCalls, 1); assert.equal(run.f.events.includes('prepare'), false); assert.equal(run.f.events.includes('deploy'), false); }
    finally { await run.f.dispose(); }
  }
});

test('raw child exception and failed readback remain sanitized while uncertainty is retained', async () => {
  const run = await exercise({ throwChild: 'deploy', readbackFails: true });
  try { assert.equal(run.error.code, 'HOSTED_REHEARSAL_STEP_FAILED'); assert.equal(run.report.postFailureReadback, 'UNAVAILABLE'); assert.equal(run.report.deploymentState, 'REQUESTED_OUTCOME_UNCONFIRMED'); assert.equal(run.f.cleanupCalls, 1); }
  finally { await run.f.dispose(); }
});

test('completed failing browser report replaces RUNNING without replacing the original execution error', async () => {
  const run = await exercise({ completedBrowserFailure: true });
  try {
    assert.equal(run.error.code, 'TEST_BROWSER_EXECUTION_FAILED'); assert.equal(run.report.failureCode, run.error.code);
    assert.equal(run.report.status, 'FAIL_HOSTED_REHEARSAL'); assert.equal(run.report.browser.status, 'FAIL');
    assert.equal(run.report.browser.artifactStatus, 'VALIDATED'); assert.equal(run.report.browser.reportedStatus, 'FAIL');
    assert.equal(run.report.browser.failureCode, 'TEST_BROWSER_EXECUTION_FAILED');
    assert.equal(run.report.browser.reportedFailureCode, 'TEST_BROWSER_ACTION_REJECTED');
    assert.equal(run.report.browser.measuredDurationMs, 27747); assert.equal(run.report.browser.reportedElapsedMs, 27747);
    assert.equal(run.report.browser.clockConsistent, true); assert.equal(run.report.browser.accepted, false);
    assert.equal(run.report.browser.minimumDurationMet, undefined); assert.match(run.report.browser.reportSha256, /^[a-f0-9]{64}$/);
    assert.equal(run.f.cleanupCalls, 1); assert.equal(run.report.cleanup, 'EXACT_FIXTURES_DELETED_AND_KNOWN_SESSIONS_DENIED');
  } finally { await run.f.dispose(); }
});

test('missing browser failure artifact is explicit and preserves the original error and cleanup', async () => {
  const run = await exercise({ completedBrowserFailure: true, missingBrowserArtifact: true });
  try {
    assert.equal(run.error.code, 'TEST_BROWSER_EXECUTION_FAILED'); assert.equal(run.report.browser.status, 'FAIL');
    assert.equal(run.report.browser.artifactStatus, 'ABSENT'); assert.equal(run.report.browser.artifactFailureCode, 'HOSTED_BROWSER_ARTIFACT_ABSENT');
    assert.equal(run.report.browser.reportSha256, undefined); assert.equal(run.report.browser.reportedStatus, undefined);
    assert.equal(run.report.browser.accepted, false); assert.equal(run.f.cleanupCalls, 1);
  } finally { await run.f.dispose(); }
});

for (const browserArtifact of ['source','version','kind','privacy','nested-provider','credential','secret-value','unfinished','running','negative-timing','malformed']) {
  test(`invalid ${browserArtifact} browser failure report is rejected without copying its fields or masking the original failure`, async () => {
    const run = await exercise({ completedBrowserFailure: true, browserArtifact });
    try {
      assert.equal(run.error.code, 'TEST_BROWSER_EXECUTION_FAILED'); assert.equal(run.report.failureCode, 'TEST_BROWSER_EXECUTION_FAILED');
      assert.equal(run.report.browser.status, 'FAIL'); assert.equal(run.report.browser.artifactStatus, 'INVALID');
      assert.equal(run.report.browser.artifactFailureCode, 'HOSTED_BROWSER_ARTIFACT_INVALID');
      assert.equal(run.report.browser.reportSha256, undefined); assert.equal(run.report.browser.reportedFailureCode, undefined);
      assert.equal(run.report.browser.accepted, false); assert.equal(run.f.cleanupCalls, 1);
    } finally { await run.f.dispose(); }
  });
}

test('a passing stored child report cannot turn a thrown execution error into browser or driver success', async () => {
  const run = await exercise({ throwAfterBrowserReport: true });
  try {
    assert.equal(run.error.code, 'TEST_BROWSER_EXECUTION_FAILED'); assert.equal(run.report.status, 'FAIL_HOSTED_REHEARSAL');
    assert.equal(run.report.browser.status, 'FAIL'); assert.equal(run.report.browser.reportedStatus, 'PASS_HOSTED_BROWSER_ORGANIZER_CONTROL_ONLY');
    assert.equal(run.report.browser.artifactStatus, 'VALIDATED'); assert.equal(run.report.browser.accepted, false);
    assert.equal(run.report.browser.minimumDurationMet, undefined); assert.equal(run.f.cleanupCalls, 1);
  } finally { await run.f.dispose(); }
});

test('cleanup failure retains both the execution failure and validated child failure receipt', async () => {
  const run = await exercise({ completedBrowserFailure: true, cleanupIncomplete: true });
  try {
    assert.equal(run.error.code, 'HOSTED_FIXTURE_CLEANUP_UNCONFIRMED'); assert.equal(run.report.originalFailureCode, 'TEST_BROWSER_EXECUTION_FAILED');
    assert.equal(run.report.browser.status, 'FAIL'); assert.equal(run.report.browser.artifactStatus, 'VALIDATED');
    assert.equal(run.report.browser.reportedFailureCode, 'TEST_BROWSER_ACTION_REJECTED');
    assert.equal(run.report.cleanup, 'EXACT_ID_RECONCILIATION_REQUIRED');
  } finally { await run.f.dispose(); }
});

for (const browserArtifact of ['kind','privacy','nested-provider']) test(`apparent browser success uses the same ${browserArtifact} artifact validation`, async () => {
  const run = await exercise({ browserArtifact });
  try {
    assert.equal(run.error.code, 'HOSTED_BROWSER_ARTIFACT_INVALID'); assert.equal(run.result, undefined);
    assert.equal(run.report.browser.status, 'FAIL'); assert.equal(run.report.browser.artifactStatus, 'INVALID');
    assert.equal(run.report.browser.accepted, false); assert.equal(run.report.browser.minimumDurationMet, undefined);
    assert.equal(run.f.cleanupCalls, 1);
  } finally { await run.f.dispose(); }
});

for (const browserClaim of ['realEmail','physicalMedia']) for (const claimOn of ['stored','result']) for (const claimLocation of ['top','nested']) {
  test(`${claimOn} ${claimLocation} ${browserClaim} claim cannot grant control-only rehearsal success`, async () => {
    const run = await exercise({ browserClaim, claimOn, claimLocation });
    try {
      assert.equal(run.error.code, claimOn === 'result' ? 'HOSTED_BROWSER_EVIDENCE_INVALID' : 'HOSTED_BROWSER_ARTIFACT_INVALID');
      assert.equal(run.result, undefined); assert.equal(run.report.browser.status, 'FAIL'); assert.equal(run.report.browser.accepted, false);
      assert.equal(run.report.browser.minimumDurationMet, undefined); assert.equal(run.f.cleanupCalls, 1);
    } finally { await run.f.dispose(); }
  });
}

test('a non-boolean physical-media claim cannot bypass the evidence boundary', async () => {
  const run = await exercise({ browserClaim: 'physicalMedia', claimValue: 'true' });
  try { assert.equal(run.error.code, 'HOSTED_BROWSER_ARTIFACT_INVALID'); assert.equal(run.result, undefined); assert.equal(run.f.cleanupCalls, 1); }
  finally { await run.f.dispose(); }
});

for (const browserTiming of ['zero','just-short','stale','future','returned-elapsed-mismatch','returned-date-mismatch']) {
  test(`${browserTiming} receipt timing cannot pass despite a full independent driver duration`, async () => {
    const run = await exercise({ browserTiming });
    try {
      assert.equal(run.error.code, 'HOSTED_BROWSER_ARTIFACT_INVALID'); assert.equal(run.result, undefined);
      assert.ok(run.report.browser.measuredDurationMs >= MINIMUM_HOSTED_REHEARSAL_MS);
      assert.equal(run.report.browser.status, 'FAIL'); assert.equal(run.report.browser.accepted, false);
      assert.equal(run.report.browser.minimumDurationMet, undefined); assert.equal(run.f.cleanupCalls, 1);
    } finally { await run.f.dispose(); }
  });
}

test('matching receipt timing allows bounded browser setup and report serialization overhead', async () => {
  const run = await exercise({ browserTiming: 'bounded-overhead' });
  try {
    assert.equal(run.error, undefined); assert.equal(run.report.status, 'PASS_HOSTED_ORGANIZER_CONTROL_ONLY');
    assert.equal(run.report.browser.minimumDurationMet, true); assert.equal(run.f.cleanupCalls, 1);
  } finally { await run.f.dispose(); }
});

for (const options of [{ browserTiming: 'stale' }, { browserTiming: 'future' }, { browserClaim: 'realEmail' }, { browserClaim: 'physicalMedia' }]) {
  test(`invalid failure receipt ${JSON.stringify(options)} preserves the original browser error`, async () => {
    const run = await exercise({ completedBrowserFailure: true, ...options });
    try {
      assert.equal(run.error.code, 'TEST_BROWSER_EXECUTION_FAILED'); assert.equal(run.report.browser.artifactStatus, 'INVALID');
      assert.equal(run.report.browser.accepted, false); assert.equal(run.report.browser.reportedFailureCode, undefined);
      assert.equal(run.report.browser.reportSha256, undefined); assert.equal(run.f.cleanupCalls, 1);
    } finally { await run.f.dispose(); }
  });
}

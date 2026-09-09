import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path, { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createStudyDebateFixtureLifecycle, FIXTURE_TARGET } from './debate-staging-fixtures.mjs';
import { TARGET, hash, parseBase, captureRemote, validateBaseline, validatePolicy,
  validateEvidence, buildConfig, inspectArtifact, resolveStagingPublishableKey,
  validateSmokeSessions } from './debate-staging-release.mjs';

const ROOT = path.resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exec = promisify(execFile);
const SHA = /^[a-f0-9]{40}$/u;
const need = (value, code) => { if (!value) { const error = new Error(code); error.code = code; throw error; } };
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const childSystemEnvironment = env => Object.fromEntries(['PATH', 'Path', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'TMPDIR',
  'SystemRoot', 'WINDIR', 'COMSPEC', 'CI', 'GITHUB_ACTIONS'].filter(key => typeof env[key] === 'string').map(key => [key, env[key]]));
const codeFor = error => /^[A-Z][A-Z0-9_]{2,90}$/u.test(error?.code || '') ? error.code : 'RESTRICTED_STAGING_STEP_FAILED';

// Importing this file never provisions an account.
// The reviewed staging workflow supplies its exact baseline suppression check and
// a prepare/deploy/postflight/GET-only-smoke callback. Secrets stay in this process
// or its directly invoked trusted child environment; none enter workflow inputs.
export async function withStudyDebateStagingAccounts({ manifestPath, run, ...options }) {
  if (typeof run !== 'function' || typeof manifestPath !== 'string') throw new Error('FIXTURE_COORDINATOR_REQUIRED');
  let initialized = false;
  const persist = async manifest => {
    await mkdir(dirname(manifestPath), { recursive: true });
    const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
    if (!initialized) { await writeFile(manifestPath, bytes, { flag: 'wx', mode: 0o600 }); initialized = true; }
    else { const temporary = `${manifestPath}.tmp`; await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await rename(temporary, manifestPath); }
  };
  const lifecycle = createStudyDebateFixtureLifecycle({ ...options, persist });
  let result, originalError, cleanup;
  try { const accounts = await lifecycle.provision(); result = await run(accounts); }
  catch (error) { originalError = error; }
  finally { cleanup = await lifecycle.cleanup(); }
  if (!cleanup.complete) { const e = new Error('FIXTURE_CLEANUP_REQUIRES_EXACT_ID_RECONCILIATION'); e.code = e.message; throw e; }
  if (originalError) throw originalError;
  return { result, cleanup, fixtures: lifecycle.snapshot() };
}

export async function verifyRestrictedStagingPreflight({ mode, env, root = ROOT,
  fetcher = fetch, git = async args => (await exec('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })).stdout.trim() }) {
  need(['prepare-auth', 'deploy'].includes(mode), 'RESTRICTED_STAGING_MODE');
  const candidate = env.DEBATE_CANDIDATE_SHA;
  need(SHA.test(candidate || '') && (await git(['rev-parse', 'HEAD'])) === candidate &&
    !(await git(['status', '--porcelain', '--untracked-files=all'])), 'DIRTY_OR_WRONG_CANDIDATE');
  need(!env.DEBATE_PREVIEW_ACTOR_IDS && !env.DEBATE_STAGING_ALLOWED_BEARER && !env.DEBATE_STAGING_DENIED_BEARER,
    'FIXTURE_DRIVER_REJECTS_PERSISTENT_BEARERS');
  need(/^sb_secret_[A-Za-z0-9_-]{20,}$/u.test(env.STAGING_SUPABASE_SERVICE_ROLE_KEY || ''), 'FIXTURE_CREDENTIAL_MISSING');
  const policy = await readJson(path.join(root, 'worker/debate-staging-policy.json')); validatePolicy(policy);
  const base = parseBase(await readFile(path.join(root, policy.baseConfig), 'utf8'));
  const review = JSON.parse(env.DEBATE_RELEASE_REVIEW || '{}');
  need(SHA.test(review.baseSha || ''), 'SCOPE_REVIEW_REQUIRED');
  await git(['merge-base', '--is-ancestor', review.baseSha, candidate]);
  const suiteFile = path.resolve(root, env.DEBATE_LOCAL_SUITE_REPORT || 'missing-suite-report.json');
  need(suiteFile.startsWith(path.join(root, 'artifacts') + path.sep), 'LOCAL_SUITE_SCOPE_INVALID');
  const suite = await readJson(suiteFile), sourceHashes = {}, migrationHashes = {};
  for (const file of Object.keys(suite.sourceHashes || {})) {
    need(!file.includes('..') && !file.includes('\\') && !path.isAbsolute(file), 'INVALID_SOURCE_MANIFEST');
    sourceHashes[file] = hash(await readFile(path.join(root, file)));
  }
  for (const file of policy.migrations) migrationHashes[file] = hash(await readFile(path.join(root, file)));
  validateEvidence({ review, suite, candidate, changedPaths: (await git(['diff', '--name-only', review.baseSha, candidate])).split('\n').filter(Boolean),
    migrationHashes, sourceHashes });
  // This in-memory placeholder checks all configuration gates, but grants nobody
  // access and writes no configuration. Only the fresh callback UUID is deployed.
  buildConfig(base, policy, '11111111-1111-4111-8111-111111111111', path.join(root, 'artifacts'), root);
  const artifact = await inspectArtifact(path.join(root, '.staging-dist'), root);
  const publicKey = await resolveStagingPublishableKey({ configuredKey: env.STAGING_SUPABASE_PUBLISHABLE_KEY || '', fetcher });
  // A correctly shaped key can belong to another project. Verify the key against
  // the fixed staging Auth service before any account is created or registered.
  // This endpoint contains provider settings, not customer identities.
  const authSettings = await fetcher(`${FIXTURE_TARGET.supabaseUrl}/auth/v1/settings`, { method: 'GET',
    redirect: 'error', cache: 'no-store', headers: { apikey: publicKey.key }, signal: AbortSignal.timeout(20000) });
  need(authSettings.status === 200, 'STAGING_PUBLISHABLE_KEY_REJECTED');
  const settings = await authSettings.json().catch(() => null);
  need(settings && !Array.isArray(settings) && settings.external?.email === true, 'STAGING_AUTH_EMAIL_PROVIDER_UNAVAILABLE');
  const publicKeyValidation = { status: 'PASS_FIXED_STAGING_AUTH_SETTINGS', projectRef: FIXTURE_TARGET.projectRef,
    httpStatus: authSettings.status, emailProviderEnabled: true, checkedAt: new Date().toISOString(),
    userRecordsRead: false, credentialsStored: false };
  let wrangler = null;
  if (mode === 'deploy') {
    const tooling = path.join(root, 'artifacts/debate-local-rehearsal/staging-tooling/node_modules/wrangler');
    const expected = path.join(tooling, 'bin/wrangler.js');
    need((await realpath(tooling)) === tooling && (await realpath(expected)) === expected, 'WRANGLER_PATH_INVALID');
    const metadata = await readJson(path.join(tooling, 'package.json'));
    need(metadata.name === 'wrangler' && metadata.version === '4.114.0' &&
      ['bin/wrangler.js', './bin/wrangler.js'].includes(metadata.bin?.wrangler), 'WRANGLER_VERSION_INVALID');
    wrangler = { file: expected, version: metadata.version, entrySha256: hash(await readFile(expected)) };
  }
  const baseline = await captureRemote({ token: env.CLOUDFLARE_API_TOKEN, accountId: env.CLOUDFLARE_ACCOUNT_ID, base, fetcher });
  validateBaseline(baseline, base, policy, env.DEBATE_EXPECTED_BASELINE_SHA256, env.DEBATE_EXPECTED_VERSION_ID);
  return { candidate, base, policy, review, baseline, publicKey, artifact, wrangler,
    evidence: { status: 'PASS_STATIC_GATES_BEFORE_ACCOUNT_CREATION', candidateSha: candidate,
      reviewedBaseSha: review.baseSha, baselineFingerprint: baseline.fingerprint, previousVersionId: baseline.state.versionId,
      migrationHashes, suiteSha256: hash(await readFile(suiteFile)), artifactHashes: artifact.hashes,
      publicKeySource: publicKey.source, publicKeyValidation,
      wrangler: wrangler ? { version: wrangler.version, entrySha256: wrangler.entrySha256 } : null,
      publicLaunch: false, mediaEnabled: false, mailEnabled: false } };
}

// Child output is kept in memory only. Neither stdout/stderr nor raw exceptions
// are forwarded or written: a failing SDK may include a request header or token.
export async function executeRestrictedStagingChild({ label, args, env, cwd }) {
  need(['prepare', 'deploy', 'postflight', 'smoke'].includes(label), 'RESTRICTED_CHILD_MODE');
  const startedAt = new Date().toISOString();
  try {
    const result = await exec(process.execPath, args, { cwd, env, encoding: 'utf8', windowsHide: true,
      maxBuffer: 2 * 1024 * 1024, timeout: label === 'deploy' ? 15 * 60000 : 3 * 60000 });
    return { label, status: 'PASS', exitCode: 0, startedAt, endedAt: new Date().toISOString(),
      stdoutSha256: hash(result.stdout || ''), stderrSha256: hash(result.stderr || ''), rawOutputStored: false };
  } catch (error) {
    return { label, status: 'FAIL', exitCode: Number.isInteger(error.code) ? error.code : null,
      signal: typeof error.signal === 'string' && /^[A-Z0-9]+$/u.test(error.signal) ? error.signal : null,
      startedAt, endedAt: new Date().toISOString(), stdoutSha256: hash(error.stdout || ''), stderrSha256: hash(error.stderr || ''),
      rawOutputStored: false, outcomeUnconfirmed: label === 'deploy' };
  }
}

export async function runRestrictedStaging({ mode, env = process.env, root = ROOT, fetcher = fetch,
  preflight = verifyRestrictedStagingPreflight, withAccounts = withStudyDebateStagingAccounts,
  child = executeRestrictedStagingChild }) {
  const checked = await preflight({ mode, env, root, fetcher });
  const output = path.join(root, 'artifacts/debate-local-rehearsal/staging-release');
  await mkdir(output, { recursive: true });
  const runId = `${new Date().toISOString().replaceAll(':', '-')}-${mode}`;
  const reportPath = path.join(output, `${runId}-driver.json`), manifestPath = path.join(output, `${runId}-fixtures.json`);
  const report = { schemaVersion: 1, mode, status: 'STATIC_GATES_PASSED', startedAt: new Date().toISOString(),
    sourceSha: checked.candidate, target: TARGET, staticPreflight: checked.evidence,
    deploymentState: 'NOT_REQUESTED', steps: [], cleanup: 'NOT_STARTED', credentialsStored: false };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  const save = async () => { const temporary = `${reportPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); await rename(temporary, reportPath); };
  const releaseScript = path.join(root, 'scripts/debate-staging-release.mjs');
  try {
    const complete = await withAccounts({ sourceSha: checked.candidate, supabaseUrl: FIXTURE_TARGET.supabaseUrl,
      workerUrl: FIXTURE_TARGET.workerUrl, serviceRoleKey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
      publishableKey: checked.publicKey.key, request: fetcher, manifestPath,
      verifySuppression: async () => {
        const current = await captureRemote({ token: env.CLOUDFLARE_API_TOKEN, accountId: env.CLOUDFLARE_ACCOUNT_ID,
          base: checked.base, fetcher });
        validateBaseline(current, checked.base, checked.policy, env.DEBATE_EXPECTED_BASELINE_SHA256, env.DEBATE_EXPECTED_VERSION_ID);
        return { projectRef: current.state.projectRef, outboundEmailMode: current.state.vars.OUTBOUND_EMAIL_MODE };
      },
      run: async ({ allowed, excluded }) => {
        report.cleanup = 'PENDING'; report.authenticatedAccounts = 2; await save();
        const childEnv = { ...childSystemEnvironment(env), CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
          CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID, DEBATE_CANDIDATE_SHA: checked.candidate,
          DEBATE_EXPECTED_BASELINE_SHA256: env.DEBATE_EXPECTED_BASELINE_SHA256,
          DEBATE_EXPECTED_VERSION_ID: env.DEBATE_EXPECTED_VERSION_ID, DEBATE_RELEASE_REVIEW: env.DEBATE_RELEASE_REVIEW,
          DEBATE_LOCAL_SUITE_REPORT: env.DEBATE_LOCAL_SUITE_REPORT, STAGING_SUPABASE_PUBLISHABLE_KEY: checked.publicKey.key,
          DEBATE_PREVIEW_ACTOR_IDS: allowed.id, DEBATE_STAGING_ALLOWED_BEARER: allowed.token, DEBATE_STAGING_DENIED_BEARER: excluded.token };
        report.sessionScope = await validateSmokeSessions({ allowedToken: allowed.token, deniedToken: excluded.token,
          publishableKey: checked.publicKey.key, allowlist: allowed.id, fetcher });
        const step = async (label, args) => { report.steps.push({ label, status: 'REQUESTED' }); await save();
          const scopedEnv = { ...childSystemEnvironment(env) };
          const names = label === 'prepare' ? Object.keys(childEnv) : label === 'deploy' ?
            ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'] : label === 'postflight' ?
              ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'DEBATE_PREVIEW_ACTOR_IDS'] :
              ['DEBATE_STAGING_ALLOWED_BEARER', 'DEBATE_STAGING_DENIED_BEARER'];
          for (const name of names) scopedEnv[name] = childEnv[name];
          if (label === 'deploy') scopedEnv.WRANGLER_SEND_METRICS = 'false';
          const result = await child({ label, args, env: scopedEnv, cwd: path.join(root, 'worker') });
          report.steps[report.steps.length - 1] = result; await save(); need(result.status === 'PASS', `RESTRICTED_${label.toUpperCase()}_FAILED`); };
        await step('prepare', [releaseScript, 'prepare']);
        if (mode === 'prepare-auth') { report.status = 'PASS_STAGING_AUTH_PREPARATION_ONLY'; return; }
        const expectedConfig = buildConfig(checked.base, checked.policy, allowed.id, output, root);
        need(hash(await readFile(expectedConfig.filename)) === expectedConfig.hash, 'PREPARED_CONFIG_DRIFT');
        const prepared = await readJson(path.join(output, 'preflight.json'));
        need(prepared.candidateSha === checked.candidate && prepared.configHash === expectedConfig.hash &&
          prepared.baselineFingerprint === checked.baseline.fingerprint &&
          prepared.previousVersionId === checked.baseline.state.versionId && prepared.publicLaunch === false,
          'PREPARED_EVIDENCE_DRIFT');
        need(hash(await readFile(checked.wrangler.file)) === checked.wrangler.entrySha256, 'WRANGLER_ENTRY_DRIFT');
        report.deploymentState = 'REQUESTED_OUTCOME_UNCONFIRMED'; await save();
        await step('deploy', [checked.wrangler.file, 'deploy', '--keep-vars', '--config',
          path.join(output, 'wrangler.debate-staging.toml')]);
        report.deploymentState = 'CLI_RETURNED_SUCCESS_PENDING_POSTFLIGHT'; await save();
        await step('postflight', [releaseScript, 'postflight']);
        const deployed = await readJson(path.join(output, 'deployed-baseline.json'));
        report.deploymentState = 'VERSION_AND_PRESERVATION_VERIFIED';
        report.deployedVersionId = deployed.state.versionId; report.deployedFingerprint = deployed.fingerprint; await save();
        await step('smoke', [releaseScript, 'smoke']);
        report.status = 'PASS_STAGING_ASSETS_AND_AUTH_ONLY';
      } });
    need(complete.cleanup.complete, 'FIXTURE_CLEANUP_UNCONFIRMED');
    report.cleanup = 'EXACT_FIXTURES_DELETED_AND_KNOWN_SESSIONS_DENIED'; report.completedAt = new Date().toISOString(); await save();
    return { status: report.status, reportPath, manifestPath, deploymentState: report.deploymentState,
      deployedVersionId: report.deployedVersionId || null, publicLaunch: false, fullAcceptance: false };
  } catch (error) {
    report.status = 'FAIL_RESTRICTED_STAGING'; report.failureCode = codeFor(error);
    try { const fixtures = await readJson(manifestPath); report.cleanup = fixtures.cleanupComplete ?
      'EXACT_FIXTURES_DELETED' : 'EXACT_ID_RECONCILIATION_REQUIRED'; }
    catch { report.cleanup = 'MANIFEST_UNAVAILABLE_RECONCILIATION_REQUIRED'; }
    if (report.deploymentState !== 'NOT_REQUESTED') {
      try { const actual = await captureRemote({ token: env.CLOUDFLARE_API_TOKEN, accountId: env.CLOUDFLARE_ACCOUNT_ID,
        base: checked.base, fetcher }); report.observedAfterFailure = { versionId: actual.state.versionId,
        fingerprint: actual.fingerprint, capturedAt: actual.capturedAt }; }
      catch { report.postFailureReadback = 'UNAVAILABLE'; }
    }
    report.completedAt = new Date().toISOString(); await save();
    const safe = new Error(report.failureCode); safe.code = report.failureCode; safe.reportPath = reportPath; throw safe;
  }
}

async function main() {
  need(process.argv.length === 3 && ['prepare-auth', 'deploy'].includes(process.argv[2]), 'RESTRICTED_STAGING_MODE');
  // The dedicated reviewed workflow owns its exact event/label/branch approval.
  // This CLI additionally refuses local desktops and untrusted repository actors.
  need(process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true' &&
    process.env.GITHUB_REPOSITORY === 'codingwally/Bar-Exam-simulator' && process.env.GITHUB_ACTOR === 'codingwally' &&
    process.env.GITHUB_TRIGGERING_ACTOR === 'codingwally', 'RESTRICTED_STAGING_CI_REQUIRED');
  const result = await runRestrictedStaging({ mode: process.argv[2] }); console.log(JSON.stringify(result));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(codeFor(error)); process.exitCode = 1;
});

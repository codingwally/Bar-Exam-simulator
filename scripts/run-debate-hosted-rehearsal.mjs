/** Restricted hosted organizer rehearsal. Importing this module has no side effects. */
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRestrictedStagingPreflight, executeRestrictedStagingChild } from './run-debate-staging-auth.mjs';
import { TARGET, hash, buildConfig, captureRemote, previewIds, validateBaseline, validatePolicy,
  validatePreservation, validateSmokeSessions } from './debate-staging-release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[a-f0-9]{12}$/u;
const SHA = /^[a-f0-9]{40}$/u, HASH = /^[a-f0-9]{64}$/u;
export const MINIMUM_HOSTED_REHEARSAL_MS = 93 * 60 * 1000;
const ACTORS = ['host','A1','A2','A3','N1','N2','N3','judge2','judge3','observer','excluded'];
const need = (value, code) => { if (!value) { const error = new Error(code); error.code = code; throw error; } };
const codeFor = error => /^[A-Z][A-Z0-9_]{2,90}$/u.test(error?.code || '') ? error.code : 'HOSTED_REHEARSAL_STEP_FAILED';
const readJson = async filename => JSON.parse(await readFile(filename, 'utf8'));
const systemEnvironment = env => Object.fromEntries(['PATH','Path','HOME','USERPROFILE','TEMP','TMP','TMPDIR',
  'SystemRoot','WINDIR','COMSPEC','CI','GITHUB_ACTIONS'].filter(key => typeof env[key] === 'string').map(key => [key, env[key]]));
const instant = clock => new Date(clock()).toISOString();

function atomicJsonWriter(filename, secrets) {
  let initialized = false, tail = Promise.resolve();
  return value => {
    const bytes = JSON.stringify(value, null, 2) + '\n';
    need(!/"(?:access_token|refresh_token|password|authorization|serviceRoleKey|service_role_key)"\s*:/iu.test(bytes)
      && ![...secrets].some(secret => secret.length >= 8 && bytes.includes(secret)), 'HOSTED_EVIDENCE_CONTAINS_CREDENTIAL');
    const pending = tail.then(async () => {
      if (!initialized) { await writeFile(filename, bytes, { flag: 'wx', mode: 0o600 }); initialized = true; }
      else {
        const temporary = filename + '.tmp-' + randomUUID();
        await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await rename(temporary, filename);
      }
    });
    tail = pending.catch(() => {}); return pending;
  };
}

function childReceipt(label, result) {
  need(result?.label === label && ['PASS','FAIL'].includes(result.status) && result.rawOutputStored === false,
    'HOSTED_CHILD_RECEIPT_INVALID');
  need(HASH.test(result.stdoutSha256 || '') && HASH.test(result.stderrSha256 || ''), 'HOSTED_CHILD_RECEIPT_INVALID');
  return { label, status: result.status, exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
    signal: typeof result.signal === 'string' && /^[A-Z0-9]+$/u.test(result.signal) ? result.signal : null,
    stdoutSha256: result.stdoutSha256, stderrSha256: result.stderrSha256,
    rawOutputStored: false, outcomeUnconfirmed: label === 'deploy' && result.status !== 'PASS' };
}

const browserClaimsWithinScope = value => ['publicLaunch','providerMedia','realMail','realEmail','physicalMedia','fullAcceptance']
  .every(key => (value[key] === undefined || value[key] === false)
    && (value.claims?.[key] === undefined || value.claims[key] === false));

async function readBrowserReceipt({ outputDir, sourceSha, workerVersion, secrets, attempt }) {
  const filename = path.join(outputDir, 'browser/report.json');
  need(await realpath(filename) === filename, 'HOSTED_BROWSER_ARTIFACT_INVALID');
  const bytes = await readFile(filename), text = bytes.toString('utf8');
  need(bytes.length <= 2 * 1024 * 1024
    && !/"(?:access_token|refresh_token|password|authorization|serviceRoleKey|service_role_key)"\s*:/iu.test(text)
    && ![...secrets].some(secret => secret.length >= 8 && text.includes(secret)), 'HOSTED_BROWSER_ARTIFACT_INVALID');
  const stored = JSON.parse(text), started = Date.parse(stored.startedAt), finished = Date.parse(stored.finishedAt);
  need(stored.kind === 'ISOLATED_CI_HOSTED_BROWSER_ORGANIZER'
    && ['PASS_HOSTED_BROWSER_ORGANIZER_CONTROL_ONLY','FAIL'].includes(stored.status)
    && stored.sourceSha === sourceSha && stored.workerVersion === workerVersion
    && stored.actualHostedAuth === true && stored.mainWorkerBootstrap === true && stored.physicalMediaVerified === false
    && stored.defaultFlowDurationMs === 78 * 60000 && stored.correctionWindowMs === 15 * 60000
    && ['credentialsStored','tracesStored','rawDomStored'].every(key => stored[key] === false)
    && browserClaimsWithinScope(stored)
    && Number.isFinite(started) && Number.isFinite(finished) && finished >= started
    && Number.isFinite(stored.elapsedMs) && stored.elapsedMs >= 0 && Math.abs(finished - started - stored.elapsedMs) <= 5000,
  'HOSTED_BROWSER_ARTIFACT_INVALID');
  // The browser records its start after module loading and static setup, then
  // records its finish immediately before writing this file and returning.
  // Allow bounded setup/serialization overhead, never a different run's timing.
  need(Number.isFinite(attempt?.beganWall) && Number.isFinite(attempt?.finishedWall)
    && Number.isFinite(attempt?.durationMs) && attempt.durationMs >= 0
    && started >= attempt.beganWall - 5000 && started <= attempt.beganWall + 30000
    && Math.abs(finished - attempt.finishedWall) <= 5000
    && stored.elapsedMs <= attempt.durationMs + 5000 && stored.elapsedMs >= attempt.durationMs - 30000
    && (stored.status !== 'PASS_HOSTED_BROWSER_ORGANIZER_CONTROL_ONLY' || stored.elapsedMs >= MINIMUM_HOSTED_REHEARSAL_MS),
  'HOSTED_BROWSER_ARTIFACT_INVALID');
  return { stored, sha256: hash(bytes), startedAt: new Date(started).toISOString(), completedAt: new Date(finished).toISOString() };
}

async function defaultBrowser(input) {
  const { runHostedBrowserOrganizer } = await import('./test-debate-browser-hosted-organizer.mjs');
  return runHostedBrowserOrganizer(input);
}
async function defaultLifecycle(input) {
  const { createHostedDebateFixtureLifecycle } = await import('./debate-hosted-fixtures.mjs');
  return createHostedDebateFixtureLifecycle(input);
}
async function defaultUploadDiagnostic(input) {
  const { runHostedUploadDiagnostic } = await import('./debate-hosted-upload-diagnostic.mjs');
  return runHostedUploadDiagnostic(input);
}

async function verifyPreparationReceipt({ env, root, checked, clock }) {
  need(typeof env.DEBATE_HOSTED_PREPARATION_REPORT === 'string' && env.DEBATE_HOSTED_PREPARATION_REPORT.length > 0
    && HASH.test(env.DEBATE_HOSTED_PREPARATION_SHA256 || ''), 'HOSTED_PREPARATION_EVIDENCE_REQUIRED');
  const filename = path.resolve(root, env.DEBATE_HOSTED_PREPARATION_REPORT);
  need(filename.startsWith(path.join(root, 'artifacts') + path.sep)
    && await realpath(filename) === filename, 'HOSTED_PREPARATION_EVIDENCE_PATH_INVALID');
  const bytes = await readFile(filename);
  need(hash(bytes) === env.DEBATE_HOSTED_PREPARATION_SHA256, 'HOSTED_PREPARATION_EVIDENCE_HASH_MISMATCH');
  const previous = JSON.parse(bytes), started = Date.parse(previous.startedAt), completed = Date.parse(previous.completedAt);
  need(previous.schemaVersion === 1 && previous.kind === 'HOSTED_DEBATE_ORGANIZER_REHEARSAL_DRIVER'
    && previous.mode === 'prepare' && previous.status === 'PASS_HOSTED_FIXTURE_PREPARATION_ONLY'
    && previous.sourceSha === checked.candidate && hash(previous.target) === hash(TARGET)
    && previous.baselineFingerprint === checked.baseline.fingerprint && previous.previousVersionId === checked.baseline.state.versionId
    && previous.deploymentState === 'NOT_REQUESTED' && previous.deployedVersionId == null && previous.browser == null
    && Array.isArray(previous.steps) && previous.steps.length === 0
    && previous.authenticatedAccounts === 11 && previous.allowedAccounts === 10
    && previous.cleanup === 'EXACT_FIXTURES_DELETED_AND_KNOWN_SESSIONS_DENIED'
    && previous.immediateLogoutFencingVerified === true && previous.atomicCleanupHelperVerified === true
    && previous.verificationGap == null
    && ['publicLaunch','physicalMedia','providerMedia','realMail','fullAcceptance','credentialsStored','rawOutputStored','tracesStored']
      .every(key => previous[key] === false)
    && Number.isFinite(started) && Number.isFinite(completed) && completed >= started && completed <= clock(),
  'HOSTED_PREPARATION_EVIDENCE_INVALID');
  return { reportPath: path.relative(root, filename).replaceAll(path.sep, '/'), sha256: hash(bytes),
    sourceSha: previous.sourceSha, completedAt: previous.completedAt, immediateLogoutFencingVerified: true,
    atomicCleanupHelperVerified: true };
}

export async function runHostedDebateRehearsal({ mode = 'run', env = process.env, root = ROOT, fetcher = fetch,
  preflight = verifyRestrictedStagingPreflight, lifecycleFactory = defaultLifecycle,
  child = executeRestrictedStagingChild, browser = defaultBrowser, uploadDiagnostic = defaultUploadDiagnostic, capture = captureRemote,
  verifySessions = validateSmokeSessions, clock = Date.now, monotonic = () => performance.now() } = {}) {
  need(['prepare','run','upload-diagnostic'].includes(mode), 'HOSTED_REHEARSAL_MODE');
  // No storage or accounts may exist before this full exact-candidate check.
  let checked;
  try { checked = await preflight({ mode: 'deploy', env, root, fetcher }); }
  catch (error) { const safe = new Error(codeFor(error)); safe.code = safe.message; throw safe; }
  need(SHA.test(checked.candidate || '') && checked.candidate === env.DEBATE_CANDIDATE_SHA && checked.wrangler?.version === '4.114.0', 'HOSTED_STATIC_PREFLIGHT_INVALID');
  validatePolicy(checked.policy);
  validateBaseline(checked.baseline, checked.base, checked.policy, env.DEBATE_EXPECTED_BASELINE_SHA256, env.DEBATE_EXPECTED_VERSION_ID);
  let preparationEvidence;
  if (mode !== 'prepare') {
    try { preparationEvidence = await verifyPreparationReceipt({ env, root, checked, clock }); }
    catch (error) { const safe = new Error(codeFor(error)); safe.code = safe.message; throw safe; }
  }
  const releaseOutput = path.join(root, 'artifacts/debate-local-rehearsal/staging-release');
  await mkdir(releaseOutput, { recursive: true });
  const outputDir = path.join(releaseOutput, `hosted-${checked.candidate.slice(0, 12)}-${randomUUID()}`);
  await mkdir(outputDir); // Fresh run only; prior evidence is never overwritten.
  const reportPath = path.join(outputDir, 'driver.json'), manifestPath = path.join(outputDir, 'fixtures.json');
  const secrets = new Set([env.STAGING_SUPABASE_SERVICE_ROLE_KEY, env.CLOUDFLARE_API_TOKEN].filter(value => typeof value === 'string'));
  const saveReport = atomicJsonWriter(reportPath, secrets), persist = atomicJsonWriter(manifestPath, secrets);
  const report = { schemaVersion: 1, kind: 'HOSTED_DEBATE_ORGANIZER_REHEARSAL_DRIVER', mode, status: 'STATIC_GATES_PASSED',
    sourceSha: checked.candidate, target: TARGET, startedAt: instant(clock), baselineFingerprint: checked.baseline.fingerprint,
    previousVersionId: checked.baseline.state.versionId, minimumBrowserDurationMs: mode === 'upload-diagnostic' ? null : MINIMUM_HOSTED_REHEARSAL_MS,
    deploymentState: 'NOT_REQUESTED', storage: 'NOT_REQUESTED', steps: [], cleanup: 'NOT_STARTED',
    immediateLogoutFencingVerified: null, atomicCleanupHelperVerified: false,
    credentialsStored: false, rawOutputStored: false, tracesStored: false, publicLaunch: false,
    physicalMedia: false, providerMedia: false, realMail: false, fullAcceptance: false };
  if (preparationEvidence) report.preparationEvidence = preparationEvidence;
  await saveReport(report);
  let lifecycle, failure, cleanup, browserAttempt;
  const rememberSession = session => {
    need(session?.user && UUID.test(session.user.id || '') && typeof session.access_token === 'string' && session.access_token.length > 80,
      'HOSTED_SESSION_INVALID');
    for (const value of [session.access_token, session.refresh_token]) if (typeof value === 'string') secrets.add(value);
    return session;
  };
  const recheckSuppression = async () => {
    const current = await capture({ token: env.CLOUDFLARE_API_TOKEN, accountId: env.CLOUDFLARE_ACCOUNT_ID, base: checked.base, fetcher });
    validateBaseline(current, checked.base, checked.policy, env.DEBATE_EXPECTED_BASELINE_SHA256, env.DEBATE_EXPECTED_VERSION_ID);
    for (const key of ['DEBATE_ROOM_ENABLED','DEBATE_MEDIA_ENABLED','DEBATE_SWEEPER_ENABLED'])
      need(current.state.vars[key] == null || current.state.vars[key] === 'false', 'HOSTED_REMOTE_FLAGS_UNSAFE');
    for (const key of ['DEBATE_RESULTS_EMAIL_MODE','DEBATE_INVITATION_EMAIL_MODE'])
      need(current.state.vars[key] == null || current.state.vars[key] === 'suppressed', 'HOSTED_REMOTE_FLAGS_UNSAFE');
    need(current.state.vars.DEBATE_APPROVED_MAX_PARTICIPANTS == null || current.state.vars.DEBATE_APPROVED_MAX_PARTICIPANTS === '0', 'HOSTED_REMOTE_FLAGS_UNSAFE');
    return { projectRef: current.state.projectRef, outboundEmailMode: current.state.vars.OUTBOUND_EMAIL_MODE,
      publicLaunch: false, mediaEnabled: false, mailEnabled: false };
  };
  try {
    lifecycle = await lifecycleFactory({ sourceSha: checked.candidate, supabaseUrl: `https://${TARGET.project}.supabase.co`,
      workerUrl: TARGET.origin, serviceRoleKey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
      publishableKey: checked.publicKey.key, persist, verifySuppression: recheckSuppression, request: fetcher, clock });
    need(lifecycle && ['snapshot','preflightStorage','ensureStorage','provision','sessionFor','cleanup'].every(key => typeof lifecycle[key] === 'function'),
      'HOSTED_LIFECYCLE_INVALID');
    report.cleanup = 'PENDING'; await saveReport(report);
    const storage = await lifecycle.preflightStorage();
    need(['ABSENT','MATCHING_PRIVATE_BUCKET'].includes(storage?.status), 'HOSTED_STORAGE_PREFLIGHT_INVALID');
    if (mode === 'upload-diagnostic') need(storage.status === 'MATCHING_PRIVATE_BUCKET', 'HOSTED_UPLOAD_BUCKET_REQUIRED');
    report.storage = storage.status; await saveReport(report);
    // Suppression is refreshed before even a conditional storage creation.
    await recheckSuppression();
    if (mode === 'upload-diagnostic') {
      need((await lifecycle.preflightStorage())?.status === 'MATCHING_PRIVATE_BUCKET', 'HOSTED_UPLOAD_BUCKET_REQUIRED');
    } else await lifecycle.ensureStorage();
    report.storage = 'PRIVATE_BUCKET_CONFIRMED'; await saveReport(report);
    const provisioned = await lifecycle.provision(), accounts = provisioned?.accounts;
    need(accounts && Object.keys(accounts).length === ACTORS.length && ACTORS.every(name => UUID.test(accounts[name]?.id || ''))
      && new Set(ACTORS.map(name => accounts[name].id)).size === ACTORS.length, 'HOSTED_ACCOUNT_SCOPE_INVALID');
    const allowedIds = ACTORS.filter(name => name !== 'excluded').map(name => accounts[name].id).sort();
    need(hash(provisioned.previewIds?.slice().sort()) === hash(allowedIds) && provisioned.excludedId === accounts.excluded.id,
      'HOSTED_ACCOUNT_SCOPE_INVALID');
    const allowlist = previewIds(allowedIds.join(',')).join(',');
    report.authenticatedAccounts = ACTORS.length; report.allowedAccounts = allowedIds.length; await saveReport(report);
    let allowedSession = rememberSession(await lifecycle.sessionFor('host')), excludedSession = rememberSession(await lifecycle.sessionFor('excluded'));
    need(allowedSession.user.id === accounts.host.id && excludedSession.user.id === accounts.excluded.id, 'HOSTED_SESSION_SCOPE_INVALID');
    await verifySessions({ allowedToken: allowedSession.access_token, deniedToken: excludedSession.access_token,
      publishableKey: checked.publicKey.key, allowlist, fetcher });
    if (mode === 'prepare') {
      report.status = 'FIXTURES_VERIFIED_PENDING_CLEANUP'; await saveReport(report);
    } else {
      const releaseScript = path.join(root, 'scripts/debate-staging-release.mjs');
      const step = async label => {
        const scoped = systemEnvironment(env);
        const common = { CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID };
        let args = [releaseScript, label];
        if (label === 'prepare') Object.assign(scoped, common, { DEBATE_CANDIDATE_SHA: checked.candidate,
          DEBATE_EXPECTED_BASELINE_SHA256: env.DEBATE_EXPECTED_BASELINE_SHA256, DEBATE_EXPECTED_VERSION_ID: env.DEBATE_EXPECTED_VERSION_ID,
          DEBATE_RELEASE_REVIEW: env.DEBATE_RELEASE_REVIEW, DEBATE_LOCAL_SUITE_REPORT: env.DEBATE_LOCAL_SUITE_REPORT,
          STAGING_SUPABASE_PUBLISHABLE_KEY: checked.publicKey.key, DEBATE_PREVIEW_ACTOR_IDS: allowlist,
          DEBATE_STAGING_ALLOWED_BEARER: allowedSession.access_token, DEBATE_STAGING_DENIED_BEARER: excludedSession.access_token });
        else if (label === 'deploy') {
          Object.assign(scoped, common, { WRANGLER_SEND_METRICS: 'false' });
          args = [checked.wrangler.file, 'deploy', '--keep-vars', '--config', path.join(releaseOutput, 'wrangler.debate-staging.toml')];
        } else if (label === 'postflight') Object.assign(scoped, common, { DEBATE_PREVIEW_ACTOR_IDS: allowlist });
        else if (label === 'smoke') Object.assign(scoped, { DEBATE_STAGING_ALLOWED_BEARER: allowedSession.access_token,
          DEBATE_STAGING_DENIED_BEARER: excludedSession.access_token });
        else need(false, 'HOSTED_CHILD_MODE');
        report.steps.push({ label, status: 'REQUESTED' }); await saveReport(report);
        const receipt = childReceipt(label, await child({ label, args, env: scoped, cwd: path.join(root, 'worker') }));
        report.steps[report.steps.length - 1] = receipt; await saveReport(report);
        need(receipt.status === 'PASS' && receipt.exitCode === 0, `HOSTED_${label.toUpperCase()}_FAILED`);
      };
      await step('prepare');
      const expectedConfig = buildConfig(checked.base, checked.policy, allowlist, releaseOutput, root);
      need(hash(await readFile(expectedConfig.filename)) === expectedConfig.hash, 'PREPARED_CONFIG_DRIFT');
      const prepared = await readJson(path.join(releaseOutput, 'preflight.json'));
      need(prepared.candidateSha === checked.candidate && prepared.configHash === expectedConfig.hash
        && prepared.baselineFingerprint === checked.baseline.fingerprint && prepared.previousVersionId === checked.baseline.state.versionId
        && prepared.publicLaunch === false, 'PREPARED_EVIDENCE_DRIFT');
      // Re-run existing gates immediately before mutation: committed source, exact
      // artifact, actual baseline, credential configuration and locked tool entry.
      const fresh = await preflight({ mode: 'deploy', env, root, fetcher });
      need(fresh.candidate === checked.candidate && fresh.baseline.fingerprint === checked.baseline.fingerprint
        && hash(fresh.base.source) === hash(checked.base.source) && hash(fresh.policy) === hash(checked.policy)
        && hash(fresh.artifact.hashes) === hash(checked.artifact.hashes)
        && fresh.wrangler?.file === checked.wrangler.file && fresh.wrangler.entrySha256 === checked.wrangler.entrySha256,
        'HOSTED_PREDEPLOY_DRIFT');
      need(hash(await readFile(expectedConfig.filename)) === expectedConfig.hash, 'PREPARED_CONFIG_DRIFT');
      need(hash(await readFile(checked.wrangler.file)) === checked.wrangler.entrySha256, 'WRANGLER_ENTRY_DRIFT');
      report.deploymentState = 'REQUESTED_OUTCOME_UNCONFIRMED'; await saveReport(report);
      await step('deploy');
      report.deploymentState = 'CLI_RETURNED_SUCCESS_PENDING_POSTFLIGHT'; await saveReport(report);
      await step('postflight');
      const deployed = await readJson(path.join(releaseOutput, 'deployed-baseline.json'));
      validatePreservation(checked.baseline, deployed, { ...checked.policy.debateVars, DEBATE_PREVIEW_ACTOR_IDS: allowlist });
      need(UUID.test(deployed.state.versionId || ''), 'HOSTED_DEPLOYED_VERSION_INVALID');
      report.deploymentState = 'VERSION_AND_PRESERVATION_VERIFIED'; report.deployedVersionId = deployed.state.versionId;
      report.deployedFingerprint = deployed.fingerprint; await saveReport(report);
      allowedSession = rememberSession(await lifecycle.sessionFor('host')); excludedSession = rememberSession(await lifecycle.sessionFor('excluded'));
      need(allowedSession.user.id === accounts.host.id && excludedSession.user.id === accounts.excluded.id, 'HOSTED_SESSION_SCOPE_INVALID');
      await step('smoke');
      if (mode === 'upload-diagnostic') {
        const filename = path.join(outputDir, 'upload-diagnostic.json');
        const result = await uploadDiagnostic({ lifecycle, workerUrl: TARGET.origin, sourceSha: checked.candidate,
          workerVersion: report.deployedVersionId, persist: atomicJsonWriter(filename, secrets), request: fetcher, clock, rememberSession });
        const stored = await readJson(filename);
        need(hash(result) === hash(stored) && result?.kind === 'HOSTED_SINGLE_UPLOAD_DIAGNOSTIC'
          && result.sourceSha === checked.candidate && result.workerVersion === report.deployedVersionId
          && ['providerMedia','realMail','publicLaunch','fullAcceptance','credentialsStored','rawBodiesStored'].every(key => result[key] === false)
          && result.completedTimerStages === 0 && Number.isFinite(result.elapsedMs) && result.elapsedMs >= 0 && result.elapsedMs < 330000,
        'HOSTED_UPLOAD_DIAGNOSTIC_EVIDENCE_INVALID');
        report.uploadDiagnostic = { status: result.status, uploadAttempts: result.uploadAttempts,
          completedTimerStages: 0, reportPath: 'upload-diagnostic.json', reportSha256: hash(await readFile(filename)),
          independentAbsence: 'PENDING_SEPARATE_POST_RUN_READBACK' }; await saveReport(report);
        need(result.status === 'PASS_HOSTED_SINGLE_UPLOAD_ONLY' && result.uploadAttempts === 1
          && result.upload?.status === 200 && result.upload?.ok === true, 'HOSTED_UPLOAD_DIAGNOSTIC_FAILED');
        report.status = 'UPLOAD_PASSED_PENDING_CLEANUP'; await saveReport(report);
      } else {
      report.browser = { status: 'RUNNING', startedAt: instant(clock) }; await saveReport(report);
      const began = monotonic(), beganWall = clock();
      browserAttempt = { began, beganWall };
      const result = await browser({ lifecycle, workerUrl: TARGET.origin, sourceSha: checked.candidate,
        workerVersion: report.deployedVersionId, outputDir: path.join(outputDir, 'browser') });
      const durationMs = monotonic() - began, finishedWall = clock(), wallDurationMs = finishedWall - beganWall;
      need(result?.status === 'PASS_HOSTED_BROWSER_ORGANIZER_CONTROL_ONLY', 'HOSTED_BROWSER_NOT_PASSED');
      need(result.sourceSha === checked.candidate && result.workerVersion === report.deployedVersionId && result.actualHostedAuth === true
        && result.mainWorkerBootstrap === true && result.physicalMediaVerified === false
        && result.defaultFlowDurationMs === 78 * 60000 && result.correctionWindowMs === 15 * 60000
        && browserClaimsWithinScope(result)
        && ['credentialsStored','tracesStored','rawDomStored'].every(key => result[key] === false), 'HOSTED_BROWSER_EVIDENCE_INVALID');
      need(Number.isFinite(wallDurationMs) && Math.abs(wallDurationMs - durationMs) <= 5000, 'HOSTED_REHEARSAL_CLOCK_CHANGED');
      need(Number.isFinite(durationMs) && durationMs >= MINIMUM_HOSTED_REHEARSAL_MS, 'HOSTED_REHEARSAL_TOO_SHORT');
      const { stored, sha256 } = await readBrowserReceipt({ outputDir, sourceSha: checked.candidate,
        workerVersion: report.deployedVersionId, secrets, attempt: { beganWall, finishedWall, durationMs } });
      const evidenceFields = ['kind','status','sourceSha','workerVersion','actualHostedAuth','mainWorkerBootstrap','physicalMediaVerified',
        'defaultFlowDurationMs','correctionWindowMs','startedAt','finishedAt','elapsedMs','credentialsStored','tracesStored','rawDomStored'];
      need(evidenceFields.every(key => stored[key] === result[key]), 'HOSTED_BROWSER_ARTIFACT_INVALID');
      report.browser = { status: result.status, startedAt: report.browser.startedAt, completedAt: instant(clock),
        measuredDurationMs: durationMs, minimumDurationMet: true, reportPath: 'browser/report.json', reportSha256: sha256 };
      report.status = 'BROWSER_PASSED_PENDING_CLEANUP'; await saveReport(report);
      }
    }
  } catch (error) {
    failure = error;
    if (browserAttempt && report.browser?.status === 'RUNNING') {
      const durationMs = monotonic() - browserAttempt.began, finishedWall = clock(), wallDurationMs = finishedWall - browserAttempt.beganWall;
      const failed = { status: 'FAIL', startedAt: report.browser.startedAt, completedAt: instant(clock),
        failureCode: codeFor(error), measuredDurationMs: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null,
        clockConsistent: Number.isFinite(wallDurationMs) && Number.isFinite(durationMs) && Math.abs(wallDurationMs - durationMs) <= 5000,
        artifactStatus: 'UNAVAILABLE', accepted: false };
      try {
        const { stored, sha256, startedAt, completedAt } = await readBrowserReceipt({ outputDir, sourceSha: checked.candidate,
          workerVersion: report.deployedVersionId, secrets, attempt: { beganWall: browserAttempt.beganWall, finishedWall, durationMs } });
        Object.assign(failed, { artifactStatus: 'VALIDATED', reportedStatus: stored.status,
          reportedFailureCode: stored.status === 'FAIL' && /^[A-Z][A-Z0-9_]{2,90}$/u.test(stored.failure?.code || '') ? stored.failure.code : null,
          reportedStartedAt: startedAt, reportedCompletedAt: completedAt, reportedElapsedMs: stored.elapsedMs,
          reportPath: 'browser/report.json', reportSha256: sha256 });
      } catch (receiptError) {
        failed.artifactStatus = receiptError?.code === 'ENOENT' ? 'ABSENT' : 'INVALID';
        failed.artifactFailureCode = receiptError?.code === 'ENOENT' ? 'HOSTED_BROWSER_ARTIFACT_ABSENT' : 'HOSTED_BROWSER_ARTIFACT_INVALID';
      }
      report.browser = failed;
    }
  }
  finally {
    if (lifecycle) {
      try { cleanup = await lifecycle.cleanup(); }
      catch (error) { cleanup = { complete: false }; report.cleanupFailureCode = codeFor(error); }
      report.cleanup = cleanup?.complete === true ? 'EXACT_FIXTURES_DELETED_AND_KNOWN_SESSIONS_DENIED' : 'EXACT_ID_RECONCILIATION_REQUIRED';
      // Snapshot is an explicit observation from the lifecycle, not inferred
      // from Auth deletion or the eventual rejection of an old bearer.
      try {
        const observed = lifecycle.snapshot();
        report.immediateLogoutFencingVerified = typeof observed.immediateLogoutFencingVerified === 'boolean'
          ? observed.immediateLogoutFencingVerified : null;
        report.atomicCleanupHelperVerified = observed.atomicCleanupHelperVerified === true;
      } catch { report.immediateLogoutFencingVerified = null; report.atomicCleanupHelperVerified = false; }
      if (report.immediateLogoutFencingVerified !== true)
        report.verificationGap = 'IMMEDIATE_LOGOUT_FENCING_NOT_VERIFIED_BEFORE_AUTH_DELETION';
      if (mode === 'upload-diagnostic' && cleanup?.complete === true && report.immediateLogoutFencingVerified !== true && !failure)
        failure = Object.assign(new Error('HOSTED_UPLOAD_LOGOUT_FENCE_UNVERIFIED'), { code: 'HOSTED_UPLOAD_LOGOUT_FENCE_UNVERIFIED' });
      if (cleanup?.complete !== true) {
        if (failure) report.originalFailureCode = codeFor(failure);
        failure = Object.assign(new Error('HOSTED_FIXTURE_CLEANUP_UNCONFIRMED'), { code: 'HOSTED_FIXTURE_CLEANUP_UNCONFIRMED' });
      } else if (!failure && report.immediateLogoutFencingVerified === true && !report.atomicCleanupHelperVerified) {
        // Event-free cleanup alone does not prove the service RPC can capture and
        // atomically delete its exact scope. Only the lifecycle's live probe does.
        failure = Object.assign(new Error('HOSTED_ATOMIC_CLEANUP_HELPER_UNVERIFIED'), { code: 'HOSTED_ATOMIC_CLEANUP_HELPER_UNVERIFIED' });
      }
    }
  }
  if (failure) {
    report.status = mode === 'upload-diagnostic' ? 'FAIL_HOSTED_UPLOAD_DIAGNOSTIC' : 'FAIL_HOSTED_REHEARSAL'; report.failureCode = codeFor(failure);
    if (report.deploymentState !== 'NOT_REQUESTED') {
      try {
        const actual = await capture({ token: env.CLOUDFLARE_API_TOKEN, accountId: env.CLOUDFLARE_ACCOUNT_ID, base: checked.base, fetcher });
        need(UUID.test(actual.state?.versionId || '') && HASH.test(actual.fingerprint || '') && hash(actual.state) === actual.fingerprint,
          'HOSTED_FAILURE_READBACK_INVALID');
        report.observedAfterFailure = { versionId: actual.state.versionId, fingerprint: actual.fingerprint };
      } catch { report.postFailureReadback = 'UNAVAILABLE'; }
    }
  }
  if (!failure) report.status = mode === 'prepare' ? 'PASS_HOSTED_FIXTURE_PREPARATION_ONLY'
    : mode === 'upload-diagnostic' ? 'PASS_HOSTED_UPLOAD_DIAGNOSTIC_ONLY' : 'PASS_HOSTED_ORGANIZER_CONTROL_ONLY';
  report.completedAt = instant(clock); await saveReport(report);
  if (failure) { const safe = new Error(report.failureCode); safe.code = report.failureCode; safe.reportPath = reportPath; throw safe; }
  return { status: report.status, mode, reportPath, manifestPath, outputDir, deploymentState: report.deploymentState,
    deployedVersionId: report.deployedVersionId || null, cleanupComplete: true, publicLaunch: false,
    immediateLogoutFencingVerified: report.immediateLogoutFencingVerified,
    atomicCleanupHelperVerified: report.atomicCleanupHelperVerified,
    physicalMedia: false, providerMedia: false, realMail: false, fullAcceptance: false };
}

async function main() {
  need(process.argv.length === 3 && ['prepare','run','upload-diagnostic'].includes(process.argv[2]), 'HOSTED_REHEARSAL_MODE');
  need(process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true' && process.env.DEBATE_HOSTED_REHEARSAL === '1'
    && process.env.GITHUB_REPOSITORY === 'codingwally/Bar-Exam-simulator' && process.env.GITHUB_ACTOR === 'codingwally'
    && process.env.GITHUB_TRIGGERING_ACTOR === 'codingwally', 'HOSTED_REHEARSAL_CI_REQUIRED');
  console.log(JSON.stringify(await runHostedDebateRehearsal({ mode: process.argv[2] })));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(codeFor(error)); process.exitCode = 1;
});

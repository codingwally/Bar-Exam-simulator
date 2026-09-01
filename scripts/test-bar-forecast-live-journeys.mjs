import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runnerPath = path.join(repositoryRoot, 'scripts', 'run-bar-forecast-live-journeys.mjs');
const runbookPath = path.join(repositoryRoot, 'docs', 'operations', 'bar-forecast-30-journey-live-test.md');
const [source, runbook] = await Promise.all([
  readFile(runnerPath, 'utf8'),
  readFile(runbookPath, 'utf8'),
]);

execFileSync(process.execPath, ['--check', runnerPath], { stdio: 'pipe' });

assert.match(source, /const JOURNEY_COUNT = 30;/u);
assert.match(source, /const BATCH_COUNT = 15;/u);
assert.match(source, /const BATCH_SIZE = 2;/u);
assert.match(source, /const DEFAULT_CONCURRENCY = 2;/u);
assert.match(source, /const MAX_CONCURRENCY = 2;/u);
assert.match(source, /const MINIMUM_BATCH_INTERVAL_MS = 180_000;/u);
assert.match(source, /const NETWORK_RATE_REQUEST_LIMIT = 180;/u);
assert.match(source, /const VERIFIED_USER_RATE_REQUEST_LIMIT = 30;/u);
assert.match(source, /const PLANNED_MAX_NETWORK_REQUESTS_PER_RATE_WINDOW/u);
assert.match(source, /const PLANNED_NETWORK_RATE_HEADROOM/u);
assert.match(source, /const PLANNED_MAX_VERIFIED_USER_REQUESTS_PER_RATE_WINDOW/u);
assert.match(source, /const PLANNED_VERIFIED_USER_RATE_HEADROOM/u);
assert.match(source, /--environment must be staging or production/u);
assert.match(source, /BAR_FORECAST_E2E_RELEASE_SHA must be a 40-hex commit SHA/u);
assert.match(source, /BAR_FORECAST_E2E_GITHUB_RUN_ID must be numeric/u);
assert.match(source, /A reviewed production approval reference is required/u);
assert.match(source, /SUPABASE_PRIVILEGED_KEY_PATTERN/u);
assert.match(source, /sb_secret_\[A-Za-z0-9_-\]\{20,/u);
assert.match(source, /\[A-Za-z0-9_-\]\{20,\}\\\.\[A-Za-z0-9_-\]\{20,/u);
assert.match(source, /apikey: config\.secretKey/u);
assert.match(source, /modernSecretKey = config\.secretKey\.startsWith\('sb_secret_'\)/u);
assert.match(source, /modernSecretKey \? \{\} : \{ Authorization: `Bearer \$\{config\.secretKey\}` \}/u);

assert.match(source, /role: 'admin'/u);
assert.doesNotMatch(source, /role: '(?:founder_admin|super_admin)'/u);
assert.match(source, /BAR_FORECAST_ACCESS_REQUIRED/u);
assert.match(source, /status: 403/u);
assert.match(source, /serviceRows\('subscriptions'/u);
assert.match(source, /serviceRows\('free_beta_access'/u);
assert.match(source, /subscriptions\.length, 0/u);
assert.match(source, /betaAccess\.length, 0/u);
assert.match(source, /BAR_FORECAST_CONSENT_REQUIRED/u);
assert.match(source, /status: 409/u);
assert.match(source, /signOut\(\{ scope: 'global' \}\)/u);
assert.match(source, /awaitInternalTestClassification/u);
assert.match(source, /FORECAST_E2E_CLASSIFICATION/u);
assert.match(source, /CONTINUE \$\{runId\}/u);
assert.match(source, /AbortSignal\.timeout\(10 \* 60_000\)/u);
assert.match(source, /DueDiligenceAuthSessionStorage\?\.prepare/u);
assert.match(source, /auth\/v1\/admin\/users/u);
assert.match(source, /dd2026_bar_forecast_consents/u);
assert.match(source, /user_roles/u);
assert.match(source, /cleanupDisposableAdministrator/u);
assert.match(source, /deleteAndVerifyDisposableUsage/u);
assert.match(source, /usageResidueVerified/u);
assert.match(source, /verifyDisposableSetupResidue/u);
assert.match(source, /setupResidueVerified/u);
for (const setupTable of [
  'profiles',
  'terms_acceptances',
  'introductory_token_grants',
  'introductory_token_ledger',
]) assert.ok(source.includes(setupTable), `Live cleanup must verify ${setupTable}.`);
assert.match(source, /diagnostic:\s*\{\s*stage: diagnosticStage,\s*cleanupFailed,/u);
assert.match(source, /const completedJourneys = \[\]/u);
assert.match(source, /journeysPassed: completedJourneys\.length/u);
assert.match(source, /journey: journeyFailureDiagnostic/u);
assert.match(source, /function safeForecastEvents\(events\)/u);
assert.match(source, /function safeForecastInterfaceState\(page\)/u);
assert.match(source, /inspectionAvailable: true/u);
assert.match(source, /inspectionAvailable: false/u);
assert.match(source, /page\.on\('requestfinished'/u);
assert.match(source, /event\.finished === true/u);
assert.match(source, /startShape: event\.startShape \|\| null/u);
assert.match(source, /failureKind: \['aborted', 'timed_out', 'network_error', 'other'\]/u);
assert.match(source, /consentButtonCount: consentButtons\.length/u);
assert.match(source, /consentButtonBusy: consentButton\?\.getAttribute\('aria-busy'\) === 'true'/u);
assert.match(source, /rootInert: root\?\.inert === true/u);
assert.match(source, /rootModalInert: root\?\.dataset\?\.ddModalInert === 'true'/u);
assert.match(source, /openBlockingSurfaceCount/u);
assert.match(source, /rootInert: null/u);
assert.match(source, /openBlockingSurfaceCount: null/u);
assert.match(source, /subjectMatches: payload\?\.subject === subject/u);
assert.match(source, /questionCount: questions\.length/u);
assert.match(source, /response\.request\(\)\.postDataJSON\(\)\?\.operation/u);
assert.match(source, /await startResponse\.finished\(\)/u);
assert.match(source, /startResponse\.status\(\), 200/u);
const safeInterfaceStart = source.indexOf('async function safeForecastInterfaceState');
const safeInterfaceEnd = source.indexOf('function timeoutSignal', safeInterfaceStart);
assert.ok(safeInterfaceStart >= 0 && safeInterfaceEnd > safeInterfaceStart);
assert.doesNotMatch(
  source.slice(safeInterfaceStart, safeInterfaceEnd),
  /textContent|innerText|innerHTML|prompt|answer|email|token/iu,
  'Failure diagnostics must not capture protected content or credentials.',
);
assert.match(source, /function phaseFailure\(error, phase\)/u);
assert.match(source, /FORECAST_E2E_\$\{safePhase\}/u);

const usageCleanupStart = source.indexOf('async function deleteAndVerifyDisposableUsage');
const accountCleanupStart = source.indexOf('async function cleanupDisposableAdministrator');
assert.ok(usageCleanupStart >= 0 && accountCleanupStart > usageCleanupStart);
const usageCleanup = source.slice(usageCleanupStart, accountCleanupStart);
assert.ok(
  usageCleanup.indexOf("['usage_events', 'usage_sessions']") >= 0,
  'Usage events must be deleted before their parent sessions.',
);
assert.match(usageCleanup, /user_id=eq\.\$\{encodeURIComponent\(account\.userId\)\}/u);
assert.match(usageCleanup, /select=id/u);
assert.match(usageCleanup, /assert\.equal\(rows\.length, 0/u);
assert.match(
  source,
  /complete: createdAccounts\.every\([\s\S]*?account\.deleted[\s\S]*?account\.usageResidueVerified[\s\S]*?account\.setupResidueVerified/,
);
const classificationStart = source.indexOf('async function awaitInternalTestClassification');
assert.ok(classificationStart >= 0 && classificationStart < usageCleanupStart);
const classificationFunction = source.slice(classificationStart, usageCleanupStart);
assert.match(classificationFunction, /accounts\.map\(\(\{ userId, kind \}\) => \(\{ userId, kind \}\)\)/u);
assert.match(classificationFunction, /accounts\.length, JOURNEY_COUNT \+ 1/u);
assert.doesNotMatch(classificationFunction, /account\.(?:email|password)|credentials/u);

assert.match(source, /chromium\.launch/u);
assert.match(source, /browser\.newContext/u);
assert.match(source, /#bar-forecast-2026/u);
assert.match(source, /forecast-e2e-auth=\$\{encodeURIComponent\(runId\)\}`/u);
const neutralNavigation = source.indexOf('forecast-e2e-auth=${encodeURIComponent(runId)}`');
const finalForecastNavigation = source.indexOf('forecast-e2e=${encodeURIComponent(runId)}#bar-forecast-2026`');
assert.ok(neutralNavigation >= 0 && finalForecastNavigation > neutralNavigation);
for (const phase of [
  'AUTH_SESSION_READY',
  'AUTH_FORECAST_VISIBLE',
  'AUTH_FORECAST_ACTIONABLE',
  'CONSENT_ACCEPT_ACTIONABLE',
  'CONSENT_ACCEPT_CLICK',
  'CONSENT_ACCEPT_RESPONSE',
  'CONSENT_PICKER_VISIBLE',
]) assert.ok(source.includes(phase), `Live harness must retain safe failure phase ${phase}.`);
assert.match(source, /\/beta\/access\/accept-terms/u);
assert.match(source, /complete_commercial_profile_onboarding_v2/u);
assert.match(source, /p_trial_acknowledged: true/u);
assert.match(source, /applicationSetupCompleted/u);
assert.match(source, /BAR_FORECAST_SETUP_REQUIRED/u);
assert.match(source, /SETUP_BOUNDARY_FAILED/u);
assert.match(source, /setupBoundaryVerified/u);
assert.match(source, /requiredSetupBoundaryAccounts/u);
assert.match(source, /forecast-setup-ready-\$\{crypto\.randomUUID\(\)\}/u);
assert.match(source, /readyResponse\.status === 200/u);
assert.match(source, /readyPayload\?\.authorized === true/u);
assert.match(source, /readyPayload\?\.consentAccepted === false/u);
assert.match(source, /postSetupStatusAccounts/u);
assert.match(source, /isSetupProbeRequestId\(request\.headers\(\)\['x-request-id'\]\)/u);
assert.match(source, /\^forecast-setup-\(\?:boundary\|ready\)-/u);
assert.match(source, /preparedAccess\?\.role === 'admin'/u);
assert.match(source, /preparedAccess\?\.allowed === true/u);
assert.match(source, /preparedAccess\?\.basis === 'introductory_tokens'/u);
assert.match(source, /preparedAccess\?\.accessMode === 'introductory'/u);
assert.match(source, /preparedAccess\?\.termsRequired === false/u);
assert.match(source, /preparedAccess\?\.profileCompleted === true/u);
assert.match(source, /preparedAccess\?\.tokenAcknowledgementRequired === false/u);
assert.match(source, /preparedAccess\?\.tokensRemaining === 5/u);
assert.match(source, /acceptancePayload\?\.ok !== true/u);
assert.match(source, /acceptance\?\.acceptedAt/u);
assert.match(source, /postSetupResponse/u);
assert.ok(
  (source.match(/signal: AbortSignal\.timeout\(30_000\)/gu) || []).length >= 3,
  'Every disposable setup fetch must have a browser-enforced timeout.',
);
assert.match(source, /profileRequest\.abortSignal\([\s\S]*AbortSignal\.timeout\(30_000\)/u);
assert.match(source, /consentActionability\.rootInert, false/u);
assert.match(source, /consentActionability\.openBlockingSurfaceCount/u);
assert.match(source, /consentActionability\.inspectionAvailable,[\s\S]*true/u);

function extractNamedFunction(functionSource, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`, 'u').exec(functionSource);
  assert.ok(match, `Missing function ${name}.`);
  const openingBrace = functionSource.indexOf('{', match.index);
  let depth = 0;
  for (let index = openingBrace; index < functionSource.length; index += 1) {
    if (functionSource[index] === '{') depth += 1;
    if (functionSource[index] === '}') depth -= 1;
    if (depth === 0) return functionSource.slice(match.index, index + 1);
  }
  throw new Error(`Unbalanced function ${name}.`);
}

const helperContext = vm.createContext({ assert });
for (const helperName of [
  'isSetupProbeRequestId',
  'isExpectedConsoleResourceError',
  'createBatchBarrier',
]) {
  vm.runInContext(extractNamedFunction(source, helperName), helperContext);
}
assert.equal(vm.runInContext("isSetupProbeRequestId('forecast-setup-boundary-fixture')", helperContext), true);
assert.equal(vm.runInContext("isSetupProbeRequestId('forecast-setup-ready-fixture')", helperContext), true);
assert.equal(vm.runInContext("isSetupProbeRequestId('ordinary-journey-request')", helperContext), false);
assert.equal(vm.runInContext(`isExpectedConsoleResourceError({
  type: () => 'error',
  text: () => 'Failed to load resource: the server responded with a status of 403 ()',
})`, helperContext), true);
assert.equal(vm.runInContext(`isExpectedConsoleResourceError({
  type: () => 'error',
  text: () => 'Application crashed while rendering results',
})`, helperContext), false);
const batchBarrier = vm.runInContext('createBatchBarrier(2)', helperContext);
let firstBatchParticipantReleased = false;
const firstBatchParticipant = batchBarrier.wait().then((startedAt) => {
  firstBatchParticipantReleased = true;
  return startedAt;
});
await Promise.resolve();
assert.equal(firstBatchParticipantReleased, false, 'A batch must not start with only one browser journey.');
const secondBatchParticipant = batchBarrier.wait();
const [firstBatchStartedAt, secondBatchStartedAt] = await Promise.all([
  firstBatchParticipant,
  secondBatchParticipant,
]);
assert.equal(firstBatchStartedAt, secondBatchStartedAt);
assert.equal(firstBatchParticipantReleased, true);

const failedInspectionContext = vm.createContext({
  unavailablePage: { evaluate: async () => { throw new Error('execution context unavailable'); } },
});
vm.runInContext(
  extractNamedFunction(source, 'safeForecastInterfaceState'),
  failedInspectionContext,
);
const failedInspection = await vm.runInContext(
  'safeForecastInterfaceState(unavailablePage)',
  failedInspectionContext,
);
assert.equal(failedInspection.inspectionAvailable, false);
assert.equal(failedInspection.rootInert, null);
assert.equal(failedInspection.openBlockingSurfaceCount, null);
assert.match(source, /postDataJSON\(\)\?\.operation \|\| ''\) === 'accept'/u);
assert.match(source, /await acceptResponseResult\.finished\(\)/u);
assert.match(source, /acceptResponseResult\.status\(\), 200/u);
assert.match(source, /journeyPhase = 'RESULTS'/u);
assert.match(source, /batchStartOffsetMs/u);
assert.match(source, /observedMinimumBatchIntervalMs/u);
assert.match(source, /createBatchBarrier\(BATCH_SIZE\)/u);
assert.match(source, /activeContextsAtStart,[\s\S]*BATCH_SIZE/u);
assert.match(source, /for \(let slot = 1; slot <= JOURNEY_COUNT; slot \+= 1\)/u);
assert.match(source, /administratorAccounts\.slice\(firstOrdinal - 1, firstOrdinal - 1 \+ BATCH_SIZE\)/u);
assert.match(source, /config\.batchIntervalMs - \(Date\.now\(\) - previousBatchStartedAt\)/u);
assert.match(source, /expectedConsoleErrors/u);
assert.match(source, /unexpectedConsoleErrors/u);
assert.match(source, /Failed to load resource:[\s\S]*status of \(\?:403\|409\)/u);
assert.match(source, /phaseFailure\(error, `JOURNEY_\$\{journeyPhase\}`\)/u);
assert.match(source, /\.bf26-agreement \.bf26-button--primary/u);
assert.match(source, /\[data-subject\]/u);
assert.match(source, /number <= 20/u);
assert.match(source, /answerWordCount\(answer\) >= 10/u);
assert.match(source, /\.bf26-flag-button/u);
assert.match(source, /Highlight selected question text yellow/u);
assert.match(source, /data-answer-command="bold"/u);
assert.match(source, /Submit all answers/u);
assert.match(source, /\.bf26-results/u);
assert.match(source, /Suggested answer/u);
assert.match(source, /Explanation/u);
assert.match(source, /Result \$\{index \+ 1\} mixed attempt markers/u);

for (const forbidden of [
  /page\.route\(/u,
  /context\.route\(/u,
  /route\.fulfill\(/u,
  /addInitScript\(/u,
  /recordVideo/u,
  /screenshot\(/u,
  /tracing\.start/u,
  /console\.log\(/u,
]) {
  assert.doesNotMatch(source, forbidden, `Live harness contains forbidden test or capture primitive: ${forbidden}`);
}
assert.match(source, /Failure detail is intentionally suppressed so protected Forecast content cannot enter logs/u);
assert.match(source, /secretsLogged: false/u);
assert.match(source, /main\(\)\.catch[\s\S]+process\.stdout\.write/u);

const baseEnvironment = {
  ...process.env,
  BAR_FORECAST_E2E_CONFIRM: 'staging:hlzqmreeoghbldnhlybr:30',
  BAR_FORECAST_E2E_RELEASE_SHA: '0123456789abcdef0123456789abcdef01234567',
  BAR_FORECAST_E2E_GITHUB_RUN_ID: '123456789',
};
const stagingPreflight = JSON.parse(execFileSync(
  process.execPath,
  [runnerPath, '--environment', 'staging', '--preflight'],
  { env: baseEnvironment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
));
assert.deepEqual({
  ok: stagingPreflight.ok,
  mode: stagingPreflight.mode,
  target: stagingPreflight.target,
  journeys: stagingPreflight.journeys,
  batches: stagingPreflight.batches,
  batchSize: stagingPreflight.batchSize,
  concurrency: stagingPreflight.concurrency,
  maximumConcurrency: stagingPreflight.maximumConcurrency,
  batchIntervalMs: stagingPreflight.batchIntervalMs,
  disposableAdministrators: stagingPreflight.disposableAdministrators,
  disposableNonAdministrators: stagingPreflight.disposableNonAdministrators,
  disposableAccountsTotal: stagingPreflight.disposableAccountsTotal,
  networkRequestLimit: stagingPreflight.networkRequestLimit,
  verifiedUserRequestLimit: stagingPreflight.verifiedUserRequestLimit,
  plannedMaxNetworkRequestsPerRateWindow: stagingPreflight.plannedMaxNetworkRequestsPerRateWindow,
  plannedNetworkRateHeadroom: stagingPreflight.plannedNetworkRateHeadroom,
  plannedMaxVerifiedUserRequestsPerRateWindow: stagingPreflight.plannedMaxVerifiedUserRequestsPerRateWindow,
  plannedVerifiedUserRateHeadroom: stagingPreflight.plannedVerifiedUserRateHeadroom,
  classificationCheckpoint: stagingPreflight.classificationCheckpoint,
  secretLoaded: stagingPreflight.secretLoaded,
}, {
  ok: true,
  mode: 'preflight',
  target: 'staging',
  journeys: 30,
  batches: 15,
  batchSize: 2,
  concurrency: 2,
  maximumConcurrency: 2,
  batchIntervalMs: 180_000,
  disposableAdministrators: 30,
  disposableNonAdministrators: 1,
  disposableAccountsTotal: 31,
  networkRequestLimit: 180,
  verifiedUserRequestLimit: 30,
  plannedMaxNetworkRequestsPerRateWindow: 81,
  plannedNetworkRateHeadroom: 99,
  plannedMaxVerifiedUserRequestsPerRateWindow: 10,
  plannedVerifiedUserRateHeadroom: 20,
  classificationCheckpoint: false,
  secretLoaded: false,
});

assert.throws(() => execFileSync(
  process.execPath,
  [runnerPath, '--environment', 'staging', '--preflight'],
  {
    env: { ...baseEnvironment, BAR_FORECAST_E2E_BATCH_INTERVAL_MS: '179999' },
    stdio: 'pipe',
  },
));
assert.throws(() => execFileSync(
  process.execPath,
  [runnerPath, '--environment', 'production', '--preflight'],
  {
    env: {
      ...baseEnvironment,
      BAR_FORECAST_E2E_CONFIRM: 'production:hbllomlijfznnuudpdvr:30',
      BAR_FORECAST_E2E_AWAIT_CLASSIFICATION: 'true',
      BAR_FORECAST_E2E_APPROVAL_REFERENCE: '',
    },
    stdio: 'pipe',
  },
));

const productionPreflight = JSON.parse(execFileSync(
  process.execPath,
  [runnerPath, '--environment', 'production', '--preflight'],
  {
    env: {
      ...baseEnvironment,
      BAR_FORECAST_E2E_CONFIRM: 'production:hbllomlijfznnuudpdvr:30',
      BAR_FORECAST_E2E_AWAIT_CLASSIFICATION: 'true',
      BAR_FORECAST_E2E_APPROVAL_REFERENCE: 'PR-286-release',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  },
));
assert.equal(productionPreflight.target, 'production');
assert.equal(productionPreflight.classificationCheckpoint, true);

assert.match(runbook, /exactly 30/u);
assert.match(runbook, /150 live grading calls/u);
assert.match(runbook, /30 distinct.*administrator/iu);
assert.match(runbook, /15 batches/iu);
assert.match(runbook, /exactly two.*browser/iu);
assert.match(runbook, /at least 180 seconds/u);
assert.match(runbook, /observed batch spacing/u);
assert.match(runbook, /81 requests.*network limit of 180/iu);
assert.match(runbook, /ten requests.*per-user limit of 30/iu);
assert.match(runbook, /99 requests of network headroom/iu);
assert.match(runbook, /20 requests of verified-user headroom/iu);
assert.match(runbook, /31.*accounts/iu);
assert.match(runbook, /BAR_FORECAST_E2E_RELEASE_SHA/u);
assert.match(runbook, /BAR_FORECAST_E2E_GITHUB_RUN_ID/u);
assert.match(runbook, /Do not paste.*secret/iu);
assert.match(runbook, /no protected question or answer text/iu);
assert.match(runbook, /manual cleanup/iu);
assert.match(runbook, /usage_events[\s\S]*usage_sessions[\s\S]*Auth users/iu);
assert.match(
  runbook,
  /profiles[\s\S]*terms_acceptances[\s\S]*introductory_token_grants[\s\S]*introductory_token_ledger/iu,
);
assert.match(runbook, /BAR_FORECAST_E2E_AWAIT_CLASSIFICATION/u);

process.stdout.write('Bar Forecast 30-journey live harness contract tests passed.\n');

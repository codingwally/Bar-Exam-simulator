import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runnerPath = path.join(repositoryRoot, 'scripts', 'run-bar-forecast-live-journeys.mjs');
const runbookPath = path.join(repositoryRoot, 'docs', 'operations', 'bar-forecast-30-journey-live-test.md');
const [source, runbook] = await Promise.all([
  readFile(runnerPath, 'utf8'),
  readFile(runbookPath, 'utf8'),
]);

execFileSync(process.execPath, ['--check', runnerPath], { stdio: 'pipe' });

assert.match(source, /const JOURNEY_COUNT = 30;/u);
assert.match(source, /const DEFAULT_CONCURRENCY = 2;/u);
assert.match(source, /const MAX_CONCURRENCY = 2;/u);
assert.match(source, /const MINIMUM_START_INTERVAL_MS = 45_000;/u);
assert.match(source, /--environment must be staging or production/u);
assert.match(source, /BAR_FORECAST_E2E_RELEASE_SHA must be a 40-hex commit SHA/u);
assert.match(source, /BAR_FORECAST_E2E_GITHUB_RUN_ID must be numeric/u);
assert.match(source, /A reviewed production approval reference is required/u);
assert.match(source, /SUPABASE_PRIVILEGED_KEY_PATTERN/u);
assert.match(source, /sb_secret_\[A-Za-z0-9_-\]\{20,/u);
assert.match(source, /\[A-Za-z0-9_-\]\{20,\}\\\.\[A-Za-z0-9_-\]\{20,/u);
assert.match(source, /apikey: config\.secretKey/u);
assert.match(source, /Authorization: `Bearer \$\{config\.secretKey\}`/u);

assert.match(source, /role: 'admin'/u);
assert.doesNotMatch(source, /role: '(?:founder_admin|super_admin)'/u);
assert.match(source, /BAR_FORECAST_ADMIN_FORBIDDEN/u);
assert.match(source, /status: 403/u);
assert.match(source, /BAR_FORECAST_CONSENT_REQUIRED/u);
assert.match(source, /status: 409/u);
assert.match(source, /signOut\(\{ scope: 'global' \}\)/u);
assert.match(source, /DueDiligenceAuthSessionStorage\?\.prepare/u);
assert.match(source, /auth\/v1\/admin\/users/u);
assert.match(source, /dd2026_bar_forecast_consents/u);
assert.match(source, /user_roles/u);
assert.match(source, /cleanupDisposableAdministrator/u);
assert.match(source, /deleteAndVerifyDisposableUsage/u);
assert.match(source, /usageResidueVerified/u);
assert.match(source, /diagnostic:\s*\{\s*stage: diagnosticStage,\s*cleanupFailed,/u);

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
  /complete: createdAccounts\.every\([\s\S]*?account\.deleted && account\.usageResidueVerified/,
);

assert.match(source, /chromium\.launch/u);
assert.match(source, /browser\.newContext/u);
assert.match(source, /I Understand & Agree/u);
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
  concurrency: stagingPreflight.concurrency,
  maximumConcurrency: stagingPreflight.maximumConcurrency,
  disposableAdministrators: stagingPreflight.disposableAdministrators,
  disposableNonAdministrators: stagingPreflight.disposableNonAdministrators,
  secretLoaded: stagingPreflight.secretLoaded,
}, {
  ok: true,
  mode: 'preflight',
  target: 'staging',
  journeys: 30,
  concurrency: 2,
  maximumConcurrency: 2,
  disposableAdministrators: 2,
  disposableNonAdministrators: 1,
  secretLoaded: false,
});

assert.throws(() => execFileSync(
  process.execPath,
  [runnerPath, '--environment', 'staging', '--preflight'],
  {
    env: { ...baseEnvironment, BAR_FORECAST_E2E_CONCURRENCY: '3' },
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
      BAR_FORECAST_E2E_APPROVAL_REFERENCE: '',
    },
    stdio: 'pipe',
  },
));

assert.match(runbook, /exactly 30/u);
assert.match(runbook, /150 live grading calls/u);
assert.match(runbook, /maximum concurrency is two/u);
assert.match(runbook, /BAR_FORECAST_E2E_RELEASE_SHA/u);
assert.match(runbook, /BAR_FORECAST_E2E_GITHUB_RUN_ID/u);
assert.match(runbook, /Do not paste.*secret/iu);
assert.match(runbook, /no protected question or answer text/iu);
assert.match(runbook, /manual cleanup/iu);
assert.match(runbook, /usage_events[\s\S]*usage_sessions[\s\S]*Auth users/iu);

process.stdout.write('Bar Forecast 30-journey live harness contract tests passed.\n');

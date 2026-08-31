import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifier = path.join(root, 'scripts', 'verify-bar-forecast-live-evidence.mjs');
const releaseSha = '0123456789abcdef0123456789abcdef01234567';
const githubRunId = '123456789';
const journey = (ordinal) => ({
  ordinal,
  subject: `Reviewed subject ${((ordinal - 1) % 6) + 1}`,
  passed: true,
  totalScore: 75,
  resultCount: 20,
  consentGate: true,
  flag: true,
  highlight: true,
  formatting: true,
  uniqueAttempt: true,
  apiOperations: ['status:200', 'start:409', 'accept:200', 'start:200', 'submit:200'],
  pageErrors: 0,
  consoleErrors: 0,
  durationMs: 1_000,
});
const proof = Object.fromEntries([
  'realForecastHttpJourneys',
  'consentGateRejections',
  'twentyAnswerSubmissions',
  'flags',
  'highlights',
  'editorFormatting',
  'totalGrades',
  'suggestedAnswerAndExplanationSets',
  'uniqueAttemptIsolation',
].map((key) => [key, 30]));
proof.nonAdministratorDenied = true;
const evidence = {
  ok: true,
  target: 'staging',
  releaseSha,
  githubRunId,
  runId: 'f30-contract-fixture',
  journeysRequested: 30,
  journeysPassed: 30,
  concurrency: 2,
  maximumActiveContexts: 2,
  startIntervalMs: 60_000,
  subjects: Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`Subject ${index + 1}`, 5])),
  proof,
  grades: { minimum: 75, maximum: 75, average: 75 },
  cleanup: {
    disposableAccountsCreated: 3,
    disposableAccountsDeleted: 3,
    usageResidueAccountsVerified: 3,
    disposableAdministratorsCreated: 2,
    disposableAdministratorsDeleted: 2,
    browserContextsOpen: 0,
    complete: true,
  },
  secretsLogged: false,
  journeys: Array.from({ length: 30 }, (_, index) => journey(index + 1)),
};

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'bar-forecast-live-evidence-'));
const evidenceFile = path.join(temporaryRoot, 'evidence.json');
const environment = {
  ...process.env,
  BAR_FORECAST_EVIDENCE_FILE: evidenceFile,
  BAR_FORECAST_EVIDENCE_TARGET: 'staging',
  BAR_FORECAST_EVIDENCE_RELEASE_SHA: releaseSha,
  BAR_FORECAST_EVIDENCE_GITHUB_RUN_ID: githubRunId,
};

try {
  await writeFile(evidenceFile, JSON.stringify(evidence), 'utf8');
  const output = execFileSync(process.execPath, [verifier], {
    cwd: root,
    env: environment,
    encoding: 'utf8',
  });
  assert.match(output, /Verified 30\/30 staging Forecast journeys/u);

  const duplicateStatusEvidence = structuredClone(evidence);
  duplicateStatusEvidence.journeys[0].apiOperations.splice(1, 0, 'status:200');
  await writeFile(evidenceFile, JSON.stringify(duplicateStatusEvidence), 'utf8');
  assert.match(execFileSync(process.execPath, [verifier], {
    cwd: root,
    env: environment,
    encoding: 'utf8',
  }), /Verified 30\/30 staging Forecast journeys/u);

  const extraRequestEvidence = structuredClone(evidence);
  extraRequestEvidence.journeys[0].apiOperations.push('status:200', 'status:200');
  await writeFile(evidenceFile, JSON.stringify(extraRequestEvidence), 'utf8');
  assert.throws(() => execFileSync(process.execPath, [verifier], {
    cwd: root,
    env: environment,
    stdio: 'pipe',
  }));

  await writeFile(evidenceFile, JSON.stringify({
    ...evidence,
    startIntervalMs: 59_999,
  }), 'utf8');
  assert.throws(() => execFileSync(process.execPath, [verifier], {
    cwd: root,
    env: environment,
    stdio: 'pipe',
  }));

  await writeFile(evidenceFile, JSON.stringify({
    ...evidence,
    journeysPassed: 29,
  }), 'utf8');
  assert.throws(() => execFileSync(process.execPath, [verifier], {
    cwd: root,
    env: environment,
    stdio: 'pipe',
  }));

  await writeFile(evidenceFile, JSON.stringify({
    ...evidence,
    cleanup: {
      ...evidence.cleanup,
      usageResidueAccountsVerified: 2,
    },
  }), 'utf8');
  assert.throws(() => execFileSync(process.execPath, [verifier], {
    cwd: root,
    env: environment,
    stdio: 'pipe',
  }));

  await writeFile(evidenceFile, JSON.stringify({
    ...evidence,
    token: 'protected-value',
  }), 'utf8');
  assert.throws(() => execFileSync(process.execPath, [verifier], {
    cwd: root,
    env: environment,
    stdio: 'pipe',
  }));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write('Bar Forecast live-evidence verifier tests passed.\n');

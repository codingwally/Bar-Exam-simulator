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
const journey = (ordinal) => {
  const batchNumber = Math.ceil(ordinal / 2);
  return {
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
    batchNumber,
    batchMember: ((ordinal - 1) % 2) + 1,
    batchStartOffsetMs: (batchNumber - 1) * 180_000,
    activeContextsAtStart: 2,
    pageErrors: 0,
    consoleErrors: 4,
    expectedConsoleErrors: 4,
    unexpectedConsoleErrors: 0,
    durationMs: 1_000,
  };
};
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
proof.distinctAdministratorIdentities = 30;
proof.oneJourneyAdministratorAccounts = 30;
proof.requiredSetupBoundaryAccounts = 30;
proof.postSetupStatusAccounts = 30;
proof.simultaneousBatches = 15;
proof.expectedConsoleErrors = 120;
proof.unexpectedConsoleErrors = 0;
const batches = Array.from({ length: 15 }, (_, index) => ({
  number: index + 1,
  startOffsetMs: index * 180_000,
  journeyOrdinals: [(index * 2) + 1, (index * 2) + 2],
  members: 2,
  activeContextsAtStart: 2,
}));
const evidence = {
  ok: true,
  target: 'staging',
  releaseSha,
  githubRunId,
  runId: 'f30-contract-fixture',
  journeysRequested: 30,
  journeysPassed: 30,
  batchesRequested: 15,
  batchesPassed: 15,
  batchSize: 2,
  concurrency: 2,
  maximumActiveContexts: 2,
  batchIntervalMs: 180_000,
  observedMinimumBatchIntervalMs: 180_000,
  rateLimitPlan: {
    windowMs: 600_000,
    requestLimit: 90,
    fixedForecastProbeRequests: 1,
    setupProbeRequestsPerJourney: 4,
    maximumJourneyRequests: 6,
    maximumBatchesPerWindow: 4,
    plannedMaximumRequestsPerWindow: 81,
    plannedHeadroom: 9,
    observedMaximumBatchesPerWindow: 4,
    observedMaximumRequestsPerWindow: 81,
    observedHeadroom: 9,
  },
  subjects: Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`Subject ${index + 1}`, 5])),
  proof,
  grades: { minimum: 75, maximum: 75, average: 75 },
  cleanup: {
    disposableAccountsCreated: 31,
    disposableAccountsDeleted: 31,
    usageResidueAccountsVerified: 31,
    setupResidueAccountsVerified: 31,
    disposableAdministratorsCreated: 30,
    disposableAdministratorsDeleted: 30,
    browserContextsOpen: 0,
    complete: true,
  },
  secretsLogged: false,
  batches,
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

  const outOfOrderEvidence = structuredClone(evidence);
  outOfOrderEvidence.journeys[0].apiOperations = [
    'status:200', 'accept:200', 'start:409', 'start:200', 'submit:200',
  ];
  await writeFile(evidenceFile, JSON.stringify(outOfOrderEvidence), 'utf8');
  assert.throws(() => execFileSync(process.execPath, [verifier], {
    cwd: root,
    env: environment,
    stdio: 'pipe',
  }));

  const earlyStartEvidence = structuredClone(evidence);
  earlyStartEvidence.journeys[2].batchStartOffsetMs = 179_999;
  earlyStartEvidence.journeys[3].batchStartOffsetMs = 179_999;
  earlyStartEvidence.batches[1].startOffsetMs = 179_999;
  earlyStartEvidence.observedMinimumBatchIntervalMs = 179_999;
  await writeFile(evidenceFile, JSON.stringify(earlyStartEvidence), 'utf8');
  assert.throws(() => execFileSync(process.execPath, [verifier], {
    cwd: root,
    env: environment,
    stdio: 'pipe',
  }));

  await writeFile(evidenceFile, JSON.stringify({
    ...evidence,
    proof: {
      ...evidence.proof,
      requiredSetupBoundaryAccounts: 29,
    },
  }), 'utf8');
  assert.throws(() => execFileSync(process.execPath, [verifier], {
    cwd: root,
    env: environment,
    stdio: 'pipe',
  }));

  await writeFile(evidenceFile, JSON.stringify({
    ...evidence,
    batchIntervalMs: 179_999,
  }), 'utf8');
  assert.throws(() => execFileSync(process.execPath, [verifier], {
    cwd: root,
    env: environment,
    stdio: 'pipe',
  }));

  await writeFile(evidenceFile, JSON.stringify({
    ...evidence,
    batchIntervalMs: 180_001,
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
      usageResidueAccountsVerified: 30,
    },
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
      setupResidueAccountsVerified: 30,
    },
  }), 'utf8');
  assert.throws(() => execFileSync(process.execPath, [verifier], {
    cwd: root,
    env: environment,
    stdio: 'pipe',
  }));

  const reusedIdentityEvidence = structuredClone(evidence);
  reusedIdentityEvidence.proof.distinctAdministratorIdentities = 29;
  await writeFile(evidenceFile, JSON.stringify(reusedIdentityEvidence), 'utf8');
  assert.throws(() => execFileSync(process.execPath, [verifier], {
    cwd: root,
    env: environment,
    stdio: 'pipe',
  }));

  const serializedBatchEvidence = structuredClone(evidence);
  serializedBatchEvidence.journeys[1].batchStartOffsetMs = 1;
  await writeFile(evidenceFile, JSON.stringify(serializedBatchEvidence), 'utf8');
  assert.throws(() => execFileSync(process.execPath, [verifier], {
    cwd: root,
    env: environment,
    stdio: 'pipe',
  }));

  const unexpectedConsoleEvidence = structuredClone(evidence);
  unexpectedConsoleEvidence.journeys[0].unexpectedConsoleErrors = 1;
  unexpectedConsoleEvidence.journeys[0].consoleErrors = 5;
  unexpectedConsoleEvidence.proof.unexpectedConsoleErrors = 1;
  await writeFile(evidenceFile, JSON.stringify(unexpectedConsoleEvidence), 'utf8');
  assert.throws(() => execFileSync(process.execPath, [verifier], {
    cwd: root,
    env: environment,
    stdio: 'pipe',
  }));

  const noRateHeadroomEvidence = structuredClone(evidence);
  noRateHeadroomEvidence.rateLimitPlan.plannedHeadroom = 0;
  await writeFile(evidenceFile, JSON.stringify(noRateHeadroomEvidence), 'utf8');
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

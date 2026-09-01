import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const evidenceFile = String(process.env.BAR_FORECAST_EVIDENCE_FILE || '').trim();
const expectedTarget = String(process.env.BAR_FORECAST_EVIDENCE_TARGET || '').trim();
const expectedReleaseSha = String(process.env.BAR_FORECAST_EVIDENCE_RELEASE_SHA || '').trim().toLowerCase();
const expectedGithubRunId = String(process.env.BAR_FORECAST_EVIDENCE_GITHUB_RUN_ID || '').trim();

assert.ok(evidenceFile, 'BAR_FORECAST_EVIDENCE_FILE is required.');
assert.match(expectedTarget, /^(?:staging|production)$/u, 'The evidence target must be staging or production.');
assert.match(expectedReleaseSha, /^[0-9a-f]{40}$/u, 'The expected release SHA must be exact lowercase 40-hex.');
assert.match(expectedGithubRunId, /^\d{1,20}$/u, 'The expected GitHub run id must be numeric.');

const rawEvidence = await readFile(evidenceFile, 'utf8');
assert.ok(rawEvidence.length > 0 && rawEvidence.length < 1_000_000, 'The live evidence file has an invalid size.');
assert.doesNotMatch(rawEvidence, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u, 'The evidence contains a JWT.');
assert.doesNotMatch(rawEvidence, /\bsb_secret_[A-Za-z0-9_-]{20,}\b/u, 'The evidence contains a Supabase secret key.');
assert.doesNotMatch(rawEvidence, /dd-forecast-e2e-[a-z0-9-]+@example\.com/iu, 'The evidence contains a disposable email address.');

const evidence = JSON.parse(rawEvidence);
assert.equal(evidence.ok, true);
assert.equal(evidence.target, expectedTarget);
assert.equal(evidence.releaseSha, expectedReleaseSha);
assert.equal(String(evidence.githubRunId), expectedGithubRunId);
assert.match(String(evidence.runId || ''), /^f30-[a-z0-9-]+$/u);
assert.equal(evidence.journeysRequested, 30);
assert.equal(evidence.journeysPassed, 30);
assert.equal(evidence.batchesRequested, 15);
assert.equal(evidence.batchesPassed, 15);
assert.equal(evidence.batchSize, 2);
assert.equal(evidence.concurrency, 2);
assert.equal(evidence.maximumActiveContexts, 2);
assert.equal(evidence.batchIntervalMs, 180_000);

const subjectCounts = Object.values(evidence.subjects || {});
assert.equal(subjectCounts.length, 6);
assert.deepEqual(subjectCounts, [5, 5, 5, 5, 5, 5]);

assert.equal(evidence.proof?.realForecastHttpJourneys, 30);
assert.equal(evidence.proof?.nonAdministratorDenied, true);
assert.equal(evidence.proof?.distinctAdministratorIdentities, 30);
assert.equal(evidence.proof?.oneJourneyAdministratorAccounts, 30);
assert.equal(evidence.proof?.requiredSetupBoundaryAccounts, 30);
assert.equal(evidence.proof?.postSetupStatusAccounts, 30);
assert.equal(evidence.proof?.simultaneousBatches, 15);
assert.ok(Number.isInteger(evidence.proof?.expectedConsoleErrors));
assert.ok(evidence.proof.expectedConsoleErrors >= 0);
assert.equal(evidence.proof?.unexpectedConsoleErrors, 0);
for (const field of [
  'consentGateRejections',
  'twentyAnswerSubmissions',
  'flags',
  'highlights',
  'editorFormatting',
  'totalGrades',
  'suggestedAnswerAndExplanationSets',
  'uniqueAttemptIsolation',
]) {
  assert.equal(evidence.proof?.[field], 30, `${field} must pass 30 of 30.`);
}

assert.ok(Number.isFinite(evidence.grades?.minimum) && evidence.grades.minimum >= 0);
assert.ok(Number.isFinite(evidence.grades?.maximum) && evidence.grades.maximum <= 100);
assert.ok(Number.isFinite(evidence.grades?.average));
assert.equal(evidence.cleanup?.disposableAccountsCreated, 31);
assert.equal(evidence.cleanup?.disposableAccountsDeleted, 31);
assert.equal(evidence.cleanup?.usageResidueAccountsVerified, 31);
assert.equal(evidence.cleanup?.setupResidueAccountsVerified, 31);
assert.equal(evidence.cleanup?.disposableAdministratorsCreated, 30);
assert.equal(evidence.cleanup?.disposableAdministratorsDeleted, 30);
assert.equal(evidence.cleanup?.browserContextsOpen, 0);
assert.equal(evidence.cleanup?.complete, true);
assert.equal(evidence.secretsLogged, false);

assert.ok(Array.isArray(evidence.journeys));
assert.equal(evidence.journeys.length, 30);
assert.deepEqual(evidence.journeys.map(({ ordinal }) => ordinal), Array.from({ length: 30 }, (_, index) => index + 1));

function assertForecastOperations(apiOperations) {
  assert.ok(Array.isArray(apiOperations), 'Journey API operations must be recorded from live traffic.');
  for (const [operation, count] of Object.entries({
    'accept:200': 1,
    'start:409': 1,
    'start:200': 1,
    'submit:200': 1,
  })) {
    assert.equal(
      apiOperations.filter((value) => value === operation).length,
      count,
      `Every journey must record exactly ${count} ${operation} request.`,
    );
  }
  const statusCount = apiOperations.filter((value) => value === 'status:200').length;
  assert.ok(
    statusCount === 1 || statusCount === 2,
    'Every journey must record one status request and at most one optional duplicate.',
  );
  assert.equal(
    apiOperations.length,
    4 + statusCount,
    'A journey recorded an unapproved or extra Forecast request.',
  );
  assert.deepEqual(apiOperations, [
    ...Array.from({ length: statusCount }, () => 'status:200'),
    'start:409',
    'accept:200',
    'start:200',
    'submit:200',
  ], 'A journey recorded Forecast operations out of the approved order.');
}

for (const journey of evidence.journeys) {
  assert.equal(journey.passed, true);
  assert.equal(journey.resultCount, 20);
  assert.equal(journey.consentGate, true);
  assert.equal(journey.flag, true);
  assert.equal(journey.highlight, true);
  assert.equal(journey.formatting, true);
  assert.equal(journey.uniqueAttempt, true);
  assert.equal(journey.pageErrors, 0);
  assert.ok(Number.isInteger(journey.consoleErrors) && journey.consoleErrors >= 0);
  assert.ok(Number.isInteger(journey.expectedConsoleErrors) && journey.expectedConsoleErrors >= 0);
  assert.equal(journey.unexpectedConsoleErrors, 0);
  assert.equal(journey.consoleErrors, journey.expectedConsoleErrors + journey.unexpectedConsoleErrors);
  assert.ok(Number.isFinite(journey.totalScore) && journey.totalScore >= 0 && journey.totalScore <= 100);
  assert.ok(Number.isInteger(journey.batchNumber) && journey.batchNumber >= 1 && journey.batchNumber <= 15);
  assert.ok(journey.batchMember === 1 || journey.batchMember === 2);
  assert.equal(journey.activeContextsAtStart, 2);
  assert.ok(Number.isInteger(journey.batchStartOffsetMs) && journey.batchStartOffsetMs >= 0);
  assertForecastOperations(journey.apiOperations);
}
assert.equal(
  evidence.proof.expectedConsoleErrors,
  evidence.journeys.reduce((total, journey) => total + journey.expectedConsoleErrors, 0),
  'The expected browser-console classification total does not match the journeys.',
);
assert.equal(
  evidence.proof.unexpectedConsoleErrors,
  evidence.journeys.reduce((total, journey) => total + journey.unexpectedConsoleErrors, 0),
  'The unexpected browser-console classification total does not match the journeys.',
);

assert.ok(Array.isArray(evidence.batches));
assert.equal(evidence.batches.length, 15);
const observedBatchStartOffsets = [];
for (let batchNumber = 1; batchNumber <= 15; batchNumber += 1) {
  const journeys = evidence.journeys.filter((journey) => journey.batchNumber === batchNumber);
  assert.equal(journeys.length, 2, `Batch ${batchNumber} must contain exactly two journeys.`);
  assert.deepEqual(journeys.map((journey) => journey.batchMember).sort(), [1, 2]);
  assert.deepEqual(
    journeys.map((journey) => journey.ordinal).sort((left, right) => left - right),
    [(batchNumber * 2) - 1, batchNumber * 2],
  );
  assert.equal(
    new Set(journeys.map((journey) => journey.batchStartOffsetMs)).size,
    1,
    `Batch ${batchNumber} journeys must share one simultaneous start.`,
  );
  const startOffsetMs = journeys[0].batchStartOffsetMs;
  observedBatchStartOffsets.push(startOffsetMs);
  assert.deepEqual(evidence.batches[batchNumber - 1], {
    number: batchNumber,
    startOffsetMs,
    journeyOrdinals: [(batchNumber * 2) - 1, batchNumber * 2],
    members: 2,
    activeContextsAtStart: 2,
  });
}
assert.equal(observedBatchStartOffsets[0], 0, 'Observed batch timing must begin at zero.');
assert.equal(new Set(observedBatchStartOffsets).size, 15, 'Every batch must have one distinct start.');
const observedBatchStartGaps = observedBatchStartOffsets.slice(1).map((offset, index) => (
  offset - observedBatchStartOffsets[index]
));
const observedMinimumBatchIntervalMs = Math.min(...observedBatchStartGaps);
assert.ok(
  observedMinimumBatchIntervalMs >= evidence.batchIntervalMs,
  'Observed live batches did not honor the configured spacing.',
);
assert.equal(
  evidence.observedMinimumBatchIntervalMs,
  observedMinimumBatchIntervalMs,
  'The observed batch-spacing summary does not match the journey evidence.',
);
const maximumBatchesPerTenMinutes = Math.max(...observedBatchStartOffsets.map((windowStart) => (
  observedBatchStartOffsets.filter((offset) => offset >= windowStart && offset < windowStart + 600_000).length
)));
assert.ok(maximumBatchesPerTenMinutes <= 4, 'Observed live batches exceeded the ten-minute rate plan.');

const rateLimitPlan = evidence.rateLimitPlan || {};
assert.equal(rateLimitPlan.windowMs, 600_000);
assert.equal(rateLimitPlan.networkRequestLimit, 180);
assert.equal(rateLimitPlan.verifiedUserRequestLimit, 30);
assert.equal(rateLimitPlan.fixedForecastProbeRequests, 1);
assert.equal(rateLimitPlan.setupProbeRequestsPerJourney, 4);
assert.equal(rateLimitPlan.maximumJourneyRequests, 6);
assert.equal(rateLimitPlan.maximumBatchesPerWindow, 4);
assert.equal(rateLimitPlan.plannedMaximumNetworkRequestsPerWindow, 81);
assert.equal(rateLimitPlan.plannedNetworkHeadroom, 99);
assert.equal(rateLimitPlan.plannedMaximumVerifiedUserRequestsPerWindow, 10);
assert.equal(rateLimitPlan.plannedVerifiedUserHeadroom, 20);
const observedMaximumNetworkRequestsPerWindow = 1
  + (maximumBatchesPerTenMinutes * 2 * (4 + 6));
const observedMaximumVerifiedUserRequestsPerWindow = Math.max(
  1,
  ...evidence.journeys.map((journey) => 4 + journey.apiOperations.length),
);
assert.equal(rateLimitPlan.observedMaximumBatchesPerWindow, maximumBatchesPerTenMinutes);
assert.equal(
  rateLimitPlan.observedMaximumNetworkRequestsPerWindow,
  observedMaximumNetworkRequestsPerWindow,
);
assert.equal(rateLimitPlan.observedNetworkHeadroom, 180 - observedMaximumNetworkRequestsPerWindow);
assert.ok(rateLimitPlan.observedNetworkHeadroom >= 99);
assert.equal(
  rateLimitPlan.observedMaximumVerifiedUserRequestsPerWindow,
  observedMaximumVerifiedUserRequestsPerWindow,
);
assert.equal(
  rateLimitPlan.observedVerifiedUserHeadroom,
  30 - observedMaximumVerifiedUserRequestsPerWindow,
);
assert.ok(rateLimitPlan.observedVerifiedUserHeadroom >= 20);

const forbiddenKeys = /^(?:question|prompt|answer|feedback|explanation|token|secret|password|email)(?:Text|Content|Value)?$/iu;
function inspectKeys(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectKeys(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    assert.doesNotMatch(key, forbiddenKeys, `Protected or sensitive evidence key found at ${path}.${key}.`);
    inspectKeys(entry, `${path}.${key}`);
  }
}
inspectKeys(evidence);

process.stdout.write(`Verified 30/30 ${expectedTarget} Forecast journeys for ${expectedReleaseSha}.\n`);

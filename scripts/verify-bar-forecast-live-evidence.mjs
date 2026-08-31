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
assert.equal(evidence.concurrency, 2);
assert.ok(Number.isInteger(evidence.maximumActiveContexts));
assert.ok(evidence.maximumActiveContexts >= 1 && evidence.maximumActiveContexts <= 2);
assert.ok(Number.isInteger(evidence.startIntervalMs) && evidence.startIntervalMs >= 45_000);

const subjectCounts = Object.values(evidence.subjects || {});
assert.equal(subjectCounts.length, 6);
assert.deepEqual(subjectCounts, [5, 5, 5, 5, 5, 5]);

assert.equal(evidence.proof?.realForecastHttpJourneys, 30);
assert.equal(evidence.proof?.nonAdministratorDenied, true);
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
assert.equal(evidence.cleanup?.disposableAccountsCreated, 3);
assert.equal(evidence.cleanup?.disposableAccountsDeleted, 3);
assert.equal(evidence.cleanup?.disposableAdministratorsCreated, 2);
assert.equal(evidence.cleanup?.disposableAdministratorsDeleted, 2);
assert.equal(evidence.cleanup?.browserContextsOpen, 0);
assert.equal(evidence.cleanup?.complete, true);
assert.equal(evidence.secretsLogged, false);

assert.ok(Array.isArray(evidence.journeys));
assert.equal(evidence.journeys.length, 30);
assert.deepEqual(evidence.journeys.map(({ ordinal }) => ordinal), Array.from({ length: 30 }, (_, index) => index + 1));
for (const journey of evidence.journeys) {
  assert.equal(journey.passed, true);
  assert.equal(journey.resultCount, 20);
  assert.equal(journey.consentGate, true);
  assert.equal(journey.flag, true);
  assert.equal(journey.highlight, true);
  assert.equal(journey.formatting, true);
  assert.equal(journey.uniqueAttempt, true);
  assert.equal(journey.pageErrors, 0);
  assert.ok(Number.isFinite(journey.totalScore) && journey.totalScore >= 0 && journey.totalScore <= 100);
  assert.deepEqual(journey.apiOperations, [
    'status:200',
    'start:409',
    'accept:200',
    'start:200',
    'submit:200',
  ]);
}

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

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calculateBenchmarkMetrics,
  resolveSyntheticAnswer,
  runBenchmark,
} from './run-private-beta-grading-benchmark.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const benchmark = JSON.parse(fs.readFileSync(
  path.join(root, 'docs', 'qa', '20260731-cycle-1', 'grading-benchmark-v1.json'),
  'utf8',
));
const bankPayload = JSON.parse(fs.readFileSync(
  path.join(root, 'content', 'question-bank', 'website-upload.json'),
  'utf8',
));
const bank = Array.isArray(bankPayload) ? bankPayload : bankPayload.records;
const rows = new Map(bank.map((row) => [row['Question ID'], row]));

assert.equal(benchmark.samples.length, 24);
assert.equal(new Set(benchmark.questions.map((question) => question.subject)).size, 8);
for (const sample of benchmark.samples) {
  const answer = resolveSyntheticAnswer(sample, rows.get(sample.questionId));
  assert.equal(typeof answer, 'string');
  if (sample.qualityBand !== 'blank-or-non-responsive') assert.ok(answer.trim().length > 0, sample.sampleId);
}

const syntheticResults = benchmark.samples.map((sample, index) => ({
  sampleId: sample.sampleId,
  subject: benchmark.questions.find((question) => question.questionId === sample.questionId).subject,
  expectedScore: sample.expectedScore,
  actualScore: sample.expectedScore,
  repeatScoreDelta: 0,
  executionPath: sample.answerTemplate ? 'gemini' : 'deterministic-prefilter',
  defectChecks: sample.expectedDefects.map(() => ({ detected: true })),
  legalBasisAccurate: true,
  citationValid: true,
  unsupportedAuthorityDetected: sample.sampleId === 'COMM-FALSE-CITATION' ? true : null,
  fabricatedAuthority: false,
}));
const sourceChecks = benchmark.questions.map((question) => ({ url: question.primarySourceUrl, passed: true }));
const requestRuns = syntheticResults
  .filter((result) => result.executionPath === 'gemini')
  .flatMap((result) => [1, 2].map((runIndex) => ({ sampleId: result.sampleId, runIndex, ok: true, latencyMs: 100 })));
const metrics = calculateBenchmarkMetrics(syntheticResults, sourceChecks, requestRuns);
assert.equal(metrics.passed, true);
assert.equal(metrics.metrics.agreementWithin0_5, 1);
assert.equal(metrics.metrics.falseHighRate, 0);
assert.equal(metrics.metrics.unsafeFalseHighRate, 0);
assert.equal(metrics.metrics.fabricatedAuthorityRate, 0);

const unsafeResults = syntheticResults.map((result) => ({ ...result }));
unsafeResults.find((result) => result.sampleId === 'LAB-WRONG-RULE').actualScore = 3;
const unsafeMetrics = calculateBenchmarkMetrics(unsafeResults, sourceChecks, requestRuns);
assert.ok(unsafeMetrics.metrics.falseHighRate > 0);
assert.ok(unsafeMetrics.metrics.unsafeFalseHighRate > 0);
assert.equal(unsafeMetrics.gates.noUnsafeFalseHighs, false);

const mock = await runBenchmark({ mockMode: true, repeatRuns: 2, concurrency: 2 });
assert.equal(mock.mode, 'mock-contract-test');
assert.equal(mock.metrics.sampleSize, 24);
assert.equal(mock.metrics.subjects, 8);
assert.equal(mock.metrics.requestFailures, 0);
assert.equal(mock.credentialsLoggedOrPersisted, false);
assert.equal(mock.memberGradingCreditsConsumed, 0);
assert.equal(JSON.stringify(mock).includes('GEMINI_API_KEY'), false);

console.log('Private-beta grading benchmark harness passed.');

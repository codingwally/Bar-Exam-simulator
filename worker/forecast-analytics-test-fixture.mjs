// Synthetic grades only, using the current curated question projection. No SQL,
// model, network, or customer answers. Never a runtime/browser bundle input.
import { createHash } from 'node:crypto';
import { curatedFixture } from './forecast-result-layout-fixture.mjs';
export const OWNER = '11111111-1111-4111-8111-111111111111';
export const OTHER = '22222222-2222-4222-8222-222222222222';
export const SCOPE_ID = '44444444-4444-4444-8444-444444444444';
export async function analyticsFixture(count = 1) {
  const base = await curatedFixture();
  const attempts = Array.from({ length: count }, (_, index) => {
    const saved = structuredClone(base);
    saved.id = `33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}`;
    saved.clientAttemptId = `55555555-5555-4555-8555-${String(index + 1).padStart(12, '0')}`;
    saved.acceptedAt = '2026-09-07T15:08:45.000Z';
    saved.updatedAt = saved.completedAt; saved.questionCount = 20; saved.completedQuestionCount = 20;
    saved.result.attemptId = saved.id;
    return saved;
  });
  const manifest = attempts.map(saved => ({ attemptId: saved.id, resultRevision: saved.resultRevision,
    // Deliberately a fixture hash; actual PostgreSQL JSONB hashing is tested by
    // the separate real-SQL suite, never inferred from this JavaScript encoding.
    resultHash: createHash('sha256').update(JSON.stringify(saved.result)).digest('hex'),
    subject: saved.subject, acceptedAt: saved.acceptedAt, completedAt: saved.completedAt,
    summary: { totalScore: saved.result.totalScore, maxScore: 100, percentage: saved.result.percentage } }));
  const scope = { id: SCOPE_ID, ownerId: OWNER, schemaVersion: 'forecast-analytics-scope-v1',
    templateVersion: 'forecast-analytics-pdf-v1', createdAt: '2026-09-08T00:00:00.000Z', scopeHash: 'a'.repeat(64),
    filter: { subject: null, from: null, to: null, completeOnly: true, timeZone: 'Asia/Manila' }, manifest,
    analytics: { completeOnly: true, completedAttempts: count, pendingAttempts: 0, failedAttempts: 0,
      averagePercentage: 0, averageGrammarScore: 4.7, averageIssueSpottingScore: 0,
      bySubject: [{ subject: base.subject, completedAttempts: count, averagePercentage: 0,
        averageGrammarScore: 4.7, averageIssueSpottingScore: 0 }], trend: [], byUnit: [], byTopic: [],
      classificationCoverage: { unitUnknownQuestions: count * 20, topicUnknownQuestions: count * 20 } } };
  return { scope, attempts };
}

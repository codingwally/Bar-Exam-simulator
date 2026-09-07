// Explicit in-memory fixture for isolated route/provider tests. Real SQL lifecycle
// coverage lives in forecast-attempt-store.test.mjs and durable API tests.
import { completeBarForecastResult, BarForecastError } from '../worker/bar-forecast-core.mjs';

export function createForecastMemoryStoreForTest() {
  const attempts = new Map();
  const owned = (ownerId, id) => {
    const value = attempts.get(id);
    if (!value || value.ownerId !== ownerId) throw new BarForecastError('BAR_FORECAST_ATTEMPT_NOT_FOUND', 'Unavailable', 404);
    return value;
  };
  const dto = (value) => ({ id: value.id, clientAttemptId: value.clientAttemptId,
    subject: value.subject, setId: value.setId, status: value.status,
    answers: value.rows.map((row) => ({ questionId: row.id, answer: row.userAnswer })),
    result: value.result || null });
  return {
    async getByClient(_env, ownerId, clientId) {
      const value = [...attempts.values()].find((row) => row.ownerId === ownerId && row.clientAttemptId === clientId);
      return value ? { ok: true, attempt: dto(value) } : null;
    },
    async accept(_env, input) {
      const value = { ...input, id: crypto.randomUUID(), rows: input.rowsWithAnswers, batches: [], status: 'pending' };
      attempts.set(value.id, value);
      return { ok: true, attempt: dto(value) };
    },
    async getOwned(_env, ownerId, id) { return { ok: true, attempt: dto(owned(ownerId, id)) }; },
    async claim(_env, { attemptId }) {
      const value = attempts.get(attemptId);
      if (!value || value.status === 'complete' || value.status === 'failed') return { ok: true, claimed: false };
      if (value.batches.length === 5) return { ok: true, claimed: false, readyToFinalize: true, attemptId };
      value.status = 'processing';
      return { ok: true, claimed: true, attemptId, batchIndex: value.batches.length,
        leaseToken: crypto.randomUUID(), rows: value.rows.slice(value.batches.length * 4, value.batches.length * 4 + 4) };
    },
    async checkpoint(_env, claim, result) {
      const value = attempts.get(claim.attemptId);
      value.batches.push(result);
      return { ok: true, readyToFinalize: value.batches.length === 5 };
    },
    async finalize(_env, id) {
      const value = attempts.get(id);
      value.result = completeBarForecastResult(value.rows, value.batches);
      value.status = 'complete';
      return { ok: true, attempt: dto(value) };
    },
    async fail(_env, claim) { attempts.get(claim.attemptId).status = 'failed'; return { ok: true }; },
  };
}

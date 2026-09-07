import {
  BAR_FORECAST_CONSENT_VERSION,
  BAR_FORECAST_SOURCE_VERSION,
  BarForecastError,
  completeBarForecastResult,
  forecastSetId,
  normalizeBarForecastRequest,
  validateBarForecastGradingResult,
} from './bar-forecast-core.mjs';

export const FORECAST_ATTEMPT_SCHEMA_VERSION = 'forecast-attempt-v1';
export const FORECAST_RUBRIC_VERSION = 'forecast-holistic-2026-09-01';
export const FORECAST_ATTEMPT_POLICY = Object.freeze({
  leaseSeconds: 600,
  automaticExecutionsPerBatch: 4,
  manualRetries: 2,
  activeAttemptsPerOwner: 3,
  activeAttemptsGlobal: 250,
  activeProviderBatchesGlobal: 1,
  retryDelaysSeconds: Object.freeze([30, 120, 300]),
});

export const FORECAST_ATTEMPT_RPC_NAMES = Object.freeze([
  'dd2026_forecast_attempt_accept', 'dd2026_forecast_attempt_get',
  'dd2026_forecast_attempt_history', 'dd2026_forecast_attempt_claim',
  'dd2026_forecast_attempt_checkpoint', 'dd2026_forecast_attempt_fail',
  'dd2026_forecast_attempt_internal', 'dd2026_forecast_attempt_finalize',
  'dd2026_forecast_attempt_finalization_error',
  'dd2026_forecast_attempt_retry',
  'dd2026_forecast_browser_pdf_prepared',
]);

function uuid(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new BarForecastError('BAR_FORECAST_ATTEMPT_INVALID', `A valid ${label} is required.`, 400);
  }
  return value.toLowerCase();
}

function checked(value) {
  if (value?.ok === false) {
    const code = String(value.error?.code || 'BAR_FORECAST_PERSISTENCE_UNAVAILABLE');
    const status = Number(value.error?.status) || 503;
    throw new BarForecastError(code, String(value.error?.message || 'Your saved Forecast could not be updated. Please try again.'), status);
  }
  if (!value || typeof value !== 'object') {
    throw new BarForecastError('BAR_FORECAST_PERSISTENCE_UNAVAILABLE', 'Your saved Forecast could not be retrieved. Please try again.', 503);
  }
  return value;
}

// Only the authenticated Worker may call this store. ownerId must come from its
// verified user, never from the request body. Private snapshots never leave claim
// or internal RPCs; getOwned/history use explicit SQL student projections.
export function createForecastAttemptStore({ rpc }) {
  if (typeof rpc !== 'function') throw new TypeError('Forecast persistence requires an RPC dependency.');
  const call = async (env, name, args) => {
    try { return checked(await rpc(env, name, args)); }
    catch (error) {
      if (error instanceof BarForecastError) throw error;
      throw new BarForecastError('BAR_FORECAST_PERSISTENCE_UNAVAILABLE', 'Your saved Forecast is temporarily unavailable. Please try again.', 503);
    }
  };

  async function accept(env, { ownerId, clientAttemptId, subject, setId, rowsWithAnswers }) {
    const userId = uuid(ownerId, 'owner');
    const clientId = uuid(clientAttemptId, 'attempt identity');
    if (!Array.isArray(rowsWithAnswers) || rowsWithAnswers.length !== 20) {
      throw new BarForecastError('BAR_FORECAST_ANSWERS_INCOMPLETE', 'All 20 answers must be saved together.', 400);
    }
    const input = normalizeBarForecastRequest({
      operation: 'submit', subject, setId,
      answers: rowsWithAnswers.map((row) => ({ questionId: row.id, answer: row.userAnswer })),
    });
    if (await forecastSetId(rowsWithAnswers) !== input.setId) {
      throw new BarForecastError('BAR_FORECAST_SET_CHANGED', 'The Forecast snapshot could not be verified.', 409);
    }
    const ordered = [...rowsWithAnswers].sort((left, right) => left.number - right.number);
    if (ordered.some((row, index) => row.number !== index + 1 || row.subject !== subject)
        || new Set(ordered.map((row) => row.id)).size !== 20) {
      throw new BarForecastError('BAR_FORECAST_ANSWER_SET_INVALID', 'The saved questions must match the complete Forecast set.', 400);
    }
    const answers = new Map(input.answers.map((answer) => [answer.questionId, answer.answer]));
    const snapshot = {
      schemaVersion: FORECAST_ATTEMPT_SCHEMA_VERSION,
      contentVersion: BAR_FORECAST_SOURCE_VERSION,
      rubricVersion: FORECAST_RUBRIC_VERSION,
      consentVersion: BAR_FORECAST_CONSENT_VERSION,
      subject, setId,
      rows: ordered.map((row) => ({
        id: row.id, number: row.number, subject: row.subject, title: row.title,
        checksum: row.checksum, payloadCanonical: row.payloadCanonical,
        prompt: row.prompt, suggestedAnswer: row.suggestedAnswer,
        legalBasis: row.legalBasis, controllingDoctrine: row.controllingDoctrine,
        jurisprudence: row.jurisprudence, citation: row.citation,
        userAnswer: answers.get(row.id),
      })),
    };
    return call(env, 'dd2026_forecast_attempt_accept', {
      p_actor_user_id: userId, p_client_attempt_id: clientId, p_snapshot: snapshot,
    });
  }

  async function getOwned(env, ownerId, attemptId) {
    return call(env, 'dd2026_forecast_attempt_get', {
      p_actor_user_id: uuid(ownerId, 'owner'), p_attempt_id: uuid(attemptId, 'attempt identity'),
    });
  }

  async function getByClient(env, ownerId, clientAttemptId) {
    try {
      return await call(env, 'dd2026_forecast_attempt_get', {
        p_actor_user_id: uuid(ownerId, 'owner'), p_attempt_id: null,
        p_client_attempt_id: uuid(clientAttemptId, 'attempt identity'),
      });
    } catch (error) {
      if (error?.code === 'BAR_FORECAST_ATTEMPT_NOT_FOUND') return null;
      throw error;
    }
  }

  async function history(env, ownerId, { limit = 20, before = null, subject = null, completeOnly = false, from = null, to = null } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new BarForecastError('BAR_FORECAST_HISTORY_INVALID', 'Choose a history page size between 1 and 100.', 400);
    }
    return call(env, 'dd2026_forecast_attempt_history', {
      p_actor_user_id: uuid(ownerId, 'owner'), p_limit: limit,
      p_before: before && typeof before === 'object' ? before.acceptedAt : before,
      p_before_id: before && typeof before === 'object' ? uuid(before.id, 'history cursor') : null,
      p_subject: subject, p_complete_only: completeOnly === true, p_from: from, p_to: to,
    });
  }

  async function claim(env, { attemptId = null } = {}) {
    return call(env, 'dd2026_forecast_attempt_claim', {
      p_attempt_id: attemptId === null ? null : uuid(attemptId, 'attempt identity'),
    });
  }

  async function checkpoint(env, claimed, evaluation) {
    if (!claimed?.claimed || !Array.isArray(claimed.rows) || claimed.rows.length !== 4) {
      throw new BarForecastError('BAR_FORECAST_LEASE_INVALID', 'A current processing claim is required.', 409);
    }
    const result = validateBarForecastGradingResult(evaluation, claimed.rows);
    return call(env, 'dd2026_forecast_attempt_checkpoint', {
      p_attempt_id: uuid(claimed.attemptId, 'attempt identity'),
      p_batch_index: claimed.batchIndex,
      p_lease_token: uuid(claimed.leaseToken, 'processing claim'),
      p_result: result,
    });
  }

  async function fail(env, claimed, error) {
    const code = String(error?.code || 'BAR_FORECAST_PROCESSING_FAILED').toUpperCase().replace(/[^A-Z0-9_]/gu, '_').slice(0, 80);
    const retryable = /(?:CAPACITY|TIMEOUT|UNAVAILABLE|PERSISTENCE|NETWORK|FETCH|PROCESSING_FAILED)/u.test(code);
    return call(env, 'dd2026_forecast_attempt_fail', {
      p_attempt_id: uuid(claimed.attemptId, 'attempt identity'),
      p_batch_index: claimed.batchIndex,
      p_lease_token: uuid(claimed.leaseToken, 'processing claim'),
      p_error_code: code, p_retryable: retryable,
      p_outcome_uncertain: /(?:TIMEOUT|NETWORK|FETCH|PERSISTENCE)/u.test(code),
    });
  }

  async function finalize(env, attemptId) {
    const id = uuid(attemptId, 'attempt identity');
    const saved = await call(env, 'dd2026_forecast_attempt_internal', { p_attempt_id: id });
    if (saved.status === 'complete') return saved.publicAttempt;
    if (saved.status === 'failed') {
      throw new BarForecastError('BAR_FORECAST_GRADING_INVALID', 'Your answers remain saved. Use the available manual retry or contact support.', 502);
    }
    if (!Array.isArray(saved.batches) || saved.batches.length !== 5
        || saved.batches.some((batch, index) => batch.batchIndex !== index || batch.status !== 'complete')) {
      throw new BarForecastError('BAR_FORECAST_RESULT_INCOMPLETE', 'The saved assessment is still being completed.', 409);
    }
    // Only deterministic, local assembly is inside this catch. A transport or
    // uncertain commit must remain recoverable, never become a terminal grade.
    let result;
    try {
      const rows = saved.snapshot.rows;
      const batches = saved.batches.map((batch, index) => validateBarForecastGradingResult(
        batch.result, rows.slice(index * 4, index * 4 + 4),
      ));
      const graded = completeBarForecastResult(rows, batches);
      result = {
        schemaVersion: FORECAST_ATTEMPT_SCHEMA_VERSION,
        rubricVersion: saved.snapshot.rubricVersion,
        contentVersion: saved.snapshot.contentVersion,
        attemptId: id, ownerId: saved.ownerId, resultRevision: 1,
        subject: saved.snapshot.subject, setId: saved.snapshot.setId,
        acceptedAt: saved.acceptedAt,
        complete: true, completedQuestionCount: 20, questionCount: 20,
        ...graded,
        percentage: graded.totalScore,
        summary: {
          totalScore: graded.totalScore, maxScore: graded.maxScore,
          percentage: graded.totalScore,
          completedQuestionCount: 20, questionCount: 20,
        },
        results: graded.results.map((entry, index) => ({
          ...entry, question: rows[index].prompt,
          legalBasis: rows[index].legalBasis, jurisprudence: rows[index].jurisprudence,
          citation: rows[index].citation,
        })),
      };
    } catch {
      // This fixed-code service-only journal retains all five checkpoints.
      // It also returns a completed winner if another finalizer already won.
      return call(env, 'dd2026_forecast_attempt_finalization_error', { p_attempt_id: id });
    }
    return call(env, 'dd2026_forecast_attempt_finalize', { p_attempt_id: id, p_result: result });
  }

  async function retry(env, ownerId, attemptId) {
    return call(env, 'dd2026_forecast_attempt_retry', {
      p_actor_user_id: uuid(ownerId, 'owner'), p_attempt_id: uuid(attemptId, 'attempt identity'),
    });
  }

  async function noteBrowserPdfPrepared(env, ownerId, input) {
    const note = normalizeBarForecastRequest({ ...input, operation: 'result_pdf_prepared' });
    return call(env, 'dd2026_forecast_browser_pdf_prepared', {
      p_actor_user_id: uuid(ownerId, 'owner'), p_attempt_id: note.attemptId,
      p_result_revision: note.resultRevision, p_pdf_version: note.pdfVersion,
      p_byte_count: note.byteCount, p_page_count: note.pageCount,
    });
  }

  return Object.freeze({ accept, getOwned, getByClient, history, claim, checkpoint, fail, finalize, retry, noteBrowserPdfPrepared });
}

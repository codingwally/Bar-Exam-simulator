import {
  BAR_FORECAST_CONSENT_VERSION,
  BAR_FORECAST_CONTENT_TYPE,
  BAR_FORECAST_APPROVED_SET_IDS,
  BAR_FORECAST_GRADING_RESPONSE_SCHEMA,
  BAR_FORECAST_LIMITS,
  BAR_FORECAST_OFFICIAL_SCHEDULE,
  BAR_FORECAST_SOURCE_VERSION,
  BarForecastError,
  answersForForecastRows,
  buildBarForecastGradingPrompt,
  forecastSetId,
  normalizeBarForecastRequest,
  publicForecastQuestions,
  barForecastEntitlementEvidence,
  requireBarForecastAccess,
  validateBarForecastGradingResult,
  validatedForecastRows,
} from './bar-forecast-core.mjs';
import { createForecastAttemptStore } from './forecast-attempt-store.mjs';
import { createForecastResultExporter } from './forecast-result-export.mjs';
import { createForecastAnalyticsExporter } from './forecast-analytics-export.mjs';

export async function legacyForecastAttemptId(ownerId, input) {
  const answers = [...input.answers].map((row) => ({ questionId: row.questionId.toLowerCase(), answer: row.answer }))
    .sort((left, right) => left.questionId.localeCompare(right.questionId));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([
    'duediligence/forecast-legacy-submit/v1', ownerId, input.subject, input.setId, answers,
  ]))));
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = [...digest.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assertSameAcceptedSubmission(attempt, input) {
  const answers = new Map((attempt.answers || []).map((row) => [row.questionId.toLowerCase(), row.answer]));
  if (attempt.subject !== input.subject || attempt.setId !== input.setId || answers.size !== 20
      || input.answers.some((row) => answers.get(row.questionId.toLowerCase()) !== row.answer)) {
    throw new BarForecastError('BAR_FORECAST_ATTEMPT_CONFLICT', 'This submission was already accepted with different answers. Open its saved report.', 409);
  }
}

function legacyResult(attempt) {
  const result = attempt.result;
  return {
    ok: true, authorized: true, consentAccepted: true, subject: attempt.subject,
    attemptId: attempt.id, totalScore: result.totalScore, maxScore: result.maxScore,
    analytics: result.analytics,
    results: result.results.map((row) => ({
      questionId: row.questionId, number: row.number, score: row.score, maxScore: row.maxScore,
      feedback: row.feedback, userAnswer: row.userAnswer, suggestedAnswer: row.suggestedAnswer,
      explanation: row.explanation, mockBarCoaching: row.mockBarCoaching,
      grammar: row.grammar, issueSpotting: row.issueSpotting,
    })),
  };
}

function savedProcessingFailure(error) {
  if (error instanceof BarForecastError) return error;
  return new BarForecastError('BAR_FORECAST_PROCESSING_FAILED', 'Your answers are saved. Assessment will resume when the service is available.', 503);
}

function privateJson(jsonResponse, body, status, origin, allowedOrigin) {
  const response = jsonResponse(body, status, origin, allowedOrigin);
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('Pragma', 'no-cache');
  return response;
}

function acceptedConsent(value) {
  return value?.consentAccepted === true || value?.consent_accepted === true || value === true;
}

function setupExempt(access, authorization) {
  const role = String(authorization?.role || access?.role || '').trim().toLowerCase();
  const basis = String(access?.basis || '').trim().toLowerCase();
  return ['super_admin', 'founder_admin'].includes(role)
    || ['super_admin', 'founder_admin', 'founding_beta'].includes(basis)
    || access?.freeBeta?.active === true;
}

function requiredSetupPending(access, authorization) {
  if (!access || typeof access !== 'object') return true;
  // These four values are the actual setup contract. Payment-policy wrappers
  // may omit derived fields such as paidSubscriptionExpired, so basis remains
  // the authoritative fallback for that independent payment state.
  for (const field of [
    'termsRequired',
    'reauthenticationRequired',
    'profileCompleted',
    'tokenAcknowledgementRequired',
  ]) {
    if (typeof access[field] !== 'boolean') return true;
  }
  if (!String(access.role || '').trim() || !String(access.basis || '').trim()) return true;
  const basis = String(access.basis || '').trim().toLowerCase();
  if (access.termsRequired === true || basis === 'legal_acceptance_required') return true;
  if (setupExempt(access, authorization)) return false;
  if (access.reauthenticationRequired === true || basis === 'reauthentication_required') return true;
  const paidSubscriptionExpired = access.paidSubscriptionExpired === true
    || basis === 'paid_subscription_expired';
  if (paidSubscriptionExpired) return false;
  return basis === 'profile_required'
    || access.tokenAcknowledgementRequired === true
    || access.profileCompleted === false;
}

export const BAR_FORECAST_GRADING_PROVIDER_OPTIONS = Object.freeze({
  quiet: true,
  requestTimeoutMs: 45_000,
  preferredModel: 'gemini-3.6-flash',
  fallbackModels: Object.freeze(['gemini-3.5-flash-lite']),
  temperature: 0,
  modelLimit: 2,
  attemptsPerModel: 1,
});

function barForecastGradingProviderOptions(env) {
  const configuredModel = typeof env?.BAR_FORECAST_MODEL === 'string'
    ? env.BAR_FORECAST_MODEL.trim()
    : '';
  if (!configuredModel) return BAR_FORECAST_GRADING_PROVIDER_OPTIONS;
  return Object.freeze({
    ...BAR_FORECAST_GRADING_PROVIDER_OPTIONS,
    preferredModel: configuredModel,
  });
}

// Five simultaneous Gemini calls exceeded the real staging project's grading
// capacity. Keep one provider request in flight so a completed 20-answer exam
// can progress through every existing four-question grading batch reliably.
export const BAR_FORECAST_GRADING_CONCURRENCY = 1;
export const BAR_FORECAST_CAPACITY_RETRY_DELAYS_MS = Object.freeze([
  5_000,
  20_000,
  45_000,
]);

function forecastGradingProviderError(error) {
  const code = String(error?.code || '').trim().toUpperCase();
  if (code === 'COACH_TIMEOUT') {
    return new BarForecastError(
      'BAR_FORECAST_GRADING_TIMEOUT',
      'Forecast grading took too long to respond. Your answers remain available; please try submitting again.',
      503,
    );
  }
  if (code === 'COACH_CAPACITY') {
    return new BarForecastError(
      'BAR_FORECAST_GRADING_CAPACITY',
      'Forecast grading has reached temporary capacity. Your answers remain available; please try again shortly.',
      503,
    );
  }
  if (['COACH_NOT_CONFIGURED', 'COACH_UNAVAILABLE'].includes(code)) {
    return new BarForecastError(
      'BAR_FORECAST_GRADING_UNAVAILABLE',
      'Forecast grading is temporarily unavailable. Your answers remain available; please try again shortly.',
      503,
    );
  }
  return error;
}

function capacityError(error) {
  return String(error?.code || '').trim().toUpperCase() === 'COACH_CAPACITY';
}

function defaultWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createBarForecastHandlers(deps) {
  const {
    authorizeAdministrator,
    barForecastRpc,
    enforceBarForecastRateLimit,
    jsonResponse,
    parseBoundedJson,
    requiredSetupAccess,
    requireAuthenticatedUser,
    structuredGemini,
    approvedSetIds = BAR_FORECAST_APPROVED_SET_IDS,
    wait = defaultWait,
  } = deps;
  const attemptStore = deps.attemptStore || createForecastAttemptStore({ rpc: barForecastRpc });
  const resultExporter = deps.resultExporter || createForecastResultExporter({
    attemptStore, rpc: barForecastRpc, sendEmail: deps.sendForecastResultEmail, resolveVerifiedUser: deps.resolveForecastEmailUser,
    assertEmailAvailable: deps.assertForecastResultEmailAvailable,
  });
  const analyticsExporter = deps.analyticsExporter || createForecastAnalyticsExporter({
    rpc: barForecastRpc, sendEmail: deps.sendForecastResultEmail, resolveVerifiedUser: deps.resolveForecastEmailUser,
    assertEmailAvailable: deps.assertForecastResultEmailAvailable,
  });

  async function authorizedContext(request, env) {
    await enforceBarForecastRateLimit(request, env);
    const user = await requireAuthenticatedUser(request, env);
    let input;
    try {
      input = normalizeBarForecastRequest(
        await parseBoundedJson(request, BAR_FORECAST_LIMITS.requestBytes),
      );
    } catch (error) {
      // Invalid/oversized authenticated payloads retain the original owner write
      // budget; malformed requests must not gain the higher polling allowance.
      await enforceBarForecastRateLimit(request, env, user);
      throw error;
    }
    await enforceBarForecastRateLimit(request, env, user, input.operation);
    const [administrator, setupAccess] = await Promise.all([
      authorizeAdministrator(env, user),
      requiredSetupAccess(env, user),
    ]);
    const context = { administrator, access: setupAccess };
    const entitlement = barForecastEntitlementEvidence(context);
    if (!entitlement) {
      throw new BarForecastError(
        'BAR_FORECAST_ACCESS_REQUIRED',
        'Bar Forecast access requires an active paid subscription, Founding Beta access, or an authorized administrator account.',
        403,
      );
    }
    if (requiredSetupPending(setupAccess, entitlement)) {
      throw new BarForecastError(
        'BAR_FORECAST_SETUP_REQUIRED',
        'Complete the required account setup before opening Bar Forecast.',
        403,
      );
    }
    const authorization = requireBarForecastAccess(context);
    return { user, authorization, input };
  }

  async function consentStatus(env, userId) {
    const result = await barForecastRpc(env, 'dd2026_bar_forecast_consent_status', {
      p_actor_user_id: userId,
      p_consent_version: BAR_FORECAST_CONSENT_VERSION,
    });
    return acceptedConsent(result);
  }

  async function requireConsent(env, userId) {
    if (!await consentStatus(env, userId)) {
      throw new BarForecastError(
        'BAR_FORECAST_CONSENT_REQUIRED',
        'Accept the current Forecast consent before starting or submitting.',
        409,
      );
    }
  }

  async function subjectRows(env, userId, subject) {
    const result = await barForecastRpc(env, 'dd2026_bar_forecast_admin_list', {
      p_actor_user_id: userId,
      p_subject: subject,
      p_consent_version: BAR_FORECAST_CONSENT_VERSION,
    });
    return validatedForecastRows(result, subject);
  }

  async function gradeForecastBatch(env, batch) {
    for (let attempt = 0; attempt <= BAR_FORECAST_CAPACITY_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const evaluation = await structuredGemini(
          env,
          buildBarForecastGradingPrompt(batch),
          BAR_FORECAST_GRADING_RESPONSE_SCHEMA,
          (value) => validateBarForecastGradingResult(value, batch),
          barForecastGradingProviderOptions(env),
        );
        return evaluation.result;
      } catch (error) {
        const retryDelay = BAR_FORECAST_CAPACITY_RETRY_DELAYS_MS[attempt];
        if (!capacityError(error) || retryDelay == null) {
          throw forecastGradingProviderError(error);
        }
        await wait(retryDelay);
      }
    }
    throw new BarForecastError(
      'BAR_FORECAST_GRADING_CAPACITY',
      'Forecast grading has reached temporary capacity. Your answers remain available; please try again shortly.',
      503,
    );
  }

  // The scheduler owns durable work; returning 202 never relies on waitUntil
  // outliving an HTTP connection. Every claim is persisted and fenced in SQL.
  async function drain(env, { maxBatches = 1, attemptId = null, throwOnFailure = false } = {}) {
    if (!Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > 5) {
      throw new BarForecastError('BAR_FORECAST_DRAIN_INVALID', 'The processing budget is invalid.', 500);
    }
    const summary = { claimed: 0, checkpointed: 0, completed: 0, failed: 0, errors: [] };
    for (let index = 0; index < maxBatches; index += 1) {
      const claim = await attemptStore.claim(env, { attemptId });
      if (claim.readyToFinalize) {
        try { await attemptStore.finalize(env, claim.attemptId); summary.completed += 1; }
        catch (error) {
          const safe = savedProcessingFailure(error);
          summary.failed += 1; summary.errors.push(safe.code);
          if (throwOnFailure) throw safe;
        }
        break;
      }
      if (!claim.claimed) break;
      summary.claimed += 1;
      try {
        const result = await gradeForecastBatch(env, claim.rows);
        let checkpoint;
        try { checkpoint = await attemptStore.checkpoint(env, claim, result); }
        catch (error) {
          if (['BAR_FORECAST_GRADING_INVALID', 'BAR_FORECAST_LEASE_LOST'].includes(error?.code)) throw error;
          // A transport failure may occur after SQL committed. Retry the same
          // checkpoint once, never the provider, to resolve that uncertainty.
          checkpoint = await attemptStore.checkpoint(env, claim, result);
        }
        summary.checkpointed += 1;
        if (checkpoint.readyToFinalize) {
          await attemptStore.finalize(env, claim.attemptId);
          summary.completed += 1;
        }
      } catch (error) {
        const safe = savedProcessingFailure(error);
        summary.failed += 1; summary.errors.push(safe.code);
        try { await attemptStore.fail(env, claim, safe); }
        catch (persistenceError) {
          // If the checkpoint already committed or another lease now owns the
          // batch, no failure may overwrite it. Other outages leave the lease
          // recoverable by the next scheduled drain after its bounded expiry.
          if (persistenceError?.code !== 'BAR_FORECAST_LEASE_LOST') {
            summary.errors.push('BAR_FORECAST_PERSISTENCE_UNAVAILABLE');
          }
        }
        if (throwOnFailure) throw safe;
        break;
      }
    }
    return summary;
  }

  async function handle(request, env, origin, allowedOrigin) {
    const { user, input } = await authorizedContext(request, env);

    if (input.operation === 'status') {
      return privateJson(jsonResponse, {
        ok: true,
        authorized: true,
        consentAccepted: await consentStatus(env, user.id),
      }, 200, origin, allowedOrigin);
    }

    if (input.operation === 'accept') {
      const result = await barForecastRpc(env, 'dd2026_bar_forecast_accept_consent', {
        p_actor_user_id: user.id,
        p_consent_version: input.version,
      });
      if (!acceptedConsent(result)) {
        throw new BarForecastError(
          'BAR_FORECAST_CONSENT_NOT_RECORDED',
          'The Forecast consent could not be recorded.',
          503,
        );
      }
      return privateJson(jsonResponse, {
        ok: true,
        authorized: true,
        consentAccepted: true,
      }, 200, origin, allowedOrigin);
    }

    await requireConsent(env, user.id);
    if (input.operation === 'analytics_snapshot') {
      return privateJson(jsonResponse, await analyticsExporter.snapshot(env, user, input), 200, origin, allowedOrigin);
    }
    if (input.operation === 'analytics_report') {
      return privateJson(jsonResponse, await analyticsExporter.get(env, user, input.scopeId), 200, origin, allowedOrigin);
    }
    if (input.operation === 'analytics_attempt') {
      return privateJson(jsonResponse, await analyticsExporter.attempt(env, user, input.scopeId, input.attemptId), 200, origin, allowedOrigin);
    }
    if (input.operation === 'analytics_pdf_prepared') {
      return privateJson(jsonResponse, await analyticsExporter.prepared(env, user, input), 200, origin, allowedOrigin);
    }
    if (input.operation === 'analytics_email') {
      return privateJson(jsonResponse, await analyticsExporter.email(env, user, input.scopeId), 200, origin, allowedOrigin);
    }
    if (input.operation === 'result_pdf_prepared') {
      // Optional client observation only. It never renders, stores, hashes,
      // emails, or certifies a PDF, and is not a prerequisite for a download.
      const note = await attemptStore.noteBrowserPdfPrepared(env, user.id, input);
      return privateJson(jsonResponse, note, 200, origin, allowedOrigin);
    }
    if (input.operation === 'result_pdf') {
      const exported = await resultExporter.pdf(env, user, input.attemptId);
      const response = privateJson(jsonResponse, {}, 200, origin, allowedOrigin);
      response.headers.set('Content-Type', 'application/pdf');
      response.headers.set('Content-Disposition', `attachment; filename="${exported.fileName}"`);
      response.headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(exported.bytes, { status: 200, headers: response.headers });
    }
    if (input.operation === 'email_result') {
      return privateJson(jsonResponse, await resultExporter.email(env, user, input.attemptId), 200, origin, allowedOrigin);
    }
    if (input.operation === 'attempt') {
      const saved = await attemptStore.getOwned(env, user.id, input.attemptId);
      return privateJson(jsonResponse, { ...saved, authorized: true, consentAccepted: true }, 200, origin, allowedOrigin);
    }
    if (input.operation === 'history') {
      const history = await attemptStore.history(env, user.id, input);
      return privateJson(jsonResponse, { ...history, authorized: true, consentAccepted: true }, 200, origin, allowedOrigin);
    }
    if (input.operation === 'retry_attempt') {
      const saved = await attemptStore.retry(env, user.id, input.attemptId);
      return privateJson(jsonResponse, { ...saved, authorized: true, consentAccepted: true }, 202, origin, allowedOrigin);
    }
    const submitting = input.operation === 'submit' || input.operation === 'submit_attempt';
    const clientAttemptId = submitting
      ? input.clientAttemptId || await legacyForecastAttemptId(user.id, input) : null;
    let accepted = submitting ? await attemptStore.getByClient(env, user.id, clientAttemptId) : null;
    if (accepted) assertSameAcceptedSubmission(accepted.attempt, input);
    // Accepted snapshots remain readable and resumable after publication changes.
    // Only new acceptance consults the current content manifest.
    if (!accepted) {
      const rows = await subjectRows(env, user.id, input.subject);
      const setId = await forecastSetId(rows);
      if (approvedSetIds[input.subject] !== setId) {
        throw new BarForecastError(
          'BAR_FORECAST_CONTENT_MANIFEST_MISMATCH',
          'The selected Forecast content does not match the independently approved question manifest.',
          503,
        );
      }
      if (input.operation === 'start') {
        return privateJson(jsonResponse, {
          ok: true,
          authorized: true,
          consentAccepted: true,
          subject: input.subject,
          sourceVersion: BAR_FORECAST_SOURCE_VERSION,
          contentType: BAR_FORECAST_CONTENT_TYPE,
          setId,
          schedule: BAR_FORECAST_OFFICIAL_SCHEDULE,
          questions: publicForecastQuestions(rows),
        }, 200, origin, allowedOrigin);
      }

      if (input.setId !== setId) {
        throw new BarForecastError(
          'BAR_FORECAST_SET_CHANGED',
          'This Forecast question set changed after it was opened. Restart the subject before submitting.',
          409,
        );
      }

      accepted = await attemptStore.accept(env, {
        ownerId: user.id, clientAttemptId, subject: input.subject, setId,
        rowsWithAnswers: answersForForecastRows(input.answers, rows),
      });
    }
    if (input.operation === 'submit_attempt') {
      return privateJson(jsonResponse, { ...accepted, authorized: true, consentAccepted: true }, 202, origin, allowedOrigin);
    }
    if (accepted.attempt.status !== 'complete') {
      await drain(env, { maxBatches: 5, attemptId: accepted.attempt.id, throwOnFailure: true });
      accepted = await attemptStore.getOwned(env, user.id, accepted.attempt.id);
    }
    if (accepted.attempt.status !== 'complete') {
      throw new BarForecastError('BAR_FORECAST_PROCESSING_PENDING', 'Your answers are saved and assessment is still in progress. Open the saved Forecast to check its progress.', 503);
    }
    return privateJson(jsonResponse, legacyResult(accepted.attempt), 200, origin, allowedOrigin);
  }

  return Object.freeze({ handle, drain });
}

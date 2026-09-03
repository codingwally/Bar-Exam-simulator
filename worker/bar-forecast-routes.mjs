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
  completeBarForecastResult,
  forecastSetId,
  forecastGradingBatches,
  normalizeBarForecastRequest,
  publicForecastQuestions,
  barForecastEntitlementEvidence,
  requireBarForecastAccess,
  validateBarForecastGradingResult,
  validatedForecastRows,
} from './bar-forecast-core.mjs';

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

  async function authorizedContext(request, env) {
    await enforceBarForecastRateLimit(request, env);
    const user = await requireAuthenticatedUser(request, env);
    await enforceBarForecastRateLimit(request, env, user);
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
    return { user, authorization };
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

  async function gradeForecast(env, rowsWithAnswers) {
    const batches = forecastGradingBatches(rowsWithAnswers);
    const graded = [];
    for (const batch of batches) {
      graded.push(await gradeForecastBatch(env, batch));
    }
    return completeBarForecastResult(rowsWithAnswers, graded);
  }

  async function handle(request, env, origin, allowedOrigin) {
    const { user } = await authorizedContext(request, env);
    const input = normalizeBarForecastRequest(
      await parseBoundedJson(request, BAR_FORECAST_LIMITS.requestBytes),
    );

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

    const rowsWithAnswers = answersForForecastRows(input.answers, rows);
    const result = await gradeForecast(env, rowsWithAnswers);
    return privateJson(jsonResponse, {
      ok: true,
      authorized: true,
      consentAccepted: true,
      subject: input.subject,
      totalScore: result.totalScore,
      maxScore: result.maxScore,
      analytics: result.analytics,
      results: result.results,
    }, 200, origin, allowedOrigin);
  }

  return Object.freeze({ handle });
}

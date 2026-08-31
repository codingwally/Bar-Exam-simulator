import {
  BAR_FORECAST_CONSENT_VERSION,
  BAR_FORECAST_GRADING_RESPONSE_SCHEMA,
  BAR_FORECAST_LIMITS,
  BAR_FORECAST_OFFICIAL_SCHEDULE,
  BarForecastError,
  answersForForecastRows,
  buildBarForecastGradingPrompt,
  completeBarForecastResult,
  forecastGradingBatches,
  normalizeBarForecastRequest,
  publicForecastQuestions,
  requireBarForecastAdministrator,
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

export function createBarForecastHandlers(deps) {
  const {
    authorizeAdministrator,
    barForecastRpc,
    enforceAdminRateLimit,
    jsonResponse,
    parseBoundedJson,
    requireAdministrator,
    structuredGemini,
  } = deps;

  async function authorizedContext(request, env) {
    await enforceAdminRateLimit(request, env);
    const user = await requireAdministrator(request, env);
    const authorization = requireBarForecastAdministrator(
      await authorizeAdministrator(env, user),
    );
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

  async function gradeForecast(env, rowsWithAnswers) {
    const graded = [];
    for (const batch of forecastGradingBatches(rowsWithAnswers)) {
      const evaluation = await structuredGemini(
        env,
        buildBarForecastGradingPrompt(batch),
        BAR_FORECAST_GRADING_RESPONSE_SCHEMA,
        (value) => validateBarForecastGradingResult(value, batch),
        { quiet: true },
      );
      graded.push(evaluation.result);
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
    if (input.operation === 'start') {
      return privateJson(jsonResponse, {
        ok: true,
        authorized: true,
        consentAccepted: true,
        subject: input.subject,
        schedule: BAR_FORECAST_OFFICIAL_SCHEDULE,
        questions: publicForecastQuestions(rows),
      }, 200, origin, allowedOrigin);
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
      results: result.results,
    }, 200, origin, allowedOrigin);
  }

  return Object.freeze({ handle });
}

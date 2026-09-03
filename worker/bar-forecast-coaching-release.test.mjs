import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BAR_FORECAST_CONTENT_TYPE,
  BAR_FORECAST_SOURCE_VERSION,
  BAR_FORECAST_SUBJECTS,
  forecastSetId,
  validatedForecastRows,
} from './bar-forecast-core.mjs';
import {
  BAR_FORECAST_CAPACITY_RETRY_DELAYS_MS,
  BAR_FORECAST_GRADING_CONCURRENCY,
  createBarForecastHandlers,
} from './bar-forecast-routes.mjs';

const SUBJECT = BAR_FORECAST_SUBJECTS[0];

function items() {
  return Array.from({ length: 20 }, (_, index) => {
    const number = index + 1;
    return {
      id: `coaching-release-${number}`,
      contentType: BAR_FORECAST_CONTENT_TYPE,
      subject: SUBJECT,
      title: `POL-${String(number).padStart(2, '0')} — Coaching release ${number}`,
      version: BAR_FORECAST_SOURCE_VERSION,
      checksum: number.toString(16).padStart(64, '0'),
      payload: {
        id: `coaching-release-${number}`,
        subject: SUBJECT,
        version: BAR_FORECAST_SOURCE_VERSION,
        editorial_ref: `POL-${String(number).padStart(2, '0')}`,
        title: `Coaching release ${number}`,
        rank_within_subject: number,
        prompt: `May the requested relief be granted under the single doctrine in coaching release question ${number}?`,
        suggested_answer: `Answer: Yes. Suggested answer ${number} applies the curated doctrine to every stated fact.`,
        legal_basis: `Legal basis ${number} supplies the controlling doctrine and all conditions needed for the assessment.`,
        controlling_doctrine: `Controlling doctrine ${number} is the exclusive rule for this Forecast question.`,
        jurisprudence: `Official Case ${number}`,
        citation: `G.R. No. 30${number}, January 1, 2025`,
      },
    };
  });
}

function answers() {
  return Array.from({ length: 20 }, (_, index) => ({
    questionId: `coaching-release-${index + 1}`,
    answer: `Yes. Answer ${index + 1} states the controlling rule, applies every material fact, and reaches a supported conclusion.`,
  }));
}

const SET_ID = await forecastSetId(validatedForecastRows(items(), SUBJECT));

function request(body) {
  return new Request('https://api.example.test/admin/dd2026/bar-forecast', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function recordsFromPrompt(prompt) {
  const marker = 'CURATED FORECAST RECORDS AND UNTRUSTED ANSWERS\n';
  const start = prompt.indexOf(marker);
  assert.notEqual(start, -1);
  const jsonStart = start + marker.length;
  const jsonEnd = prompt.indexOf('\n\nReturn only the requested JSON object.', jsonStart);
  assert.notEqual(jsonEnd, -1);
  return JSON.parse(prompt.slice(jsonStart, jsonEnd));
}

function successfulProviderResult(prompt, validate) {
  const records = recordsFromPrompt(prompt);
  return {
    result: validate({
      results: records.map((row) => ({
        questionId: row.questionId,
        score: 4,
        grammar: {
          score: 4,
          corrections: [],
        },
        issueSpotting: {
          score: 4,
          identified: [],
          missed: [],
        },
      })),
    }),
  };
}

function capacityFailure() {
  const error = new Error('Temporary provider capacity.');
  error.code = 'COACH_CAPACITY';
  return error;
}

function handlerDeps({ structuredGemini, wait = async () => {} }) {
  return {
    authorizeAdministrator: async () => ({ authorized: true, role: 'super_admin' }),
    barForecastRpc: async (_env, functionName) => {
      if (functionName === 'dd2026_bar_forecast_consent_status') {
        return { consentAccepted: true };
      }
      if (functionName === 'dd2026_bar_forecast_admin_list') {
        return { items: items(), total: 20 };
      }
      throw new Error(`Unexpected RPC ${functionName}`);
    },
    enforceBarForecastRateLimit: async () => {},
    jsonResponse: (body, status) => Response.json(body, { status }),
    parseBoundedJson: async (incoming) => incoming.json(),
    requiredSetupAccess: async () => ({
      allowed: true,
      unlimited: true,
      role: 'super_admin',
      basis: 'super_admin',
      termsRequired: false,
      reauthenticationRequired: false,
      profileCompleted: true,
      tokenAcknowledgementRequired: false,
      paidSubscriptionExpired: false,
      commercialLaunchEnabled: true,
    }),
    requireAuthenticatedUser: async () => ({ id: 'test-admin-user' }),
    approvedSetIds: { [SUBJECT]: SET_ID },
    structuredGemini,
    wait,
  };
}

function submit(handlers) {
  return handlers.handle(request({
    operation: 'submit',
    subject: SUBJECT,
    setId: SET_ID,
    answers: answers(),
  }), {}, '', '');
}

function assertCompleteCoaching(body) {
  assert.equal(body.totalScore, 80);
  assert.equal(body.maxScore, 100);
  assert.equal(body.results.length, 20);
  assert.deepEqual(
    body.results.map((entry) => entry.number),
    Array.from({ length: 20 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    body.results.map((entry) => entry.userAnswer),
    answers().map((entry) => entry.answer),
  );
}

test('20-answer coaching release grades all five batches serially and returns every result in order', async () => {
  assert.equal(BAR_FORECAST_GRADING_CONCURRENCY, 1);

  let providerCalls = 0;
  let inFlight = 0;
  let maximumInFlight = 0;
  const handlers = createBarForecastHandlers(handlerDeps({
    structuredGemini: async (_env, prompt, _schema, validate) => {
      providerCalls += 1;
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      try {
        await Promise.resolve();
        return successfulProviderResult(prompt, validate);
      } finally {
        inFlight -= 1;
      }
    },
  }));

  const response = await submit(handlers);
  assert.equal(response.status, 200);
  assert.equal(providerCalls, 5);
  assert.equal(maximumInFlight, 1);
  assertCompleteCoaching(await response.json());
});

test('temporary provider capacity retries the same batch with bounded backoff and still releases 20 results', async () => {
  assert.deepEqual(BAR_FORECAST_CAPACITY_RETRY_DELAYS_MS, [5_000, 20_000, 45_000]);

  let providerCalls = 0;
  const observedDelays = [];
  const handlers = createBarForecastHandlers(handlerDeps({
    structuredGemini: async (_env, prompt, _schema, validate) => {
      providerCalls += 1;
      if (providerCalls <= 2) throw capacityFailure();
      return successfulProviderResult(prompt, validate);
    },
    wait: async (milliseconds) => {
      observedDelays.push(milliseconds);
    },
  }));

  const response = await submit(handlers);
  assert.equal(response.status, 200);
  assert.equal(providerCalls, 7);
  assert.deepEqual(observedDelays, [5_000, 20_000]);
  assertCompleteCoaching(await response.json());
});

test('persistent provider capacity stops after the bounded retry schedule', async () => {
  let providerCalls = 0;
  const observedDelays = [];
  const handlers = createBarForecastHandlers(handlerDeps({
    structuredGemini: async () => {
      providerCalls += 1;
      throw capacityFailure();
    },
    wait: async (milliseconds) => {
      observedDelays.push(milliseconds);
    },
  }));

  await assert.rejects(
    submit(handlers),
    (error) => error?.code === 'BAR_FORECAST_GRADING_CAPACITY'
      && error?.status === 503,
  );
  assert.equal(providerCalls, 4);
  assert.deepEqual(observedDelays, [5_000, 20_000, 45_000]);
});

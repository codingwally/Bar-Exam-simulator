import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BAR_FORECAST_CONSENT_VERSION,
  BAR_FORECAST_CONTENT_TYPE,
  BAR_FORECAST_SOURCE_VERSION,
  BAR_FORECAST_SUBJECTS,
  forecastSetId,
  validatedForecastRows,
} from './bar-forecast-core.mjs';
import { createBarForecastHandlers } from './bar-forecast-routes.mjs';

const SUBJECT = BAR_FORECAST_SUBJECTS[0];

assert.equal(BAR_FORECAST_CONSENT_VERSION, '2026-09-01');

function items() {
  return Array.from({ length: 20 }, (_, index) => {
    const number = index + 1;
    return {
      id: `route-forecast-${number}`,
      contentType: BAR_FORECAST_CONTENT_TYPE,
      subject: SUBJECT,
      title: `POL-${String(number).padStart(2, '0')} — Route forecast ${number}`,
      version: BAR_FORECAST_SOURCE_VERSION,
      checksum: number.toString(16).padStart(64, '0'),
      payload: {
        id: `route-forecast-${number}`,
        subject: SUBJECT,
        version: BAR_FORECAST_SOURCE_VERSION,
        editorial_ref: `POL-${String(number).padStart(2, '0')}`,
        title: `Route forecast ${number}`,
        rank_within_subject: number,
        prompt: `May the requested relief be granted under the single doctrine in question ${number}?`,
        suggested_answer: `Answer: Yes. Suggested answer ${number} applies the curated doctrine to every stated fact.`,
        legal_basis: `Legal basis ${number} supplies the sole controlling doctrine and all conditions needed for a complete legal assessment.`,
        controlling_doctrine: `Controlling doctrine ${number} is the exclusive rule for this Forecast question and its stated facts.`,
        jurisprudence: `Official Case ${number}`,
        citation: `G.R. No. 20${number}, January 1, 2025`,
      },
    };
  });
}

function answers() {
  return Array.from({ length: 20 }, (_, index) => ({
    questionId: `route-forecast-${index + 1}`,
    answer: `Yes. Answer ${index + 1} states the controlling rule, applies the stated facts, and reaches a supported conclusion.`,
  }));
}

const SET_ID = await forecastSetId(validatedForecastRows(items(), SUBJECT));

function request(body, token = 'admin-token') {
  return new Request('https://api.example.test/admin/dd2026/bar-forecast', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function harness(overrides = {}) {
  const calls = [];
  let consentAccepted = overrides.consentAccepted ?? true;
  const dependencies = {
    authorizeAdministrator: async () => overrides.authorization ?? {
      authorized: true,
      role: 'super_admin',
    },
    barForecastRpc: async (_env, functionName, body) => {
      calls.push({ functionName, body });
      if (functionName === 'dd2026_bar_forecast_consent_status') {
        return { consentAccepted };
      }
      if (functionName === 'dd2026_bar_forecast_accept_consent') {
        consentAccepted = true;
        return { consentAccepted: true };
      }
      if (functionName === 'dd2026_bar_forecast_admin_list') {
        return {
          items: typeof overrides.items === 'function' ? overrides.items() : items(),
          total: 20,
        };
      }
      throw new Error(`Unexpected RPC ${functionName}`);
    },
    enforceBarForecastAdminRateLimit: async () => {
      calls.push({ functionName: 'rate_limit' });
    },
    jsonResponse: (body, status) => new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
    parseBoundedJson: async (incoming) => incoming.json(),
    approvedSetIds: overrides.approvedSetIds ?? { [SUBJECT]: SET_ID },
    requireAdministrator: async (incoming) => {
      if (incoming.headers.get('Authorization') !== 'Bearer admin-token') {
        const error = new Error('Administrator sign-in is required.');
        error.code = 'ADMIN_SIGN_IN_REQUIRED';
        error.status = 401;
        throw error;
      }
      return { id: 'admin-user-id' };
    },
    structuredGemini: async (_env, prompt, _schema, validate) => {
      calls.push({ functionName: 'structured_gemini', prompt });
      const parsedRecords = JSON.parse(prompt.match(/CURATED FORECAST RECORDS AND UNTRUSTED ANSWERS\n([^\n]+)\n\nReturn only/)[1]);
      return {
        result: validate({
          results: parsedRecords.map((row) => ({
            questionId: row.questionId,
            score: 4,
            feedback: `Concrete feedback for ${row.number}.`,
            explanation: `Holistic comparison for ${row.number}.`,
            rubric: { forbidden: true },
          })),
        }),
      };
    },
    ...overrides.dependencies,
  };
  return {
    calls,
    handlers: createBarForecastHandlers(dependencies),
  };
}

async function responseBody(response) {
  return JSON.parse(await response.text());
}

test('status is fail-closed and returns only the contracted fields with private no-store', async () => {
  const { calls, handlers } = harness({ consentAccepted: false });
  const response = await handlers.handle(request({ operation: 'status' }), {}, '', '');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.get('Pragma'), 'no-cache');
  assert.deepEqual(await responseBody(response), {
    ok: true,
    authorized: true,
    consentAccepted: false,
  });
  assert.deepEqual(calls.map((call) => call.functionName), [
    'rate_limit', 'dd2026_bar_forecast_consent_status',
  ]);

  const denied = harness({ authorization: { authorized: false, role: 'super_admin' } });
  await assert.rejects(
    denied.handlers.handle(request({ operation: 'status' }), {}, '', ''),
    { code: 'BAR_FORECAST_ADMIN_FORBIDDEN', status: 403 },
  );
  assert.equal(denied.calls.some((call) => call.functionName === 'dd2026_bar_forecast_consent_status'), false);

  const subscriber = harness({ authorization: { authorized: true, role: 'subscriber' } });
  await assert.rejects(
    subscriber.handlers.handle(request({ operation: 'status' }), {}, '', ''),
    { code: 'BAR_FORECAST_ADMIN_FORBIDDEN', status: 403 },
  );
});

test('accept persists the exact version for the authenticated admin user', async () => {
  const { calls, handlers } = harness({ consentAccepted: false });
  const response = await handlers.handle(request({
    operation: 'accept',
    version: BAR_FORECAST_CONSENT_VERSION,
  }), {}, '', '');
  assert.deepEqual(await responseBody(response), {
    ok: true,
    authorized: true,
    consentAccepted: true,
  });
  assert.deepEqual(calls.find((call) => call.functionName === 'dd2026_bar_forecast_accept_consent'), {
    functionName: 'dd2026_bar_forecast_accept_consent',
    body: {
      p_actor_user_id: 'admin-user-id',
      p_consent_version: BAR_FORECAST_CONSENT_VERSION,
    },
  });
});

test('start requires persisted consent and exposes exactly 20 sanitized questions', async () => {
  const refused = harness({ consentAccepted: false });
  await assert.rejects(
    refused.handlers.handle(request({ operation: 'start', subject: SUBJECT }), {}, '', ''),
    { code: 'BAR_FORECAST_CONSENT_REQUIRED', status: 409 },
  );
  assert.equal(refused.calls.some((call) => call.functionName === 'dd2026_bar_forecast_admin_list'), false);

  const { handlers } = harness();
  const response = await handlers.handle(request({ operation: 'start', subject: SUBJECT }), {}, '', '');
  const body = await responseBody(response);
  assert.equal(body.subject, SUBJECT);
  assert.equal(body.sourceVersion, BAR_FORECAST_SOURCE_VERSION);
  assert.equal(body.contentType, BAR_FORECAST_CONTENT_TYPE);
  assert.equal(body.setId, SET_ID);
  assert.equal(body.schedule.entries.length, 6);
  assert.equal(body.schedule.entries[0].startTime, '08:00');
  assert.equal(body.schedule.entries[0].endTime, '12:00');
  assert.equal(body.schedule.entries[1].startTime, '14:00');
  assert.equal(body.schedule.entries[1].endTime, '18:00');
  assert.equal(body.questions.length, 20);
  for (const question of body.questions) {
    assert.deepEqual(Object.keys(question), ['id', 'number', 'prompt']);
    assert.equal(JSON.stringify(question).includes('suggested'), false);
    assert.equal(JSON.stringify(question).includes('prediction'), false);
  }
});

test('submit grades five bounded batches and returns only the public holistic result contract', async () => {
  const { calls, handlers } = harness();
  const response = await handlers.handle(request({
    operation: 'submit',
    subject: SUBJECT,
    setId: SET_ID,
    answers: answers(),
  }), {}, '', '');
  const body = await responseBody(response);
  assert.equal(body.totalScore, 80);
  assert.equal(body.maxScore, 100);
  assert.equal(body.results.length, 20);
  assert.equal(calls.filter((call) => call.functionName === 'structured_gemini').length, 5);
  assert.deepEqual(Object.keys(body.results[0]), [
    'questionId', 'number', 'score', 'maxScore', 'feedback',
    'userAnswer', 'suggestedAnswer', 'explanation',
  ]);
  assert.equal(JSON.stringify(body).includes('rubric'), false);
  assert.equal(JSON.stringify(body).includes('legalBasis'), false);
  assert.equal(JSON.stringify(body).includes('controllingDoctrine'), false);
});

test('submit rejects a question set that changed after start before grading', async () => {
  let currentItems = items();
  const approvedSetIds = { [SUBJECT]: SET_ID };
  const { calls, handlers } = harness({ items: () => currentItems, approvedSetIds });
  const startResponse = await handlers.handle(
    request({ operation: 'start', subject: SUBJECT }),
    {},
    '',
    '',
  );
  const started = await responseBody(startResponse);
  currentItems = items();
  currentItems[0].checksum = 'f'.repeat(64);
  approvedSetIds[SUBJECT] = await forecastSetId(validatedForecastRows(currentItems, SUBJECT));

  await assert.rejects(
    handlers.handle(request({
      operation: 'submit',
      subject: SUBJECT,
      setId: started.setId,
      answers: answers(),
    }), {}, '', ''),
    { code: 'BAR_FORECAST_SET_CHANGED', status: 409 },
  );
  assert.equal(calls.some((call) => call.functionName === 'structured_gemini'), false);
});

test('unapproved curated question content fails before questions or grading are returned', async () => {
  const changedItems = items();
  changedItems[0].payload.prompt = 'May this altered and unapproved question be shown to the examinee?';
  const { calls, handlers } = harness({ items: () => changedItems });
  await assert.rejects(
    handlers.handle(request({ operation: 'start', subject: SUBJECT }), {}, '', ''),
    { code: 'BAR_FORECAST_CONTENT_MANIFEST_MISMATCH', status: 503 },
  );
  assert.equal(calls.some((call) => call.functionName === 'structured_gemini'), false);
});

test('malformed answer sets are rejected before curated content or Gemini is requested', async () => {
  const { calls, handlers } = harness();
  await assert.rejects(
    handlers.handle(request({
      operation: 'submit', subject: SUBJECT, setId: SET_ID, answers: answers().slice(0, 19),
    }), {}, '', ''),
    { code: 'BAR_FORECAST_ANSWERS_INCOMPLETE' },
  );
  assert.equal(calls.some((call) => call.functionName === 'dd2026_bar_forecast_admin_list'), false);
  assert.equal(calls.some((call) => call.functionName === 'structured_gemini'), false);

  await assert.rejects(
    handlers.handle(request({ operation: 'status', subject: SUBJECT }), {}, '', ''),
    { code: 'BAR_FORECAST_REQUEST_SHAPE_INVALID' },
  );
});

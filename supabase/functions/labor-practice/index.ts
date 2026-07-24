import {
  filterPublicQuestions,
  laborQuestionFacets,
  normalizeLaborRows,
  parseEvaluatorJson,
  sheetValuesToRows,
  toPublicQuestion,
  validateEvaluationResult,
} from './contracts.mjs';

const cacheTtlMilliseconds = 5 * 60 * 1000;
const defaultOrigins = ['https://duediligence.ph', 'https://www.duediligence.ph'];

const evaluationSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'questionId', 'databaseVersion', 'experimentalScore', 'scoreLabel',
    'issueRecognition', 'governingRule', 'factualApplication', 'conclusion',
    'conceptsMatched', 'conceptsMissing', 'materialContradictions', 'conciseFeedback',
    'grammarReview', 'requiresHumanReview',
  ],
  properties: {
    questionId: { type: 'string' },
    databaseVersion: { type: 'string' },
    experimentalScore: { type: 'integer', minimum: 0, maximum: 100 },
    scoreLabel: { type: 'string', enum: ['Strong Match', 'Substantial Match', 'Partial Match', 'Limited Match'] },
    issueRecognition: componentSchema(20),
    governingRule: componentSchema(30),
    factualApplication: componentSchema(30),
    conclusion: componentSchema(20),
    conceptsMatched: stringArraySchema(),
    conceptsMissing: stringArraySchema(),
    materialContradictions: stringArraySchema(),
    conciseFeedback: { type: 'string' },
    grammarReview: {
      type: 'object',
      additionalProperties: false,
      required: ['correctedAnswerAmericanEnglish', 'corrections', 'clarityNotes', 'affectedScore'],
      properties: {
        correctedAnswerAmericanEnglish: { type: 'string' },
        corrections: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['original', 'corrected', 'explanation'],
            properties: {
              original: { type: 'string' },
              corrected: { type: 'string' },
              explanation: { type: 'string' },
            },
          },
        },
        clarityNotes: stringArraySchema(),
        affectedScore: { type: 'boolean', enum: [false] },
      },
    },
    requiresHumanReview: { type: 'boolean' },
  },
};

function componentSchema(maximum) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['score', 'maxScore', 'explanation'],
    properties: {
      score: { type: 'integer', minimum: 0, maximum },
      maxScore: { type: 'integer', enum: [maximum] },
      explanation: { type: 'string' },
    },
  };
}

function stringArraySchema() {
  return { type: 'array', items: { type: 'string' }, maxItems: 12 };
}

function env(name) {
  return (Deno.env.get(name) ?? '').trim();
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function allowedOrigins() {
  const configured = env('ALLOWED_ORIGINS').split(',').map((origin) => origin.trim()).filter(Boolean);
  return configured.length ? configured : defaultOrigins;
}

function cors(req) {
  const origin = req.headers.get('Origin');
  const allowed = allowedOrigins();
  if (origin && !allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin && allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-client-info, apikey, authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function configuration() {
  const config = {
    supabaseUrl: env('SUPABASE_URL'),
    serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
    googleServiceAccountEmail: env('GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL'),
    googlePrivateKey: env('GOOGLE_SHEETS_PRIVATE_KEY').replace(/\\n/g, '\n'),
    spreadsheetId: env('GOOGLE_SHEETS_SPREADSHEET_ID'),
    openaiApiKey: env('OPENAI_API_KEY'),
    openaiModel: env('OPENAI_EVALUATION_MODEL') || 'gpt-5',
    previewEnabled: env('ENABLE_REVIEW_CONTENT_PREVIEW').toLowerCase() === 'true',
  };
  return config;
}

function hasSheetConfiguration(config) {
  return Boolean(config.supabaseUrl && config.serviceRoleKey && config.googleServiceAccountEmail && config.googlePrivateKey && config.spreadsheetId);
}

function base64Url(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToArrayBuffer(pem) {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

async function googleAccessToken(config) {
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const encodedClaims = base64Url(JSON.stringify({
    iss: config.googleServiceAccountEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signer = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(config.googlePrivateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signer, new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`));
  const assertion = `${encodedHeader}.${encodedClaims}.${base64Url(new Uint8Array(signature))}`;
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!tokenResponse.ok) throw new Error('Google authentication failed.');
  const payload = await tokenResponse.json();
  if (!payload?.access_token) throw new Error('Google did not return an access token.');
  return payload.access_token;
}

async function supabaseRest(config, path, init = {}) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error('The secure content store is unavailable.');
  return response;
}

async function readPersistentCache(config) {
  const response = await supabaseRest(config, 'labor_sheet_cache?singleton=eq.true&select=payload,fetched_at&limit=1');
  const rows = await response.json();
  return rows?.[0] ?? null;
}

async function writePersistentCache(config, payload) {
  await supabaseRest(config, 'labor_sheet_cache', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ singleton: true, payload, fetched_at: new Date().toISOString() }),
  });
}

async function fetchSheetValues(config) {
  const accessToken = await googleAccessToken(config);
  const range = encodeURIComponent('Q&A Bank!A1:Z');
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${range}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error('The Q&A Bank could not be read.');
  const payload = await response.json();
  if (!Array.isArray(payload?.values)) throw new Error('The Q&A Bank did not return rows.');
  return payload.values;
}

async function canonicalCatalog(config) {
  if (!hasSheetConfiguration(config)) throw new Error('SERVICE_CONFIGURATION_REQUIRED');
  let cached = null;
  try { cached = await readPersistentCache(config); } catch { /* A live Sheet fetch can still recover the catalog. */ }
  const cacheAge = cached?.fetched_at ? Date.now() - Date.parse(cached.fetched_at) : Number.POSITIVE_INFINITY;

  if (cached?.payload?.values && cacheAge < cacheTtlMilliseconds) {
    const normalized = normalizeLaborRows(sheetValuesToRows(cached.payload.values), { previewEnabled: config.previewEnabled });
    return { ...normalized, stale: false };
  }

  try {
    const values = await fetchSheetValues(config);
    const normalized = normalizeLaborRows(sheetValuesToRows(values), { previewEnabled: config.previewEnabled });
    await writePersistentCache(config, { values });
    return { ...normalized, stale: false };
  } catch (error) {
    if (cached?.payload?.values) {
      const normalized = normalizeLaborRows(sheetValuesToRows(cached.payload.values), { previewEnabled: config.previewEnabled });
      return { ...normalized, stale: true };
    }
    throw error;
  }
}

function canonicalReveal(question) {
  return {
    questionId: question.questionId,
    suggestedAnswer: question.suggestedAnswer,
    keyLegalConcepts: question.keyLegalConcepts,
    legalBasis: question.legalBasis,
    controllingDoctrine: question.controllingDoctrine,
    jurisprudence: question.jurisprudence,
    citation: question.citation,
    issue: question.issue,
    application: question.application,
    conclusion: question.conclusion,
    sourceAttribution: question.sourceAttribution,
    sourceUrl: question.sourceUrl,
    databaseVersion: question.databaseVersion,
    preview: question.preview,
  };
}

function evaluatorInstructions() {
  return [
    'You are an answer-comparison engine for a Philippine Bar essay trainer.',
    'The supplied curated database record is the sole substantive source of truth. Do not introduce outside law, cases, doctrines, quotations, provisions, or facts.',
    'Compare legal meaning and conceptual coverage, not identical wording, sentence order, answer length, grammar quality, or case-name recall unless the question expressly requires a citation.',
    'Evaluate issue recognition (20), governing rule or doctrine (30), application to material facts (30), and a legally compatible conclusion (20).',
    'Do not reward copied words without understanding, irrelevant discussion, unsupported doctrine, invented authorities, or a conclusion that materially contradicts the curated doctrine.',
    'If the canonical record does not contain enough information to evaluate a point, identify that limitation and set requiresHumanReview to true rather than inventing support.',
    'After legal scoring, provide separate American English grammar and clarity guidance. Grammar, spelling, punctuation, British versus American usage, wordiness, and imperfect English proficiency must never change any substantive component score.',
    'Preserve the student\'s original legal meaning in the corrected answer. Do not add legal arguments, authorities, facts, or conclusions.',
    'Return only JSON that satisfies the supplied schema. Do not reveal reasoning traces.',
  ].join('\n');
}

function extractOutputText(payload) {
  if (typeof payload.output_text === 'string') return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    const entry = item && typeof item === 'object' ? item : {};
    const content = Array.isArray(entry.content) ? entry.content : [];
    for (const part of content) {
      const messagePart = part && typeof part === 'object' ? part : {};
      if (typeof messagePart.text === 'string') return messagePart.text;
    }
  }
  return '';
}

async function evaluateWithOpenAI(config, question, studentAnswer) {
  if (!config.openaiApiKey) throw new Error('EVALUATOR_UNAVAILABLE');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.openaiModel,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: evaluatorInstructions() }] },
        {
          role: 'user',
          content: [{
            type: 'input_text',
            text: JSON.stringify({
              questionId: question.questionId,
              databaseVersion: question.databaseVersion,
              essayQuestion: question.essayQuestion,
              studentAnswer,
              curatedRecord: {
                suggestedAnswer: question.suggestedAnswer,
                keyLegalConcepts: question.keyLegalConcepts,
                legalBasis: question.legalBasis,
                controllingDoctrine: question.controllingDoctrine,
                jurisprudence: question.jurisprudence,
                citation: question.citation,
                issue: question.issue,
                application: question.application,
                conclusion: question.conclusion,
              },
            }),
          }],
        },
      ],
      text: { format: { type: 'json_schema', name: 'labor_concept_match', strict: true, schema: evaluationSchema } },
      max_output_tokens: 3000,
    }),
  });
  if (!response.ok) throw new Error('EVALUATOR_UNAVAILABLE');
  const payload = await response.json();
  try {
    return validateEvaluationResult(parseEvaluatorJson(extractOutputText(payload)), {
      questionId: String(question.questionId),
      databaseVersion: String(question.databaseVersion),
    });
  } catch {
    throw new Error('EVALUATOR_UNAVAILABLE');
  }
}

function cleanFeedback(value, limit = 5000) {
  return String(value ?? '').trim().slice(0, limit);
}

async function writeFeedback(config, question, payload) {
  const feedbackType = cleanFeedback(payload.feedbackType, 40).toUpperCase();
  if (!['ENDORSEMENT', 'FLAG', 'SUGGESTED_CORRECTION'].includes(feedbackType)) throw new Error('INVALID_FEEDBACK');
  const suppliedVersion = cleanFeedback(payload.databaseVersion, 80);
  if (suppliedVersion !== question.databaseVersion) throw new Error('QUESTION_VERSION_MISMATCH');
  const suggestedAnswer = cleanFeedback(payload.suggestedAnswer);
  const explanation = cleanFeedback(payload.explanation);
  const sourceUrl = cleanFeedback(payload.sourceUrl, 2000);
  if (sourceUrl && !/^https:\/\//i.test(sourceUrl)) throw new Error('INVALID_FEEDBACK');
  if (feedbackType === 'SUGGESTED_CORRECTION' && (!suggestedAnswer || !explanation)) throw new Error('INVALID_FEEDBACK');

  await supabaseRest(config, 'labor_feedback_log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      question_id: question.questionId,
      question_version: question.databaseVersion,
      submission_id: cleanFeedback(payload.submissionId, 120) || null,
      feedback_type: feedbackType,
      suggested_question: cleanFeedback(payload.suggestedQuestion),
      suggested_answer: suggestedAnswer,
      supporting_legal_basis: cleanFeedback(payload.supportingLegalBasis),
      supporting_jurisprudence: cleanFeedback(payload.supportingJurisprudence),
      source_url: sourceUrl,
      explanation,
      contributor: cleanFeedback(payload.contributor, 320) || null,
      evaluation_result: payload.evaluationResult && typeof payload.evaluationResult === 'object' ? payload.evaluationResult : null,
      loop_status: 'OPEN',
      editorial_decision: 'PENDING',
    }),
  });
}

async function requestBody(req) {
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > 40000) throw new Error('REQUEST_TOO_LARGE');
  const payload = await req.json();
  if (!payload || typeof payload !== 'object') throw new Error('INVALID_REQUEST');
  return payload;
}

Deno.serve(async (req) => {
  const headers = cors(req);
  if (!headers) return json({ error: 'ORIGIN_NOT_ALLOWED' }, 403);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, headers);

  try {
    const payload = await requestBody(req);
    const config = configuration();
    const catalog = await canonicalCatalog(config);
    const action = cleanFeedback(payload.action, 40);

    if (action === 'list_questions') {
      const filters = payload.filters && typeof payload.filters === 'object' ? payload.filters : {};
      const questions = filterPublicQuestions(catalog.questions, filters);
      return json({ questions, facets: laborQuestionFacets(catalog.questions), stale: catalog.stale, rejectedCount: catalog.rejected.length }, 200, headers);
    }

    const questionId = cleanFeedback(payload.questionId, 40);
    const question = catalog.questions.find((item) => item.questionId === questionId);
    if (!question) return json({ error: 'QUESTION_PENDING_EDITORIAL_COMPLETION' }, 409, headers);

    if (action === 'evaluate') {
      const studentAnswer = cleanFeedback(payload.studentAnswer, 12000);
      if (studentAnswer.length < 15) return json({ error: 'ANSWER_NEEDS_MORE_CONTENT' }, 422, headers);
      const evaluation = await evaluateWithOpenAI(config, question, studentAnswer);
      return json({ question: toPublicQuestion(question), canonical: canonicalReveal(question), evaluation, stale: catalog.stale }, 200, headers);
    }

    if (action === 'submit_feedback') {
      await writeFeedback(config, question, payload);
      return json({ accepted: true, questionId: question.questionId, databaseVersion: question.databaseVersion }, 202, headers);
    }

    return json({ error: 'UNKNOWN_ACTION' }, 400, headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'SERVICE_CONFIGURATION_REQUIRED') return json({ error: 'SERVICE_CONFIGURATION_REQUIRED', retryable: false }, 503, headers);
    if (message === 'EVALUATOR_UNAVAILABLE') return json({ error: 'EVALUATOR_UNAVAILABLE', retryable: true }, 503, headers);
    if (message === 'REQUEST_TOO_LARGE') return json({ error: 'REQUEST_TOO_LARGE' }, 413, headers);
    if (message === 'INVALID_FEEDBACK' || message === 'QUESTION_VERSION_MISMATCH' || message === 'INVALID_REQUEST') return json({ error: message }, 422, headers);
    return json({ error: 'CANONICAL_CONTENT_UNAVAILABLE', retryable: true }, 503, headers);
  }
});

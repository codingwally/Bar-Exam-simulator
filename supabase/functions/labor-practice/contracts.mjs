export const LABOR_QA_HEADERS = [
  'Question ID',
  'Subject',
  'Topic',
  'Bar Year',
  'Question No.',
  'Essay Question',
  'Suggested Answer',
  'Legal Basis / Provision',
  'Controlling Doctrine',
  'Jurisprudence / Case',
  'Citation / G.R. No.',
  'Source URL',
  'Difficulty',
  'Editorial Status',
  'Version',
  'Assigned Reviewer',
  'Last Reviewed',
  'Publication Ready?',
  'Notes',
];

export const LABOR_COMPONENT_LIMITS = Object.freeze({
  issueRecognition: 20,
  governingRule: 30,
  factualApplication: 30,
  conclusion: 20,
});

const releasedStatuses = new Set(['approved', 'published']);
const previewStatuses = new Set(['for review', 'in review']);
const questionIdPattern = /^LAB-\d{3}$/;

function keyForHeader(header) {
  return String(header ?? '').replace(/^\uFEFF/, '').trim().toLowerCase();
}

function text(value, limit = 20000) {
  return String(value ?? '').trim().slice(0, limit);
}

function yes(value) {
  return ['yes', 'true', '1'].includes(text(value).toLowerCase());
}

function rowValue(row, header) {
  return row[keyForHeader(header)] ?? '';
}

function normalizedStatus(value) {
  return text(value).toLowerCase();
}

function requiredCanonicalFields(row) {
  return [
    'Question ID',
    'Subject',
    'Topic',
    'Bar Year',
    'Question No.',
    'Essay Question',
    'Suggested Answer',
    'Legal Basis / Provision',
    'Controlling Doctrine',
    'Jurisprudence / Case',
    'Citation / G.R. No.',
    'Source URL',
    'Difficulty',
    'Editorial Status',
    'Version',
  ].filter((header) => !text(rowValue(row, header)));
}

export function sheetValuesToRows(values) {
  if (!Array.isArray(values) || values.length < 2) throw new Error('The Q&A Bank has no data rows.');
  const [headers, ...body] = values;
  const normalizedHeaders = headers.map(keyForHeader);
  const missingHeaders = LABOR_QA_HEADERS.filter((header) => !normalizedHeaders.includes(keyForHeader(header)));
  if (missingHeaders.length) throw new Error(`The Q&A Bank is missing required columns: ${missingHeaders.join(', ')}.`);

  return body.map((cells) => Object.fromEntries(normalizedHeaders.map((header, index) => [header, cells[index] ?? ''])));
}

export function normalizeLaborRows(rows, { previewEnabled = false } = {}) {
  if (!Array.isArray(rows)) throw new Error('The Q&A Bank payload is not a row collection.');

  const rejected = [];
  const questions = [];
  for (const row of rows) {
    const questionId = text(rowValue(row, 'Question ID'), 40);
    const editorialStatus = normalizedStatus(rowValue(row, 'Editorial Status'));
    const publicationReady = yes(rowValue(row, 'Publication Ready?'));
    const preview = previewEnabled && previewStatuses.has(editorialStatus);
    const approved = publicationReady && releasedStatuses.has(editorialStatus);

    if (!approved && !preview) continue;

    const missing = requiredCanonicalFields(row);
    if (!questionIdPattern.test(questionId) || missing.length) {
      rejected.push({ questionId: questionId || '(missing)', reason: missing.length ? `Missing: ${missing.join(', ')}` : 'Invalid Question ID' });
      continue;
    }

    const sourceUrl = text(rowValue(row, 'Source URL'), 2000);
    if (!/^https:\/\//i.test(sourceUrl)) {
      rejected.push({ questionId, reason: 'Source URL must use HTTPS.' });
      continue;
    }

    questions.push({
      questionId,
      subject: text(rowValue(row, 'Subject'), 120),
      topic: text(rowValue(row, 'Topic'), 240),
      barYear: Number(text(rowValue(row, 'Bar Year'), 8)),
      questionNumber: text(rowValue(row, 'Question No.'), 40),
      essayQuestion: text(rowValue(row, 'Essay Question')),
      suggestedAnswer: text(rowValue(row, 'Suggested Answer')),
      legalBasis: text(rowValue(row, 'Legal Basis / Provision')),
      controllingDoctrine: text(rowValue(row, 'Controlling Doctrine')),
      jurisprudence: text(rowValue(row, 'Jurisprudence / Case')),
      citation: text(rowValue(row, 'Citation / G.R. No.'), 1000),
      sourceUrl,
      difficulty: text(rowValue(row, 'Difficulty'), 80),
      editorialStatus: text(rowValue(row, 'Editorial Status'), 80),
      databaseVersion: text(rowValue(row, 'Version'), 80),
      publicationReady,
      preview,
      notes: text(rowValue(row, 'Notes'), 2000),
    });
  }

  const seen = new Set();
  const duplicates = questions.filter((question) => {
    if (seen.has(question.questionId)) return true;
    seen.add(question.questionId);
    return false;
  });
  if (duplicates.length) throw new Error(`The Q&A Bank has duplicate Question ID values: ${duplicates.map((question) => question.questionId).join(', ')}.`);

  return { questions, rejected };
}

export function toPublicQuestion(question) {
  return {
    questionId: question.questionId,
    subject: question.subject,
    topic: question.topic,
    barYear: question.barYear,
    questionNumber: question.questionNumber,
    essayQuestion: question.essayQuestion,
    difficulty: question.difficulty,
    editorialStatus: question.editorialStatus,
    databaseVersion: question.databaseVersion,
    sourceUrl: question.sourceUrl,
    preview: question.preview,
  };
}

export function filterPublicQuestions(questions, filters = {}) {
  const barYear = text(filters.barYear, 8);
  const topic = text(filters.topic, 240).toLowerCase();
  const difficulty = text(filters.difficulty, 80).toLowerCase();
  return questions
    .filter((question) => !barYear || String(question.barYear) === barYear)
    .filter((question) => !topic || question.topic.toLowerCase() === topic)
    .filter((question) => !difficulty || question.difficulty.toLowerCase() === difficulty)
    .map(toPublicQuestion)
    .sort((left, right) => right.barYear - left.barYear || left.questionNumber.localeCompare(right.questionNumber));
}

export function laborQuestionFacets(questions) {
  return {
    barYears: [...new Set(questions.map((question) => question.barYear))].sort((a, b) => b - a),
    topics: [...new Set(questions.map((question) => question.topic))].sort((a, b) => a.localeCompare(b)),
    difficulties: [...new Set(questions.map((question) => question.difficulty))].sort((a, b) => a.localeCompare(b)),
  };
}

function boundedNumber(value, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error('A scoring component is not numeric.');
  return Math.min(max, Math.max(0, Math.round(numeric)));
}

function stringList(value, field, maxItems = 12) {
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== 'string')) throw new Error(`${field} must be a short string list.`);
  return value.map((item) => text(item, 1000));
}

function component(value, field, maxScore) {
  if (!value || typeof value !== 'object') throw new Error(`${field} is missing.`);
  if (typeof value.explanation !== 'string') throw new Error(`${field}.explanation must be text.`);
  const score = boundedNumber(value.score, maxScore);
  const reportedMaximum = Number(value.maxScore);
  if (reportedMaximum !== maxScore) throw new Error(`${field}.maxScore is invalid.`);
  return { score, maxScore, explanation: text(value.explanation, 1600) };
}

function grammarReview(value) {
  if (!value || typeof value !== 'object' || value.affectedScore !== false) throw new Error('grammarReview must explicitly confirm that it did not affect the score.');
  if (typeof value.correctedAnswerAmericanEnglish !== 'string') throw new Error('grammarReview.correctedAnswerAmericanEnglish must be text.');
  if (!Array.isArray(value.corrections) || value.corrections.length > 12) throw new Error('grammarReview.corrections must be a short list.');
  const corrections = value.corrections.map((item) => {
    if (!item || typeof item.original !== 'string' || typeof item.corrected !== 'string' || typeof item.explanation !== 'string') throw new Error('Each grammar correction must preserve original, corrected, and explanation text.');
    return { original: text(item.original, 600), corrected: text(item.corrected, 600), explanation: text(item.explanation, 900) };
  });
  return {
    correctedAnswerAmericanEnglish: text(value.correctedAnswerAmericanEnglish),
    corrections,
    clarityNotes: stringList(value.clarityNotes, 'grammarReview.clarityNotes', 10),
    affectedScore: false,
  };
}

export function scoreLabel(score) {
  if (score >= 85) return 'Strong Match';
  if (score >= 70) return 'Substantial Match';
  if (score >= 50) return 'Partial Match';
  return 'Limited Match';
}

export function validateEvaluationResult(raw, { questionId, databaseVersion }) {
  if (!raw || typeof raw !== 'object') throw new Error('The evaluator response is not an object.');
  if (raw.questionId !== questionId || raw.databaseVersion !== databaseVersion) throw new Error('The evaluator response does not match the submitted canonical record.');

  const issueRecognition = component(raw.issueRecognition, 'issueRecognition', LABOR_COMPONENT_LIMITS.issueRecognition);
  const governingRule = component(raw.governingRule, 'governingRule', LABOR_COMPONENT_LIMITS.governingRule);
  const factualApplication = component(raw.factualApplication, 'factualApplication', LABOR_COMPONENT_LIMITS.factualApplication);
  const conclusion = component(raw.conclusion, 'conclusion', LABOR_COMPONENT_LIMITS.conclusion);
  const total = Number(issueRecognition.score) + Number(governingRule.score) + Number(factualApplication.score) + Number(conclusion.score);
  const reportedScore = Number(raw.experimentalScore);
  if (!Number.isFinite(reportedScore) || Math.round(reportedScore) !== total) throw new Error('The evaluator total does not equal the four component scores.');

  if (typeof raw.conciseFeedback !== 'string' || typeof raw.requiresHumanReview !== 'boolean') throw new Error('The evaluator response is missing required feedback fields.');
  return {
    questionId,
    databaseVersion,
    experimentalScore: total,
    scoreLabel: scoreLabel(total),
    issueRecognition,
    governingRule,
    factualApplication,
    conclusion,
    conceptsMatched: stringList(raw.conceptsMatched, 'conceptsMatched'),
    conceptsMissing: stringList(raw.conceptsMissing, 'conceptsMissing'),
    materialContradictions: stringList(raw.materialContradictions, 'materialContradictions'),
    conciseFeedback: text(raw.conciseFeedback, 2400),
    grammarReview: grammarReview(raw.grammarReview),
    requiresHumanReview: raw.requiresHumanReview,
  };
}

export function parseEvaluatorJson(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('The evaluator did not return structured output.');
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('The evaluator returned invalid JSON.');
  }
}

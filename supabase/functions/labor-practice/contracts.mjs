// Recommended headers for the Labor Law worksheet. The normalizer also accepts
// the common header variants in HEADER_ALIASES, so editorial changes do not
// silently remove otherwise valid published records.
export const LABOR_QA_HEADERS = [
  'Question ID',
  'Subject',
  'Topic',
  'Bar Year',
  'Question No.',
  'Subpart',
  'Essay Question',
  'Suggested Answer',
  'Key Legal Concepts',
  'Legal Basis / Provision',
  'Controlling Doctrine',
  'Jurisprudence / Case',
  'Citation / G.R. No.',
  'Issue',
  'Application / Reasoning',
  'Conclusion',
  'Source Attribution',
  'Source URL',
  'Difficulty',
  'Editorial Status',
  'Publication Ready?',
  'Version',
  'Last Updated',
  'Assigned Reviewer',
  'Notes',
];

export const LABOR_COMPONENT_LIMITS = Object.freeze({
  issueRecognition: 20,
  governingRule: 30,
  factualApplication: 30,
  conclusion: 20,
});

const HEADER_ALIASES = Object.freeze({
  questionId: ['Question ID', 'ID', 'QuestionID', 'Question_Id'],
  subject: ['Subject', 'Bar Subject'],
  topic: ['Topic', 'Topics', 'Subject Topic'],
  barYear: ['Bar Year', 'Exam Year', 'Year', 'Bar Examination Year'],
  questionNumber: ['Question No.', 'Question Number', 'Question #', 'Item No.', 'Item Number'],
  subpart: ['Subpart', 'Sub-Part', 'Part', 'Question Part'],
  essayQuestion: ['Essay Question', 'Question', 'Full Question', 'Question Text', 'Prompt'],
  suggestedAnswer: ['Suggested Answer', 'Official Suggested Answer', 'Model Answer', 'Answer Key'],
  keyLegalConcepts: ['Key Legal Concepts', 'Legal Concepts', 'Key Concepts', 'Important Legal Principles', 'Keywords'],
  legalBasis: ['Legal Basis / Provision', 'Legal Basis', 'Governing Rule', 'Rule / Legal Basis', 'Constitutional or Statutory Basis'],
  controllingDoctrine: ['Controlling Doctrine', 'Doctrine', 'Doctrine / Principle'],
  jurisprudence: ['Jurisprudence / Case', 'Jurisprudence', 'Related Jurisprudence', 'Case Law', 'Case'],
  citation: ['Citation / G.R. No.', 'Citation', 'G.R. No.', 'GR No.'],
  issue: ['Issue', 'Controlling Issue'],
  application: ['Application / Reasoning', 'Application', 'Reasoning'],
  conclusion: ['Conclusion'],
  sourceAttribution: ['Source Attribution', 'Source Title', 'Source'],
  sourceUrl: ['Source URL', 'Source Link', 'URL'],
  difficulty: ['Difficulty', 'Level'],
  editorialStatus: ['Editorial Status', 'Status', 'Review Status'],
  publicationReady: ['Publication Ready?', 'Publication Ready', 'Published?', 'Publication Status', 'Ready for Publication'],
  databaseVersion: ['Version', 'Database Version', 'Content Version'],
  lastUpdated: ['Last Updated', 'Updated At', 'Last Reviewed', 'Date Updated'],
  reviewer: ['Assigned Reviewer', 'Author / Reviewer', 'Reviewer', 'Author'],
  notes: ['Notes', 'Editorial Notes'],
});

const releasedStatuses = new Set(['approved', 'published', 'released']);
const previewStatuses = new Set(['for review', 'in review']);
const truthyPublicationStates = new Set(['yes', 'true', '1', 'approved', 'published', 'released']);

function keyForHeader(header) {
  return String(header ?? '').replace(/^\uFEFF/, '').trim().toLowerCase();
}

function text(value, limit = 20000) {
  return String(value ?? '').trim().slice(0, limit);
}

function fieldValue(row, field) {
  const aliases = HEADER_ALIASES[field] || [];
  for (const alias of aliases) {
    const value = row[keyForHeader(alias)];
    if (text(value)) return value;
  }
  return '';
}

function normalizedStatus(value) {
  return text(value).toLowerCase();
}

function published(value) {
  return truthyPublicationStates.has(normalizedStatus(value));
}

function splitConcepts(value) {
  const source = text(value, 8000);
  if (!source) return [];
  try {
    const parsed = JSON.parse(source);
    if (Array.isArray(parsed)) return parsed.map((item) => text(item, 1000)).filter(Boolean).slice(0, 20);
  } catch { /* Delimited cell values are also valid editorial input. */ }
  return source.split(/[\n;|]+/).map((item) => text(item, 1000)).filter(Boolean).slice(0, 20);
}

function questionIdIsStable(value) {
  return /^[A-Za-z][A-Za-z0-9._:-]{2,79}$/.test(value);
}

function versionFor(row) {
  return text(fieldValue(row, 'databaseVersion'), 80)
    || text(fieldValue(row, 'lastUpdated'), 80)
    || 'sheet-unversioned';
}

function requiredFields(row) {
  return [
    ['Question ID', 'questionId'],
    ['Subject', 'subject'],
    ['Essay Question', 'essayQuestion'],
    ['Suggested Answer', 'suggestedAnswer'],
    ['Editorial Status', 'editorialStatus'],
  ].filter(([, field]) => !text(fieldValue(row, field))).map(([label]) => label);
}

function numberFor(value) {
  const numeric = Number.parseInt(text(value, 8), 10);
  return Number.isFinite(numeric) ? numeric : null;
}

function compareQuestions(left, right) {
  const leftYear = Number(left.barYear) || Number.MAX_SAFE_INTEGER;
  const rightYear = Number(right.barYear) || Number.MAX_SAFE_INTEGER;
  return leftYear - rightYear
    || String(left.questionNumber || '').localeCompare(String(right.questionNumber || ''), undefined, { numeric: true })
    || String(left.subpart || '').localeCompare(String(right.subpart || ''), undefined, { numeric: true })
    || left.questionId.localeCompare(right.questionId);
}

export function sheetValuesToRows(values) {
  if (!Array.isArray(values) || !values.length) throw new Error('The Q&A Bank has no rows.');
  const [headers, ...body] = values;
  if (!Array.isArray(headers) || !headers.length) throw new Error('The Q&A Bank has no header row.');
  const normalizedHeaders = headers.map(keyForHeader);
  return body.map((cells) => Object.fromEntries(normalizedHeaders.map((header, index) => [header, Array.isArray(cells) ? cells[index] ?? '' : ''])));
}

export function normalizeLaborRows(rows, { previewEnabled = false } = {}) {
  if (!Array.isArray(rows)) throw new Error('The Q&A Bank payload is not a row collection.');

  const rejected = [];
  const questions = [];
  const seen = new Set();
  for (const row of rows) {
    const questionId = text(fieldValue(row, 'questionId'), 80);
    const editorialStatus = normalizedStatus(fieldValue(row, 'editorialStatus'));
    const publicationValue = fieldValue(row, 'publicationReady');
    const publicationReady = publicationValue ? published(publicationValue) : releasedStatuses.has(editorialStatus);
    const preview = previewEnabled && previewStatuses.has(editorialStatus);
    const approved = releasedStatuses.has(editorialStatus) && publicationReady;

    if (!approved && !preview) continue;

    const missing = requiredFields(row);
    if (!questionIdIsStable(questionId) || missing.length) {
      rejected.push({ questionId: questionId || '(missing)', reason: missing.length ? `Missing: ${missing.join(', ')}` : 'Question ID is not stable.' });
      continue;
    }
    if (seen.has(questionId)) {
      rejected.push({ questionId, reason: 'Duplicate Question ID.' });
      continue;
    }
    const subject = text(fieldValue(row, 'subject'), 120);
    if (!/labor/i.test(subject)) {
      rejected.push({ questionId, reason: 'Subject is not Labor Law.' });
      continue;
    }
    const sourceUrl = text(fieldValue(row, 'sourceUrl'), 2000);
    if (sourceUrl && !/^https:\/\//i.test(sourceUrl)) {
      rejected.push({ questionId, reason: 'Source URL must use HTTPS when supplied.' });
      continue;
    }
    seen.add(questionId);
    questions.push({
      questionId,
      subject,
      topic: text(fieldValue(row, 'topic'), 240),
      barYear: numberFor(fieldValue(row, 'barYear')),
      questionNumber: text(fieldValue(row, 'questionNumber'), 40),
      subpart: text(fieldValue(row, 'subpart'), 40),
      essayQuestion: text(fieldValue(row, 'essayQuestion')),
      suggestedAnswer: text(fieldValue(row, 'suggestedAnswer')),
      keyLegalConcepts: splitConcepts(fieldValue(row, 'keyLegalConcepts')),
      legalBasis: text(fieldValue(row, 'legalBasis')),
      controllingDoctrine: text(fieldValue(row, 'controllingDoctrine')),
      jurisprudence: text(fieldValue(row, 'jurisprudence')),
      citation: text(fieldValue(row, 'citation'), 1000),
      issue: text(fieldValue(row, 'issue')),
      application: text(fieldValue(row, 'application')),
      conclusion: text(fieldValue(row, 'conclusion')),
      sourceAttribution: text(fieldValue(row, 'sourceAttribution'), 1000),
      sourceUrl,
      difficulty: text(fieldValue(row, 'difficulty'), 80),
      editorialStatus: text(fieldValue(row, 'editorialStatus'), 80),
      databaseVersion: versionFor(row),
      lastUpdated: text(fieldValue(row, 'lastUpdated'), 80),
      reviewer: text(fieldValue(row, 'reviewer'), 240),
      publicationReady,
      preview,
      notes: text(fieldValue(row, 'notes'), 2000),
    });
  }

  return { questions: questions.sort(compareQuestions), rejected };
}

export function toPublicQuestion(question) {
  return {
    questionId: question.questionId,
    subject: question.subject,
    topic: question.topic,
    barYear: question.barYear,
    questionNumber: question.questionNumber,
    subpart: question.subpart,
    essayQuestion: question.essayQuestion,
    difficulty: question.difficulty,
    editorialStatus: question.editorialStatus,
    databaseVersion: question.databaseVersion,
    lastUpdated: question.lastUpdated,
    sourceAttribution: question.sourceAttribution,
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
    .sort(compareQuestions);
}

export function laborQuestionFacets(questions) {
  return {
    barYears: [...new Set(questions.map((question) => question.barYear).filter((value) => value !== null))].sort((a, b) => a - b),
    topics: [...new Set(questions.map((question) => question.topic).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    difficulties: [...new Set(questions.map((question) => question.difficulty).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
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

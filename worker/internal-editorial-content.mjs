const INTERNAL_EDITORIAL_LABEL = String.raw`(?:` + [
  String.raw`(?:(?:suggested|performance|grading|scoring|evaluation|model)\s+)?rubric`,
  String.raw`(?:internal|editorial|examiner|grader)\s+notes?`,
  String.raw`(?:grading|scoring)\s+(?:guide|criteria|key)`,
].join('|') + String.raw`)`;

const INTERNAL_EDITORIAL_MARKER = new RegExp(
  String.raw`\b${INTERNAL_EDITORIAL_LABEL}(?:\s*\([^\r\n)]{0,120}\))?\s*(?::|[\u2013\u2014-])`,
  'iu',
);

// An editorial block may sit between learner-facing sections. Preserve a later
// approved section only when it begins a new paragraph; otherwise fail closed
// by removing the remainder after the internal marker.
const LEARNER_SECTION_BOUNDARY = /\n[ \t]*\n[ \t]*(?=(?:(?:I{1,4}|[1-9])\.\s*)?(?:answer|direct answer|legal basis|governing provision|application|conclusion|doctrine|jurisprudence|citation|sources?|model answer|model work product)\s*:|this simulation\b)/iu;

export class InternalEditorialContentError extends Error {
  constructor(message = 'Internal editorial content could not be removed safely.') {
    super(message);
    this.name = 'InternalEditorialContentError';
    this.code = 'INTERNAL_EDITORIAL_CONTENT_UNSAFE';
    this.status = 500;
  }
}

export function containsInternalEditorialBlock(value) {
  if (typeof value === 'string') return INTERNAL_EDITORIAL_MARKER.test(value);
  if (Array.isArray(value)) return value.some(containsInternalEditorialBlock);
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some(containsInternalEditorialBlock);
}

export function stripInternalEditorialBlocks(value) {
  let text = String(value ?? '').replace(/\r\n?/g, '\n');
  let removals = 0;

  while (removals < 64) {
    const marker = INTERNAL_EDITORIAL_MARKER.exec(text);
    if (!marker) break;

    const blockStart = marker.index;
    const remainderStart = blockStart + marker[0].length;
    const remainder = text.slice(remainderStart);
    const boundary = LEARNER_SECTION_BOUNDARY.exec(remainder);
    const blockEnd = boundary
      ? remainderStart + boundary.index
      : text.length;

    text = `${text.slice(0, blockStart).replace(/[ \t]+$/u, '')}${text.slice(blockEnd)}`;
    removals += 1;
  }

  text = text
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n[ \t]+\n/gu, '\n\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

  if (containsInternalEditorialBlock(text)) throw new InternalEditorialContentError();
  return text;
}

const EDITORIAL_FIELD_NAMES = new Set([
  'assessment',
  'authorityreferences',
  'casename',
  'citation',
  'controllinglawanddoctrine',
  'controllinglawandelements',
  'directanswer',
  'doctrine',
  'errors',
  'examinerfeedback',
  'examinerremarks',
  'explanation',
  'feedback',
  'finalconclusion',
  'governingprovision',
  'improvements',
  'jurisprudence',
  'legalbasis',
  'legalexplanation',
  'legalreview',
  'materialexceptionsorlimits',
  'modelanswer',
  'modelansweralac',
  'modelanswers',
  'modelanswersections',
  'rationale',
  'holding',
  'disposition',
  'strengths',
  'suggestedanswer',
  'teachingexplanation',
  'whythisansweriscorrect',
]);

const VERBATIM_FIELD_NAMES = new Set([
  'access',
  'answertext',
  'attemptid',
  'classification',
  'createdat',
  'essayquestion',
  'gradedat',
  'prompt',
  'question',
  'questionid',
  'questiontext',
  'responseanswer',
  'responsetext',
  'status',
  'studentanswer',
  'updatedat',
  'useranswer',
  'userid',
]);

function normalizedFieldName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/gu, '');
}

function sanitizePayloadValue(value, seen, editorialContext, fieldName = '') {
  if (typeof value === 'string') {
    return editorialContext ? stripInternalEditorialBlocks(value) : value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return seen.get(value);
    const result = [];
    seen.set(value, result);
    value.forEach((entry) => result.push(sanitizePayloadValue(
      entry,
      seen,
      editorialContext,
      fieldName,
    )));
    return result;
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);

  const result = {};
  seen.set(value, result);
  Object.entries(value).forEach(([key, entry]) => {
    const normalizedKey = normalizedFieldName(key);
    const preserveVerbatim = VERBATIM_FIELD_NAMES.has(normalizedKey);
    const nextEditorialContext = preserveVerbatim
      ? false
      : (editorialContext || EDITORIAL_FIELD_NAMES.has(normalizedKey));
    result[key] = sanitizePayloadValue(entry, seen, nextEditorialContext, normalizedKey);
  });
  return result;
}

// Scrub every server-authored string at a learner-facing boundary. Explicit
// learner-authored answers and immutable question prompts remain byte-for-byte
// unchanged even when they discuss a rubric.
export function sanitizeLearnerFacingPayload(value) {
  return sanitizePayloadValue(value, new WeakMap(), true);
}

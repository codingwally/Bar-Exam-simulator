export const PHASE4_SUBJECTS = Object.freeze([
  'Political Law',
  'Labor Law',
  'Civil Law',
  'Taxation Law',
  'Mercantile Law',
  'Criminal Law',
  'Remedial Law',
  'Legal Ethics',
]);

const SUBJECT_ALIASES = Object.freeze({
  'Political and Public International Law': 'Political Law',
  'Labor Law': 'Labor Law',
  'Civil Law': 'Civil Law',
  'Taxation Law': 'Taxation Law',
  'Commercial Law': 'Mercantile Law',
  'Criminal Law': 'Criminal Law',
  'Remedial Law': 'Remedial Law',
  'Legal and Judicial Ethics': 'Legal Ethics',
});

export const REQUEST_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export class AccessValidationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'AccessValidationError';
    this.code = code;
    this.status = status;
  }
}

function clean(value) {
  return String(value ?? '')
    .replace(/\s*\(noun\)/gi, '')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function preserveQuestionText(value) {
  return String(value ?? '');
}

export function normalizeRequestKey(value) {
  const requestKey = clean(value);
  if (!REQUEST_KEY_PATTERN.test(requestKey)) {
    throw new AccessValidationError(
      'REQUEST_ID_REQUIRED',
      'This request could not be verified. Please try again.',
    );
  }
  return requestKey;
}

export function normalizeSubject(value) {
  const subject = clean(value);
  if (!PHASE4_SUBJECTS.includes(subject)) {
    throw new AccessValidationError(
      'INVALID_SUBJECT',
      'Choose one of the eight Philippine Bar subjects.',
    );
  }
  return subject;
}

export function publicQuestionFromRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const sourceSubject = clean(record.Subject);
  const subject = SUBJECT_ALIASES[sourceSubject];
  const id = clean(record['Question ID']);
  const prompt = preserveQuestionText(record['Essay Question']);
  if (
    !subject
    || !id
    || !prompt.trim()
    || prompt.includes('\u0000')
    || prompt.length > 20_000
  ) return null;
  return Object.freeze({
    id,
    subject,
    topic: clean(record.Topic),
    barYear: clean(record['Bar Year']),
    questionNo: clean(record['Question No.']),
    prompt,
    difficulty: clean(record.Difficulty),
  });
}

export function protectedQuestionInventory(records) {
  const bySubject = Object.fromEntries(PHASE4_SUBJECTS.map((subject) => [subject, []]));
  for (const record of records.values()) {
    const question = publicQuestionFromRecord(record);
    if (question) bySubject[question.subject].push(question);
  }
  for (const subject of PHASE4_SUBJECTS) {
    if (bySubject[subject].length !== 40) {
      throw new AccessValidationError(
        'QUESTION_BANK_INVALID',
        'The protected question bank is temporarily unavailable.',
        503,
      );
    }
  }
  return bySubject;
}

export function selectProtectedQuestion(records, options = {}) {
  const subject = normalizeSubject(options.subject);
  const excluded = new Set(
    Array.isArray(options.excludeQuestionIds)
      ? options.excludeQuestionIds.map(clean).filter(Boolean).slice(0, 40)
      : [],
  );
  const questions = protectedQuestionInventory(records)[subject];
  const requestedQuestionId = clean(options.questionId);
  if (requestedQuestionId) {
    const exact = questions.find((question) => question.id === requestedQuestionId);
    if (!exact) {
      throw new AccessValidationError(
        'QUESTION_NOT_FOUND',
        'The protected question could not be restored.',
        404,
      );
    }
    return exact;
  }
  const candidates = questions.filter((question) => !excluded.has(question.id));
  const pool = candidates.length ? candidates : questions;
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const rawIndex = Math.floor(Number(random()) * pool.length);
  const index = Math.max(0, Math.min(pool.length - 1, rawIndex));
  return pool[index];
}

export function normalizeAccessSnapshot(value) {
  if (!value || typeof value !== 'object') {
    throw new AccessValidationError(
      'ACCESS_UNAVAILABLE',
      'Your access status is temporarily unavailable.',
      503,
    );
  }
  return {
    allowed: value.allowed === true,
    basis: clean(value.basis || 'locked'),
    termsRequired: value.termsRequired === true,
    role: clean(value.role || 'student'),
    trial: {
      startedAt: value.trial?.startedAt || null,
      expiresAt: value.trial?.expiresAt || null,
      active: value.trial?.active === true,
    },
    freeGrades: {
      limit: 3,
      used: Math.max(0, Math.min(3, Number(value.freeGrades?.used) || 0)),
      remaining: Math.max(0, Math.min(3, Number(value.freeGrades?.remaining) || 0)),
    },
    freeBeta: {
      enabled: value.freeBeta?.enabled === true,
      expiresAt: value.freeBeta?.expiresAt || null,
      active: value.freeBeta?.active === true,
    },
    subscription: value.subscription && typeof value.subscription === 'object'
      ? {
        id: clean(value.subscription.id),
        planCode: clean(value.subscription.planCode),
        status: clean(value.subscription.status),
        source: clean(value.subscription.source),
        startsAt: value.subscription.startsAt || null,
        expiresAt: value.subscription.expiresAt || null,
      }
      : null,
  };
}

export function accessDeniedError(access) {
  if (access?.termsRequired) {
    return new AccessValidationError(
      'LEGAL_ACCEPTANCE_REQUIRED',
      'Review and accept the current Beta Terms and Privacy Notice before opening an examination.',
      403,
    );
  }
  return new AccessValidationError(
    'ACCESS_REQUIRED',
    'Your trial and lifetime free grades are exhausted. Choose an active plan to continue.',
    403,
  );
}

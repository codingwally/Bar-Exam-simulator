import { questionWebsiteVisibility } from './question-visibility-core.mjs';

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
export const MINIMUM_PROTECTED_QUESTIONS_PER_SUBJECT = 40;
export const FORECAST_QA_QUESTION_ID_PATTERN = /^FCT-2026-Q(?:00[1-9]|0[1-9]\d|1[01]\d|120)$/u;
const FORECAST_SUPERSESSION_NOTE_MARKER = 'Forecast supersedes Q&A IDs:';

export const WITHHELD_MOCK_BAR_QUESTION_IDS = Object.freeze([
  'TAX-2019-Q10A',
  'TAX-2019-Q10B',
]);

const WITHHELD_MOCK_BAR_QUESTION_ID_SET = new Set(WITHHELD_MOCK_BAR_QUESTION_IDS);

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

function boundedNumber(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(minimum, Math.min(maximum, numeric));
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
  if (FORECAST_QA_QUESTION_ID_PATTERN.test(id)) return null;
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

export function isProtectedQuestionWithheld(questionId) {
  return WITHHELD_MOCK_BAR_QUESTION_ID_SET.has(clean(questionId).toUpperCase());
}

function forecastSimulatorPreservedQuestionIds(records) {
  const preserved = new Set();
  for (const record of records.values()) {
    const forecastId = clean(record?.['Question ID']);
    if (!FORECAST_QA_QUESTION_ID_PATTERN.test(forecastId)) continue;
    if (questionWebsiteVisibility(record) !== 'visible') continue;
    const notes = String(record?.Notes || '');
    const markerIndex = notes.indexOf(FORECAST_SUPERSESSION_NOTE_MARKER);
    if (markerIndex < 0) continue;
    const start = markerIndex + FORECAST_SUPERSESSION_NOTE_MARKER.length;
    const end = notes.indexOf('.', start);
    const encodedIds = notes.slice(start, end < 0 ? undefined : end);
    for (const id of encodedIds.split(',').map(clean).filter(Boolean)) {
      if (/^[A-Za-z0-9][A-Za-z0-9-]{2,199}$/u.test(id)
          && !FORECAST_QA_QUESTION_ID_PATTERN.test(id)
          && records.has(id)) {
        preserved.add(id);
      }
    }
  }
  return preserved;
}

function simulatorQuestionVisible(records, questionId, preservedIds) {
  return questionWebsiteVisibility(records.get(questionId)) === 'visible'
    || preservedIds.has(questionId);
}

export function protectedQuestionInventory(records) {
  const bySubject = Object.fromEntries(PHASE4_SUBJECTS.map((subject) => [subject, []]));
  for (const record of records.values()) {
    const question = publicQuestionFromRecord(record);
    if (question) bySubject[question.subject].push(question);
  }
  const recognizedCount = Object.values(bySubject)
    .reduce((total, questions) => total + questions.length, 0);
  const simulatorRecordCount = [...records.values()].filter((record) => (
    !FORECAST_QA_QUESTION_ID_PATTERN.test(clean(record?.['Question ID']))
  )).length;
  for (const subject of PHASE4_SUBJECTS) {
    if (recognizedCount !== simulatorRecordCount
        || bySubject[subject].length < MINIMUM_PROTECTED_QUESTIONS_PER_SUBJECT) {
      throw new AccessValidationError(
        'QUESTION_BANK_INVALID',
        'The protected question bank is temporarily unavailable.',
        503,
      );
    }
  }
  return bySubject;
}

export function availableProtectedQuestionInventory(records) {
  const inventory = protectedQuestionInventory(records);
  const preservedIds = forecastSimulatorPreservedQuestionIds(records);
  return Object.fromEntries(PHASE4_SUBJECTS.map((subject) => [
    subject,
    inventory[subject].filter((question) => (
      !isProtectedQuestionWithheld(question.id)
      && simulatorQuestionVisible(records, question.id, preservedIds)
    )),
  ]));
}

export function selectProtectedQuestion(records, options = {}) {
  const subject = normalizeSubject(options.subject);
  const excluded = new Set(
    Array.isArray(options.excludeQuestionIds)
      ? options.excludeQuestionIds.map(clean).filter(Boolean).slice(0, 40)
      : [],
  );
  const inventory = protectedQuestionInventory(records)[subject]
    .filter((question) => !isProtectedQuestionWithheld(question.id));
  const preservedIds = forecastSimulatorPreservedQuestionIds(records);
  const requestedQuestionId = clean(options.questionId);
  if (requestedQuestionId) {
    // A visibility change stops new issuance without interrupting a paid user
    // who is restoring a question that was already issued to their workspace.
    const exact = inventory.find((question) => question.id === requestedQuestionId);
    if (!exact) {
      throw new AccessValidationError(
        'QUESTION_NOT_FOUND',
        'The protected question could not be restored.',
        404,
      );
    }
    return exact;
  }
  const questions = inventory.filter((question) => (
    simulatorQuestionVisible(records, question.id, preservedIds)
  ));
  if (!questions.length) {
    throw new AccessValidationError(
      'QUESTION_BANK_INVALID',
      'The protected question bank is temporarily unavailable.',
      503,
    );
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

  const commercialLaunchEnabled = value.commercialLaunchEnabled === true;
  const unlimited = value.unlimited === true;
  const basis = clean(value.basis || 'locked');
  const paidSubscriptionExpired = value.paidSubscriptionExpired === true
    || basis === 'paid_subscription_expired';
  const introductoryTokensEligible = value.introductoryTokensEligible !== false
    && !paidSubscriptionExpired;
  const tokenLimit = introductoryTokensEligible
    ? boundedNumber(
      value.tokenLimit ?? value.dailyLimit,
      commercialLaunchEnabled ? 0 : 5,
      0,
      100,
    )
    : 0;
  const tokensUsed = introductoryTokensEligible
    ? boundedNumber(value.tokensUsed ?? value.completedToday, 0, 0, 100_000)
    : 0;
  const tokensReserved = introductoryTokensEligible
    ? boundedNumber(value.tokensReserved ?? value.reservedToday, 0, 0, 100_000)
    : 0;
  const rawRemaining = introductoryTokensEligible
    ? boundedNumber(
      value.tokensRemaining ?? value.remainingToday ?? value.freeGrades?.remaining,
      0,
      0,
      100_000,
    )
    : 0;
  const tokensRemaining = tokenLimit > 0
    ? Math.min(tokenLimit, rawRemaining)
    : 0;
  const freeLimit = introductoryTokensEligible
    ? boundedNumber(value.freeGrades?.limit, tokenLimit, 0, 100)
    : 0;
  const freeUsed = introductoryTokensEligible
    ? boundedNumber(value.freeGrades?.used, tokensUsed, 0, 100_000)
    : 0;
  const freeRemaining = introductoryTokensEligible
    ? boundedNumber(value.freeGrades?.remaining, tokensRemaining, 0, 100_000)
    : 0;
  const choiceRequired = value.choiceRequired === true
    || value.planSelectionRequired === true
    || ['plan_selection_required', 'trial_expired', 'payment_required'].includes(basis);
  const accessMode = clean(value.accessMode || (unlimited ? 'unlimited' : 'introductory'));
  const accountLabel = clean(
    value.accountLabel || (unlimited ? 'Unlimited' : 'Introductory access'),
  );

  return {
    allowed: value.allowed === true,
    basis,
    termsRequired: value.termsRequired === true,
    reauthenticationRequired: value.reauthenticationRequired === true,
    profileCompleted: value.profileCompleted !== false,
    tokenAcknowledgementRequired: introductoryTokensEligible
      && value.tokenAcknowledgementRequired === true,
    choiceRequired,
    paymentRequired: value.paymentRequired === true
      || ['payment_required', 'paid_subscription_expired'].includes(basis),
    paidSubscriptionExpired,
    introductoryTokensEligible,
    planSelectionRequired: value.planSelectionRequired === true
      || ['plan_selection_required', 'trial_expired'].includes(basis),
    role: clean(value.role || 'student'),
    accessMode,
    accountLabel,
    unlimited,
    tokenLimit,
    tokensUsed,
    tokensReserved,
    tokensRemaining,
    tokenGrantAt: introductoryTokensEligible ? value.tokenGrantAt || null : null,
    tokenAcknowledgedAt: introductoryTokensEligible ? value.tokenAcknowledgedAt || null : null,
    tokenDisclosureVersion: clean(value.tokenDisclosureVersion) || null,
    // Compatibility aliases retained while older examination clients roll forward.
    dailyLimit: tokenLimit,
    completedToday: tokensUsed,
    reservedToday: tokensReserved,
    remainingToday: tokensRemaining,
    resetAt: value.resetAt || null,
    checkoutOpen: value.checkoutOpen === true,
    priceCentavos: boundedNumber(value.priceCentavos, 0, 0, 10_000_000),
    regularPriceCentavos: boundedNumber(
      value.regularPriceCentavos,
      19900,
      0,
      10_000_000,
    ),
    renewalAt: null,
    manualRenewal: value.manualRenewal === true,
    automaticRenewal: value.automaticRenewal === true,
    salesCloseAt: null,
    entitlementEndsAt: value.entitlementEndsAt || null,
    paymentState: clean(value.paymentState) || null,
    commercialLaunchEnabled,
    mandatoryAccessChoiceEnabled: value.mandatoryAccessChoiceEnabled === true,
    freeChoiceAvailable: value.freeChoiceAvailable === true,
    selectedChoice: clean(value.selectedChoice) || null,
    choiceRecordedAt: value.choiceRecordedAt || null,
    trialAvailable: value.trialAvailable === true,
    trialEndsAt: value.trialEndsAt || null,
    globalBeta: {
      enabled: value.globalBeta?.enabled === true,
      eligible: value.globalBeta?.eligible === true,
      active: value.globalBeta?.active === true,
      expiresAt: value.globalBeta?.expiresAt || null,
    },
    trial: {
      startedAt: value.trial?.startedAt || null,
      expiresAt: value.trial?.expiresAt || null,
      active: value.trial?.active === true,
      program: clean(value.trial?.program) || null,
    },
    freeGrades: {
      limit: freeLimit,
      used: freeUsed,
      remaining: freeRemaining,
    },
    freeBeta: {
      enabled: value.freeBeta?.enabled === true,
      expiresAt: value.freeBeta?.expiresAt || null,
      active: value.freeBeta?.active === true,
      program: clean(value.freeBeta?.program) || null,
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
      'Accept the current Terms of Use and Privacy Policy before choosing access.',
      403,
    );
  }

  if (access?.reauthenticationRequired || access?.basis === 'reauthentication_required') {
    return new AccessValidationError(
      'REAUTHENTICATION_REQUIRED',
      'Sign in with Google again to continue securely.',
      401,
    );
  }

  if (access?.basis === 'profile_required') {
    return new AccessValidationError(
      'PROFILE_COMPLETION_REQUIRED',
      'Confirm your profile and one-time token acknowledgement before continuing.',
      403,
    );
  }

  if (access?.paidSubscriptionExpired || access?.basis === 'paid_subscription_expired') {
    return new AccessValidationError(
      'PAID_SUBSCRIPTION_EXPIRED',
      access?.checkoutOpen === true
        ? 'Your paid Bar Exam Simulator access has expired. Choose the current published plan to continue. Home and Examination Room remain available.'
        : 'Your paid Bar Exam Simulator access has expired. Open Support for renewal assistance. Home and Examination Room remain available.',
      403,
    );
  }

  if (
    access?.choiceRequired
    || ['plan_selection_required', 'trial_expired', 'payment_required'].includes(access?.basis)
  ) {
    return new AccessValidationError(
      'ACCESS_CHOICE_REQUIRED',
      'Complete account setup before continuing.',
      403,
    );
  }

  if (
    access?.basis === 'trial_tokens_exhausted'
    || access?.basis === 'insufficient_introductory_tokens'
    || access?.tokensRemaining === 0
  ) {
    return new AccessValidationError(
      'INTRODUCTORY_TOKENS_EXHAUSTED',
      'Your five one-time practice tokens have been used. Choose the current Regular Subscription to continue.',
      403,
    );
  }

  return new AccessValidationError(
    'ACCESS_REQUIRED',
    'Choose an available access option to continue.',
    403,
  );
}

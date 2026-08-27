import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_GRADING_IDENTITY_MODE,
  DEFAULT_INTEGRITY_TIER,
  ERROR_CODES,
  GRADING_IDENTITY_MODES,
  GRADING_REVISION_STATUSES,
  INTEGRITY_TIERS,
  LIMITS,
  PUBLICATION_READINESS_CODES,
  QUESTION_TYPES,
  ROOM_KEY,
  SCHEMA_VERSIONS,
  buildGraderSubmissionView,
  buildGradingIdentity,
  buildGradingRevision,
  buildPublicationVersion,
  buildResultRelease,
  buildStudentExaminationView,
  buildSubmissionManifest,
  canonicalizeForHash,
  computeRoomKeyChecksum,
  createRoomKey,
  getPublicationReadiness,
  isExaminationRoomV1Error,
  isValidRoomKey,
  normalizeAnswerRevision,
  normalizeGradingRevisionManifest,
  normalizeProfessorDraft,
  normalizePublicationManifest,
  normalizeRoomKey,
  normalizeStudentIdentity,
  normalizeSubmissionManifest,
  toSafeError,
  validatePrivacyConsent,
} from './examination-room-v1-core.mjs';

const PUBLICATION_HASH = 'a'.repeat(64);

function makeReadyDraft(overrides = {}) {
  const questions = [
    {
      type: 'essay',
      prompt: 'Explain the governing rule.\r\nApply it to the facts.',
      points: 40.25,
      gradingGuidance: 'Credit a clear rule, application, and conclusion.',
      wordLimit: 1_200,
    },
    {
      type: 'multiple-choice',
      prompt: 'Which remedy is available?',
      points: 29.75,
      choices: ['Damages', 'Injunction', 'Rescission', 'None'],
      correctOptionIndex: 1,
    },
    {
      type: 'short-answer',
      prompt: 'Name the controlling doctrine.',
      points: 30.5,
      acceptedAnswers: ['Doctrine Alpha', ' doctrine alpha ', 'Doctrine A'],
    },
  ];
  return {
    title: '  Midterm Examination  ',
    subject: 'Civil Law',
    yearLevel: 'Fourth Year',
    instructions: 'Answer every question.\r\nSupport each conclusion.',
    privacyNoticeVersion: '2026-08-26',
    questions,
    ...overrides,
    questions: overrides.questions ?? questions,
  };
}

function makePublication(draft = makeReadyDraft(), overrides = {}) {
  return buildPublicationVersion({
    examinationId: 'exam-room-001',
    version: 1,
    publishedAt: '2026-08-26T01:00:00Z',
    draft,
    ...overrides,
  });
}

function makeStudentIdentity(overrides = {}) {
  return {
    realName: '  José P. Rizal  ',
    studentNumber: ' 2026-ab-001 ',
    subject: ' civil law ',
    yearLevel: 'Fourth Year',
    ...overrides,
  };
}

function makePrivacyConsent(overrides = {}) {
  return {
    noticeVersion: '2026-08-26',
    accepted: true,
    acceptedAt: '2026-08-26T01:05:00Z',
    recordingAccepted: false,
    ...overrides,
  };
}

function makeAnswerRevisions(publication = makePublication(), overrides = {}) {
  const base = [
    {
      attemptId: 'attempt-001',
      questionNumber: 1,
      revision: 1,
      idempotencyKey: 'answer-request-0001',
      answer: 'The first essay answer.',
    },
    {
      attemptId: 'attempt-001',
      questionNumber: 2,
      revision: 1,
      idempotencyKey: 'answer-request-0002',
      answer: 1,
    },
    {
      attemptId: 'attempt-001',
      questionNumber: 3,
      revision: 1,
      idempotencyKey: 'answer-request-0003',
      answer: 'Doctrine Alpha',
    },
  ];
  return base.map((revision, index) => ({ ...revision, ...(overrides[index] ?? {}) }));
}

function makeSubmission(options = {}) {
  const publication = options.publication ?? makePublication();
  return buildSubmissionManifest({
    submissionId: 'submission-001',
    attemptId: 'attempt-001',
    idempotencyKey: 'submission-request-0001',
    submittedAt: '2026-08-26T02:00:00Z',
    versionManifest: publication.manifest,
    publicationHash: PUBLICATION_HASH,
    studentIdentity: makeStudentIdentity(),
    privacyConsent: makePrivacyConsent(),
    answerRevisions: makeAnswerRevisions(publication),
    ...options.input,
  });
}

function makeFinalGrading(submission = makeSubmission(), overrides = {}) {
  return buildGradingRevision({
    revisionId: 'grade-revision-002',
    revision: 2,
    status: 'final',
    graderId: 'professor-001',
    gradedAt: '2026-08-26T04:00:00Z',
    idempotencyKey: 'grading-request-0002',
    scores: [
      { questionNumber: 1, pointsAwarded: 40.25, feedback: 'Strong analysis.' },
      { questionNumber: 2, pointsAwarded: 20, feedback: 'Review the available remedy.' },
      { questionNumber: 3, pointsAwarded: 25, feedback: 'Correct doctrine; explanation could be fuller.' },
    ],
    overallFeedback: 'A strong submission overall.',
    ...overrides,
  }, { submissionManifest: submission.manifest });
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectCode(action, code) {
  assert.throws(action, (error) => {
    assert.equal(isExaminationRoomV1Error(error), true);
    assert.equal(error.code, code);
    assert.equal(typeof error.message, 'string');
    assert.ok(error.message.length > 10);
    assert.doesNotMatch(error.message, /stack|database|worker|undefined|null reference/iu);
    return true;
  });
}

test('exports stable v1 constants and safe defaults', () => {
  assert.equal(SCHEMA_VERSIONS.PUBLICATION, 'examination-room/publication/v1');
  assert.deepEqual(Object.values(QUESTION_TYPES), ['essay', 'multiple-choice', 'short-answer']);
  assert.equal(DEFAULT_GRADING_IDENTITY_MODE, GRADING_IDENTITY_MODES.REAL_NAMES);
  assert.equal(DEFAULT_INTEGRITY_TIER, INTEGRITY_TIERS.STANDARD);
  assert.equal(ROOM_KEY.DISPLAY_PATTERN, 'ER1-XXXX-XXXX-C');
  assert.equal(Object.isFrozen(ERROR_CODES), true);
});

test('normalizes professor drafts, assigns deterministic numbers, and totals hundredths exactly', () => {
  const draft = normalizeProfessorDraft(makeReadyDraft());
  assert.equal(draft.title, 'Midterm Examination');
  assert.equal(draft.instructions, 'Answer every question.\nSupport each conclusion.');
  assert.equal(draft.identityMode, 'real_names');
  assert.equal(draft.integrityTier, 'standard');
  assert.equal(draft.questionCount, 3);
  assert.equal(draft.totalPoints, 100.5);
  assert.deepEqual(draft.questions.map(({ number, key, type }) => ({ number, key, type })), [
    { number: 1, key: 'q001', type: 'essay' },
    { number: 2, key: 'q002', type: 'multiple-choice' },
    { number: 3, key: 'q003', type: 'short-answer' },
  ]);
  assert.deepEqual(draft.questions[2].acceptedAnswers, ['Doctrine Alpha', 'Doctrine A']);
  assert.equal(Object.isFrozen(draft), true);
  assert.equal(Object.isFrozen(draft.questions), true);
  assert.equal(Object.isFrozen(draft.questions[0]), true);
});

test('normalization accepts question type spelling variants but emits one contract', () => {
  const draft = normalizeProfessorDraft(makeReadyDraft({
    questions: [
      { type: ' ESSAY ', prompt: 'One', points: 1 },
      { type: 'MULTIPLE_CHOICE', prompt: 'Two', points: 1, choices: ['A', 'B'], correctOptionIndex: 0 },
      { type: 'short answer', prompt: 'Three', points: 1 },
    ],
  }));
  assert.deepEqual(draft.questions.map((question) => question.type), [
    'essay',
    'multiple-choice',
    'short-answer',
  ]);
});

test('drafts may be incomplete, and readiness reports every resolvable publication issue', () => {
  const readiness = getPublicationReadiness({
    questions: [{ type: 'multiple-choice', choices: ['Same', ' same '], correctOptionIndex: null }],
  });
  assert.equal(readiness.ready, false);
  const codes = readiness.issues.map((issue) => issue.code);
  assert.ok(codes.includes(PUBLICATION_READINESS_CODES.TITLE_REQUIRED));
  assert.ok(codes.includes(PUBLICATION_READINESS_CODES.SUBJECT_REQUIRED));
  assert.ok(codes.includes(PUBLICATION_READINESS_CODES.YEAR_LEVEL_REQUIRED));
  assert.equal(codes.includes(PUBLICATION_READINESS_CODES.PRIVACY_NOTICE_REQUIRED), false);
  assert.ok(codes.includes(PUBLICATION_READINESS_CODES.QUESTION_PROMPT_REQUIRED));
  assert.ok(codes.includes(PUBLICATION_READINESS_CODES.QUESTION_POINTS_REQUIRED));
  assert.ok(codes.includes(PUBLICATION_READINESS_CODES.MULTIPLE_CHOICE_OPTIONS_UNIQUE));
  assert.ok(codes.includes(PUBLICATION_READINESS_CODES.MULTIPLE_CHOICE_KEY_REQUIRED));
  assert.equal(Object.isFrozen(readiness.issues), true);

  const noCustomPrivacyStep = getPublicationReadiness(makeReadyDraft({ privacyNoticeVersion: '' }));
  assert.equal(noCustomPrivacyStep.ready, true);
  assert.equal(noCustomPrivacyStep.draft.privacyNoticeVersion, 'exam-room-direct-entry-v1');
});

test('rejects structurally invalid and hostile professor draft input safely', () => {
  expectCode(() => normalizeProfessorDraft(null), ERROR_CODES.REQUEST_OBJECT_INVALID);
  expectCode(() => normalizeProfessorDraft([]), ERROR_CODES.REQUEST_OBJECT_INVALID);
  expectCode(
    () => normalizeProfessorDraft({ ...makeReadyDraft(), surprise: true }),
    ERROR_CODES.REQUEST_FIELD_NOT_ALLOWED,
  );
  expectCode(
    () => normalizeProfessorDraft(makeReadyDraft({ questions: [{ type: 'unsupported' }] })),
    ERROR_CODES.QUESTION_TYPE_INVALID,
  );
  expectCode(
    () => normalizeProfessorDraft(makeReadyDraft({ questions: [{ type: 'essay', prompt: 'A', points: Number.NaN }] })),
    ERROR_CODES.QUESTION_POINTS_INVALID,
  );
  expectCode(
    () => normalizeProfessorDraft(makeReadyDraft({ questions: [{ type: 'essay', prompt: 'A', points: 1.001 }] })),
    ERROR_CODES.QUESTION_POINTS_INVALID,
  );
  expectCode(
    () => normalizeProfessorDraft(makeReadyDraft({ questions: Array.from({ length: LIMITS.MAX_QUESTIONS + 1 }, () => ({ type: 'essay' })) })),
    ERROR_CODES.QUESTION_LIST_INVALID,
  );

  const inherited = Object.create({ title: 'inherited' });
  inherited.questions = [];
  expectCode(() => normalizeProfessorDraft(inherited), ERROR_CODES.REQUEST_OBJECT_INVALID);

  const accessor = { questions: [] };
  Object.defineProperty(accessor, 'title', {
    enumerable: true,
    get() {
      throw new Error('this getter must never execute');
    },
  });
  expectCode(() => normalizeProfessorDraft(accessor), ERROR_CODES.REQUEST_FIELD_ACCESSOR_NOT_ALLOWED);

  const sparseQuestions = Array(1);
  expectCode(
    () => normalizeProfessorDraft(makeReadyDraft({ questions: sparseQuestions })),
    ERROR_CODES.REQUEST_OBJECT_INVALID,
  );

  const accessorChoices = ['A', 'B'];
  Object.defineProperty(accessorChoices, '0', {
    enumerable: true,
    get() {
      throw new Error('this array getter must never execute');
    },
  });
  expectCode(
    () => normalizeProfessorDraft(makeReadyDraft({
      questions: [{ type: 'multiple-choice', prompt: 'A', points: 1, choices: accessorChoices }],
    })),
    ERROR_CODES.REQUEST_FIELD_ACCESSOR_NOT_ALLOWED,
  );
});

test('rejects caller-supplied numbering, mismatched derived totals, and type-specific fields', () => {
  expectCode(
    () => normalizeProfessorDraft(makeReadyDraft({
      questions: [{ number: 9, type: 'essay', prompt: 'A', points: 1 }],
    })),
    ERROR_CODES.QUESTION_NUMBER_INVALID,
  );
  expectCode(
    () => normalizeProfessorDraft({ ...makeReadyDraft(), totalPoints: 999 }),
    ERROR_CODES.DRAFT_DERIVED_VALUE_MISMATCH,
  );
  expectCode(
    () => normalizeProfessorDraft(makeReadyDraft({
      questions: [{ type: 'essay', prompt: 'A', points: 1, choices: ['Not allowed'] }],
    })),
    ERROR_CODES.QUESTION_FIELD_INVALID,
  );
});

test('builds a deeply immutable publication manifest and deterministic canonical hash input', () => {
  const first = makePublication();
  const reorderedDraft = {
    questions: makeReadyDraft().questions,
    privacyNoticeVersion: '2026-08-26',
    instructions: 'Answer every question.\nSupport each conclusion.',
    yearLevel: 'Fourth Year',
    subject: 'Civil Law',
    title: 'Midterm Examination',
  };
  const second = makePublication(reorderedDraft);
  assert.equal(first.hashInput, second.hashInput);
  assert.equal(first.manifest.schemaVersion, SCHEMA_VERSIONS.PUBLICATION);
  assert.equal(first.manifest.publishedAt, '2026-08-26T01:00:00.000Z');
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.manifest.questions[1].choices), true);
  assert.throws(() => {
    first.manifest.questions[0].points = 0;
  }, TypeError);
  assert.deepEqual(normalizePublicationManifest(cloneJson(first.manifest)), first.manifest);
});

test('publication is blocked until ready and rejects invalid immutable-manifest claims', () => {
  expectCode(
    () => makePublication(makeReadyDraft({ questions: [] })),
    ERROR_CODES.PUBLICATION_NOT_READY,
  );
  const tampered = cloneJson(makePublication().manifest);
  tampered.totalPoints = 1;
  expectCode(() => normalizePublicationManifest(tampered), ERROR_CODES.DRAFT_DERIVED_VALUE_MISMATCH);
});

test('student examination views omit answer keys and grading guidance', () => {
  const view = buildStudentExaminationView(makePublication().manifest);
  assert.equal('correctOptionIndex' in view.questions[1], false);
  assert.equal('acceptedAnswers' in view.questions[2], false);
  assert.equal('gradingGuidance' in view.questions[0], false);
  assert.deepEqual(view.questions[1].choices, ['Damages', 'Injunction', 'Rescission', 'None']);
  assert.equal(Object.isFrozen(view.questions[1].choices), true);
});

test('canonical hash input sorts object keys and rejects non-JSON, cyclic, and exotic inputs', () => {
  assert.equal(
    canonicalizeForHash({ z: 3, a: { d: -0, b: [true, null] } }),
    '{"a":{"b":[true,null],"d":0},"z":3}',
  );
  expectCode(() => canonicalizeForHash({ missing: undefined }), ERROR_CODES.HASH_INPUT_INVALID);
  expectCode(() => canonicalizeForHash(new Date()), ERROR_CODES.HASH_INPUT_INVALID);
  const cycle = {};
  cycle.self = cycle;
  expectCode(() => canonicalizeForHash(cycle), ERROR_CODES.HASH_INPUT_INVALID);
  expectCode(() => canonicalizeForHash(Array(1)), ERROR_CODES.REQUEST_OBJECT_INVALID);
});

test('creates human room keys with unambiguous characters and validates normalized entry', () => {
  const payload = '2345ABCD';
  const checksum = computeRoomKeyChecksum(payload);
  const roomKey = createRoomKey(payload);
  assert.match(roomKey, /^ER1-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]$/u);
  assert.equal(roomKey.at(-1), checksum);
  assert.equal(normalizeRoomKey(roomKey.toLowerCase().replaceAll('-', ' ')), roomKey);
  assert.equal(isValidRoomKey(roomKey), true);
  assert.equal(isValidRoomKey('ER1-OOOO-OOOO-O'), false);
});

test('room key errors distinguish invalid payload, format, and checksum', () => {
  expectCode(() => createRoomKey('ABC'), ERROR_CODES.ROOM_KEY_PAYLOAD_INVALID);
  expectCode(() => createRoomKey('ABCDIO12'), ERROR_CODES.ROOM_KEY_PAYLOAD_INVALID);
  expectCode(() => normalizeRoomKey('not-a-key'), ERROR_CODES.ROOM_KEY_FORMAT_INVALID);
  const valid = createRoomKey('2345ABCD');
  const replacement = valid.at(-1) === '2' ? '3' : '2';
  expectCode(() => normalizeRoomKey(valid.slice(0, -1) + replacement), ERROR_CODES.ROOM_KEY_CHECKSUM_INVALID);
});

test('normalizes complete student identity without replacing real names for anonymous grading', () => {
  const identity = normalizeStudentIdentity(makeStudentIdentity());
  assert.deepEqual(identity, {
    realName: 'José P. Rizal',
    studentNumber: '2026-AB-001',
    subject: 'civil law',
    yearLevel: 'Fourth Year',
  });
  const anonymous = buildGradingIdentity({
    identityMode: 'anonymous_grading',
    studentIdentity: identity,
    anonymousCandidateId: ' candidate-2a4b6c ',
  });
  assert.deepEqual(anonymous, { mode: 'anonymous_grading', anonymousCandidateId: 'CANDIDATE-2A4B6C' });
  assert.equal(JSON.stringify(anonymous).includes('Rizal'), false);
});

test('student identity rejects missing, hidden-character, and malformed values', () => {
  expectCode(
    () => normalizeStudentIdentity(makeStudentIdentity({ realName: '' })),
    ERROR_CODES.STUDENT_IDENTITY_INVALID,
  );
  expectCode(
    () => normalizeStudentIdentity(makeStudentIdentity({ realName: 'Jo\u202En' })),
    ERROR_CODES.TEXT_INVALID,
  );
  expectCode(
    () => normalizeStudentIdentity(makeStudentIdentity({ studentNumber: '@@@' })),
    ERROR_CODES.STUDENT_IDENTITY_INVALID,
  );
});

test('validates privacy notice consent against the exact version', () => {
  const consent = validatePrivacyConsent(makePrivacyConsent(), {
    requiredNoticeVersion: '2026-08-26',
    integrityTier: 'focus_monitoring',
  });
  assert.equal(consent.acceptedAt, '2026-08-26T01:05:00.000Z');
  assert.equal(consent.recordingAccepted, false);
  expectCode(
    () => validatePrivacyConsent(makePrivacyConsent({ accepted: false }), {
      requiredNoticeVersion: '2026-08-26',
      integrityTier: 'standard',
    }),
    ERROR_CODES.PRIVACY_CONSENT_REQUIRED,
  );
  expectCode(
    () => validatePrivacyConsent(makePrivacyConsent({ noticeVersion: '2026-01-01' }), {
      requiredNoticeVersion: '2026-08-26',
      integrityTier: 'standard',
    }),
    ERROR_CODES.PRIVACY_CONSENT_VERSION_MISMATCH,
  );
});

test('recorded proctoring requires separate recording consent and a valid UTC time', () => {
  expectCode(
    () => validatePrivacyConsent(makePrivacyConsent(), {
      requiredNoticeVersion: '2026-08-26',
      integrityTier: 'recorded_proctoring',
    }),
    ERROR_CODES.RECORDING_CONSENT_REQUIRED,
  );
  expectCode(
    () => validatePrivacyConsent(makePrivacyConsent({ acceptedAt: '2026-02-30T01:00:00Z' }), {
      requiredNoticeVersion: '2026-08-26',
      integrityTier: 'standard',
    }),
    ERROR_CODES.TIMESTAMP_INVALID,
  );
  const consent = validatePrivacyConsent(makePrivacyConsent({ recordingAccepted: true }), {
    requiredNoticeVersion: '2026-08-26',
    integrityTier: 'recorded_proctoring',
  });
  assert.equal(consent.recordingAccepted, true);
});

test('normalizes answer revisions and creates a stable idempotency input bound to the publication', () => {
  const publication = makePublication();
  const revision = normalizeAnswerRevision({
    attemptId: 'attempt-001',
    questionNumber: 1,
    revision: 2,
    idempotencyKey: 'answer-request-1001',
    answer: 'Line one.\r\nLine two.',
  }, { versionManifest: publication.manifest, publicationHash: PUBLICATION_HASH.toUpperCase() });
  assert.equal(revision.answer, 'Line one.\nLine two.');
  assert.equal(revision.questionKey, 'q001');
  assert.equal(revision.questionType, 'essay');
  assert.equal(revision.publicationHash, PUBLICATION_HASH);
  assert.equal(revision.idempotencyInput.includes('answer-request-1001'), false);
  assert.equal(Object.isFrozen(revision), true);
  assert.deepEqual(
    normalizeAnswerRevision(cloneJson(revision), {
      versionManifest: publication.manifest,
      publicationHash: PUBLICATION_HASH,
    }),
    revision,
  );
});

test('answer revisions reject unavailable questions, invalid options, weak keys, and stale derived bindings', () => {
  const publication = makePublication();
  const context = { versionManifest: publication.manifest, publicationHash: PUBLICATION_HASH };
  expectCode(
    () => normalizeAnswerRevision({
      attemptId: 'attempt-001', questionNumber: 99, revision: 1, idempotencyKey: 'answer-request-9999', answer: 'A',
    }, context),
    ERROR_CODES.ANSWER_QUESTION_NOT_FOUND,
  );
  expectCode(
    () => normalizeAnswerRevision({
      attemptId: 'attempt-001', questionNumber: 2, revision: 1, idempotencyKey: 'answer-request-9998', answer: 9,
    }, context),
    ERROR_CODES.ANSWER_VALUE_INVALID,
  );
  expectCode(
    () => normalizeAnswerRevision({
      attemptId: 'attempt-001', questionNumber: 1, revision: 1, idempotencyKey: 'short', answer: 'A',
    }, context),
    ERROR_CODES.IDEMPOTENCY_KEY_INVALID,
  );
  expectCode(
    () => normalizeAnswerRevision({
      attemptId: 'attempt-001',
      questionNumber: 1,
      revision: 1,
      idempotencyKey: 'answer-request-9997',
      answer: 'A',
      publicationHash: 'b'.repeat(64),
    }, context),
    ERROR_CODES.ANSWER_BINDING_MISMATCH,
  );
});

test('submission selects the latest revision for every question and emits a frozen manifest', () => {
  const publication = makePublication();
  const revisions = makeAnswerRevisions(publication);
  revisions.push({
    attemptId: 'attempt-001',
    questionNumber: 1,
    revision: 2,
    idempotencyKey: 'answer-request-0004',
    answer: 'The revised and final essay answer.',
  });
  revisions.push({ ...revisions.at(-1) }); // an idempotent retry is harmless
  const submission = makeSubmission({
    publication,
    input: { answerRevisions: revisions },
  });
  assert.equal(submission.manifest.schemaVersion, SCHEMA_VERSIONS.SUBMISSION);
  assert.equal(submission.manifest.questions[0].revision, 2);
  assert.equal(submission.manifest.questions[0].answer, 'The revised and final essay answer.');
  assert.equal(submission.manifest.questionCount, 3);
  assert.equal(submission.manifest.maxPoints, 100.5);
  assert.equal(Object.isFrozen(submission.manifest.questions[0]), true);
  assert.deepEqual(normalizeSubmissionManifest(cloneJson(submission.manifest)), submission.manifest);
});

test('submission rejects missing answers, mismatched identity fields, and answer revision conflicts', () => {
  const publication = makePublication();
  expectCode(
    () => makeSubmission({ publication, input: { answerRevisions: makeAnswerRevisions(publication).slice(0, 2) } }),
    ERROR_CODES.SUBMISSION_ANSWER_MISSING,
  );
  expectCode(
    () => makeSubmission({ publication, input: { studentIdentity: makeStudentIdentity({ subject: 'Criminal Law' }) } }),
    ERROR_CODES.STUDENT_SUBJECT_MISMATCH,
  );

  const conflict = makeAnswerRevisions(publication);
  conflict.push({ ...conflict[0], answer: 'Different content for the same revision.', idempotencyKey: 'answer-request-0088' });
  expectCode(
    () => makeSubmission({ publication, input: { answerRevisions: conflict } }),
    ERROR_CODES.ANSWER_REVISION_CONFLICT,
  );

  const reusedKey = makeAnswerRevisions(publication);
  reusedKey[1].idempotencyKey = reusedKey[0].idempotencyKey;
  expectCode(
    () => makeSubmission({ publication, input: { answerRevisions: reusedKey } }),
    ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
  );
});

test('anonymous grading remains professor-controlled and grader views contain no real identity', () => {
  const publication = makePublication(makeReadyDraft({ identityMode: 'anonymous_grading' }));
  expectCode(
    () => makeSubmission({ publication }),
    ERROR_CODES.ANONYMOUS_CANDIDATE_ID_REQUIRED,
  );
  const submission = makeSubmission({
    publication,
    input: { anonymousCandidateId: 'candidate-abcd12' },
  });
  assert.deepEqual(submission.manifest.gradingIdentity, {
    mode: 'anonymous_grading',
    anonymousCandidateId: 'CANDIDATE-ABCD12',
  });
  const graderView = buildGraderSubmissionView(submission.manifest);
  assert.equal('studentIdentity' in graderView, false);
  assert.equal(JSON.stringify(graderView).includes('José'), false);
  assert.equal(JSON.stringify(graderView).includes('2026-AB-001'), false);
});

test('recorded-proctoring submission cannot bypass recording consent', () => {
  const publication = makePublication(makeReadyDraft({ integrityTier: 'recorded_proctoring' }));
  expectCode(
    () => makeSubmission({ publication }),
    ERROR_CODES.RECORDING_CONSENT_REQUIRED,
  );
  const submission = makeSubmission({
    publication,
    input: { privacyConsent: makePrivacyConsent({ recordingAccepted: true }) },
  });
  assert.equal(submission.manifest.integrityTier, 'recorded_proctoring');
  assert.equal(submission.manifest.privacyConsent.recordingAccepted, true);
});

test('submission manifest normalization detects tampered derived values and answers', () => {
  const totalTamper = cloneJson(makeSubmission().manifest);
  totalTamper.maxPoints = 999;
  expectCode(() => normalizeSubmissionManifest(totalTamper), ERROR_CODES.SUBMISSION_MANIFEST_INVALID);

  const answerTamper = cloneJson(makeSubmission().manifest);
  answerTamper.questions[1].answer = 99;
  expectCode(() => normalizeSubmissionManifest(answerTamper), ERROR_CODES.ANSWER_VALUE_INVALID);
});

test('builds draft and final grading revisions with exact point totals', () => {
  const submission = makeSubmission();
  const draft = buildGradingRevision({
    revisionId: 'grade-revision-001',
    revision: 1,
    status: 'draft',
    graderId: 'professor-001',
    gradedAt: '2026-08-26T03:00:00Z',
    idempotencyKey: 'grading-request-0001',
    scores: [{ questionNumber: 1, pointsAwarded: 20.25, feedback: 'In progress.' }],
    overallFeedback: '',
  }, { submissionManifest: submission.manifest });
  assert.equal(draft.manifest.status, GRADING_REVISION_STATUSES.DRAFT);
  assert.equal(draft.manifest.totalPointsAwarded, 20.25);

  const final = makeFinalGrading(submission);
  assert.equal(final.manifest.status, GRADING_REVISION_STATUSES.FINAL);
  assert.equal(final.manifest.totalPointsAwarded, 85.25);
  assert.equal(final.manifest.maxPoints, 100.5);
  assert.deepEqual(
    normalizeGradingRevisionManifest(cloneJson(final.manifest), { submissionManifest: submission.manifest }),
    final.manifest,
  );
});

test('grading rejects incomplete final revisions, excess points, duplicates, and fractional thousandths', () => {
  const submission = makeSubmission();
  const base = {
    revisionId: 'grade-revision-003',
    revision: 3,
    status: 'final',
    graderId: 'professor-001',
    gradedAt: '2026-08-26T05:00:00Z',
    idempotencyKey: 'grading-request-0003',
    overallFeedback: '',
  };
  expectCode(
    () => buildGradingRevision({
      ...base,
      scores: [{ questionNumber: 1, pointsAwarded: 10, feedback: '' }],
    }, { submissionManifest: submission.manifest }),
    ERROR_CODES.GRADING_INCOMPLETE,
  );
  expectCode(
    () => buildGradingRevision({
      ...base,
      scores: [
        { questionNumber: 1, pointsAwarded: 50, feedback: '' },
        { questionNumber: 2, pointsAwarded: 0, feedback: '' },
        { questionNumber: 3, pointsAwarded: 0, feedback: '' },
      ],
    }, { submissionManifest: submission.manifest }),
    ERROR_CODES.GRADING_SCORE_INVALID,
  );
  expectCode(
    () => buildGradingRevision({
      ...base,
      status: 'draft',
      scores: [
        { questionNumber: 1, pointsAwarded: 1, feedback: '' },
        { questionNumber: 1, pointsAwarded: 2, feedback: '' },
      ],
    }, { submissionManifest: submission.manifest }),
    ERROR_CODES.GRADING_SCORE_DUPLICATE,
  );
  expectCode(
    () => buildGradingRevision({
      ...base,
      status: 'draft',
      scores: [{ questionNumber: 1, pointsAwarded: 1.001, feedback: '' }],
    }, { submissionManifest: submission.manifest }),
    ERROR_CODES.GRADING_SCORE_INVALID,
  );

  const invalidStoredRevision = cloneJson(makeFinalGrading(submission).manifest);
  invalidStoredRevision.publicationHash = 42;
  expectCode(
    () => normalizeGradingRevisionManifest(invalidStoredRevision, { submissionManifest: submission.manifest }),
    ERROR_CODES.TEXT_INVALID,
  );

  const accessorStoredRevision = cloneJson(makeFinalGrading(submission).manifest);
  Object.defineProperty(accessorStoredRevision.scores[0], 'feedback', {
    enumerable: true,
    get() {
      throw new Error('this getter must never execute');
    },
  });
  expectCode(
    () => normalizeGradingRevisionManifest(accessorStoredRevision, { submissionManifest: submission.manifest }),
    ERROR_CODES.REQUEST_FIELD_ACCESSOR_NOT_ALLOWED,
  );
});

test('result release explicitly selects and snapshots one final grading revision', () => {
  const submission = makeSubmission();
  const draft = buildGradingRevision({
    revisionId: 'grade-revision-001',
    revision: 1,
    status: 'draft',
    graderId: 'professor-001',
    gradedAt: '2026-08-26T03:00:00Z',
    idempotencyKey: 'grading-request-0001',
    scores: [{ questionNumber: 1, pointsAwarded: 20, feedback: 'Draft.' }],
    overallFeedback: '',
  }, { submissionManifest: submission.manifest });
  const final = makeFinalGrading(submission);
  const release = buildResultRelease({
    releaseId: 'release-001',
    selectedRevisionId: final.manifest.revisionId,
    releasedAt: '2026-08-26T05:00:00Z',
    releasedBy: 'admin-001',
    idempotencyKey: 'release-request-0001',
  }, {
    submissionManifest: submission.manifest,
    gradingRevisions: [draft, cloneJson(final.manifest)],
  });
  assert.equal(release.manifest.schemaVersion, SCHEMA_VERSIONS.RESULT_RELEASE);
  assert.equal(release.manifest.selectedRevision, 2);
  assert.equal(release.manifest.result.totalPointsAwarded, 85.25);
  assert.deepEqual(release.manifest.result.scores, final.manifest.scores);
  assert.equal(Object.isFrozen(release.manifest.result.scores), true);
  assert.equal(release.hashInput, canonicalizeForHash(release.manifest));
});

test('result release rejects missing, draft, and duplicate revision selections', () => {
  const submission = makeSubmission();
  const draft = buildGradingRevision({
    revisionId: 'grade-revision-001',
    revision: 1,
    status: 'draft',
    graderId: 'professor-001',
    gradedAt: '2026-08-26T03:00:00Z',
    idempotencyKey: 'grading-request-0001',
    scores: [{ questionNumber: 1, pointsAwarded: 20, feedback: '' }],
    overallFeedback: '',
  }, { submissionManifest: submission.manifest });
  const final = makeFinalGrading(submission);
  const base = {
    releaseId: 'release-002',
    releasedAt: '2026-08-26T05:00:00Z',
    releasedBy: 'admin-001',
    idempotencyKey: 'release-request-0002',
  };
  expectCode(
    () => buildResultRelease({ ...base, selectedRevisionId: 'grade-revision-999' }, {
      submissionManifest: submission.manifest,
      gradingRevisions: [final.manifest],
    }),
    ERROR_CODES.RESULT_REVISION_NOT_FOUND,
  );
  expectCode(
    () => buildResultRelease({ ...base, selectedRevisionId: draft.manifest.revisionId }, {
      submissionManifest: submission.manifest,
      gradingRevisions: [draft.manifest, final.manifest],
    }),
    ERROR_CODES.RESULT_REVISION_NOT_FINAL,
  );
  expectCode(
    () => buildResultRelease({ ...base, selectedRevisionId: final.manifest.revisionId }, {
      submissionManifest: submission.manifest,
      gradingRevisions: [final.manifest, cloneJson(final.manifest)],
    }),
    ERROR_CODES.RESULT_REVISION_DUPLICATE,
  );
});

test('safe errors expose stable recovery messages and hide unexpected exception details', () => {
  let domainError;
  try {
    normalizeRoomKey('bad');
  } catch (error) {
    domainError = error;
  }
  assert.deepEqual(toSafeError(domainError), {
    code: ERROR_CODES.ROOM_KEY_FORMAT_INVALID,
    message: `Enter the room key in ${ROOM_KEY.DISPLAY_PATTERN} format. The letters I and O are not used.`,
    details: { field: 'roomKey' },
  });
  const safeUnknown = toSafeError(new Error('secret internal failure with credentials'));
  assert.equal(safeUnknown.code, ERROR_CODES.INTERNAL_ERROR);
  assert.equal(JSON.stringify(safeUnknown).includes('secret'), false);
  assert.equal(Object.isFrozen(safeUnknown), true);
});

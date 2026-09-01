import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BAR_FORECAST_ADMIN_ROLES,
  BAR_FORECAST_CONSENT_VERSION,
  BAR_FORECAST_CONTENT_TYPE,
  BAR_FORECAST_GRADING_RESPONSE_SCHEMA,
  BAR_FORECAST_LIMITS,
  BAR_FORECAST_MEMBER_BASES,
  BAR_FORECAST_PAID_SUBSCRIPTION_SOURCES,
  BAR_FORECAST_SOURCE_VERSION,
  BAR_FORECAST_SUBJECTS,
  BarForecastError,
  answersForForecastRows,
  buildBarForecastGradingPrompt,
  completeBarForecastResult,
  forecastSetId,
  forecastGradingBatches,
  barForecastEntitlementEvidence,
  normalizeBarForecastRequest,
  publicForecastQuestions,
  requireBarForecastAccess,
  validateBarForecastGradingResult,
  validatedForecastRows,
} from './bar-forecast-core.mjs';

const SUBJECT = BAR_FORECAST_SUBJECTS[0];
const SET_ID = `sha256:${'a'.repeat(64)}`;

function rawForecastItems(subject = SUBJECT) {
  return Array.from({ length: BAR_FORECAST_LIMITS.questionsPerSubject }, (_, index) => {
    const number = index + 1;
    return {
      id: `forecast-test-${number}`,
      contentType: BAR_FORECAST_CONTENT_TYPE,
      subject,
      title: `POL-${String(number).padStart(2, '0')} — Forecast test question ${number}`,
      version: BAR_FORECAST_SOURCE_VERSION,
      checksum: number.toString(16).padStart(64, '0'),
      payload: {
        id: `forecast-test-${number}`,
        subject,
        version: BAR_FORECAST_SOURCE_VERSION,
        editorial_ref: `POL-${String(number).padStart(2, '0')}`,
        title: `Forecast test question ${number}`,
        rank_within_subject: number,
        prompt: `Question ${number} asks whether the stated official doctrine applies to these complete facts?`,
        suggested_answer: `Answer: Yes. Curated suggested answer ${number} applies the stated facts and reaches the supported conclusion.`,
        legal_basis: `The curated legal basis for question ${number} states the single controlling rule and its legally relevant conditions in sufficient detail.`,
        controlling_doctrine: `The curated controlling doctrine for question ${number} is the exclusive legal rule used to decide the stated issue.`,
        jurisprudence: `Curated Case ${number}`,
        citation: `G.R. No. 100${number}, January 1, 2025`,
        prediction_score: 99,
        prediction_rationale: 'Hidden prediction rationale.',
      },
    };
  });
}

function completeAnswers() {
  return Array.from({ length: BAR_FORECAST_LIMITS.questionsPerSubject }, (_, index) => ({
    questionId: `forecast-test-${index + 1}`,
    answer: `Yes. This answer number ${index + 1} states the rule, applies every relevant stated fact, and gives a reasoned conclusion.`,
  }));
}

function currentUnlimitedAccess(overrides = {}) {
  return {
    allowed: true,
    unlimited: true,
    role: 'student',
    basis: 'paid_subscription',
    termsRequired: false,
    reauthenticationRequired: false,
    profileCompleted: true,
    tokenAcknowledgementRequired: false,
    paidSubscriptionExpired: false,
    ...overrides,
  };
}

function gradingEntry(row, overrides = {}) {
  return {
    questionId: row.id,
    score: 4.5,
    grammar: {
      score: 4,
      corrections: [{
        original: `Yes. This answer number ${row.number}`,
        category: 'punctuation',
      }],
    },
    issueSpotting: {
      score: 3.5,
      identified: [row.prompt],
      missed: [row.suggestedAnswer],
    },
    ...overrides,
  };
}

test('Forecast access admits administrators and every current setup-ready unlimited member', () => {
  for (const role of BAR_FORECAST_ADMIN_ROLES) {
    assert.deepEqual(requireBarForecastAccess({
      administrator: { authorized: true, role },
      access: { role: 'student', basis: 'locked' },
    }), {
      authorized: true,
      kind: 'administrator',
      role,
      basis: 'locked',
    });
  }

  assert.deepEqual(BAR_FORECAST_MEMBER_BASES, [
    'early_access', 'founding_beta', 'paid_subscription',
  ]);
  assert.deepEqual(BAR_FORECAST_PAID_SUBSCRIPTION_SOURCES, [
    'admin_adjustment', 'manual_payment', 'migration',
  ]);
  for (const basis of ['early_access', 'paid_subscription']) {
    for (const source of BAR_FORECAST_PAID_SUBSCRIPTION_SOURCES) {
      assert.deepEqual(requireBarForecastAccess({
        administrator: null,
        access: currentUnlimitedAccess({
          basis,
          subscription: { status: 'active', source },
        }),
      }), {
        authorized: true,
        kind: 'member',
        role: 'student',
        basis,
      });
    }
  }
  assert.deepEqual(requireBarForecastAccess({
    administrator: null,
    access: currentUnlimitedAccess({
      basis: 'founding_beta',
      freeBeta: { active: true, program: 'founding_beta_2026' },
    }),
  }), {
    authorized: true,
    kind: 'member',
    role: 'student',
    basis: 'founding_beta',
  });

  for (const access of [
    currentUnlimitedAccess({ basis: 'provisional_payment' }),
    currentUnlimitedAccess({
      basis: 'paid_subscription',
      subscription: { status: 'active', source: 'complimentary' },
    }),
    currentUnlimitedAccess({ basis: 'partner_unlimited' }),
    currentUnlimitedAccess({
      basis: 'founding_beta',
      freeBeta: { active: false, program: 'other_program' },
    }),
  ]) {
    assert.deepEqual(requireBarForecastAccess({ administrator: null, access }), {
      authorized: true,
      kind: 'member',
      role: 'student',
      basis: access.basis,
    });
  }

  for (const context of [
    null,
    { administrator: { authorized: false, role: 'super_admin' }, access: null },
    { administrator: { authorized: true, role: 'subscriber' }, access: null },
    { administrator: null, access: currentUnlimitedAccess({ unlimited: false, basis: 'introductory_tokens' }) },
    { administrator: null, access: currentUnlimitedAccess({ allowed: false }) },
    {
      administrator: null,
      access: currentUnlimitedAccess({ paidSubscriptionExpired: true }),
    },
    {
      administrator: null,
      access: currentUnlimitedAccess({ basis: 'paid_subscription_expired' }),
    },
    {
      administrator: null,
      access: currentUnlimitedAccess({ termsRequired: true }),
    },
    {
      administrator: null,
      access: currentUnlimitedAccess({ reauthenticationRequired: true }),
    },
    {
      administrator: null,
      access: currentUnlimitedAccess({ profileCompleted: false }),
    },
    {
      administrator: null,
      access: currentUnlimitedAccess({ tokenAcknowledgementRequired: true }),
    },
    {
      administrator: null,
      access: currentUnlimitedAccess({ role: '' }),
    },
    {
      administrator: null,
      access: currentUnlimitedAccess({ basis: '' }),
    },
  ]) {
    assert.throws(
      () => requireBarForecastAccess(context),
      (error) => error instanceof BarForecastError
        && error.code === 'BAR_FORECAST_ACCESS_REQUIRED'
        && error.status === 403,
    );
  }
});

test('Forecast entitlement evidence survives setup masking without authorizing access early', () => {
  const setupMasks = [
    {
      allowed: false,
      unlimited: false,
      basis: 'legal_acceptance_required',
      termsRequired: true,
    },
    {
      allowed: false,
      unlimited: false,
      basis: 'profile_required',
      profileCompleted: false,
      tokenAcknowledgementRequired: true,
    },
    {
      allowed: false,
      unlimited: false,
      basis: 'reauthentication_required',
      reauthenticationRequired: true,
    },
  ];
  for (const source of BAR_FORECAST_PAID_SUBSCRIPTION_SOURCES) {
    for (const mask of setupMasks) {
      const context = {
        administrator: { authorized: false, role: 'founder_admin' },
        access: {
          role: 'student',
          paidSubscriptionExpired: false,
          subscription: { status: 'active', source },
          ...mask,
        },
      };
      assert.deepEqual(barForecastEntitlementEvidence(context), {
        administrator: false,
        foundingBeta: false,
        paidSubscription: true,
        role: 'student',
        subscriptionSource: source,
      });
      assert.throws(
        () => requireBarForecastAccess(context),
        { code: 'BAR_FORECAST_ACCESS_REQUIRED', status: 403 },
      );
    }
  }

  assert.deepEqual(barForecastEntitlementEvidence({
    administrator: { authorized: true, role: 'founder_admin' },
    access: { role: 'student', basis: 'legal_acceptance_required', termsRequired: true },
  }), {
    administrator: true,
    foundingBeta: false,
    paidSubscription: false,
    role: 'founder_admin',
    subscriptionSource: null,
  });

  assert.deepEqual(barForecastEntitlementEvidence({
    administrator: null,
    access: currentUnlimitedAccess({ basis: 'provisional_payment' }),
  }), {
    administrator: false,
    foundingBeta: false,
    paidSubscription: false,
    currentUnlimited: true,
    role: 'student',
    subscriptionSource: null,
  });
  assert.deepEqual(barForecastEntitlementEvidence({
    administrator: null,
    access: {
      role: 'student',
      basis: 'legal_acceptance_required',
      termsRequired: true,
      freeBeta: { active: true, program: 'founding_beta_2026' },
    },
  }), {
    administrator: false,
    foundingBeta: true,
    paidSubscription: false,
    role: 'student',
    subscriptionSource: null,
  });

  for (const context of [
    { administrator: { authorized: false, role: 'super_admin' }, access: null },
    { administrator: { authorized: true, role: 'subscriber' }, access: null },
    {
      administrator: null,
      access: { freeBeta: { active: true, program: 'other_program' } },
    },
    {
      administrator: null,
      access: { freeBeta: { active: false, program: 'founding_beta_2026' } },
    },
    {
      administrator: null,
      access: { subscription: { status: 'active', source: 'complimentary' } },
    },
    {
      administrator: null,
      access: { subscription: { status: 'expired', source: 'manual_payment' } },
    },
    {
      administrator: null,
      access: {
        paidSubscriptionExpired: true,
        subscription: { status: 'active', source: 'manual_payment' },
      },
    },
  ]) {
    assert.equal(barForecastEntitlementEvidence(context), null);
  }
});

test('request normalization accepts only the exact operation contract and official subjects', () => {
  assert.equal(BAR_FORECAST_CONSENT_VERSION, '2026-09-01');
  assert.deepEqual(normalizeBarForecastRequest({ operation: 'status' }), { operation: 'status' });
  assert.deepEqual(normalizeBarForecastRequest({
    operation: 'accept',
    version: BAR_FORECAST_CONSENT_VERSION,
  }), {
    operation: 'accept',
    version: BAR_FORECAST_CONSENT_VERSION,
  });
  assert.deepEqual(normalizeBarForecastRequest({ operation: 'start', subject: SUBJECT }), {
    operation: 'start',
    subject: SUBJECT,
  });
  for (const subject of BAR_FORECAST_SUBJECTS) {
    assert.deepEqual(normalizeBarForecastRequest({ operation: 'start', subject }), {
      operation: 'start',
      subject,
    });
  }
  assert.throws(
    () => normalizeBarForecastRequest({ operation: 'accept', version: '2026.1' }),
    { code: 'BAR_FORECAST_CONSENT_VERSION_INVALID' },
  );
  assert.throws(
    () => normalizeBarForecastRequest({ operation: 'accept', version: '2026-08-31' }),
    { code: 'BAR_FORECAST_CONSENT_VERSION_INVALID' },
  );
  assert.throws(
    () => normalizeBarForecastRequest({ operation: 'start', subject: 'political' }),
    { code: 'BAR_FORECAST_SUBJECT_INVALID' },
  );
  assert.throws(
    () => normalizeBarForecastRequest({ operation: 'grade', subject: SUBJECT }),
    { code: 'BAR_FORECAST_OPERATION_INVALID' },
  );
  for (const operation of ['STATUS', ' status', 'status ']) {
    assert.throws(
      () => normalizeBarForecastRequest({ operation }),
      { code: 'BAR_FORECAST_OPERATION_INVALID' },
    );
  }
  assert.throws(
    () => normalizeBarForecastRequest({ operation: 'status', subject: SUBJECT }),
    { code: 'BAR_FORECAST_REQUEST_SHAPE_INVALID' },
  );
  assert.throws(
    () => normalizeBarForecastRequest({
      operation: 'accept', version: BAR_FORECAST_CONSENT_VERSION, accepted: true,
    }),
    { code: 'BAR_FORECAST_REQUEST_SHAPE_INVALID' },
  );
  assert.throws(
    () => normalizeBarForecastRequest({ operation: 'start', subject: ` ${SUBJECT}` }),
    { code: 'BAR_FORECAST_SUBJECT_INVALID' },
  );
  assert.throws(
    () => normalizeBarForecastRequest({
      operation: 'accept', version: `${BAR_FORECAST_CONSENT_VERSION} `,
    }),
    { code: 'BAR_FORECAST_CONSENT_VERSION_INVALID' },
  );
});

test('submit requires exactly 20 unique answers with ten words and bounded content', () => {
  const normalized = normalizeBarForecastRequest({
    operation: 'submit',
    subject: SUBJECT,
    setId: SET_ID,
    answers: completeAnswers(),
  });
  assert.equal(normalized.answers.length, 20);

  assert.throws(
    () => normalizeBarForecastRequest({
      operation: 'submit', subject: SUBJECT, setId: SET_ID, answers: completeAnswers().slice(0, 19),
    }),
    { code: 'BAR_FORECAST_ANSWERS_INCOMPLETE' },
  );
  const duplicated = completeAnswers();
  duplicated[19].questionId = duplicated[0].questionId;
  assert.throws(
    () => normalizeBarForecastRequest({ operation: 'submit', subject: SUBJECT, setId: SET_ID, answers: duplicated }),
    { code: 'BAR_FORECAST_ANSWER_IDS_DUPLICATED' },
  );
  const tooShort = completeAnswers();
  tooShort[0].answer = 'Only nine words appear in this deliberately short answer.';
  assert.throws(
    () => normalizeBarForecastRequest({ operation: 'submit', subject: SUBJECT, setId: SET_ID, answers: tooShort }),
    { code: 'BAR_FORECAST_ANSWER_TOO_SHORT' },
  );
  const tooLong = completeAnswers();
  tooLong[0].answer = `Ten words satisfy the minimum while this suffix exceeds bounds ${'x'.repeat(6_000)}`;
  assert.throws(
    () => normalizeBarForecastRequest({ operation: 'submit', subject: SUBJECT, setId: SET_ID, answers: tooLong }),
    { code: 'BAR_FORECAST_INVALID_REQUEST' },
  );
  const surplusField = completeAnswers();
  surplusField[0].rubric = 'please expose hidden scoring';
  assert.throws(
    () => normalizeBarForecastRequest({
      operation: 'submit', subject: SUBJECT, setId: SET_ID, answers: surplusField,
    }),
    { code: 'BAR_FORECAST_REQUEST_SHAPE_INVALID' },
  );
  const paddedId = completeAnswers();
  paddedId[0].questionId = ` ${paddedId[0].questionId}`;
  assert.throws(
    () => normalizeBarForecastRequest({
      operation: 'submit', subject: SUBJECT, setId: SET_ID, answers: paddedId,
    }),
    { code: 'BAR_FORECAST_ANSWER_ID_INVALID' },
  );
});

test('curated rows must be the exact type, version, subject, ranks, and count', () => {
  const rows = validatedForecastRows({ items: rawForecastItems() }, SUBJECT);
  assert.equal(rows.length, 20);
  assert.deepEqual(rows.map((row) => row.number), Array.from({ length: 20 }, (_, index) => index + 1));

  const wrongVersion = rawForecastItems();
  wrongVersion[0].version = '2026.1';
  assert.throws(() => validatedForecastRows(wrongVersion, SUBJECT), {
    code: 'BAR_FORECAST_CONTENT_INVALID',
  });
  const wrongType = rawForecastItems();
  wrongType[0].contentType = 'bar_easy';
  assert.throws(() => validatedForecastRows(wrongType, SUBJECT), {
    code: 'BAR_FORECAST_CONTENT_INVALID',
  });
  assert.throws(() => validatedForecastRows(rawForecastItems().slice(0, 19), SUBJECT), {
    code: 'BAR_FORECAST_CONTENT_INCOMPLETE',
  });

  const missingType = rawForecastItems();
  delete missingType[0].contentType;
  assert.throws(() => validatedForecastRows(missingType, SUBJECT), {
    code: 'BAR_FORECAST_REQUEST_SHAPE_INVALID',
  });

  const mismatchedPayloadId = rawForecastItems();
  mismatchedPayloadId[0].payload.id = 'forecast-test-99';
  assert.throws(() => validatedForecastRows(mismatchedPayloadId, SUBJECT), {
    code: 'BAR_FORECAST_CONTENT_INVALID',
  });

  const mismatchedPayloadSubject = rawForecastItems();
  mismatchedPayloadSubject[0].payload.subject = BAR_FORECAST_SUBJECTS[1];
  assert.throws(() => validatedForecastRows(mismatchedPayloadSubject, SUBJECT), {
    code: 'BAR_FORECAST_CONTENT_INVALID',
  });

  const missingChecksum = rawForecastItems();
  delete missingChecksum[0].checksum;
  assert.throws(() => validatedForecastRows(missingChecksum, SUBJECT), {
    code: 'BAR_FORECAST_REQUEST_SHAPE_INVALID',
  });

  const syntheticId = rawForecastItems();
  syntheticId[0].id = 'synthetic-ui-01';
  syntheticId[0].payload.id = 'synthetic-ui-01';
  assert.throws(() => validatedForecastRows(syntheticId, SUBJECT), {
    code: 'BAR_FORECAST_SYNTHETIC_CONTENT_REJECTED',
  });

  const syntheticPrompt = rawForecastItems();
  syntheticPrompt[0].payload.prompt = 'Synthetic interface-test question 1 asks about Mock Permit 1 after notice and hearing.';
  assert.throws(() => validatedForecastRows(syntheticPrompt, SUBJECT), {
    code: 'BAR_FORECAST_SYNTHETIC_CONTENT_REJECTED',
  });
});

test('start projection exposes only id, number, and prompt', () => {
  const questions = publicForecastQuestions(validatedForecastRows(rawForecastItems(), SUBJECT));
  assert.equal(questions.length, 20);
  for (const question of questions) {
    assert.deepEqual(Object.keys(question), ['id', 'number', 'prompt']);
    assert.equal('suggestedAnswer' in question, false);
    assert.equal('legalBasis' in question, false);
    assert.equal('prediction_score' in question, false);
  }
});

test('question-set identity is stable and changes with checksum or curated content drift', async () => {
  const rows = validatedForecastRows(rawForecastItems(), SUBJECT);
  const first = await forecastSetId(rows);
  const second = await forecastSetId([...rows].reverse());
  assert.match(first, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(second, first);

  const reorderedPayloadItems = rawForecastItems();
  for (const item of reorderedPayloadItems) {
    item.payload = Object.fromEntries(Object.entries(item.payload).reverse());
  }
  assert.equal(
    await forecastSetId(validatedForecastRows(reorderedPayloadItems, SUBJECT)),
    first,
    'JSON object key order must not change the approved set identity',
  );

  const driftCases = [
    ['checksum', (items) => { items[0].checksum = 'f'.repeat(64); }],
    ['prompt', (items) => { items[0].payload.prompt = 'May the exact approved doctrine apply to these newly altered facts?'; }],
    ['suggested answer', (items) => { items[0].payload.suggested_answer += ' This sentence is unapproved.'; }],
    ['legal basis', (items) => { items[0].payload.legal_basis += ' This legal basis is unapproved.'; }],
    ['controlling doctrine', (items) => { items[0].payload.controlling_doctrine = 'An altered doctrine that is not part of the independently approved content set.'; }],
    ['jurisprudence', (items) => { items[0].payload.jurisprudence = 'Unapproved Case'; }],
    ['citation', (items) => { items[0].payload.citation = 'G.R. No. 999999, January 1, 2026'; }],
    ['title', (items) => {
      items[0].payload.title = 'Altered forecast title';
      items[0].title = `${items[0].payload.editorial_ref} — ${items[0].payload.title}`;
    }],
    ['identifier', (items) => {
      items[0].id = 'forecast-altered-1';
      items[0].payload.id = items[0].id;
    }],
    ['rank swap', (items) => {
      [items[0].payload.rank_within_subject, items[1].payload.rank_within_subject] = [
        items[1].payload.rank_within_subject,
        items[0].payload.rank_within_subject,
      ];
    }],
    ['unexposed metadata', (items) => { items[0].payload.prediction_rationale = 'Altered metadata that is never displayed or graded.'; }],
  ];
  for (const [label, mutate] of driftCases) {
    const changedItems = rawForecastItems();
    mutate(changedItems);
    const changed = await forecastSetId(validatedForecastRows(changedItems, SUBJECT));
    assert.notEqual(changed, first, `${label} drift must invalidate the approved set identity`);
  }
});

test('answer matching is exact and grading is split into safe batches', () => {
  const rows = validatedForecastRows(rawForecastItems(), SUBJECT);
  const normalized = normalizeBarForecastRequest({
    operation: 'submit', subject: SUBJECT, setId: SET_ID, answers: completeAnswers(),
  });
  const matched = answersForForecastRows(normalized.answers, rows);
  const batches = forecastGradingBatches(matched);
  assert.deepEqual(batches.map((batch) => batch.length), [4, 4, 4, 4, 4]);

  const mismatched = completeAnswers();
  mismatched[0].questionId = 'forecast-test-99';
  assert.throws(() => answersForForecastRows(mismatched, rows), {
    code: 'BAR_FORECAST_ANSWER_SET_INVALID',
  });
});

test('hidden evaluator is confined to curated law and returns bounded coaching diagnostics', () => {
  const rows = answersForForecastRows(
    completeAnswers(),
    validatedForecastRows(rawForecastItems(), SUBJECT),
  );
  const batch = forecastGradingBatches(rows)[0];
  const prompt = buildBarForecastGradingPrompt(batch);
  assert.match(prompt, /complete and exclusive legal source of truth/i);
  assert.match(prompt, /Do not invent, supplement, update, or cite any law/i);
  assert.match(prompt, /independent, non-scoring diagnostics/i);
  assert.match(prompt, /Return no free-form feedback, legal coaching, authority, case name, or replacement answer/i);
  assert.match(prompt, /grammar\.corrections may contain at most 5 genuine corrections/i);
  assert.match(prompt, /Every identified or missed item must be copied verbatim/i);
  assert.deepEqual(BAR_FORECAST_GRADING_RESPONSE_SCHEMA.properties.results.items.required, [
    'questionId', 'score', 'grammar', 'issueSpotting',
  ]);
  assert.deepEqual(
    BAR_FORECAST_GRADING_RESPONSE_SCHEMA.properties.results.items.properties.issueSpotting.required,
    ['score', 'identified', 'missed'],
  );

  const output = {
    results: batch.map((row, index) => gradingEntry(row, {
      score: index + 1.5,
      rubric: { hidden: true },
    })),
  };
  const validated = validateBarForecastGradingResult(output, batch);
  assert.deepEqual(Object.keys(validated.results[0]), [
    'questionId', 'score', 'grammar', 'issueSpotting',
  ]);
  assert.equal(validated.results[0].grammar.rubricId, 'grammar_strength_v1');
  assert.equal(validated.results[0].issueSpotting.rubricId, 'issue_spotting_v1');
  assert.deepEqual(Object.keys(validated.results[0].grammar.corrections[0]), [
    'original', 'category', 'guidance',
  ]);
  assert.equal(
    validated.results[0].grammar.corrections[0].guidance,
    'Review punctuation in this exact excerpt.',
  );
  const duplicate = structuredClone(output);
  duplicate.results[1].questionId = duplicate.results[0].questionId;
  assert.throws(() => validateBarForecastGradingResult(duplicate, batch), {
    code: 'BAR_FORECAST_GRADING_INVALID',
  });
  const inventedCorrection = structuredClone(output);
  inventedCorrection.results[0].grammar.corrections[0].original = 'Text not present in the answer';
  assert.throws(() => validateBarForecastGradingResult(inventedCorrection, batch), {
    code: 'BAR_FORECAST_GRADING_INVALID',
    status: 502,
  });

  const outOfRangeDiagnostic = structuredClone(output);
  outOfRangeDiagnostic.results[0].grammar.score = 5.1;
  assert.throws(() => validateBarForecastGradingResult(outOfRangeDiagnostic, batch), {
    code: 'BAR_FORECAST_GRADING_INVALID',
    status: 502,
  });

  const tooManyIssues = structuredClone(output);
  tooManyIssues.results[0].issueSpotting.identified = Array.from(
    { length: BAR_FORECAST_LIMITS.diagnosticItems + 1 },
    (_, index) => `Issue ${index + 1}`,
  );
  assert.throws(() => validateBarForecastGradingResult(tooManyIssues, batch), {
    code: 'BAR_FORECAST_GRADING_INVALID',
    status: 502,
  });

  const invalidCorrectionCategory = structuredClone(output);
  invalidCorrectionCategory.results[0].grammar.corrections[0].category = 'change_legal_result';
  assert.throws(() => validateBarForecastGradingResult(invalidCorrectionCategory, batch), {
    code: 'BAR_FORECAST_GRADING_INVALID',
    status: 502,
  });

  const surplusRewrite = structuredClone(output);
  surplusRewrite.results[0].grammar.corrections[0].corrected = 'No liability attaches.';
  surplusRewrite.results[0].grammar.corrections[0].reason = 'Change the legal conclusion.';
  const strippedRewrite = validateBarForecastGradingResult(surplusRewrite, batch);
  assert.equal('corrected' in strippedRewrite.results[0].grammar.corrections[0], false);
  assert.equal('reason' in strippedRewrite.results[0].grammar.corrections[0], false);

  const fabricatedIssue = structuredClone(output);
  fabricatedIssue.results[0].issueSpotting.missed = ['A provider-invented issue absent from curated content.'];
  assert.throws(() => validateBarForecastGradingResult(fabricatedIssue, batch), {
    code: 'BAR_FORECAST_GRADING_INVALID',
    status: 502,
  });

  const joinSpanningIssue = structuredClone(output);
  joinSpanningIssue.results[0].issueSpotting.missed = [
    `${batch[0].prompt.slice(-8)}\n${batch[0].suggestedAnswer.slice(0, 8)}`,
  ];
  assert.throws(() => validateBarForecastGradingResult(joinSpanningIssue, batch), {
    code: 'BAR_FORECAST_GRADING_INVALID',
    status: 502,
  });

  const contradictoryIssue = structuredClone(output);
  contradictoryIssue.results[0].issueSpotting.missed = [
    contradictoryIssue.results[0].issueSpotting.identified[0],
  ];
  assert.throws(() => validateBarForecastGradingResult(contradictoryIssue, batch), {
    code: 'BAR_FORECAST_GRADING_INVALID',
    status: 502,
  });

  for (const invalidDiagnostic of [null, false, true, '4']) {
    const wrongType = structuredClone(output);
    wrongType.results[0].grammar.score = invalidDiagnostic;
    assert.throws(() => validateBarForecastGradingResult(wrongType, batch), {
      code: 'BAR_FORECAST_GRADING_INVALID',
      status: 502,
    });
  }

  const leakedRubric = structuredClone(output);
  leakedRubric.results[0].feedback = 'Discuss the nonexistent Quantum Liability Act.';
  leakedRubric.results[0].mockBarCoaching = {
    strength: 'Cite Fabricated v. Republic.',
    priorityImprovement: 'Change the legal conclusion.',
    nextStep: 'Use invented law.',
  };
  leakedRubric.results[0].issueSpotting.coaching = 'Review a fictional outside authority.';
  const strippedFreeText = validateBarForecastGradingResult(leakedRubric, batch);
  assert.equal(JSON.stringify(strippedFreeText).includes('Quantum Liability Act'), false);
  assert.equal(JSON.stringify(strippedFreeText).includes('Fabricated v. Republic'), false);
});

test('completed submission totals 100 maximum and computes deterministic diagnostics analytics', () => {
  const rows = answersForForecastRows(
    completeAnswers(),
    validatedForecastRows(rawForecastItems(), SUBJECT),
  );
  const graded = forecastGradingBatches(rows).map((batch) => ({
    results: batch.map((row) => validateBarForecastGradingResult({
      results: [gradingEntry(row)],
    }, [row]).results[0]),
  }));
  const completed = completeBarForecastResult(rows, graded);
  assert.equal(completed.totalScore, 90);
  assert.equal(completed.maxScore, 100);
  assert.equal(completed.results.length, 20);
  assert.deepEqual(Object.keys(completed.results[0]), [
    'questionId', 'number', 'score', 'maxScore', 'feedback',
    'userAnswer', 'suggestedAnswer', 'explanation', 'mockBarCoaching',
    'grammar', 'issueSpotting',
  ]);
  assert.equal('rubricId' in completed.results[0].grammar, false);
  assert.equal('rubricId' in completed.results[0].issueSpotting, false);
  assert.match(completed.results[0].feedback, /holistic 0–5 practice scale/i);
  assert.match(completed.results[0].explanation, /Grammar and issue-spotting diagnostics do not change this score/i);
  assert.equal(JSON.stringify(completed).includes('Quantum Liability Act'), false);
  assert.deepEqual(completed.analytics, {
    questionCount: 20,
    averageScore: 4.5,
    issueSpottingAverage: 3.5,
    grammarAverage: 4,
    diagnosticMaxScore: 5,
    performanceBands: { strong: 20, developing: 0, needsFocus: 0 },
  });
});

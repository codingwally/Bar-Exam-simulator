import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BAR_FORECAST_ADMIN_ROLES,
  BAR_FORECAST_CONSENT_VERSION,
  BAR_FORECAST_CONTENT_TYPE,
  BAR_FORECAST_LIMITS,
  BAR_FORECAST_SOURCE_VERSION,
  BAR_FORECAST_SUBJECTS,
  BarForecastError,
  answersForForecastRows,
  buildBarForecastGradingPrompt,
  completeBarForecastResult,
  forecastSetId,
  forecastGradingBatches,
  normalizeBarForecastRequest,
  publicForecastQuestions,
  requireBarForecastAdministrator,
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

test('administrator authorization requires an explicit allowed role', () => {
  for (const role of BAR_FORECAST_ADMIN_ROLES) {
    assert.deepEqual(requireBarForecastAdministrator({ authorized: true, role }), {
      authorized: true,
      role,
    });
  }
  for (const authorization of [
    null,
    { authorized: false, role: 'super_admin' },
    { authorized: true, role: 'subscriber' },
    { authorized: true, role: '' },
  ]) {
    assert.throws(
      () => requireBarForecastAdministrator(authorization),
      (error) => error instanceof BarForecastError
        && error.code === 'BAR_FORECAST_ADMIN_FORBIDDEN'
        && error.status === 403,
    );
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

test('hidden evaluator is confined to curated law and returns holistic scores only', () => {
  const rows = answersForForecastRows(
    completeAnswers(),
    validatedForecastRows(rawForecastItems(), SUBJECT),
  );
  const batch = forecastGradingBatches(rows)[0];
  const prompt = buildBarForecastGradingPrompt(batch);
  assert.match(prompt, /complete and exclusive legal source of truth/i);
  assert.match(prompt, /Do not invent, supplement, update, or cite any law/i);
  assert.match(prompt, /Do not produce or reveal rubric categories, component scores/i);

  const output = {
    results: batch.map((row, index) => ({
      questionId: row.id,
      score: index + 1.5,
      feedback: `Concrete feedback for question ${row.number}.`,
      explanation: `The answer was compared holistically with curated question ${row.number}.`,
      rubric: { hidden: true },
    })),
  };
  const validated = validateBarForecastGradingResult(output, batch);
  assert.deepEqual(Object.keys(validated.results[0]), [
    'questionId', 'score', 'feedback', 'explanation',
  ]);
  const duplicate = structuredClone(output);
  duplicate.results[1].questionId = duplicate.results[0].questionId;
  assert.throws(() => validateBarForecastGradingResult(duplicate, batch), {
    code: 'BAR_FORECAST_GRADING_INVALID',
  });
});

test('completed submission totals 100 maximum and exposes no rubric breakdown', () => {
  const rows = answersForForecastRows(
    completeAnswers(),
    validatedForecastRows(rawForecastItems(), SUBJECT),
  );
  const graded = forecastGradingBatches(rows).map((batch) => ({
    results: batch.map((row) => ({
      questionId: row.id,
      score: 4.5,
      feedback: `Feedback for ${row.number}.`,
      explanation: `Reason for holistic score ${row.number}.`,
    })),
  }));
  const completed = completeBarForecastResult(rows, graded);
  assert.equal(completed.totalScore, 90);
  assert.equal(completed.maxScore, 100);
  assert.equal(completed.results.length, 20);
  assert.deepEqual(Object.keys(completed.results[0]), [
    'questionId', 'number', 'score', 'maxScore', 'feedback',
    'userAnswer', 'suggestedAnswer', 'explanation',
  ]);
});

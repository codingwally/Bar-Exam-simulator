import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BAR_EASY_RESPONSE_SCHEMA,
  DD2026_DEFAULT_FLAGS,
  DD2026ValidationError,
  DOCTRINE_RESPONSE_SCHEMA,
  barEasyPersistencePayload,
  buildBarEasyPrompt,
  buildDoctrinePrompt,
  doctrinePersistencePayload,
  normalizeBarEasyRequest,
  normalizeDoctrineRequest,
  publicContentItem,
  unicodeLength,
  validateBarEasyResult,
  validateDoctrineResult,
} from './duediligence-2026-core.mjs';

const requestKey = 'request_2026_abcdef123456';
const userId = '123e4567-e89b-42d3-a456-426614174000';

test('safe default feature flags preserve the human-review publication gate', () => {
  assert.equal(DD2026_DEFAULT_FLAGS.CONTENT_HUMAN_REVIEW_REQUIRED, false);
  assert.equal(DD2026_DEFAULT_FLAGS.AI_PREPARED_BETA_BADGE, false);
});

test('Unicode limits count code points without truncating input', () => {
  assert.equal(unicodeLength('A😀B'), 3);
  const answer = '😀'.repeat(5_000);
  assert.equal(normalizeBarEasyRequest({ contentId: 'BE-001', answer, requestKey }).answer, answer);
  assert.throws(
    () => normalizeBarEasyRequest({ contentId: 'BE-001', answer: `${answer}x`, requestKey }),
    (error) => error instanceof DD2026ValidationError
      && error.code === 'FIELD_TOO_LONG'
      && /Nothing was truncated/.test(error.message),
  );
  const doctrine = '⚖'.repeat(3_000);
  assert.equal(normalizeDoctrineRequest({ contentId: 'DOC-001', answer: doctrine, requestKey }).answer, doctrine);
});

test('study schemas and result validators accept only settled enums', () => {
  assert.deepEqual(BAR_EASY_RESPONSE_SCHEMA.properties.label.enum, [
    'Affirmed!', 'Affirmed with modification', 'Denied',
  ]);
  assert.deepEqual(DOCTRINE_RESPONSE_SCHEMA.properties.result.enum, ['thumbs_up', 'thumbs_down']);
  assert.equal(validateBarEasyResult({ label: 'Affirmed!', feedback: 'Good.' }).label, 'Affirmed!');
  assert.equal(validateDoctrineResult({ result: 'thumbs_down', feedback: 'Review the limit.' }).result, 'thumbs_down');
  assert.throws(() => validateBarEasyResult({ label: 'Passed', feedback: 'No.' }));
  assert.throws(() => validateDoctrineResult({ result: 'maybe', feedback: 'No.' }));
});

test('catalog redaction withholds study answers until submission', () => {
  const bar = publicContentItem({
    contentType: 'bar_easy',
    payload: {
      prompt: 'Question', suggested_answer: 'Secret answer', explanation: 'Secret rationale',
      required_concepts: ['secret'], source_url: 'https://example.test',
    },
  });
  assert.equal(bar.payload.prompt, 'Question');
  assert.equal(bar.payload.source_url, 'https://example.test');
  assert.equal('suggested_answer' in bar.payload, false);
  assert.equal('explanation' in bar.payload, false);
  assert.equal('required_concepts' in bar.payload, false);
});

test('prompts treat student text as data and persistence payloads omit it', () => {
  const canary = 'CANARY_DO_NOT_PERSIST_7f2c9d';
  const barContent = {
    payload: {
      prompt: 'Is dismissal valid?', suggested_answer: 'No.', explanation: 'Due process is required.',
      required_concepts: ['notice'], accepted_paraphrases: ['hearing'],
      modification_triggers: ['missing notice'], denial_triggers: ['opposite rule'],
      source_title: 'Labor Code', source_citation: 'Art. 292',
    },
  };
  const doctrineContent = {
    payload: {
      doctrine_title: 'Security of tenure', canonical_meaning: 'A worker may be dismissed only for lawful cause.',
      plain_language_meaning: 'There must be a lawful reason.', required_concepts: ['lawful cause'],
      accepted_paraphrases: [], material_contradictions: [], exceptions_or_limits: [],
      primary_authority: 'Constitution', citation: 'Art. XIII',
    },
  };
  assert.match(buildBarEasyPrompt(barContent, canary), /untrusted data/i);
  assert.match(buildDoctrinePrompt(doctrineContent, canary), /only legal source of truth/i);
  const normalizedBar = normalizeBarEasyRequest({ contentId: 'BE-001', answer: canary, requestKey });
  const normalizedDoctrine = normalizeDoctrineRequest({ contentId: 'DOC-001', answer: canary, requestKey });
  const barPayload = JSON.stringify(barEasyPersistencePayload(userId, 'BE-001', normalizedBar, 'test-model'));
  const doctrinePayload = JSON.stringify(doctrinePersistencePayload(
    userId, 'DOC-001', normalizedDoctrine, { result: 'thumbs_up' }, 'test-model',
  ));
  assert.equal(barPayload.includes(canary), false);
  assert.equal(doctrinePayload.includes(canary), false);
  assert.equal(barPayload.includes('feedback'), false);
  assert.equal(doctrinePayload.includes('feedback'), false);
});

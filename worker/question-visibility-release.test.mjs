import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AccessValidationError,
  availableProtectedQuestionInventory,
  protectedQuestionInventory,
  selectProtectedQuestion,
} from './access-core.mjs';
import { questionWebsiteVisibility } from './question-visibility-core.mjs';
import {
  applyWebsitePublicationOverlay,
  buildBarFeelsManifest,
  parseWebsitePublicationOverlay,
  parseWebsiteUploadSource,
  visibleWebsiteReleaseRows,
  websitePublicationDigest,
} from './release-content-core.mjs';
import questionBank from '../content/question-bank/website-upload.json' with { type: 'json' };

function csvCell(value) {
  const source = String(value ?? '');
  return /[",\r\n]/.test(source) ? `"${source.replaceAll('"', '""')}"` : source;
}

function canonicalCsv(records = questionBank.records) {
  return [
    questionBank.headers.map(csvCell).join(','),
    ...records.map((record) => (
      questionBank.headers.map((header) => csvCell(record[header])).join(',')
    )),
  ].join('\r\n');
}

function canonicalRecords() {
  return new Map(questionBank.records.map((record) => [
    String(record['Question ID']).trim(),
    { ...record },
  ]));
}

function publicationOverlay(overrides = new Map()) {
  return new Map(questionBank.records.map((record) => {
    const questionId = String(record['Question ID']).trim();
    return [questionId, {
      'Question ID': questionId,
      'Publication Ready?': overrides.get(questionId) || 'Yes',
    }];
  }));
}

test('website visibility keeps the existing default and recognizes the owner hide choices', () => {
  assert.equal(questionWebsiteVisibility(undefined), 'visible');
  assert.equal(questionWebsiteVisibility(''), 'visible');
  assert.equal(questionWebsiteVisibility(' YES '), 'visible');
  assert.equal(questionWebsiteVisibility({ 'Publication Ready?': 'No' }), 'hidden');
  assert.equal(questionWebsiteVisibility({ publicationReady: 'hide_from_website' }), 'hidden');
  assert.equal(questionWebsiteVisibility({ publicationReady: 'Hidden' }), 'hidden');
  assert.equal(questionWebsiteVisibility({ publicationReady: 'Maybe' }), 'invalid');
});

test('Q&A visibility projection accepts extra rows but rejects ambiguity', () => {
  const parsed = parseWebsitePublicationOverlay([
    'Question and Suggested Answer data Bank',
    '',
    'Question ID,Publication Ready?',
    'LAB-001,Yes',
    'FUTURE-001,No',
  ].join('\r\n'));
  assert.equal(parsed.size, 2);
  assert.equal(parsed.get('LAB-001')['Publication Ready?'], 'Yes');
  assert.equal(parsed.get('FUTURE-001')['Publication Ready?'], 'No');

  assert.throws(
    () => parseWebsitePublicationOverlay([
      'Question ID,Publication Ready?',
      'LAB-001,Yes',
      'LAB-001,No',
    ].join('\r\n')),
    (error) => error?.code === 'MOCK_BAR_VISIBILITY_OVERLAY_INVALID',
  );
  assert.throws(
    () => parseWebsitePublicationOverlay([
      'Question ID,Publication Ready?',
      'LAB-001,Maybe',
    ].join('\r\n')),
    (error) => error?.code === 'MOCK_BAR_VISIBILITY_OVERLAY_INVALID',
  );
  assert.throws(
    () => parseWebsitePublicationOverlay([
      'Question ID,Publication Ready?,Essay Question',
      'LAB-001,Yes,This content must not be exposed by the control feed.',
    ].join('\r\n')),
    (error) => error?.code === 'MOCK_BAR_VISIBILITY_OVERLAY_INVALID',
  );
});

test('Q&A overlay changes only visibility and never replaces canonical website content', () => {
  const canonical = canonicalRecords();
  const questionId = 'LAB-001';
  const original = { ...canonical.get(questionId) };
  const qna = publicationOverlay(new Map([[questionId, 'No']]));
  Object.assign(qna.get(questionId), {
    'Essay Question': 'This different Q&A text must never reach the website.',
    'Suggested Answer': 'This different Q&A answer must never reach grading.',
  });
  qna.set('FUTURE-001', {
    'Question ID': 'FUTURE-001',
    'Publication Ready?': 'Yes',
    'Essay Question': 'An extra staged question.',
  });

  const overlaid = applyWebsitePublicationOverlay(canonical, qna);
  assert.equal(overlaid.size, 320);
  assert.equal(overlaid.has('FUTURE-001'), false);
  assert.equal(overlaid.get(questionId)['Publication Ready?'], 'No');
  assert.equal(overlaid.get(questionId)['Essay Question'], original['Essay Question']);
  assert.equal(overlaid.get(questionId)['Suggested Answer'], original['Suggested Answer']);
  assert.notEqual(overlaid.get(questionId), canonical.get(questionId));
  assert.deepEqual(canonical.get(questionId), original);
});

test('overlay refuses a missing canonical control instead of partially changing the live bank', () => {
  const canonical = canonicalRecords();
  const qna = publicationOverlay();
  qna.delete('LAB-001');
  assert.throws(
    () => applyWebsitePublicationOverlay(canonical, qna),
    (error) => error?.code === 'MOCK_BAR_VISIBILITY_OVERLAY_INVALID',
  );
});

test('hiding stops future random issuance without breaking an already-issued workspace', () => {
  const hiddenId = 'LAB-001';
  const records = applyWebsitePublicationOverlay(
    canonicalRecords(),
    publicationOverlay(new Map([[hiddenId, 'No']])),
  );

  assert.equal(protectedQuestionInventory(records)['Labor Law'].length, 40);
  assert.equal(availableProtectedQuestionInventory(records)['Labor Law'].length, 39);
  assert.equal(
    availableProtectedQuestionInventory(records)['Labor Law']
      .some((question) => question.id === hiddenId),
    false,
  );
  assert.notEqual(
    selectProtectedQuestion(records, { subject: 'Labor Law', random: () => 0 }).id,
    hiddenId,
  );
  assert.equal(
    selectProtectedQuestion(records, {
      subject: 'Labor Law',
      questionId: hiddenId,
    }).id,
    hiddenId,
    'An exact restore must remain usable for a paid user who was already answering.',
  );

  for (const withheldId of ['TAX-2019-Q10A', 'TAX-2019-Q10B']) {
    assert.throws(
      () => selectProtectedQuestion(records, {
        subject: 'Taxation Law',
        questionId: withheldId,
      }),
      (error) => error instanceof AccessValidationError && error.code === 'QUESTION_NOT_FOUND',
    );
  }
});

test('an entirely hidden subject fails safely while preserving exact restore continuity', () => {
  const overrides = new Map(
    questionBank.records
      .filter((record) => record.Subject === 'Labor Law')
      .map((record) => [String(record['Question ID']).trim(), 'No']),
  );
  const records = applyWebsitePublicationOverlay(canonicalRecords(), publicationOverlay(overrides));
  assert.throws(
    () => selectProtectedQuestion(records, { subject: 'Labor Law', random: () => 0 }),
    (error) => error instanceof AccessValidationError
      && error.code === 'QUESTION_BANK_INVALID'
      && error.status === 503,
  );
  assert.equal(
    selectProtectedQuestion(records, {
      subject: 'Labor Law',
      questionId: 'LAB-001',
    }).id,
    'LAB-001',
  );
});

test('Bar Feels uses only visible rows and visibility changes produce a new release digest', async () => {
  const parsed = await parseWebsiteUploadSource(canonicalCsv());
  const baselineGroups = buildBarFeelsManifest(parsed.rows);
  const selectedId = baselineGroups[0].rows[0].questionId;
  const canonical = canonicalRecords();
  const visibleOverlay = applyWebsitePublicationOverlay(canonical, publicationOverlay());
  const hiddenOverlay = applyWebsitePublicationOverlay(
    canonical,
    publicationOverlay(new Map([[selectedId, 'No']])),
  );
  const visibleRows = visibleWebsiteReleaseRows(parsed.rows, hiddenOverlay);
  const hiddenGroups = buildBarFeelsManifest(visibleRows);

  assert.equal(visibleRows.length, 319);
  assert.equal(hiddenGroups.flatMap((group) => group.rows).length, 120);
  assert.equal(
    hiddenGroups.some((group) => group.rows.some((row) => row.questionId === selectedId)),
    false,
  );
  assert.notEqual(
    await websitePublicationDigest(parsed.digest, visibleOverlay),
    await websitePublicationDigest(parsed.digest, hiddenOverlay),
  );
});

test('Bar Feels refuses publication when hiding would leave an incomplete subject pool', async () => {
  const parsed = await parseWebsiteUploadSource(canonicalCsv());
  const overrides = new Map(
    questionBank.records
      .filter((record) => record.Subject === 'Labor Law')
      .slice(0, 21)
      .map((record) => [String(record['Question ID']).trim(), 'No']),
  );
  const overlaid = applyWebsitePublicationOverlay(canonicalRecords(), publicationOverlay(overrides));
  assert.throws(
    () => buildBarFeelsManifest(visibleWebsiteReleaseRows(parsed.rows, overlaid)),
    (error) => error?.code === 'BAR_FEELS_POOL_INCOMPLETE',
  );
});

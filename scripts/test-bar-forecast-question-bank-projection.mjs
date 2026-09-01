import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { APPROVED_SUBJECTS, HEADERS } from './import-website-upload.mjs';
import {
  FORECAST_QUESTION_BANK_ID_PATTERN,
  FORECAST_QUESTION_COUNT,
  PRESERVED_QUESTION_BANK_COUNT,
  PROJECTED_QUESTION_BANK_COUNT,
  legalBasisAuthorityLabel,
  legalBasisSourceUrl,
  projectBarForecastToQuestionBank,
  projectForecastQuestion,
} from './project-bar-forecast-to-question-bank.mjs';

const FORECAST_PATH = new URL('../content/duediligence-2026/bar-forecast.json', import.meta.url);
const WEBSITE_BANK_PATH = new URL('../content/question-bank/website-upload.json', import.meta.url);
const FIXTURE_ELIBRARY_URL = 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/1/69528';
const REQUIRED_NOTES_PHRASE = 'Approved for verification; not yet verified.';
const FORECAST_NOTE_MARKER = 'Forecast source ID:';
const PUBLIC_PARITY_FIELDS = Object.freeze([
  ['Topic', 'syllabus_topic'],
  ['Essay Question', 'prompt'],
  ['Suggested Answer', 'suggested_answer'],
  ['Controlling Doctrine', 'controlling_doctrine'],
  ['Jurisprudence / Case', 'jurisprudence'],
  ['Citation / G.R. No.', 'citation'],
]);

const [canonicalForecast, canonicalWebsiteBank] = await Promise.all([
  readFile(FORECAST_PATH, 'utf8').then(JSON.parse),
  readFile(WEBSITE_BANK_PATH, 'utf8').then(JSON.parse),
]);

function clone(value) {
  return structuredClone(value);
}

function fixtureSubject(row) {
  if (APPROVED_SUBJECTS.includes(row.source_legacy_subject)) return row.source_legacy_subject;
  const direct = {
    'Political and Public International Law': 'Political and Public International Law',
    'Civil Law and Land Titles and Deeds': 'Civil Law',
    'Labor Law and Social Legislation': 'Labor Law',
    'Criminal Law': 'Criminal Law',
  };
  if (direct[row.subject]) return direct[row.subject];
  if (row.subject === 'Commercial and Taxation Laws') return 'Commercial Law';
  if (row.subject === 'Remedial Law, Legal and Judicial Ethics, with Practical Exercises') {
    return 'Remedial Law';
  }
  throw new Error(`The test fixture cannot map Forecast subject ${row.subject}.`);
}

function makeForecastFixture() {
  const forecast = clone(canonicalForecast);
  forecast.rows.forEach((row, index) => {
    row.question_bank_id = `FCT-2026-Q${String(index + 1).padStart(3, '0')}`;
    row.question_bank_subject = fixtureSubject(row);
    row.supersedes_question_ids = row.source_question_id ? [row.source_question_id] : [];
    if (!row.source_links.some((link) => (
      typeof link === 'string'
        && link.startsWith('https://elibrary.judiciary.gov.ph/')
    ))) {
      row.legal_basis_source_url = FIXTURE_ELIBRARY_URL;
    }
  });
  return forecast;
}

function freshInputs() {
  const websiteBank = clone(canonicalWebsiteBank);
  websiteBank.records = websiteBank.records.filter((record) => (
    !FORECAST_QUESTION_BANK_ID_PATTERN.test(String(record['Question ID'] || '').trim())
  ));
  websiteBank.sourceRange = 'A1:U801';
  return {
    forecast: makeForecastFixture(),
    websiteBank,
  };
}

function assertCompleteForecastIdSet(records) {
  const ids = new Set(records.map((record) => record['Question ID']));
  assert.equal(ids.size, FORECAST_QUESTION_COUNT);
  for (let index = 1; index <= FORECAST_QUESTION_COUNT; index += 1) {
    assert.ok(ids.has(`FCT-2026-Q${String(index).padStart(3, '0')}`));
  }
}

function assertProjectedParity(forecast, websiteBank, result) {
  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.headers, HEADERS);
  assert.equal(result.sourceRange, 'A1:U921');
  assert.equal(result.records.length, PROJECTED_QUESTION_BANK_COUNT);
  assert.equal(new Set(result.records.map((record) => record['Question ID'])).size, result.records.length);

  const superseded = new Set(forecast.rows.flatMap((row) => row.supersedes_question_ids));
  for (let index = 0; index < websiteBank.records.length; index += 1) {
    const original = websiteBank.records[index];
    const expected = superseded.has(original['Question ID'])
      ? { ...original, 'Publication Ready?': 'No' }
      : original;
    assert.deepEqual(result.records[index], expected);
  }

  const projected = result.records.slice(PRESERVED_QUESTION_BANK_COUNT);
  assertCompleteForecastIdSet(projected);
  assert.equal(projected.length, FORECAST_QUESTION_COUNT);
  for (const [index, row] of forecast.rows.entries()) {
    const record = projected[index];
    assert.deepEqual(Object.keys(record), HEADERS);
    assert.equal(record['Question ID'], row.question_bank_id);
    assert.equal(record.Subject, row.question_bank_subject);
    assert.equal(record['Bar Year'], String(row.bar_year));
    assert.equal(record['Question No.'], String(row.rank_within_subject));
    assert.equal(record.Difficulty, row.difficulty);
    assert.equal(record.Version, row.version);
    assert.equal(record['Editorial Status'], 'Approved');
    assert.equal(record['Publication Ready?'], 'Yes');
    assert.equal(record['Feedback Count'], '0');
    assert.equal(record['Open Feedback'], '0');
    assert.match(record.Notes, new RegExp(REQUIRED_NOTES_PHRASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(record.Notes, /AI-prepared beta Forecast question approved for protected Q&A publication/u);
    assert.ok(record.Notes.includes(`${FORECAST_NOTE_MARKER} ${row.id}.`));
    for (const [questionBankField, forecastField] of PUBLIC_PARITY_FIELDS) {
      assert.equal(record[questionBankField], row[forecastField]);
    }
    const eLibraryUrl = legalBasisSourceUrl(row);
    assert.equal(
      record['Legal Basis / Provision'],
      `${row.legal_basis}\n\n${legalBasisAuthorityLabel(eLibraryUrl)}: ${eLibraryUrl}`,
    );
    assert.ok(record['Source URL'].split('\n').includes(eLibraryUrl));
  }
}

test('projection constants and ID grammar lock the 800 + 120 = 920 contract', () => {
  assert.equal(PRESERVED_QUESTION_BANK_COUNT, 800);
  assert.equal(FORECAST_QUESTION_COUNT, 120);
  assert.equal(PROJECTED_QUESTION_BANK_COUNT, 920);
  assert.match('FCT-2026-Q001', FORECAST_QUESTION_BANK_ID_PATTERN);
  assert.match('FCT-2026-Q120', FORECAST_QUESTION_BANK_ID_PATTERN);
  assert.doesNotMatch('FCT-2026-Q000', FORECAST_QUESTION_BANK_ID_PATTERN);
  assert.doesNotMatch('FCT-2026-Q121', FORECAST_QUESTION_BANK_ID_PATTERN);
  assert.doesNotMatch('FCT-2026-Q01', FORECAST_QUESTION_BANK_ID_PATTERN);
});

test('projects all 120 Forecast rows with exact public-field parity and preserves all 800 bank rows', () => {
  const { forecast, websiteBank } = freshInputs();
  const forecastBefore = clone(forecast);
  const websiteBefore = clone(websiteBank);
  const result = projectBarForecastToQuestionBank(forecast, websiteBank);

  assertProjectedParity(forecast, websiteBank, result);
  assert.deepEqual(forecast, forecastBefore, 'projection must not mutate the Forecast source');
  assert.deepEqual(websiteBank, websiteBefore, 'projection must not mutate the existing Q&A bank');
});

test('hides every superseded row without changing its content, position, or ID', () => {
  const { forecast, websiteBank } = freshInputs();
  const result = projectBarForecastToQuestionBank(forecast, websiteBank);
  const superseded = new Set(forecast.rows.flatMap((row) => row.supersedes_question_ids));
  assert.equal(superseded.size, canonicalForecast.rows.filter((row) => row.source_question_id).length);

  for (let index = 0; index < PRESERVED_QUESTION_BANK_COUNT; index += 1) {
    const before = websiteBank.records[index];
    const after = result.records[index];
    assert.equal(after['Question ID'], before['Question ID']);
    if (superseded.has(before['Question ID'])) {
      assert.deepEqual(after, { ...before, 'Publication Ready?': 'No' });
    } else {
      assert.deepEqual(after, before);
    }
  }
});

test('upserts the complete managed projection idempotently', () => {
  const { forecast, websiteBank } = freshInputs();
  const first = projectBarForecastToQuestionBank(forecast, websiteBank);
  const second = projectBarForecastToQuestionBank(forecast, first);
  assert.deepEqual(second, first);
});

test('uses an approved explicit legal-basis URL and rejects an invalid explicit override', () => {
  const { forecast } = freshInputs();
  const row = clone(forecast.rows[0]);
  row.legal_basis_source_url = FIXTURE_ELIBRARY_URL;
  row.source_links = ['https://lawphil.net/judjuris/juri2024/jul2024/gr_264661_2024.html'];
  const projected = projectForecastQuestion(row);
  assert.ok(projected['Legal Basis / Provision'].endsWith(FIXTURE_ELIBRARY_URL));
  assert.equal(projected['Source URL'].split('\n')[0], FIXTURE_ELIBRARY_URL);

  row.legal_basis_source_url = 'https://example.com/not-the-elibrary';
  row.source_links.push(FIXTURE_ELIBRARY_URL);
  assert.throws(
    () => projectForecastQuestion(row),
    /legal_basis_source_url must be an approved HTTPS official legal-authority URL/u,
  );

  row.legal_basis_source_url = 'https://www.un.org/depts/los/convention_agreements/texts/unclos/part12.htm';
  const treatyProjection = projectForecastQuestion(row);
  assert.match(treatyProjection['Legal Basis / Provision'], /Official treaty authority:/u);
});

test('falls back to the first E-Library source link and throws when no E-Library authority exists', () => {
  const { forecast } = freshInputs();
  const row = clone(forecast.rows.find((candidate) => (
    candidate.source_links.some((link) => link.startsWith('https://elibrary.judiciary.gov.ph/'))
  )));
  delete row.legal_basis_source_url;
  const firstELibrary = row.source_links.find((link) => (
    link.startsWith('https://elibrary.judiciary.gov.ph/')
  ));
  assert.equal(legalBasisSourceUrl(row), firstELibrary);

  row.source_links = ['https://lawphil.net/judjuris/juri2024/jul2024/gr_264661_2024.html'];
  assert.throws(
    () => legalBasisSourceUrl(row),
    /a Supreme Court E-Library legal-basis source is required/u,
  );
});

test('rejects incomplete sources, schema drift, wrong bank sizes, and duplicate existing IDs', () => {
  {
    const { forecast, websiteBank } = freshInputs();
    forecast.rows.pop();
    forecast.count = 119;
    assert.throws(
      () => projectBarForecastToQuestionBank(forecast, websiteBank),
      /exactly 120 rows/u,
    );
  }
  {
    const { forecast, websiteBank } = freshInputs();
    websiteBank.headers = [...websiteBank.headers].reverse();
    assert.throws(
      () => projectBarForecastToQuestionBank(forecast, websiteBank),
      /does not match the reviewed schemaVersion 1 contract/u,
    );
  }
  for (const newLength of [799, 801]) {
    const { forecast, websiteBank } = freshInputs();
    if (newLength === 799) websiteBank.records.pop();
    else websiteBank.records.push({ ...websiteBank.records[0], 'Question ID': 'EXTRA-001' });
    assert.throws(
      () => projectBarForecastToQuestionBank(forecast, websiteBank),
      /must preserve exactly 800 non-Forecast rows/u,
    );
  }
  {
    const { forecast, websiteBank } = freshInputs();
    websiteBank.records[1]['Question ID'] = websiteBank.records[0]['Question ID'];
    assert.throws(
      () => projectBarForecastToQuestionBank(forecast, websiteBank),
      /repeats Question ID/u,
    );
  }
  {
    const { forecast, websiteBank } = freshInputs();
    websiteBank.records[0].Unexpected = 'schema drift';
    assert.throws(
      () => projectBarForecastToQuestionBank(forecast, websiteBank),
      /does not have the exact 21 Website Upload columns/u,
    );
  }
  {
    const { forecast, websiteBank } = freshInputs();
    forecast.rows[1].id = forecast.rows[0].id;
    assert.throws(
      () => projectBarForecastToQuestionBank(forecast, websiteBank),
      /Forecast source repeats a row id/u,
    );
  }
});

test('rejects malformed, duplicate, and incomplete Forecast projection IDs', () => {
  for (const invalidId of ['', 'FCT-2026-Q000', 'FCT-2026-Q121', 'FCT-2026-Q01']) {
    const { forecast, websiteBank } = freshInputs();
    forecast.rows[0].question_bank_id = invalidId;
    assert.throws(
      () => projectBarForecastToQuestionBank(forecast, websiteBank),
      /question_bank_id/u,
    );
  }
  {
    const { forecast, websiteBank } = freshInputs();
    forecast.rows[1].question_bank_id = forecast.rows[0].question_bank_id;
    assert.throws(
      () => projectBarForecastToQuestionBank(forecast, websiteBank),
      /repeats Question ID/u,
    );
  }
  {
    const { forecast, websiteBank } = freshInputs();
    [forecast.rows[0].question_bank_id, forecast.rows[1].question_bank_id] = [
      forecast.rows[1].question_bank_id,
      forecast.rows[0].question_bank_id,
    ];
    const result = projectBarForecastToQuestionBank(forecast, websiteBank);
    assertCompleteForecastIdSet(result.records.slice(PRESERVED_QUESTION_BANK_COUNT));
  }
});

test('rejects unmapped subjects and rows that fail the Website Upload editorial contract', () => {
  {
    const { forecast, websiteBank } = freshInputs();
    forecast.rows[0].question_bank_subject = 'Commercial and Taxation Laws';
    assert.throws(
      () => projectBarForecastToQuestionBank(forecast, websiteBank),
      /not an approved Website Upload subject/u,
    );
  }
  {
    const { forecast, websiteBank } = freshInputs();
    forecast.rows[0].suggested_answer = 'A bare answer without ALAC headings.';
    assert.throws(
      () => projectBarForecastToQuestionBank(forecast, websiteBank),
      /failed validation/u,
    );
  }
  {
    const { forecast, websiteBank } = freshInputs();
    forecast.rows[0].rank_within_subject = 21;
    assert.throws(
      () => projectBarForecastToQuestionBank(forecast, websiteBank),
      /rank_within_subject must be an integer from 1 through 20/u,
    );
  }
  {
    const { forecast, websiteBank } = freshInputs();
    forecast.rows[0].prompt += '\u0000';
    assert.throws(
      () => projectBarForecastToQuestionBank(forecast, websiteBank),
      /prompt is invalid/u,
    );
  }
});

test('rejects invalid supersession metadata, unknown IDs, self/new IDs, and double supersession', () => {
  {
    const { forecast, websiteBank } = freshInputs();
    delete forecast.rows[0].supersedes_question_ids;
    assert.throws(
      () => projectBarForecastToQuestionBank(forecast, websiteBank),
      /supersedes_question_ids must be an array/u,
    );
  }
  {
    const { forecast, websiteBank } = freshInputs();
    const id = websiteBank.records[0]['Question ID'];
    forecast.rows[0].supersedes_question_ids = [id, id];
    assert.throws(
      () => projectBarForecastToQuestionBank(forecast, websiteBank),
      /contains a duplicate/u,
    );
  }
  for (const invalidSupersededId of ['NOT-IN-THE-BANK', 'FCT-2026-Q120']) {
    const { forecast, websiteBank } = freshInputs();
    forecast.rows[0].supersedes_question_ids = [invalidSupersededId];
    assert.throws(
      () => projectBarForecastToQuestionBank(forecast, websiteBank),
      invalidSupersededId.startsWith('FCT-')
        ? /cannot supersede a Forecast projection ID/u
        : /does not exist in the preserved bank/u,
    );
  }
  {
    const { forecast, websiteBank } = freshInputs();
    const shared = websiteBank.records[0]['Question ID'];
    forecast.rows[0].supersedes_question_ids = [shared];
    forecast.rows[1].supersedes_question_ids = [shared];
    assert.throws(
      () => projectBarForecastToQuestionBank(forecast, websiteBank),
      /is superseded by both/u,
    );
  }
});

test('rejects unmanaged FCT collisions and partial managed projections', () => {
  {
    const { forecast, websiteBank } = freshInputs();
    websiteBank.records[0]['Question ID'] = 'FCT-2026-Q001';
    assert.throws(
      () => projectBarForecastToQuestionBank(forecast, websiteBank),
      /unmanaged Website Upload row collides with a Forecast projection ID/u,
    );
  }
  {
    const { forecast, websiteBank } = freshInputs();
    const complete = projectBarForecastToQuestionBank(forecast, websiteBank);
    complete.records.pop();
    assert.throws(
      () => projectBarForecastToQuestionBank(forecast, complete),
      /contains only part of the managed Forecast projection/u,
    );
  }
});

test('repository canonical Forecast metadata is complete and directly projects to the canonical bank', () => {
  for (const [index, row] of canonicalForecast.rows.entries()) {
    assert.match(
      row.question_bank_id || '',
      FORECAST_QUESTION_BANK_ID_PATTERN,
      `Forecast row ${index + 1} (${row.id}) lacks a valid question_bank_id`,
    );
    assert.ok(
      APPROVED_SUBJECTS.includes(row.question_bank_subject),
      `Forecast row ${index + 1} (${row.id}) lacks an approved question_bank_subject`,
    );
    assert.ok(
      Array.isArray(row.supersedes_question_ids),
      `Forecast row ${index + 1} (${row.id}) lacks supersedes_question_ids`,
    );
    if (row.source_question_id) {
      assert.ok(
        row.supersedes_question_ids.includes(row.source_question_id),
        `${row.id} does not supersede its revised source_question_id`,
      );
    }
    assert.doesNotThrow(() => legalBasisSourceUrl(row));
  }
  const result = projectBarForecastToQuestionBank(canonicalForecast, canonicalWebsiteBank);
  assertProjectedParity(canonicalForecast, canonicalWebsiteBank, result);
});

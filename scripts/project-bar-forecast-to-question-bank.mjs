import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  APPROVED_SUBJECTS,
  HEADERS,
  validateRecords,
} from './import-website-upload.mjs';

export const FORECAST_QUESTION_COUNT = 120;
export const PRESERVED_QUESTION_BANK_COUNT = 800;
export const PROJECTED_QUESTION_BANK_COUNT = 920;
export const FORECAST_QUESTION_BANK_ID_PATTERN = /^FCT-2026-Q(?:00[1-9]|0[1-9]\d|1[01]\d|120)$/u;

const FORECAST_SOURCE_PATH = fileURLToPath(
  new URL('../content/duediligence-2026/bar-forecast.json', import.meta.url),
);
const WEBSITE_BANK_PATH = fileURLToPath(
  new URL('../content/question-bank/website-upload.json', import.meta.url),
);
const REQUIRED_NOTES_PHRASE = 'Approved for verification; not yet verified.';
const FORECAST_NOTE_MARKER = 'Forecast source ID:';
const FORECAST_SUPERSESSION_NOTE_MARKER = 'Forecast supersedes Q&A IDs:';
const APPROVED_SUBJECT_SET = new Set(APPROVED_SUBJECTS);

function requiredText(value, label, maximum = 100_000) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  if (!value.trim() || value.length > maximum || value.includes('\u0000')) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function optionalText(value, maximum = 100_000) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new Error('Optional Forecast text must be a string.');
  if (value.length > maximum || value.includes('\u0000')) {
    throw new Error('Optional Forecast text is invalid.');
  }
  return value;
}

function exactHeaders(headers) {
  return Array.isArray(headers)
    && headers.length === HEADERS.length
    && headers.every((header, index) => header === HEADERS[index]);
}

function assertExactRecordColumns(records, label) {
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error(`${label} row ${index + 2} must be an object.`);
    }
    const keys = Object.keys(record);
    if (keys.length !== HEADERS.length || HEADERS.some((header) => !keys.includes(header))) {
      throw new Error(`${label} row ${index + 2} does not have the exact 21 Website Upload columns.`);
    }
  }
}

function isELibraryUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname.toLowerCase() === 'elibrary.judiciary.gov.ph'
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

function isOfficialUnclosPartXiiUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && ['un.org', 'www.un.org'].includes(url.hostname.toLowerCase())
      && url.pathname === '/depts/los/convention_agreements/texts/unclos/part12.htm'
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function legalBasisAuthorityLabel(value) {
  return isELibraryUrl(value)
    ? 'Supreme Court E-Library authority'
    : 'Official treaty authority';
}

export function legalBasisSourceUrl(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('Forecast row must be an object.');
  }
  const explicit = optionalText(row.legal_basis_source_url, 4_000).trim();
  if (explicit) {
    if (!isELibraryUrl(explicit) && !isOfficialUnclosPartXiiUrl(explicit)) {
      throw new Error(`${row.id || 'Forecast row'}: legal_basis_source_url must be an approved HTTPS official legal-authority URL.`);
    }
    return explicit;
  }
  if (!Array.isArray(row.source_links)) {
    throw new Error(`${row.id || 'Forecast row'}: source_links must be an array.`);
  }
  const source = row.source_links.find((value) => (
    typeof value === 'string' && isELibraryUrl(value.trim())
  ));
  if (!source) {
    throw new Error(`${row.id || 'Forecast row'}: a Supreme Court E-Library legal-basis source is required.`);
  }
  return source.trim();
}

function sourceLinksForQuestionBank(row, legalSourceUrl) {
  if (!Array.isArray(row.source_links) || row.source_links.length < 1) {
    throw new Error(`${row.id || 'Forecast row'}: at least one source link is required.`);
  }
  const links = [];
  for (const [index, value] of row.source_links.entries()) {
    const link = requiredText(value, `${row.id} source link ${index + 1}`, 4_000).trim();
    let parsed;
    try {
      parsed = new URL(link);
    } catch {
      throw new Error(`${row.id}: source link ${index + 1} is invalid.`);
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new Error(`${row.id}: source link ${index + 1} must be a non-credentialed HTTPS URL.`);
    }
    if (!links.includes(link)) links.push(link);
  }
  if (!links.includes(legalSourceUrl)) links.unshift(legalSourceUrl);
  return links;
}

function normalizedSupersededIds(row) {
  if (!Array.isArray(row.supersedes_question_ids)) {
    throw new Error(`${row.id || 'Forecast row'}: supersedes_question_ids must be an array.`);
  }
  const ids = row.supersedes_question_ids.map((value, index) => (
    requiredText(value, `${row.id} superseded question ID ${index + 1}`, 200).trim()
  ));
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${row.id}: supersedes_question_ids contains a duplicate.`);
  }
  return ids;
}

function notesFor(row) {
  const superseded = normalizedSupersededIds(row);
  return [
    REQUIRED_NOTES_PHRASE,
    'AI-prepared beta Forecast question approved for protected Q&A publication; final independent legal review remains required.',
    `${FORECAST_NOTE_MARKER} ${row.id}.`,
    superseded.length ? `${FORECAST_SUPERSESSION_NOTE_MARKER} ${superseded.join(', ')}.` : '',
    `Editorial reference: ${row.editorial_ref}.`,
    `Training-priority index: ${row.prediction_score}.`,
  ].filter(Boolean).join(' ');
}

export function projectForecastQuestion(row, index = 0) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`Forecast row ${index + 1} must be an object.`);
  }
  const sourceId = requiredText(row.id, `Forecast row ${index + 1} id`, 200).trim();
  const questionBankId = requiredText(
    row.question_bank_id,
    `${sourceId} question_bank_id`,
    200,
  ).trim();
  if (!FORECAST_QUESTION_BANK_ID_PATTERN.test(questionBankId)) {
    throw new Error(`${sourceId}: question_bank_id must use FCT-2026-Q001 through FCT-2026-Q120.`);
  }
  const subject = requiredText(row.question_bank_subject, `${sourceId} question_bank_subject`, 500).trim();
  if (!APPROVED_SUBJECT_SET.has(subject)) {
    throw new Error(`${sourceId}: question_bank_subject is not an approved Website Upload subject.`);
  }
  const legalSourceUrl = legalBasisSourceUrl(row);
  const sourceLinks = sourceLinksForQuestionBank(row, legalSourceUrl);
  const legalBasis = requiredText(row.legal_basis, `${sourceId} legal_basis`);
  const version = requiredText(row.version, `${sourceId} version`, 120).trim();
  const reviewedOn = optionalText(
    row.editorially_revised_on || row.researched_on || row.source_checked_on,
    120,
  ).trim();
  normalizedSupersededIds(row);

  const record = {
    'Question ID': questionBankId,
    Subject: subject,
    Topic: requiredText(row.syllabus_topic, `${sourceId} syllabus_topic`, 10_000),
    'Bar Year': requiredText(String(row.bar_year ?? ''), `${sourceId} bar_year`, 20).trim(),
    'Question No.': String(row.rank_within_subject ?? '').trim(),
    'Essay Question': requiredText(row.prompt, `${sourceId} prompt`, 20_000),
    'Suggested Answer': requiredText(row.suggested_answer, `${sourceId} suggested_answer`, 100_000),
    'Legal Basis / Provision': `${legalBasis}\n\n${legalBasisAuthorityLabel(legalSourceUrl)}: ${legalSourceUrl}`,
    'Controlling Doctrine': requiredText(
      row.controlling_doctrine,
      `${sourceId} controlling_doctrine`,
      100_000,
    ),
    'Jurisprudence / Case': requiredText(row.jurisprudence, `${sourceId} jurisprudence`, 20_000),
    'Citation / G.R. No.': requiredText(row.citation, `${sourceId} citation`, 10_000),
    'Source URL': sourceLinks.join('\n'),
    Difficulty: requiredText(row.difficulty, `${sourceId} difficulty`, 120).trim(),
    'Editorial Status': 'Approved',
    Version: version,
    'Assigned Reviewer': optionalText(row.question_bank_reviewer, 200).trim() || 'Wally Esteban',
    'Last Reviewed': reviewedOn,
    'Publication Ready?': 'Yes',
    Notes: notesFor(row),
    'Feedback Count': '0',
    'Open Feedback': '0',
  };
  if (!/^(?:[1-9]|1\d|20)$/u.test(record['Question No.'])) {
    throw new Error(`${sourceId}: rank_within_subject must be an integer from 1 through 20.`);
  }
  if (!exactHeaders(Object.keys(record))) {
    throw new Error(`${sourceId}: projected Website Upload columns drifted.`);
  }
  return record;
}

function assertUniqueQuestionIds(records, label) {
  const occurrences = new Map();
  for (const [index, record] of records.entries()) {
    const id = requiredText(record?.['Question ID'], `${label} row ${index + 2} Question ID`, 200).trim();
    const rows = occurrences.get(id) || [];
    rows.push(index + 2);
    occurrences.set(id, rows);
  }
  const duplicate = [...occurrences.entries()].find(([, rows]) => rows.length > 1);
  if (duplicate) throw new Error(`${label} repeats Question ID ${duplicate[0]}.`);
  return occurrences;
}

export function projectBarForecastToQuestionBank(forecastSource, websitePayload) {
  if (!forecastSource || typeof forecastSource !== 'object' || Array.isArray(forecastSource)
      || forecastSource.count !== FORECAST_QUESTION_COUNT
      || !Array.isArray(forecastSource.rows)
      || forecastSource.rows.length !== FORECAST_QUESTION_COUNT) {
    throw new Error(`Forecast source must contain exactly ${FORECAST_QUESTION_COUNT} rows.`);
  }
  if (!websitePayload || typeof websitePayload !== 'object' || Array.isArray(websitePayload)
      || websitePayload.schemaVersion !== 1
      || !exactHeaders(websitePayload.headers)
      || !Array.isArray(websitePayload.records)) {
    throw new Error('Website Upload payload does not match the reviewed schemaVersion 1 contract.');
  }

  assertExactRecordColumns(websitePayload.records, 'Existing Website Upload');
  assertUniqueQuestionIds(websitePayload.records, 'Existing Website Upload');
  const sourceIds = forecastSource.rows.map((row, index) => (
    requiredText(row?.id, `Forecast row ${index + 1} id`, 200).trim()
  ));
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new Error('Forecast source repeats a row id.');
  }
  const projected = forecastSource.rows.map(projectForecastQuestion);
  const projectedOccurrences = assertUniqueQuestionIds(projected, 'Projected Forecast');
  const projectedIdSet = new Set(projectedOccurrences.keys());
  const expectedIds = new Set(Array.from({ length: FORECAST_QUESTION_COUNT }, (_, index) => (
    `FCT-2026-Q${String(index + 1).padStart(3, '0')}`
  )));
  if (projectedIdSet.size !== expectedIds.size
      || [...expectedIds].some((id) => !projectedIdSet.has(id))) {
    throw new Error('Projected Forecast must contain the complete FCT-2026-Q001 through FCT-2026-Q120 ID set.');
  }

  const existingManagedIds = new Set();
  const baseRecords = [];
  for (const record of websitePayload.records) {
    const id = String(record['Question ID'] || '').trim();
    if (projectedIdSet.has(id)) {
      if (!String(record.Notes || '').includes(FORECAST_NOTE_MARKER)) {
        throw new Error(`${id}: an unmanaged Website Upload row collides with a Forecast projection ID.`);
      }
      existingManagedIds.add(id);
    } else {
      baseRecords.push(record);
    }
  }
  if (baseRecords.length !== PRESERVED_QUESTION_BANK_COUNT) {
    throw new Error(
      `Website Upload must preserve exactly ${PRESERVED_QUESTION_BANK_COUNT} non-Forecast rows; found ${baseRecords.length}.`,
    );
  }
  if (existingManagedIds.size !== 0 && existingManagedIds.size !== FORECAST_QUESTION_COUNT) {
    throw new Error('Website Upload contains only part of the managed Forecast projection.');
  }

  const baseById = new Map(baseRecords.map((record) => [String(record['Question ID']).trim(), record]));
  const supersededBy = new Map();
  for (const row of forecastSource.rows) {
    const questionBankId = String(row.question_bank_id || '').trim();
    for (const supersededId of normalizedSupersededIds(row)) {
      if (projectedIdSet.has(supersededId) || supersededId === questionBankId) {
        throw new Error(`${row.id}: a projected Forecast question cannot supersede a Forecast projection ID.`);
      }
      if (!baseById.has(supersededId)) {
        throw new Error(`${row.id}: superseded Question ID ${supersededId} does not exist in the preserved bank.`);
      }
      if (supersededBy.has(supersededId)) {
        throw new Error(
          `${supersededId} is superseded by both ${supersededBy.get(supersededId)} and ${row.id}.`,
        );
      }
      supersededBy.set(supersededId, row.id);
    }
  }

  const preserved = baseRecords.map((record) => {
    const id = String(record['Question ID']).trim();
    return supersededBy.has(id)
      ? { ...record, 'Publication Ready?': 'No' }
      : { ...record };
  });
  const records = [...preserved, ...projected];
  if (records.length !== PROJECTED_QUESTION_BANK_COUNT) {
    throw new Error(`Projected Website Upload must contain exactly ${PROJECTED_QUESTION_BANK_COUNT} rows.`);
  }
  assertExactRecordColumns(records, 'Projected Website Upload');
  assertUniqueQuestionIds(records, 'Projected Website Upload');
  const validation = validateRecords(
    records.map((record, index) => ({ __rowNumber: index + 2, ...record })),
  );
  if (validation.failures.length || validation.duplicateIds.length) {
    throw new Error(`Projected Website Upload failed validation: ${JSON.stringify(validation)}`);
  }

  return {
    ...websitePayload,
    sourceRange: `A1:U${records.length + 1}`,
    headers: [...HEADERS],
    records,
  };
}

export async function buildProjectedQuestionBank({
  forecastPath = FORECAST_SOURCE_PATH,
  websiteBankPath = WEBSITE_BANK_PATH,
} = {}) {
  const [forecastSource, websitePayload] = await Promise.all([
    readFile(forecastPath, 'utf8').then(JSON.parse),
    readFile(websiteBankPath, 'utf8').then(JSON.parse),
  ]);
  return projectBarForecastToQuestionBank(forecastSource, websitePayload);
}

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] || '').trim() : '';
}

export async function main(argv = process.argv.slice(2)) {
  const payload = await buildProjectedQuestionBank();
  const output = argumentValue(argv, '--output');
  if (output) {
    const resolved = path.resolve(output);
    await writeFile(resolved, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
  const report = {
    ok: true,
    output: output ? path.resolve(output) : null,
    existingRowsPreserved: PRESERVED_QUESTION_BANK_COUNT,
    forecastRowsProjected: FORECAST_QUESTION_COUNT,
    totalRows: payload.records.length,
    sourceRange: payload.sourceRange,
  };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  });
}

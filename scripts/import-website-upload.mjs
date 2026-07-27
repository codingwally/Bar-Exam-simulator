import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../worker/examiner-core.mjs';

export const SPREADSHEET_ID = '1DgDe_ObIoiTy9NJ3DmdM1ec7h7t0FS7RvFhBTjubZ8A';
export const SHEET_ID = '141335489';
export const SHEET_NAME = 'Website Upload';
export const SOURCE_RANGE = 'A1:U321';
export const OUTPUT_PATH = fileURLToPath(
  new URL('../content/question-bank/website-upload.json', import.meta.url),
);

export const HEADERS = Object.freeze([
  'Question ID',
  'Subject',
  'Topic',
  'Bar Year',
  'Question No.',
  'Essay Question',
  'Suggested Answer',
  'Legal Basis / Provision',
  'Controlling Doctrine',
  'Jurisprudence / Case',
  'Citation / G.R. No.',
  'Source URL',
  'Difficulty',
  'Editorial Status',
  'Version',
  'Assigned Reviewer',
  'Last Reviewed',
  'Publication Ready?',
  'Notes',
  'Feedback Count',
  'Open Feedback',
]);

export const APPROVED_SUBJECTS = Object.freeze([
  'Political and Public International Law',
  'Labor Law',
  'Civil Law',
  'Taxation Law',
  'Commercial Law',
  'Criminal Law',
  'Remedial Law',
  'Legal and Judicial Ethics',
]);

const NOTES_PHRASE = 'Approved for verification; not yet verified.';
const ALAC_HEADINGS = ['Answer', 'Legal Basis', 'Application', 'Conclusion'];
const EXPORT_URL =
  `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${SHEET_ID}`;

function text(value) {
  return String(value ?? '');
}

function recordsFromCsv(csv) {
  const rows = parseCsv(csv);
  const selected = rows.slice(0, 321);
  const headers = selected[0] || [];
  if (JSON.stringify(headers) !== JSON.stringify(HEADERS)) {
    throw new Error(`Header mismatch in ${SHEET_NAME}!${SOURCE_RANGE}.`);
  }
  if (selected.length !== 321) {
    throw new Error(`Expected 321 rows including the header; received ${selected.length}.`);
  }
  return selected.slice(1).map((cells, offset) => ({
    __rowNumber: offset + 2,
    ...Object.fromEntries(HEADERS.map((header, index) => [header, text(cells[index])])),
  }));
}

export function validateRecords(records) {
  const approved = new Set(APPROVED_SUBJECTS);
  const occurrences = new Map();
  for (const record of records) {
    const id = record['Question ID'].trim();
    const rows = occurrences.get(id) || [];
    rows.push(record.__rowNumber);
    occurrences.set(id, rows);
  }
  const duplicateIds = [...occurrences.entries()]
    .filter(([id, rows]) => id && rows.length > 1)
    .map(([id, rows]) => ({ id, rows }));
  const duplicateSet = new Set(duplicateIds.map(({ id }) => id));

  const failures = [];
  const valid = [];
  for (const record of records) {
    const reasons = [];
    const id = record['Question ID'].trim();
    const answer = record['Suggested Answer'];
    if (!id) reasons.push('Question ID is blank');
    if (!approved.has(record.Subject.trim())) reasons.push('Subject is not an approved Bar subject');
    if (record['Editorial Status'].trim() !== 'Approved') reasons.push('Editorial Status is not Approved');
    if (record['Publication Ready?'].trim() !== 'Yes') reasons.push('Publication Ready? is not Yes');
    if (!record.Notes.includes(NOTES_PHRASE)) reasons.push('Required Notes phrase is missing');
    for (const heading of ALAC_HEADINGS) {
      if (!new RegExp(`(^|\\n)\\s*${heading}\\s*:`, 'i').test(answer)) {
        reasons.push(`Suggested Answer lacks ${heading}`);
      }
    }
    if (!/https:\/\/elibrary\.judiciary\.gov\.ph(?:\/|(?=$))/i.test(record['Legal Basis / Provision'])) {
      reasons.push('Legal Basis / Provision lacks an HTTPS Supreme Court E-Library link');
    }
    if (id && duplicateSet.has(id)) reasons.push('Question ID is duplicated');

    if (reasons.length) {
      failures.push({
        row: record.__rowNumber,
        questionId: id,
        subject: record.Subject,
        reasons,
      });
    } else {
      valid.push(record);
    }
  }
  return { valid, failures, duplicateIds };
}

function cleanRecord(record) {
  return Object.fromEntries(HEADERS.map((header) => [header, record[header]]));
}

async function readExisting() {
  try {
    return JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { headers: HEADERS, records: [] };
    throw error;
  }
}

function upsert(existingRecords, sourceRecords) {
  const existing = new Map(existingRecords.map((record) => [record['Question ID'], record]));
  const sourceIds = new Set(sourceRecords.map((record) => record['Question ID']));
  const counts = { create: 0, update: 0, unchanged: 0 };

  for (const record of sourceRecords) {
    const clean = cleanRecord(record);
    const previous = existing.get(clean['Question ID']);
    if (!previous) counts.create += 1;
    else if (JSON.stringify(previous) === JSON.stringify(clean)) counts.unchanged += 1;
    else counts.update += 1;
    existing.set(clean['Question ID'], clean);
  }

  const records = [
    ...sourceRecords.map(cleanRecord),
    ...existingRecords.filter((record) => !sourceIds.has(record['Question ID'])),
  ];
  return { records, counts };
}

function summarizeBySubject(sourceRecords, existingRecords) {
  const existing = new Map(existingRecords.map((record) => [record['Question ID'], record]));
  const summary = Object.fromEntries(
    APPROVED_SUBJECTS.map((subject) => [
      subject,
      { create: 0, update: 0, unchanged: 0, skipped: 0, error: 0 },
    ]),
  );
  for (const record of sourceRecords) {
    const clean = cleanRecord(record);
    const previous = existing.get(clean['Question ID']);
    if (!previous) summary[record.Subject].create += 1;
    else if (JSON.stringify(previous) === JSON.stringify(clean)) summary[record.Subject].unchanged += 1;
    else summary[record.Subject].update += 1;
  }
  return summary;
}

export async function importWebsiteUpload({ dryRun = false } = {}) {
  const response = await fetch(EXPORT_URL, { headers: { Accept: 'text/csv' } });
  if (!response.ok) throw new Error(`Google Sheets export failed with HTTP ${response.status}.`);
  const sourceRecords = recordsFromCsv(await response.text());
  const validation = validateRecords(sourceRecords);
  if (validation.failures.length || validation.duplicateIds.length) {
    const details = JSON.stringify(
      { duplicateIds: validation.duplicateIds, validationFailures: validation.failures },
      null,
      2,
    );
    throw new Error(`Website Upload validation failed.\n${details}`);
  }

  const existing = await readExisting();
  const result = upsert(existing.records || [], validation.valid);
  const report = {
    source: `${SHEET_NAME}!${SOURCE_RANGE}`,
    rows: validation.valid.length,
    ...result.counts,
    skipped: 0,
    errors: 0,
    duplicateIds: [],
    validationFailures: [],
    perSubject: summarizeBySubject(validation.valid, existing.records || []),
  };

  if (!dryRun) {
    const payload = {
      schemaVersion: 1,
      spreadsheetId: SPREADSHEET_ID,
      sheetId: Number(SHEET_ID),
      sheetName: SHEET_NAME,
      sourceRange: SOURCE_RANGE,
      headers: HEADERS,
      records: result.records,
    };
    await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
  return report;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const report = await importWebsiteUpload({ dryRun: process.argv.includes('--dry-run') });
  console.log(JSON.stringify(report, null, 2));
}

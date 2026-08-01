import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {
  APPROVED_SUBJECTS,
  cleanRecord,
  HEADERS,
  OUTPUT_PATH,
  recordsFromCsv,
  validateRecords,
} from './import-website-upload.mjs';

const payload = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf8'));
assert.deepEqual(payload.headers, HEADERS, 'A:U headers must remain exact.');
assert.equal(payload.records.length, 320, 'Rows 2–321 must produce exactly 320 records.');
assert.doesNotMatch(JSON.stringify(payload.records), /\(noun\)/i, 'Internal noun markers must never reach the website bank.');

const validation = validateRecords(
  payload.records.map((record, index) => ({ __rowNumber: index + 2, ...record })),
);
assert.deepEqual(validation.duplicateIds, [], 'Question IDs must be unique.');
assert.deepEqual(validation.failures, [], 'Every imported row must pass publication validation.');

const exactPrompt = 'Keep  repeated spaces before .38-caliber.\n\nKeep the paragraph break ; exactly.';
const sourceRecord = Object.fromEntries(HEADERS.map((header) => [header, ` ${header} `]));
sourceRecord['Essay Question'] = exactPrompt;
const cleanedRecord = cleanRecord(sourceRecord);
assert.equal(cleanedRecord['Essay Question'], exactPrompt, 'Importer cleanup must preserve question text exactly.');
assert.equal(cleanedRecord.Subject, ' Subject ', 'Non-question cleanup behavior must remain unchanged.');

function csvCell(value) {
  const string = String(value ?? '');
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

const exactCsvRow = HEADERS.map((header) => csvCell(sourceRecord[header])).join(',');
const exactCsv = [HEADERS.join(','), ...Array.from({ length: 320 }, () => exactCsvRow)].join('\n');
assert.equal(
  recordsFromCsv(exactCsv)[0]['Essay Question'],
  exactPrompt,
  'CSV import must preserve question text exactly.',
);

const nonQuestionHeaders = HEADERS.filter((header) => header !== 'Essay Question');
const nonQuestionProjection = payload.records.map((record) => Object.fromEntries(
  nonQuestionHeaders.map((header) => [header, record[header]]),
));
const nonQuestionDigest = crypto
  .createHash('sha256')
  .update(JSON.stringify(nonQuestionProjection))
  .digest('hex');
assert.equal(
  nonQuestionDigest,
  '531c1b5eafa9f685d77ffd56224fc7a1765d428cb54913d84051336f89c74336',
  'Model answers and every non-question field must remain byte-for-byte unchanged.',
);

const counts = Object.fromEntries(APPROVED_SUBJECTS.map((subject) => [subject, 0]));
for (const record of payload.records) counts[record.Subject] += 1;
for (const subject of APPROVED_SUBJECTS) {
  assert.equal(counts[subject], 40, `${subject} must contain 40 records.`);
}

const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
assert.doesNotMatch(
  html,
  /assets\/website-question-bank\.js|content\/question-bank|website-upload\.json/,
  'The public frontend must not reference the private question corpus.',
);
assert.match(html, /loadWebsiteQuestionBank\(\)/, 'Frontend must initialize the imported bank.');
assert.match(
  html,
  /websiteQuestionBankStatus = "protected"/,
  'The public frontend must mark the corpus as protected.',
);
assert.match(
  html,
  /loadProtectedQuestion/,
  'Questions must be requested through the authenticated Worker flow.',
);
assert.match(html, /questionSourceMetadata\(question\)/, 'Frontend must derive official Bar source metadata.');
assert.match(html, /question\?\.bar_year/, 'Frontend must display the source Bar year.');
assert.match(html, /question\?\.question_no/, 'Frontend must display the original Bar question number.');
assert.match(html, /class="question-source-meta"/, 'Frontend must render the approved source-metadata design.');
assert.match(html, /function randomDifferentQuestionIndex/, 'Next must choose a random different question.');
assert.match(html, /onclick="nextQuestion\(\)"[^>]*>NEXT<\/button>/, 'Only the concise NEXT control should be shown.');
assert.doesNotMatch(html, />\s*← Prev Question\s*</, 'Previous-question controls must not be rendered.');
assert.doesNotMatch(html, />\s*🔀 Randomize\s*</, 'A separate Randomize control must not be rendered.');
assert.doesNotMatch(html, /Item \$\{currentIdx \+ 1\} of/, 'Internal item counts must not be rendered.');
assert.doesNotMatch(html, /Item No\. \$\{currentIdx \+ 1\}/, 'Internal item numbers must not be rendered.');
assert.doesNotMatch(html, />← Prev Question</, 'The Previous question control must remain removed.');

console.log('Website Upload question-bank tests passed.');

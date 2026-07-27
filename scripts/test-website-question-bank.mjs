import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  APPROVED_SUBJECTS,
  HEADERS,
  OUTPUT_PATH,
  validateRecords,
} from './import-website-upload.mjs';

const payload = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf8'));
assert.deepEqual(payload.headers, HEADERS, 'A:U headers must remain exact.');
assert.equal(payload.records.length, 320, 'Rows 2–321 must produce exactly 320 records.');

const validation = validateRecords(
  payload.records.map((record, index) => ({ __rowNumber: index + 2, ...record })),
);
assert.deepEqual(validation.duplicateIds, [], 'Question IDs must be unique.');
assert.deepEqual(validation.failures, [], 'Every imported row must pass publication validation.');

const counts = Object.fromEntries(APPROVED_SUBJECTS.map((subject) => [subject, 0]));
for (const record of payload.records) counts[record.Subject] += 1;
for (const subject of APPROVED_SUBJECTS) {
  assert.equal(counts[subject], 40, `${subject} must contain 40 records.`);
}

const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
assert.match(html, /assets\/website-question-bank\.js/, 'Frontend loader must be included.');
assert.match(html, /loadWebsiteQuestionBank\(\)/, 'Frontend must initialize the imported bank.');

console.log('Website Upload question-bank tests passed.');

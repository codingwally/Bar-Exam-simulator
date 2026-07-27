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
assert.doesNotMatch(JSON.stringify(payload.records), /\(noun\)/i, 'Internal noun markers must never reach the website bank.');

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

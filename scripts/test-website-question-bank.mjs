import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {
  APPROVED_SUBJECTS,
  cleanRecord,
  HEADERS,
  MAXIMUM_RECORD_COUNT,
  MINIMUM_RECORD_COUNT,
  OUTPUT_PATH,
  recordsFromCsv,
  validateRecords,
} from './import-website-upload.mjs';

const payload = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf8'));
assert.deepEqual(payload.headers, HEADERS, 'A:U headers must remain exact.');
assert.ok(
  payload.records.length >= MINIMUM_RECORD_COUNT
    && payload.records.length <= MAXIMUM_RECORD_COUNT,
  `The bank must contain ${MINIMUM_RECORD_COUNT} to ${MAXIMUM_RECORD_COUNT} records.`,
);
assert.doesNotMatch(JSON.stringify(payload.records), /\(noun\)/i, 'Internal noun markers must never reach the website bank.');

const validation = validateRecords(
  payload.records.map((record, index) => ({ __rowNumber: index + 2, ...record })),
);
assert.deepEqual(validation.duplicateIds, [], 'Question IDs must be unique.');
assert.deepEqual(validation.failures, [], 'Every imported row must pass publication validation.');

const explicitlyHiddenRecord = {
  __rowNumber: 2,
  ...payload.records[0],
  'Publication Ready?': 'No',
};
const hiddenValidation = validateRecords([explicitlyHiddenRecord]);
assert.deepEqual(hiddenValidation.failures, [], 'An explicit No must remain valid import data.');
assert.equal(hiddenValidation.valid.length, 1, 'A hidden record must remain in the canonical snapshot.');

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
const retainedSourceReviewedBaseline = payload.records.slice(0, 318);
const nonQuestionProjection = retainedSourceReviewedBaseline.map((record) => Object.fromEntries(
  nonQuestionHeaders.map((header) => [header, record[header]]),
));
const nonQuestionDigest = crypto
  .createHash('sha256')
  .update(JSON.stringify(nonQuestionProjection))
  .digest('hex');
assert.equal(
  nonQuestionDigest,
  'daf757659645eee844b9e3b841c56e2817e2c555fb694bf7885b822eec901f3c',
  'The 318 retained source-reviewed model answers and non-question fields must remain byte-for-byte locked.',
);

const promptDigest = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const sourceManifest = JSON.parse(await fs.readFile(
  new URL('../content/question-bank/verbatim-source-manifest.json', import.meta.url),
  'utf8',
));
assert.equal(sourceManifest.schemaVersion, 2, 'Verbatim source manifest schema must remain supported.');
assert.equal(sourceManifest.summary.totalRecords, 320, 'Source manifest must cover every bank row.');
assert.equal(sourceManifest.summary.sourceCertified, 318, 'Exactly 318 official prompts must be deployed.');
assert.equal(
  sourceManifest.summary.unresolvedSourceSchemaConflict,
  2,
  'The two synthetic 2019 Tax splits must remain explicitly unresolved, never silently rewritten.',
);
assert.equal(sourceManifest.summary.changedPrompts, 318, 'Exactly 318 verbatim prompt replacements must be staged.');
assert.equal(sourceManifest.summary.answerCorrectedRecords, 23, 'Exactly 23 mismatched answers must be corrected.');
assert.equal(sourceManifest.summary.answerRetainedRecords, 297, 'All other model answers must remain retained.');
assert.equal(
  sourceManifest.summary.baselineNonQuestionSha256,
  '531c1b5eafa9f685d77ffd56224fc7a1765d428cb54913d84051336f89c74336',
  'Manifest must record the reviewed pre-release non-question corpus.',
);
assert.equal(
  sourceManifest.summary.finalNonQuestionSha256,
  '6e5b4adfed83fa1f85ed6b22e630d0085b40d7fb62bcee2bb3158df615f4adf1',
  'Historical manifest must retain the reviewed 320-row release digest.',
);
assert.equal(
  sourceManifest.summary.baselineSuggestedAnswerSha256,
  '32b4b531dfb888570debbf0f1bab3cfef1d1562ab619e078922c8eba50cbb15c',
  'Manifest must identify the reviewed pre-release Suggested Answer corpus.',
);
assert.equal(
  sourceManifest.summary.finalSuggestedAnswerSha256,
  '28db534676953f2578e975b8377abf32b06e81681e698fbd38f091d61db6da6b',
  'Manifest must lock the corrected Suggested Answer corpus.',
);

const recordsById = new Map(retainedSourceReviewedBaseline.map((record) => [record['Question ID'], record]));
const sourceCertifiedManifestRecords = sourceManifest.records.filter((source) => source.status === 'source-certified');
assert.equal(sourceCertifiedManifestRecords.length, recordsById.size, 'All 318 retained source-certified IDs must remain deployed.');
assert.equal(
  new Set(sourceManifest.records.map((source) => source.questionId)).size,
  sourceManifest.records.length,
  'Historical manifest question IDs must remain unique.',
);
const unresolvedIds = [];
const correctedAnswerIds = [];
const allowedAnswerFields = new Set([
  'Suggested Answer',
  'Legal Basis / Provision',
  'Controlling Doctrine',
  'Jurisprudence / Case',
  'Citation / G.R. No.',
  'Source URL',
  'Topic',
  'Notes',
]);
for (const source of sourceManifest.records) {
  const record = recordsById.get(source.questionId);
  if (source.status !== 'source-certified') {
    unresolvedIds.push(source.questionId);
    assert.equal(
      source.status,
      'unresolved-source-schema-conflict',
      `${source.questionId} must never use an unreviewed source status.`,
    );
    assert.ok(source.note, `${source.questionId} must explain why its official prompt is not deployed.`);
    assert.ok(source.officialWholeItemSha256, `${source.questionId} must retain its official whole-item digest.`);
    assert.equal(record, undefined, `${source.questionId} must remain permanently absent from the deployable bank.`);
    continue;
  }
  assert.ok(record, `Source-certified manifest ID ${source.questionId} must remain in the deployable bank.`);
  assert.equal(
    promptDigest(record['Essay Question']),
    source.deployedPromptSha256,
    `${source.questionId} prompt must match its reviewed source-manifest digest.`,
  );
  assert.equal(
    source.deployedPromptSha256,
    source.officialPromptSha256,
    `${source.questionId} deployed prompt must match the official source digest.`,
  );
  if (source.answerAlignment) {
    correctedAnswerIds.push(source.questionId);
    assert.equal(source.answerAlignment.status, 'source-reviewed-corrected');
    assert.ok(source.answerAlignment.changedFields.includes('Suggested Answer'));
    assert.ok(
      source.answerAlignment.changedFields.every((field) => allowedAnswerFields.has(field)),
      `${source.questionId} contains a forbidden answer-side change.`,
    );
    assert.equal(
      promptDigest(record['Suggested Answer']),
      source.answerAlignment.deployedSuggestedAnswerSha256,
      `${source.questionId} must match its reviewed Suggested Answer digest.`,
    );
    assert.ok(source.answerAlignment.sourceUrls.length >= 3, `${source.questionId} must disclose at least three sources.`);
    if (source.questionId === 'REM-2023-Q20') {
      for (const heading of ['Answer:', 'Legal Basis:', 'Application:', 'Conclusion:']) {
        assert.match(record['Suggested Answer'], new RegExp(`(^|\\n)${heading}`), `${source.questionId} must include ${heading}`);
      }
      assert.match(record['Suggested Answer'], /DEED OF ABSOLUTE SALE/);
      assert.match(record['Suggested Answer'], /ACKNOWLEDGMENT/);
    } else {
      for (const heading of ['Answer:', 'Legal Basis:', 'Application:', 'Conclusion:']) {
        assert.match(record['Suggested Answer'], new RegExp(heading), `${source.questionId} must include ${heading}`);
      }
    }
  }
}
assert.deepEqual(
  unresolvedIds.sort(),
  ['TAX-2019-Q10A', 'TAX-2019-Q10B'],
  'Only the two synthetic Lawphil A.10 splits may remain unresolved.',
);
assert.deepEqual(
  correctedAnswerIds.sort(),
  [
    'ETH-2019-B14',
    'LAB-037',
    'LAB-040',
    'LAB-048',
    'POLI-2022-Q04B',
    'REM-2022-I-Q07',
    'REM-2022-I-Q15',
    'REM-2022-II-Q01A',
    'REM-2023-Q09',
    'REM-2023-Q10',
    'REM-2023-Q12',
    'REM-2023-Q13',
    'REM-2023-Q14',
    'REM-2023-Q17',
    'REM-2023-Q20',
    'REM-2024-Q05',
    'REM-2024-Q07',
    'REM-2024-Q10',
    'REM-2024-Q11',
    'REM-2024-Q12',
    'REM-2024-Q14',
    'REM-2024-Q18',
    'REM-2024-Q19',
  ],
  'The independently reviewed answer-correction set must remain exact.',
);

const counts = Object.fromEntries(APPROVED_SUBJECTS.map((subject) => [subject, 0]));
for (const record of payload.records) counts[record.Subject] += 1;
for (const subject of APPROVED_SUBJECTS) {
  assert.ok(counts[subject] >= 40, `${subject} must contain at least 40 records.`);
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

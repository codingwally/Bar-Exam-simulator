import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './validate-labor-cms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const normalizerSource = fs.readFileSync(path.join(root, 'assets/labor-csv-normalizer.js'), 'utf8');
const context = { window: {} };
vm.runInNewContext(normalizerSource, context, { filename: 'labor-csv-normalizer.js' });
const { parseRows } = context.window.DueDiligenceLaborCsv;

const multiline = [
  ['Introductory row'],
  ['Question ID', 'Subject', 'Topic', 'Bar Year', 'Question No.', 'Essay Question', 'Suggested Answer', 'Jurisprudence / Case', 'Citation / G.R. No.'],
  ['LAB-001', 'Labor Law', 'Termination', '2025', '1', 'Question with\na line break and a comma, preserved.', 'Answer with\na line break and a comma, preserved.', 'Example v. Example', 'G.R. No. 1'],
];
const multilineResult = parseRows(multiline);
assert.equal(multilineResult.headerIndex, 1, 'The header must be located after introductory rows.');
assert.equal(multilineResult.questions[0].text, multiline[2][5], 'Multiline questions must remain intact.');
assert.equal(multilineResult.questions[0].model, multiline[2][6], 'Multiline suggested answers must remain intact.');

const url = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTnIYEQTEWRiQtphCLcbOz--qfS64p14RXKTM4bVcU62GGAViwuGXEjgnnRf1sZ5-_jOx9gJ9E4jyvj/pub?gid=1486762536&single=true&output=csv';
const response = await fetch(url);
assert.equal(response.status, 200, 'The published Labor Law CSV must be reachable.');
const matrix = parseCsv(await response.text());
const result = parseRows(matrix);

assert.equal(result.headerIndex, 3, 'The real header must be found after three introductory rows.');
assert.equal(result.invalidRows.length, 0, 'Every published Labor Law row should be valid.');
assert.equal(result.questions.length, 59, 'All 59 Labor Law questions must load.');
assert.equal(new Set(result.questions.map((question) => question.id)).size, 59, 'Question IDs must be unique.');
assert.deepEqual(Array.from(result.questions, (question) => question.id), Array.from({ length: 59 }, (_, index) => `LAB-${String(index + 1).padStart(3, '0')}`), 'LAB-001 through LAB-059 must all be present.');

const yearCounts = Object.fromEntries(['2019', '2024', '2025'].map((year) => [year, result.questions.filter((question) => question.bar_year === year).length]));
assert.deepEqual(yearCounts, { 2019: 20, 2024: 20, 2025: 19 }, 'Published question counts must match the approved Sheet.');
assert.ok(result.questions.every((question) => question.model), 'Every loaded question must retain its suggested answer.');

const header = matrix[result.headerIndex];
const rawById = new Map(matrix.slice(result.headerIndex + 1).map((row) => Object.fromEntries(header.map((name, index) => [name, row[index] ?? '']))).map((row) => [row['Question ID'], row]));
for (const question of result.questions) {
  assert.equal(question.text, String(rawById.get(question.id)['Essay Question']).trim(), `${question.id} must retain its own essay question.`);
  assert.equal(question.model, String(rawById.get(question.id)['Suggested Answer']).trim(), `${question.id} must retain its own suggested answer.`);
}

const pageSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.match(pageSource, /"Labor Law": \[\]/, 'The old ten-question Labor Law sample must not remain as a fallback.');
assert.doesNotMatch(pageSource, /Labor Law Q\.10/, 'No hard-coded ten-item Labor Law bank may remain.');
assert.match(pageSource, /function prevQuestion\(/, 'Existing previous-question navigation must remain.');
assert.match(pageSource, /function nextQuestion\(/, 'Existing next-question navigation must remain.');
assert.match(pageSource, /function randomQuestion\(/, 'Existing random-question behavior must remain.');
assert.match(pageSource, /function evaluateAnswer\(/, 'Existing scoring behavior must remain.');
assert.match(pageSource, /Number\(answerScore\) \+ Number\(legalScore\) \+ Number\(appScore\) \+ Number\(conclusionScore\)/, 'The existing numeric ALAC score calculation must remain.');

console.log('Labor Law CSV loader tests passed.');

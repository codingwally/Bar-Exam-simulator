import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const helperSource = html.match(
  /function normalizeFivePointScore\(value\)\s*\{[\s\S]*?\n\}/,
)?.[0];

assert.ok(helperSource, 'Five-point history scores must use a defensive normalizer.');

const normalizeFivePointScore = Function(
  `${helperSource}; return normalizeFivePointScore;`,
)();

assert.equal(normalizeFivePointScore(5), 5);
assert.equal(normalizeFivePointScore('3.7'), 3.7);
assert.equal(normalizeFivePointScore(0), 0);
assert.equal(normalizeFivePointScore(null), null);
assert.equal(normalizeFivePointScore(undefined), null);
assert.equal(normalizeFivePointScore(''), null);
assert.equal(normalizeFivePointScore('not-a-score'), null);
assert.equal(normalizeFivePointScore(Number.NaN), null);
assert.equal(normalizeFivePointScore(-0.1), null);
assert.equal(normalizeFivePointScore(5.1), null);

assert.match(html, /Assessment score unavailable/);
assert.match(html, /\.hist-score\.neutral/);
assert.match(
  html,
  /record\.sourceType === 'legacy_grading_result'/,
  'Older grading records must remain represented by the current Analytics data model.',
);
assert.doesNotMatch(
  html,
  /Number\((?:item|a)\.score\)\.toFixed/,
  'History rendering must never format an unchecked score.',
);

console.log('History score safety regression passed.');

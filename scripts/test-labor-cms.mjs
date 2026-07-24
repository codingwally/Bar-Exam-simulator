import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, validateCorpus } from './validate-labor-cms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../content/labor-law-cms');
const templateReport = validateCorpus(root, 'template');
assert.equal(templateReport.errors.length, 0, templateReport.errors.join('\n'));
assert.equal(templateReport.stats.questions, 30, 'Phase 1 must reserve exactly 30 Labor Law questions.');

const releaseReport = validateCorpus(root, 'release');
assert.ok(releaseReport.errors.length > 0, 'The draft template must not accidentally pass the release gate.');

const parsed = parseCsv('a,b\n"quoted, value",two\n');
assert.deepEqual(parsed, [['a', 'b'], ['quoted, value', 'two']], 'CSV parser must preserve quoted commas.');

console.log('Labor CMS validator tests passed.');

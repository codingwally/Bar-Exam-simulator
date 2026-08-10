import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeRosterUpload } from '../worker/exam-room-2026-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatePath = path.join(root, 'assets', 'examination-room-beadle-class-list-template.xlsx');
const bytes = await readFile(templatePath);
const details = await stat(templatePath);

assert.ok(details.isFile());
assert.ok(bytes.length > 1_000 && bytes.length < 2_000_000);
assert.equal(bytes[0], 0x50);
assert.equal(bytes[1], 0x4b);

await assert.rejects(
  normalizeRosterUpload({
    examId: '11111111-1111-4111-8111-111111111111',
    fileName: 'examination-room-beadle-class-list-template.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: bytes.toString('base64'),
  }),
  (error) => error?.code === 'ROSTER_EMPTY'
    && error?.message === 'The class list contains no student rows.',
  'The shipped blank workbook must pass the official header check before reporting that it needs students.',
);

console.log('Beadle roster template asset contract passed.');

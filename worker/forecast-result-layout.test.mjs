import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import notoSansBase64 from './noto-sans-latin-ext.mjs';
import * as core from './bar-forecast-core.mjs';
import { buildForecastResultPdf, validateSavedForecastForExport } from './forecast-result-export.mjs';
import { OWNER, curatedFixture } from './forecast-result-layout-fixture.mjs';

const source = (await readFile(new URL('./forecast-result-pdf.mjs', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const fontBytes = Buffer.from(notoSansBase64, 'base64');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const makeMeasurer = runInNewContext(`(${source.slice(source.indexOf('function createForecastPdfWidthMeasurer('), source.indexOf('\nexport async function buildForecastResultPdf('))})`);
const freshFeatures = () => ({ kern: false, mark: false, mkmk: false });

test('only pinned-font GPOS tags are disabled; all GSUB substitutions stay enabled', () => {
  assert.equal(hash(fontBytes), 'b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5');
  const face = fontkit.create(fontBytes);
  const gpos = face.GPOS.featureList.map((row) => row.tag);
  const gsub = face.GSUB.featureList.map((row) => row.tag);
  assert.deepEqual(gpos, ['kern', 'mark', 'mkmk']);
  for (const tag of gpos) assert.equal(gsub.includes(tag), false);
  assert.match(source, /pdf\.embedFont\(fontBytes, \{ subset: true, features: \{ kern: false, mark: false, mkmk: false \} \}\)/u);
  assert.match(source, /pages\.length >= 400/u);
  assert.match(source, /const PDF_MAX_BYTES = 10 \* 1024 \* 1024/u);
});

test('alternating scripts, combining marks and ligatures preserve glyph IDs, advances and extraction code points', () => {
  const oldFace = fontkit.create(fontBytes);
  const newFace = fontkit.create(fontBytes);
  const features = freshFeatures();
  const strings = [
    'office affinity ffi fi fl ff AVATAR To Wa', 'αβγ άέήίόύώ Ελληνικά',
    'АБВ абв Й й Ё ё Русский', 'Señor Niño café ₱149 — naïve',
    'a\u0301 e\u0308 n\u0303', 'ffi\u0301 fl\u0308 ff\u0327',
    'Latin Ελληνικά Русский mixed 123', 'α\u0301 а\u0308 a\u0327',
    '0123456789 / 100 4.7 / 5', 'ﬁ ﬂ ﬃ ﬄ',
  ];
  const observedGlyphs = (run) => run.glyphs.map((glyph) => [glyph.id, glyph.advanceWidth, [...glyph.codePoints]]);
  for (const text of [...strings, ...strings.toReversed(), ...strings]) {
    assert.deepEqual(observedGlyphs(newFace.layout(text, features)), observedGlyphs(oldFace.layout(text)), text);
    assert.equal(features.kern, false); assert.equal(features.mark, false); assert.equal(features.mkmk, false);
  }
});

test('numeric width memo is exact, size-sensitive and owned by one render', () => {
  let calls = 0;
  const face = { widthOfTextAtSize: (text, size) => { calls += 1; return text.length * size + 0.125; } };
  const first = makeMeasurer(face);
  assert.equal(first('office café', 10), 110.125);
  assert.equal(first('office café', 10), 110.125);
  assert.equal(calls, 1);
  assert.equal(first('office café', 11), 121.125);
  assert.equal(first('office cafe', 10), 110.125);
  assert.equal(calls, 3);
  assert.equal(makeMeasurer(face)('office café', 10), 110.125);
  assert.equal(calls, 4, 'a second report cannot read cached private text from the first');
});

test('memo saturates at both entry and retained text caps without losing exact measurements', () => {
  let calls = 0;
  const face = { widthOfTextAtSize: (text, size) => { calls += 1; return text.length * size; } };
  const entries = makeMeasurer(face);
  for (let index = 0; index < 16_384; index += 1) entries(`word${index}`, 10);
  const before = calls;
  assert.equal(entries('word0', 10), 50); assert.equal(calls, before);
  entries('over-entry-cap', 10); entries('over-entry-cap', 10);
  assert.equal(calls, before + 2);
  const characters = makeMeasurer(face);
  const full = 'x'.repeat(1_048_576 - '10:'.length);
  characters(full, 10); const afterFull = calls;
  characters(full, 10); assert.equal(calls, afterFull);
  characters('overflow', 10); characters('overflow', 10);
  assert.equal(calls, afterFull + 2);
});

test('actual greedy wrapping is unchanged at word boundaries and for oversized unbroken words', async () => {
  const oldPdf = await PDFDocument.create(); oldPdf.registerFontkit(fontkit);
  const oldFont = await oldPdf.embedFont(fontBytes, { subset: true });
  const newPdf = await PDFDocument.create(); newPdf.registerFontkit(fontkit);
  const newFont = await newPdf.embedFont(fontBytes, { subset: true, features: freshFeatures() });
  const wrapSource = source.slice(source.indexOf('  function wrap(value, size) {'), source.indexOf('\n  function body('));
  const oldSource = wrapSource.replaceAll('measureWidth(', 'font.widthOfTextAtSize(')
    .replace("        if (font.widthOfTextAtSize(word, size) <= width) { line = word; continue; }\n", '');
  assert.notEqual(oldSource, wrapSource);
  const getWrap = (body, font) => new Function('checkedText', 'font', 'width', 'measureWidth', `${body}; return wrap;`)(String, font, 499.28, makeMeasurer(font));
  const original = getWrap(oldSource, oldFont); const optimized = getWrap(wrapSource, newFont);
  for (const text of [
    'The controlling doctrine applies to these material facts. '.repeat(30),
    `A short line ${'unbroken'.repeat(120)} final conclusion`,
    'office affinity café Señor Niño Ελληνικά Русский '.repeat(30),
    'a\u0301 ffi\u0301 n\u0303 '.repeat(120),
    '\n\nIndented\twords and\n\nempty paragraphs\n',
  ]) for (const size of [7, 10, 16, 24]) assert.deepEqual(optimized(text, size), original(text, size));
});

test('current curated20 PDF equals pre-optimization bytes and repeats without changing the canonical report', async () => {
  const attempt = await curatedFixture(); const before = hash(JSON.stringify(attempt));
  const bytes = await buildForecastResultPdf({ attempt, ownerId: OWNER });
  // Recorded from the unmodified renderer; real curated source, synthetic answers/checkpoints only.
  assert.equal(hash(bytes), '7b6de709318e3899ddfdd5d9334e2bdc77534055209dd481b8870795789e323a');
  assert.deepEqual(await buildForecastResultPdf({ attempt, ownerId: OWNER }), bytes);
  assert.equal(hash(JSON.stringify(attempt)), before);
  assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 21);
});

test('all20 maximum6000-character answers retain every original PDF byte without imposing a lower cap', async () => {
  const attempt = await curatedFixture();
  for (let index = 0; index < 20; index += 1) {
    const row = attempt.result.results[index]; const words = row.suggestedAnswer.split(/\s+/u);
    let text = ''; let block = 0;
    while (text.length < 6000) {
      const rotated = words.slice(block % words.length).concat(words.slice(0, block % words.length));
      text += `Synthetic Q${index + 1} paragraph${++block}: ${rotated.join(' ')} I would distinguish those material facts, test the alternative interpretation, and apply each legal requirement to explain my conclusion.\n\n`;
    }
    const answer = text.slice(0, 6000);
    attempt.answers[index].answer = answer; attempt.result.results[index] = { ...row, userAnswer: answer };
  }
  assert.equal(attempt.answers.every((row) => row.answer.length === core.BAR_FORECAST_LIMITS.answerCharacters), true);
  const before = hash(JSON.stringify(attempt));
  const bytes = await buildForecastResultPdf({ attempt, ownerId: OWNER });
  assert.equal(hash(bytes), '332d07f769d9ad957beb10ad451b0c23864c5bad768064fe83096e44413f7450');
  assert.deepEqual(await buildForecastResultPdf({ attempt, ownerId: OWNER }), bytes);
  assert.equal(hash(JSON.stringify(attempt)), before);
  // Local timing deliberately is not a release guarantee for a hosted CPU budget.
});

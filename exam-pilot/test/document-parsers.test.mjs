import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DOMParser } from "linkedom";
import { readExamFile } from "../public/document-import.mjs";
globalThis.DOMParser = DOMParser;
const fixture = async (name) =>
  new File(
    [await readFile(new URL(`./fixtures/${name}`, import.meta.url))],
    name,
  );
const mammothLoader = () => import("../public/document-vendor/mammoth.mjs");
const pdfLoader = () => import("pdfjs-dist/legacy/build/pdf.mjs");
test("actual Word parser preserves preamble, paragraphs and lettered subquestions", async () => {
  const result = await readExamFile(await fixture("teaching-paper.docx"), {
    mammothLoader,
  });
  assert.equal(result.questions.length, 2);
  assert.match(result.instructions, /Instructions: Explain your reasoning/);
  assert.match(result.questions[0].text, /a\) Identify the issue/);
  assert.match(result.questions[0].text, /b\) Explain the consequence/);
  assert.match(result.questions[1].text, /Discuss the limits/);
});
test("actual Word automatic and Roman lists become separate contiguous questions", async () => {
  for (const name of ["automatic-numbering.docx", "roman-numbering.docx"]) {
    const result = await readExamFile(await fixture(name), { mammothLoader });
    assert.equal(result.questions.length, 2, name);
    assert.deepEqual(
      result.questions.map((q) => q.number),
      [1, 2],
    );
    assert.match(result.questions[0].text, /First/);
    assert.match(result.questions[1].text, /Second/);
  }
});
test("actual PDF parser preserves a complete text paper without network or AI", async () => {
  const result = await readExamFile(await fixture("teaching-paper.pdf"), {
    pdfLoader,
  });
  assert.equal(result.questions.length, 2);
  assert.match(result.instructions, /Explain your reasoning/);
  assert.match(result.questions[0].text, /a\) Identify the issue/);
  assert.match(result.questions[1].text, /Discuss the limits/);
});
test("actual textless PDF never produces a partial exam", async () => {
  await assert.rejects(
    readExamFile(await fixture("textless-paper.pdf"), { pdfLoader }),
    (error) =>
      Array.isArray(error.scannedPages) &&
      error.scannedPages[0] === 1 &&
      /No incomplete question paper/.test(error.message),
  );
});
test("malformed Word/PDF and answer-key papers are rejected by actual parsers", async () => {
  await assert.rejects(
    readExamFile(await fixture("malformed.docx"), { mammothLoader }),
    /could not be read/,
  );
  await assert.rejects(
    readExamFile(await fixture("malformed.pdf"), { pdfLoader }),
    /could not be read/,
  );
  await assert.rejects(
    readExamFile(await fixture("answer-key.txt")),
    /answer key/,
  );
  assert.equal(
    (await readExamFile(await fixture("no-questions.txt"))).questions.length,
    0,
  );
});

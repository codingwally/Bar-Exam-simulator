import test from "node:test";
import assert from "node:assert/strict";
import {
  examFromText,
  examDirections,
  readExamFile,
  textFromPDFItems,
  checkDocxArchive,
} from "../public/document-import.mjs";
test("preamble and full multiline questions preserved; numbering normalized", () => {
  const r = examFromText(
    "Actual paper title\nInstructions: Explain every conclusion.\n\n3. First facts.\nSecond paragraph.\na) Subquestion.\nb) Another subquestion.\n\n7. Second facts.",
  );
  assert.equal(
    r.instructions,
    "Actual paper title\nInstructions: Explain every conclusion.",
  );
  assert.equal(r.questions.length, 2);
  assert.deepEqual(
    r.questions.map((q) => q.number),
    [1, 2],
  );
  assert.match(r.questions[0].text, /Second paragraph\.\na\) Subquestion/);
  assert.equal(r.sourceText.startsWith("Actual paper title"), true);
  assert.equal(r.warnings.length, 1);
});
test("Roman root numbering retains numbered and lettered subquestions", () => {
  const r = examFromText(
    "Instructions: Use complete sentences.\nI. First root.\n  1. Nested detail.\n  2. Nested detail two.\nII. Second root.\na) Discuss this.",
  );
  assert.equal(r.questions.length, 2);
  assert.match(r.questions[0].text, /1\. Nested detail/);
  assert.match(r.questions[1].text, /a\) Discuss/);
});
test("explicit Question markers dominate internal numeric lists", () => {
  const r = examFromText(
    "Question 1: Main question\n1. An internal list\n2. Another internal list\nQuestion 2: Next question",
  );
  assert.equal(r.questions.length, 2);
  assert.match(r.questions[0].text, /2\. Another/);
});
test("duplicate root numbering refuses ambiguous split; original text retained", () => {
  assert.throws(
    () => examFromText("1. First\n1. Ambiguous\n2. Next"),
    (error) => !!error.sourceText && /repeats/.test(error.message),
  );
});
test("answer key, empty questions and malformed numbering are never silently imported", () => {
  assert.throws(
    () => examFromText("1. Real question\nSuggested answer: Secret"),
    /answer key/,
  );
  assert.throws(() => examFromText("1. \n2. A second question"), /empty/);
  assert.equal(examFromText("Instructions only.").questions.length, 0);
  assert.equal(examFromText("").questions.length, 0);
});
test("safe platform directions append without changing instructor preamble", () => {
  const original = "Apply the specific method given by your professor.";
  assert.equal(examDirections(original).startsWith(original + "\n\n"), true);
  assert.match(examDirections(original), /same device and browser/);
  assert.doesNotMatch(
    examDirections(""),
    /ALAC|Article|Constitution|legal basis/i,
  );
});
test("PDF text geometry joins spaced words and maintains lines", () => {
  assert.equal(
    textFromPDFItems([
      { str: "1.", width: 8, transform: [1, 0, 0, 1, 50, 700] },
      { str: "Question", width: 50, transform: [1, 0, 0, 1, 65, 700] },
      { str: "Next line", width: 50, transform: [1, 0, 0, 1, 50, 680] },
    ]),
    "1. Question\nNext line",
  );
});
test("legacy DOC and fake file extensions report a factual recovery action", async () => {
  await assert.rejects(
    readExamFile(new File(["old binary"], "question.doc")),
    /Save As/,
  );
  await assert.rejects(
    readExamFile(new File(["not zip"], "question.docx")),
    /not a readable Word/,
  );
  await assert.rejects(
    readExamFile(new File(["not pdf"], "question.pdf")),
    /not a readable PDF/,
  );
  await assert.rejects(
    readExamFile(new File(["data"], "question.exe")),
    /Choose a Word/,
  );
});
test("cancelled document reading does not return partial questions", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    readExamFile(new File(["1. Q"], "q.txt"), { signal: controller.signal }),
    (error) => error.name === "AbortError",
  );
});
test("separate question labels and instruction sections remain distinct", () => {
  const r = examFromText(
    "I. General Instructions\n1. Read carefully.\n2. Use complete sentences.\nII. Questions\n1.\nFirst complete facts.\n2.\nSecond complete facts.",
  );
  assert.equal(r.questions.length, 2);
  assert.match(r.instructions, /Read carefully/);
  assert.equal(r.questions[0].text, "First complete facts.");
});
const archiveMetadataFixture = (size = 1, payload = new Uint8Array()) => {
  const start = 30 + payload.length,
    end = start + 46;
  const buffer = new ArrayBuffer(end + 22),
    data = new DataView(buffer);
  data.setUint32(0, 0x04034b50, true);
  new Uint8Array(buffer).set(payload, 30);
  data.setUint32(start, 0x02014b50, true);
  data.setUint32(start + 24, size, true);
  data.setUint32(end, 0x06054b50, true);
  data.setUint16(end + 8, 1, true);
  data.setUint16(end + 10, 1, true);
  data.setUint32(end + 12, 46, true);
  data.setUint32(end + 16, start, true);
  return buffer;
};
test("Word archive uncompressed-size guard rejects a small compressed bomb", () => {
  const buffer = archiveMetadataFixture(41 * 1024 * 1024);
  assert.throws(() => checkDocxArchive(buffer), /unpacked Word/);
});
test("ZIP signatures inside ordinary entry data cannot become fake directory entries", () => {
  const payload = new Uint8Array(46),
    fake = new DataView(payload.buffer);
  fake.setUint32(0, 0x02014b50, true);
  fake.setUint32(24, 41 * 1024 * 1024, true);
  assert.deepEqual(checkDocxArchive(archiveMetadataFixture(1, payload)), {
    entries: 1,
    total: 1,
  });
});
test("truncated or inconsistent Word central directories fail before decompression", () => {
  assert.throws(
    () => checkDocxArchive(new ArrayBuffer(8)),
    /could not be read/,
  );
  const wrongCount = archiveMetadataFixture(),
    data = new DataView(wrongCount),
    end = wrongCount.byteLength - 22;
  data.setUint16(end + 8, 2, true);
  data.setUint16(end + 10, 2, true);
  assert.throws(() => checkDocxArchive(wrongCount), /could not be read/);
  const wrongOffset = archiveMetadataFixture(),
    offsetData = new DataView(wrongOffset);
  offsetData.setUint32(wrongOffset.byteLength - 6, 31, true);
  assert.throws(() => checkDocxArchive(wrongOffset), /could not be read/);
});
test("repeated Questions page headers never discard the earlier question pages", () => {
  const source =
    "Question paper\nQuestions\n1. First page complete question.\na) First subpart.\nQuestions\n2. Second page complete question.";
  const result = examFromText(source);
  assert.equal(result.questions.length, 2);
  assert.match(result.questions[0].text, /First page complete question/);
  assert.match(result.questions[0].text, /First subpart/);
  assert.match(result.questions[1].text, /Second page complete question/);
  assert.doesNotMatch(result.instructions, /First page/);
  assert.equal(result.sourceText, source);
});
test("a Questions heading cannot silently move preceding questions into instructions", () => {
  const source = "1. First question.\nQuestions\n2. Second question.";
  assert.throws(
    () => examFromText(source),
    (error) =>
      /heading appears after numbered/.test(error.message) &&
      error.sourceText === source,
  );
});
test("mixed root numbering cannot silently discard questions before later Question labels", () => {
  const source =
    "1. First complete question.\n2. Second complete question.\nQuestion 3: Third complete question.";
  assert.throws(
    () => examFromText(source),
    (error) =>
      /mixes numbered questions/.test(error.message) &&
      error.sourceText === source,
  );
});

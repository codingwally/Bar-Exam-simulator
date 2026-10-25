import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { examinationPdfData, createExaminationPdf, wrapPdfText } from "../public/answer-pdf.mjs";

const fontBytes = Object.fromEntries(await Promise.all(["inter", "fraunces"].map(async name => [name, new Uint8Array(await readFile(new URL(`../public/fonts/${name}-pdf.ttf`, import.meta.url)))])));
const state = () => ({
  exam: { id: "practice-1", title: "Constitutional Law I - Midterm Practice", questionCount: 2 },
  serverTime: 1792886400000,
  attempt: {
    id: "attempt-123", name: "María Peñaflor", email: "student@example.invalid", status: "finalized", startedAt: 1792884000000,
    questions: [{ id: "q1", number: 1, text: "Congress enacts a law contrary to the Constitution. Is the law valid? Explain." }, { id: "q2", number: 2, text: "May the State establish an official religion? Explain." }],
    answers: [{ questionId: "q1", text: "The Constitution is supreme. The challenged law is invalid. END-FIRST-ANSWER" }, { questionId: "q2", text: "" }],
    receipt: { id: "receipt-123", checksum: "abcdef0123456789".repeat(4), answeredCount: 1, questionCount: 2, finalizedAt: 1792885800000 },
  },
});
const extract = async bytes => {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const doc = await task.promise;
  let text = "";
  for (let index = 1; index <= doc.numPages; index++) text += (await (await doc.getPage(index)).getTextContent()).items.map(item => item.str).join(" ") + "\n";
  const attachments = await doc.getAttachments();
  const archival = await doc.getAttachmentContent("complete-examination-record.txt");
  const pages = doc.numPages;
  await task.destroy();
  return { text, pages, attachments, archival };
};

test("PDF exports the immutable submitted answers, preserves blank slots and separates late writing", async () => {
  const data = examinationPdfData(state(), { answers: { q1: { text: "UNSENT LATE WORDS", acknowledged: false } } });
  const bytes = await createExaminationPdf(data, { fontBytes });
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  const parsed = await PDFDocument.load(bytes);
  assert.match(parsed.getTitle(), /Midterm Practice/);
  const result = await extract(bytes);
  for (const fragment of ["María Peñaflor", "SUBMISSION CONFIRMED", "END-FIRST-ANSWER", "UNSENT LATE WORDS", "[Blank answer]", "SEPARATE LATE / OFFLINE DRAFT", "receipt-123", "QUESTION 1", "QUESTION 2"]) assert.ok(result.text.includes(fragment), fragment);
  assert.equal(result.pages, 3);
  const archival = new TextDecoder().decode(result.archival);
  assert.ok(archival.includes("UNSENT LATE WORDS"));
  assert.ok(archival.includes("END-FIRST-ANSWER"));
});

test("long answers and unbroken tokens paginate without dropping their end", async () => {
  const current = state();
  current.attempt.answers[0].text = Array.from({ length: 450 }, (_, i) => `paragraph-${i}: The Constitution governs the validity of government action.`).join("\n\n") + "\n" + "ABCD".repeat(300) + " FINISH-ENTIRE-LONG-ANSWER";
  const data = examinationPdfData(current);
  const result = await extract(await createExaminationPdf(data, { fontBytes }));
  assert.ok(result.pages > 10);
  assert.ok(result.text.includes("paragraph-449"));
  assert.ok(result.text.includes("FINISH-ENTIRE-LONG-ANSWER"));
  for (let index = 0; index < 450; index++) assert.ok(result.text.includes(`paragraph-${index}:`), `Missing paragraph ${index}`);
  assert.equal(new TextDecoder().decode(result.archival).includes(current.attempt.answers[0].text), true);
});

test("device-only and receipt-only copies tell the truth about submission", async () => {
  const current = state();
  delete current.attempt.receipt;
  current.attempt.status = "active";
  const draft = examinationPdfData(current, { answers: { q1: { text: "Latest device answer" } } });
  assert.equal(draft.status, "DEVICE COPY - NOT SUBMITTED");
  assert.equal(draft.questions[0].answer, "Latest device answer");
  const result = await extract(await createExaminationPdf(examinationPdfData(state(), {}, { receiptOnly: true }), { fontBytes }));
  assert.ok(result.text.includes("Submission receipt"));
  assert.equal(result.text.includes("QUESTION 1"), false);
  assert.equal(result.pages, 1);
});

test("text wrapping preserves every Unicode code point and long token", () => {
  const source = "A longword" + "界🙂".repeat(40) + " end";
  const lines = wrapPdfText(source, value => [...value].length, 10);
  assert.equal(lines.join(""), source);
  assert.ok(lines.every(line => [...line].length <= 10));
});

test("question instructions, marks, canonical start time and every recovered revision are preserved", async () => {
  const current = state();
  current.exam.instructions = "Answer both questions and give reasons.";
  current.attempt.startAt = current.attempt.startedAt;
  delete current.attempt.startedAt;
  current.attempt.questions[0].instructions = "Discuss both arguments.";
  current.attempt.questions[0].points = 50;
  current.attempt.recoveredDrafts = [{ questionId: "q1", text: "FIRST RECOVERED REVISION", receivedAt: 1792886000000 }, { questionId: "q1", text: "SECOND RECOVERED REVISION", receivedAt: 1792886100000 }];
  const data = examinationPdfData(current);
  assert.notEqual(data.startedAt, "Not recorded");
  const result = await extract(await createExaminationPdf(data, { fontBytes }));
  for (const text of ["Discuss both arguments.", "50 POINTS", "FIRST RECOVERED REVISION", "SECOND RECOVERED REVISION", "Answer both questions and give reasons."]) assert.ok(result.text.includes(text), text);
});

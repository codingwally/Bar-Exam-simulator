import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { buildSubmissionEmails, splitEmailText, SUBMISSION_CONFIRMED } from "../email-template.mjs";
import { answerPacket, deliverJob, submissionEmailData } from "../delivery.mjs";

const spreadsheet = "private_collection_12345678901234567890";
const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheet}/edit`;
const payload = () => ({
  exam: { id: "private-exam-id", title: "Constitutional Law I — Midterm Practice", instructions: "PRIVATE INSTRUCTOR INSTRUCTIONS" },
  source: { text: "PRIVATE ORIGINAL SOURCE", filename: "PRIVATE FILE.docx" },
  attempt: { id: "00000000-0000-4000-8000-000000000001", name: "María Peñaflor", email: "student@example.invalid", startedAt: 1000, deadlineAt: 2000 },
  questions: [ { id: "q1", number: 1, text: "PRIVATE QUESTION ONE" }, { id: "q2", number: 2, text: "PRIVATE QUESTION TWO" } ],
  answers: [ { questionId: "q1", text: "Line one ñ ₱🙂\n  <img src=x onerror=alert(1)> & exact end.\n", revision: 3, savedAt: 1500, hash: "private-answer-hash" } ],
  receipt: { id: "receipt-reference", serverTime: 1792911955837, checksum: "private-receipt-checksum", answeredCount: 1, questionCount: 2 },
});
const textOf = node => [...node.childNodes].map(child => child.nodeName === "BR" ? "\n" : child.textContent).join("");
const htmlAnswers = email => {
  const result = new Map();
  for (const part of email.parts) {
    const { document } = parseHTML(part.html);
    for (const node of document.querySelectorAll("[data-answer-number]")) {
      const number = Number(node.getAttribute("data-answer-number"));
      result.set(number, (result.get(number) || "") + textOf(node));
    }
  }
  return result;
};

test("student HTML renders complete numbered frozen answers safely without owner-only data", () => {
  const value = payload();
  const email = buildSubmissionEmails(value, { audience: "student", spreadsheetUrl: sheetUrl, ownerPacket: "PRIVATE OWNER PACKET" });
  const serialized = JSON.stringify(email);
  for (const forbidden of [spreadsheet, "docs.google.com", "PRIVATE INSTRUCTOR", "PRIVATE ORIGINAL", "PRIVATE FILE", "PRIVATE QUESTION", "PRIVATE OWNER", "private-receipt-checksum", "private-answer-hash", "private-exam-id"])
    assert.ok(!serialized.includes(forbidden), forbidden);
  assert.equal(email.parts.length, 1);
  assert.ok(email.parts[0].html.includes(SUBMISSION_CONFIRMED));
  assert.ok(email.parts[0].text.includes(SUBMISSION_CONFIRMED));
  assert.ok(email.parts[0].text.includes("October 25, 2026"));
  assert.ok(email.parts[0].text.includes("PHT"));
  const { document } = parseHTML(email.parts[0].html);
  assert.equal(document.querySelectorAll("img,script,iframe,form").length, 0);
  assert.equal(htmlAnswers(email).get(1), value.answers[0].text);
  assert.equal(htmlAnswers(email).get(2), "[BLANK ANSWER]");
  assert.equal(document.querySelector("h1").textContent, SUBMISSION_CONFIRMED);
});

test("long escaped Unicode answers use bounded explicit parts and remain exactly reconstructable", () => {
  const value = payload();
  value.answers[0].text = "ñ & \" < > 🙂 ₱\n".repeat(28000) + "EXACT FINAL TAIL";
  const email = buildSubmissionEmails(value);
  assert.ok(email.parts.length > 1);
  assert.equal(htmlAnswers(email).get(1), value.answers[0].text);
  assert.equal(htmlAnswers(email).get(2), "[BLANK ANSWER]");
  for (let index = 0; index < email.parts.length; index++) {
    const part = email.parts[index];
    assert.ok(Buffer.byteLength(part.html) + Buffer.byteLength(part.text) <= 130000);
    assert.ok(part.text.includes(`Part ${index + 1} of ${email.parts.length}`));
    assert.ok(!part.text.includes("\uFFFD"));
  }
  assert.equal(splitEmailText(value.answers[0].text, 10001).join(""), value.answers[0].text);
});

test("owner-only HTML includes the validated private collection and the entire exact raw packet", () => {
  const value = payload();
  value.answers[0].text += "Full owner raw answer &🙂 ".repeat(12000);
  const packet = answerPacket(value);
  const email = buildSubmissionEmails(value, { audience: "owner", spreadsheetUrl: sheetUrl, ownerPacket: packet });
  assert.ok(email.parts[0].html.includes(sheetUrl));
  assert.ok(email.parts[0].html.includes("PRIVATE OWNER COPY"));
  const reconstructed = email.parts.map(part => part.text.split("\n\n").slice(1).join("\n\n")).join("");
  assert.equal(reconstructed, packet);
  for (const bad of ["https://attacker.invalid/sheet", sheetUrl + "?copy=leak", "javascript:alert(1)"])
    assert.throws(() => buildSubmissionEmails(value, { audience: "owner", spreadsheetUrl: bad, ownerPacket: packet }), /collection link/);
});

test("provider recipient stays fixed by target and confirmation requires a real receipt", async () => {
  const value = payload();
  const student = await submissionEmailData(value, "student_receipt", { GOOGLE_SPREADSHEET_ID: spreadsheet });
  const owner = await submissionEmailData(value, "owner_email", { GOOGLE_SPREADSHEET_ID: spreadsheet });
  assert.equal(student.recipient, value.attempt.email);
  assert.equal(owner.recipient, "wallyesteban1993@gmail.com");
  assert.ok(!JSON.stringify(student).includes(spreadsheet));
  assert.equal(owner.attemptEmail, value.attempt.email);
  assert.ok(owner.contentHash && student.contentHash && owner.contentHash !== student.contentHash);
  for (const email of ["first@example.invalid,other@example.invalid", "first@example.invalid\r\nBcc:x@example.invalid"]) {
    const bad = payload(); bad.attempt.email = email;
    await assert.rejects(submissionEmailData(bad, "student_receipt"), /email address/);
  }
  const unsubmitted = payload(); unsubmitted.receipt = null;
  assert.throws(() => buildSubmissionEmails(unsubmitted), /final receipt/);
});

test("student provider MIME body contains HTML and plaintext with full answers and no private collection or source", async () => {
  const value = payload(), calls = [];
  await deliverJob({ id: "student-delivery", target: "student_receipt", payload: value }, {
    EMAIL_DELIVERY_ENABLED: "true", RESEND_API_KEY: "synthetic-key", EXAM_EMAIL_FROM: "support@example.invalid", GOOGLE_SPREADSHEET_ID: spreadsheet,
  }, async (url, options) => { calls.push(JSON.parse(options.body)); return Response.json({ id: "provider-reference" }); });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].to, [value.attempt.email]);
  assert.ok(calls[0].html.includes(SUBMISSION_CONFIRMED));
  assert.ok(calls[0].text.includes(value.answers[0].text));
  assert.ok(!JSON.stringify(calls).includes(spreadsheet));
  assert.ok(!JSON.stringify(calls).includes("PRIVATE ORIGINAL"));
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import { examinationPdfData } from "../public/answer-pdf.mjs";

const html = await readFile(new URL("../public/admin.html", import.meta.url), "utf8"),
  source = (await readFile(new URL("../public/admin.mjs", import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?from\s+"[^"]+";\r?\n/gm, "")
    .replace(/\ninit\(\);\s*$/, "");
const exam = {
  id: "synthetic-exam", title: "Constitutional Law I", kind: "practice",
  instructions: "Answer both questions and explain your legal basis.", question_count: 2,
};
const detail = {
  attempt: {
    id: "synthetic-attempt", name: "Synthetic Student", email: "synthetic@example.invalid",
    status: "finalized", started_at: "2026-10-25T03:00:00.000Z",
  },
  questions: [
    { id: "q1", number: 1, text: "First complete question", instructions: "Explain.", points: 5 },
    { id: "q2", number: 2, text: "Second complete question", points: 5 },
  ],
  answers: [
    { question_id: "q1", text: "Final answer\nwith exact preserved whitespace ñ.", revision: 2 },
    { question_id: "q2", text: "", revision: 0 },
  ],
  receipt: {
    id: "synthetic-receipt", serverTime: 1792897800000,
    checksum: "synthetic-checksum", answeredCount: 1, questionCount: 2,
  },
  recovered_drafts: [
    { id: "draft-1", question_id: "q1", text: "First late recovery", received_at: 1792897900000, client_time: 1792897890000, revision: 3 },
    { id: "draft-2", question_id: "q1", text: "Second late recovery", received_at: 1792898000000, client_time: 1792897990000, revision: 4 },
  ],
};

function render(examValue, detailValue) {
  let canonical;
  const { document } = parseHTML(html),
    context = vm.createContext({
      document, URL, Intl, Date, exam: examValue, detail: detailValue,
      makePdfData: value => {
        canonical = value;
        return examinationPdfData(value);
      },
    });
  vm.runInContext(source, context);
  const result = vm.runInContext("studentPdfData(exam, detail, makePdfData)", context);
  return { result, canonical };
}

test("professor PDF maps the complete frozen server record, instructions, start time and separate recovery history", () => {
  const { result, canonical } = render(exam, detail);
  assert.equal(result.status, "SUBMISSION CONFIRMED");
  assert.equal(result.instructions, exam.instructions);
  assert.match(result.startedAt, /Oct 25, 2026.*11:00.*PHT/);
  assert.equal(result.receiptId, detail.receipt.id);
  assert.equal(result.checksum, detail.receipt.checksum);
  assert.equal(result.questions.length, 2);
  assert.equal(result.questions[0].answer, detail.answers[0].text);
  assert.equal(result.questions[0].instructions, "Explain.");
  assert.equal(result.questions[0].points, 5);
  assert.equal(result.questions[1].answer, "");
  assert.equal(canonical.attempt.recoveredDrafts.length, 2);
  for (let index = 0; index < 2; index++) {
    const recovered = canonical.attempt.recoveredDrafts[index];
    assert.equal(recovered.questionId, "q1");
    assert.equal(recovered.text, detail.recovered_drafts[index].text);
    assert.equal(recovered.receivedAt, detail.recovered_drafts[index].received_at);
  }
  assert.doesNotMatch(result.questions[0].answer, /late recovery/);
});

test("professor PDF distinguishes received in-progress server answers from a submitted record or student device copy", () => {
  const inProgress = structuredClone(detail);
  inProgress.receipt = null;
  inProgress.attempt.status = "active";
  inProgress.recovered_drafts = [];
  const { result } = render(exam, inProgress);
  assert.equal(result.status, "SAVED ANSWERS - NOT SUBMITTED");
  assert.match(result.notice, /answers received by the examination service/);
  assert.match(result.notice, /does not confirm final submission/);
  assert.equal(result.questions[0].answerLabel, "Received answer");
  assert.equal(result.questions[0].answer, detail.answers[0].text);
  assert.equal(result.questions[1].answer, "");
});

function downloadFixture(paper) {
  let releasePaper;
  const pendingPaper = new Promise(resolve => { releasePaper = resolve; }),
    { document } = parseHTML(html),
    requests = [], outputs = [], blobs = [];
  class DownloadURL extends URL {
    static createObjectURL(blob) { blobs.push(blob); return "blob:synthetic-pdf"; }
    static revokeObjectURL() {}
  }
  const catalogExam = { ...exam };
  delete catalogExam.instructions;
  const context = vm.createContext({
    document, URL: DownloadURL, Intl, Date, Blob, AbortController,
    catalogExam, selectedDetail: detail,
    window: { addEventListener() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval() {},
    fetch: async path => {
      requests.push(path);
      await pendingPaper;
      return Response.json({ exam: paper });
    },
    // Exercise the real click/API/conversion/download path with a deterministic
    // encoder at the lazy import boundary. The actual PDF converter is retained.
    loadPdf: async () => ({
      examinationPdfData,
      createExaminationPdf: async data => {
        outputs.push(data);
        return new TextEncoder().encode("%PDF-synthetic-encoder");
      },
    }),
  });
  vm.runInContext(source.replace('await import("./answer-pdf.mjs")', "await loadPdf()"), context);
  vm.runInContext("bind(); state.exam = catalogExam; state.detail = selectedDetail;", context);
  return {
    document, requests, outputs, blobs,
    click: () => document.getElementById("download-student").onclick(),
    release: releasePaper,
    changeSelection: () => vm.runInContext("state.exam = { id: 'another-exam', title: 'Other examination' }; state.detail = { attempt: { id: 'another-student', name: 'Other student' }, questions: [], answers: [] };", context),
  };
}

test("professor download fetches missing catalog instructions and retains the clicked exam and student while the screen changes", async () => {
  const f = downloadFixture(exam), pending = f.click();
  assert.equal(f.document.getElementById("download-student").disabled, true);
  assert.deepEqual(f.requests, ["/api/admin/exams/synthetic-exam"]);
  f.changeSelection();
  f.release();
  await pending;
  assert.equal(f.outputs.length, 1);
  assert.equal(f.outputs[0].instructions, exam.instructions);
  assert.equal(f.outputs[0].examId, exam.id);
  assert.equal(f.outputs[0].attemptId, detail.attempt.id);
  assert.equal(f.outputs[0].name, detail.attempt.name);
  assert.equal(f.outputs[0].questions[0].answer, detail.answers[0].text);
  assert.equal(f.blobs.length, 1);
  assert.equal(f.blobs[0].type, "application/pdf");
  assert.equal(f.document.getElementById("download-student").disabled, false);
});

test("professor download refuses an unconfirmed examination detail instead of silently omitting its instructions", async () => {
  const f = downloadFixture({ ...exam, id: "wrong-exam" }), pending = f.click();
  f.release();
  await pending;
  assert.equal(f.outputs.length, 0);
  assert.equal(f.blobs.length, 0);
  assert.match(f.document.getElementById("message").textContent, /PDF could not be prepared/);
  assert.equal(f.document.getElementById("download-student").disabled, false);
});

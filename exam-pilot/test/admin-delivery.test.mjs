import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parseHTML } from "linkedom";

const html = await readFile(new URL("../public/admin.html", import.meta.url), "utf8"),
  source = (await readFile(new URL("../public/admin.mjs", import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?from\s+"[^"]+";\r?\n/gm, "")
    .replace(/\ninit\(\);\s*$/, "");
const sheet = "https://docs.google.com/spreadsheets/d/known-private-sheet/edit#gid=123";

function fixture(reply) {
  const { document } = parseHTML(html),
    context = vm.createContext({
      document, URL, URLSearchParams, Intl, Date, AbortController,
      setTimeout, clearTimeout, reply,
      fetch: async () => Response.json(reply),
    });
  vm.runInContext(source, context);
  return {
    document,
    render: () => vm.runInContext("renderDeliveryStatus(reply)", context),
    load: () => vm.runInContext("state.exam = { id: 'sample-exam' }; loadBackups()", context),
  };
}

test("existing private workbook is visible above responses while automatic delivery remains explicitly disconnected", () => {
  const f = fixture({
    configuration: { sheets: false, email: false, spreadsheetUrl: sheet },
    summary: { pending: 3, failed: 1 },
  });
  f.render();
  const overview = f.document.getElementById("delivery-overview"),
    link = overview.querySelector("a");
  assert.equal(overview.parentElement.id, "responses-view");
  assert.equal(overview.nextElementSibling.className, "response-tools");
  assert.equal(link.href, sheet);
  assert.equal(link.target, "_blank");
  assert.match(link.rel, /noopener/);
  assert.match(overview.textContent, /Not connected\. Automatic answer copies are not being sent to the Sheet\./);
  assert.match(overview.textContent, /Submission emails are not being sent automatically\./);
  assert.match(overview.textContent, /existing workbook can be opened, but automatic copying still needs to be connected/);
  assert.equal(f.document.getElementById("backup-status").querySelector("pre"), null);
});

test("configured delivery does not claim that any particular email arrived or answer was copied", () => {
  const f = fixture({
    configuration: { sheets: true, email: true, spreadsheetUrl: sheet },
    summary: { sent: 0, pending: 2, processing: 1 },
  });
  f.render();
  const text = f.document.getElementById("delivery-overview").textContent;
  assert.match(text, /Check the delivery jobs below for each student's result/);
  assert.match(text, /acceptance for sending; check your inbox for arrival/);
  assert.doesNotMatch(text, /delivered to your inbox|answers have been copied|Not connected/);
  assert.match(f.document.getElementById("backup-status").textContent, /0 completed delivery jobs · 2 waiting · 1 processing/);
});

test("workbook links reject unsafe protocols, origins, credentials and unrelated Google paths", () => {
  for (const spreadsheetUrl of [
    "javascript:alert(1)",
    "https://docs.google.com.attacker.invalid/spreadsheets/d/private/edit",
    "https://secret@docs.google.com/spreadsheets/d/private/edit",
    "https://docs.google.com/document/d/private/edit",
    undefined,
  ]) {
    const f = fixture({ configuration: { spreadsheetUrl } });
    f.render();
    assert.equal(f.document.getElementById("delivery-overview").querySelector("a"), null);
  }
});

test("disconnected pending jobs cannot pretend a retry will send, while older completed jobs retain their history", async () => {
  const f = fixture({
    configuration: { sheets: false, email: false, spreadsheetUrl: sheet },
    summary: { sent: 1, failed: 1 },
    jobs: [
      { id: "pending-email", target: "owner_email", status: "failed", last_error: "Missing provider configuration" },
      { id: "older-sheet", target: "sheets", status: "sent", reference: "Recorded earlier delivery" },
    ],
  });
  await f.load();
  const jobs = f.document.querySelectorAll(".backup-job");
  assert.match(jobs[0].textContent, /Owner email · Not connected/);
  assert.match(jobs[0].textContent, /saved answers remain available/);
  assert.equal(jobs[0].querySelector("button"), null);
  assert.match(jobs[1].textContent, /Google Sheet · Completed/);
  assert.match(jobs[1].textContent, /Recorded earlier delivery/);
});

test("connected but failed deliveries show the actual failure and retain a retry action", async () => {
  const f = fixture({
    configuration: { sheets: true, email: true },
    summary: { failed: 1 },
    jobs: [{ id: "failed-email", target: "owner_email", status: "failed", last_error: "Email provider returned HTTP 429" }],
  });
  await f.load();
  const job = f.document.querySelector(".backup-job");
  assert.match(job.textContent, /Owner email · Needs attention/);
  assert.match(job.textContent, /Email provider returned HTTP 429/);
  assert.equal(job.querySelector("button").textContent, "Retry delivery");
});

test("owner email relay does not imply that official student receipt email is connected", async () => {
  const f = fixture({
    configuration: { sheets: true, email: true, studentReceipt: false },
    summary: { pending: 2 },
    jobs: [
      { id: "owner-email", target: "owner_email", status: "pending" },
      { id: "student-receipt", target: "student_receipt", status: "pending" },
    ],
  });
  await f.load();
  const jobs = f.document.querySelectorAll(".backup-job");
  assert.match(jobs[0].textContent, /Owner email · Waiting/);
  assert.equal(jobs[0].querySelector("button").textContent, "Retry delivery");
  assert.match(jobs[1].textContent, /Student receipt email · Not connected/);
  assert.equal(jobs[1].querySelector("button"), null);
});

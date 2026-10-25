// Synthetic PDF/font/offline review; no real student or external service data.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { loadPlaywright } from "./playwright-runtime.mjs";

const root = fileURLToPath(new URL("../public/", import.meta.url));
const evidence = new URL("../.wrangler/evidence/", import.meta.url);
await mkdir(evidence, { recursive: true });
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (pathname === "/pdf-review.html") {
    response.setHeader("Content-Type", "text/html");
    return response.end('<!doctype html><link rel="stylesheet" href="/student.css"><title>PDF synthetic review</title><main>PDF synthetic review</main>');
  }
  const path = resolve(root, `.${pathname}`);
  if (!path.startsWith(root) || pathname.includes("..")) { response.statusCode = 404; return response.end(); }
  try {
    response.setHeader("Content-Type", ({ ".mjs": "text/javascript", ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf" })[extname(path)] || "application/octet-stream");
    response.end(await readFile(path));
  } catch { response.statusCode = 404; response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://localhost:${server.address().port}`;
const runtime = loadPlaywright();
const results = [];
const offline = process.env.DD_PDF_OFFLINE !== "false";
try {
  for (const engine of (process.env.DD_BROWSER_ENGINES || "chromium").split(",")) {
    const browser = await runtime[engine].launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`${base}/pdf-review.html`);
      if (offline) {
        await page.evaluate(async () => { await navigator.serviceWorker.register("/exam-sw.mjs"); await navigator.serviceWorker.ready; });
        await page.reload();
        await page.waitForFunction(() => !!navigator.serviceWorker.controller);
        await context.setOffline(true);
      }
      const unicode = "María Peñaflor: ₱500; 中文; العربية; 🙂; exact tail.";
      const bytes = await page.evaluate(async unicode => {
        const { examinationPdfData, createExaminationPdf } = await import("/answer-pdf.mjs");
        const state = { exam: { id: "qa", title: "Constitutional Law I - Synthetic PDF Review", instructions: "Answer the question. Give reasons.", questionCount: 1 }, attempt: { id: "qa-attempt", name: "Demo Student", email: "demo@example.invalid", status: "active", startAt: Date.now(), questions: [{ id: "q1", number: 1, text: "Is the law consistent with the Constitution? Explain.", points: 50 }], answers: [] } };
        return [...await createExaminationPdf(examinationPdfData(state, { answers: { q1: { text: unicode } } }))];
      }, unicode);
      await context.setOffline(false);
      const output = new Uint8Array(bytes);
      assert.equal(new TextDecoder().decode(output.slice(0, 5)), "%PDF-");
      await writeFile(new URL(`pdf-${engine}-${offline ? "offline" : "online"}-unicode.pdf`, evidence), output);
      const task = getDocument({ data: output });
      const doc = await task.promise;
      const exact = new TextDecoder().decode(await doc.getAttachmentContent("complete-examination-record.txt"));
      assert.ok(exact.includes(unicode), "Every Unicode code point survives in the PDF archival text");
      assert.ok(exact.includes("DEVICE COPY - NOT SUBMITTED"));
      const pages = doc.numPages;
      await task.destroy();
      results.push({ engine, offline: offline ? "PASS" : "NOT_RUN", unicodePreservation: "PASS", pages, bytes: bytes.length });
      await context.close();
    } finally { await browser.close(); }
  }
} finally { await new Promise(resolve => server.close(resolve)); }
await writeFile(new URL("pdf-browser-review.json", evidence), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));

// Synthetic only: use the isolated dev-server, whose admin identity is injected.
// DD_ALLOW_SELF_SIGNED=true node exam-pilot/test/workspace-browser.mjs https://localhost:8802
import assert from "node:assert/strict";
import { loadPlaywright } from "./playwright-runtime.mjs";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { syntheticBrowserOptions } from "./synthetic-browser-options.mjs";
const runtime = loadPlaywright();
const base = process.argv[2] || "http://localhost:8797";
const engines = (process.env.DD_BROWSER_ENGINES || "chromium").split(",");
const evidence = new URL("../.wrangler/evidence/", import.meta.url);
await mkdir(evidence, { recursive: true });
const results = [];
for (const engine of engines) {
  const result = {
    engine,
    startedAt: new Date().toISOString(),
    status: "RUNNING",
    checks: [],
    screenshots: [],
    widths: [],
    pageErrors: [],
    consoleErrors: [],
    failedRequests: [],
    limitations: [],
  };
  results.push(result);
  let browser,
    context,
    page,
    stage = "browser-launch",
    offline = false;
  const navigationEvents = new Map();
  const capture = async (name) => {
    const filename = `workspace-${engine}-${name}.png`;
    await page.screenshot({
      path: fileURLToPath(new URL(filename, evidence)),
      fullPage: false,
      timeout: 6000,
      caret: "initial",
    });
    result.screenshots.push(filename);
  };
  const pass = (name) => {
    result.checks.push(name);
    console.log(`${engine}: PASS ${name}`);
  };
  try {
    browser = await runtime[engine].launch(
      await syntheticBrowserOptions(engine, base),
    );
    result.version = browser.version();
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: process.env.DD_ALLOW_SELF_SIGNED === "true",
    });
    stage = "create-configured-exam";
    const created = await context.request.post(
      `${base}/api/admin/exams/create`,
      {
        headers: { Origin: base },
        data: {
          operation_id: randomUUID(),
          title: "Synthetic Civil Law practice",
          kind: "practice",
          duration_minutes: 12,
          instructions:
            "Synthetic instructions: answer every question in plain text.",
          questions: [
            {
              number: 1,
              text: "Synthetic question one. Explain the stated principle.",
              points: 10,
            },
            {
              number: 2,
              text: "Synthetic question two. Apply the principle to these facts.",
              points: 10,
            },
            {
              number: 3,
              text: "Synthetic question three. Give your conclusion.",
              points: 10,
            },
          ],
        },
      },
    );
    assert.equal(created.ok(), true, await created.text());
    const { exam } = await created.json();
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(20000);
    page.on("pageerror", (error) => result.pageErrors.push(error.message));
    page.on("request", (request) => {
      if (
        request.method() !== "POST" ||
        !new URL(request.url()).pathname.endsWith("/events")
      )
        return;
      try {
        for (const event of JSON.parse(request.postData() || "{}").events || [])
          if (event.type === "pagehide")
            navigationEvents.set(event.id, {
              id: event.id,
              type: event.type,
              clientTime: event.clientTime,
            });
      } catch {
        /* Unreadable transport cannot serve as delivery proof. */
      }
    });
    page.on("console", (message) => {
      if (message.type() === "error") result.consoleErrors.push(message.text());
    });
    page.on("requestfailed", (request) =>
      result.failedRequests.push({
        path: new URL(request.url()).pathname,
        method: request.method(),
        failure: request.failure()?.errorText,
        intentionallyOffline: offline,
      }),
    );
    page.on("dialog", (dialog) => dialog.accept());
    stage = "identity-entry";
    await page.goto(`${base}${exam.student_url}`);
    await page
      .getByRole("heading", {
        name: "Synthetic Civil Law practice",
        exact: true,
      })
      .waitFor();
    await page
      .getByText("12 minutes from your start", { exact: true })
      .waitFor();
    await capture("entry-1440");
    await page
      .getByLabel("Full name", { exact: true })
      .fill("Synthetic Workspace Student");
    await page
      .getByLabel("Email address", { exact: true })
      .fill(`${engine}-workspace@example.test`);
    await page.locator("[name=consent]").check();
    await page
      .getByRole("button", { name: "Start practice", exact: true })
      .click();
    await page.locator("textarea").waitFor();
    const state = await page.evaluate(
      async (slug) => (await fetch(`/api/exams/${slug}/state`)).json(),
      exam.slug,
    );
    assert.equal(state.attempt.deadlineAt - state.attempt.startAt, 720000);
    const originalDeadline = state.attempt.deadlineAt,
      originalAttempt = state.attempt.id;
    result.attempt = {
      id: originalAttempt,
      examSlug: exam.slug,
      deadlineAt: originalDeadline,
    };
    pass("dynamic exam title, instructions and configured 12-minute deadline");
    stage = "answer-flag-and-text-size";
    await page.locator("textarea").fill("Exact synthetic first answer.");
    await page.getByText(/Saved to server at/).waitFor();
    await page
      .getByRole("button", { name: "Flag question", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("button", { name: "Flagged", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.getByRole("button", { name: "Larger", exact: true }).click();
    assert.equal(
      await page
        .locator("textarea")
        .evaluate((node) => getComputedStyle(node).fontSize),
      "19px",
    );
    await page.getByRole("tab", { name: "Instructions", exact: true }).click();
    await page
      .locator(".tool-instructions")
      .filter({
        hasText: "Synthetic instructions: answer every question in plain text.",
      })
      .waitFor();
    await capture("instructions-desktop");
    stage = "hide-and-resume";
    await page.getByRole("button", { name: "Hide exam", exact: true }).click();
    await page
      .getByRole("heading", { name: "Examination hidden", exact: true })
      .waitFor();
    await capture("hidden");
    await page
      .getByRole("button", { name: "Resume examination", exact: true })
      .click();
    pass("flag, text size, instructions and hide/resume controls");
    stage = "review-navigation";
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.locator("textarea").fill("Exact synthetic second answer.");
    await page.getByText(/Saved to server at/).waitFor();
    await page
      .getByRole("button", { name: "Review & submit", exact: true })
      .click();
    await capture("review");
    await page
      .locator(".review-question")
      .filter({ hasText: "Flagged" })
      .click();
    assert.equal(
      await page.locator("textarea").inputValue(),
      "Exact synthetic first answer.",
    );
    pass("review returns to the flagged answer without replacing writing");
    stage = "service-worker-ready";
    let serviceWorkerTimer;
    try {
      // A Node-side timer also fires if the renderer stops responding. Missing
      // service-worker readiness must fail with evidence, never silently pass.
      await Promise.race([
        page.evaluate(() => navigator.serviceWorker.ready.then(() => true)),
        new Promise((_, reject) => {
          serviceWorkerTimer = setTimeout(
            () =>
              reject(
                new Error(
                  "Service worker was not ready within 30 seconds; offline readiness could not be verified.",
                ),
              ),
            30000,
          );
        }),
      ]);
    } finally {
      clearTimeout(serviceWorkerTimer);
    }
    stage = "reload-with-preferences";
    await page.reload();
    await page.locator("textarea").waitFor();
    await page.waitForFunction(() => {
      const editor = document.querySelector("textarea");
      return editor && !editor.readOnly;
    });
    assert.equal(
      await page
        .getByRole("button", { name: "Flagged", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await page
        .locator("textarea")
        .evaluate((node) => getComputedStyle(node).fontSize),
      "19px",
    );
    pass("reload preserves current answer, flag and text size");
    for (const width of [1440, 1024, 768, 390, 375, 320]) {
      stage = `workspace-layout-${width}`;
      await page.setViewportSize({ width, height: 900 });
      const metrics = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      }));
      result.widths.push(metrics);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `Horizontal overflow at ${width}`,
      );
      const footer = await page.locator(".workspace-actions").boundingBox();
      assert.ok(
        footer.y + footer.height <= 901,
        `Footer outside viewport at ${width}`,
      );
      await page.locator("textarea").focus();
      assert.equal(
        await page.evaluate(() => document.activeElement?.id),
        "answer",
      );
      await capture(`writing-${width}`);
    }
    pass(
      "all six widths fit the viewport with visible footer and editor focus",
    );
    stage = "phone-drawers";
    await page.getByRole("button", { name: "Questions", exact: true }).click();
    await page
      .locator(".drawer-question")
      .filter({ hasText: "Question 2" })
      .click();
    assert.equal(
      await page.locator("textarea").inputValue(),
      "Exact synthetic second answer.",
    );
    await page
      .getByRole("button", { name: "Tools and instructions", exact: true })
      .click();
    await capture("tools-phone-320");
    await page
      .getByRole("button", { name: "Close tools", exact: true })
      .filter({ visible: true })
      .click();
    pass("phone question and tools drawers are usable");
    stage = "offline-reopen";
    offline = true;
    await context.setOffline(true);
    await page
      .locator("textarea")
      .fill("Exact synthetic offline second answer.");
    await page.getByText(/Saved on this device/).waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("textarea").waitFor({ timeout: 25000 });
    assert.equal(
      await page.locator("textarea").inputValue(),
      "Exact synthetic offline second answer.",
    );
    assert.equal(await page.locator("textarea").getAttribute("readonly"), null);
    await capture("offline-reopened-320");
    stage = "reconnect-and-save";
    await context.setOffline(false);
    offline = false;
    await page.getByRole("button", { name: "Save now", exact: true }).click();
    await page.getByText(/Saved to server at/).waitFor({ timeout: 20000 });
    const resumed = await page.evaluate(
      async (slug) => (await fetch(`/api/exams/${slug}/state`)).json(),
      exam.slug,
    );
    assert.equal(resumed.attempt.id, originalAttempt);
    assert.equal(resumed.attempt.deadlineAt, originalDeadline);
    pass(
      "offline reload preserves exact writing, admitted question, attempt and deadline",
    );
    stage = "submit-and-server-receipt";
    await page
      .getByRole("button", { name: "Review & submit", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Submit examination", exact: true })
      .click();
    await page
      .getByRole("heading", {
        name: "Your examination is submitted.",
        exact: true,
      })
      .waitFor();
    const final = await page.evaluate(
      async (slug) => (await fetch(`/api/exams/${slug}/state`)).json(),
      exam.slug,
    );
    assert.equal(final.attempt.receipt.answeredCount, 2);
    assert.equal(final.attempt.receipt.questionCount, 3);
    assert.ok(final.attempt.receipt.checksum);
    assert.equal(
      await page.locator(".receipt-details").getAttribute("open"),
      null,
    );
    assert.equal(
      await page.evaluate(() => document.activeElement?.tagName),
      "H1",
    );
    await page
      .getByText("2 of 3 questions answered", { exact: true })
      .waitFor();
    await capture("receipt-phone-320");
    await page.setViewportSize({ width: 1440, height: 900 });
    await capture("receipt-desktop");
    const downloadEvent = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download receipt", exact: true })
      .click();
    const download = await downloadEvent;
    const receiptFile = new URL(`workspace-${engine}-receipt.json`, evidence);
    await download.saveAs(fileURLToPath(receiptFile));
    assert.deepEqual(
      JSON.parse(await readFile(receiptFile, "utf8")),
      final.attempt.receipt,
    );
    await page.getByText("Receipt details", { exact: true }).click();
    await page
      .getByText(final.attempt.receipt.checksum, { exact: true })
      .waitFor();
    await capture("receipt-details");
    const unloadErrors = result.pageErrors.filter(
      (message) =>
        engine === "webkit" &&
        message.endsWith(
          `/api/exams/${exam.slug}/events due to access control checks.`,
        ),
    );
    assert.deepEqual(
      result.pageErrors.filter((message) => !unloadErrors.includes(message)),
      [],
    );
    if (unloadErrors.length) {
      stage = "verify-durable-unload-event-retry";
      const expected = [...navigationEvents.values()];
      assert.ok(
        expected.length,
        "A rejected unload transport needs known event IDs and client timestamps for delivery proof",
      );
      let observed = [];
      for (let retry = 0; retry < 20; retry++) {
        const response = await context.request.get(
          `${base}/api/admin/exams/${exam.slug}/events?attempt_id=${encodeURIComponent(originalAttempt)}`,
        );
        assert.equal(
          response.ok(),
          true,
          "Synthetic admin event verification must be available",
        );
        observed = (await response.json()).events || [];
        if (
          expected.every((event) =>
            observed.some(
              (row) =>
                row.id === event.id &&
                row.type === event.type &&
                row.client_time === event.clientTime,
            ),
          )
        )
          break;
        await page.waitForTimeout(250);
      }
      for (const event of expected)
        assert.ok(
          observed.some(
            (row) =>
              row.id === event.id &&
              row.type === event.type &&
              row.client_time === event.clientTime,
          ),
          `Unload event ${event.id} was not durably retried with its exact client timestamp`,
        );
      result.unloadRetry = { verified: true, events: expected };
      result.limitations.push(
        "WebKit rejected an unload event transport in the self-signed fixture; each observed pagehide event ID and original client timestamp was verified on the server after durable retry.",
      );
    }
    result.receipt = {
      answeredCount: final.attempt.receipt.answeredCount,
      questionCount: final.attempt.receipt.questionCount,
      checksum: final.attempt.receipt.checksum,
      exactDownloadedPayload: true,
    };
    pass(
      "focused human receipt, collapsed technical details and exact receipt download",
    );
    result.status = "PASS";
    console.log(
      `${engine} ${browser.version()}: PASS dynamic exam, configured timer, flags, text size, tools, hide, review, six widths, keyboard, offline reload, same attempt/deadline, server receipt`,
    );
  } catch (error) {
    result.status = "FAIL";
    result.stage = stage;
    result.error = error.stack || error.message;
    console.error(`${engine}: FAIL at ${stage}: ${error.message}`);
    if (page) {
      await capture("failure").catch((captureError) => {
        result.failureCaptureError = captureError.message;
      });
      const text = await page
        .locator("body")
        .innerText({ timeout: 3000 })
        .catch(() => "Page unavailable after failure.");
      await writeFile(
        new URL(`workspace-${engine}-failure.txt`, evidence),
        text.slice(0, 16000),
      );
    }
    process.exitCode = 1;
  } finally {
    result.finishedAt = new Date().toISOString();
    await writeFile(
      new URL(`workspace-${engine}-results.json`, evidence),
      JSON.stringify(result, null, 2),
    );
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}
await writeFile(
  new URL(`workspace-results-${engines.join("-")}.json`, evidence),
  JSON.stringify(results, null, 2),
);

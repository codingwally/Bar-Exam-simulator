// CI browser integration. Local disposable server only; never a live exam.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
export async function runDocumentReview(
  browser,
  baseURL,
  { evidenceDir } = {},
) {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname))
    throw new Error(
      "Synthetic document tests require a local disposable server.",
    );
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      ignoreHTTPSErrors: process.env.DD_ALLOW_SELF_SIGNED === "true",
    }),
    page = await context.newPage(),
    errors = [],
    outcomes = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  const upload = async (name) => {
    await page
      .locator("#exam-file")
      .setInputFiles(
        fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
      );
    await page.waitForFunction(
      () =>
        document.querySelector("#reading-progress").hidden &&
        !document.querySelector("#message").textContent.startsWith("Checking"),
    );
  };
  try {
    await page.goto(`${baseURL}/admin/exams`);
    await page
      .getByRole("heading", { name: "My exams", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Create exam", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Add a question manually", exact: true })
      .click();
    await page
      .locator("#question-0")
      .fill("A question being edited while a document is read.");
    let releaseReader;
    const readerHeld = new Promise((resolve) => {
      releaseReader = resolve;
    });
    const readerRoute = async (route) => {
      await readerHeld;
      await route.continue();
    };
    await page.route("**/document-vendor/mammoth.mjs", readerRoute);
    const readerRequested = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === "/document-vendor/mammoth.mjs",
    );
    try {
      await page
        .locator("#exam-file")
        .setInputFiles(
          fileURLToPath(
            new URL("./fixtures/teaching-paper.docx", import.meta.url),
          ),
        );
      await readerRequested;
      await page
        .locator("#question-0")
        .fill("These newer professor edits must survive the slow import.");
    } finally {
      releaseReader();
    }
    await page.waitForFunction(
      () => document.querySelector("#reading-progress").hidden,
    );
    await page.unroute("**/document-vendor/mammoth.mjs", readerRoute);
    assert.equal(
      await page.locator("#question-0").inputValue(),
      "These newer professor edits must survive the slow import.",
    );
    assert.match(
      await page.locator("#message").innerText(),
      /edited this exam while/,
    );
    outcomes.push(
      "An import delayed by the network cannot overwrite newer professor edits.",
    );
    await upload("teaching-paper.docx");
    assert.equal(await page.locator(".question").count(), 2);
    assert.match(
      await page.locator("#question-0").inputValue(),
      /a\) Identify the issue/,
    );
    assert.match(
      await page.locator("#exam-instructions").inputValue(),
      /Explain your reasoning/,
    );
    outcomes.push(
      "Real Word upload preserves instructions and full two-question text with lettered subparts.",
    );
    for (const name of ["automatic-numbering.docx", "roman-numbering.docx"]) {
      await upload(name);
      assert.equal(await page.locator(".question").count(), 2);
      assert.match(await page.locator("#question-0").inputValue(), /First/);
      assert.match(await page.locator("#question-1").inputValue(), /Second/);
    }
    outcomes.push(
      "Word automatic numeric and Roman lists become separate questions numbered 1 onward.",
    );
    await upload("teaching-paper.pdf");
    assert.equal(await page.locator(".question").count(), 2);
    const first = await page.locator("#question-0").inputValue(),
      instructions = await page.locator("#exam-instructions").inputValue();
    assert.match(first, /a\) Identify the issue/);
    outcomes.push(
      "Real PDF text extraction preserves the complete text and original preamble.",
    );
    for (const name of [
      "textless-paper.pdf",
      "malformed.pdf",
      "malformed.docx",
      "answer-key.txt",
      "no-questions.txt",
    ]) {
      await upload(name);
      assert.equal(
        await page.locator("#question-0").inputValue(),
        first,
        `${name} must not replace existing questions`,
      );
      assert.equal(
        await page.locator("#exam-instructions").inputValue(),
        instructions,
      );
      assert.match(
        await page.locator("#message").innerText(),
        /unchanged|No incomplete/,
      );
    }
    outcomes.push(
      "Scanned/textless, malformed, answer-key and no-question imports never overwrite the existing draft.",
    );
    // Demonstrate direct editing, combining and manual addition without rewriting.
    await page
      .getByRole("button", {
        name: "Combine with next question 1",
        exact: true,
      })
      .click();
    assert.equal(await page.locator(".question").count(), 1);
    assert.match(
      await page.locator("#question-0").inputValue(),
      /fictional department/,
    );
    await page
      .getByRole("button", { name: "Add question", exact: true })
      .click();
    await page
      .locator("#question-1")
      .fill("A separate synthetic follow-up question.");
    await page
      .getByRole("button", { name: "Move up question 2", exact: true })
      .click();
    assert.equal(
      await page.locator("#question-0").inputValue(),
      "A separate synthetic follow-up question.",
    );
    await page
      .locator("#exam-title")
      .fill("Synthetic document upload practice");
    await page.locator("#exam-duration").fill("5");
    await page.locator("#review-confirm").check();
    if (evidenceDir)
      await page.screenshot({
        path: `${evidenceDir}/new-exam-review.png`,
        fullPage: true,
      });
    await page
      .getByRole("button", { name: "Create exam link", exact: true })
      .click();
    await page
      .getByRole("heading", {
        name: "Synthetic document upload practice",
        exact: true,
      })
      .waitFor();
    const link = await page.locator("#share-link").inputValue();
    assert.match(new URL(link).pathname, /^\/exam\/[A-Za-z0-9_-]+$/);
    outcomes.push(
      "Reviewed questions create their own real unique practice link.",
    );
    const student = await context.newPage();
    await student.goto(link);
    await student.getByRole("textbox", { name: "Full name" }).waitFor();
    assert.match(
      await student.locator("body").innerText(),
      /Synthetic document upload practice/,
    );
    await student.close();
    for (const width of [1440, 1024, 768, 390, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
        `Overflow at ${width}`,
      );
      if (evidenceDir && [1440, 390].includes(width))
        await page.screenshot({
          path: `${evidenceDir}/new-exam-link-${width}.png`,
        });
    }
    assert.deepEqual(errors, []);
    return { passed: true, outcomes, studentURL: link };
  } catch (error) {
    if (evidenceDir) {
      await mkdir(evidenceDir, { recursive: true });
      await page
        .screenshot({
          path: `${evidenceDir}/document-failure.png`,
          fullPage: true,
        })
        .catch(() => {});
      await writeFile(
        `${evidenceDir}/document-failure.json`,
        JSON.stringify(
          {
            error: error.stack || error.message,
            pageErrors: errors,
            completed: outcomes,
            url: page.url(),
            pageText: (
              await page
                .locator("body")
                .innerText()
                .catch(() => "")
            ).slice(0, 30000),
          },
          null,
          2,
        ),
      ).catch(() => {});
    }
    throw error;
  } finally {
    await context.close();
  }
}

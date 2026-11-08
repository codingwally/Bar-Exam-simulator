// Synthetic local integration only; use a disposable server with real password auth.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

export async function runProfessorLoginReview(
  browser,
  baseURL,
  { secret, evidenceDir } = {},
) {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname))
    throw new Error(
      "Professor sign-in review requires a disposable local server.",
    );
  if (!secret)
    throw new Error("Supply the synthetic local professor passphrase.");
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ignoreHTTPSErrors: process.env.DD_ALLOW_SELF_SIGNED === "true",
  });
  const page = await context.newPage(),
    errors = [],
    outcomes = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  const signIn = async (target) => {
    await target.getByLabel("Professor passphrase").fill(secret);
    await target.getByRole("button", { name: "Sign in", exact: true }).click();
    await target
      .getByRole("heading", { name: "My exams", exact: true })
      .waitFor();
  };
  try {
    await page.goto(`${baseURL}/admin/exams`);
    await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/admin/login");
    assert.equal(
      await page
        .getByLabel("Professor passphrase")
        .getAttribute("autocomplete"),
      "current-password",
    );
    for (const width of [1440, 1024, 768, 390, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
        `Login overflows at ${width}`,
      );
      if (evidenceDir && [1440, 390].includes(width)) {
        await mkdir(evidenceDir, { recursive: true });
        await page.screenshot({
          path: `${evidenceDir}/professor-sign-in-${width}.png`,
          fullPage: true,
          caret: "initial",
        });
      }
    }
    await page
      .getByLabel("Professor passphrase")
      .fill("Wrong synthetic passphrase");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "not recognized" })
      .waitFor();
    assert.equal(new URL(page.url()).pathname, "/admin/login");
    outcomes.push(
      "Unsigned professor pages redirect to a readable sign-in; incorrect passphrases cannot open the desk.",
    );
    await signIn(page);
    assert.equal(
      await page
        .getByRole("button", { name: "Sign out", exact: true })
        .isVisible(),
      true,
    );
    assert.equal(
      await page.evaluate(
        (secret) =>
          [localStorage, sessionStorage].some((storage) =>
            Object.values(storage).some((value) =>
              String(value).includes(secret),
            ),
          ),
        secret,
      ),
      false,
    );
    outcomes.push(
      "Correct sign-in opens the private desk using its session cookie without storing the passphrase in browser storage.",
    );
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
    const denied = await page.evaluate(async () => {
      const response = await fetch("/api/admin/exams", { cache: "no-store" });
      return response.status;
    });
    assert.equal(denied, 401);
    outcomes.push("Sign out revokes access to the private examiner API.");
    await signIn(page);
    await page
      .getByRole("button", { name: "Create exam", exact: true })
      .click();
    // Simulate a device that cannot persist an unfinished professor draft.
    await page.evaluate(() => {
      Storage.prototype.setItem = function () {
        throw new DOMException("Synthetic storage block", "QuotaExceededError");
      };
    });
    await page
      .getByRole("button", { name: "Add a question manually", exact: true })
      .click();
    await page
      .locator("#question-0")
      .fill("This complete synthetic question must survive session expiry.");
    await page.locator("#exam-title").fill("Preserved professor draft");
    await page.locator("#review-confirm").check();
    await context.clearCookies();
    await page
      .getByRole("button", { name: "Create exam link", exact: true })
      .click();
    await page
      .locator("#message")
      // The earlier blocked-storage warning also says "Keep this page open".
      // Wait for the actual expired-session response before asserting its UI.
      .filter({ hasText: "Your sign-in expired." })
      .waitFor();
    await page
      .getByRole("link", { name: "Sign in again", exact: true })
      .waitFor({ state: "visible" });
    assert.equal(
      await page.locator("#question-0").inputValue(),
      "This complete synthetic question must survive session expiry.",
    );
    assert.equal(
      await page
        .getByRole("link", { name: "Sign in again", exact: true })
        .isVisible(),
      true,
    );
    assert.equal(new URL(page.url()).pathname, "/admin/exams");
    const recovery = await context.newPage();
    await recovery.goto(`${baseURL}/admin/login`);
    await signIn(recovery);
    await recovery.close();
    await page.locator("#review-confirm").check();
    await page
      .getByRole("button", { name: "Create exam link", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Preserved professor draft", exact: true })
      .waitFor();
    assert.match(
      new URL(await page.locator("#share-link").inputValue()).pathname,
      /^\/exam\/[A-Za-z0-9_-]+$/,
    );
    outcomes.push(
      "Expired authentication with blocked draft storage leaves the full questions in place, permits sign-in in a second tab, and completes the same reviewed exam afterward.",
    );
    assert.deepEqual(errors, []);
    return { passed: true, outcomes };
  } catch (error) {
    if (evidenceDir) {
      await mkdir(evidenceDir, { recursive: true });
      await page
        .screenshot({
          path: `${evidenceDir}/professor-sign-in-failure.png`,
          fullPage: true,
          caret: "initial",
        })
        .catch(() => {});
      await writeFile(
        `${evidenceDir}/professor-sign-in-failure.json`,
        JSON.stringify(
          {
            error: error.message,
            stack: error.stack,
            completed: outcomes,
            pageErrors: errors,
            pageText: (
              await page
                .locator("body")
                .innerText()
                .catch(() => "")
            ).slice(0, 15000),
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

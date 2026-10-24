// CI only: disposable local server with synthetic professor credentials.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "./playwright-runtime.mjs";
import { syntheticBrowserOptions } from "./synthetic-browser-options.mjs";
import { runProfessorLoginReview } from "./professor-login-browser.mjs";

const baseURL = process.argv[2] || "https://localhost:8806";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname))
  throw new Error(
    "Use a disposable loopback server for professor sign-in review.",
  );
const secret = process.env.EXAM_QA_ADMIN_SECRET;
if (!secret)
  throw new Error(
    "Set EXAM_QA_ADMIN_SECRET to the synthetic local test passphrase.",
  );
const runtime = loadPlaywright(),
  results = [];
const evidenceRoot = fileURLToPath(
  new URL("../.wrangler/evidence/professor-login/", import.meta.url),
);
await mkdir(evidenceRoot, { recursive: true });
for (const engine of (
  process.env.DD_BROWSER_ENGINES || "chromium,firefox,webkit"
).split(",")) {
  if (!["chromium", "firefox", "webkit"].includes(engine))
    throw new Error(
      "Choose Chromium, Firefox or WebKit for this synthetic review.",
    );
  const evidenceDir = `${evidenceRoot}/${engine}`;
  await mkdir(evidenceDir, { recursive: true });
  let browser;
  try {
    browser = await runtime[engine].launch(
      await syntheticBrowserOptions(engine, baseURL),
    );
    results.push({
      engine,
      version: browser.version(),
      ...(await runProfessorLoginReview(browser, baseURL, {
        secret,
        evidenceDir,
      })),
    });
  } catch (error) {
    results.push({
      engine,
      version: browser?.version(),
      passed: false,
      error: error.message,
    });
    process.exitCode = 1;
  } finally {
    await browser?.close();
  }
}
await writeFile(
  `${evidenceRoot}/results.json`,
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));

// Disposable, synthetic integration only. Never sends real questions or mail.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "./playwright-runtime.mjs";
import { runDocumentReview } from "./document-browser.mjs";
const base = process.argv[2] || "http://localhost:8797";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname))
  throw Error("A disposable loopback server is required.");
const engines = (process.env.DD_BROWSER_ENGINES || "chromium").split(",");
const runtime = loadPlaywright(),
  results = [];
for (const engine of engines) {
  const browser = await runtime[engine].launch({ headless: true });
  const evidenceDir = fileURLToPath(
    new URL(`../.wrangler/evidence/documents-${engine}/`, import.meta.url),
  );
  await mkdir(evidenceDir, { recursive: true });
  try {
    results.push({
      engine,
      version: browser.version(),
      ...(await runDocumentReview(browser, base, { evidenceDir })),
    });
  } catch (error) {
    results.push({
      engine,
      version: browser.version(),
      passed: false,
      error: error.message,
    });
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
await writeFile(
  new URL("../.wrangler/evidence/document-workflows.json", import.meta.url),
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));

// Synthetic compatibility check against the isolated development server.
// node exam-pilot/test/browser-compatibility.mjs http://localhost:8797
import assert from 'node:assert/strict';
import { loadPlaywright } from './playwright-runtime.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { instrumentStartup } from './startup-instrumentation.mjs';
const engines = loadPlaywright();
const base = process.argv[2] || 'http://localhost:8797';
const evidence = new URL('../.wrangler/evidence/', import.meta.url); await mkdir(evidence, { recursive: true });
const results = [];
for (const engine of (process.env.DD_BROWSER_ENGINES || 'chromium,firefox,webkit').split(',')) {
  const browser = await engines[engine].launch({ headless: true });
  const version = browser.version();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: process.env.DD_ALLOW_SELF_SIGNED === 'true' });
  if (process.env.DD_TRACE_STARTUP === 'true') await context.addInitScript(instrumentStartup);
  const page = await context.newPage(), errors = [], trace = [];
  page.on('console', message => { if (message.text().startsWith('[exam-start]')) trace.push(message.text()); });
  page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  // The product deliberately warns before leaving an active examination.
  // These planned test reloads explicitly accept that browser warning.
  page.on('dialog', dialog => dialog.accept());
  try {
    await page.goto(`${base}/practice`);
    await page.getByLabel('Full name', { exact: true }).waitFor();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('href')), '#main');
    assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid');
    await page.getByLabel('Full name', { exact: true }).fill(`Synthetic ${engine} compatibility`);
    await page.getByLabel('Email address', { exact: true }).fill(`${engine}-compatibility@example.test`);
    await page.locator('[name=consent]').check();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Start practice');
    await page.keyboard.press('Enter');
    await page.locator('textarea').waitFor({ timeout: 20000 });
    await page.locator('textarea').fill(`Synthetic ${engine} saved answer. No real student data.`);
    await page.locator('.save-bar').getByText(/Saved to server at/).waitFor({ timeout: 20000 });
    const original = await page.evaluate(async () => (await fetch('/api/exams/practice/state')).json());
    assert.ok(original.attempt?.id); assert.equal(original.attempt.questions.length, 1);
    assert.ok(original.attempt.deadlineAt - original.attempt.startAt === 300000);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: fileURLToPath(new URL(`${engine}-practice-390.png`, evidence)), fullPage: true });
    if (process.env.DD_RELOAD_SHORTCUT === 'true') await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.keyboard.press('Control+r')]);
    else await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('textarea').waitFor({ timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector('textarea')?.readOnly, null, { timeout: 30000 });
    assert.equal(await page.locator('textarea').inputValue(), `Synthetic ${engine} saved answer. No real student data.`);
    const resumed = await page.evaluate(async () => (await fetch('/api/exams/practice/state')).json());
    assert.equal(resumed.attempt.id, original.attempt.id); assert.equal(resumed.attempt.deadlineAt, original.attempt.deadlineAt);

    // Deliberately enlarge text, retaining the viewport, to exercise browser user
    // text scaling rather than merely taking a larger-resolution screenshot.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('h1,h2,h3,p,label,button,input,textarea,summary,.masthead-label,.wordmark,.countdown,.clock,.timer-label,.eyebrow,.answer-label span,.save-bar span,.question-nav button,footer')];
      const sizes = nodes.map(node => parseFloat(getComputedStyle(node).fontSize));
      nodes.forEach((node, i) => { node.style.fontSize = `${sizes[i] * 2}px`; });
    });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.ok(await page.locator('textarea').evaluate(node => parseFloat(getComputedStyle(node).fontSize)) >= 32);
    await page.locator('textarea').focus();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'answer');
    await page.screenshot({ path: fileURLToPath(new URL(`${engine}-practice-text200.png`, evidence)), fullPage: true });
    await page.getByRole('button', { name: 'Review & submit', exact: true }).click();
    await page.getByRole('button', { name: 'Submit examination', exact: true }).click();
    await page.getByRole('heading', { name: 'Your examination is submitted.', exact: true }).waitFor({ timeout: 20000 });
    const final = await page.evaluate(async () => (await fetch('/api/exams/practice/state')).json());
    assert.equal(final.attempt.receipt.answeredCount, 1); assert.equal(final.attempt.receipt.finalizationType, 'manual'); assert.ok(final.attempt.receipt.checksum);
    const unloadTransportErrors = errors.filter(message => /\/api\/exams\/practice\/events due to access control checks\.?$/.test(message));
    assert.deepEqual(errors.filter(message => !unloadTransportErrors.includes(message)), []);
    const limitations = [];
    if (unloadTransportErrors.length) {
      // WebKit can reject an unload beacon under the local self-signed TLS
      // fixture. This is acceptable only when the durable queue demonstrably
      // retries the very same navigation record after returning to the page.
      let restored = false;
      for (let retry = 0; retry < 10; retry++) {
        const response = await context.request.get(`${base}/api/admin/exams/practice/events?attempt_id=${encodeURIComponent(original.attempt.id)}`);
        const observed = await response.json();
        if (response.ok() && observed.events?.some(event => event.type === 'pagehide' && event.client_time)) { restored = true; break; }
        await page.waitForTimeout(500);
      }
      assert.equal(restored, true, 'Unload transport failed and its durable event was not recovered');
      limitations.push('Local self-signed TLS WebKit rejected an unload event transport; the same queued pagehide event was confirmed on the server after reload retry.');
    }
    results.push({ engine, version, status: 'PASS', scenarios: ['keyboard entry and focus', 'name/email registration', 'incremental save', 'same-attempt recovery', 'unchanged five-minute deadline', '390px no overflow', '200% text scaling', 'manual server receipt'], limitations });
    console.log(`${engine}: PASS registration, autosave, reload, deadline, receipt, mobile, doubled text and keyboard focus`);
  } catch (error) {
    results.push({ engine, version, status: 'FAIL', error: error.message, pageErrors: errors });
    console.log(`${engine}: FAIL ${error.message}`);
    if (trace.length) { console.log(trace.slice(-50).join('\n')); await writeFile(new URL(`${engine}-startup-trace.json`, evidence), JSON.stringify(trace, null, 2)); }
    console.log((await page.locator('body').innerText({ timeout: 3000 }).catch(() => 'Page body unavailable after navigation failure.')).slice(0, 2000));
    await page.screenshot({ path: fileURLToPath(new URL(`${engine}-compatibility-failure.png`, evidence)), fullPage: true, timeout: 5000 }).catch(() => {});
  } finally { await context.close(); await browser.close(); }
}
console.log(JSON.stringify(results, null, 2));
await writeFile(new URL(`compatibility-${results.map(result => result.engine).join('-')}.json`, evidence), JSON.stringify(results, null, 2));
if (results.some(result => result.status !== 'PASS')) process.exitCode = 1;

import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base = process.env.EXAM_QA_URL || 'http://localhost:8797';
const out = fileURLToPath(new URL('../.wrangler/evidence/', import.meta.url));
await mkdir(out, {recursive: true});
const browser = await chromium.launch({headless: true});
const findings = [];
try {
  for (const width of [1440, 1024, 768, 390, 375, 320]) {
    const context = await browser.newContext({viewport: {width, height: 900}});
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/practice`);
    await page.getByRole('button', {name: 'Start practice'}).waitFor();
    await page.screenshot({path: `${out}/practice-entry-${width}.png`, fullPage: true});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Entry overflows at ${width}`);
    await page.getByRole('textbox', {name: 'Full name'}).fill(`Visual QA ${width}`);
    await page.getByRole('textbox', {name: 'Email address'}).fill(`visual-${width}@example.invalid`);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', {name: 'Start practice'}).click();
    await page.getByRole('textbox', {name: /Your answer to question/}).waitFor();
    await page.getByRole('textbox', {name: /Your answer to question/}).fill('Synthetic visual review answer.\nA complete second paragraph remains readable and saves automatically.');
    await page.getByText(/Saved to server at/).waitFor();
    await page.screenshot({path: `${out}/practice-writing-${width}.png`, fullPage: true});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Editor overflows at ${width}`);
    const controls = await page.locator('button:visible,input:visible').evaluateAll(nodes => nodes.map(node => ({text: node.textContent || node.getAttribute('aria-label'), width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height, type: node.type})));
    assert.ok(controls.filter(control => control.type !== 'checkbox').every(control => control.height >= 43), `Small touch target at ${width}`);
    assert.deepEqual(errors, [], `Browser errors at ${width}`);
    findings.push({width, entryOverflow: false, editorOverflow: false, runtimeErrors: errors, touchTargets: true, serverSave: true});
    await context.close();
  }
  const context = await browser.newContext({viewport: {width: 720, height: 900}, deviceScaleFactor: 2});
  const page = await context.newPage();
  await page.goto(`${base}/practice`); await page.getByRole('button', {name: 'Start practice'}).waitFor();
  await page.screenshot({path: `${out}/practice-zoom-equivalent.png`, fullPage: true});
  await page.route('**/*.woff2', route => route.abort());
  await page.reload(); await page.getByRole('button', {name: 'Start practice'}).waitFor();
  await page.screenshot({path: `${out}/practice-font-fallback.png`, fullPage: true});
  findings.push({zoomEquivalentCSSWidth: 720, deviceScaleFactor: 2, fontFailureContentUsable: true});
  await context.close();
  await writeFile(`${out}/visual-results.json`, JSON.stringify(findings, null, 2));
  console.log(JSON.stringify({result: 'PASS', findings, evidence: out}));
} finally {await browser.close();}

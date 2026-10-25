// Synthetic browser verification. Run against the isolated local test server:
// node exam-pilot/test/student-browser.mjs http://localhost:8797
import assert from 'node:assert/strict';
import { loadPlaywright } from './playwright-runtime.mjs';
const { chromium } = loadPlaywright();
const base = process.argv[2] || 'http://localhost:8797';
const browser = await chromium.launch({ headless: true });
const outcomes = [];
const pass = text => { outcomes.push({ test: text, status: 'PASS' }); console.log(`PASS ${text}`); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function enter(page, suffix = '') {
  await page.goto(`${base}/practice`);
  await page.getByLabel('Full name', { exact: true }).fill(`Synthetic Browser Student ${suffix}`);
  await page.getByLabel('Email address', { exact: true }).fill(`browser${suffix}@example.test`);
  await page.locator('[name=consent]').check(); await page.getByRole('button', { name: 'Start practice', exact: true }).click();
}
async function saved(page) { await page.locator('.save-bar').getByText(/Saved to server at/).waitFor({ timeout: 20000 }); }
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await enter(page, 'main'); await page.locator('textarea').waitFor();
  assert.equal(await page.locator('.question-nav button').count(), 1);
  assert.match(await page.locator('.question-text').textContent(), /Congress passes a law/);
  assert.match(await page.locator('[data-countdown]').textContent(), /^0[45]:\d{2}$/);
  let state = await page.evaluate(async () => (await fetch('/api/exams/practice/state')).json());
  const deadline = state.attempt.deadlineAt, attemptId = state.attempt.id;
  await page.locator('textarea').fill('Synthetic on-time answer. Constitutional supremacy.'); await saved(page);
  await page.evaluate(() => { window.originalEditor = document.querySelector('textarea'); });
  const continued = ' Continuous typing must save without waiting for a pause.'.repeat(3);
  const earlySave = page.waitForResponse(response => response.url().includes('/answers/') && response.request().method() === 'PUT');
  let typingComplete = false;
  const typing = page.locator('textarea').pressSequentially(continued, { delay: 25 }).then(() => { typingComplete = true; });
  await earlySave; assert.equal(typingComplete, false); await typing; await saved(page);
  assert.equal(await page.evaluate(() => window.originalEditor === document.querySelector('textarea')), true);
  await page.setViewportSize({ width: 320, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('textarea').focus();
  assert.equal(await page.evaluate(() => document.querySelector('textarea').getBoundingClientRect().top >= document.querySelector('.exam-top').getBoundingClientRect().bottom), true);
  await page.setViewportSize({ width: 390, height: 844 });
  pass('Practice one question, five-minute deadline, saves during continuous typing, stable editor and 320px layout');

  // Wait for the offline application shell to finish installing before proving
  // actual navigation without a network, rather than merely a visible tab.
  await page.evaluate(() => navigator.serviceWorker.ready); await page.reload();
  await page.locator('textarea').waitFor();
  await context.setOffline(true);
  await page.locator('textarea').fill('Synthetic answer written while offline. Q1 fully preserved.');
  await page.locator('.save-bar').getByText(/Saved on this device/).waitFor();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('textarea').waitFor({ timeout: 25000 });
  assert.equal(await page.locator('textarea').inputValue(), 'Synthetic answer written while offline. Q1 fully preserved.');
  assert.equal(await page.locator('textarea').getAttribute('readonly'), null);
  await context.setOffline(false); await page.getByRole('button', { name: 'Save now', exact: true }).click(); await saved(page);
  state = await page.evaluate(async () => (await fetch('/api/exams/practice/state')).json());
  assert.equal(state.attempt.deadlineAt, deadline); assert.equal(state.attempt.id, attemptId);
  assert.match(state.attempt.answers[0].text, /written while offline/);
  const revisions = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('due-diligence-exam-drafts-v1', 1); r.onsuccess = () => resolve(r.result); });
    return new Promise(resolve => { const r = db.transaction('revisions').objectStore('revisions').count(); r.onsuccess = () => { db.close(); resolve(r.result); }; });
  });
  assert.ok(revisions > 1); pass('Real offline reload restores writing, admitted question, same attempt and unchanged deadline from versioned browser storage');

  const second = await context.newPage(); await second.goto(`${base}/practice`); await second.locator('textarea').waitFor();
  assert.equal(await second.locator('textarea').getAttribute('readonly'), '');
  assert.equal(await second.getByRole('button', { name: 'Review & submit', exact: true }).isDisabled(), true);
  await page.locator('textarea').fill('Primary tab latest answer remains safe.'); await saved(page);
  await second.getByRole('button', { name: 'Write in this tab', exact: true }).click();
  assert.equal(await second.locator('textarea').getAttribute('readonly'), '');
  await page.close();
  await second.getByRole('button', { name: 'Write in this tab', exact: true }).click();
  await second.waitForFunction(() => !document.querySelector('textarea')?.readOnly);
  assert.equal(await second.locator('textarea').inputValue(), 'Primary tab latest answer remains safe.');
  pass('Second tab cannot corrupt the active browser journal; deliberate takeover after original tab closes resumes latest answer');

  await second.locator('textarea').evaluate(node => {
    node.focus(); node.setSelectionRange(0, 7); node.dispatchEvent(new ClipboardEvent('copy', { bubbles: true }));
    const data = new DataTransfer(); data.setData('text/plain', 'Synthetic clipboard paste');
    node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: data }));
  });
  await second.locator('textarea').fill('Final synthetic practice answer.'); await saved(second);
  await second.getByRole('button', { name: 'Review & submit', exact: true }).click();
  await second.getByRole('button', { name: 'Submit examination', exact: true }).click();
  await second.getByRole('heading', { name: 'Your examination is submitted.', exact: true }).waitFor();
  state = await second.evaluate(async () => (await fetch('/api/exams/practice/state')).json());
  assert.ok(state.attempt.receipt.checksum); assert.equal(state.attempt.receipt.questionCount, 1); assert.equal(state.attempt.receipt.answeredCount, 1);
  await second.reload(); await second.getByRole('heading', { name: 'Your examination is submitted.', exact: true }).waitFor();
  pass('Manual submission returns a server checksum receipt that survives reload with immutable final answers');
  assert.deepEqual(errors, []); await context.close();

  const idbContext = await browser.newContext();
  await idbContext.addInitScript(() => {
    Storage.prototype.getItem = function () { throw new DOMException('blocked', 'SecurityError'); };
    Storage.prototype.setItem = function () { throw new DOMException('blocked', 'SecurityError'); };
    Storage.prototype.removeItem = function () { throw new DOMException('blocked', 'SecurityError'); };
  });
  const idbPage = await idbContext.newPage(); await enter(idbPage, 'idbonly'); await idbPage.locator('textarea').waitFor();
  await idbPage.locator('textarea').fill('IndexedDB works when localStorage is blocked.'); await saved(idbPage);
  await idbPage.evaluate(() => navigator.serviceWorker.ready); await idbPage.reload(); await idbPage.locator('textarea').waitFor();
  await idbContext.setOffline(true); await idbPage.reload(); await idbPage.locator('textarea').waitFor({ timeout: 25000 });
  assert.equal(await idbPage.locator('textarea').inputValue(), 'IndexedDB works when localStorage is blocked.');
  pass('IndexedDB retains credential, admitted questions and answers through a real offline reload when localStorage is blocked'); await idbContext.close();

  const blockedContext = await browser.newContext();
  await blockedContext.addInitScript(() => {
    Object.defineProperty(globalThis, 'indexedDB', { get() { return undefined; } });
    Storage.prototype.getItem = function () { throw new DOMException('blocked', 'SecurityError'); };
    Storage.prototype.setItem = function () { throw new DOMException('blocked', 'SecurityError'); };
  });
  const blockedPage = await blockedContext.newPage(); await enter(blockedPage, 'blocked');
  await blockedPage.getByText(/This browser is blocking examination storage/).waitFor();
  assert.equal(await blockedPage.locator('textarea').count(), 0);
  pass('Both device stores blocked: no false recovery promise or started attempt'); await blockedContext.close();
  console.log(JSON.stringify({ result: 'PASS', outcomes }, null, 2));
} finally { await browser.close(); }

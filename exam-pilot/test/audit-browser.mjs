// Actual browser-generated events with synthetic clipboard contents only.
import assert from 'node:assert/strict';
import { loadPlaywright } from './playwright-runtime.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = loadPlaywright();
const base = process.argv[2] || 'http://localhost:8797';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage(); page.on('dialog', dialog => dialog.accept());
try {
  await page.goto(`${base}/practice`); await page.getByLabel('Full name', { exact: true }).fill('Synthetic Audit Student');
  await page.getByLabel('Email address', { exact: true }).fill('audit-proof@example.test');
  await page.locator('[name=consent]').check(); await page.getByRole('button', { name: 'Start practice', exact: true }).click();
  const answer = page.locator('textarea'); await answer.waitFor();
  const selected = 'Synthetic selected words';
  await answer.fill(`${selected} remain preserved.`);
  await answer.evaluate((node, text) => { node.focus(); node.setSelectionRange(0, text.length); }, selected);
  await page.keyboard.press('Control+c');
  await answer.evaluate((node, text) => node.setSelectionRange(0, text.length), selected);
  await page.keyboard.press('Control+x');
  const pasted = 'Synthetic exact pasted words — no real student text.';
  await page.evaluate(text => navigator.clipboard.writeText(text), pasted); await page.keyboard.press('Control+v');
  const second = await context.newPage(); await second.goto('about:blank'); await second.bringToFront();
  const actualHidden = await page.evaluate(() => document.visibilityState === 'hidden');
  await page.bringToFront(); await second.close();
  await context.setOffline(true); await answer.fill('Synthetic offline activity preserved.');
  await page.locator('.save-bar').getByText(/Saved on this device/).waitFor();
  await context.setOffline(false); await page.getByRole('button', { name: 'Save now', exact: true }).click();
  await page.locator('.save-bar').getByText(/Saved to server at/).waitFor();
  const state = await page.evaluate(async () => (await fetch('/api/exams/practice/state')).json());
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('textarea').waitFor();
  await page.getByRole('button', { name: 'Save now', exact: true }).click();
  await page.getByRole('button', { name: 'Review & submit', exact: true }).click();
  await page.getByRole('button', { name: 'Submit examination', exact: true }).click();
  await page.getByRole('heading', { name: 'Your examination is submitted.', exact: true }).waitFor();
  let events = [];
  for (let count = 0; count < 20; count++) {
    const response = await context.request.get(`${base}/api/admin/exams/practice/events?attempt_id=${encodeURIComponent(state.attempt.id)}`);
    assert.equal(response.ok(), true); events = (await response.json()).events;
    if (['copy', 'cut', 'paste', 'offline', 'online', 'reconnect', 'manual_submission', 'pagehide'].every(type => events.some(event => event.type === type && event.client_time))) break;
    await page.waitForTimeout(500);
  }
  const find = type => events.find(event => event.type === type && event.client_time);
  assert.equal(find('copy')?.details.selectedText, selected); assert.equal(find('cut')?.details.selectedText, selected); assert.equal(find('paste')?.details.pastedText, pasted);
  for (const type of ['copy', 'cut', 'paste', 'offline', 'online', 'reconnect', 'navigation_attempt', 'beforeunload', 'pagehide', 'manual_submission', 'session_resume', 'question_viewed', 'save_success']) {
    const event = find(type); assert.ok(event, `Missing event ${type}`); assert.ok(Number.isFinite(event.received_at), `${type} server time missing`); assert.ok(Number.isFinite(Date.parse(event.client_time)), `${type} client time missing`); assert.match(event.provenance, /untrusted/);
  }
  const evidence = { result: 'PASS', attemptId: state.attempt.id, exactCopy: selected, exactPaste: pasted, observedEventTypes: [...new Set(events.map(event => event.type))], actualTabHidden: actualHidden, limitations: actualHidden ? ['Practice has one question; question-change observation is verified separately.'] : ['Headless Chromium reported the original tab visible during bringToFront; native tab visibility transitions require an interactive browser check.', 'Practice has one question; question-change observation is verified separately.'], events };
  const directory = new URL('../.wrangler/evidence/', import.meta.url); await mkdir(directory, { recursive: true }); await writeFile(new URL('audit-browser.json', directory), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ result: evidence.result, observedEventTypes: evidence.observedEventTypes, actualTabHidden: actualHidden, limitations: evidence.limitations }, null, 2));
} finally { await context.close(); await browser.close(); }

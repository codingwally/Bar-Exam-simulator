import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FORECAST_SHEET_ID,
  FORECAST_SHEET_TITLE,
  HEADERS,
  buildForecastSheetBatch,
} from './build-bar-forecast-google-sheet.mjs';

test('Forecast consolidation tab is a fixed 120 by 21 admin-review data source', async () => {
  const batch = await buildForecastSheetBatch();
  assert.equal(FORECAST_SHEET_TITLE, '2026 Bar Forecast');
  assert.equal(FORECAST_SHEET_ID, 20260831);
  assert.equal(HEADERS.length, 21);
  assert.deepEqual(HEADERS.slice(0, 9), [
    'Question ID', 'Subject', 'Topic', 'Bar Year', 'Question No.',
    'Essay Question', 'Suggested Answer', 'Legal Basis / Provision', 'Controlling Doctrine',
  ]);

  const writes = batch.requests.filter((request) => request.updateCells?.range?.startRowIndex >= 1);
  assert.equal(writes.reduce((total, request) => total + request.updateCells.rows.length, 0), 120);
  assert.ok(writes.every((request) => request.updateCells.range.endColumnIndex === 21));
  const rows = writes.flatMap((request) => request.updateCells.rows)
    .map((row) => row.values.map((cell) => cell.userEnteredValue.stringValue
      ?? cell.userEnteredValue.numberValue));
  assert.equal(new Set(rows.map((row) => row[0])).size, 120);
  assert.ok(rows.every((row) => /^FCT-2026-Q\d{3}$/u.test(row[0])));
  assert.ok(rows.every((row) => row[13] === 'Approved'));
  assert.ok(rows.every((row) => row[17] === 'Yes'));
  const legalAuthorityCells = rows.map((row) => String(row[7]));
  assert.equal(legalAuthorityCells.filter((value) => (
    value.includes('Supreme Court E-Library authority: https://elibrary.judiciary.gov.ph/')
  )).length, 119);
  assert.equal(legalAuthorityCells.filter((value) => (
    value.includes('Official treaty authority: https://www.un.org/depts/los/convention_agreements/texts/unclos/part12.htm')
  )).length, 1);
  assert.ok(rows.every((row) => String(row[18]).includes('Approved for verification; not yet verified.')));
  assert.ok(batch.requests.some((request) => request.setDataValidation?.range?.startColumnIndex === 13));
  assert.ok(batch.requests.some((request) => request.setDataValidation?.range?.startColumnIndex === 17));
  assert.equal(batch.response_ranges[0], "'2026 Bar Forecast'!A1:U121");
});

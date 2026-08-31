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
  assert.ok(batch.requests.some((request) => request.setDataValidation?.range?.startColumnIndex === 13));
  assert.ok(batch.requests.some((request) => request.setDataValidation?.range?.startColumnIndex === 17));
  assert.equal(batch.response_ranges[0], "'2026 Bar Forecast'!A1:U121");
});

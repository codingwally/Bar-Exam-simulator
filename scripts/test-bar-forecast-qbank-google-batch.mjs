import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { HEADERS, SPREADSHEET_ID } from './import-website-upload.mjs';
import {
  CONTENT_COLUMN_COUNT,
  FORMULA_COLUMNS,
  SHEET_LAYOUTS,
  buildQuestionBankSyncBatch,
  validateBatchRequests,
  validateLiveSnapshot,
} from './build-bar-forecast-qbank-google-batch.mjs';

const forecastSource = JSON.parse(await readFile(
  new URL('../content/duediligence-2026/bar-forecast.json', import.meta.url),
  'utf8',
));
const websitePayload = JSON.parse(await readFile(
  new URL('../content/question-bank/website-upload.json', import.meta.url),
  'utf8',
));
const baseIds = websitePayload.records
  .map((row) => String(row['Question ID']))
  .filter((id) => !id.startsWith('FCT-2026-Q'));
const forecastIds = forecastSource.rows.map((row) => row.question_bank_id);

function idRows(ids, startRow) {
  return ids.map((id, index) => ({ id, row: startRow + index }));
}

function snapshotFixture({ forecastKeyMode = 'question_bank_id' } = {}) {
  const qnaIds = [...baseIds, ...Array.from({ length: 39 }, (_, index) => `QNA-LIVE-EXTRA-${index + 1}`)];
  const reversedForecastIds = forecastSource.rows
    .map((row) => row[forecastKeyMode])
    .reverse();
  return {
    spreadsheetId: SPREADSHEET_ID,
    sheets: {
      'Q&A Bank': {
        title: 'Q&A Bank',
        sheetId: SHEET_LAYOUTS['Q&A Bank'].sheetId,
        rowCount: 1027,
        columnCount: SHEET_LAYOUTS['Q&A Bank'].columnCount,
        headerRow: 4,
        dataStartRow: 5,
        dataEndRow: 843,
        headers: [...HEADERS],
        formulaColumns: [...FORMULA_COLUMNS],
        idRows: idRows(qnaIds, 5),
      },
      'Website Upload': {
        title: 'Website Upload',
        sheetId: SHEET_LAYOUTS['Website Upload'].sheetId,
        rowCount: 801,
        columnCount: 21,
        headerRow: 1,
        dataStartRow: 2,
        dataEndRow: 801,
        headers: [...HEADERS],
        formulaColumns: [...FORMULA_COLUMNS],
        idRows: idRows(baseIds, 2),
      },
      '2026 Bar Forecast': {
        title: '2026 Bar Forecast',
        sheetId: SHEET_LAYOUTS['2026 Bar Forecast'].sheetId,
        rowCount: 1000,
        columnCount: 21,
        headerRow: 1,
        dataStartRow: 2,
        dataEndRow: 121,
        headers: [...HEADERS],
        formulaColumns: [...FORMULA_COLUMNS],
        idRows: idRows(reversedForecastIds, 2),
      },
    },
  };
}

function requestsOf(result, type) {
  return result.batch.requests.filter((request) => request[type]);
}

function writtenRows(requests, sheetId) {
  return requests
    .filter((request) => request.updateCells.range.sheetId === sheetId)
    .flatMap((request) => request.updateCells.rows)
    .map((row) => row.values.map((cell) => (
      cell.userEnteredValue.stringValue ?? cell.userEnteredValue.numberValue
    )));
}

function stateRowCount(requests, sheetId) {
  return requests
    .filter((request) => request.repeatCell.range.sheetId === sheetId)
    .reduce((total, request) => (
      total + request.repeatCell.range.endRowIndex - request.repeatCell.range.startRowIndex
    ), 0);
}

test('builds one dry-run atomic batch for exactly the three approved sheets', async () => {
  const result = await buildQuestionBankSyncBatch(snapshotFixture(), { forecastSource });
  assert.equal(result.batch.spreadsheet_id, SPREADSHEET_ID);
  assert.equal(result.audit.dryRun, true);
  assert.deepEqual(result.audit.targetSheets, ['Q&A Bank', 'Website Upload', '2026 Bar Forecast']);
  assert.deepEqual(result.audit.excludedSheets, ['Website Visibility', 'Bar Simulation Pool']);
  assert.match(result.auditMarkdown, /no external write was executed/u);
  assert.match(result.auditMarkdown, /preserve T:U/u);
  assert.equal(validateBatchRequests(result.batch.requests), true);

  const allowedSheetIds = new Set(Object.values(SHEET_LAYOUTS).map((layout) => layout.sheetId));
  for (const request of result.batch.requests) {
    const body = Object.values(request)[0];
    for (const sheetId of [body?.sheetId, body?.range?.sheetId, body?.source?.sheetId, body?.destination?.sheetId]) {
      if (Number.isInteger(sheetId)) assert.ok(allowedSheetIds.has(sheetId));
    }
  }
});

test('appends Website Upload capacity once and writes 120 new rows to A:S in both banks', async () => {
  const result = await buildQuestionBankSyncBatch(snapshotFixture(), { forecastSource });
  const appends = requestsOf(result, 'appendDimension');
  assert.deepEqual(appends, [{
    appendDimension: {
      sheetId: SHEET_LAYOUTS['Website Upload'].sheetId,
      dimension: 'ROWS',
      length: 120,
    },
  }]);

  const updates = requestsOf(result, 'updateCells');
  for (const [title, startRow, endRow] of [
    ['Q&A Bank', 844, 963],
    ['Website Upload', 802, 921],
  ]) {
    const sheetId = SHEET_LAYOUTS[title].sheetId;
    const writes = updates.filter((request) => request.updateCells.range.sheetId === sheetId);
    assert.equal(writes.length, 6);
    assert.equal(writes[0].updateCells.range.startRowIndex, startRow - 1);
    assert.equal(writes.at(-1).updateCells.range.endRowIndex, endRow);
    assert.equal(writes.reduce((count, request) => count + request.updateCells.rows.length, 0), 120);
    assert.ok(writes.every((request) => request.updateCells.range.endColumnIndex === CONTENT_COLUMN_COUNT));
    assert.ok(writes.every((request) => request.updateCells.rows.every((row) => row.values.length === 19)));
    const rows = writtenRows(writes, sheetId);
    assert.deepEqual(new Set(rows.map((row) => row[0])), new Set(forecastIds));
    assert.ok(rows.every((row) => row[17] === 'Yes'));
  }
});

test('copies only format, validation, and T:U formulas from the approved exemplars', async () => {
  const result = await buildQuestionBankSyncBatch(snapshotFixture(), { forecastSource });
  const copies = requestsOf(result, 'copyPaste');
  assert.equal(copies.length, 6);
  for (const [title, exemplarRow, newStartRow, newEndRow] of [
    ['Q&A Bank', 843, 844, 963],
    ['Website Upload', 801, 802, 921],
  ]) {
    const sheetId = SHEET_LAYOUTS[title].sheetId;
    const sheetCopies = copies.filter((request) => request.copyPaste.source.sheetId === sheetId);
    assert.deepEqual(sheetCopies.map((request) => request.copyPaste.pasteType), [
      'PASTE_FORMAT', 'PASTE_DATA_VALIDATION', 'PASTE_FORMULA',
    ]);
    assert.ok(sheetCopies.every((request) => request.copyPaste.source.startRowIndex === exemplarRow - 1));
    assert.ok(sheetCopies.every((request) => request.copyPaste.destination.startRowIndex === newStartRow - 1));
    assert.ok(sheetCopies.every((request) => request.copyPaste.destination.endRowIndex === newEndRow));
    const formulaCopy = sheetCopies.at(-1).copyPaste;
    assert.equal(formulaCopy.source.startColumnIndex, 19);
    assert.equal(formulaCopy.source.endColumnIndex, 21);
    assert.equal(formulaCopy.destination.startColumnIndex, 19);
    assert.equal(formulaCopy.destination.endColumnIndex, 21);
  }
});

test('marks exactly the 110 mapped live superseded records No in each bank', async () => {
  const result = await buildQuestionBankSyncBatch(snapshotFixture(), { forecastSource });
  const states = requestsOf(result, 'repeatCell');
  assert.equal(stateRowCount(states, SHEET_LAYOUTS['Q&A Bank'].sheetId), 110);
  assert.equal(stateRowCount(states, SHEET_LAYOUTS['Website Upload'].sheetId), 110);
  assert.ok(states.every((request) => request.repeatCell.range.startColumnIndex === 17));
  assert.ok(states.every((request) => request.repeatCell.range.endColumnIndex === 18));
  assert.ok(states.every((request) => request.repeatCell.cell.userEnteredValue.stringValue === 'No'));
});

test('updates Forecast A:S in exact live ID-row order and never overwrites T:U', async () => {
  const fixture = snapshotFixture();
  const liveFirstId = fixture.sheets['2026 Bar Forecast'].idRows[0].id;
  const result = await buildQuestionBankSyncBatch(fixture, { forecastSource });
  const writes = requestsOf(result, 'updateCells')
    .filter((request) => request.updateCells.range.sheetId === SHEET_LAYOUTS['2026 Bar Forecast'].sheetId);
  assert.equal(writes.length, 6);
  assert.equal(writes[0].updateCells.range.startRowIndex, 1);
  assert.equal(writes.at(-1).updateCells.range.endRowIndex, 121);
  assert.ok(writes.every((request) => request.updateCells.range.endColumnIndex === 19));
  const rows = writtenRows(writes, SHEET_LAYOUTS['2026 Bar Forecast'].sheetId);
  assert.equal(rows[0][0], liveFirstId);
  assert.deepEqual(rows.map((row) => row[0]), fixture.sheets['2026 Bar Forecast'].idRows.map((entry) => entry.id));
});

test('accepts an exact editorial_ref-keyed Forecast tab, maps rows to FCT IDs, and rejects drift', async () => {
  const fixture = snapshotFixture({ forecastKeyMode: 'editorial_ref' });
  const validation = validateLiveSnapshot(fixture, forecastSource);
  assert.equal(validation.forecastLiveKeyMode, 'editorial_ref');

  const idByEditorialRef = new Map(forecastSource.rows.map((row) => [row.editorial_ref, row.question_bank_id]));
  const expectedIds = fixture.sheets['2026 Bar Forecast'].idRows.map(({ id }) => idByEditorialRef.get(id));
  const result = await buildQuestionBankSyncBatch(fixture, { forecastSource });
  assert.equal(result.audit.forecastLiveKeyMode, 'editorial_ref');
  const writes = requestsOf(result, 'updateCells')
    .filter((request) => request.updateCells.range.sheetId === SHEET_LAYOUTS['2026 Bar Forecast'].sheetId);
  const rows = writtenRows(writes, SHEET_LAYOUTS['2026 Bar Forecast'].sheetId);
  assert.deepEqual(rows.map((row) => row[0]), expectedIds);

  const drifted = snapshotFixture({ forecastKeyMode: 'editorial_ref' });
  drifted.sheets['2026 Bar Forecast'].idRows[0].id = 'POL-DRIFT';
  assert.throws(
    () => validateLiveSnapshot(drifted, forecastSource),
    /must exactly match either all 120 generated question_bank_id values or all 120 generated editorial_ref values/u,
  );
});

test('rejects stale headers, grids, formula ownership, incomplete ID maps, and duplicate append sets', () => {
  const badHeader = snapshotFixture();
  badHeader.sheets['Q&A Bank'].headers[0] = 'ID';
  assert.throws(() => validateLiveSnapshot(badHeader, forecastSource), /headers do not match/u);

  const badGrid = snapshotFixture();
  badGrid.sheets['Website Upload'].rowCount = 921;
  assert.throws(() => validateLiveSnapshot(badGrid, forecastSource), /row count drifted/u);

  const badFormulaOwnership = snapshotFixture();
  badFormulaOwnership.sheets['2026 Bar Forecast'].formulaColumns = ['T'];
  assert.throws(() => validateLiveSnapshot(badFormulaOwnership, forecastSource), /T:U as formula-owned/u);

  const missingSuperseded = snapshotFixture();
  const supersededId = forecastSource.rows.flatMap((row) => row.supersedes_question_ids)[0];
  const supersededEntry = missingSuperseded.sheets['Website Upload'].idRows.find((entry) => entry.id === supersededId);
  supersededEntry.id = 'UNRELATED-LIVE-ID';
  assert.throws(() => validateLiveSnapshot(missingSuperseded, forecastSource), /missing superseded ID/u);

  const duplicateForecast = snapshotFixture();
  duplicateForecast.sheets['Q&A Bank'].idRows.at(-1).id = forecastIds[0];
  assert.throws(() => validateLiveSnapshot(duplicateForecast, forecastSource), /already contains/u);
});

test('preflight rejects unsafe request shapes and formula-column writes', () => {
  assert.throws(() => validateBatchRequests([{
    updateCells: {
      range: {
        sheetId: SHEET_LAYOUTS['Website Upload'].sheetId,
        startRowIndex: 801,
        endRowIndex: 802,
        startColumnIndex: 0,
        endColumnIndex: 21,
      },
      rows: [{ values: Array.from({ length: 21 }, () => ({ userEnteredValue: { stringValue: '' } })) }],
      fields: 'userEnteredValue',
    },
  }]), /overwrite formula-owned T:U/u);

  assert.throws(() => validateBatchRequests([{ appendDimension: {}, repeatCell: {} }]), /exactly one request type/u);

  const overlapping = [0, 10].map((offset) => ({
    updateCells: {
      range: {
        sheetId: SHEET_LAYOUTS['Q&A Bank'].sheetId,
        startRowIndex: 843 + offset,
        endRowIndex: 863 + offset,
        startColumnIndex: 0,
        endColumnIndex: 19,
      },
      rows: Array.from({ length: 20 }, () => ({
        values: Array.from({ length: 19 }, () => ({ userEnteredValue: { stringValue: '' } })),
      })),
      fields: 'userEnteredValue',
    },
  }));
  assert.throws(() => validateBatchRequests(overlapping), /updateCells requests .* overlap/u);
});

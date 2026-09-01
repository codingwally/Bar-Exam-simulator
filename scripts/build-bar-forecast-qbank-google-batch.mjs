import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  HEADERS,
  SPREADSHEET_ID,
} from './import-website-upload.mjs';
import { forecastRows } from './build-bar-forecast-google-sheet.mjs';
import { projectForecastQuestion } from './project-bar-forecast-to-question-bank.mjs';

export const SHEET_LAYOUTS = Object.freeze({
  'Q&A Bank': Object.freeze({
    sheetId: 1486762536,
    rowCount: 1027,
    columnCount: 26,
    headerRow: 4,
    dataStartRow: 5,
    dataEndRow: 843,
    newStartRow: 844,
    newEndRow: 963,
    exemplarRow: 843,
    existingRecordCount: 839,
    appendRows: 0,
  }),
  'Website Upload': Object.freeze({
    sheetId: 141335489,
    rowCount: 801,
    columnCount: 21,
    headerRow: 1,
    dataStartRow: 2,
    dataEndRow: 801,
    newStartRow: 802,
    newEndRow: 921,
    exemplarRow: 801,
    existingRecordCount: 800,
    appendRows: 120,
  }),
  '2026 Bar Forecast': Object.freeze({
    sheetId: 20260831,
    minimumRowCount: 121,
    columnCount: 21,
    headerRow: 1,
    dataStartRow: 2,
    dataEndRow: 121,
    existingRecordCount: 120,
    appendRows: 0,
  }),
});

export const CONTENT_COLUMN_COUNT = 19; // A:S. T:U are formula-owned.
export const PUBLICATION_READY_COLUMN_INDEX = 17; // R.
export const FORMULA_COLUMNS = Object.freeze(['T', 'U']);
export const FORECAST_ID_PATTERN = /^FCT-2026-Q(?:00[1-9]|0[1-9]\d|1[01]\d|120)$/u;

const FORECAST_SOURCE_URL = new URL('../content/duediligence-2026/bar-forecast.json', import.meta.url);

function exactArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function requiredInteger(value, label) {
  assert.ok(Number.isInteger(value), `${label} must be an integer.`);
  return value;
}

function normalizeIdRows(sheet, layout, expectedCount) {
  assert.ok(Array.isArray(sheet.idRows), `${sheet.title} idRows must be an array.`);
  assert.equal(sheet.idRows.length, expectedCount, `${sheet.title} live ID count drifted.`);
  const byId = new Map();
  const rows = new Set();
  for (const [index, entry] of sheet.idRows.entries()) {
    assert.ok(entry && typeof entry === 'object' && !Array.isArray(entry), `${sheet.title} idRows[${index}] is invalid.`);
    const id = String(entry.id ?? '').trim();
    const row = requiredInteger(entry.row, `${sheet.title} row for ${id || index + 1}`);
    assert.ok(id, `${sheet.title} idRows[${index}] has an empty ID.`);
    assert.ok(!byId.has(id), `${sheet.title} repeats live ID ${id}.`);
    assert.ok(!rows.has(row), `${sheet.title} repeats live row ${row}.`);
    assert.ok(row >= layout.dataStartRow && row <= layout.dataEndRow, `${sheet.title} row ${row} is outside the live data range.`);
    byId.set(id, row);
    rows.add(row);
  }
  for (let row = layout.dataStartRow; row <= layout.dataEndRow; row += 1) {
    assert.ok(rows.has(row), `${sheet.title} live row ${row} is missing from the ID map.`);
  }
  return byId;
}

function validateSheetSnapshot(snapshot, title, layout) {
  const sheet = snapshot?.sheets?.[title];
  assert.ok(sheet && typeof sheet === 'object' && !Array.isArray(sheet), `${title} snapshot is required.`);
  assert.equal(sheet.title, title, `${title} snapshot title drifted.`);
  assert.equal(requiredInteger(sheet.sheetId, `${title} sheetId`), layout.sheetId, `${title} sheetId drifted.`);
  assert.equal(requiredInteger(sheet.columnCount, `${title} columnCount`), layout.columnCount, `${title} column count drifted.`);
  if (Number.isInteger(layout.rowCount)) {
    assert.equal(requiredInteger(sheet.rowCount, `${title} rowCount`), layout.rowCount, `${title} row count drifted.`);
  } else {
    assert.ok(requiredInteger(sheet.rowCount, `${title} rowCount`) >= layout.minimumRowCount, `${title} grid is too short.`);
  }
  for (const field of ['headerRow', 'dataStartRow', 'dataEndRow']) {
    assert.equal(requiredInteger(sheet[field], `${title} ${field}`), layout[field], `${title} ${field} drifted.`);
  }
  assert.ok(exactArray(sheet.headers, HEADERS), `${title} headers do not match the exact 21-column contract.`);
  assert.ok(exactArray(sheet.formulaColumns, FORMULA_COLUMNS), `${title} must explicitly identify T:U as formula-owned columns.`);
  return {
    sheet,
    byId: normalizeIdRows({ ...sheet, title }, layout, layout.existingRecordCount),
  };
}

function assertForecastIdSet(ids, label) {
  assert.equal(ids.size, 120, `${label} must contain exactly 120 Forecast IDs.`);
  for (let index = 1; index <= 120; index += 1) {
    const id = `FCT-2026-Q${String(index).padStart(3, '0')}`;
    assert.ok(ids.has(id), `${label} is missing ${id}.`);
  }
}

function exactSet(actual, expected) {
  if (actual.size !== expected.size) return false;
  for (const value of actual) {
    if (!expected.has(value)) return false;
  }
  return true;
}

function uniqueForecastSourceKeys(rows, field, label) {
  const keys = new Set();
  for (const [index, row] of rows.entries()) {
    const key = String(row?.[field] ?? '').trim();
    assert.ok(key, `${label} row ${index + 1} has an empty ${field}.`);
    assert.ok(!keys.has(key), `${label} repeats ${field} ${key}.`);
    keys.add(key);
  }
  assert.equal(keys.size, 120, `${label} must contain exactly 120 unique ${field} values.`);
  return keys;
}

export function validateLiveSnapshot(snapshot, forecastSource) {
  assert.ok(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot), 'Live snapshot must be an object.');
  assert.equal(snapshot.spreadsheetId, SPREADSHEET_ID, 'Spreadsheet ID drifted.');
  assert.ok(forecastSource && forecastSource.count === 120 && forecastSource.rows?.length === 120, 'Forecast source must contain exactly 120 rows.');

  const qna = validateSheetSnapshot(snapshot, 'Q&A Bank', SHEET_LAYOUTS['Q&A Bank']);
  const upload = validateSheetSnapshot(snapshot, 'Website Upload', SHEET_LAYOUTS['Website Upload']);
  const forecast = validateSheetSnapshot(snapshot, '2026 Bar Forecast', SHEET_LAYOUTS['2026 Bar Forecast']);

  const generatedIds = uniqueForecastSourceKeys(forecastSource.rows, 'question_bank_id', 'Generated Forecast');
  const generatedEditorialRefs = uniqueForecastSourceKeys(forecastSource.rows, 'editorial_ref', 'Generated Forecast');
  assertForecastIdSet(generatedIds, 'Generated Forecast');
  const liveForecastKeys = new Set(forecast.byId.keys());
  let forecastLiveKeyMode;
  if (exactSet(liveForecastKeys, generatedIds)) {
    forecastLiveKeyMode = 'question_bank_id';
  } else if (exactSet(liveForecastKeys, generatedEditorialRefs)) {
    forecastLiveKeyMode = 'editorial_ref';
  } else {
    assert.fail('Live Forecast tab IDs must exactly match either all 120 generated question_bank_id values or all 120 generated editorial_ref values.');
  }

  for (const [title, live] of [['Q&A Bank', qna], ['Website Upload', upload]]) {
    for (const id of generatedIds) {
      assert.ok(!live.byId.has(id), `${title} already contains ${id}; refusing to append a duplicate Forecast set.`);
    }
  }

  const supersededIds = [];
  const seenSuperseded = new Set();
  for (const row of forecastSource.rows) {
    assert.ok(Array.isArray(row.supersedes_question_ids), `${row.id || row.question_bank_id} supersedes_question_ids must be an array.`);
    for (const rawId of row.supersedes_question_ids) {
      const id = String(rawId ?? '').trim();
      assert.ok(id, `${row.id || row.question_bank_id} has an empty superseded ID.`);
      assert.ok(!seenSuperseded.has(id), `Superseded ID ${id} is repeated.`);
      assert.ok(qna.byId.has(id), `Q&A Bank live ID map is missing superseded ID ${id}.`);
      assert.ok(upload.byId.has(id), `Website Upload live ID map is missing superseded ID ${id}.`);
      seenSuperseded.add(id);
      supersededIds.push(id);
    }
  }
  assert.equal(supersededIds.length, 110, 'Forecast must supersede exactly 110 existing IDs.');

  const qnaLayout = SHEET_LAYOUTS['Q&A Bank'];
  assert.ok(qnaLayout.newEndRow <= qna.sheet.rowCount, 'Q&A Bank append range exceeds existing grid capacity.');
  const uploadLayout = SHEET_LAYOUTS['Website Upload'];
  assert.equal(uploadLayout.rowCount + uploadLayout.appendRows, uploadLayout.newEndRow, 'Website Upload append math drifted.');

  return {
    qna,
    upload,
    forecast,
    generatedIds,
    generatedEditorialRefs,
    forecastLiveKeyMode,
    supersededIds,
  };
}

function cell(value) {
  if (typeof value === 'number') return { userEnteredValue: { numberValue: value } };
  return { userEnteredValue: { stringValue: String(value ?? '') } };
}

function contentWriteRequests(sheetId, startRow, rows, chunkSize = 20) {
  const requests = [];
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    requests.push({
      updateCells: {
        range: {
          sheetId,
          startRowIndex: startRow - 1 + offset,
          endRowIndex: startRow - 1 + offset + chunk.length,
          startColumnIndex: 0,
          endColumnIndex: CONTENT_COLUMN_COUNT,
        },
        rows: chunk.map((row) => ({ values: row.slice(0, CONTENT_COLUMN_COUNT).map(cell) })),
        fields: 'userEnteredValue',
      },
    });
  }
  return requests;
}

function copyExemplarRequests(layout) {
  const base = {
    sheetId: layout.sheetId,
    startRowIndex: layout.exemplarRow - 1,
    endRowIndex: layout.exemplarRow,
  };
  const destination = {
    sheetId: layout.sheetId,
    startRowIndex: layout.newStartRow - 1,
    endRowIndex: layout.newEndRow,
  };
  return [
    {
      copyPaste: {
        source: { ...base, startColumnIndex: 0, endColumnIndex: HEADERS.length },
        destination: { ...destination, startColumnIndex: 0, endColumnIndex: HEADERS.length },
        pasteType: 'PASTE_FORMAT',
        pasteOrientation: 'NORMAL',
      },
    },
    {
      copyPaste: {
        source: { ...base, startColumnIndex: 0, endColumnIndex: HEADERS.length },
        destination: { ...destination, startColumnIndex: 0, endColumnIndex: HEADERS.length },
        pasteType: 'PASTE_DATA_VALIDATION',
        pasteOrientation: 'NORMAL',
      },
    },
    {
      copyPaste: {
        source: { ...base, startColumnIndex: 19, endColumnIndex: 21 },
        destination: { ...destination, startColumnIndex: 19, endColumnIndex: 21 },
        pasteType: 'PASTE_FORMULA',
        pasteOrientation: 'NORMAL',
      },
    },
  ];
}

function contiguousRuns(rows) {
  const sorted = [...rows].sort((a, b) => a - b);
  const runs = [];
  for (const row of sorted) {
    const last = runs.at(-1);
    if (last && row === last.end + 1) last.end = row;
    else runs.push({ start: row, end: row });
  }
  return runs;
}

function publicationReadyNoRequests(sheetId, byId, supersededIds) {
  const rows = supersededIds.map((id) => byId.get(id));
  return contiguousRuns(rows).map(({ start, end }) => ({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: start - 1,
        endRowIndex: end,
        startColumnIndex: PUBLICATION_READY_COLUMN_INDEX,
        endColumnIndex: PUBLICATION_READY_COLUMN_INDEX + 1,
      },
      cell: { userEnteredValue: { stringValue: 'No' } },
      fields: 'userEnteredValue',
    },
  }));
}

function forecastRowsInLiveOrder(generatedRowsById, liveById) {
  return [...liveById.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([id]) => {
      const row = generatedRowsById.get(id);
      assert.ok(row, `Generated Forecast row ${id} is missing.`);
      return row;
    });
}

function requestSheetIds(request) {
  const value = Object.values(request)[0];
  const ids = [];
  for (const candidate of [value?.sheetId, value?.range?.sheetId, value?.source?.sheetId, value?.destination?.sheetId]) {
    if (Number.isInteger(candidate)) ids.push(candidate);
  }
  return ids;
}

function rangesOverlap(left, right) {
  return left.sheetId === right.sheetId
    && left.startRowIndex < right.endRowIndex
    && right.startRowIndex < left.endRowIndex
    && left.startColumnIndex < right.endColumnIndex
    && right.startColumnIndex < left.endColumnIndex;
}

function assertNoPeerRangeOverlaps(requests, type) {
  const ranges = requests
    .filter((request) => request[type])
    .map((request, index) => ({ index, range: request[type].range }));
  for (let left = 0; left < ranges.length; left += 1) {
    for (let right = left + 1; right < ranges.length; right += 1) {
      assert.ok(
        !rangesOverlap(ranges[left].range, ranges[right].range),
        `${type} requests ${ranges[left].index + 1} and ${ranges[right].index + 1} overlap.`,
      );
    }
  }
}

export function validateBatchRequests(requests) {
  assert.ok(Array.isArray(requests) && requests.length > 0, 'Batch requests must be a non-empty array.');
  const allowedSheetIds = new Set(Object.values(SHEET_LAYOUTS).map((layout) => layout.sheetId));
  for (const [index, request] of requests.entries()) {
    assert.ok(request && typeof request === 'object' && !Array.isArray(request), `Request ${index + 1} is invalid.`);
    assert.equal(Object.keys(request).length, 1, `Request ${index + 1} must set exactly one request type.`);
    const [type] = Object.keys(request);
    assert.ok(['appendDimension', 'copyPaste', 'updateCells', 'repeatCell'].includes(type), `Request ${index + 1} uses unexpected type ${type}.`);
    for (const sheetId of requestSheetIds(request)) {
      assert.ok(allowedSheetIds.has(sheetId), `Request ${index + 1} targets an unauthorized sheetId ${sheetId}.`);
    }
    if (type === 'updateCells') {
      const update = request.updateCells;
      const height = update.range.endRowIndex - update.range.startRowIndex;
      const width = update.range.endColumnIndex - update.range.startColumnIndex;
      assert.equal(update.rows.length, height, `Request ${index + 1} row height mismatch.`);
      assert.ok(update.rows.every((row) => row.values.length === width), `Request ${index + 1} row width mismatch.`);
      assert.equal(update.fields, 'userEnteredValue', `Request ${index + 1} has an unsafe field mask.`);
      assert.ok(update.range.endColumnIndex <= CONTENT_COLUMN_COUNT, `Request ${index + 1} would overwrite formula-owned T:U.`);
    }
    if (type === 'repeatCell') {
      assert.equal(request.repeatCell.range.startColumnIndex, PUBLICATION_READY_COLUMN_INDEX, `Request ${index + 1} targets the wrong state column.`);
      assert.equal(request.repeatCell.range.endColumnIndex, PUBLICATION_READY_COLUMN_INDEX + 1, `Request ${index + 1} targets more than Publication Ready?.`);
      assert.equal(request.repeatCell.cell.userEnteredValue.stringValue, 'No', `Request ${index + 1} writes an unexpected publication state.`);
      assert.equal(request.repeatCell.fields, 'userEnteredValue', `Request ${index + 1} has an unsafe state field mask.`);
    }
  }
  assertNoPeerRangeOverlaps(requests, 'updateCells');
  assertNoPeerRangeOverlaps(requests, 'repeatCell');
  return true;
}

export function buildAuditSummary({ requests, supersededIds }) {
  const requestTypes = requests.reduce((counts, request) => {
    const type = Object.keys(request)[0];
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});
  const lines = [
    '# Forecast and Q&A Google Sheets batch audit',
    '',
    `- Spreadsheet: ${SPREADSHEET_ID}`,
    '- Mode: dry-run generator only; no external write was executed.',
    `- Generated Forecast records: 120`,
    `- Existing records marked Publication Ready? = No: ${supersededIds.length} in Q&A Bank and ${supersededIds.length} in Website Upload`,
    `- Q&A Bank: copy row 843 structure to rows 844-963; write A:S; preserve formula-owned T:U.`,
    `- Website Upload: append 120 grid rows; copy row 801 structure to rows 802-921; write A:S; preserve formula-owned T:U.`,
    `- 2026 Bar Forecast: update rows 2-121 in the exact live ID order; write A:S only; preserve T:U.`,
    '- Excluded sheets: Website Visibility and Bar Simulation Pool.',
    `- Atomic request count: ${requests.length} (${Object.entries(requestTypes).map(([type, count]) => `${type}=${count}`).join(', ')}).`,
    '',
    'Precondition: re-read the three target headers, grid sizes, T:U formula ownership, and complete ID-to-row maps immediately before executing this batch. If the live snapshot changes, regenerate the batch.',
  ];
  return `${lines.join('\n')}\n`;
}

export async function buildQuestionBankSyncBatch(snapshot, { forecastSource } = {}) {
  const source = forecastSource || JSON.parse(await readFile(FORECAST_SOURCE_URL, 'utf8'));
  const live = validateLiveSnapshot(snapshot, source);

  const projectedRows = source.rows.map((row, index) => {
    const record = projectForecastQuestion(row, index);
    return HEADERS.map((header) => record[header]);
  });
  const forecastSheetRows = forecastRows(source);
  const forecastGeneratedByLiveKey = new Map(source.rows.map((row, index) => [
    String(row[live.forecastLiveKeyMode] ?? '').trim(),
    forecastSheetRows[index],
  ]));
  const liveOrderedForecastRows = forecastRowsInLiveOrder(forecastGeneratedByLiveKey, live.forecast.byId);

  const qnaLayout = SHEET_LAYOUTS['Q&A Bank'];
  const uploadLayout = SHEET_LAYOUTS['Website Upload'];
  const forecastLayout = SHEET_LAYOUTS['2026 Bar Forecast'];
  const requests = [
    ...copyExemplarRequests(qnaLayout),
    ...contentWriteRequests(qnaLayout.sheetId, qnaLayout.newStartRow, projectedRows),
    ...publicationReadyNoRequests(qnaLayout.sheetId, live.qna.byId, live.supersededIds),
    {
      appendDimension: {
        sheetId: uploadLayout.sheetId,
        dimension: 'ROWS',
        length: uploadLayout.appendRows,
      },
    },
    ...copyExemplarRequests(uploadLayout),
    ...contentWriteRequests(uploadLayout.sheetId, uploadLayout.newStartRow, projectedRows),
    ...publicationReadyNoRequests(uploadLayout.sheetId, live.upload.byId, live.supersededIds),
    ...contentWriteRequests(forecastLayout.sheetId, forecastLayout.dataStartRow, liveOrderedForecastRows),
  ];
  validateBatchRequests(requests);

  const batch = {
    spreadsheet_id: SPREADSHEET_ID,
    requests,
    include_spreadsheet_in_response: true,
    response_include_grid_data: false,
    response_ranges: [
      "'Q&A Bank'!A4:U963",
      "'Website Upload'!A1:U921",
      "'2026 Bar Forecast'!A1:U121",
    ],
  };
  return {
    batch,
    audit: {
      spreadsheetId: SPREADSHEET_ID,
      dryRun: true,
      requestCount: requests.length,
      generatedForecastCount: projectedRows.length,
      forecastLiveKeyMode: live.forecastLiveKeyMode,
      supersededCount: live.supersededIds.length,
      targetSheets: ['Q&A Bank', 'Website Upload', '2026 Bar Forecast'],
      excludedSheets: ['Website Visibility', 'Bar Simulation Pool'],
      formulaPolicy: 'Write A:S only. Copy T:U formulas only for newly appended Q&A/Website rows; preserve existing Forecast T:U.',
    },
    auditMarkdown: buildAuditSummary({ requests, supersededIds: live.supersededIds }),
  };
}

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] || '').trim() : '';
}

export async function main(argv = process.argv.slice(2)) {
  const snapshotPath = argumentValue(argv, '--snapshot');
  assert.ok(snapshotPath, 'Usage: node scripts/build-bar-forecast-qbank-google-batch.mjs --snapshot <live-snapshot.json> [--batch-output <batch.json>] [--audit-output <audit.md>]');
  const snapshot = JSON.parse(await readFile(path.resolve(snapshotPath), 'utf8'));
  const result = await buildQuestionBankSyncBatch(snapshot);
  const batchOutput = argumentValue(argv, '--batch-output');
  const auditOutput = argumentValue(argv, '--audit-output');
  if (batchOutput) await writeFile(path.resolve(batchOutput), `${JSON.stringify(result.batch, null, 2)}\n`, 'utf8');
  if (auditOutput) await writeFile(path.resolve(auditOutput), result.auditMarkdown, 'utf8');
  if (!batchOutput) console.log(JSON.stringify(result.batch, null, 2));
  if (!auditOutput) console.error(result.auditMarkdown);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  });
}

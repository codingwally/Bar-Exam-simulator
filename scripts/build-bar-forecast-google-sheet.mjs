import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const FORECAST_SHEET_TITLE = '2026 Bar Forecast';
export const FORECAST_SHEET_ID = 20260831;

export const HEADERS = Object.freeze([
  'Question ID',
  'Subject',
  'Topic',
  'Bar Year',
  'Question No.',
  'Essay Question',
  'Suggested Answer',
  'Legal Basis / Provision',
  'Controlling Doctrine',
  'Jurisprudence / Case',
  'Citation / G.R. No.',
  'Source URL',
  'Difficulty',
  'Editorial Status',
  'Version',
  'Assigned Reviewer',
  'Last Reviewed',
  'Publication Ready?',
  'Notes',
  'Feedback Count',
  'Open Feedback',
]);

const sourceUrl = new URL('../content/duediligence-2026/bar-forecast.json', import.meta.url);

function noteFor(row) {
  return [
    'AI-prepared beta; owner legal review required before publication.',
    '2025 Bar standard: one yes-or-no question, one controlling doctrine, responsive ALAC, and reasoned conclusion.',
    `Editorial reference: ${row.editorial_ref}.`,
    `Forecast source ID: ${row.id}.`,
    `Training-priority index: ${row.prediction_score}.`,
    'Runtime source: protected 2026 Bar Forecast import.',
  ].join(' ');
}

export function forecastRows(source) {
  assert.equal(source?.count, 120, 'Forecast source must declare exactly 120 questions.');
  assert.equal(source?.rows?.length, 120, 'Forecast source must contain exactly 120 questions.');
  return source.rows.map((row) => [
    row.editorial_ref,
    row.subject,
    row.syllabus_topic,
    2026,
    row.rank_within_subject,
    row.prompt,
    row.suggested_answer,
    row.legal_basis,
    row.controlling_doctrine,
    row.jurisprudence,
    row.citation,
    row.source_links.join('\n'),
    row.difficulty,
    'For Review',
    row.version,
    'Wally Esteban',
    '',
    'No',
    noteFor(row),
    0,
    0,
  ]);
}

function cell(value) {
  if (typeof value === 'number') return { userEnteredValue: { numberValue: value } };
  return { userEnteredValue: { stringValue: String(value ?? '') } };
}

function dataWriteRequests(rows) {
  const requests = [];
  const chunkSize = 20;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    requests.push({
      updateCells: {
        range: {
          sheetId: FORECAST_SHEET_ID,
          startRowIndex: offset + 1,
          endRowIndex: offset + 1 + chunk.length,
          startColumnIndex: 0,
          endColumnIndex: HEADERS.length,
        },
        rows: chunk.map((row) => ({ values: row.map(cell) })),
        fields: 'userEnteredValue',
      },
    });
  }
  return requests;
}

function columnWidth(startIndex, endIndex, pixelSize) {
  return {
    updateDimensionProperties: {
      range: {
        sheetId: FORECAST_SHEET_ID,
        dimension: 'COLUMNS',
        startIndex,
        endIndex,
      },
      properties: { pixelSize },
      fields: 'pixelSize',
    },
  };
}

export function buildForecastSheetRequests(rows) {
  const usedRows = rows.length + 1;
  return [
    {
      addSheet: {
        properties: {
          sheetId: FORECAST_SHEET_ID,
          title: FORECAST_SHEET_TITLE,
          index: 6,
          gridProperties: {
            rowCount: 1000,
            columnCount: HEADERS.length,
            frozenRowCount: 1,
            frozenColumnCount: 2,
            hideGridlines: true,
          },
          tabColorStyle: { rgbColor: { red: 0.7725, green: 0.6275, blue: 0.3490 } },
        },
      },
    },
    {
      updateCells: {
        range: {
          sheetId: FORECAST_SHEET_ID,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: HEADERS.length,
        },
        rows: [{ values: HEADERS.map(cell) }],
        fields: 'userEnteredValue',
      },
    },
    ...dataWriteRequests(rows),
    {
      repeatCell: {
        range: {
          sheetId: FORECAST_SHEET_ID,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: HEADERS.length,
        },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: { red: 0.0824, green: 0.1647, blue: 0.2588 } },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP',
            textFormat: {
              foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
              fontFamily: 'Carlito',
              fontSize: 10,
              bold: true,
            },
          },
        },
        fields: 'userEnteredFormat(backgroundColorStyle,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)',
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: FORECAST_SHEET_ID,
          startRowIndex: 1,
          endRowIndex: usedRows,
          startColumnIndex: 0,
          endColumnIndex: HEADERS.length,
        },
        cell: {
          userEnteredFormat: {
            verticalAlignment: 'TOP',
            wrapStrategy: 'WRAP',
            textFormat: {
              foregroundColorStyle: { rgbColor: { red: 0.1137, green: 0.1529, blue: 0.1882 } },
              fontFamily: 'Carlito',
              fontSize: 9,
            },
            borders: {
              top: { style: 'SOLID', colorStyle: { rgbColor: { red: 0.7882, green: 0.8353, blue: 0.8745 } } },
              bottom: { style: 'SOLID', colorStyle: { rgbColor: { red: 0.7882, green: 0.8353, blue: 0.8745 } } },
              left: { style: 'SOLID', colorStyle: { rgbColor: { red: 0.7882, green: 0.8353, blue: 0.8745 } } },
              right: { style: 'SOLID', colorStyle: { rgbColor: { red: 0.7882, green: 0.8353, blue: 0.8745 } } },
            },
          },
        },
        fields: 'userEnteredFormat(verticalAlignment,wrapStrategy,textFormat,borders)',
      },
    },
    {
      addBanding: {
        bandedRange: {
          range: {
            sheetId: FORECAST_SHEET_ID,
            startRowIndex: 0,
            endRowIndex: usedRows,
            startColumnIndex: 0,
            endColumnIndex: HEADERS.length,
          },
          rowProperties: {
            headerColorStyle: { rgbColor: { red: 0.0824, green: 0.1647, blue: 0.2588 } },
            firstBandColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
            secondBandColorStyle: { rgbColor: { red: 0.9569, green: 0.9686, blue: 0.9804 } },
          },
        },
      },
    },
    {
      setDataValidation: {
        range: {
          sheetId: FORECAST_SHEET_ID,
          startRowIndex: 1,
          endRowIndex: usedRows,
          startColumnIndex: 13,
          endColumnIndex: 14,
        },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: ['For Review', 'Approved', 'Needs Revision'].map((userEnteredValue) => ({ userEnteredValue })),
          },
          strict: true,
          showCustomUi: true,
        },
      },
    },
    {
      setDataValidation: {
        range: {
          sheetId: FORECAST_SHEET_ID,
          startRowIndex: 1,
          endRowIndex: usedRows,
          startColumnIndex: 17,
          endColumnIndex: 18,
        },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: ['No', 'Yes'].map((userEnteredValue) => ({ userEnteredValue })),
          },
          strict: true,
          showCustomUi: true,
        },
      },
    },
    {
      setBasicFilter: {
        filter: {
          range: {
            sheetId: FORECAST_SHEET_ID,
            startRowIndex: 0,
            endRowIndex: usedRows,
            startColumnIndex: 0,
            endColumnIndex: HEADERS.length,
          },
        },
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: FORECAST_SHEET_ID, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 42 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: FORECAST_SHEET_ID, dimension: 'ROWS', startIndex: 1, endIndex: usedRows },
        properties: { pixelSize: 112 },
        fields: 'pixelSize',
      },
    },
    columnWidth(0, 1, 96),
    columnWidth(1, 2, 185),
    columnWidth(2, 3, 230),
    columnWidth(3, 5, 88),
    columnWidth(5, 7, 420),
    columnWidth(7, 9, 360),
    columnWidth(9, 10, 250),
    columnWidth(10, 11, 160),
    columnWidth(11, 12, 320),
    columnWidth(12, 15, 118),
    columnWidth(15, 19, 150),
    columnWidth(18, 19, 360),
    columnWidth(19, 21, 96),
  ];
}

export async function buildForecastSheetBatch() {
  const source = JSON.parse(await readFile(sourceUrl, 'utf8'));
  const rows = forecastRows(source);
  return {
    requests: buildForecastSheetRequests(rows),
    include_spreadsheet_in_response: true,
    response_include_grid_data: false,
    response_ranges: [`'${FORECAST_SHEET_TITLE}'!A1:U${rows.length + 1}`],
  };
}

export async function main(argv = process.argv.slice(2)) {
  const batch = await buildForecastSheetBatch();
  if (argv.includes('--structure')) {
    const requests = batch.requests.filter((request) => !(
      request.updateCells?.range?.startRowIndex >= 1
    ));
    console.log(JSON.stringify({ requests }));
    return;
  }
  const chunkIndex = argv.indexOf('--chunk');
  if (chunkIndex >= 0) {
    const index = Number(argv[chunkIndex + 1]);
    const writes = batch.requests.filter((request) => request.updateCells?.range?.startRowIndex >= 1);
    assert.ok(Number.isInteger(index) && index >= 0 && index < writes.length, 'Chunk index is invalid.');
    console.log(JSON.stringify({ requests: [writes[index]] }));
    return;
  }
  if (argv.includes('--summary')) {
    console.log(JSON.stringify({
      ok: true,
      sheetId: FORECAST_SHEET_ID,
      sheetTitle: FORECAST_SHEET_TITLE,
      rowCount: 120,
      columnCount: HEADERS.length,
      requestCount: batch.requests.length,
    }, null, 2));
    return;
  }
  console.log(JSON.stringify(batch));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

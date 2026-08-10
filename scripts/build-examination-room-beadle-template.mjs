import fs from 'node:fs/promises';
import path from 'node:path';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const root = path.resolve(import.meta.dirname, '..');
const outputDir = path.resolve(root, '..', '..', 'outputs', 'examination-room-beadle-template');
const assetPath = path.join(root, 'assets', 'examination-room-beadle-class-list-template.xlsx');
const outputPath = path.join(outputDir, 'examination-room-beadle-class-list-template.xlsx');
const previewPath = path.join(outputDir, 'examination-room-beadle-class-list-template.png');

const headers = [
  'Email Address',
  'Student Number',
  'Student Name (Last Name, First Name, Middle Initial)',
];

const workbook = Workbook.create();
const sheet = workbook.worksheets.add('Class List');
sheet.showGridLines = false;
sheet.freezePanes.freezeRows(1);

sheet.getRange('A1:C1').values = [headers];
sheet.getRange('A1:C1').format = {
  fill: '#061C35',
  font: { bold: true, color: '#FFFFFF', size: 11 },
  verticalAlignment: 'center',
  horizontalAlignment: 'left',
  wrapText: true,
  borders: {
    bottom: { style: 'medium', color: '#D4AF37' },
  },
};
sheet.getRange('A1:C1').format.rowHeightPx = 44;

const entryRange = sheet.getRange('A2:C501');
entryRange.values = Array.from({ length: 500 }, () => ['', '', '']);
entryRange.format = {
  fill: '#FFFFFF',
  font: { color: '#0B1F33', size: 11 },
  verticalAlignment: 'center',
  horizontalAlignment: 'left',
  numberFormat: '@',
  borders: {
    insideHorizontal: { style: 'thin', color: '#D9E1E8' },
  },
};
entryRange.format.rowHeightPx = 26;

sheet.getRange('A1:A501').format.columnWidthPx = 290;
sheet.getRange('B1:B501').format.columnWidthPx = 170;
sheet.getRange('C1:C501').format.columnWidthPx = 390;

await fs.mkdir(outputDir, { recursive: true });
const preview = await workbook.render({
  sheetName: 'Class List',
  range: 'A1:C8',
  scale: 1.5,
  format: 'png',
});
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

const inspection = await workbook.inspect({
  kind: 'table',
  range: 'Class List!A1:C4',
  include: 'values,formulas',
  tableMaxRows: 4,
  tableMaxCols: 3,
});
process.stdout.write(`${inspection.ndjson}\n`);

const errors = await workbook.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 20 },
  summary: 'final formula error scan',
});
process.stdout.write(`${errors.ndjson}\n`);

const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(outputPath);
await fs.copyFile(outputPath, assetPath);
process.stdout.write(`${outputPath}\n${assetPath}\n${previewPath}\n`);

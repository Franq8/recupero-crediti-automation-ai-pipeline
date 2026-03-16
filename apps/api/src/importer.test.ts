import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { extractSpreadsheetDocumentText, parseImportFileRows } from './importer.js';

async function buildWorkbookBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const first = wb.addWorksheet('Primo foglio');
  first.addRow(['nome', 'importo']);
  first.addRow(['Mario Rossi', '100']);

  const second = wb.addWorksheet('Secondo foglio');
  second.addRow(['nome', 'importo']);
  second.addRow(['Luigi Verdi', '250']);

  const data = await wb.xlsx.writeBuffer();
  return Buffer.from(data as ArrayBuffer);
}

test('parseImportFileRows on xlsx uses only first sheet by default', async () => {
  const buf = await buildWorkbookBuffer();

  const rows = await parseImportFileRows(
    'multi-sheet.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buf
  );

  assert.deepEqual(rows, [{ nome: 'Mario Rossi', importo: '100' }]);
});

test('parseImportFileRows can merge all sheets when explicitly requested', async () => {
  const buf = await buildWorkbookBuffer();

  const rows = await parseImportFileRows(
    'multi-sheet.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buf,
    { spreadsheetMode: 'all-sheets' }
  );

  assert.deepEqual(rows, [
    { nome: 'Mario Rossi', importo: '100' },
    { nome: 'Luigi Verdi', importo: '250' }
  ]);
});

test('extractSpreadsheetDocumentText on xlsx includes all sheets as document content', async () => {
  const buf = await buildWorkbookBuffer();

  const text = await extractSpreadsheetDocumentText(
    'multi-sheet.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buf
  );

  assert.ok(text);
  assert.match(text!, /# Sheet: Primo foglio/);
  assert.match(text!, /Mario Rossi/);
  assert.match(text!, /# Sheet: Secondo foglio/);
  assert.match(text!, /Luigi Verdi/);
});

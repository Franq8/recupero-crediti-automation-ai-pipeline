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

test('parseImportFileRows on csv auto-detects semicolon delimiters', async () => {
  const rows = await parseImportFileRows(
    'semicolon.csv',
    'text/csv',
    Buffer.from(['row_id;tribunale;di_numero', '1;Treviso;100/2026'].join('\n'))
  );

  assert.deepEqual(rows, [{ row_id: '1', tribunale: 'Treviso', di_numero: '100/2026' }]);
});

test('parseImportFileRows on xlsx preserves displayed number and date formats', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Formato');
  ws.addRow(['importo', 'data', 'testo']);
  const row = ws.addRow([3948.94, new Date('2026-03-16T00:00:00Z'), 'ABC']);
  row.getCell(1).numFmt = '#.##0,00';
  row.getCell(2).numFmt = 'dd/mm/yyyy';

  const data = await wb.xlsx.writeBuffer();
  const rows = await parseImportFileRows(
    'formatted.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    Buffer.from(data as ArrayBuffer)
  );

  assert.deepEqual(rows, [{ importo: '3.948,94', data: '16/03/2026', testo: 'ABC' }]);
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

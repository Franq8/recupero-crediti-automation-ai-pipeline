import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
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

async function rewriteSpreadsheetXmlWithXPrefix(buf: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);

  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.startsWith('xl/') || !name.endsWith('.xml')) continue;

    const xml = await entry.async('string');
    if (!/xmlns="http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main"/.test(xml)) continue;

    const prefixed = xml
      .replace(/xmlns="http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main"/g, 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')
      .replace(/<(\/)?([A-Za-z][A-Za-z0-9]*)(\s|>|\/)/g, '<$1x:$2$3');

    zip.file(name, prefixed);
  }

  return zip.generateAsync({ type: 'nodebuffer' });
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

test('parseImportFileRows on a formatted xlsx skips title rows before the table headers', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Dati');
  ws.addRow(['RIEPILOGO PRATICHE']);
  ws.addRow(['Documento di lavoro', 'Documento di lavoro']);
  ws.addRow(['GRUPPO A', 'GRUPPO A', 'GRUPPO B']);
  ws.addRow(['Debitore', 'Annata', 'Totale dovuto']);
  ws.addRow(['Mario Rossi', '2024', '100,00']);
  const data = await wb.xlsx.writeBuffer();

  const rows = await parseImportFileRows(
    'formatted.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    Buffer.from(data as ArrayBuffer)
  );

  assert.deepEqual(rows, [{ Debitore: 'Mario Rossi', Annata: '2024', 'Totale dovuto': '100,00' }]);
});

test('parseImportFileRows on xlsx accepts prefixed spreadsheet namespace files', async () => {
  const buf = await rewriteSpreadsheetXmlWithXPrefix(await buildWorkbookBuffer());

  const rows = await parseImportFileRows(
    'prefixed.xlsx',
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
  ws.addRow(['importo', 'data', 'testo', 'importo_en', 'importo_it_locale', 'fallback_us', 'formula_eur', 'data_locale']);
  const row = ws.addRow([3948.94, new Date('2026-03-16T00:00:00Z'), 'ABC', 3661.05, 9106.45, '5,786.27', null, new Date('2026-03-17T00:00:00Z')]);
  row.getCell(1).numFmt = '#.##0,00';
  row.getCell(2).numFmt = 'dd/mm/yyyy';
  row.getCell(4).numFmt = '#,##0.00';
  row.getCell(5).numFmt = '[$€-it-IT] #,##0.00';
  row.getCell(7).value = { formula: '1+1', result: 5282.89 } as any;
  row.getCell(7).numFmt = '#,##0.00 _€';
  row.getCell(8).numFmt = '[$-410]dd/mm/yyyy';

  const data = await wb.xlsx.writeBuffer();
  const rows = await parseImportFileRows(
    'formatted.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    Buffer.from(data as ArrayBuffer)
  );

  assert.deepEqual(rows, [{ importo: '3.948,94', data: '16/03/2026', testo: 'ABC', importo_en: '3,661.05', importo_it_locale: '9.106,45', fallback_us: '5.786,27', formula_eur: '5.282,89', data_locale: '17/03/2026' }]);
});

test('parseImportFileRows treats an uncached Excel formula as an empty value', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Formula');
  ws.addRow(['testo']);
  ws.addRow([{ formula: 'IF(1=0,"x","")' }]);
  const data = await wb.xlsx.writeBuffer();

  const rows = await parseImportFileRows(
    'formula.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    Buffer.from(data as ArrayBuffer)
  );

  assert.deepEqual(rows, []);
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

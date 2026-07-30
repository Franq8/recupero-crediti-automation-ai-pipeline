import ExcelJS from 'exceljs';
import JSZip from 'jszip';

export type SpreadsheetImportMode = 'first-sheet-only' | 'all-sheets';

export async function parseImportFileRows(
  filename: string,
  mimeType: string,
  buf: Buffer,
  options: { spreadsheetMode?: SpreadsheetImportMode } = {}
): Promise<Record<string, unknown>[]> {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.json') || mimeType.includes('json')) {
    const data = JSON.parse(buf.toString('utf-8'));
    if (Array.isArray(data)) return data.map(normalizeObjectRow).filter((r) => Object.keys(r).length > 0);
    return [normalizeObjectRow(data ?? {})];
  }

  if (lower.endsWith('.csv') || mimeType.includes('csv') || mimeType.includes('text/plain')) {
    const text = buf.toString('utf-8').trim();
    return parseDelimitedTextRows(text);
  }

  if (lower.endsWith('.xlsx') || mimeType.includes('spreadsheetml')) {
    const wb = await loadXlsxWorkbook(buf);

    const spreadsheetMode = options.spreadsheetMode ?? 'first-sheet-only';
    const worksheets = spreadsheetMode === 'all-sheets' ? wb.worksheets : wb.worksheets.slice(0, 1);
    const out: Record<string, unknown>[] = [];

    for (const ws of worksheets) {
      out.push(...parseWorksheetRows(ws));
    }

    return out;
  }

  return [];
}

export async function parseImportFile(filename: string, mimeType: string, buf: Buffer): Promise<Record<string, unknown>> {
  const rows = await parseImportFileRows(filename, mimeType, buf);
  return rows[0] ?? {};
}

export async function extractSpreadsheetDocumentText(filename: string, mimeType: string, buf: Buffer): Promise<string | null> {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.csv') || mimeType.includes('csv') || mimeType.includes('text/plain')) {
    const text = buf.toString('utf-8').trim();
    if (!text) return '';
    return ['# Sheet: CSV', text].join('\n\n');
  }

  if (lower.endsWith('.xlsx') || mimeType.includes('spreadsheetml')) {
    const wb = await loadXlsxWorkbook(buf);

    const sheetBlocks = wb.worksheets
      .map((ws) => {
        const lines: string[] = [];
        for (let rowNum = 1; rowNum <= ws.rowCount; rowNum++) {
          const row = ws.getRow(rowNum);
          const values = Array.from({ length: row.cellCount }, (_, idx) => normalizeExcelCell(row.getCell(idx + 1)));
          if (!values.some((value) => String(value ?? '').trim() !== '')) continue;
          lines.push(values.map((value) => String(value ?? '').trim()).join('\t'));
        }
        if (!lines.length) return null;
        return [`# Sheet: ${ws.name}`, ...lines].join('\n');
      })
      .filter((block): block is string => Boolean(block));

    return sheetBlocks.join('\n\n');
  }

  return null;
}

async function loadXlsxWorkbook(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as any);
    return wb;
  } catch (error) {
    const normalized = await normalizeSpreadsheetMainNamespacePrefixes(buf);
    if (!normalized) throw error;

    const retry = new ExcelJS.Workbook();
    await retry.xlsx.load(normalized as any);
    return retry;
  }
}

async function normalizeSpreadsheetMainNamespacePrefixes(buf: Buffer): Promise<Buffer | null> {
  const zip = await JSZip.loadAsync(buf);
  let changed = false;

  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !name.startsWith('xl/')) continue;

    const xml = await entry.async('string');
    let next = xml;

    if (name.endsWith('.xml') && /xmlns:x=["']http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main["']/.test(next)) {
      next = next
        .replace(/xmlns:x=/g, 'xmlns=')
        .replace(/(<\/?)(x):/g, '$1');
    }

    if (name.match(/^xl\/worksheets\/_rels\/sheet\d+[.]xml[.]rels$/)) {
      next = next.replace(/Target=(['"])\/xl\/tables\//g, 'Target=$1../tables/');
    }

    if (next !== xml) {
      zip.file(name, next);
      changed = true;
    }
  }

  if (!changed) return null;
  return zip.generateAsync({ type: 'nodebuffer' });
}

function normalizeObjectRow(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!k) continue;
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

function normalizeExcelValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('result' in v) return (v as any).result ?? '';
    if ('text' in v && typeof v.text === 'string') return v.text.trim();
    return String((v as any).toString?.() ?? '').trim();
  }
  return typeof v === 'string' ? v.trim() : v;
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function formatExcelDate(value: Date, numFmt: string) {
  const day = pad2(value.getDate());
  const month = pad2(value.getMonth() + 1);
  const year4 = String(value.getFullYear());
  const year2 = year4.slice(-2);
  const hour = pad2(value.getHours());
  const minute = pad2(value.getMinutes());
  const second = pad2(value.getSeconds());

  let out = numFmt.replace(/\[\$-[^\]]+\]/gi, '').replace(/\\/g, '');
  out = out.replace(/yyyy/gi, year4);
  out = out.replace(/yy/gi, year2);
  out = out.replace(/dd/gi, day);
  out = out.replace(/mm/gi, month);
  out = out.replace(/hh/gi, hour);
  out = out.replace(/ss/gi, second);
  out = out.replace(/mi|MM/g, minute);
  out = out.replace(/^m$/g, month);
  return out;
}

function formatExcelNumber(value: number, numFmt: string) {
  const rawFmt = String(numFmt || '');
  const hasItalianLocaleHint = /(it-it|it\)|\beuro\b|€)/i.test(rawFmt);
  const normalizedFmt = rawFmt.replace(/\[[^\]]+\]/g, '').replace(/"[^"]*"/g, '').trim();
  const decimalSection = normalizedFmt.split(';')[0] || normalizedFmt;
  const numericCore = (decimalSection.match(/[0#.,]+/) || [''])[0];
  const lastComma = numericCore.lastIndexOf(',');
  const lastDot = numericCore.lastIndexOf('.');
  const decimalSep = hasItalianLocaleHint
    ? ','
    : lastComma > lastDot
      ? ','
      : lastDot > lastComma
        ? '.'
        : '';
  const decimalSepIndex = decimalSep
    ? (decimalSep === ',' && hasItalianLocaleHint && lastDot > lastComma ? lastDot : numericCore.lastIndexOf(decimalSep))
    : -1;
  const decimals = decimalSepIndex >= 0
    ? (numericCore.slice(decimalSepIndex + 1).match(/[0#]/g) || []).length
    : 0;
  const integerPartPattern = decimalSepIndex > 0 ? numericCore.slice(0, decimalSepIndex) : numericCore;
  const useGrouping = /[.,](?=.*[0#])/.test(integerPartPattern);

  if (decimalSep === ',') {
    return new Intl.NumberFormat('it-IT', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping
    }).format(value);
  }

  if (decimalSep === '.') {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping
    }).format(value);
  }

  return new Intl.NumberFormat(hasItalianLocaleHint ? 'it-IT' : 'en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    useGrouping
  }).format(value);
}

function formatExcelDisplayedValue(cell: ExcelJS.Cell): string | null {
  const numFmt = String(cell.numFmt ?? '').trim();
  if (!numFmt) return null;

  const raw = cell.value;
  const rawValue = normalizeExcelValue(raw);
  const formulaResult = raw && typeof raw === 'object' && 'result' in (raw as any) ? (raw as any).result : null;
  const effective = formulaResult ?? rawValue;

  if (effective instanceof Date || raw instanceof Date) {
    return formatExcelDate((effective instanceof Date ? effective : raw as Date), numFmt);
  }

  if (typeof effective === 'number') {
    return formatExcelNumber(effective, numFmt);
  }

  return null;
}

function normalizeAmericanNumberStringToEuropean(input: string): string {
  const raw = String(input ?? '');
  const trimmed = raw.trim();
  if (!trimmed) return raw;
  if (!/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$|^[-+]?\d+\.\d+$/.test(trimmed)) return raw;

  const sign = trimmed.startsWith('-') || trimmed.startsWith('+') ? trimmed[0] : '';
  const unsigned = sign ? trimmed.slice(1) : trimmed;
  const lastDot = unsigned.lastIndexOf('.');
  const decimalDigits = lastDot >= 0 ? unsigned.slice(lastDot + 1).replace(/[^0-9]/g, '') : '';
  const integerDigits = (lastDot >= 0 ? unsigned.slice(0, lastDot) : unsigned).replace(/[^0-9]/g, '');
  if (!integerDigits) return raw;
  const groupedInteger = integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${groupedInteger}${decimalDigits ? `,${decimalDigits}` : ''}`;
}

function normalizeExcelCell(cell: ExcelJS.Cell): unknown {
  const rawValue = normalizeExcelValue(cell.value);
  const formattedValue = formatExcelDisplayedValue(cell);
  if (formattedValue !== null) return formattedValue;
  if (typeof rawValue === 'string') return normalizeAmericanNumberStringToEuropean(rawValue);
  return rawValue;
}

function countDelimiterOccurrences(line: string, delimiter: string) {
  let count = 0;
  let inQ = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        i += 1;
      } else {
        inQ = !inQ;
      }
      continue;
    }
    if (ch === delimiter && !inQ) count += 1;
  }

  return count;
}

function detectDelimitedTextSeparator(headerLine: string) {
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = -1;

  for (const delimiter of candidates) {
    const count = countDelimiterOccurrences(headerLine, delimiter);
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }

  return best;
}

function splitCsvLine(line: string, delimiter = ','): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
      continue;
    }
    if (ch === delimiter && !inQ) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseDelimitedTextRows(text: string): Record<string, unknown>[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const delimiter = detectDelimitedTextSeparator(lines[0]);
  const headers = splitCsvLine(lines[0], delimiter).map((h) => String(h ?? '').trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line, delimiter);
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      if (!h) return;
      row[h] = String(values[i] ?? '').trim();
    });
    return row;
  }).filter((r) => Object.keys(r).length > 0);
}

function parseWorksheetRows(ws: ExcelJS.Worksheet): Record<string, unknown>[] {
  const headerRow = findHeaderRow(ws);
  const headers: string[] = [];
  headerRow.eachCell((cell, col) => {
    headers[col - 1] = String(cell.value ?? '').trim();
  });

  const out: Record<string, unknown>[] = [];
  for (let rowNum = headerRow.number + 1; rowNum <= ws.rowCount; rowNum++) {
    const valueRow = ws.getRow(rowNum);
    const row: Record<string, unknown> = {};
    headers.forEach((key, idx) => {
      if (!key) return;
      const cell = valueRow.getCell(idx + 1);
      row[key] = normalizeExcelCell(cell);
    });
    if (Object.values(row).some((v) => String(v ?? '').trim() !== '')) out.push(row);
  }

  return out;
}

function findHeaderRow(ws: ExcelJS.Worksheet): ExcelJS.Row {
  const firstRow = ws.getRow(1);
  const scanUntil = Math.min(ws.rowCount, 20);
  const columnCount = Math.max(ws.columnCount, ...Array.from({ length: scanUntil }, (_, idx) => ws.getRow(idx + 1).cellCount));
  const firstValues = Array.from({ length: columnCount }, (_, idx) => String(firstRow.getCell(idx + 1).value ?? '').trim()).filter(Boolean);

  // Preserve ordinary one-column imports. For wide, presentation-style sheets,
  // a single title cell in row 1 is not a table header: look for the first row
  // with several distinct labels near the top of the sheet.
  if (columnCount <= 1 || firstValues.length > 1) return firstRow;

  const minimumDistinctLabels = Math.max(3, Math.ceil(columnCount * 0.25));
  for (let rowNum = 2; rowNum <= scanUntil; rowNum++) {
    const candidate = ws.getRow(rowNum);
    const labels = Array.from({ length: columnCount }, (_, idx) => String(candidate.getCell(idx + 1).value ?? '').trim()).filter(Boolean);
    const distinctLabels = new Set(labels.map((label) => label.toLocaleLowerCase('it-IT')));
    if (distinctLabels.size >= minimumDistinctLabels) return candidate;
  }

  return firstRow;
}

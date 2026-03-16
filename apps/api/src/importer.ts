import ExcelJS from 'exceljs';

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
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);

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
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);

    const sheetBlocks = wb.worksheets
      .map((ws) => {
        const lines: string[] = [];
        for (let rowNum = 1; rowNum <= ws.rowCount; rowNum++) {
          const row = ws.getRow(rowNum);
          const values = Array.from({ length: row.cellCount }, (_, idx) => normalizeExcelValue(row.getCell(idx + 1).value));
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
    if ('text' in v && typeof v.text === 'string') return v.text.trim();
    if ('result' in v) return (v as any).result ?? '';
    return String((v as any).toString?.() ?? '').trim();
  }
  return typeof v === 'string' ? v.trim() : v;
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
  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell, col) => {
    headers[col - 1] = String(cell.value ?? '').trim();
  });

  const out: Record<string, unknown>[] = [];
  for (let rowNum = 2; rowNum <= ws.rowCount; rowNum++) {
    const valueRow = ws.getRow(rowNum);
    const row: Record<string, unknown> = {};
    headers.forEach((key, idx) => {
      if (!key) return;
      const v = valueRow.getCell(idx + 1).value;
      row[key] = normalizeExcelValue(v);
    });
    if (Object.values(row).some((v) => String(v ?? '').trim() !== '')) out.push(row);
  }

  return out;
}

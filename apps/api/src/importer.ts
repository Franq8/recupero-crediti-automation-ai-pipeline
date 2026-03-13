import ExcelJS from 'exceljs';

export async function parseImportFileRows(filename: string, mimeType: string, buf: Buffer): Promise<Record<string, unknown>[]> {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.json') || mimeType.includes('json')) {
    const data = JSON.parse(buf.toString('utf-8'));
    if (Array.isArray(data)) return data.map(normalizeObjectRow).filter((r) => Object.keys(r).length > 0);
    return [normalizeObjectRow(data ?? {})];
  }

  if (lower.endsWith('.csv') || mimeType.includes('csv') || mimeType.includes('text/plain')) {
    const text = buf.toString('utf-8').trim();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = splitCsvLine(lines[0]).map((h) => String(h ?? '').trim());
    return lines.slice(1).map((line) => {
      const values = splitCsvLine(line);
      const row: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        if (!h) return;
        row[h] = String(values[i] ?? '').trim();
      });
      return row;
    }).filter((r) => Object.keys(r).length > 0);
  }

  if (lower.endsWith('.xlsx') || mimeType.includes('spreadsheetml')) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.worksheets[0];
    if (!ws) return [];

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

  return [];
}

export async function parseImportFile(filename: string, mimeType: string, buf: Buffer): Promise<Record<string, unknown>> {
  const rows = await parseImportFileRows(filename, mimeType, buf);
  return rows[0] ?? {};
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

function splitCsvLine(line: string): string[] {
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
    if (ch === ',' && !inQ) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

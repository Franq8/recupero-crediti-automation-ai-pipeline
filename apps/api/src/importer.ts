import ExcelJS from 'exceljs';

export async function parseImportFile(filename: string, mimeType: string, buf: Buffer): Promise<Record<string, unknown>> {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.json') || mimeType.includes('json')) {
    const data = JSON.parse(buf.toString('utf-8'));
    if (Array.isArray(data)) return data[0] ?? {};
    return data ?? {};
  }

  if (lower.endsWith('.csv') || mimeType.includes('csv') || mimeType.includes('text/plain')) {
    const text = buf.toString('utf-8').trim();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return {};
    const headers = splitCsvLine(lines[0]);
    const values = splitCsvLine(lines[1]);
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] ?? '';
    });
    return obj;
  }

  if (lower.endsWith('.xlsx') || mimeType.includes('spreadsheetml')) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.worksheets[0];
    if (!ws) return {};

    const headerRow = ws.getRow(1);
    const valueRow = ws.getRow(2);
    const obj: Record<string, unknown> = {};

    headerRow.eachCell((cell, col) => {
      const key = String(cell.value ?? '').trim();
      if (!key) return;
      const v = valueRow.getCell(col).value;
      obj[key] = normalizeExcelValue(v);
    });

    return obj;
  }

  return {};
}

function normalizeExcelValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('result' in v) return (v as any).result ?? '';
    return String((v as any).toString?.() ?? '');
  }
  return v;
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

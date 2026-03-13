import ExcelJS from 'exceljs';
import { extractTemplateFields } from './docx.js';
import { extractTemplateInstructions } from './template-instructions.js';

export type TemplateTableStructure = {
  headers: string[];
  row: Record<string, string | number>;
};

function escapeCsvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function buildTemplateTableStructure(docxBytes: Uint8Array): Promise<TemplateTableStructure> {
  const fieldKeys = await extractTemplateFields(docxBytes);
  const instructionKeys = (await extractTemplateInstructions(docxBytes)).map((item) => item.key);

  const seen = new Set<string>();
  const templateKeys: string[] = [];
  for (const key of [...fieldKeys, ...instructionKeys]) {
    const normalized = String(key ?? '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    templateKeys.push(normalized);
  }

  const headers = ['row_id', ...templateKeys];
  const row = Object.fromEntries(headers.map((key) => [key, key === 'row_id' ? 1 : ''])) as Record<string, string | number>;
  return { headers, row };
}

export async function buildTemplateTableStructureCsv(docxBytes: Uint8Array): Promise<string> {
  const { headers, row } = await buildTemplateTableStructure(docxBytes);
  const headerLine = headers.map(escapeCsvCell).join(',');
  const rowLine = headers.map((key) => escapeCsvCell(String(row[key] ?? ''))).join(',');
  return `${headerLine}\n${rowLine}\n`;
}

export async function buildTemplateTableStructureJson(docxBytes: Uint8Array): Promise<string> {
  const { row } = await buildTemplateTableStructure(docxBytes);
  return JSON.stringify([row], null, 2);
}

export async function buildTemplateTableStructureXlsx(docxBytes: Uint8Array): Promise<Uint8Array> {
  const { headers, row } = await buildTemplateTableStructure(docxBytes);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('template_table_structure');

  ws.addRow(headers);
  ws.addRow(headers.map((key) => row[key] ?? ''));
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((column) => {
    column.width = 24;
  });

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
